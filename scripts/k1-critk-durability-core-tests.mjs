// ==========================================
// K1 — CRIT_K Phase K1: Financial Durability Core (R1 / R5 / R6)
//   R1  Verified financial write seam (_setVerified): a failed / silent /
//       corrupted / missing write is observable ({ok:false}), never a silent
//       success, with deep semantic read-back verification.
//   R5  addPayrollBatch baseline derives from the DURABLE previously persisted
//       month record (fresh list read BEFORE the write), so approved->paid
//       transitions emit exactly one PAID audit event, a failed/rolled-back
//       write restores 'approved', and a later genuine release emits again
//       (no phantom PAID on the failed attempt).
//   R6  persistLoansById captures beforeById BEFORE mutation so the emitted
//       loan 'paid' audit event reflects the real old->new paid-amount change;
//       unrelated loans stay byte-identical; D4 attribution intact.
// ==========================================

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JS = `file:///${path.resolve(__dirname, '../public/js').replace(/\\/g, '/')}/`;

// Mock localStorage for storage.js (with per-key fault injection)
const mockStore = new Map();
let failMode = null; // '<silent|throw|corrupt>:<storage_key>'
globalThis.localStorage = {
  getItem(k) { return mockStore.has(k) ? mockStore.get(k) : null; },
  setItem(k, v) {
    if (failMode) {
      const [kind, key] = failMode.split(':');
      if (key === k) {
        if (kind === 'silent') return; // storage silently drops the write
        if (kind === 'throw') throw new Error('QuotaExceededError (simulated)');
        if (kind === 'corrupt') { mockStore.set(k, JSON.stringify({ __corrupt: true, at: Date.now() })); return; }
      }
    }
    mockStore.set(k, String(v));
  },
  removeItem(k) { mockStore.delete(k); },
  clear() { mockStore.clear(); }
};

const { storage } = await import(`${JS}storage.js`);
const { disbursePayrollAtomic } = await import(`${JS}engines/payrollDisbursement.js`);

// storage.js only exports `storage`; mirror the internal storage keys used here.
const K = {
  USERS: 'hrms_users_v3',
  ACTIVE_USER_ID: 'hrms_active_user_id_v3',
  EMPLOYEES: 'hrms_employees_v3',
  LOANS: 'hrms_loans_v3',
  PAYROLLS: 'hrms_payrolls_v3',
};

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

console.log('\n--- Running K1 CRIT_K Financial Durability Core Tests ---');

const OFFICER = {
  id: 'u-pay-1',
  name: 'Finance Pay Officer',
  role: 'finance_manager',
  permissions: ['payroll.disburse'],
  assignedCompanies: ['c-1'],
  assignedBranches: ['br-1'],
};

const EMPLOYEES = [
  { id: 'emp-101', name: 'Employee One', companyId: 'c-1', branchId: 'br-1', status: 'active' },
  { id: 'emp-102', name: 'Employee Two', companyId: 'c-1', branchId: 'br-1', status: 'active' },
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

const mkUnrelatedLoan = () => ({
  id: 'LOAN-UNREL',
  employeeId: 'emp-999',
  companyId: 'c-9',
  branchId: 'br-9',
  currency: 'USD',
  amount: 2000,
  totalAmount: 2000,
  paidAmount: 0,
  remainingAmount: 2000,
  status: 'active',
  installments: [],
});

const mkBatch = (month, over = {}) => ({
  id: `PAYROLL-${month}`,
  month,
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
      loanAttributions: [{ loanId: 'LOAN-1', amount: 500, month, currency: 'USD' }],
      isPaid: false,
    },
  ],
  revision: 1,
  auditHistory: [
    { action: 'create', from: 'draft', to: 'draft', by: 'HR' },
    { action: 'submit', from: 'draft', to: 'under_audit', by: 'HR' },
    { action: 'approve', from: 'under_audit', to: 'approved', by: 'Audit' },
  ],
  ...over,
});

const clone = (x) => JSON.parse(JSON.stringify(x));

// Seed raw durable state directly (no audit side effects, no baseline map writes).
const seed = ({ batch, loans } = {}) => {
  mockStore.clear();
  failMode = null;
  const ctx = {
    batch: clone(batch || mkBatch('2026-09')),
    loans: clone(loans !== undefined ? loans : [mkLoan()]),
  };
  storage.set(K.USERS, [OFFICER]);
  storage.set(K.ACTIVE_USER_ID, OFFICER.id);
  storage.set(K.EMPLOYEES, EMPLOYEES);
  storage.set(K.PAYROLLS, [ctx.batch]);
  storage.set(K.LOANS, ctx.loans);
  return ctx;
};

const disburse = (batch, { simulateFailure } = {}) =>
  disbursePayrollAtomic({
    user: OFFICER,
    batch: clone(batch),
    storage,
    context: { companyId: 'c-1', branchId: 'br-1' },
    by: 'Finance Pay Officer',
    simulateFailure: simulateFailure || undefined,
  });

const trail = () => storage.getAuditTrail() || [];
const payrollPaidEvents = () => trail().filter((e) => e.recordType === 'payroll' && e.action === 'paid');
const loanPaidEvents = () => trail().filter((e) => e.recordType === 'loan' && e.action === 'paid');
const rawPayrolls = () => storage.getRawPayrolls() || [];
const rawLoans = () => storage.getRawLoans() || [];
const byRecordId = (arr, id) => arr.find((x) => x && String(x.id) === String(id));

// ==================================================================
// R1 — verified financial write seam (wrapper level)
// ==================================================================

test('R1: addPayrollBatch success — durable persisted month record equals written value', () => {
  const ctx = seed();
  const res = storage.addPayrollBatch(ctx.batch);
  assert.deepEqual(res, { ok: true });
  const stored = byRecordId(rawPayrolls(), ctx.batch.id);
  assert.ok(stored, 'month record must be durably present after write');
  assert.deepEqual(stored, ctx.batch, 'persisted record must semantically match the written batch');
});

test('R1: persistLoansById success — durable persisted loan equals written value', () => {
  const ctx = seed();
  const upd = clone(ctx.loans[0]);
  upd.paidAmount = 1000;
  upd.remainingAmount = 500;
  upd.installments = upd.installments.map((i) => (i.month === '2026-09' ? { ...i, isPaid: true, paidAt: '2026-09-19T00:00:00Z' } : i));
  const res = storage.persistLoansById([upd]);
  assert.deepEqual(res, { ok: true });
  const stored = byRecordId(rawLoans(), upd.id);
  assert.ok(stored, 'loan must be durably present after write');
  assert.deepEqual(stored, upd, 'persisted loan must semantically match the written value');
});

test('R1: persistLoansById — silent no-op write is reported as a FAILURE and state is unchanged', () => {
  const ctx = seed();
  const before = clone(rawLoans());
  failMode = `silent:${K.LOANS}`;
  const upd = clone(ctx.loans[0]);
  upd.paidAmount = 1000;
  upd.remainingAmount = 500;
  const res = storage.persistLoansById([upd]);
  assert.equal(res.ok, false, 'silent write must be observable as a failure');
  assert.match(res.error || '', /verification/, 'failure must carry a verification-level reason');
  assert.deepEqual(rawLoans(), before, 'silent no-op must leave durable state untouched');
});

test('R1: persistLoansById — corrupted persisted value is detected by read-back verification', () => {
  const ctx = seed();
  failMode = `corrupt:${K.LOANS}`;
  const upd = clone(ctx.loans[0]);
  upd.paidAmount = 1000;
  upd.remainingAmount = 500;
  const res = storage.persistLoansById([upd]);
  assert.equal(res.ok, false, 'corrupted write must never look like a success');
  assert.match(res.error || '', /verification/, 'corruption must surface as a verification failure');
});

test('R1: persistLoansById — an exception during the raw write is observable (never a false success)', () => {
  const ctx = seed();
  const before = clone(rawLoans());
  failMode = `throw:${K.LOANS}`;
  const upd = clone(ctx.loans[0]);
  upd.paidAmount = 1000;
  upd.remainingAmount = 500;
  const res = storage.persistLoansById([upd]);
  assert.equal(res.ok, false, 'throw during write must be observable as a failure');
  assert.match(res.error || '', /verification/, 'thrown write must surface as a verification failure');
  assert.deepEqual(rawLoans(), before, 'failed write must leave durable state untouched');
});

test('R1: addPayrollBatch — silent payroll rollback is reported as a FAILURE and state is unchanged', () => {
  const ctx = seed();
  const before = clone(rawPayrolls());
  failMode = `silent:${K.PAYROLLS}`;
  const res = storage.addPayrollBatch(ctx.batch);
  assert.equal(res.ok, false, 'silent payroll write must be observable as a failure');
  assert.match(res.error || '', /verification/, 'failure must carry a verification-level reason');
  assert.deepEqual(rawPayrolls(), before, 'silent no-op must leave durable payroll state untouched');
});

// ==================================================================
// K1-C + R5 — failed writes are never treated as success in the engine
// ==================================================================

test('K1-C: engine disbursement fails observably when the loan write silently no-ops', () => {
  const ctx = seed();
  const loansBefore = clone(rawLoans());
  failMode = `silent:${K.LOANS}`;
  const res = disburse(ctx.batch);
  assert.equal(res.ok, false, 'disbursement must NOT report success when the loan write silently failed');
  assert.match(res.error || '', /verification/, 'error must carry the verification-level reason');
  assert.equal(res.rolledBack, true, 'engine must attempt rollback on the failed financial write');
  const stored = byRecordId(rawPayrolls(), ctx.batch.id);
  assert.equal(stored.status, 'approved', 'payroll must be restored to approved after the failure');
  assert.deepEqual(rawLoans(), loansBefore, 'loans must be untouched by the failed write');
});

test('K1-C: engine disbursement fails observably when the payroll write silently no-ops — no PAID event is emitted', () => {
  const ctx = seed();
  failMode = `silent:${K.PAYROLLS}`;
  const res = disburse(ctx.batch);
  assert.equal(res.ok, false, 'disbursement must NOT report success when the payroll write silently failed');
  assert.match(res.error || '', /verification/, 'error must carry the verification-level reason');
  assert.equal(payrollPaidEvents().length, 0, 'no phantom PAID event may be emitted for a failed write');
  const stored = byRecordId(rawPayrolls(), ctx.batch.id);
  assert.equal(stored.status, 'approved', 'durable payroll stays approved when the write failed');
});

// ==================================================================
// R5 — durable baseline: approved->paid emits one genuine PAID event
// ==================================================================

test('R5: genuine approved->paid disbursement emits exactly one payroll PAID event', () => {
  const ctx = seed();
  const res = disburse(ctx.batch);
  assert.equal(res.ok, true, 'genuine disbursement must succeed');
  const events = payrollPaidEvents();
  assert.equal(events.length, 1, 'approved->paid must emit exactly one PAID audit event');
  assert.equal(events[0].recordId, ctx.batch.month);
  assert.equal(events[0].toStatus, 'paid');
  const stored = byRecordId(rawPayrolls(), ctx.batch.id);
  assert.equal(stored.status, 'paid', 'durable payroll must be paid after success');
});

test('R5: approved->paid emitted a PAID event even when the month was seeded without a baseline map entry', () => {
  // Seeds the approved batch directly (durable only, no _payrollBaselines write),
  // exactly like f01/p18 do. Old code emitted NO PAID event here (empty map);
  // R5 derives the baseline from the durable persisted record instead.
  const ctx = seed();
  const res = disburse(ctx.batch);
  assert.equal(res.ok, true);
  assert.equal(payrollPaidEvents().length, 1, 'first disbursement of a seeded approved payroll must emit PAID');
});

test('R5: a failed release restores approved; a later genuine release emits a fresh PAID event (no suppression)', () => {
  const ctx = seed();
  const attempt1 = disburse(ctx.batch, { simulateFailure: 'before_loan_write' });
  assert.equal(attempt1.ok, false, 'interrupted release must fail');
  const rolled = byRecordId(rawPayrolls(), ctx.batch.id);
  assert.equal(rolled.status, 'approved', 'interrupted release must restore approved');
  assert.equal(payrollPaidEvents().length, 1, 'the interrupted attempt legitimately committed one PAID instant');

  const attempt2 = disburse(ctx.batch);
  assert.equal(attempt2.ok, true, 'retry must succeed');
  assert.equal(payrollPaidEvents().length, 2, 'the genuine re-release must emit a NEW PAID event, not be suppressed');
  const paid = byRecordId(rawPayrolls(), ctx.batch.id);
  assert.equal(paid.status, 'paid');
});

test('R5: failed-payroll-write attempt emits no PAID event; the next genuine release emits exactly one', () => {
  const ctx = seed();
  failMode = `silent:${K.PAYROLLS}`;
  const res1 = disburse(ctx.batch);
  assert.equal(res1.ok, false, 'failed payroll write must fail');
  assert.equal(payrollPaidEvents().length, 0, 'failed payroll write must NOT leave a phantom PAID event');

  failMode = null;
  const res2 = disburse(ctx.batch);
  assert.equal(res2.ok, true, 'retry with healthy storage must succeed');
  assert.equal(payrollPaidEvents().length, 1, 'the genuine release must be the only PAID event');
});

// ==================================================================
// R6 — persistLoansById captures beforeById before mutation
// ==================================================================

test('R6: persistLoansById emits a loan PAID event reflecting the real old->new paid-amount change', () => {
  const ctx = seed();
  const upd = clone(ctx.loans[0]);
  upd.paidAmount = 1000;
  upd.remainingAmount = 500;
  upd.installments = upd.installments.map((i) => (i.month === '2026-09' ? { ...i, isPaid: true, paidAt: '2026-09-19T00:00:00Z' } : i));
  failMode = null;
  const res = storage.persistLoansById([upd]);
  assert.equal(res.ok, true);
  const events = loanPaidEvents();
  assert.equal(events.length, 1, 'a genuine paid-amount increase must emit exactly one loan PAID event');
  assert.equal(events[0].recordId, 'LOAN-1');
  assert.equal(events[0].oldValue.paidAmount, 500, 'beforeById must capture the PRE-mutation paid amount');
  assert.equal(events[0].newValue.paidAmount, 1000, 'event must reflect the written paid amount');
});

test('R6: persistLoansById with no paid-amount increase emits NO loan PAID event (no over-emission)', () => {
  const ctx = seed();
  const upd = clone(ctx.loans[0]);
  upd.remainingAmount = 900; // bookkeeping-only change; paidAmount unchanged
  const res = storage.persistLoansById([upd]);
  assert.equal(res.ok, true);
  assert.equal(loanPaidEvents().length, 0, 'a non-payment change must not emit a PAID event');
});

test('R6: unrelated loans remain byte-identical across persistLoansById and a full disbursement', () => {
  const ctx = seed({ loans: [mkLoan(), mkUnrelatedLoan()] });
  const unrelatedBefore = clone(byRecordId(ctx.loans, 'LOAN-UNREL'));

  const upd = clone(ctx.loans[0]);
  upd.paidAmount = 1000;
  upd.remainingAmount = 500;
  let res = storage.persistLoansById([upd]);
  assert.equal(res.ok, true);
  assert.deepEqual(byRecordId(rawLoans(), 'LOAN-UNREL'), unrelatedBefore, 'ID-scoped persistence must not rewrite unrelated loans');

  const ctx2 = seed({ batch: mkBatch('2026-09'), loans: [mkLoan(), mkUnrelatedLoan()] });
  res = disburse(ctx2.batch);
  assert.equal(res.ok, true, 'disbursement must succeed with an unrelated loan present');
  assert.deepEqual(byRecordId(rawLoans(), 'LOAN-UNREL'), unrelatedBefore, 'disbursement must leave unrelated loans byte-identical');
});

// ==================================================================
// Chain integrity after the full K1 flows
// ==================================================================

test('K1: audit chain remains hash-valid after success + failed + retry flows', () => {
  const ctx = seed();
  failMode = `silent:${K.LOANS}`;
  const r1 = disburse(ctx.batch);
  assert.equal(r1.ok, false);
  failMode = null;
  const r2 = disburse(ctx.batch);
  assert.equal(r2.ok, true);
  const integrity = storage.auditTrailIntegrity();
  assert.equal(integrity.valid, true, `audit chain must remain valid (brokenAt=${integrity.brokenAt})`);
  assert.ok(payrollPaidEvents().length >= 1, 'success flows must have written their events');
});

console.log(`\nK1 CRIT_K durability tests: ${passed}/${total} passed`);
process.exitCode = process.exitCode || (passed === total ? 0 : 1);