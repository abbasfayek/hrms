// =========================================================
// P4 Fix #4 — Archived Payroll Branch Preservation (committed
// regression). Guards: an archived payroll keeps the exact
// companyId/branchId of the batch at archive time, archiving is
// a flag (never changes status/identity), and cross-branch
// archiving is refused by the guard stack.
// Usage: node scripts/p4-fix4-archived-branch-tests.mjs
// =========================================================

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
if (!globalThis.CustomEvent) globalThis.CustomEvent = class CustomEvent { constructor(t, o = {}) { this.type = t; this.detail = o && o.detail; } };
if (!globalThis.window) globalThis.window = globalThis;

const { archivePayrollBatch } = await import('../public/js/engines/payrollEngine.js');
const { archivePayrollBatchGuarded } = await import('../public/js/engines/payrollAccess.js');

let passed = 0;
let failed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
}

const mkUser = (id, role, branchId, permissions) => ({
  id, role,
  assignedCompanyId: 'comp-1',
  assignedBranchId: branchId,
  // Explicit permissions: non-empty array is honored verbatim by
  // getEffectivePermissions/requirePayrollAction.
  permissions,
});

console.log('\n=== P4 Fix #4: Archived Payroll Branch Preservation ===');

const erbilBatch = {
  id: 'PAYROLL-2026-09-comp-1-erbil', month: '2026-09', companyId: 'comp-1',
  branchId: 'erbil', status: 'paid', items: [],
};
const baghdadBatch = {
  id: 'PAYROLL-2026-09-comp-1-baghdad', month: '2026-09', companyId: 'comp-1',
  branchId: 'baghdad', status: 'paid', items: [],
};

// Archiving preserves the ORIGINAL company/branch identity of the batch.
{
  const res = archivePayrollBatch(erbilBatch, { by: 'System' });
  ok('Engine archive retains original company and branch', res.ok && res.batch.companyId === 'comp-1' && res.batch.branchId === 'erbil');
  ok('Engine archive only flags the batch (archived=true, status stays paid)', res.batch.archived === true && res.batch.status === 'paid');
}

// A subsequent archive of the other branch must not rewrite either record and
// the archived record must not be mutated by a later UI branch change.
{
  const resBaghdad = archivePayrollBatch(baghdadBatch, { by: 'System' });
  ok('Second archive retains its own branch (Baghdad)', resBaghdad.batch.branchId === 'baghdad');
  ok('UI branch change does not mutate the archived record', resBaghdad.batch.archived === true && resBaghdad.batch.branchId === 'baghdad' && erbilBatch.branchId === 'erbil' && erbilBatch.archived !== true);
  ok('Archived record is sealed (no re-archive)', archivePayrollBatch(resBaghdad.batch, { by: 'System' }).ok === false && archivePayrollBatch(resBaghdad.batch, { by: 'System' }).error === 'already_archived');
}

// Guarded authorization: cross-branch archiving is refused for a branch HR.
{
  const erbilHr = mkUser('u-erbil-hr', 'branch_hr', 'erbil', ['payroll.archive']);
  const resErbil = archivePayrollBatchGuarded(erbilHr, erbilBatch, { context: { companyId: 'comp-1', branchId: 'erbil' } });
  ok('Erbil HR can archive its own Erbil paid batch', resErbil.ok === true);

  const resBaghdad = archivePayrollBatchGuarded(erbilHr, baghdadBatch, { context: { companyId: 'comp-1', branchId: 'baghdad' } });
  ok('Erbil HR cannot archive a Baghdad batch (branch_mismatch)', resBaghdad.ok === false && resBaghdad.error === 'branch_mismatch', `error=${resBaghdad.error}`);

  const noPermHr = mkUser('u-noarch-hr', 'branch_hr', 'erbil', ['payroll.view']);
  const resNoPerm = archivePayrollBatchGuarded(noPermHr, erbilBatch, { context: { companyId: 'comp-1', branchId: 'erbil' } });
  ok('Branch HR without payroll.archive cannot archive (permission layer)', resNoPerm.ok === false && resNoPerm.error === 'forbidden_action:archive' && resNoPerm.layer === 'permission', `error=${resNoPerm.error} layer=${resNoPerm.layer}`);
}

console.log(`\nP4 Fix #4 — Archived Payroll Branch Preservation: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}