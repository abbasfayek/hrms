// ==========================================
// EOSB Disbursement Engine — Phase 10 Readiness (F-02)
// ==========================================
// Ensures atomic End-of-Service (EOSB) disbursement and loan settlement:
// 1. Guarded transition to 'paid' MUST succeed before any loan mutations.
// 2. All outstanding active loans for the employee are settled with full metadata:
//    - outstanding amount before settlement
//    - amount settled from EOSB
//    - settlement date
//    - EOSB/payment reference
//    - final status = 'settled'
//    - audit trail
// 3. Complete atomic rollback if any storage write fails during disbursement.
// 4. In-flight concurrency lock to prevent double-processing.
// ==========================================

import { transitionEosbGuarded } from './eosbAccess.js';

// In-flight tracking to prevent concurrent / duplicate disbursements
const inFlightEosbDisbursements = new Set();

export function isEosbDisbursementInFlight(recordId) {
  return inFlightEosbDisbursements.has(recordId);
}

/**
 * Executes EOSB disbursement and loan settlement atomically.
 *
 * @param {Object} params
 * @param {Object} params.user - Current acting user
 * @param {Object} params.record - EOSB settlement record to disburse
 * @param {Object} params.storage - Storage instance
 * @param {string} [params.by] - Actor name
 * @param {string} [params.simulateFailure] - Hook for rollback testing ('before_eosb_write', 'before_loan_write', 'after_writes')
 * @returns {Object} { ok: boolean, error?: string, layer?: string, batch?: Object, settledLoans?: Array, rolledBack?: boolean }
 */
export function disburseEosbAtomic({
  user,
  record,
  storage,
  by,
  simulateFailure = null,
} = {}) {
  if (!record || typeof record !== 'object') {
    return { ok: false, error: 'invalid_record', layer: 'validation' };
  }
  if (!storage || typeof storage.getState !== 'function') {
    return { ok: false, error: 'invalid_storage', layer: 'system' };
  }

  const recordId = String(record.id || '');
  if (inFlightEosbDisbursements.has(recordId)) {
    return { ok: false, error: 'disbursement_in_progress', layer: 'concurrency' };
  }
  inFlightEosbDisbursements.add(recordId);

  try {
    const actorName = by || user?.name || user?.username || 'Finance Officer';

    // 1. First: Guarded transition to 'paid' MUST pass
    const res = transitionEosbGuarded(user, record, 'paid', { reason: 'disbursed', by: actorName });
    if (!res.ok) {
      return {
        ok: false,
        layer: res.layer,
        error: res.error,
        batch: res.batch || record,
      };
    }

    const paidRecord = res.batch;
    const settlementDate = new Date().toISOString();
    const settlementRef = String(paidRecord.id || recordId);

    // Snapshot original storage states for rollback
    const originalEosbList = JSON.parse(JSON.stringify(storage.getState().eosb || []));
    const originalLoans = JSON.parse(JSON.stringify(storage.getState().loans || []));

    // 2. Prepare loan settlements in memory (cloned state)
    const allLoans = JSON.parse(JSON.stringify(originalLoans));
    let loansChanged = false;
    const settledLoans = [];
    const loanAuditEvents = [];

    // Find all outstanding active loans for this employee
    allLoans.forEach((loan) => {
      if (loan.employeeId === paidRecord.employeeId && loan.status !== 'settled' && Number(loan.remainingAmount) > 0) {
        const outstandingBefore = Number(loan.remainingAmount) || 0;
        const amountSettled = outstandingBefore;

        loan.outstandingAmountBeforeSettlement = outstandingBefore;
        loan.amountSettledFromEOSB = amountSettled;
        loan.settlementDate = settlementDate;
        loan.settlementReference = settlementRef;
        loan.settledByEosbId = settlementRef;
        loan.status = 'settled';
        loan.remainingAmount = 0;
        loan.paidAmount = Number(((Number(loan.paidAmount) || 0) + amountSettled).toFixed(2));
        loan.settledAt = settlementDate;

        loan.installments = loan.installments || [];
        loan.installments.push({
          type: 'eosb_settlement',
          month: paidRecord.terminationDate ? paidRecord.terminationDate.slice(0, 7) : settlementDate.slice(0, 7),
          amount: amountSettled,
          isPaid: true,
          paidAt: settlementDate,
          reference: settlementRef,
          outstandingBefore,
          notes: `Settled in full via Final EOSB Settlement ${settlementRef}`,
        });

        loansChanged = true;
        settledLoans.push({
          loanId: loan.id,
          employeeId: loan.employeeId,
          outstandingBefore,
          amountSettled,
          settlementDate,
          settlementReference: settlementRef,
          status: 'settled',
        });

        loanAuditEvents.push({
          action: 'settle',
          entity: 'loans',
          details: `Loan ${loan.id} settled via EOSB ${settlementRef} (settled: ${amountSettled}, outstanding was: ${outstandingBefore})`,
          id: loan.id,
        });
      }
    });

    // 3. Atomic persistence with complete rollback
    try {
      if (simulateFailure === 'before_eosb_write') {
        throw new Error('simulated_failure_before_eosb_write');
      }

      // Step A: Persist EOSB
      storage.persistEosb(paidRecord);

      if (simulateFailure === 'before_loan_write') {
        throw new Error('simulated_failure_before_loan_write');
      }

      // Step B: Persist Loans if changed
      if (loansChanged) {
        storage.saveLoans(allLoans);
      }

      if (simulateFailure === 'after_writes') {
        throw new Error('simulated_failure_after_writes');
      }

      // Step C: Audit logs
      storage.addAudit(
        'settle',
        'eosb',
        `${paidRecord.employeeName || 'Employee'} — ${paidRecord.netSettlementAmount} paid out`,
        settlementRef
      );

      loanAuditEvents.forEach((evt) => {
        storage.addAudit(evt.action, evt.entity, evt.details, evt.id);
      });

      return {
        ok: true,
        batch: paidRecord,
        settledLoans,
        loansChanged,
      };
    } catch (writeErr) {
      // Rollback both EOSB and loans to pristine initial state
      try {
        storage.saveEOSB(originalEosbList);
        if (loansChanged) {
          storage.saveLoans(originalLoans);
        }
      } catch (rbErr) {
        console.error('Critical rollback error during EOSB disbursement:', rbErr);
      }
      return {
        ok: false,
        layer: 'storage',
        error: writeErr.message || 'storage_write_failure',
        rolledBack: true,
        batch: record,
      };
    }
  } finally {
    inFlightEosbDisbursements.delete(recordId);
  }
}

/**
 * Cancels EOSB payment atomically, reverting loans if they were settled by this EOSB.
 *
 * @param {Object} params
 * @param {Object} params.user - Current acting user
 * @param {Object} params.record - EOSB settlement record to cancel payment for
 * @param {Object} params.storage - Storage instance
 * @param {string} [params.by] - Actor name
 * @returns {Object} { ok: boolean, error?: string, batch?: Object }
 */
export function cancelEosbPaymentAtomic({
  user,
  record,
  storage,
  by,
} = {}) {
  if (!record || typeof record !== 'object') {
    return { ok: false, error: 'invalid_record', layer: 'validation' };
  }
  if (!storage || typeof storage.getState !== 'function') {
    return { ok: false, error: 'invalid_storage', layer: 'system' };
  }

  const actorName = by || user?.name || user?.username || 'Finance Officer';
  const res = transitionEosbGuarded(user, record, 'approved', { reason: 'cancel_payment', by: actorName });
  if (!res.ok) {
    return { ok: false, layer: res.layer, error: res.error, batch: res.batch || record };
  }

  const originalEosbList = JSON.parse(JSON.stringify(storage.getState().eosb || []));
  const originalLoans = JSON.parse(JSON.stringify(storage.getState().loans || []));

  const allLoans = JSON.parse(JSON.stringify(originalLoans));
  let loansChanged = false;
  const recordId = String(record.id || '');

  allLoans.forEach((loan) => {
    if (loan.employeeId === record.employeeId && (loan.settledByEosbId === recordId || loan.settlementReference === recordId)) {
      const restoredOutstanding = Number(loan.outstandingAmountBeforeSettlement) || Number(loan.amountSettledFromEOSB) || 0;
      loan.status = 'active';
      loan.remainingAmount = restoredOutstanding;
      loan.paidAmount = Number(((Number(loan.paidAmount) || 0) - (Number(loan.amountSettledFromEOSB) || 0)).toFixed(2));
      delete loan.settledByEosbId;
      delete loan.settlementReference;
      delete loan.outstandingAmountBeforeSettlement;
      delete loan.amountSettledFromEOSB;
      delete loan.settlementDate;
      delete loan.settledAt;

      // Remove the eosb_settlement installment
      if (Array.isArray(loan.installments)) {
        loan.installments = loan.installments.filter((inst) => inst.type !== 'eosb_settlement' || inst.reference !== recordId);
      }
      loansChanged = true;
    }
  });

  try {
    storage.persistEosb(res.batch);
    if (loansChanged) {
      storage.saveLoans(allLoans);
    }
    storage.addAudit(
      'cancel_payment',
      'eosb',
      `${record.employeeName} — payment cancelled, returned to approved`,
      record.id
    );
    return { ok: true, batch: res.batch, loansChanged };
  } catch (err) {
    try {
      storage.saveEOSB(originalEosbList);
      if (loansChanged) storage.saveLoans(originalLoans);
    } catch (rbErr) {}
    return { ok: false, layer: 'storage', error: err.message, rolledBack: true, batch: record };
  }
}
