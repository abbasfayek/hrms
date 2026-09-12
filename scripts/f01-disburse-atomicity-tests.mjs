// ==========================================
// F-01 Regression Tests: Atomic Payroll Disbursement & Loan Settlement
// ==========================================

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JS = `file:///${path.resolve(__dirname, '../public/js').replace(/\\/g, '/')}/`;

// Mock localStorage for storage.js
const mockStore = new Map();
globalThis.localStorage = {
  getItem(k) { return mockStore.has(k) ? mockStore.get(k) : null; },
  setItem(k, v) { mockStore.set(k, String(v)); },
  removeItem(k) { mockStore.delete(k); },
  clear() { mockStore.clear(); }
};

const { storage, STORAGE_KEYS } = await import(`${JS}storage.js`);
const { disbursePayrollAtomic } = await import(`${JS}engines/payrollDisbursement.js`);

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

console.log('\n--- Running F-01 Atomic Payroll Disbursement Tests ---');

// Setup test users
const uPaymentsOfficer = {
  id: 'u-pay-1',
  name: 'Finance Pay Officer',
  role: 'finance_manager',
  permissions: ['payroll.disburse'],
  assignedCompanies: ['c-1'],
  assignedBranches: ['br-1'],
};

const uHrAdmin = {
  id: 'u-hr-1',
  name: 'HR Ops',
  role: 'hr_manager',
  permissions: ['payroll.generate', 'payroll.edit', 'payroll.submit'],
  assignedCompanies: ['c-1'],
  assignedBranches: ['br-1'],
};

function createFixtureData() {
  const batch = {
    id: 'PAYROLL-2026-09',
    month: '2026-09',
    companyId: 'c-1',
    branchId: 'br-1',
    status: 'approved',
    items: [
      {
        employeeId: 'emp-101',
        name: 'Employee One',
        companyId: 'c-1',
        branchId: 'br-1',
        basicSalary: 5000,
        netSalary: 4500,
        loanInstallment: 500,
        isPaid: false,
      },
      {
        employeeId: 'emp-102',
        name: 'Employee Two',
        companyId: 'c-1',
        branchId: 'br-1',
        basicSalary: 6000,
        netSalary: 6000,
        loanInstallment: 0,
        isPaid: false,
      }
    ],
    revision: 1,
    auditHistory: [
      { action: 'create', from: 'draft', to: 'draft', by: 'HR' },
      { action: 'submit', from: 'draft', to: 'under_audit', by: 'HR' },
      { action: 'approve', from: 'under_audit', to: 'approved', by: 'Audit' },
    ],
  };

  const loans = [
    {
      id: 'loan-1',
      employeeId: 'emp-101',
      amount: 1500,
      paidAmount: 500,
      remainingAmount: 1000,
      status: 'active',
      installments: [
        { month: '2026-08', amount: 500, isPaid: true, paidAt: '2026-08-28T00:00:00Z' }
      ]
    },
    {
      id: 'loan-2',
      employeeId: 'emp-999',
      amount: 2000,
      paidAmount: 0,
      remainingAmount: 2000,
      status: 'active',
      installments: []
    }
  ];

  const employees = [
    { id: 'emp-101', name: 'Employee One', companyId: 'c-1', branchId: 'br-1', status: 'active' },
    { id: 'emp-102', name: 'Employee Two', companyId: 'c-1', branchId: 'br-1', status: 'active' },
  ];

  storage.saveUsers([uPaymentsOfficer, uHrAdmin]);
  storage.saveEmployees(employees);
  storage.setActiveUser(uPaymentsOfficer.id);
  storage.savePayrolls([JSON.parse(JSON.stringify(batch))]);
  storage.saveLoans(JSON.parse(JSON.stringify(loans)));

  return { batch, loans, employees };
}

// TEST 1: Success Path
test('Success path: batch transitions to paid and loan installment is deducted atomically', () => {
  const { batch } = createFixtureData();
  const context = { companyId: 'c-1', branchId: 'br-1' };

  const res = disbursePayrollAtomic({
    user: uPaymentsOfficer,
    batch: JSON.parse(JSON.stringify(batch)),
    storage,
    context,
    by: 'Finance Pay Officer',
  });

  assert.equal(res.ok, true, 'Disbursement must succeed');
  assert.equal(res.batch.status, 'paid', 'Batch must transition to paid');
  assert.equal(res.batch.items[0].isPaid, true, 'Item isPaid must be true');

  // Verify storage state
  const storedPayrolls = storage.getState().payrolls;
  const storedBatch = storedPayrolls.find(b => b.id === batch.id);
  assert.equal(storedBatch.status, 'paid');
  assert.ok(storedBatch.releasedAt);
  assert.equal(storedBatch.releasedBy, 'Finance Pay Officer');

  const storedLoans = storage.getState().loans;
  const loan1 = storedLoans.find(l => l.id === 'loan-1');
  assert.equal(loan1.remainingAmount, 500, 'Loan remaining amount must decrease by 500');
  assert.equal(loan1.paidAmount, 1000, 'Loan paid amount must increase by 500');
  assert.equal(loan1.status, 'active', 'Loan status must still be active (500 remains)');
  assert.equal(loan1.installments.length, 2, 'New installment record must be appended');
  assert.equal(loan1.installments[1].month, '2026-09');
  assert.equal(loan1.installments[1].isPaid, true);
});

// TEST 2: Success Path - Full Loan Settlement (remaining becomes 0)
test('Success path: loan is settled when remaining reaches 0', () => {
  createFixtureData();
  const batchWithRemaining500 = {
    id: 'PAYROLL-2026-10',
    month: '2026-10',
    companyId: 'c-1',
    branchId: 'br-1',
    status: 'approved',
    items: [
      {
        employeeId: 'emp-101',
        loanInstallment: 500,
        basicSalary: 5000,
        netSalary: 4500,
      }
    ],
    auditHistory: [
      { action: 'create', from: 'draft', to: 'draft' },
      { action: 'submit', from: 'draft', to: 'under_audit' },
      { action: 'approve', from: 'under_audit', to: 'approved' },
    ]
  };

  const loans = [
    {
      id: 'loan-1',
      employeeId: 'emp-101',
      amount: 1500,
      paidAmount: 1000,
      remainingAmount: 500,
      status: 'active',
      installments: []
    }
  ];

  storage.savePayrolls([batchWithRemaining500]);
  storage.saveLoans(loans);

  const res = disbursePayrollAtomic({
    user: uPaymentsOfficer,
    batch: batchWithRemaining500,
    storage,
    context: { companyId: 'c-1', branchId: 'br-1' },
    by: 'Finance Pay Officer',
  });

  assert.equal(res.ok, true);
  const storedLoans = storage.getState().loans;
  const loan1 = storedLoans.find(l => l.id === 'loan-1');
  assert.equal(loan1.remainingAmount, 0);
  assert.equal(loan1.paidAmount, 1500);
  assert.equal(loan1.status, 'settled');
  assert.ok(loan1.settledAt);
});

// TEST 3: State Machine Failure (Draft status) - No loan settlement
test('Failure path: draft status cannot be disbursed and loans are NOT settled', () => {
  const { batch, loans } = createFixtureData();
  batch.status = 'draft';
  storage.savePayrolls([batch]);

  const res = disbursePayrollAtomic({
    user: uPaymentsOfficer,
    batch: JSON.parse(JSON.stringify(batch)),
    storage,
    context: { companyId: 'c-1', branchId: 'br-1' },
  });

  assert.equal(res.ok, false);
  assert.equal(res.layer, 'state');

  // Verify zero side-effects
  const storedBatch = storage.getState().payrolls.find(b => b.id === batch.id);
  assert.equal(storedBatch.status, 'draft');

  const storedLoan = storage.getState().loans.find(l => l.id === 'loan-1');
  assert.equal(storedLoan.remainingAmount, 1000, 'Loan remaining amount MUST NOT change');
  assert.equal(storedLoan.paidAmount, 500, 'Loan paid amount MUST NOT change');
  assert.equal(storedLoan.installments.length, 1, 'No installment added');
});

// TEST 4: Permission Failure (HR lacks disburse permission) - No loan settlement
test('Failure path: user without payroll.disburse is blocked and loans are untouched', () => {
  const { batch } = createFixtureData();

  const res = disbursePayrollAtomic({
    user: uHrAdmin, // Lacks payroll.disburse
    batch: JSON.parse(JSON.stringify(batch)),
    storage,
    context: { companyId: 'c-1', branchId: 'br-1' },
  });

  assert.equal(res.ok, false);
  assert.equal(res.layer, 'permission');

  // Verify batch and loans untouched
  const storedBatch = storage.getState().payrolls.find(b => b.id === batch.id);
  assert.equal(storedBatch.status, 'approved');

  const storedLoan = storage.getState().loans.find(l => l.id === 'loan-1');
  assert.equal(storedLoan.remainingAmount, 1000);
  assert.equal(storedLoan.paidAmount, 500);
});

// TEST 5: Branch Scope Failure - No loan settlement
test('Failure path: cross-branch disbursement is blocked and loans are untouched', () => {
  const { batch } = createFixtureData();

  // User scoped to br-2, batch belongs to br-1
  const scopedUser = {
    ...uPaymentsOfficer,
    assignedBranches: ['br-2'],
  };

  const res = disbursePayrollAtomic({
    user: scopedUser,
    batch: JSON.parse(JSON.stringify(batch)),
    storage,
    context: { companyId: 'c-1', branchId: 'br-2' },
  });

  assert.equal(res.ok, false);
  assert.ok(['scope', 'context'].includes(res.layer), `layer must be scope or context, got ${res.layer}`);

  const storedBatch = storage.getState().payrolls.find(b => b.id === batch.id);
  assert.equal(storedBatch.status, 'approved');

  const storedLoan = storage.getState().loans.find(l => l.id === 'loan-1');
  assert.equal(storedLoan.remainingAmount, 1000);
});

// TEST 6: Atomic Rollback on Persistence Failure
test('Rollback path: failure during loan write rolls back payroll status to approved', () => {
  const { batch } = createFixtureData();

  const res = disbursePayrollAtomic({
    user: uPaymentsOfficer,
    batch: JSON.parse(JSON.stringify(batch)),
    storage,
    context: { companyId: 'c-1', branchId: 'br-1' },
    simulateFailure: 'before_loan_write', // Triggers simulated error before saving loans
  });

  assert.equal(res.ok, false);
  assert.equal(res.rolledBack, true);

  // Storage verification: batch MUST be rolled back to approved, not left as paid!
  const storedBatch = storage.getState().payrolls.find(b => b.id === batch.id);
  assert.equal(storedBatch.status, 'approved', 'Payroll batch status must be rolled back to approved');
  assert.equal(storedBatch.releasedAt, undefined, 'releasedAt must not remain stamped');

  // Loans must remain in initial state
  const storedLoan = storage.getState().loans.find(l => l.id === 'loan-1');
  assert.equal(storedLoan.remainingAmount, 1000, 'Loan remaining amount must remain 1000');
  assert.equal(storedLoan.paidAmount, 500, 'Loan paid amount must remain 500');
  assert.equal(storedLoan.installments.length, 1);
});

// TEST 7: Concurrency & Double-Submit Protection
test('Concurrency protection: in-flight disbursement blocks duplicate concurrent execution', () => {
  const { batch } = createFixtureData();

  // Test that two concurrent calls cannot both run
  // We can simulate an in-flight operation
  const batchClone = JSON.parse(JSON.stringify(batch));

  let firstRes;
  let secondRes;

  // Run first
  firstRes = disbursePayrollAtomic({
    user: uPaymentsOfficer,
    batch: batchClone,
    storage,
    context: { companyId: 'c-1', branchId: 'br-1' },
  });

  assert.equal(firstRes.ok, true);

  // Immediate second attempt on the same batch (already paid in storage)
  secondRes = disbursePayrollAtomic({
    user: uPaymentsOfficer,
    batch: firstRes.batch, // Now paid
    storage,
    context: { companyId: 'c-1', branchId: 'br-1' },
  });

  // Second attempt must fail with state error (paid cannot be disbursed again)
  assert.equal(secondRes.ok, false);
  assert.equal(secondRes.layer, 'state');

  // Loan installment must only have been deducted ONCE, not twice!
  const storedLoan = storage.getState().loans.find(l => l.id === 'loan-1');
  assert.equal(storedLoan.remainingAmount, 500, 'Loan installment must only be deducted once');
  assert.equal(storedLoan.installments.length, 2, 'Only one new installment recorded');
});

console.log(`\nF-01 Test Summary: ${passed}/${total} passed`);
if (passed !== total) process.exit(1);
