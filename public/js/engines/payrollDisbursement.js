// ==========================================
// Payroll Disbursement Engine — Phase 10 Readiness (F-01)
// ==========================================
// Ensures atomic payroll release and loan settlement:
// 1. Guarded transition to 'paid' MUST succeed before any loan mutations take effect.
// 2. Concurrency protection against double-submission / race conditions.
// 3. Complete atomic rollback if any storage write fails during disbursement.
// ==========================================

import { transitionPayrollGuarded, fullReturnPayrollBatchGuarded } from './payrollAccess.js';
import { can } from '../types.js';

// In-flight tracking to prevent concurrent/double submission
const inFlightDisbursements = new Set();
const inFlightFullReturns = new Set();

export function getDisbursementBatchKey(batch) {
  if (!batch) return '';
  return `${batch.id || ''}|${batch.month || ''}|${batch.companyId || ''}|${batch.branchId || ''}`;
}

export function isDisbursementInFlight(batch) {
  const key = getDisbursementBatchKey(batch);
  return inFlightDisbursements.has(key);
}

export function isFullReturnInFlight(batch) {
  const key = getDisbursementBatchKey(batch);
  return inFlightFullReturns.has(key);
}

/**
 * Executes payroll disbursement and loan settlements atomically.
 *
 * @param {Object} params
 * @param {Object} params.user - Current acting user
 * @param {Object} params.batch - Payroll batch to disburse
 * @param {Object} params.storage - Storage instance
 * @param {Object} [params.context] - Branch/company context for permission checks
 * @param {string} [params.by] - Name/identifier of the actor
 * @param {string} [params.simulateFailure] - Simulation hook for rollback testing ('before_batch_write', 'before_loan_write', 'after_writes')
 * @returns {Object} { ok: boolean, error?: string, layer?: string, batch?: Object, loansChanged?: boolean, settledLoans?: Array, rolledBack?: boolean }
 */
export function disbursePayrollAtomic({
  user,
  batch,
  storage,
  context,
  by,
  simulateFailure = null,
} = {}) {
  if (!batch || typeof batch !== 'object') {
    return { ok: false, error: 'invalid_batch', layer: 'validation' };
  }
  if (!storage || typeof storage.getState !== 'function') {
    return { ok: false, error: 'invalid_storage', layer: 'system' };
  }

  const key = getDisbursementBatchKey(batch);
  if (inFlightDisbursements.has(key)) {
    return { ok: false, error: 'disbursement_in_progress', layer: 'concurrency' };
  }
  inFlightDisbursements.add(key);

  try {
    const actorName = by || user?.name || user?.username || 'Payments Officer';

    // 1. First: Guarded transition MUST succeed before anything else is touched
    const payRes = transitionPayrollGuarded(user, batch, 'paid', { by: actorName, context });
    if (!payRes.ok) {
      return {
        ok: false,
        layer: payRes.layer,
        error: payRes.error,
        batch: payRes.batch || batch,
      };
    }

    const paidBatch = payRes.batch;
    const targetMonth = paidBatch.month;

    // FR-1-D4 (CRIT-1): NEVER snapshot the SCOPED getState() projection as the
    // authoritative collection. A company/branch-scoped actor's getState() view
    // is filtered, so snapshotting it and writing back wholesale (saveLoans /
    // savePayrolls) would silently delete every out-of-scope record. Instead we
    // read the full canonical collections and persist only the touched ids via
    // id-scoped merges (persistLoansById / persistPayrollsById). Engines
    // without the raw API (minimal test dummies) fall back to getState() +
    // whole-array writes, which is safe there because those stores are already
    // the canonical source.
    const originalPayrolls = cloneArr(payrollStorage(storage));
    const originalLoans = cloneArr(loanStorage(storage));
    // Pre-state of the exact batch being disbursed — used for id-scoped rollback
    // (restoring the full payroll array would clobber concurrent records).
    const preBatch = JSON.parse(JSON.stringify(batch));

    // 2. Prepare loan mutations in memory (cloned state). Settlement is exact:
    // each deductible item must carry the deterministic attributions emitted by
    // the payroll engine at generation time (loanId + amount + month). Any item
    // that cannot be mapped to its generating loans is refused fail-closed —
    // it is never settled against "the first warm loan for this employee".
    const allLoans = JSON.parse(JSON.stringify(originalLoans));
    const affectedLoanIds = new Set();
    let loansChanged = false;
    const settledLoans = [];

    for (const it of (paidBatch.items || [])) {
      const installment = Number(it.loanInstallment) || 0;
      if (installment <= 0) continue;
      const attrs = loanAttributesOf(it);
      if (!attrs.length) {
        return { ok: false, error: 'unattributable_loan_deduction', layer: 'loan', batch };
      }
      let totalDeducted = 0;
      for (const attr of attrs) {
        const amount = Number(attr.amount) || 0;
        const loan = allLoans.find((l) => l && l.id === attr.loanId);
        const s = settleLoanAttribution({ loan, it, amount, attrMonth: attr.month, targetMonth, now: new Date().toISOString() });
        if (!s.ok) {
          return { ok: false, error: s.error, layer: s.layer, batch };
        }
        totalDeducted += s.paid;
        affectedLoanIds.add(String(loan.id));
        settledLoans.push({
          loanId: loan.id,
          employeeId: it.employeeId,
          installmentPaid: s.paid,
          remainingAmount: loan.remainingAmount,
          status: loan.status,
        });
      }
      // Stamp the item with the EXACT loan(s) + amounts that were actually
      // settled (a partial installment lands here as the true deducted amount).
      // The full-return reversal uses these stamps to reverse precisely.
      it.loanDeductedAmount = Number(totalDeducted.toFixed(2));
      if (attrs.length === 1) it.loanId = attrs[0].loanId;
      else delete it.loanId;
      loansChanged = true;
    }

    // Finalize batch metadata
    paidBatch.releasedAt = new Date().toISOString();
    paidBatch.releasedBy = actorName;
    (paidBatch.items || []).forEach((it) => { it.isPaid = true; });

    // 3. Atomic persistence with rollback. Writes touch only the affected ids:
    // the single payroll batch (addPayrollBatch — composite-key upsert) and the
    // affected loans (id-scoped merge). Out-of-scope and unrelated records are
    // never rewritten, so an offline/scoped deployment can never lose another
    // company's or branch's financial data on a failed write.
    try {
      if (simulateFailure === 'before_batch_write') {
        throw new Error('simulated_failure_before_batch_write');
      }

      // Step A: Save payroll batch
      storage.addPayrollBatch(paidBatch);

      if (simulateFailure === 'before_loan_write') {
        throw new Error('simulated_failure_before_loan_write');
      }

      // Step B: Save affected loans only (id-scoped merge)
      if (loansChanged) {
        persistLoansById(storage, allLoans.filter((l) => l && affectedLoanIds.has(String(l.id))), allLoans);
      }

      if (simulateFailure === 'after_writes') {
        throw new Error('simulated_failure_after_writes');
      }

      // Step C: Audit log
      storage.addAudit('settle', 'payroll', `${targetMonth} → released & paid`, paidBatch.id);

      return {
        ok: true,
        batch: paidBatch,
        loansChanged,
        settledLoans,
      };
    } catch (writeErr) {
      // Rollback both payroll and loans back to initial state — again id-scoped
      // so a failure never disturbs unrelated out-of-scope records.
      try {
        restorePayrollById(storage, preBatch, originalPayrolls);
        if (loansChanged) {
          restoreLoansById(storage, originalLoans, affectedLoanIds);
        }
      } catch (rbErr) {
        console.error('Critical rollback error during disbursement:', rbErr);
      }
      return {
        ok: false,
        layer: 'storage',
        error: writeErr.message || 'storage_write_failure',
        rolledBack: true,
        batch: batch,
      };
    }
  } finally {
    inFlightDisbursements.delete(key);
  }
}

// ==========================================
// Legacy loan attribution hardening (FR-1-D1)
// ==========================================
// Legacy payroll items carry only the aggregated planned `loanInstallment`
// with no per-loan attribution (loanId / loanDeductedAmount only exist for
// batches disbursed after b6553ae). The resolver below NEVER picks "the first
// loan". It restricts candidates to the batch's own employee + company +
// branch, requires at least one non-EOSB paid schedule entry for the target
// month, and requires exactly ONE provable candidate: the single paid entry
// amount must equal the item's planned deduction exactly, and every monetary
// floor/ceiling (amount > 0, amount <= paidAmount, remaining + amount <=
// totalAmount, no negative paidAmount, totalAmount never changed) must hold.
// Any ambiguity or un-provability rejects the whole return (fail-closed).

const EPS = 0.0001;

// ==========================================
// Canonical storage access + id-scoped persistence (FR-1-D4 / CRIT-1)
// ==========================================
// The disbursement and full-return money paths must never rebuild the payroll
// or loan collections from the SCOPED getState() projection and write them back
// wholesale — that deleted every out-of-scope record for a scoped actor. These
// helpers read the full canonical collections and persist only the ids they
// actually touched. Minimal storage dummies (tests) without the raw API fall
// back to getState() + whole-array writes, which is safe there because those
// stores already behave as the canonical source.

const cloneArr = (arr) => JSON.parse(JSON.stringify(arr || []));

const loanStorage = (storage) =>
  (typeof storage.getRawLoans === 'function' ? storage.getRawLoans() : (storage.getState().loans || []));

const payrollStorage = (storage) =>
  (typeof storage.getRawPayrolls === 'function' ? storage.getRawPayrolls() : (storage.getState().payrolls || []));

const persistLoansById = (storage, affected, fullFallback) => {
  if (typeof storage.persistLoansById === 'function') storage.persistLoansById(affected);
  else storage.saveLoans(fullFallback || affected);
};

const restoreLoansById = (storage, preLoans, affectedIds) => {
  const affected = preLoans.filter((l) => l && affectedIds.has(String(l.id)));
  if (typeof storage.persistLoansById === 'function') storage.persistLoansById(affected);
  else storage.saveLoans(preLoans);
};

const restorePayrollById = (storage, preBatch, fullFallback) => {
  if (typeof storage.persistPayrollsById === 'function') storage.persistPayrollsById([preBatch]);
  else storage.savePayrolls(fullFallback);
};

// Deterministic attribution (FR-1-D4 / CRIT-2): the payroll engine writes, on
// each generated item, the exact loans their deductions came from. Pre-engine
// (or manually-edited) items carry only a legacy loanId; anything else is
// unattributable and refused fail-closed at disbursement.
const loanAttributesOf = (it) => {
  if (!it || typeof it !== 'object') return [];
  if (Array.isArray(it.loanAttributions) && it.loanAttributions.length > 0) {
    return it.loanAttributions;
  }
  if (it.loanId) return [{ loanId: it.loanId, amount: Number(it.loanInstallment) || 0, month: it.month, currency: it.currency }];
  return [];
};

/**
 * Settles ONE attributed loan installment in memory. Verifies the loan is the
 * exact one that generated the deduction (employee, company, branch, currency,
 * month, unpaid schedule entry or a provable auto-run), caps the payment at the
 * remaining balance (partial installments land as `paid`), and returns the
 * money actually deducted. Any mismatch fails closed with a stable code.
 */
function settleLoanAttribution({ loan, it, amount, attrMonth, targetMonth, now }) {
  if (!loan || !loan.id) return { ok: false, error: 'attribution_loan_not_found', layer: 'loan' };
  if (loan.employeeId !== it.employeeId) return { ok: false, error: 'attribution_employee_mismatch', layer: 'loan' };
  if (String(loan.companyId ?? '') !== String(it.companyId ?? '')) return { ok: false, error: 'attribution_company_mismatch', layer: 'loan' };
  if (String(loan.branchId ?? '') !== String(it.branchId ?? '')) return { ok: false, error: 'attribution_branch_mismatch', layer: 'loan' };
  const loanCurrency = String(loan.currency || '').trim().toUpperCase();
  const itCurrency = String(it.currency || '').trim().toUpperCase();
  if (itCurrency && loanCurrency && itCurrency !== loanCurrency) return { ok: false, error: 'attribution_currency_mismatch', layer: 'loan' };
  if (!(amount > 0)) return { ok: false, error: 'attribution_invalid_amount', layer: 'loan' };
  if (attrMonth != null && String(attrMonth) !== String(targetMonth)) return { ok: false, error: 'attribution_month_mismatch', layer: 'loan' };
  if (!(Number(loan.remainingAmount) > 0)) return { ok: false, error: 'attribution_loan_settled', layer: 'loan' };
  const schedule = Array.isArray(loan.installments) ? loan.installments : [];
  loan.installments = schedule;
  if (schedule.length === 0) {
    // Auto-run loan (no explicit schedule). The attributed amount must exactly
    // match min(installmentAmount, remaining) — otherwise the attribution is
    // stale and the deduction is refused.
    if (!(Number(loan.installmentAmount) > 0)) return { ok: false, error: 'attribution_irresolvable_loan', layer: 'loan' };
    const expected = Math.min(Number(loan.installmentAmount), Number(loan.remainingAmount));
    if (Math.abs(expected - amount) >= EPS) return { ok: false, error: 'attribution_installment_mismatch', layer: 'loan' };
    schedule.push({ month: targetMonth, amount, isPaid: true, paidAt: now });
  } else {
    const entry = schedule.find((x) => x && x.month === targetMonth && !x.isPaid);
    if (!entry) return { ok: false, error: 'attribution_month_mismatch', layer: 'loan' };
    const entryAmount = Number(entry.amount) || 0;
    if (Math.abs(entryAmount - amount) >= EPS) return { ok: false, error: 'attribution_installment_mismatch', layer: 'loan' };
    entry.isPaid = true;
    entry.paidAt = now;
  }
  const paid = Math.min(amount, Number(loan.remainingAmount) || 0);
  loan.paidAmount = Number(((Number(loan.paidAmount) || 0) + paid).toFixed(2));
  loan.remainingAmount = Number((Number(loan.remainingAmount) - paid).toFixed(2));
  if (loan.remainingAmount <= 0) {
    loan.remainingAmount = 0;
    if (loan.status !== 'settled') {
      loan.status = 'settled';
      loan.settledAt = now;
    }
  }
  return { ok: true, loan, paid };
}

/**
 * Pure resolver (no I/O). Determines the single provable legacy loan+entry for
 * a payroll item, or returns a stable rejection code.
 *
 * @returns {Object}
 *   { ok:true,  loan, entry, amount }                 — provable attribution
 *   { ok:false, error: 'legacy_loan_attribution_missing', layer:'loan' }
 *   { ok:false, error: 'ambiguous_legacy_loan',       layer:'loan' }
 */
export function resolveLegacyLoanItem(allLoans, it, targetMonth) {
  if (!it || typeof it !== 'object') {
    return { ok: false, error: 'invalid_record', layer: 'validation' };
  }
  const installment = Number(it.loanInstallment) || 0;
  if (installment <= 0) return { ok: true, irrelevant: true };

  const employeeId = it.employeeId;
  const companyId = String(it.companyId ?? '');
  const branchId = String(it.branchId ?? '');

  const candidates = (allLoans || []).filter((l) => {
    if (!l || !l.id) return false;
    if (l.employeeId !== employeeId) return false;
    if (String(l.companyId ?? '') !== companyId) return false;
    if (String(l.branchId ?? '') !== branchId) return false;
    if (!Array.isArray(l.installments)) return false;
    return l.installments.some((e) =>
      e && e.month === targetMonth && e.isPaid === true &&
      String(e.type || '') !== 'eosb_settlement'
    );
  });

  if (candidates.length === 0) {
    return { ok: false, error: 'legacy_loan_attribution_missing', layer: 'loan' };
  }
  if (candidates.length > 1) {
    return { ok: false, error: 'ambiguous_legacy_loan', layer: 'loan' };
  }

  const loan = candidates[0];
  const paidEntries = loan.installments.filter((e) =>
    e && e.month === targetMonth && e.isPaid === true &&
    String(e.type || '') !== 'eosb_settlement'
  );
  if (paidEntries.length !== 1) {
    // Multiple distinct paid entries for the same month — cannot prove which
    // one the payroll item corresponds to.
    return { ok: false, error: 'ambiguous_legacy_loan', layer: 'loan' };
  }

  const entry = paidEntries[0];
  const amount = Number(entry.amount) || 0;
  const paidAmount = Number(loan.paidAmount) || 0;
  const remaining = Number(loan.remainingAmount) || 0;
  const total = Number(loan.totalAmount) || 0;

  if (!(amount > 0)) {
    return { ok: false, error: 'ambiguous_legacy_loan', layer: 'loan' };
  }
  // The item's planned deduction must equal this single paid entry exactly so
  // the pairing is provable and no other loan contributed to this item.
  if (Math.abs(amount - installment) >= EPS) {
    return { ok: false, error: 'ambiguous_legacy_loan', layer: 'loan' };
  }
  // Never reverse more than the loan has actually collected.
  if (amount > paidAmount + EPS) {
    return { ok: false, error: 'ambiguous_legacy_loan', layer: 'loan' };
  }
  // Never let remainingAmount exceed totalAmount (totalAmount is never edited).
  if (remaining + amount > total + EPS) {
    return { ok: false, error: 'ambiguous_legacy_loan', layer: 'loan' };
  }
  // settled → active is ONLY permitted when the reversal is provably of THIS
  // payroll month's entry and the loan was not closed by an EOSB settlement.
  if (loan.status === 'settled') {
    const hasEosb = (loan.installments || []).some((x) => String(x.type || '') === 'eosb_settlement');
    if (hasEosb) {
      return { ok: false, error: 'ambiguous_legacy_loan', layer: 'loan' };
    }
  }

  return { ok: true, loan, entry, amount, installment };
}

/**
 * Applies a provable legacy reversal to an in-memory clone of a loan.
 * Pure: operates on the passed clone only, never touches storage.
 */
export function applyLegacyLoanReversal(loan, entry, amount) {
  entry.isPaid = false;
  delete entry.paidAt;
  loan.paidAmount = Math.max(0, Number(((Number(loan.paidAmount) || 0) - amount).toFixed(2)));
  loan.remainingAmount = Number(((Number(loan.remainingAmount) || 0) + amount).toFixed(2));
  if (loan.status === 'settled') {
    loan.status = 'active';
    delete loan.settledAt;
  }
  return { ok: true, loan, entry };
}

/**
 * Executes a structured financial full return on a paid payroll batch,
 * reversing associated loan deductions atomically.
 */
export function reversePayrollDisbursementAtomic({
  user,
  batch,
  reason,
  storage,
  context,
  by,
} = {}) {
  if (!batch || typeof batch !== 'object') {
    return { ok: false, error: 'invalid_batch', layer: 'validation' };
  }
  if (!storage || typeof storage.getState !== 'function') {
    return { ok: false, error: 'invalid_storage', layer: 'system' };
  }
  if (!reason || !String(reason).trim()) {
    return { ok: false, error: 'missing_return_reason', layer: 'validation' };
  }
  if (batch.status !== 'paid') {
    return { ok: false, error: 'batch_not_paid', layer: 'state' };
  }
  if (batch.fullReturn && batch.fullReturn.completed) {
    return { ok: false, error: 'already_fully_returned', layer: 'state' };
  }

  // Permission check: require payroll.cancelPayment (or super_admin). Runs
  // BEFORE the in-flight slot is reserved so a denied request never holds it.
  if (!user || (!can(user, 'payroll.cancelPayment') && user.role !== 'super_admin')) {
    return { ok: false, error: 'permission_denied', layer: 'permission' };
  }

  // Concurrency guard: a full return runs once per batch — a second concurrent
  // invocation (double-click, duplicate tab, retry) is refused outright.
  const key = getDisbursementBatchKey(batch);
  if (inFlightFullReturns.has(key)) {
    return { ok: false, error: 'full_return_in_progress', layer: 'concurrency' };
  }
  inFlightFullReturns.add(key);

  try {
    const actorName = by || user?.name || user?.username || 'HR Manager';
    const targetMonth = batch.month;

    const originalPayrolls = cloneArr(payrollStorage(storage));
    const originalLoans = cloneArr(loanStorage(storage));
    // Pre-state of the exact batch being returned — used for id-scoped rollback.
    const preBatch = JSON.parse(JSON.stringify(batch));

    const allLoans = JSON.parse(JSON.stringify(originalLoans));
    let loansReversed = false;
    const reversedLoanIds = new Set();

    // FR-1-D1: two-phase loan reversal. Phase A resolves and validates EVERY
    // payroll item up-front (no mutation, no storage write). Any legacy item
    // that cannot be attributed to exactly one provable loan aborts the whole
    // return fail-closed — neither the payroll nor the loans are written.
    // Phase B applies the resolutions on the in-memory clones only; the
    // atomic persistence (payroll + loans + audit) happens below.
    const legacyResolutions = [];
    const preciseItems = [];
    const attributedItems = [];
    for (const it of (batch.items || [])) {
      if (!it || typeof it !== 'object') continue;
      if (it.loanId && Number(it.loanDeductedAmount) > 0) {
        // Post-B+C exact path: attribution is trusted from the disbursement
        // stamps — unchanged semantics.
        preciseItems.push(it);
      } else if (Array.isArray(it.loanAttributions) && it.loanAttributions.length > 0) {
        // FR-1-D4: generation-time attribution (return of a batch that was
        // disbursed after D4, or re-disbursement of a previously returned
        // batch). Reverse each attributed loan by its exact recorded amount.
        attributedItems.push(it);
      } else if (Number(it.loanInstallment) > 0) {
        const res = resolveLegacyLoanItem(allLoans, it, targetMonth);
        if (!res.ok) {
          const detail = { batchId: batch.id, month: targetMonth, employeeId: it.employeeId, error: res.error };
          if (res.error === 'ambiguous_legacy_loan') {
            storage.addAudit(
              'legacy_auto_reversal_rejected_ambiguous',
              'payroll',
              `${targetMonth} → employee ${String(it.employeeId)} legacy loan attribution ambiguous (${JSON.stringify(detail)})`,
              batch.id
            );
          } else {
            storage.addAudit(
              'legacy_auto_reversal_rejected_missing',
              'payroll',
              `${targetMonth} → employee ${String(it.employeeId)} legacy loan attribution missing (${JSON.stringify(detail)})`,
              batch.id
            );
          }
          return { ok: false, error: res.error, layer: res.layer, batch };
        }
        legacyResolutions.push({ it, res });
      }
    }

    // Phase B — apply all resolutions to the in-memory loan clones.
    for (const { it, res } of legacyResolutions) {
      applyLegacyLoanReversal(res.loan, res.entry, res.amount);
      it.loanId = res.loan.id;
      it.loanDeductedAmount = res.amount;
      loansReversed = true;
      reversedLoanIds.add(String(res.loan.id));
      storage.addAudit(
        'legacy_auto_reversal_accepted',
        'loans',
        `${targetMonth} → employee ${String(it.employeeId)} loan ${res.loan.id} reversed by ${res.amount}`,
        res.loan.id
      );
    }
    // Post-B+C exact path (unchanged behavior — precise reversal of stamped
    // items, partial installments included).
    for (const it of preciseItems) {
      const amount = Number(it.loanDeductedAmount) || 0;
      const loan = allLoans.find((l) => l && l.id === it.loanId);
      if (!loan || !Array.isArray(loan.installments) || amount <= 0) continue;
      const byAmount = loan.installments.find((x) => x && x.month === targetMonth && x.isPaid && Math.abs(Number(x.amount || 0) - amount) < EPS);
      const scheduleEntry = byAmount || loan.installments.find((x) => x && x.month === targetMonth && x.isPaid);
      if (!scheduleEntry) continue;

      scheduleEntry.isPaid = false;
      delete scheduleEntry.paidAt;

      loan.paidAmount = Math.max(0, Number(((Number(loan.paidAmount) || 0) - amount).toFixed(2)));
      loan.remainingAmount = Number(((Number(loan.remainingAmount) || 0) + amount).toFixed(2));
      if (loan.status === 'settled') {
        loan.status = 'active';
        delete loan.settledAt;
      }
      loansReversed = true;
      reversedLoanIds.add(String(loan.id));
    }
    // FR-1-D4: generation-time attribution reversal. Each attributed loan is
    // reversed by its exact recorded amount (partial installments included),
    // matched against a paid schedule entry of the batch month when present.
    for (const it of attributedItems) {
      for (const attr of (it.loanAttributions || [])) {
        const amount = Number(attr.amount) || 0;
        const loan = allLoans.find((l) => l && l.id === attr.loanId);
        if (!loan || !Array.isArray(loan.installments) || amount <= 0) continue;
        const byAmount = loan.installments.find((x) => x && x.month === targetMonth && x.isPaid && Math.abs(Number(x.amount || 0) - amount) < EPS);
        const scheduleEntry = byAmount || loan.installments.find((x) => x && x.month === targetMonth && x.isPaid);
        if (!scheduleEntry) continue;

        scheduleEntry.isPaid = false;
        delete scheduleEntry.paidAt;

        loan.paidAmount = Math.max(0, Number(((Number(loan.paidAmount) || 0) - amount).toFixed(2)));
        loan.remainingAmount = Number(((Number(loan.remainingAmount) || 0) + amount).toFixed(2));
        if (loan.status === 'settled') {
          loan.status = 'active';
          delete loan.settledAt;
        }
        loansReversed = true;
        reversedLoanIds.add(String(loan.id));
      }
    }

    // Delegate the paid → approved record mutation to the guarded engine
    // (payroll.cancelPayment + branch context + state, then the pure
    // full-return recorder). All validation pre-checks above already passed;
    // this is the single sanctioned engine path.
    const frRes = fullReturnPayrollBatchGuarded(user, batch, { by: actorName, reason, context });
    if (!frRes.ok) {
      return { ok: false, error: frRes.error, layer: frRes.layer, batch };
    }
    const updatedBatch = frRes.batch;

    try {
      storage.addPayrollBatch(updatedBatch);
      if (loansReversed) {
        persistLoansById(storage, allLoans.filter((l) => l && reversedLoanIds.has(String(l.id))), allLoans);
      }
      storage.addAudit('full_return', 'payroll', `${targetMonth} → fully returned: ${String(reason).trim()}`, updatedBatch.id);

      return {
        ok: true,
        batch: updatedBatch,
        loansReversed,
      };
    } catch (err) {
      try {
        restorePayrollById(storage, preBatch, originalPayrolls);
        if (loansReversed) restoreLoansById(storage, originalLoans, reversedLoanIds);
      } catch (rbErr) {
        console.error('Critical rollback error during payroll full return:', rbErr);
      }
      try {
        storage.addAudit(
          'full_return_rollback',
          'payroll',
          `${targetMonth} → rollback executed after failed full return: ${String(err && err.message)}`,
          batch.id
        );
      } catch (auditErr) {
        // Best-effort only — never mask the original write failure.
      }
      return {
        ok: false,
        layer: 'storage',
        error: err.message || 'storage_write_failure',
        rolledBack: true,
        batch,
      };
    }
  } finally {
    inFlightFullReturns.delete(key);
  }
}
