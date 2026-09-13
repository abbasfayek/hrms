// ==========================================
// Payroll Helper Utilities (No DOM Dependencies)
// ==========================================
// Pure logic helpers that can be safely imported in Node.js
// test environments without triggering browser-only APIs.

/**
 * SSOT: Determine if a payroll batch has undergone a completed full return.
 * This is the single source of truth used by PayrollView, FullReturnModal,
 * and all test suites.
 *
 * @param {object} batch - Payroll batch object from storage
 * @returns {boolean}
 */
export function isBatchFullyReturned(batch) {
  if (!batch) return false;
  return batch.fullReturnState === 'fully_returned' || Boolean(batch.fullReturn?.completed);
}
