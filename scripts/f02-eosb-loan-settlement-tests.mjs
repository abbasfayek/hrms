// ==========================================
// F-02 Regression Tests: Atomic EOSB Disbursement & Loan Settlement
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

const { storage } = await import(`${JS}storage.js`);
const { disburseEosbAtomic, cancelEosbPaymentAtomic } = await import(`${JS}engines/eosbDisbursement.js`);

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

console.log('\n--- Running F-02 EOSB Loan Settlement & Atomicity Tests ---');

const uFinanceManager = {
  id: 'u-fin-1',
  name: 'Finance Manager',
  role: 'finance_manager',
  permissions: ['eosb.calculate', 'eosb.approve', 'eosb.pay'],
  assignedCompanies: ['c-1'],
  assignedBranches: ['br-1'],
};

const uHrUser = {
  id: 'u-hr-1',
  name: 'HR User',
  role: 'branch_hr',
  permissions: ['eosb.calculate'],
  assignedCompanies: ['c-1'],
  assignedBranches: ['br-1'],
};

function createFixture() {
  const employees = [
    { id: 'emp-201', fullName: 'Mustafa Ali', companyId: 'c-1', branchId: 'br-1', status: 'active' },
    { id: 'emp-202', fullName: 'Sara Omar', companyId: 'c-1', branchId: 'br-1', status: 'active' },
  ];

  const eosbRecord = {
    id: 'EOSB-emp-201-1700000000',
    employeeId: 'emp-201',
    employeeName: 'Mustafa Ali',
    companyId: 'c-1',
    branchId: 'br-1',
    status: 'approved',
    finalEOSBAmount: 12000,
    leaveCompensationAmount: 1000,
    finalMonthSalary: 2000,
    remainingLoanDeductions: 3500,
    netSettlementAmount: 11500,
    terminationDate: '2026-09-30',
    salaryCurrency: 'USD',
    revision: 1,
    auditHistory: [
      { action: 'create', from: 'draft', to: 'draft' },
      { action: 'submit', from: 'draft', to: 'under_audit' },
      { action: 'approve', from: 'under_audit', to: 'approved' },
    ]
  };

  const loans = [
    {
      id: 'loan-201-A',
      employeeId: 'emp-201',
      amount: 5000,
      paidAmount: 3000,
      remainingAmount: 2000,
      status: 'active',
      installments: [
        { month: '2026-08', amount: 1000, isPaid: true }
      ]
    },
    {
      id: 'loan-201-B',
      employeeId: 'emp-201',
      amount: 1500,
      paidAmount: 0,
      remainingAmount: 1500,
      status: 'active',
      installments: []
    },
    {
      id: 'loan-202-Other',
      employeeId: 'emp-202',
      amount: 4000,
      paidAmount: 1000,
      remainingAmount: 3000,
      status: 'active',
      installments: []
    }
  ];

  storage.saveUsers([uFinanceManager, uHrUser]);
  storage.saveEmployees(employees);
  storage.setActiveUser(uFinanceManager.id);
  storage.saveEOSB([JSON.parse(JSON.stringify(eosbRecord))]);
  storage.saveLoans(JSON.parse(JSON.stringify(loans)));

  return { eosbRecord, loans, employees };
}

// TEST 1: Full Success Path - Loan Settlement & Metadata Capture
test('Success path: final EOSB disburse settles and closes all employee loans with full metadata', () => {
  const { eosbRecord } = createFixture();

  const res = disburseEosbAtomic({
    user: uFinanceManager,
    record: JSON.parse(JSON.stringify(eosbRecord)),
    storage,
    by: 'Finance Manager',
  });

  assert.equal(res.ok, true, 'Disbursement must succeed');
  assert.equal(res.batch.status, 'paid', 'EOSB record must transition to paid');
  assert.equal(res.settledLoans.length, 2, 'Both active loans of emp-201 must be settled');

  // Verify storage state for loans
  const storedLoans = storage.getState().loans;
  const loanA = storedLoans.find(l => l.id === 'loan-201-A');
  const loanB = storedLoans.find(l => l.id === 'loan-201-B');
  const otherLoan = storedLoans.find(l => l.id === 'loan-202-Other');

  // Loan A assertions
  assert.equal(loanA.status, 'settled', 'Loan A status must be settled');
  assert.equal(loanA.remainingAmount, 0, 'Loan A remaining amount must be 0');
  assert.equal(loanA.paidAmount, 5000, 'Loan A paid amount must be 3000 + 2000 = 5000');
  assert.equal(loanA.outstandingAmountBeforeSettlement, 2000, 'Loan A must record outstandingBefore = 2000');
  assert.equal(loanA.amountSettledFromEOSB, 2000, 'Loan A amountSettledFromEOSB must be 2000');
  assert.equal(loanA.settlementReference, eosbRecord.id, 'Loan A settlementReference must be EOSB id');
  assert.ok(loanA.settlementDate, 'Loan A must record settlementDate');

  const eosbInstA = loanA.installments.find(i => i.type === 'eosb_settlement');
  assert.ok(eosbInstA, 'Loan A must record an eosb_settlement installment');
  assert.equal(eosbInstA.amount, 2000);
  assert.equal(eosbInstA.reference, eosbRecord.id);

  // Loan B assertions
  assert.equal(loanB.status, 'settled', 'Loan B status must be settled');
  assert.equal(loanB.remainingAmount, 0);
  assert.equal(loanB.paidAmount, 1500);
  assert.equal(loanB.outstandingAmountBeforeSettlement, 1500);
  assert.equal(loanB.amountSettledFromEOSB, 1500);
  assert.equal(loanB.settlementReference, eosbRecord.id);

  // Unrelated employee's loan untouched
  assert.equal(otherLoan.status, 'active', 'Other employee loan must stay active');
  assert.equal(otherLoan.remainingAmount, 3000);

  // Verify audit trail on loan
  const storedAudits = storage.getAuditLog();
  const loanAudit = storedAudits.find(a => a.targetType === 'loans' && a.targetId === 'loan-201-A');
  assert.ok(loanAudit, 'Loan settlement audit entry must exist');
});

// TEST 2: State Machine Failure (Draft EOSB cannot be disbursed)
test('Failure path: draft EOSB status cannot be disbursed and loans are NOT settled', () => {
  const { eosbRecord } = createFixture();
  eosbRecord.status = 'draft';
  storage.saveEOSB([eosbRecord]);

  const res = disburseEosbAtomic({
    user: uFinanceManager,
    record: JSON.parse(JSON.stringify(eosbRecord)),
    storage,
  });

  assert.equal(res.ok, false);
  assert.equal(res.layer, 'state');

  // Verify zero side effects
  const storedLoans = storage.getState().loans;
  const loanA = storedLoans.find(l => l.id === 'loan-201-A');
  assert.equal(loanA.status, 'active');
  assert.equal(loanA.remainingAmount, 2000);
  assert.equal(loanA.settlementReference, undefined);
});

// TEST 3: Permission Failure (User lacks eosb.pay)
test('Failure path: user without eosb.pay cannot disburse EOSB and loans remain untouched', () => {
  const { eosbRecord } = createFixture();

  const res = disburseEosbAtomic({
    user: uHrUser, // Only has eosb.calculate
    record: JSON.parse(JSON.stringify(eosbRecord)),
    storage,
  });

  assert.equal(res.ok, false);
  assert.equal(res.layer, 'permission');

  const storedLoans = storage.getState().loans;
  const loanA = storedLoans.find(l => l.id === 'loan-201-A');
  assert.equal(loanA.status, 'active');
  assert.equal(loanA.remainingAmount, 2000);
});

// TEST 4: Atomic Rollback on Persistence Failure
test('Rollback path: failure during loan write rolls back EOSB status to approved and leaves loans active', () => {
  const { eosbRecord } = createFixture();

  const res = disburseEosbAtomic({
    user: uFinanceManager,
    record: JSON.parse(JSON.stringify(eosbRecord)),
    storage,
    simulateFailure: 'before_loan_write',
  });

  assert.equal(res.ok, false);
  assert.equal(res.rolledBack, true);

  // Storage verification
  const storedEosb = storage.getState().eosb.find(e => e.id === eosbRecord.id);
  assert.equal(storedEosb.status, 'approved', 'EOSB status must be rolled back to approved');

  const storedLoans = storage.getState().loans;
  const loanA = storedLoans.find(l => l.id === 'loan-201-A');
  assert.equal(loanA.status, 'active', 'Loan A must remain active');
  assert.equal(loanA.remainingAmount, 2000);
  assert.equal(loanA.settlementReference, undefined);
});

// TEST 5: Bidirectional Cancel Payment Reverts Settled Loans
test('Bidirectional lifecycle: cancelling EOSB payment restores loans back to active with outstanding amount', () => {
  const { eosbRecord } = createFixture();

  // 1. First disburse
  const disburseRes = disburseEosbAtomic({
    user: uFinanceManager,
    record: JSON.parse(JSON.stringify(eosbRecord)),
    storage,
    by: 'Finance Manager',
  });
  assert.equal(disburseRes.ok, true);

  // Verify settled
  let loanA = storage.getState().loans.find(l => l.id === 'loan-201-A');
  assert.equal(loanA.status, 'settled');

  // 2. Cancel payment
  const cancelRes = cancelEosbPaymentAtomic({
    user: uFinanceManager,
    record: disburseRes.batch,
    storage,
    by: 'Finance Manager',
  });

  assert.equal(cancelRes.ok, true);
  assert.equal(cancelRes.batch.status, 'approved');

  // Verify loan restored
  loanA = storage.getState().loans.find(l => l.id === 'loan-201-A');
  assert.equal(loanA.status, 'active', 'Loan must be reactivated');
  assert.equal(loanA.remainingAmount, 2000, 'Remaining amount must be restored');
  assert.equal(loanA.paidAmount, 3000, 'Paid amount restored to 3000');
  assert.equal(loanA.settlementReference, undefined, 'Settlement reference cleared');
  assert.equal(loanA.installments.some(i => i.type === 'eosb_settlement'), false, 'EOSB installment removed');
});

console.log(`\nF-02 Test Summary: ${passed}/${total} passed`);
if (passed !== total) process.exit(1);
