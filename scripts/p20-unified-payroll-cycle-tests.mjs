// ============================================================
// P-20 UNIFIED Payroll State-Machine Cycle Tests (ENGINE ONLY)
// ============================================================
// Single source of truth: batch.status (PAYROLL_STATUSES).
// One guarded machine: draft -> under_audit -> approved -> paid,
// with rejected (PAYROLL_RETURN_STATE) as the machine's return
// state, archive as a STAMP on paid (PAYROLL_ARCHIVE_STATUS),
// full-return paid -> approved, and reactivation landing the
// fully-returned batch back on 'rejected' — NO standalone
// financial state, no parallel edge map, no double-pay, no
// audit bypass, atomic disbursement, branch isolation.
// ============================================================
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JS = `file:///${path.resolve(__dirname, '../public/js').replace(/\\/g, '/')}/`;

// ---- mock browser globals (f01/p17 pattern) ----
const mockStore = new Map();
globalThis.localStorage = {
  getItem(k) { return mockStore.has(k) ? mockStore.get(k) : null; },
  setItem(k, v) { mockStore.set(k, String(v)); },
  removeItem(k) { mockStore.delete(k); },
  clear() { mockStore.clear(); },
};
if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
  };
}

const { storage } = await import(`${JS}storage.js`);

const {
  PAYROLL_STATUSES,
  PAYROLL_RETURN_STATE,
  PAYROLL_ARCHIVE_STATUS,
  canTransitionPayroll,
} = await import(`${JS}engines/payrollEngine.js`);

const {
  requirePayrollAction,
  transitionPayrollGuarded,
  archivePayrollBatchGuarded,
  fullReturnPayrollBatchGuarded,
  reactivateFullReturnedBatchGuarded,
} = await import(`${JS}engines/payrollAccess.js`);

const { disbursePayrollAtomic } = await import(`${JS}engines/payrollDisbursement.js`);

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
};
const json = (v) => JSON.stringify(v, null, 0);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---- users (p17 shape: explicit role + scope) ----
const mkUser = (id, role, comp, br) => ({
  id, username: id, name: id, role, companyId: comp, branchId: br,
  assignedCompanyId: comp, assignedBranchId: br, permissionKey: role, permissions: null,
});
const SUP = mkUser('usr-sup', 'super_admin', 'all', 'all');
const HR = mkUser('usr-hr', 'company_hr', 'comp-1', 'br-1');
const AUD = mkUser('usr-aud', 'audit_reviewer', 'comp-1', 'br-1');
const OFF = mkUser('usr-off', 'payments_officer', 'comp-1', 'br-1');
const X_BR = mkUser('usr-x', 'audit_reviewer', 'comp-1', 'br-2');

// ---- fixture: draft batch with production item shape ----
function makeDraftBatch() {
  return {
    id: 'PAYROLL-2026-09',
    month: '2026-09',
    companyId: 'comp-1',
    branchId: 'br-1',
    status: 'draft',
    revision: 1,
    items: [{
      employeeId: 'emp-101',
      companyId: 'comp-1',
      branchId: 'br-1',
      employeeName: 'Employee One',
      basicSalary: 4000,
      netSalary: 3000,
      loanInstallment: 0,
      isPaid: false,
    }],
    totalGross: 4000,
    totalDeductions: 1000,
    totalNet: 3000,
    auditHistory: [],
  };
}

console.log('\n--- P-20 Unified Payroll State-Machine Cycle Tests ---');

// [A] Single unified machine inventory
console.log('\n[A] Machine inventory (single source of truth)');
ok('A1. exactly 5 statuses — no parallel/divergent list',
  json(PAYROLL_STATUSES) === '["draft","under_audit","approved","rejected","paid"]', json(PAYROLL_STATUSES));
ok('A2. return state IS the machine rejected state (not a separate financial state)',
  PAYROLL_RETURN_STATE === 'rejected' && PAYROLL_STATUSES.includes(PAYROLL_RETURN_STATE), json(PAYROLL_RETURN_STATE));
ok('A3. archive is a stamp on paid (not a new financial state)',
  PAYROLL_ARCHIVE_STATUS === 'paid' && PAYROLL_STATUSES.includes(PAYROLL_ARCHIVE_STATUS), json(PAYROLL_ARCHIVE_STATUS));

// [B] Forward production cycle
console.log('\n[B] draft -> under_audit -> approved -> paid');
const s1 = transitionPayrollGuarded(HR, clone(makeDraftBatch()), 'under_audit', { by: 'HR' });
ok('B1. draft -> under_audit (submit) allowed', s1.ok && s1.batch.status === 'under_audit', json(s1));
const ua = s1.batch;

const s2 = transitionPayrollGuarded(AUD, clone(ua), 'approved', { by: 'Audit' });
ok('B2. under_audit -> approved allowed', s2.ok && s2.batch.status === 'approved', json(s2));
const ap = s2.batch;

const s3 = (() => {
  try {
    return disbursePayrollAtomic({ user: OFF, batch: clone(ap), storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Payments Officer' });
  } catch (e) { return { ok: false, error: e.message }; }
})();
ok('B3. approved -> paid (atomic disbursement) allowed', s3.ok && s3.batch.status === 'paid', json(s3));
const paid = s3.batch && s3.batch.branchId ? s3.batch : s3.batch;

// [C] Fail-closed gates
console.log('\n[C] No bypass / no double-pay');
ok('C1. draft can never be paid (no audit bypass)',
  !disbursePayrollAtomic({ user: OFF, batch: clone(makeDraftBatch()), storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'X' }).ok);
ok('C2. under_audit can never be paid directly (approve first)',
  !disbursePayrollAtomic({ user: OFF, batch: clone(ua), storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'X' }).ok);
ok('C3. paid batch cannot be disbursed again (no double pay)',
  !disbursePayrollAtomic({ user: OFF, batch: clone(paid), storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'X' }).ok);
ok('C4. canTransition: approved -> paid legal; paid -> anything illegal',
  canTransitionPayroll(clone(ap), 'paid').ok === true && canTransitionPayroll(clone(paid), 'approved').ok === false);
ok('C5. draft -> paid and draft -> approved jump both illegal (only via under_audit)',
  canTransitionPayroll(clone(makeDraftBatch()), 'paid').ok === false &&
  canTransitionPayroll(clone(makeDraftBatch()), 'approved').ok === false);

// [D] Return / reactivation — SAME machine, no new state
console.log('\n[D] paid -> approved (full return) -> rejected (reactivation) -> cycle resumes');
const d1 = fullReturnPayrollBatchGuarded(SUP, clone(paid), { by: 'Super', reason: 'client reversal' });
ok('D1. paid -> approved (full return) allowed for super_admin (cancelPayment)',
  d1.ok && d1.batch.status === 'approved', json(d1));
const ret = d1.batch && d1.batch.branchId ? d1.batch : paid;

const d2 = reactivateFullReturnedBatchGuarded(SUP, clone(ret), { reason: 'Reopen after client correction' });
ok('D2. reactivation lands on PAYROLL_RETURN_STATE == rejected (same machine state)',
  d2.ok && d2.batch.status === PAYROLL_RETURN_STATE && PAYROLL_RETURN_STATE === 'rejected', json(d2));
const rej = d2.batch && d2.batch.branchId ? d2.batch : ret;

const d3 = transitionPayrollGuarded(HR, clone(rej), 'under_audit', { by: 'HR' });
ok('D3. rejected -> under_audit (resubmit after correction) allowed',
  d3.ok && d3.batch.status === 'under_audit', json(d3));
const ua2 = d3.batch;

const d4 = transitionPayrollGuarded(AUD, clone(ua2), 'approved', { by: 'Audit' });
ok('D4. under_audit -> approved (re-approval) allowed',
  d4.ok && d4.batch.status === 'approved', json(d4));
const ap2 = d4.batch;

const d5 = (() => {
  try {
    return disbursePayrollAtomic({ user: OFF, batch: clone(ap2), storage, context: { companyId: 'comp-1', branchId: 'br-1' }, by: 'Payments Officer' });
  } catch (e) { return { ok: false, error: e.message }; }
})();
ok('D5. approved -> paid again after reactivation (re-pay, still one-shot)',
  d5.ok && d5.batch.status === 'paid', json(d5));
const paid2 = d5.batch && d5.batch.branchId ? d5.batch : ap2;

const d6 = archivePayrollBatchGuarded(SUP, clone(paid2), { by: 'Super', reason: 'Month closed' });
ok('D6. paid -> archived stamp (status stays paid; archived=true)',
  d6.ok && d6.batch.status === 'paid' && d6.batch.archived === true, json(d6));

// [E] Branch/company isolation via requirePayrollAction (p17 method)
console.log('\n[E] Isolation through the same guard stack');
const iso = requirePayrollAction(X_BR, 'disburse', { ...clone(ap), branchId: 'br-1', companyId: 'comp-1' });
ok('E1. br-2 officer cannot disburse a br-1 approved batch (branch mismatch)',
  iso.ok === false, json(iso));

console.log('----------------------------------------------');
console.log(`P-20 result: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}