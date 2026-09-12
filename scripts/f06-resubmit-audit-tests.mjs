// ============================================================
// F-06 Regression Test Suite: Reject → Correct → Resubmit
// Covers:
// 1. Immutable Rejection Snapshot & Rejection History
// 2. Correction & Delta calculation (netDifference, affectedEmployees)
// 3. Complete Audit Trail: Submitted → Rejected → Corrected → Resubmitted
// 4. State machine guard: cannot bypass audit or jump to approved/paid
// 5. API-level anti-tampering: blocked direct jump via raw write
// ============================================================
// Mock browser globals for Node.js test environment
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

const {
  canTransitionPayroll,
  transitionPayroll,
  recordPayrollCorrection,
} = await import('../public/js/engines/payrollEngine.js');

const {
  scopeValidateWrite,
} = await import('../server-authz.mjs');

function ok(name, cond, msg = '') {
  if (!cond) {
    console.error(`FAIL: ${name} ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${name}`);
}

console.log('--- Running F-06 Regression Test Suite ---');

// Setup mock payroll batch
const initialBatch = {
  id: 'batch-2026-08-b1',
  month: '2026-08',
  companyId: 'comp-1',
  branchId: 'br-1',
  status: 'draft',
  revision: 1,
  totalGross: 20000,
  totalDeductions: 2000,
  totalNet: 18000,
  items: [
    {
      employeeId: 'emp-1',
      employeeName: 'Ahmed Ali',
      basicSalary: 10000,
      housingAllowance: 2000,
      transportAllowance: 1000,
      otherAllowances: 0,
      grossSalary: 13000,
      absenceDeduction: 1000,
      totalDeductions: 1000,
      netSalary: 12000,
    },
    {
      employeeId: 'emp-2',
      employeeName: 'Sara Salem',
      basicSalary: 7000,
      housingAllowance: 0,
      transportAllowance: 0,
      otherAllowances: 0,
      grossSalary: 7000,
      absenceDeduction: 1000,
      totalDeductions: 1000,
      netSalary: 6000,
    },
  ],
};

// 1. Submit to audit
const submitRes = transitionPayroll(initialBatch, 'under_audit', { by: 'HR Officer' });
ok('1.1 Submit to audit succeeds', submitRes.ok && submitRes.batch.status === 'under_audit');
const batchUnderAudit = submitRes.batch;

// 2. Reject payroll
const rejectRes = transitionPayroll(batchUnderAudit, 'rejected', {
  by: 'Audit Reviewer',
  rejectionReason: 'Absence deduction for Ahmed Ali is wrong, should be 500 not 1000',
  auditNotes: 'Verified with attendance punch records',
});
ok('2.1 Rejection transitions status to rejected', rejectRes.ok && rejectRes.batch.status === 'rejected');
const rejectedBatch = rejectRes.batch;

ok('2.2 Rejected snapshot captured with frozen financial values',
  rejectedBatch.rejectedSnapshot &&
  rejectedBatch.rejectedSnapshot.totalNet === 18000 &&
  rejectedBatch.rejectedSnapshot.items.length === 2
);

ok('2.3 Rejection history array created with full metadata',
  Array.isArray(rejectedBatch.rejectionHistory) &&
  rejectedBatch.rejectionHistory.length === 1 &&
  rejectedBatch.rejectionHistory[0].rejectedBy === 'Audit Reviewer' &&
  rejectedBatch.rejectionHistory[0].reason.includes('Ahmed Ali is wrong') &&
  rejectedBatch.rejectionHistory[0].snapshot.totalNet === 18000
);

// 3. State machine illegal transition prevention from rejected
ok('3.1 Direct jump rejected -> approved is blocked',
  canTransitionPayroll(rejectedBatch, 'approved').ok === false
);
ok('3.2 Direct jump rejected -> paid is blocked',
  canTransitionPayroll(rejectedBatch, 'paid').ok === false
);
ok('3.3 Transition rejected -> under_audit (resubmit) is permitted',
  canTransitionPayroll(rejectedBatch, 'under_audit').ok === true
);

// 4. Correct payroll (HR recalculates / modifies items)
const correctedBatchInput = {
  ...rejectedBatch,
  totalDeductions: 1500,
  totalNet: 18500,
  items: [
    {
      ...rejectedBatch.items[0],
      absenceDeduction: 500, // corrected from 1000 to 500
      totalDeductions: 500,
      netSalary: 12500, // corrected from 12000 to 12500 (+500)
    },
    {
      ...rejectedBatch.items[1], // Sara unchanged
    },
  ],
};

const corrRes = recordPayrollCorrection(rejectedBatch, correctedBatchInput, {
  by: 'HR Admin',
  reason: 'Corrected Ahmed Ali absence deduction per attendance log',
});

ok('4.1 Correction succeeds on rejected batch', corrRes.ok === true);
const correctedBatch = corrRes.batch;

ok('4.2 Revision incremented', correctedBatch.revision === rejectedBatch.revision + 1);
ok('4.3 Rejection snapshot and history remain completely preserved and unmutated',
  Array.isArray(correctedBatch.rejectionHistory) &&
  correctedBatch.rejectionHistory.length === 1 &&
  correctedBatch.rejectionHistory[0].snapshot.totalNet === 18000
);

ok('4.4 Delta summary recorded in resubmissionDeltas',
  Array.isArray(correctedBatch.resubmissionDeltas) &&
  correctedBatch.resubmissionDeltas.length === 1 &&
  correctedBatch.resubmissionDeltas[0].fromRevision === rejectedBatch.revision &&
  correctedBatch.resubmissionDeltas[0].toRevision === correctedBatch.revision &&
  correctedBatch.resubmissionDeltas[0].correctedBy === 'HR Admin' &&
  correctedBatch.resubmissionDeltas[0].netDifference === 500 &&
  correctedBatch.resubmissionDeltas[0].affectedEmployeeIds.includes('emp-1') &&
  !correctedBatch.resubmissionDeltas[0].affectedEmployeeIds.includes('emp-2')
);

// 5. Resubmit corrected batch to audit
const resubmitRes = transitionPayroll(correctedBatch, 'under_audit', {
  by: 'HR Admin',
  rejectionReason: 'Re-submitted after correction',
});
ok('5.1 Resubmission succeeds and enters under_audit',
  resubmitRes.ok && resubmitRes.batch.status === 'under_audit' && resubmitRes.batch.returnState === 'resubmitted'
);
const resubmittedBatch = resubmitRes.batch;

ok('5.2 Full Audit Trail intact: Submitted -> Rejected -> Corrected -> Resubmitted',
  resubmittedBatch.auditHistory.some(a => a.action === 'under_audit') &&
  resubmittedBatch.auditHistory.some(a => a.action === 'rejected') &&
  resubmittedBatch.auditHistory.some(a => a.action === 'corrected') &&
  resubmittedBatch.auditHistory[resubmittedBatch.auditHistory.length - 1].action === 'under_audit'
);

// 6. Server-side API anti-bypass tests
const mockCtx = {
  user: { id: 'u-hr', role: 'company_hr', companyId: 'comp-1', branchId: 'br-1' },
  scope: { companyId: 'comp-1', branchId: 'br-1', compScoped: true, branchScoped: true, allowedBranchIds: new Set(['br-1']) },
};
const mockEmployees = () => [
  { id: 'emp-1', companyId: 'comp-1', branchId: 'br-1' },
  { id: 'emp-2', companyId: 'comp-1', branchId: 'br-1' },
];

// Stored payroll in DB is in 'rejected' state
const storedPayrolls = [rejectedBatch];

// Attempt 6.1: Malicious API client tries to write status: 'approved' directly to bypass audit review
const bypassApprovedRes = scopeValidateWrite(
  'payrolls',
  [{ ...rejectedBatch, status: 'approved' }],
  mockCtx,
  mockEmployees,
  storedPayrolls
);
ok('6.1 Server API blocks direct rejected -> approved bypass',
  bypassApprovedRes.ok === false && bypassApprovedRes.reason === 'illegal_workflow_transition'
);

// Attempt 6.2: Malicious API client tries to write status: 'paid' directly
const bypassPaidRes = scopeValidateWrite(
  'payrolls',
  [{ ...rejectedBatch, status: 'paid' }],
  mockCtx,
  mockEmployees,
  storedPayrolls
);
ok('6.2 Server API blocks direct rejected -> paid bypass',
  bypassPaidRes.ok === false && bypassPaidRes.reason === 'illegal_workflow_transition'
);

// Attempt 6.3: Malicious API client tries to wipe out rejectionHistory
const tamperHistoryRes = scopeValidateWrite(
  'payrolls',
  [{ ...rejectedBatch, rejectionHistory: [] }],
  mockCtx,
  mockEmployees,
  storedPayrolls
);
ok('6.3 Server API blocks deletion of rejectionHistory',
  tamperHistoryRes.ok === false && tamperHistoryRes.reason === 'history_tampering_detected'
);

// Attempt 6.4: Legitimate resubmit payload is accepted by server
const validWriteRes = scopeValidateWrite(
  'payrolls',
  [resubmittedBatch],
  mockCtx,
  mockEmployees,
  storedPayrolls
);
ok('6.4 Server API accepts valid resubmission carrying intact history',
  validWriteRes.ok === true
);

console.log('--- ALL F-06 REGRESSION TESTS PASSED (14/14) ---');
