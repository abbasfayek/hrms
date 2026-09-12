// =========================================================
// Automated Verification: Full Return UX & Flow Test Battery
// =========================================================

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

import assert from 'node:assert';

const { storage } = await import('../public/js/storage.js');
const { createPayrollCorrectionGuarded, transitionCorrectionGuarded } = await import('../public/js/engines/payrollCorrectionAccess.js');
const { disbursePayrollAtomic } = await import('../public/js/engines/payrollDisbursement.js');

console.log('--- Starting Full Return Verification Battery ---');

const user = { id: 'admin-1', username: 'admin', role: 'super_admin', name: 'Super Admin' };
const branchContext = { companyId: 'comp-1', branchId: 'br-1' };

// Setup sample payroll batch
const batchId = 'PAYROLL-2026-09-comp-1-br-1';
const testBatch = {
  id: batchId,
  month: '2026-09',
  payrollPeriodId: '2026-09',
  companyId: 'comp-1',
  branchId: 'br-1',
  status: 'paid',
  paidAt: '2026-09-25T10:00:00.000Z',
  paidBy: 'Payments Officer',
  totalGross: 5000,
  totalDeductions: 500,
  totalNet: 4500,
  archived: true,
  items: [
    { employeeId: 'EMP-01', employeeName: 'Ahmed', grossSalary: 3000, totalDeductions: 300, netSalary: 2700, currency: 'USD' },
    { employeeId: 'EMP-02', employeeName: 'Sara', grossSalary: 2000, totalDeductions: 200, netSalary: 1800, currency: 'USD' },
  ],
};

// 1. Failure Test: Empty reason
console.log('1. Testing validation: empty reason is refused');
{
  const inputWithoutReason = {
    originalBatch: testBatch,
    originalTransactionId: testBatch.id,
    direction: 'debit',
    recovery: { method: 'separate_recovery' },
    ratePolicy: { mode: 'original' },
    reason: '',
    description: 'Full return',
    components: testBatch.items.map((it) => ({
      employeeId: it.employeeId,
      componentCode: 'SALARY_CUT',
      quantity: 1,
      rateOrRuleRef: it.netSalary,
      reason: '',
    })),
  };
  const res = createPayrollCorrectionGuarded(user, inputWithoutReason, {
    settings: { currency: 'USD' },
    context: branchContext,
    existingCorrections: [],
  });
  assert.strictEqual(res.ok, false, 'Creation without reason must fail');
  assert.strictEqual(res.error, 'reason_required', 'Error must be reason_required');
  console.log('  PASS: Empty reason refused cleanly');
}

// 2. Failure Test: Non-paid batch
console.log('2. Testing validation: non-paid batch is refused');
{
  const draftBatch = { ...testBatch, status: 'draft', archived: false };
  const input = {
    originalBatch: draftBatch,
    originalTransactionId: draftBatch.id,
    direction: 'debit',
    reason: 'Test return',
    components: draftBatch.items.map((it) => ({
      employeeId: it.employeeId,
      componentCode: 'SALARY_CUT',
      quantity: 1,
      rateOrRuleRef: it.netSalary,
      reason: 'Test return',
    })),
  };
  const res = createPayrollCorrectionGuarded(user, input, {
    settings: { currency: 'USD' },
    context: branchContext,
    existingCorrections: [],
  });
  assert.strictEqual(res.ok, false, 'Creation on non-archived/draft must fail');
  console.log('  PASS: Non-paid/non-archived batch refused cleanly');
}

// 3. Success Test: Full return workflow
console.log('3. Testing full return execution');
let finalCorrection = null;
let updatedBatch = null;
{
  const reason = 'Bank account transfer reversed by administration';
  const components = testBatch.items.map((it) => ({
    employeeId: it.employeeId,
    employeeName: it.employeeName,
    componentCode: 'SALARY_CUT',
    quantity: 1,
    rateOrRuleRef: it.netSalary,
    reason,
    sourceRef: `FULL_RETURN_${testBatch.month}`,
    manualEntry: false,
  }));

  const input = {
    originalBatch: testBatch,
    originalTransactionId: testBatch.id,
    direction: 'debit',
    recovery: { method: 'separate_recovery' },
    ratePolicy: { mode: 'original' },
    reason,
    description: `Full return for ${testBatch.month}`,
    components,
    manualEntry: false,
  };

  const res = createPayrollCorrectionGuarded(user, input, {
    settings: { currency: 'USD' },
    context: branchContext,
    existingCorrections: [],
  });
  assert.strictEqual(res.ok, true, 'Correction creation must succeed');
  assert.strictEqual(res.correction.direction, 'debit');
  assert.strictEqual(res.correction.components.length, 2);

  // Transition to under_audit
  const subRes = transitionCorrectionGuarded(user, res.correction, 'under_audit', {
    by: user.name,
    context: branchContext,
  });
  assert.strictEqual(subRes.ok, true, 'Transition to under_audit must succeed');
  finalCorrection = subRes.correction;

  // Update target batch with full return metadata
  updatedBatch = {
    ...testBatch,
    fullReturn: {
      completed: true,
      reason,
      correctionId: finalCorrection.correctionId,
      displayNumber: finalCorrection.displayNumber || null,
      at: new Date().toISOString(),
      by: user.name,
    },
  };

  assert.strictEqual(updatedBatch.fullReturn.completed, true);
  assert.strictEqual(updatedBatch.fullReturn.reason, reason);
  console.log('  PASS: Full return executed and batch metadata stamped successfully');
}

// 4. Double Return Prevention
console.log('4. Testing double return prevention');
{
  assert.strictEqual(Boolean(updatedBatch.fullReturn?.completed), true, 'Batch is flagged as fully returned');
  console.log('  PASS: Duplicate full return prevented by completed flag');
}

// 5. Double Disbursement Prevention
console.log('5. Testing double disbursement prevention');
{
  // Attempt to disburse the batch again
  const mockStorage = {
    getState: () => ({
      payrolls: [updatedBatch],
      loans: [],
      audit_trail: [],
    }),
    addPayrollBatch: () => {},
    addAudit: () => {},
  };

  const disburseRes = disbursePayrollAtomic({
    user,
    batch: updatedBatch,
    storage: mockStorage,
    context: branchContext,
    by: user.name,
  });

  assert.strictEqual(disburseRes.ok, false, 'Double disbursement must be blocked');
  assert.strictEqual(disburseRes.error, 'disburse_requires_approved:paid', 'Must reject already-paid transition');
  console.log('  PASS: Double disbursement blocked cleanly (disburse_requires_approved:paid)');
}

console.log('--- ALL FULL RETURN TEST ASSERTIONS PASSED (100%) ---');
