// =========================================================
// P18 — FR-1-D4: Disbursement Attribute-Integrity & Scope Isolation
// =========================================================
// Closes two confirmed CRITICAL payroll financial defects:
//   CRIT-1  scoped getState() snapshot + whole-array write-back could
//           silently delete every OUT-OF-SCOPE loan/payroll of a company or
//           branch (and of a standalone/offline deployment).
//   CRIT-2  forward disbursement settled an item's deduction against "the
//           first warm loan for this employee" instead of the loan(s) that
//           actually generated the deduction.
//
// Required cases (D4-01 … D4-15): deterministic-only settlement, every
// fail-closed refusal code, byte-for-byte out-of-scope preservation on
// success/rollback, partial-deduction capping, generation-time attribution,
// and a round-trip proving the D1 reversal hardening was not weakened.
//
// Usage: node scripts/p18-d4-disbursement-attribute-integrity-tests.mjs
// =========================================================

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JS = `file:///${path.resolve(__dirname, '../public/js').replace(/\\/g, '/')}/`;

const mockStore = new Map();
globalThis.localStorage = {
  getItem(k) { return mockStore.has(k) ? mockStore.get(k) : null; },
  setItem(k, v) { mockStore.set(k, String(v)); },
  removeItem(k) { mockStore.delete(k); },
  clear() { mockStore.clear(); },
};

const { storage } = await import(`${JS}storage.js`);
const { disbursePayrollAtomic, reversePayrollDisbursementAtomic } = await import(`${JS}engines/payrollDisbursement.js`);
const { generateMonthlyPayroll } = await import(`${JS}engines/payrollEngine.js`);

let passed = 0;
let total = 0;
function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}
const json = (o) => JSON.stringify(o);

const OFFICER = {
  id: 'u-officer-1', name: 'Officer One', role: 'payments_officer',
  permissions: ['payroll.disburse'], assignedCompanyId: 'comp-1', assignedBranchId: 'br-1',
};
const SUP = { id: 'u-sup-1', name: 'System Admin', role: 'super_admin', permissions: [] };

const COMPANIES = [
  { id: 'comp-1', name: 'Company One', branches: [{ id: 'br-1', name: 'Branch One' }] },
  { id: 'comp-2', name: 'Company Two', branches: [{ id: 'br-2', name: 'Branch Two' }] },
];
const EMPLOYEES = [
  { id: 'emp-1', fullName: 'Emp One', companyId: 'comp-1', branchId: 'br-1', status: 'active' },
  { id: 'emp-2', fullName: 'Emp Two', companyId: 'comp-2', branchId: 'br-2', status: 'active' },
];

const mkLoan = (over) => ({
  id: 'LOAN-1', employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', currency: 'USD',
  totalAmount: 2000, paidAmount: 500, remainingAmount: 1500, status: 'active', installments: [],
  ...(over || {}),
});

const mkBatch = (over) => ({
  id: 'PAY-D4-2026-09', month: '2026-09', companyId: 'comp-1', branchId: 'br-1', status: 'approved',
  items: [
    {
      employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 5000, netSalary: 4500,
      loanInstallment: 500, isPaid: false,
    },
  ],
  auditHistory: [
    { action: 'create', from: 'draft', to: 'draft' },
    { action: 'submit', from: 'draft', to: 'under_audit' },
    { action: 'approve', from: 'under_audit', to: 'approved' },
  ],
  ...(over || {}),
});

function seed({ loans, payrolls, companies = COMPANIES, employees = EMPLOYEES }) {
  storage.saveUsers([OFFICER, SUP]);
  storage.saveCompanies(companies);
  storage.saveEmployees(employees);
  storage.setActiveUser(OFFICER.id);
  storage.savePayrolls(payrolls || []);
  storage.saveLoans(loans);
}

console.log('\n--- P18 FR-1-D4: Disbursement Attribute-Integrity & Scope Isolation ---');

// ---------------------------------------------------------------------------
// D4-01 (CRIT-2): attributed loan belongs to a DIFFERENT employee — refused
// ---------------------------------------------------------------------------
test('D4-01 foreign-employee attribution refused (attribution_employee_mismatch), zero writes', () => {
  const loan = mkLoan({ employeeId: 'emp-2', companyId: 'comp-1', branchId: 'br-1', currency: 'USD', installments: [{ month: '2026-09', amount: 500, isPaid: false }] });
  const batch = mkBatch({ items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 5000, netSalary: 4500, loanInstallment: 500, loanAttributions: [{ loanId: 'LOAN-1', amount: 500, month: '2026-09' }] }] });
  seed({ loans: [loan], payrolls: [batch] });
  const res = disbursePayrollAtomic({ user: OFFICER, batch, storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Officer One' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'attribution_employee_mismatch');
  const stored = storage.getState().payrolls.find((b) => b.id === batch.id);
  assert.equal(stored.status, 'approved', 'batch must remain approved');
  const storedLoan = storage.getState().loans.find((l) => l.id === 'LOAN-1');
  assert.equal(storedLoan.remainingAmount, 1500);
  assert.ok(!storedLoan.installments.find((x) => x.isPaid), 'no installment may be paid');
});

// ---------------------------------------------------------------------------
// D4-02 (CRIT-2): exact attributed loan is settled — never the first warm loan
// ---------------------------------------------------------------------------
test('D4-02 settlement hits the attributed loan exactly, the other warm loan untouched', () => {
  const loanX = mkLoan({ id: 'LOAN-X', employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', currency: 'USD', remainingAmount: 1000, paidAmount: 0, installments: [{ month: '2026-09', amount: 500, isPaid: false }] });
  const loanY = mkLoan({ id: 'LOAN-Y', employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', currency: 'USD', remainingAmount: 800, paidAmount: 0, installments: [{ month: '2026-09', amount: 250, isPaid: false }] });
  const batch = mkBatch({ items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 5000, netSalary: 4500, loanInstallment: 250, loanAttributions: [{ loanId: 'LOAN-Y', amount: 250, month: '2026-09' }] }] });
  seed({ loans: [loanX, loanY], payrolls: [batch] });
  const res = disbursePayrollAtomic({ user: OFFICER, batch, storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Officer One' });
  assert.equal(res.ok, true, json(res && res.error));
  assert.equal(res.batch.items[0].loanId, 'LOAN-Y');
  assert.equal(res.batch.items[0].loanDeductedAmount, 250);
  const x = storage.getRawLoans().find((l) => l.id === 'LOAN-X');
  const y = storage.getRawLoans().find((l) => l.id === 'LOAN-Y');
  assert.equal(x.remainingAmount, 1000, 'LOAN-X (first warm loan) MUST be untouched');
  assert.equal(x.paidAmount, 0);
  assert.equal(y.remainingAmount, 550, 'LOAN-Y must be reduced by exactly 250');
  assert.equal(y.paidAmount, 250);
  assert.equal(y.installments.find((i) => i.month === '2026-09').isPaid, true);
});

// ---------------------------------------------------------------------------
// D4-03 (CRIT-2): a deduction with NO attribution is refused fail-closed
// ---------------------------------------------------------------------------
test('D4-03 unattributable deduction refused (unattributable_loan_deduction), zero writes', () => {
  const loan = mkLoan({ installments: [{ month: '2026-09', amount: 500, isPaid: false }] });
  const batch = mkBatch({ items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 5000, netSalary: 4500, loanInstallment: 500 }] });
  seed({ loans: [loan], payrolls: [batch] });
  const res = disbursePayrollAtomic({ user: OFFICER, batch, storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Officer One' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'unattributable_loan_deduction');
  assert.equal(storage.getState().payrolls.find((b) => b.id === batch.id).status, 'approved');
  assert.equal(storage.getRawLoans().find((l) => l.id === 'LOAN-1').remainingAmount, 1500);
});

// ---------------------------------------------------------------------------
// D4-04 (CRIT-2): attributed loan id does not exist — refused
// ---------------------------------------------------------------------------
test('D4-04 nonexistent attributed loan refused (attribution_loan_not_found), zero writes', () => {
  const loan = mkLoan({ installments: [{ month: '2026-09', amount: 500, isPaid: false }] });
  const batch = mkBatch({ items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 5000, netSalary: 4500, loanInstallment: 500, loanAttributions: [{ loanId: 'LOAN-GHOST', amount: 500, month: '2026-09' }] }] });
  seed({ loans: [loan], payrolls: [batch] });
  const res = disbursePayrollAtomic({ user: OFFICER, batch, storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Officer One' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'attribution_loan_not_found');
  assert.equal(storage.getRawLoans().find((l) => l.id === 'LOAN-1').remainingAmount, 1500);
});

// ---------------------------------------------------------------------------
// D4-05 (scope): attributed loan of ANOTHER company never settled by comp-1 item
// ---------------------------------------------------------------------------
test('D4-05 cross-company attribution refused (attribution_company_mismatch), zero writes', () => {
  const comp2Loan = mkLoan({ id: 'LOAN-C2', employeeId: 'emp-1', companyId: 'comp-2', branchId: 'br-2', currency: 'USD', remainingAmount: 900, paidAmount: 0, installments: [{ month: '2026-09', amount: 500, isPaid: false }] });
  const batch = mkBatch({ items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 5000, netSalary: 4500, loanInstallment: 500, loanAttributions: [{ loanId: 'LOAN-C2', amount: 500, month: '2026-09' }] }] });
  seed({ loans: [comp2Loan], payrolls: [batch] });
  const res = disbursePayrollAtomic({ user: OFFICER, batch, storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Officer One' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'attribution_company_mismatch');
  assert.equal(storage.getRawLoans().find((l) => l.id === 'LOAN-C2').remainingAmount, 900);
});

// ---------------------------------------------------------------------------
// D4-06 (scope): attributed loan of ANOTHER branch never settled
// ---------------------------------------------------------------------------
test('D4-06 cross-branch attribution refused (attribution_branch_mismatch), zero writes', () => {
  const loanBr2 = mkLoan({ id: 'LOAN-BR2', employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-2', currency: 'USD', remainingAmount: 700, paidAmount: 0, installments: [{ month: '2026-09', amount: 500, isPaid: false }] });
  const batch = mkBatch({ items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 5000, netSalary: 4500, loanInstallment: 500, loanAttributions: [{ loanId: 'LOAN-BR2', amount: 500, month: '2026-09' }] }] });
  seed({ loans: [loanBr2], payrolls: [batch] });
  const res = disbursePayrollAtomic({ user: OFFICER, batch, storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Officer One' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'attribution_branch_mismatch');
  assert.equal(storage.getRawLoans().find((l) => l.id === 'LOAN-BR2').remainingAmount, 700);
});

// ---------------------------------------------------------------------------
// D4-07 (currency integrity): a deduction may never settle a different-currency loan
// ---------------------------------------------------------------------------
test('D4-07 USD item cannot settle an IQD loan (attribution_currency_mismatch), zero writes', () => {
  const iqdLoan = mkLoan({ id: 'LOAN-IQD', employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', currency: 'IQD', remainingAmount: 700000, paidAmount: 0, installments: [{ month: '2026-09', amount: 500000, isPaid: false }] });
  const batch = mkBatch({ items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 5000, netSalary: 4500, currency: 'USD', loanInstallment: 500, loanAttributions: [{ loanId: 'LOAN-IQD', amount: 500, month: '2026-09', currency: 'IQD' }] }] });
  seed({ loans: [iqdLoan], payrolls: [batch] });
  const res = disbursePayrollAtomic({ user: OFFICER, batch, storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Officer One' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'attribution_currency_mismatch');
  assert.equal(storage.getRawLoans().find((l) => l.id === 'LOAN-IQD').remainingAmount, 700000);
});

// ---------------------------------------------------------------------------
// D4-08 (month integrity): attribution must target the batch month
// ---------------------------------------------------------------------------
test('D4-08 off-month attribution refused (attribution_month_mismatch), zero writes', () => {
  const loan = mkLoan({ installments: [{ month: '2026-09', amount: 500, isPaid: false }] });
  const batch = mkBatch({ items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 5000, netSalary: 4500, loanInstallment: 500, loanAttributions: [{ loanId: 'LOAN-1', amount: 500, month: '2026-08' }] }] });
  seed({ loans: [loan], payrolls: [batch] });
  const res = disbursePayrollAtomic({ user: OFFICER, batch, storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Officer One' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'attribution_month_mismatch');
  assert.equal(storage.getRawLoans().find((l) => l.id === 'LOAN-1').remainingAmount, 1500);
});

// ---------------------------------------------------------------------------
// D4-09 (amount integrity): attributed amount must equal the scheduled entry
// ---------------------------------------------------------------------------
test('D4-09 installment-amount mismatch refused (attribution_installment_mismatch), zero writes', () => {
  const loan = mkLoan({ installments: [{ month: '2026-09', amount: 500, isPaid: false }] });
  const batch = mkBatch({ items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 5000, netSalary: 4500, loanInstallment: 500, loanAttributions: [{ loanId: 'LOAN-1', amount: 700, month: '2026-09' }] }] });
  seed({ loans: [loan], payrolls: [batch] });
  const res = disbursePayrollAtomic({ user: OFFICER, batch, storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Officer One' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'attribution_installment_mismatch');
  assert.equal(storage.getRawLoans().find((l) => l.id === 'LOAN-1').remainingAmount, 1500);
});

// ---------------------------------------------------------------------------
// D4-10 (integrity): a fully-settled loan is never double-settled
// ---------------------------------------------------------------------------
test('D4-10 settled loan attribution refused (attribution_loan_settled), zero writes', () => {
  const settled = mkLoan({ status: 'settled', paidAmount: 2000, remainingAmount: 0, installments: [{ month: '2026-09', amount: 500, isPaid: true }] });
  const batch = mkBatch({ items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 5000, netSalary: 4500, loanInstallment: 500, loanAttributions: [{ loanId: 'LOAN-1', amount: 500, month: '2026-09' }] }] });
  seed({ loans: [settled], payrolls: [batch] });
  const res = disbursePayrollAtomic({ user: OFFICER, batch, storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Officer One' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'attribution_loan_settled');
  assert.equal(res.batch.status, 'approved', 'no transition may persist');
  assert.equal(storage.getState().payrolls.find((b) => b.id === batch.id).status, 'approved');
});

// ---------------------------------------------------------------------------
// D4-11 (CRIT-1): a scoped actor's disbursement leaves out-of-scope records
// byte-for-byte identical — despite getState() hiding them from that actor
// ---------------------------------------------------------------------------
test('D4-11 out-of-scope comp-2 loans + payrolls are byte-identical after a scoped disbursement', () => {
  const loan1 = mkLoan({ installments: [{ month: '2026-09', amount: 500, isPaid: false }] });
  const c2Loan = mkLoan({ id: 'LOAN-C2', employeeId: 'emp-2', companyId: 'comp-2', branchId: 'br-2', currency: 'USD', totalAmount: 3000, paidAmount: 1000, remainingAmount: 2000, status: 'active', installments: [{ month: '2026-10', amount: 500, isPaid: false }] });
  const unrelated = mkLoan({ id: 'LOAN-UNREL', employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', currency: 'USD', totalAmount: 900, paidAmount: 100, remainingAmount: 800, status: 'active', installments: [{ month: '2026-11', amount: 400, isPaid: false }] });
  const batch = mkBatch({ id: 'PAY-D4-2026-09', items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 5000, netSalary: 4500, loanInstallment: 500, loanAttributions: [{ loanId: 'LOAN-1', amount: 500, month: '2026-09' }] }] });
  const c2Payroll = {
    id: 'PAY-C2-2026-04', month: '2026-04', companyId: 'comp-2', branchId: 'br-2', status: 'paid',
    releasedAt: '2026-04-30T00:00:00Z', releasedBy: 'Whoever',
    items: [{ employeeId: 'emp-2', companyId: 'comp-2', branchId: 'br-2', basicSalary: 5000, netSalary: 4500 }],
  };
  seed({ loans: [loan1, c2Loan, unrelated], payrolls: [batch, c2Payroll] });

  const beforeC2Loans = json(storage.getRawLoans().filter((l) => l.companyId === 'comp-2'));
  const beforeC2Payrolls = json(storage.getRawPayrolls().filter((b) => b.companyId === 'comp-2'));
  const beforeUnrelated = json(storage.getRawLoans().find((l) => l.id === 'LOAN-UNREL'));

  // Proof the threat was real: the officer's getState() projection DOES hide comp-2.
  assert.ok(!storage.getState().loans.some((l) => l.companyId === 'comp-2'), 'getState hides comp-2 loans from the officer');
  assert.ok(!storage.getState().payrolls.some((b) => b.companyId === 'comp-2'), 'getState hides comp-2 payrolls from the officer');

  const res = disbursePayrollAtomic({ user: OFFICER, batch, storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Officer One' });
  assert.equal(res.ok, true, json(res && res.error));

  const afterC2Loans = json(storage.getRawLoans().filter((l) => l.companyId === 'comp-2'));
  const afterC2Payrolls = json(storage.getRawPayrolls().filter((b) => b.companyId === 'comp-2'));
  const afterUnrelated = json(storage.getRawLoans().find((l) => l.id === 'LOAN-UNREL'));
  assert.equal(afterC2Loans, beforeC2Loans, 'comp-2 loans must NOT change byte-for-byte');
  assert.equal(afterC2Payrolls, beforeC2Payrolls, 'comp-2 payrolls must NOT change byte-for-byte');
  assert.equal(afterUnrelated, beforeUnrelated, 'unrelated comp-1 loan must NOT change byte-for-byte');
  assert.equal(storage.getRawLoans().find((l) => l.id === 'LOAN-1').remainingAmount, 1000, 'attributed loan reduced by the exact 500');
  assert.equal(storage.getState().payrolls.find((b) => b.id === batch.id).status, 'paid');
});

// ---------------------------------------------------------------------------
// D4-12 (partial ceiling): deduction capped at remaining; item stamped exact
// ---------------------------------------------------------------------------
test('D4-12 partial deduction capped at remaining balance; stamped amount is the exact paid value', () => {
  const loan = mkLoan({ paidAmount: 1750, remainingAmount: 250, installments: [{ month: '2026-09', amount: 500, isPaid: false }] });
  const batch = mkBatch({ items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 5000, netSalary: 4500, loanInstallment: 500, loanAttributions: [{ loanId: 'LOAN-1', amount: 500, month: '2026-09' }] }] });
  seed({ loans: [loan], payrolls: [batch] });
  const res = disbursePayrollAtomic({ user: OFFICER, batch, storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Officer One' });
  assert.equal(res.ok, true, json(res && res.error));
  assert.equal(res.batch.items[0].loanDeductedAmount, 250, 'exact deducted amount (250, not 500)');
  assert.equal(res.batch.items[0].loanId, 'LOAN-1');
  const l = storage.getRawLoans().find((x) => x.id === 'LOAN-1');
  assert.equal(l.paidAmount, 2000);
  assert.equal(l.remainingAmount, 0);
  assert.equal(l.status, 'settled');
  assert.ok(l.settledAt);
  assert.equal(l.installments.find((i) => i.month === '2026-09').isPaid, true);
});

// ---------------------------------------------------------------------------
// D4-13 (CRIT-1 rollback): a write failure restores ONLY the touched records;
// out-of-scope records stay byte-identical
// ---------------------------------------------------------------------------
test('D4-13 rollback restores affected payroll + loans; comp-2 records byte-identical', () => {
  const loan1 = mkLoan({ id: 'LOAN-1', installments: [{ month: '2026-09', amount: 500, isPaid: false }] });
  const c2Loan = mkLoan({ id: 'LOAN-C2', employeeId: 'emp-2', companyId: 'comp-2', branchId: 'br-2', currency: 'USD', totalAmount: 3000, paidAmount: 1000, remainingAmount: 2000, status: 'active', installments: [{ month: '2026-10', amount: 500, isPaid: false }] });
  const batch = mkBatch({ items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 5000, netSalary: 4500, loanInstallment: 500, loanAttributions: [{ loanId: 'LOAN-1', amount: 500, month: '2026-09' }] }] });
  const c2Payroll = { id: 'PAY-C2-2026-04', month: '2026-04', companyId: 'comp-2', branchId: 'br-2', status: 'paid', items: [] };
  seed({ loans: [loan1, c2Loan], payrolls: [batch, c2Payroll] });

  const beforeC2Loans = json(storage.getRawLoans().filter((l) => l.companyId === 'comp-2'));
  const beforeC2Payrolls = json(storage.getRawPayrolls().filter((b) => b.companyId === 'comp-2'));

  const res = disbursePayrollAtomic({
    user: OFFICER, batch, storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Officer One',
    simulateFailure: 'before_loan_write',
  });
  assert.equal(res.ok, false);
  assert.equal(res.rolledBack, true);
  const stored = storage.getState().payrolls.find((b) => b.id === batch.id);
  assert.equal(stored.status, 'approved', 'batch must be rolled back to approved');
  assert.ok(!stored.releasedAt, 'releasedAt must not survive the rollback');
  const l = storage.getRawLoans().find((x) => x.id === 'LOAN-1');
  assert.equal(l.remainingAmount, 1500, 'affected loan fully restored');
  assert.equal(l.paidAmount, 500);
  assert.equal(l.installments.find((i) => i.month === '2026-09').isPaid, false, 'month installment restored unpaid');
  assert.equal(json(storage.getRawLoans().filter((x) => x.companyId === 'comp-2')), beforeC2Loans, 'comp-2 loans byte-identical after rollback');
  assert.equal(json(storage.getRawPayrolls().filter((b) => b.companyId === 'comp-2')), beforeC2Payrolls, 'comp-2 payrolls byte-identical after rollback');
});

// ---------------------------------------------------------------------------
// D4-14 (CRIT-2 provenance): generation emits deterministic attribution
// ---------------------------------------------------------------------------
test('D4-14 generateMonthlyPayroll stamps loanId + loanAttributions on generated items', () => {
  const emp = {
    id: 'emp-a', fullName: 'Emp A', status: 'active', hireDate: '2025-01-01',
    basicSalary: 5000, companyId: 'comp-1', branchId: 'br-1', bankName: 'NBK', iban: 'KW00',
  };
  const settings = { currency: 'USD', currencySymbol: '$' };
  const loan = {
    id: 'L-ATTR', employeeId: 'emp-a', companyId: 'comp-1', branchId: 'br-1', currency: 'USD',
    totalAmount: 1500, paidAmount: 1000, remainingAmount: 500, status: 'active',
    installments: [{ month: '2026-09', amount: 500, isPaid: false }],
  };
  const res = generateMonthlyPayroll([emp], [], [loan], [], { month: '2026-09', companies: COMPANIES }, settings);
  const item = res.items.find((x) => x.employeeId === emp.id);
  assert.ok(item, 'item was generated');
  assert.equal(item.loanInstallment, 500);
  assert.equal(item.loanId, 'L-ATTR');
  assert.equal(json(item.loanAttributions), json([{ loanId: 'L-ATTR', amount: 500, month: '2026-09', currency: 'USD' }]));

  // Multi-loan: both attributed, no single loanId.
  const loan2 = {
    id: 'L-ATTR2', employeeId: 'emp-a', companyId: 'comp-1', branchId: 'br-1', currency: 'USD',
    totalAmount: 1200, paidAmount: 700, remainingAmount: 500, status: 'active',
    installments: [{ month: '2026-09', amount: 250, isPaid: false }],
  };
  const res2 = generateMonthlyPayroll([emp], [], [loan, loan2], [], { month: '2026-09', companies: COMPANIES }, settings);
  const item2 = res2.items.find((x) => x.employeeId === emp.id);
  assert.equal(item2.loanInstallment, 750);
  assert.equal(item2.loanId, undefined, 'multi-loan items carry NO single loanId');
  assert.equal(item2.loanAttributions.length, 2);
});

// ---------------------------------------------------------------------------
// D4-15 (D1 not weakened): full-return round trip reverses the exactly
// attributed loans and also preserves out-of-scope records byte-for-byte
// ---------------------------------------------------------------------------
test('D4-15 full-return precise round trip + scope preservation (D1 intact)', () => {
  const loan1 = mkLoan({ paidAmount: 500, remainingAmount: 1500, installments: [{ month: '2026-09', amount: 500, isPaid: false }] });
  const c2Loan = mkLoan({ id: 'LOAN-C2', employeeId: 'emp-2', companyId: 'comp-2', branchId: 'br-2', currency: 'USD', totalAmount: 3000, paidAmount: 1000, remainingAmount: 2000, status: 'active', installments: [{ month: '2026-10', amount: 500, isPaid: false }] });
  const batch = mkBatch({ items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 5000, netSalary: 4500, loanInstallment: 500, loanAttributions: [{ loanId: 'LOAN-1', amount: 500, month: '2026-09' }] }] });
  const c2Payroll = { id: 'PAY-C2-2026-04', month: '2026-04', companyId: 'comp-2', branchId: 'br-2', status: 'paid', items: [] };
  seed({ loans: [loan1, c2Loan], payrolls: [batch, c2Payroll] });

  const disRes = disbursePayrollAtomic({ user: OFFICER, batch, storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Officer One' });
  assert.equal(disRes.ok, true, json(disRes && disRes.error));
  const paidBatch = storage.getRawPayrolls().find((b) => b.id === batch.id);
  assert.equal(paidBatch.status, 'paid');

  const beforeC2Loans = json(storage.getRawLoans().filter((l) => l.companyId === 'comp-2'));
  const beforeC2Payrolls = json(storage.getRawPayrolls().filter((b) => b.companyId === 'comp-2'));

  const frRes = reversePayrollDisbursementAtomic({ user: SUP, batch: paidBatch, reason: 'Customer requested reversal', storage, by: 'System Admin' });
  assert.equal(frRes.ok, true, json(frRes && frRes.error));
  const restored = storage.getRawPayrolls().find((b) => b.id === batch.id);
  assert.equal(restored.status, 'approved');
  assert.ok(restored.fullReturn && restored.fullReturn.completed === true);
  const l = storage.getRawLoans().find((x) => x.id === 'LOAN-1');
  assert.equal(l.paidAmount, 500, 'loan restored exactly');
  assert.equal(l.remainingAmount, 1500);
  assert.equal(l.installments.find((i) => i.month === '2026-09').isPaid, false, 'month entry unpaid again');
  assert.equal(json(storage.getRawLoans().filter((x) => x.companyId === 'comp-2')), beforeC2Loans, 'comp-2 loans byte-identical through the full round trip');
  assert.equal(json(storage.getRawPayrolls().filter((b) => b.companyId === 'comp-2')), beforeC2Payrolls, 'comp-2 payrolls byte-identical through the full round trip');
});

// ---------------------------------------------------------------------------
console.log(`\nP18 Summary: ${passed}/${total} passed`);
if (passed !== total) process.exit(1);