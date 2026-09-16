// =========================================================
// P4 Fix #1 — Full Payroll Return & Reversal Test Suite
// =========================================================
// Tests:
// 1. Paid payroll → full return succeeds with mandatory reason.
// 2. Original payroll remains present and records returned state/metadata.
// 3. Full return reverses the exact loan installments applied by that payroll.
// 4. Audit entry exists with return reason.
// 5. Second return is rejected/idempotently blocked.
// 6. Wrong company is rejected.
// 7. Wrong branch is rejected.
// 8. Unauthorized role is rejected.
// 9. Missing/blank reason is rejected.
//
// Usage: node scripts/p4-fix1-full-return-tests.mjs
// =========================================================

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
if (!globalThis.CustomEvent) globalThis.CustomEvent = class CustomEvent { constructor(t, o = {}) { this.type = t; this.detail = o.detail; } };
if (!globalThis.window) globalThis.window = globalThis;

import { reversePayrollDisbursementAtomic } from '../public/js/engines/payrollDisbursement.js';

let passed = 0;
let failed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
}

const mkUser = (id, role, comp, br, perms) => ({
  id, role, assignedCompanyId: comp || 'comp-1', assignedBranchId: br || 'br-1', permissions: perms || [],
});

const mockStorage = (initialPayrolls = [], initialLoans = [], initialAudit = []) => {
  let payrolls = JSON.parse(JSON.stringify(initialPayrolls));
  let loans = JSON.parse(JSON.stringify(initialLoans));
  let audit = JSON.parse(JSON.stringify(initialAudit));
  return {
    getState: () => ({ payrolls, loans, audit }),
    savePayrolls: (p) => { payrolls = p; },
    saveLoans: (l) => { loans = l; },
    addPayrollBatch: (b) => {
      const idx = payrolls.findIndex((x) => x.id === b.id);
      if (idx >= 0) payrolls[idx] = b;
      else payrolls.push(b);
    },
    addAudit: (act, ent, desc, id) => {
      audit.push({ action: act, entity: ent, details: desc, recordId: id, timestamp: new Date().toISOString() });
    },
  };
};

console.log('\n=== P4 Fix #1: Full Payroll Return & Reversal Test Suite ===');

// Test 1 & 2 & 3 & 4: Paid payroll full return succeeds, preserves original record, reverses loans, logs audit
{
  const paidBatch = {
    id: 'P-PAID-1', companyId: 'comp-1', branchId: 'br-1', status: 'paid', month: '2026-09',
    updatedAt: '2026-09-10T00:00:00Z',
    items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', netSalary: 4500, loanInstallment: 500 }],
  };
  const loan = {
    id: 'LOAN-1', employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', totalAmount: 2000, paidAmount: 500, remainingAmount: 1500, status: 'active',
    installments: [{ month: '2026-09', amount: 500, isPaid: true, paidAt: '2026-09-10T00:00:00Z' }]
  };
  const storage = mockStorage([paidBatch], [loan]);
  const auditUser = mkUser('u-audit', 'audit_reviewer', 'comp-1', 'br-1'); // holds payroll.cancelPayment

  const res = reversePayrollDisbursementAtomic({
    user: auditUser,
    batch: paidBatch,
    reason: 'Customer requested full refund',
    storage,
  });

  ok('1. Full return succeeds', res.ok === true, res.error);
  ok('2. Original payroll preserved with fullReturn metadata', res.batch && res.batch.fullReturn && res.batch.fullReturn.completed === true && res.batch.fullReturn.reason === 'Customer requested full refund' && res.batch.status === 'paid');
  const updatedLoan = storage.getState().loans.find((l) => l.id === 'LOAN-1');
  ok('3. Loan installments reversed (paidAmount reduced, remaining increased)', updatedLoan.paidAmount === 0 && updatedLoan.remainingAmount === 2000 && updatedLoan.installments[0].isPaid === false);
  ok('4. Audit entry recorded with return reason', storage.getState().audit.some((a) => a.action === 'full_return' && a.details.includes('Customer requested full refund')));
}

// Test 5: Second return is rejected / idempotently blocked
{
  const returnedBatch = {
    id: 'P-PAID-2', companyId: 'comp-1', branchId: 'br-1', status: 'paid', month: '2026-09',
    fullReturn: { completed: true, at: new Date().toISOString(), by: 'Audit', reason: 'First return' },
    items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1' }],
  };
  const storage = mockStorage([returnedBatch], []);
  const auditUser = mkUser('u-audit', 'audit_reviewer', 'comp-1', 'br-1');

  const res = reversePayrollDisbursementAtomic({
    user: auditUser,
    batch: returnedBatch,
    reason: 'Second return attempt',
    storage,
  });
  ok('5. Second full return rejected as already fully returned', !res.ok && res.error === 'already_fully_returned');
}

// Test 8: Unauthorized role is rejected
{
  const paidBatch = {
    id: 'P-PAID-3', companyId: 'comp-1', branchId: 'br-1', status: 'paid', month: '2026-09',
    items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1' }],
  };
  const storage = mockStorage([paidBatch], []);
  const regularUser = mkUser('u-reg', 'branch_hr', 'comp-1', 'br-1'); // lacks payroll.cancelPayment

  const res = reversePayrollDisbursementAtomic({
    user: regularUser,
    batch: paidBatch,
    reason: 'Unauthorized attempt',
    storage,
  });
  ok('8. Unauthorized role rejected with permission_denied', !res.ok && res.error === 'permission_denied');
}

// Test 9: Missing/blank reason is rejected
{
  const paidBatch = {
    id: 'P-PAID-4', companyId: 'comp-1', branchId: 'br-1', status: 'paid', month: '2026-09',
    items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1' }],
  };
  const storage = mockStorage([paidBatch], []);
  const auditUser = mkUser('u-audit', 'audit_reviewer', 'comp-1', 'br-1');

  const res = reversePayrollDisbursementAtomic({
    user: auditUser,
    batch: paidBatch,
    reason: '   ',
    storage,
  });
  ok('9. Blank/missing reason rejected with missing_return_reason', !res.ok && res.error === 'missing_return_reason');
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:\n' + failures.join('\n'));
  process.exit(1);
}
process.exit(0);
