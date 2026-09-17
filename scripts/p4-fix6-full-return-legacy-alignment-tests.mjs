// =========================================================
// P4 Fix #6 — Full Return Legacy Paths Alignment Test Suite
// =========================================================
// Verifies every Full Return UI entry point converges on the official
// structured flow (reversePayrollDisbursementAtomic) and that NO reachable
// Full Return path can delete a payroll via storage.deletePayrollBatch.
//
// Usage: node scripts/p4-fix6-full-return-legacy-alignment-tests.mjs
// =========================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
if (!globalThis.window) globalThis.window = globalThis;

import { reversePayrollDisbursementAtomic } from '../public/js/engines/payrollDisbursement.js';

const viewPath = fileURLToPath(new URL('../public/js/components/PayrollView.js', import.meta.url));
const storagePath = fileURLToPath(new URL('../public/js/storage.js', import.meta.url));
let VIEW = '';
let STORAGE = '';
try {
  VIEW = readFileSync(viewPath, 'utf8');
  STORAGE = readFileSync(storagePath, 'utf8');
} catch (e) {
  console.error('Could not read source files:', e.message);
  process.exit(2);
}

let passed = 0;
let failed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
}

const mkUser = (id, role, perms) => ({ id, role, permissions: perms || [] });

const mockStorage = (initialPayrolls = [], initialLoans = [], initialAudit = []) => {
  const state = { payrolls: JSON.parse(JSON.stringify(initialPayrolls)), loans: JSON.parse(JSON.stringify(initialLoans)), audit: JSON.parse(JSON.stringify(initialAudit)) };
  const original = JSON.stringify(state);
  const snapshot = () => ({ payrolls: JSON.parse(JSON.stringify(state.payrolls)), loans: JSON.parse(JSON.stringify(state.loans)), audit: JSON.parse(JSON.stringify(state.audit)) });
  return {
    snapshot,
    equalsOriginal: () => JSON.stringify(snapshot()) === original,
    getState: () => state,
    savePayrolls: (p) => { state.payrolls = p; },
    saveLoans: (l) => { state.loans = l; },
    addPayrollBatch: (b) => {
      const idx = state.payrolls.findIndex((x) => x.id === b.id);
      if (idx >= 0) state.payrolls[idx] = b; else state.payrolls.push(b);
    },
    addAudit: (action, entity, details, recordId) => { state.audit.push({ action, entity, details, recordId, timestamp: new Date().toISOString() }); },
  };
};

console.log('\n=== P4 Fix #6: Full Return Legacy Paths Alignment ===');

// ---- Source-level: no destructive left path ----
{
  ok('1. PayrollView no longer references performPayrollFullReturn', !VIEW.includes('performPayrollFullReturn'));
  ok('2. PayrollView no longer references storage.deletePayrollBatch', !VIEW.includes('deletePayrollBatch'));
  ok('3. Shared runFullReturnFlow helper is defined once', (VIEW.match(/const runFullReturnFlow = /g) || []).length === 1);
  ok('4. runFullReturnFlow calls the structured engine', VIEW.includes('reversePayrollDisbursementAtomic({'));
  ok('5. runFullReturnFlow opens the mandatory-reason modal', VIEW.includes('openPayrollFullReturnModal({'));
  ok('6. runFullReturnFlow uses getPayrollBranchContext (defined), not undefined getBranchContext', !VIEW.includes('getBranchContext(') && VIEW.includes('context: getPayrollBranchContext(),'));
  ok('7. Disbursed .btn-full-return-batch handler routes to runFullReturnFlow', /btn-full-return-batch/.test(VIEW) && VIEW.includes('runFullReturnFlow(b);'));
  ok('8. Corrections #btn-quick-full-return handler routes to runFullReturnFlow', /btn-quick-full-return/.test(VIEW) && VIEW.includes('runFullReturnFlow(batch);'));
  ok('9. Main #btn-full-return-main also delegates to runFullReturnFlow (full convergence)', /btn-full-return-main/.test(VIEW) && VIEW.includes('runFullReturnFlow(currentBatch, { goToReturnedTab: true });'));
  ok('10. All three Full Return entry points reference the SAME single helper', (VIEW.match(/runFullReturnFlow\(/g) || []).length >= 3);
}

// ---- Source-level: authorization alignment ----
{
  ok('11. UI grant for Full Return uses payroll.cancelPayment', VIEW.includes("can(state.currentUser, 'payroll.cancelPayment')") && VIEW.includes('const canCancelPayment ='));
  const gates = (VIEW.match(/canCancelPayment \? `/g) || []).length;
  ok(`13. ${gates} Full Return button render gates use canCancelPayment (>= 3 expected)`, gates >= 3);
}

// ---- Source-level: no unrelated deletion workflow changed ----
{
  ok('14. deletePayrollBatch has NO callers outside its own definition', (STORAGE.match(/deletePayrollBatch/g) || []).length === 1 && STORAGE.includes('deletePayrollBatch(batchId) {'));
  const archiveHandlers = VIEW.match(/btn-archive-paid-batch[\s\S]*?addEventListener[\s\S]*?archivePayrollBatchGuarded/g);
  ok('15. Archive workflow still uses archivePayrollBatchGuarded (unchanged, not deletePayrollBatch)', !!archiveHandlers && VIEW.includes('archivePayrollBatchGuarded(state.currentUser'));
}

// ---- Runtime engine: official structured return behavior (Fix #1 baseline) ----
{
  const paidBatch = {
    id: 'P-PAID-1', companyId: 'comp-1', branchId: 'br-1', status: 'paid', month: '2026-09',
    updatedAt: '2026-09-10T00:00:00Z',
    items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', netSalary: 4500, loanInstallment: 500 }],
  };
  const loanA = {
    id: 'LOAN-1', employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', totalAmount: 2000, paidAmount: 500, remainingAmount: 1500, status: 'active',
    installments: [{ month: '2026-09', amount: 500, isPaid: true, paidAt: '2026-09-10T00:00:00Z' }],
  };
  const loanB = {
    id: 'LOAN-2', employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', totalAmount: 1000, paidAmount: 1000, remainingAmount: 0, status: 'settled',
    installments: [{ month: '2026-10', amount: 500, isPaid: true, paidAt: '2026-10-10T00:00:00Z' }, { month: '2026-10', amount: 500, isPaid: true, paidAt: '2026-10-10T00:00:00Z' }],
  };
  const authUser = mkUser('u-audit', 'audit_reviewer', ['payroll.cancelPayment']);
  const regularUser = mkUser('u-reg', 'company_hr', ['payroll.correction.create']); // NOT cancelPayment

  const storage1 = mockStorage([paidBatch], [loanA, loanB]);

  const blankRes = reversePayrollDisbursementAtomic({ user: authUser, batch: paidBatch, reason: '   ', storage: storage1 });
  ok('16. Blank reason rejected (missing_return_reason)', !blankRes.ok && blankRes.error === 'missing_return_reason');
  ok('16b. Rejected blank reason leaves data untouched', storage1.equalsOriginal());

  const deniedRes = reversePayrollDisbursementAtomic({ user: regularUser, batch: paidBatch, reason: 'Customer refund', storage: storage1 });
  ok('17. payroll.correction.create alone is NOT sufficient (permission_denied)', !deniedRes.ok && deniedRes.error === 'permission_denied');
  ok('17b. Denied attempt leaves data untouched', storage1.equalsOriginal());

  const res = reversePayrollDisbursementAtomic({ user: authUser, batch: paidBatch, reason: 'Customer requested full refund', storage: storage1 });
  ok('18. payroll.cancelPayment holder: structured return succeeds', res.ok === true, res.error);

  const afterPayrolls = storage1.getState().payrolls;
  const afterLoanA = storage1.getState().loans.find((l) => l.id === 'LOAN-1');
  const afterLoanB = storage1.getState().loans.find((l) => l.id === 'LOAN-2');

  ok('19. Original payroll remains persisted (status paid, fullReturn completed)', afterPayrolls.length === 1 && afterPayrolls[0].id === 'P-PAID-1' && afterPayrolls[0].status === 'paid' && afterPayrolls[0].fullReturn?.completed === true);
  ok('20. fullReturn metadata persisted (at/by/reason/previousStatus)', afterPayrolls[0].fullReturn?.at && afterPayrolls[0].fullReturn?.by && afterPayrolls[0].fullReturn?.reason === 'Customer requested full refund' && afterPayrolls[0].fullReturn?.previousStatus === 'paid');
  ok('21. full_return audit event created with reason', storage1.getState().audit.some((a) => a.action === 'full_return' && a.details.includes('Customer requested full refund')));
  ok('22. Exact loan installment for the payroll month reversed (paidAmount 0 / remaining 2000)', afterLoanA.paidAmount === 0 && afterLoanA.remainingAmount === 2000 && afterLoanA.installments[0].isPaid === false && afterLoanA.installments[0].paidAt === undefined);
  ok('23. Unrelated loan (different month) NOT touched', afterLoanB.paidAmount === 1000 && afterLoanB.remainingAmount === 0 && afterLoanB.status === 'settled');
  ok('24. Loan with no matching installment is NOT reversed', afterLoanB.installments.every((x) => x.isPaid === true));

  const dupRes = reversePayrollDisbursementAtomic({ user: authUser, batch: storage1.getState().payrolls[0], reason: 'Second attempt', storage: storage1 });
  ok('25. Duplicate full return remains blocked (already_fully_returned)', !dupRes.ok && dupRes.error === 'already_fully_returned');

  const batchNotPaid = mockStorage([{ ...paidBatch, status: 'approved' }], [loanA]);
  const notPaidRes = reversePayrollDisbursementAtomic({ user: authUser, batch: { ...paidBatch, status: 'approved' }, reason: 'x', storage: batchNotPaid });
  ok('26. Non-paid batch cannot be returned (batch_not_paid)', !notPaidRes.ok && notPaidRes.error === 'batch_not_paid');
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:\n' + failures.join('\n'));
  process.exit(1);
}
process.exit(0);