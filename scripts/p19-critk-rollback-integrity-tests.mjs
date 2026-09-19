// ==========================================
// P19 — CRIT_K K2: Verified Rollback & Financial Divergence
//   R2  Verified rollback protocol (restore + read-back verification +
//       out-of-scope byte identity) with a 3-state result contract
//       (complete / partial_payroll / partial_loans / failed).
//   R3  Rollback lifecycle audit events (attempted / complete / partial /
//       failed + financial_divergence with recoveryToken) on the hash chain.
//   K2  Divergence marker (transactionState="rollback_divergent" +
//       recoveryToken), additive only; engine guard blocks further financial
//       mutation on a divergent batch.
//   Uses REAL production storage code; deterministic fault injection at the
//   localStorage layer (write throw / silent no-op / corrupted value) with
//   per-write-count targeting so forward-write, restore-write and restore
//   read-back failures are each provable.
// ==========================================

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JS = `file:///${path.resolve(__dirname, '../public/js').replace(/\\/g, '/')}/`;

const mockStore = new Map();
const writeCounts = new Map();
// failMode: '' (off) or '<kind>:<key>[:<n>];...' — first matching rule applies.
let failMode = '';
function resetFaults() {
  failMode = '';
  writeCounts.clear();
}
function applyRule(k) {
  if (!failMode) return null;
  const rules = String(failMode).split(';').filter(Boolean);
  for (const rule of rules) {
    const [kind, key, nStr] = rule.split(':');
    if (String(key) !== String(k)) continue;
    if (nStr) {
      const n = (writeCounts.get(k) || 0) + 1;
      writeCounts.set(k, n);
      if (n !== Number(nStr)) continue; // not this write → try next rule
    }
    return kind;
  }
  return null;
}
globalThis.localStorage = {
  getItem(k) { return mockStore.has(k) ? mockStore.get(k) : null; },
  setItem(k, v) {
    const fault = applyRule(k);
    if (fault === 'silent') return;                       // silently dropped write
    if (fault === 'throw') throw new Error('QuotaExceededError (simulated)');
    if (fault === 'corrupt') { mockStore.set(k, JSON.stringify({ __corrupt: true, at: Date.now() })); return; }
    if (fault === 'unmark') {
      // Write succeeds but the marker fields are stripped from the persisted
      // value (K2 B1 defect-case E: read-back misses transactionState).
      try {
        const parsed = JSON.parse(String(v));
        (Array.isArray(parsed) ? parsed : []).forEach((b) => {
          if (b && typeof b === 'object') { delete b.transactionState; delete b.recoveryToken; }
        });
        mockStore.set(k, JSON.stringify(parsed));
      } catch { mockStore.set(k, String(v)); }
      return;
    }
    if (fault === 'remark') {
      // Write succeeds but with a DIFFERENT recoveryToken (K2 B1 defect-case F).
      try {
        const parsed = JSON.parse(String(v));
        (Array.isArray(parsed) ? parsed : []).forEach((b) => {
          if (b && typeof b === 'object' && b.transactionState === 'rollback_divergent') b.recoveryToken = 'RB-TAMPERED-00000000';
        });
        mockStore.set(k, JSON.stringify(parsed));
      } catch { mockStore.set(k, String(v)); }
      return;
    }
    mockStore.set(k, String(v));
  },
  removeItem(k) { mockStore.delete(k); },
  clear() { mockStore.clear(); writeCounts.clear(); }
};

const { storage } = await import(`${JS}storage.js`);
const { disbursePayrollAtomic, reversePayrollDisbursementAtomic, resetDivergentSessionBlocksForTests } = await import(`${JS}engines/payrollDisbursement.js`);

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

console.log('\n--- Running P19 CRIT_K K2 Rollback-Integrity Tests ---');

const K = {
  USERS: 'hrms_users_v3',
  ACTIVE_USER_ID: 'hrms_active_user_id_v3',
  EMPLOYEES: 'hrms_employees_v3',
  LOANS: 'hrms_loans_v3',
  PAYROLLS: 'hrms_payrolls_v3',
  DIVERGENT: 'hrms_divergent_payroll_keys_v3',
};

const M = '2026-09';
const OFFICER = {
  id: 'u-pay-1',
  name: 'Finance Pay Officer',
  role: 'finance_manager',
  permissions: ['payroll.disburse', 'payroll.cancelPayment'],
  assignedCompanies: ['c-1'],
  assignedBranches: ['br-1'],
};
const EMPLOYEES = [
  { id: 'emp-101', name: 'Employee One', companyId: 'c-1', branchId: 'br-1', status: 'active' },
];

const mkLoan = (over = {}) => ({
  id: 'LOAN-1',
  employeeId: 'emp-101',
  companyId: 'c-1',
  branchId: 'br-1',
  currency: 'USD',
  amount: 1500,
  totalAmount: 1500,
  paidAmount: 500,
  remainingAmount: 1000,
  status: 'active',
  installments: [
    { month: '2026-08', amount: 500, isPaid: true, paidAt: '2026-08-28T00:00:00Z' },
    { month: '2026-09', amount: 500, isPaid: false },
  ],
  ...over,
});

const mkSettledLoan = () => mkLoan({
  paidAmount: 1000,
  remainingAmount: 500,
  installments: [
    { month: '2026-08', amount: 500, isPaid: true, paidAt: '2026-08-28T00:00:00Z' },
    { month: '2026-09', amount: 500, isPaid: true, paidAt: '2026-09-10T00:00:00Z' },
  ],
});

const mkUnrelatedLoan = () => ({
  id: 'LOAN-UNREL', employeeId: 'emp-999', companyId: 'c-9', branchId: 'br-9', currency: 'USD',
  amount: 2000, totalAmount: 2000, paidAmount: 0, remainingAmount: 2000, status: 'active', installments: [],
});

const mkBatch = (month, over = {}) => ({
  id: `PAYROLL-${month}`,
  month,
  companyId: 'c-1',
  branchId: 'br-1',
  status: 'approved',
  items: [{
    employeeId: 'emp-101', name: 'Employee One', companyId: 'c-1', branchId: 'br-1',
    basicSalary: 5000, netSalary: 4500, loanInstallment: 500,
    loanAttributions: [{ loanId: 'LOAN-1', amount: 500, month, currency: 'USD' }],
    isPaid: false,
  }],
  revision: 1,
  auditHistory: [
    { action: 'create', from: 'draft', to: 'draft', by: 'HR' },
    { action: 'submit', from: 'draft', to: 'under_audit', by: 'HR' },
    { action: 'approve', from: 'under_audit', to: 'approved', by: 'Audit' },
  ],
  ...over,
});

const mkPaidBatchForReturn = (...args) => mkBatch(...args, {
  status: 'paid',
  releasedAt: '2026-09-10T00:00:00Z',
  releasedBy: 'Finance Pay Officer',
});

const mkUnrelatedPayroll = () => ({
  id: 'PAYROLL-2026-04', month: '2026-04', companyId: 'c-9', branchId: 'br-9',
  status: 'paid', revision: 1, items: [],
});

const clone = (x) => JSON.parse(JSON.stringify(x));

const seed = (payrolls, loans) => {
  mockStore.clear();
  resetFaults();
  resetDivergentSessionBlocksForTests();
  storage.set(K.USERS, [OFFICER]);
  storage.set(K.ACTIVE_USER_ID, OFFICER.id);
  storage.set(K.EMPLOYEES, EMPLOYEES);
  storage.set(K.PAYROLLS, clone(payrolls));
  storage.set(K.LOANS, clone(loans));
};

const disburse = (batch, opts = {}) =>
  disbursePayrollAtomic({
    user: OFFICER,
    batch: clone(batch),
    storage,
    context: { companyId: 'c-1', branchId: 'br-1' },
    by: 'Finance Pay Officer',
    simulateFailure: opts.simulateFailure || undefined,
  });

const fullReturn = (batch, reason = 'Audit reversal') =>
  reversePayrollDisbursementAtomic({
    user: OFFICER,
    batch: clone(batch),
    reason,
    storage,
    context: { companyId: 'c-1', branchId: 'br-1' },
    by: 'Finance Pay Officer',
  });

const trail = () => storage.getAuditTrail() || [];
const rollbackEvents = () => trail().filter((e) => e.recordType === 'payroll' && String(e.action || '').startsWith('rollback_'));
const divergenceEvents = () => trail().filter((e) => e.action === 'financial_divergence');
const payrollPaidEvents = () => trail().filter((e) => e.recordType === 'payroll' && e.action === 'paid');
const rawPayrolls = () => storage.getRawPayrolls() || [];
const rawLoans = () => storage.getRawLoans() || [];
const byId = (arr, id) => arr.find((x) => x && String(x.id) === String(id));

const expectFixed = (res, status) => {
  assert.equal(res.ok, false, 'transaction must fail');
  assert.equal(res.rolledBack, true, 'rollback must be attempted');
  assert.equal(res.rolledBackStatus, status, `rolledBackStatus must be ${status}`);
  if (status === 'complete') {
    assert.equal(res.financialDivergence, undefined, 'no divergence on verified rollback');
    assert.equal(res.recoveryToken, undefined, 'no token on verified rollback');
  } else {
    assert.equal(res.financialDivergence, true, 'divergence flag must be set');
    assert.ok(res.recoveryToken && String(res.recoveryToken).startsWith('RB-'), 'recoveryToken must be present and opaque');
  }
};

// ==================================================================
// FORWARD — R1/R2 verified rollback over REAL storage faults
// ==================================================================

test('F1 forward: payroll write throws at the storage layer → verified complete rollback', () => {
  const batch = mkBatch(M);
  const loan = mkLoan();
  seed([batch], [loan]);
  failMode = `throw:${K.PAYROLLS}:1`;

  const res = disburse(batch);
  expectFixed(res, 'complete');
  const stored = byId(rawPayrolls(), batch.id);
  assert.equal(stored.status, 'approved', 'payroll must be restored to approved');
  assert.equal(stored.releasedAt, undefined, 'releasedAt must not survive rollback');
  assert.deepEqual(rawLoans(), [loan], 'loans must be untouched (never written)');
});

test('F2 forward: loan write throws at the storage layer → verified complete rollback', () => {
  const batch = mkBatch(M);
  const loan = mkLoan();
  seed([batch], [loan]);
  failMode = `throw:${K.LOANS}:1`;

  const res = disburse(batch);
  expectFixed(res, 'complete');
  const stored = byId(rawPayrolls(), batch.id);
  assert.equal(stored.status, 'approved', 'payroll restored');
  const l = byId(rawLoans(), 'LOAN-1');
  assert.equal(l.remainingAmount, 1000, 'loan restored to pre-transaction state');
  assert.equal(l.paidAmount, 500);
  assert.equal(l.installments.find((i) => i.month === M).isPaid, false);
});

test('F3 forward: payroll RESTORE silently no-ops → partial_payroll divergence + marker', () => {
  const batch = mkBatch(M);
  const loan = mkLoan();
  seed([batch], [loan]);
  const beforeCorrections = (batch.corrections || []).length;
  failMode = `silent:${K.PAYROLLS}:2`;

  const res = disburse(batch, { simulateFailure: 'before_loan_write' });
  expectFixed(res, 'partial_payroll');
  const stored = byId(rawPayrolls(), batch.id);
  assert.equal(stored.status, 'paid', 'divergence: payroll stayed paid (restore was dropped)');
  assert.equal(stored.transactionState, 'rollback_divergent', 'marker must be persisted');
  assert.equal(stored.recoveryToken, res.recoveryToken, 'persisted token must match returned token');
  assert.equal((stored.corrections || []).length, beforeCorrections, 'corrections never overwritten');
  assert.ok(Array.isArray(stored.auditHistory), 'audit history never deleted');
  assert.equal(byId(rawLoans(), 'LOAN-1').remainingAmount, 1000, 'loans must be restored to pre-transaction state');
});

test('F4 forward: loan RESTORE throws after the settle write → partial_loans divergence + marker', () => {
  const batch = mkBatch(M);
  const loan = mkLoan();
  seed([batch], [loan]);
  failMode = `throw:${K.LOANS}:2`;

  const res = disburse(batch, { simulateFailure: 'after_writes' });
  expectFixed(res, 'partial_loans');
  const stored = byId(rawPayrolls(), batch.id);
  assert.equal(stored.status, 'approved', 'payroll restore succeeded');
  assert.equal(stored.transactionState, 'rollback_divergent', 'marker on the restored approved batch');
  const l = byId(rawLoans(), 'LOAN-1');
  assert.equal(l.remainingAmount, 500, 'divergence: loan stayed settled (restore write failed)');
  assert.equal(l.paidAmount, 1000);
});

test('F5 forward: loan RESTORE corrupts the persisted value → verification mismatch divergence', () => {
  const batch = mkBatch(M);
  const loan = mkLoan();
  seed([batch], [loan]);
  failMode = `corrupt:${K.LOANS}:2`;

  const res = disburse(batch, { simulateFailure: 'after_writes' });
  expectFixed(res, 'partial_loans');
  const stored = byId(rawPayrolls(), batch.id);
  assert.equal(stored.status, 'approved');
  assert.equal(stored.transactionState, 'rollback_divergent');
  const rawLo = rawLoans();
  assert.equal(Array.isArray(rawLo), false, 'corrupted persisted loans must not masquerade as a valid collection');
  assert.ok(rawLo && rawLo.__corrupt === true);
});

test('F6 forward: silent persistence failure on the loan write → failure surfaced + verified complete rollback', () => {
  const batch = mkBatch(M);
  const loan = mkLoan();
  seed([batch], [loan]);
  failMode = `silent:${K.LOANS}:1`;

  const res = disburse(batch);
  expectFixed(res, 'complete');
  assert.match(res.error || '', /verification/, 'silent write must surface as a verification failure (no fake success)');
  const stored = byId(rawPayrolls(), batch.id);
  assert.equal(stored.status, 'approved');
  assert.equal(byId(rawLoans(), 'LOAN-1').remainingAmount, 1000, 'loans byte-unchanged');
});

test('F7 forward: interrupted transaction (before_loan_write) → verified complete rollback', () => {
  const batch = mkBatch(M);
  const loan = mkLoan();
  seed([batch], [loan]);

  const res = disburse(batch, { simulateFailure: 'before_loan_write' });
  expectFixed(res, 'complete');
  const stored = byId(rawPayrolls(), batch.id);
  assert.equal(stored.status, 'approved');
  assert.equal(stored.releasedAt, undefined);
  assert.equal(byId(rawLoans(), 'LOAN-1').remainingAmount, 1000);
});

// ==================================================================
// REVERSE — verified rollback on the full-return path
// ==================================================================

test('R8 reverse: payroll write throws → verified complete rollback to the paid batch', () => {
  const batch = mkPaidBatchForReturn(M);
  const loan = mkSettledLoan();
  seed([batch], [loan]);
  failMode = `throw:${K.PAYROLLS}:1`;

  const res = fullReturn(batch);
  expectFixed(res, 'complete');
  const stored = byId(rawPayrolls(), batch.id);
  assert.equal(stored.status, 'paid', 'original paid batch restored');
  assert.equal(stored.fullReturn, undefined, 'full-return mutation must be rolled back');
  assert.equal(byId(rawLoans(), 'LOAN-1').remainingAmount, 500, 'loans untouched (never written)');
});

test('R9 reverse: loan write throws → verified complete rollback', () => {
  const batch = mkPaidBatchForReturn(M);
  const loan = mkSettledLoan();
  seed([batch], [loan]);
  failMode = `throw:${K.LOANS}:1`;

  const res = fullReturn(batch);
  expectFixed(res, 'complete');
  const stored = byId(rawPayrolls(), batch.id);
  assert.equal(stored.status, 'paid', 'paid batch restored');
  const l = byId(rawLoans(), 'LOAN-1');
  assert.equal(l.remainingAmount, 500, 'loan restored to its original settled state');
  assert.equal(l.installments.find((i) => i.month === M).isPaid, true);
});

test('R10 reverse: loan RESTORE fails after corrupt forward write → partial_loans divergence', () => {
  const batch = mkPaidBatchForReturn(M);
  const loan = mkSettledLoan();
  seed([batch], [loan]);
  failMode = `corrupt:${K.LOANS}:1;throw:${K.LOANS}:2`;

  const res = fullReturn(batch);
  expectFixed(res, 'partial_loans');
  const stored = byId(rawPayrolls(), batch.id);
  assert.equal(stored.status, 'paid', 'payroll restore succeeded');
  assert.equal(stored.transactionState, 'rollback_divergent');
  const rawLo = rawLoans();
  assert.equal(Array.isArray(rawLo), false, 'loans left in the corrupted state (restore failed)');
});

test('R11 reverse: payroll RESTORE silently no-ops after a thrown loan write → partial_payroll divergence', () => {
  const batch = mkPaidBatchForReturn(M);
  const loan = mkSettledLoan();
  seed([batch], [loan]);
  failMode = `throw:${K.LOANS}:1;silent:${K.PAYROLLS}:2`;

  const res = fullReturn(batch);
  expectFixed(res, 'partial_payroll');
  const stored = byId(rawPayrolls(), batch.id);
  assert.equal(stored.status, 'approved', 'divergence: approved full-return batch persisted (restore dropped)');
  assert.equal(stored.transactionState, 'rollback_divergent');
  assert.equal(stored.recoveryToken, res.recoveryToken);
  const l = byId(rawLoans(), 'LOAN-1');
  assert.equal(l.remainingAmount, 500, 'loans never written — original settled state untouched');
  assert.equal(l.installments.find((i) => i.month === M).isPaid, true);
});

// ==================================================================
// DIVERGENCE — marker, token, guard, out-of-scope identity
// ==================================================================

test('D12 divergence marker is minimal & additive (financial fields untouched)', () => {
  const batch = mkBatch(M);
  const loan = mkLoan();
  seed([batch], [loan]);
  failMode = `silent:${K.PAYROLLS}:2`;

  const res = disburse(batch, { simulateFailure: 'before_loan_write' });
  expectFixed(res, 'partial_payroll');
  const stored = byId(rawPayrolls(), batch.id);
  assert.equal(stored.transactionState, 'rollback_divergent');
  assert.equal(stored.recoveryToken, res.recoveryToken);
  assert.ok(stored.divergentAt, 'divergence timestamp set');
  assert.equal(stored.items[0].loanDeductedAmount, 500, 'release stamps preserved — financial fields untouched');
  assert.equal(stored.status, 'paid', 'marker is independent of financial status');
});

test('D13 recoveryToken is unique per divergence', () => {
  const loan = mkLoan();
  seed([mkBatch('2026-09')], [loan]);
  failMode = `silent:${K.PAYROLLS}:2`;
  const r1 = disburse(mkBatch('2026-09'), { simulateFailure: 'before_loan_write' });
  seed([mkBatch('2026-10', { items: [{
    employeeId: 'emp-101', name: 'Employee One', companyId: 'c-1', branchId: 'br-1',
    basicSalary: 5000, netSalary: 4500, loanInstallment: 500,
    loanAttributions: [{ loanId: 'LOAN-1', amount: 500, month: '2026-10', currency: 'USD' }], isPaid: false,
  }] })], [mkLoan({ installments: [{ month: '2026-08', amount: 500, isPaid: true, paidAt: '2026-08-28T00:00:00Z' }, { month: '2026-10', amount: 500, isPaid: false }] })]);
  failMode = `silent:${K.PAYROLLS}:2`;
  const r2 = disburse(mkBatch('2026-10'), { simulateFailure: 'before_loan_write' });

  expectFixed(r1, 'partial_payroll');
  expectFixed(r2, 'partial_payroll');
  assert.ok(r1.recoveryToken !== r2.recoveryToken, 'tokens must be unique across divergences');
});

test('D14 divergent batch cannot enter another financial mutation (disburse + full return)', () => {
  const batch = mkBatch(M);
  const loan = mkLoan();
  seed([batch], [loan]);
  failMode = `silent:${K.PAYROLLS}:2`;
  const div = disburse(batch, { simulateFailure: 'before_loan_write' });
  expectFixed(div, 'partial_payroll');
  const divergentStored = byId(rawPayrolls(), batch.id);
  assert.equal(divergentStored.transactionState, 'rollback_divergent');

  // Direct disburse on the stored divergent (paid + marker) batch → refused.
  const d1 = disburse(divergentStored);
  assert.equal(d1.ok, false);
  assert.equal(d1.error, 'payroll_divergent', 'stored divergent batch must be refused at the engine');

  // Passing a stale CLEAN approved copy must STILL be refused (durable guard).
  const cleanCopy = mkBatch(M);
  const d2 = disburse(cleanCopy);
  assert.equal(d2.ok, false);
  assert.equal(d2.error, 'payroll_divergent', 'clean copy must not bypass the durable-guard');

  // Full return on the divergent paid batch → refused at the engine.
  const d3 = fullReturn(divergentStored);
  assert.equal(d3.ok, false);
  assert.equal(d3.error, 'payroll_divergent', 'reverse must refuse a divergent batch');
});

test('D15 unrelated payrolls remain byte-identical after a divergence', () => {
  const batch = mkBatch(M);
  const other = mkUnrelatedPayroll();
  const loan = mkLoan();
  const unrelatedLoan = mkUnrelatedLoan();
  seed([batch, other], [loan, unrelatedLoan]);
  const otherBefore = clone(byId(rawPayrolls(), other.id));
  failMode = `silent:${K.PAYROLLS}:2`;

  const res = disburse(batch, { simulateFailure: 'before_loan_write' });
  expectFixed(res, 'partial_payroll');
  assert.deepEqual(byId(rawPayrolls(), other.id), otherBefore, 'out-of-scope payroll must stay byte-identical');
});

test('D16 unrelated loans remain byte-identical after a divergence', () => {
  const batch = mkBatch(M);
  const loan = mkLoan();
  const unrelatedLoan = mkUnrelatedLoan();
  seed([batch], [loan, unrelatedLoan]);
  const loanBefore = clone(byId(rawLoans(), unrelatedLoan.id));
  failMode = `silent:${K.PAYROLLS}:2`;

  const res = disburse(batch, { simulateFailure: 'before_loan_write' });
  expectFixed(res, 'partial_payroll');
  assert.deepEqual(byId(rawLoans(), unrelatedLoan.id), loanBefore, 'out-of-scope loan must stay byte-identical');
  assert.deepEqual(byId(rawLoans(), 'LOAN-1'), loan, 'affected loan restored to pre-transaction state');
});

// ==================================================================
// AUDIT — rollback lifecycle truth on the hash chain
// ==================================================================

test('A17 rollback_attempted event exists on every rollback path', () => {
  const batch = mkBatch(M);
  seed([batch], [mkLoan()]);
  const res = disburse(batch, { simulateFailure: 'before_loan_write' });
  expectFixed(res, 'complete');
  const attempts = rollbackEvents().filter((e) => e.action === 'rollback_attempted');
  assert.ok(attempts.length >= 1, 'rollback_attempted must be recorded');
  assert.ok(trail().every((e) => e.prevHash !== undefined), 'every chain event sealed');
});

test('A18 rollback_complete exists ONLY after a verified rollback (never on divergence)', () => {
  const batch = mkBatch(M);
  seed([batch], [mkLoan()]);
  const completeCase = disburse(batch, { simulateFailure: 'before_loan_write' });
  expectFixed(completeCase, 'complete');
  assert.ok(rollbackEvents().some((e) => e.action === 'rollback_complete'), 'complete case records rollback_complete');

  seed([mkBatch(M)], [mkLoan()]);
  failMode = `silent:${K.PAYROLLS}:2`;
  const divCase = disburse(mkBatch(M), { simulateFailure: 'before_loan_write' });
  expectFixed(divCase, 'partial_payroll');
  assert.equal(rollbackEvents().some((e) => e.action === 'rollback_complete'), false, 'divergence case must NOT fabricate rollback_complete');
});

test('A19 divergence event carries the exact recoveryToken on Case C', () => {
  const batch = mkBatch(M);
  seed([batch], [mkLoan()]);
  failMode = `silent:${K.PAYROLLS}:2`;

  const res = disburse(batch, { simulateFailure: 'before_loan_write' });
  expectFixed(res, 'partial_payroll');
  assert.ok(rollbackEvents().some((e) => e.action === 'rollback_partial'), 'rollback_partial must be recorded');
  const divEvents = divergenceEvents().filter((e) => String(e.recordId) === M);
  assert.ok(divEvents.length >= 1, 'financial_divergence event must exist');
  assert.equal(divEvents[0].recoveryToken, res.recoveryToken, 'divergence event must carry the returned token');
  assert.equal(divEvents[0].rollbackStatus, 'partial_payroll');
});

test('A20 audit hash chain remains valid across success + complete + divergence flows', () => {
  const batch = mkBatch(M);
  seed([batch], [mkLoan()]);
  const okRes = disburse(batch);
  assert.equal(okRes.ok, true);
  assert.equal(okRes.rolledBack, undefined, 'success path must not report a rollback');

  seed([mkBatch(M)], [mkLoan()]);
  const c = disburse(mkBatch(M), { simulateFailure: 'before_loan_write' });
  expectFixed(c, 'complete');

  seed([mkBatch(M)], [mkLoan()]);
  failMode = `silent:${K.PAYROLLS}:2`;
  const d = disburse(mkBatch(M), { simulateFailure: 'before_loan_write' });
  expectFixed(d, 'partial_payroll');

  const integrity = storage.auditTrailIntegrity();
  assert.equal(integrity.valid, true, `audit chain must remain valid (brokenAt=${integrity.brokenAt})`);
  assert.ok(payrollPaidEvents().length >= 1, 'genuine success still emitted its PAID event');
});

// ==================================================================
// B1 — divergence marker durability (defect-case matrix A..F)
// Each scenario drives the SAME partial_loans divergence (loan restore
// write throws) and faults the THIRD payroll write — the marker write
// itself (writes: #1 addPayrollBatch paid, #2 rollback restore payroll,
// #3 markPayrollDivergent).
// ==================================================================

test('B1-A marker write succeeds + read-back matches → durable marker + binding token', () => {
  const batch = mkBatch(M);
  const loan = mkLoan();
  seed([batch], [loan]);
  failMode = `throw:${K.LOANS}:2`;

  const res = disburse(batch, { simulateFailure: 'after_writes' });
  expectFixed(res, 'partial_loans');
  assert.equal(res.divergenceMarkerPersisted, true, 'durable marker must be claimed');
  assert.equal(res.divergenceMarkerError, undefined, 'no marker error on the happy marker path');
  const stored = byId(rawPayrolls(), batch.id);
  assert.equal(stored.transactionState, 'rollback_divergent', 'read-back contains the marker');
  assert.equal(stored.recoveryToken, res.recoveryToken, 'read-back binds the exact returned token');
  assert.ok(Array.isArray(stored.auditHistory), 'audit history never deleted');
});

test('B1-B marker write throws → NOT durable, error exposed, original failure preserved', () => {
  const batch = mkBatch(M);
  const loan = mkLoan();
  seed([batch], [loan]);
  failMode = `throw:${K.LOANS}:2;throw:${K.PAYROLLS}:3`;

  const res = disburse(batch, { simulateFailure: 'after_writes' });
  expectFixed(res, 'partial_loans');
  assert.equal(res.divergenceMarkerPersisted, false, 'thrown marker write must NOT claim durability');
  // storage.set() swallows thrown setItem errors (logs, never rethrows), so the
  // marker write leaves the record unchanged and the read-back fails verification
  // — the observable marker result is the read-back mismatch, never a fake OK.
  assert.equal(res.divergenceMarkerError, 'divergence_marker_unverifiable');
  assert.equal(res.ok, false);
  assert.equal(res.rolledBack, true, 'rolledBack still means attempted');
  const stored = byId(rawPayrolls(), batch.id);
  assert.equal(stored.transactionState, undefined, 'no marker on the durable record');
  assert.equal(stored.recoveryToken, undefined, 'no token bound to the durable record');
});

test('B1-C marker write silently no-ops → NOT durable, error exposed', () => {
  seed([mkBatch(M)], [mkLoan()]);
  failMode = `throw:${K.LOANS}:2;silent:${K.PAYROLLS}:3`;

  const res = disburse(mkBatch(M), { simulateFailure: 'after_writes' });
  expectFixed(res, 'partial_loans');
  assert.equal(res.divergenceMarkerPersisted, false);
  assert.equal(res.divergenceMarkerError, 'divergence_marker_unverifiable');
  const stored = byId(rawPayrolls(), mkBatch(M).id);
  assert.equal(stored && stored.transactionState, undefined, 'silent drop left no durable marker');
});

test('B1-D marker write corrupts the record → NOT durable, error exposed', () => {
  seed([mkBatch(M)], [mkLoan()]);
  failMode = `throw:${K.LOANS}:2;corrupt:${K.PAYROLLS}:3`;

  const res = disburse(mkBatch(M), { simulateFailure: 'after_writes' });
  expectFixed(res, 'partial_loans');
  assert.equal(res.divergenceMarkerPersisted, false);
  assert.equal(res.divergenceMarkerError, 'divergence_marker_unverifiable');
  assert.equal(Array.isArray(rawPayrolls()), false, 'corrupted persisted payroll must not masquerade as a valid collection');
});

test('B1-E marker read-back misses transactionState → NOT durable, error exposed', () => {
  seed([mkBatch(M)], [mkLoan()]);
  failMode = `throw:${K.LOANS}:2;unmark:${K.PAYROLLS}:3`;

  const res = disburse(mkBatch(M), { simulateFailure: 'after_writes' });
  expectFixed(res, 'partial_loans');
  assert.equal(res.divergenceMarkerPersisted, false);
  assert.equal(res.divergenceMarkerError, 'divergence_marker_unverifiable');
  const stored = byId(rawPayrolls(), mkBatch(M).id);
  assert.equal(stored.transactionState, undefined, 'read-back proves the marker is absent');
});

test('B1-F marker recoveryToken mismatch → NOT durable, error exposed', () => {
  seed([mkBatch(M)], [mkLoan()]);
  failMode = `throw:${K.LOANS}:2;remark:${K.PAYROLLS}:3`;

  const res = disburse(mkBatch(M), { simulateFailure: 'after_writes' });
  expectFixed(res, 'partial_loans');
  assert.equal(res.divergenceMarkerPersisted, false);
  assert.equal(res.divergenceMarkerError, 'divergence_marker_unverifiable');
  const stored = byId(rawPayrolls(), mkBatch(M).id);
  assert.equal(stored.transactionState, 'rollback_divergent', 'marker present but...');
  assert.notEqual(stored.recoveryToken, res.recoveryToken, '...tampered token must fail the binding check');
});

// ==================================================================
// N1 — "failed" classification (both restore/verifications fail)
// ==================================================================

test('N1-G both payroll + loan restore fail → rolledBackStatus "failed"', () => {
  seed([mkBatch(M)], [mkLoan()]);
  failMode = `silent:${K.PAYROLLS}:2;throw:${K.LOANS}:2`;

  const res = disburse(mkBatch(M), { simulateFailure: 'after_writes' });
  expectFixed(res, 'failed');
  assert.equal(res.divergenceMarkerPersisted, true, 'marker persisted on the failed-rollback divergence');
  const stored = byId(rawPayrolls(), mkBatch(M).id);
  assert.equal(stored.status, 'paid', 'payroll stayed paid (restore dropped)');
  assert.equal(stored.transactionState, 'rollback_divergent');
  assert.equal(stored.recoveryToken, res.recoveryToken);
  const l = byId(rawLoans(), 'LOAN-1');
  assert.equal(l.remainingAmount, 500, 'loans stayed settled (restore threw)');
});

test('N1-H ROLLBACK_FAILED emitted ONLY for the "failed" classification', () => {
  seed([mkBatch(M)], [mkLoan()]);
  failMode = `silent:${K.PAYROLLS}:2;throw:${K.LOANS}:2`;

  const res = disburse(mkBatch(M), { simulateFailure: 'after_writes' });
  expectFixed(res, 'failed');
  const evs = rollbackEvents();
  assert.equal(evs.filter((e) => e.action === 'rollback_failed').length, 1, 'rollback_failed must fire once');
  assert.equal(evs.filter((e) => e.action === 'rollback_partial').length, 0, 'rollback_partial must NOT fire for failed');
  const div = divergenceEvents().filter((e) => String(e.recordId) === M);
  assert.ok(div.length >= 1, 'financial_divergence must accompany a failed rollback');
  assert.equal(div[0].rollbackStatus, 'failed');
});

// ==================================================================
// B1 — no durable claim on marker failure + durable guard on success
// ==================================================================

test('B1-I marker failure never claims a durable recoveryToken', () => {
  seed([mkBatch(M)], [mkLoan()]);
  failMode = `throw:${K.LOANS}:2;throw:${K.PAYROLLS}:3`;

  const res = disburse(mkBatch(M), { simulateFailure: 'after_writes' });
  expectFixed(res, 'partial_loans');
  assert.equal(res.financialDivergence, true, 'the divergence itself is real');
  assert.equal(res.divergenceMarkerPersisted, false, 'durable claim explicitly refused');
  assert.ok(res.divergenceMarkerError, 'marker failure must surface');
  assert.ok(res.recoveryToken && String(res.recoveryToken).startsWith('RB-'), 'token returned but flagged transactional-only');
  const stored = byId(rawPayrolls(), mkBatch(M).id);
  assert.notEqual(stored && stored.recoveryToken, res.recoveryToken, 'the durable record does NOT hold this token');
  assert.notEqual(stored && stored.transactionState, 'rollback_divergent');
});

test('B1-J durable marker rejects clean-copy retry (guard reads durable state)', () => {
  seed([mkBatch(M)], [mkLoan()]);
  failMode = `silent:${K.PAYROLLS}:2`;

  const div = disburse(mkBatch(M), { simulateFailure: 'before_loan_write' });
  expectFixed(div, 'partial_payroll');
  assert.equal(div.divergenceMarkerPersisted, true, 'marker bound durably before Case C returns');
  const cleanCopy = mkBatch(M);
  assert.equal(cleanCopy.transactionState, undefined, 'retry copy carries no marker on its own');
  const retry = disburse(cleanCopy);
  assert.equal(retry.ok, false);
  assert.equal(retry.error, 'payroll_divergent', 'clean copy must be refused from durable state');
});

// ==================================================================
// F1 — FAIL-CLOSED RE-ENTRY BLOCK ON MARKER-PERSISTENCE FAILURE
// Decisive proof: divergence → marker persistence failure → clean-copy
// subsequent financial operation → operation REFUSED before mutation.
// The block registry (durable + session) is keyed by the composite identity
// and is independent of the payroll record's own marker write, so a
// marker-write failure cannot erase it.
// ==================================================================

const snapshot = () => ({
  p: JSON.stringify(rawPayrolls()),
  l: JSON.stringify(rawLoans()),
  t: JSON.stringify(trail()),
});

const assertRefusedNoMutation = (retry, before) => {
  assert.equal(retry.ok, false, 're-entry must be refused');
  assert.equal(retry.error, 'payroll_divergent', 'refusal must identify the divergent/re-entry guard');
  assert.equal(retry.layer, 'state', 'refusal surfaces as a state-level rejection');
  const after = snapshot();
  assert.equal(after.p, before.p, 'NO payroll financial mutation');
  assert.equal(after.l, before.l, 'NO loan financial mutation');
  assert.equal(after.t, before.t, 'NO new PAID/settlement/audit event');
};

// Drives the SAME partial_loans divergence (loan restore write throws) with
// the THIRD payroll write — markPayrollDivergent itself — failed as requested.
const divergeMarkerFault = (fault) => {
  seed([mkBatch(M)], [mkLoan()]);
  failMode = `throw:${K.LOANS}:2;${fault}:${K.PAYROLLS}:3`;
  const res = disburse(mkBatch(M), { simulateFailure: 'after_writes' });
  expectFixed(res, 'partial_loans');
  assert.equal(res.divergenceMarkerPersisted, false, `marker persistence must fail (${fault})`);
  assert.ok(res.divergenceMarkerError, 'marker failure must surface');
  return res;
};

test('F1-A marker silent no-op → clean-copy disburse refused BEFORE mutation', () => {
  divergeMarkerFault('silent');
  const before = snapshot();
  assertRefusedNoMutation(disburse(mkBatch(M)), before);
});

test('F1-B marker write throw → clean-copy disburse refused BEFORE mutation', () => {
  divergeMarkerFault('throw');
  const before = snapshot();
  assertRefusedNoMutation(disburse(mkBatch(M)), before);
});

test('F1-C marker write corrupt → clean-copy disburse refused BEFORE mutation', () => {
  divergeMarkerFault('corrupt');
  const before = snapshot();
  assertRefusedNoMutation(disburse(mkBatch(M)), before);
});

test('F1-D marker read-back missing transactionState → clean-copy disburse refused', () => {
  divergeMarkerFault('unmark');
  const before = snapshot();
  assertRefusedNoMutation(disburse(mkBatch(M)), before);
});

test('F1-E marker recoveryToken mismatch → clean-copy disburse refused', () => {
  divergeMarkerFault('remark');
  const before = snapshot();
  assertRefusedNoMutation(disburse(mkBatch(M)), before);
});

test('F1-F marker silent no-op → clean paid-copy reverse refused BEFORE mutation', () => {
  divergeMarkerFault('silent');
  const before = snapshot();
  assertRefusedNoMutation(fullReturn(mkPaidBatchForReturn(M)), before);
});

test('F1-G marker write throw → clean paid-copy reverse refused BEFORE mutation', () => {
  divergeMarkerFault('throw');
  const before = snapshot();
  assertRefusedNoMutation(fullReturn(mkPaidBatchForReturn(M)), before);
});

test('F1-H marker write corrupt → clean paid-copy reverse refused BEFORE mutation', () => {
  divergeMarkerFault('corrupt');
  const before = snapshot();
  assertRefusedNoMutation(fullReturn(mkPaidBatchForReturn(M)), before);
});

test('F1-I marker read-back missing transactionState → clean paid-copy reverse refused', () => {
  divergeMarkerFault('unmark');
  const before = snapshot();
  assertRefusedNoMutation(fullReturn(mkPaidBatchForReturn(M)), before);
});

test('F1-J marker recoveryToken mismatch → clean paid-copy reverse refused', () => {
  divergeMarkerFault('remark');
  const before = snapshot();
  assertRefusedNoMutation(fullReturn(mkPaidBatchForReturn(M)), before);
});

test('F1-K durable marker SUCCESS remains blocked for both disburse and reverse', () => {
  seed([mkBatch(M)], [mkLoan()]);
  failMode = `silent:${K.PAYROLLS}:2`;
  const div = disburse(mkBatch(M), { simulateFailure: 'before_loan_write' });
  expectFixed(div, 'partial_payroll');
  assert.equal(div.divergenceMarkerPersisted, true, 'success path binds the durable marker');
  const before = snapshot();
  assertRefusedNoMutation(disburse(mkBatch(M)), before);
  assertRefusedNoMutation(fullReturn(mkPaidBatchForReturn(M)), snapshot());
});

test('F1-L durable block registry write ALSO fails → session latch alone refuses clean copy', () => {
  seed([mkBatch(M)], [mkLoan()]);
  failMode = `throw:${K.LOANS}:2;silent:${K.PAYROLLS}:3;throw:${K.DIVERGENT}:1`;
  const res = disburse(mkBatch(M), { simulateFailure: 'after_writes' });
  expectFixed(res, 'partial_loans');
  assert.equal(res.divergenceMarkerPersisted, false);
  assert.equal(mockStore.has(K.DIVERGENT), false, 'durable block registry is absent — the engine-level latch must be the blocker');
  const before = snapshot();
  assertRefusedNoMutation(disburse(mkBatch(M)), before);
  assertRefusedNoMutation(fullReturn(mkPaidBatchForReturn(M)), snapshot());
});

test('F1-M unrelated batches remain fully usable; blocked batch stays blocked (composite-key isolation)', () => {
  const zeroLoanItem = (month) => ({
    employeeId: 'emp-101', name: 'Employee One', companyId: 'c-1', branchId: 'br-1',
    basicSalary: 5000, netSalary: 4500, loanInstallment: 0, loanAttributions: [], isPaid: false,
  });
  const bApproved = mkBatch('2026-04', { id: 'PAYROLL-2026-04', items: [zeroLoanItem('2026-04')] });
  const cPaid = {
    ...mkBatch('2026-05', { id: 'PAYROLL-2026-05', items: [zeroLoanItem('2026-05')] }),
    status: 'paid',
    releasedAt: '2026-09-10T00:00:00Z',
    releasedBy: 'Finance Pay Officer',
  };
  seed([mkBatch(M), bApproved, cPaid], [mkLoan()]);
  failMode = `silent:${K.PAYROLLS}:2`;

  const div = disburse(mkBatch(M), { simulateFailure: 'before_loan_write' });
  expectFixed(div, 'partial_payroll');
  assert.equal(div.divergenceMarkerPersisted, true);

  resetFaults();
  const unrelated = disburse(bApproved);
  assert.equal(unrelated.ok, true, 'unrelated batch must disburse normally');
  const storedB = byId(rawPayrolls(), bApproved.id);
  assert.equal(storedB.status, 'paid');
  assert.equal(storedB.transactionState, undefined, 'unrelated batch never flagged divergent');

  const unrelatedRev = fullReturn(cPaid);
  assert.equal(unrelatedRev.ok, true, 'unrelated paid batch must reverse normally');
  assert.equal(byId(rawPayrolls(), cPaid.id).fullReturn.completed, true, 'unrelated reverse actually applied');

  assertRefusedNoMutation(disburse(mkBatch(M)), snapshot());
  assertRefusedNoMutation(fullReturn(mkPaidBatchForReturn(M)), snapshot());
});

console.log(`\nP19 CRIT_K K2 rollback-integrity tests: ${passed}/${total} passed`);
process.exitCode = process.exitCode || (passed === total ? 0 : 1);