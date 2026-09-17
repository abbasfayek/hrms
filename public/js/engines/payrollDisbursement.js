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

    // Snapshot original storage states for rollback
    const originalPayrolls = JSON.parse(JSON.stringify(storage.getState().payrolls || []));
    const originalLoans = JSON.parse(JSON.stringify(storage.getState().loans || []));

    // 2. Prepare loan mutations in memory (cloned state)
    const allLoans = JSON.parse(JSON.stringify(originalLoans));
    let loansChanged = false;
    const settledLoans = [];

    (paidBatch.items || []).forEach((it) => {
      const installment = Number(it.loanInstallment) || 0;
      if (installment <= 0) return;
      const loan = allLoans.find((l) => l.employeeId === it.employeeId && l.status !== 'settled' && Number(l.remainingAmount) > 0);
      if (!loan) return;
      const paidAmount = Math.min(installment, Number(loan.remainingAmount) || 0);
      if (paidAmount <= 0) return;

      loan.installments = loan.installments || [];
      const scheduleEntry = loan.installments.find((x) => x.month === targetMonth && !x.isPaid);
      if (scheduleEntry) {
        scheduleEntry.isPaid = true;
        scheduleEntry.paidAt = new Date().toISOString();
      } else {
        loan.installments.push({
          month: targetMonth,
          amount: paidAmount,
          isPaid: true,
          paidAt: new Date().toISOString(),
        });
      }
      loan.paidAmount = Number(((Number(loan.paidAmount) || 0) + paidAmount).toFixed(2));
      loan.remainingAmount = Number((Number(loan.remainingAmount) - paidAmount).toFixed(2));
      if (loan.remainingAmount <= 0) {
        loan.remainingAmount = 0;
        loan.status = 'settled';
        loan.settledAt = new Date().toISOString();
      }
      // Stamp the item with the EXACT loan + amount that was actually settled
      // (a partial installment lands here as the true deducted amount). The
      // full-return reversal uses these stamps to reverse precisely.
      it.loanId = loan.id;
      it.loanDeductedAmount = paidAmount;
      loansChanged = true;
      settledLoans.push({
        loanId: loan.id,
        employeeId: it.employeeId,
        installmentPaid: paidAmount,
        remainingAmount: loan.remainingAmount,
        status: loan.status,
      });
    });

    // Finalize batch metadata
    paidBatch.releasedAt = new Date().toISOString();
    paidBatch.releasedBy = actorName;
    (paidBatch.items || []).forEach((it) => { it.isPaid = true; });

    // 3. Atomic persistence with rollback
    try {
      if (simulateFailure === 'before_batch_write') {
        throw new Error('simulated_failure_before_batch_write');
      }

      // Step A: Save payroll batch
      storage.addPayrollBatch(paidBatch);

      if (simulateFailure === 'before_loan_write') {
        throw new Error('simulated_failure_before_loan_write');
      }

      // Step B: Save loans if changed
      if (loansChanged) {
        storage.saveLoans(allLoans);
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
      // Rollback both payroll and loans back to initial state
      try {
        storage.savePayrolls(originalPayrolls);
        if (loansChanged) {
          storage.saveLoans(originalLoans);
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

    const originalPayrolls = JSON.parse(JSON.stringify(storage.getState().payrolls || []));
    const originalLoans = JSON.parse(JSON.stringify(storage.getState().loans || []));

    const allLoans = JSON.parse(JSON.stringify(originalLoans));
    let loansReversed = false;

    (batch.items || []).forEach((it) => {
      // Precise reversal: items stamped during disbursement carry the EXACT
      // loan + amount that was actually settled (partial installments land
      // here exactly). Legacy items (no metadata) fall back to the first
      // matching paid schedule entry by month via loanInstallment.
      if (it && it.loanId && Number(it.loanDeductedAmount) > 0) {
        const amount = Number(it.loanDeductedAmount) || 0;
        const loan = allLoans.find((l) => l && l.id === it.loanId);
        if (!loan || !Array.isArray(loan.installments) || amount <= 0) return;
        const byAmount = loan.installments.find((x) => x && x.month === targetMonth && x.isPaid && Math.abs(Number(x.amount || 0) - amount) < 0.0001);
        const scheduleEntry = byAmount || loan.installments.find((x) => x && x.month === targetMonth && x.isPaid);
        if (!scheduleEntry) return;

        scheduleEntry.isPaid = false;
        delete scheduleEntry.paidAt;

        loan.paidAmount = Math.max(0, Number(((Number(loan.paidAmount) || 0) - amount).toFixed(2)));
        loan.remainingAmount = Number(((Number(loan.remainingAmount) || 0) + amount).toFixed(2));
        if (loan.status === 'settled') {
          loan.status = 'active';
          delete loan.settledAt;
        }
        loansReversed = true;
        return;
      }

      const installment = Number(it.loanInstallment) || 0;
      if (installment <= 0) return;
      const loan = allLoans.find((l) => l.employeeId === it.employeeId);
      if (!loan || !Array.isArray(loan.installments)) return;
      const scheduleEntry = loan.installments.find((x) => x.month === targetMonth && x.isPaid);
      if (!scheduleEntry) return;

      scheduleEntry.isPaid = false;
      delete scheduleEntry.paidAt;

      loan.paidAmount = Math.max(0, Number(((Number(loan.paidAmount) || 0) - installment).toFixed(2)));
      loan.remainingAmount = Number(((Number(loan.remainingAmount) || 0) + installment).toFixed(2));
      if (loan.status === 'settled') {
        loan.status = 'active';
        delete loan.settledAt;
      }
      loansReversed = true;
    });

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
        storage.saveLoans(allLoans);
      }
      storage.addAudit('full_return', 'payroll', `${targetMonth} → fully returned: ${String(reason).trim()}`, updatedBatch.id);

      return {
        ok: true,
        batch: updatedBatch,
        loansReversed,
      };
    } catch (err) {
      try {
        storage.savePayrolls(originalPayrolls);
        if (loansReversed) storage.saveLoans(originalLoans);
      } catch (rbErr) {
        console.error('Critical rollback error during payroll full return:', rbErr);
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
