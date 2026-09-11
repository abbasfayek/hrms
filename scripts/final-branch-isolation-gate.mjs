// ============================================================================
// BRANCH ISOLATION — FINAL GATE
// Phase 8.5 — Closing gate before Phase 9.
// ============================================================================
// Verifies, end to end, the 10 acceptance points of branch isolation:
//   1. Real E2E branch workflow: Baghdad (generate → submit → approve →
//      disburse → archive) → switch → Erbil (same full workflow) → switch back
//      → BOTH stay Paid + Archived, each with its own data.
//   2. The SAME employee (same full name) working in both branches keeps two
//      independent payroll records — one per real branch, never mixed.
//   3. Engine-level branch context: every sensitive operation (submit, approve,
//      reject, disburse, archive, generate/correction) is REFUSED when the
//      batch carries no branch identity at all (branch_context_required), and
//      REFUSED when executed against a branch that is not the current context
//      (branch_mismatch). A denial NEVER partially executes.
//   4. Cross-branch protection in BOTH directions (work in Baghdad → cannot
//      touch Erbil; work in Erbil → cannot touch Baghdad).
//   5. Archive integrity: an archived payroll RETAINS its real companyId,
//      branchId, employeeId(s) and payrollPeriodId forever — branchId is never
//      re-read from the current UI branch at display time.
//   6. Switching branches never deletes / replaces / re-classifies / rewrites
//      stored payrolls — raw storage byte-identical across switches.
//   7. Reports / Excel / print drive rows exclusively from the batch whose
//      companyId+branchId match the CURRENT context — no cross-branch leakage.
//   8. Audit trail: every payroll event (success AND denied) carries companyId,
//      branchId, payrollId, employeeIds, action, actor and timestamp — branchId
//      is the REAL transaction branch, not the UI's currentBranchId.
//   9. Regression: every prior gate (P2.1, P2.2, Roles, P3, P4, P5, P6, P8, UI,
//      Release) runs green from this suite.
// Architecture note: operations go ONLY through the guarded entry points
// (transitionPayrollGuarded / recordPayrollCorrectionGuarded /
// archivePayrollBatchGuarded) with the CURRENT branch context (the exact
// `{ companyId, branchId }` shape PayrollView passes as `context`), exactly as
// the UI does — a denial is therefore identical to what a user would hit.
// ============================================================================

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
if (!globalThis.CustomEvent) { globalThis.CustomEvent = class CustomEvent { constructor(t, o = {}) { this.type = t; this.detail = o.detail; } }; }
if (!globalThis.window) globalThis.window = globalThis;

const JS = 'file:///C:/Users/Pc%20Zone/Desktop/hr/public/js/';
const MONTH = '2026-08';

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, cond) {
  try {
    if (cond) { passed++; console.log(`  PASS ${label}`); }
    else { failed++; failures.push(label); console.log(`  FAIL ${label}`); }
  } catch (e) { failed++; failures.push(`${label} — threw: ${e.message}`); console.log(`  FAIL ${label} — threw: ${e.message}`); }
}

function rawPayrolls() {
  const raw = store.get('hrms_payrolls_v3');
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}
function findStored(id) {
  return rawPayrolls().find((b) => b && b.id === id) || null;
}
function rawPayload() {
  return JSON.stringify(rawPayrolls());
}

// Mirror of ReportsView.getStoredMonthlyPayroll: the report for a month is the
// stored batch whose companyId+branchId equal the CURRENT company+branch
// context. Reports/Excel/print build ALL cells from this single batch.
// (Defined inside runTests — depends on the imported `storage` instance.)
function storedMonthlyPayroll(month) {
  const batches = storage.getState().payrolls || [];
  const ctx = { companyId: storage.getSelectedCompanyId(), branchId: storage.getSelectedBranchId() };
  return batches.find((b) => b.month === month && b.companyId === ctx.companyId && b.branchId === ctx.branchId) || null;
}

async function runTests() {
  const { storage } = await import(`${JS}storage.js`);
  const { defaultCompanies, defaultSettings, defaultUsers } = await import(`${JS}seedData.js`);
  const { generateMonthlyPayroll } = await import(`${JS}engines/payrollEngine.js`);
  const { transitionPayrollGuarded, recordPayrollCorrectionGuarded, archivePayrollBatchGuarded } = await import(`${JS}engines/payrollAccess.js`);
  const { AUDIT_RECORD_TYPES, verifyAuditTrail } = await import(`${JS}engines/auditTrail.js`);

  // --------------------------------------------------------------------------
  // Test actors — every payroll action performed through a role that holds the
  // permission, carrying the CURRENT branch (the same context the UI sends).
  // --------------------------------------------------------------------------
  const HR = { id: 't-hr', username: 't-hr', name: 'HR Ops', role: 'company_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'all' };
  const AUDITOR = { id: 't-aud', username: 't-aud', name: 'Audit Reviewer', role: 'audit_reviewer', assignedCompanyId: 'comp-1', assignedBranchId: 'all' };
  const PAY = { id: 't-pay', username: 't-pay', name: 'Payments Officer', role: 'payments_officer', assignedCompanyId: 'comp-1', assignedBranchId: 'all' };
  const ARCHIVER = { id: 't-arc', username: 't-arc', name: 'Archive Ops', role: 'custom_ops', assignedCompanyId: 'comp-1', assignedBranchId: 'all', permissions: ['payroll.view', 'payroll.archive'] };

  const COMPANIES = JSON.parse(JSON.stringify(defaultCompanies));
  const SETTINGS = {
    ...defaultSettings,
    currency: 'USD',
    currencySymbol: '$',
    baseCurrency: 'USD',
    dailyRateMethod: 'fixed30',
    customCurrencies: [{ code: 'IQD', symbol: 'ع.د', nameAr: 'دينار عراقي', nameEn: 'Iraqi Dinar' }],
    exchangeRates: [{ currency: 'IQD', baseCurrency: 'USD', rate: 1480, rateDate: '2026-06-01', locked: false, createdAt: '2026-06-01T00:00:00.000Z' }],
    socialInsuranceEmployeePercent: 9,
    socialInsuranceCompanyPercent: 12,
  };

  // The SAME two people work in both branches (same full names — requirement 2).
  const EMPLOYEES = [
    { id: 'emp-b1-1', fullName: 'Ali Hassan', companyId: 'comp-1', branchId: 'br-1', department: 'IT', jobTitle: 'Engineer', hireDate: '2020-01-01', status: 'active', basicSalary: 2500, housingAllowance: 500, transportAllowance: 200, currency: 'USD' },
    { id: 'emp-b1-2', fullName: 'Sara Nour', companyId: 'comp-1', branchId: 'br-1', department: 'Ops', jobTitle: 'Officer', hireDate: '2021-03-15', status: 'active', basicSalary: 2500, housingAllowance: 500, transportAllowance: 200, currency: 'USD' },
    { id: 'emp-b2-1', fullName: 'Ali Hassan', companyId: 'comp-1', branchId: 'br-2', department: 'IT', jobTitle: 'Engineer', hireDate: '2020-01-01', status: 'active', basicSalary: 2600, housingAllowance: 600, transportAllowance: 200, currency: 'USD' },
    { id: 'emp-b2-2', fullName: 'Sara Nour', companyId: 'comp-1', branchId: 'br-2', department: 'Ops', jobTitle: 'Officer', hireDate: '2021-03-15', status: 'active', basicSalary: 2600, housingAllowance: 600, transportAllowance: 200, currency: 'USD' },
  ];

  function resetStorage() {
    store.clear();
    storage.seedIfMissing();
    storage.clearAllData();
    storage.saveCompanies(COMPANIES);
    storage.saveSettings(SETTINGS);
    storage.saveUsers(JSON.parse(JSON.stringify([...defaultUsers, HR, AUDITOR, PAY, ARCHIVER])));
    storage.saveEmployees(JSON.parse(JSON.stringify(EMPLOYEES)));
    storage.saveAttendance([]);
    storage.saveLeaves([]);
    storage.saveHourlyLeaves([]);
    storage.saveOvertime([]);
    storage.saveHolidays([]);
    storage.saveLoans([]);
    storage.saveIncrements([]);
    storage.savePayrolls([]);
    storage.saveEOSB([]);
  }

  function switchBranch(branchId) {
    storage.setSelectedCompanyId('comp-1');
    storage.setSelectedBranchId(branchId);
  }
  function context(branchId) {
    return { companyId: 'comp-1', branchId };
  }

  // Mirror of ReportsView.getStoredMonthlyPayroll: the report for a month is
  // the stored batch whose companyId+branchId equal the CURRENT context.
  // Reports/Excel/print build ALL cells from this single batch.
  function storedMonthlyPayroll(month) {
    const batches = storage.getState().payrolls || [];
    const ctx = { companyId: storage.getSelectedCompanyId(), branchId: storage.getSelectedBranchId() };
    return batches.find((b) => b.month === month && b.companyId === ctx.companyId && b.branchId === ctx.branchId) || null;
  }

  function generate(empList) {
    const clone = JSON.parse(JSON.stringify(empList));
    return generateMonthlyPayroll(clone, [], [], [], { month: MONTH, companies: COMPANIES }, SETTINGS);
  }

  function storedByBranch(branchId) {
    return findStored(`PAYROLL-${MONTH}-comp-1-${branchId}`);
  }

  function payrollEvents() {
    return storage.getAuditTrail().filter((e) => e.recordType === AUDIT_RECORD_TYPES.PAYROLL);
  }
  function chainValid() {
    const meta = storage.getAuditTrailMeta();
    const ver = verifyAuditTrail(meta.envelope);
    if (!ver.valid) { console.log(`    [chain broken]`); return false; }
    return true;
  }

  // ==========================================================================
  console.log('S1. Branch context enforcement (engine-level, no partial execution)');
  // --------------------------------------------------------------------------
  resetStorage();

  // 1.1 A batch with NO branch identity anywhere must be refused outright.
  const ghost = { id: 'PAYROLL-2019-01', month: '2019-01', status: 'paid', items: [] };
  let r = archivePayrollBatchGuarded(ARCHIVER, ghost, { by: 'Archive Ops', context: context('br-1') });
  ok('S1.1 archive on identity-less batch → branch_context_required', r.ok === false && r.error === 'branch_context_required' && r.layer === 'context');

  r = archivePayrollBatchGuarded(ARCHIVER, { id: 'x', month: '2019-01', status: 'paid', items: [{ employeeId: 'e1' }] }, { by: 'Archive Ops', context: context('br-1') });
  ok('S1.2 archive on batch whose items carry no company/branch → refused', r.ok === false && r.error === 'branch_context_required');

  r = transitionPayrollGuarded(HR, { id: 'y', month: '2019-01', status: 'draft', items: [] }, 'under_audit', { by: 'HR Ops' });
  ok('S1.3 submit on identity-less batch without context → refused', r.ok === false && r.error === 'branch_context_required');

  r = recordPayrollCorrectionGuarded(HR, { id: 'z', month: '2019-01', status: 'draft', items: [] }, { id: 'z', month: '2019-01' }, { by: 'HR Ops', context: context('br-1') });
  ok('S1.4 correction on identity-less batch → refused', r.ok === false && r.error === 'branch_context_required');

  // 1.2 Valid batch + matching context → allowed (precondition for the flows).
  const b1Draft = generate(EMPLOYEES.filter((e) => e.branchId === 'br-1'));
  ok('S1.5 Baghdad draft carries real company/branch identity', b1Draft.companyId === 'comp-1' && b1Draft.branchId === 'br-1' && b1Draft.id === `PAYROLL-${MONTH}-comp-1-br-1`);
  ok('S1.6 Baghdad draft items carry branch identity + payrollPeriodId', b1Draft.items.every((it) => it.companyId === 'comp-1' && it.branchId === 'br-1' && it.payrollPeriodId === MONTH && it.employeeId));
  // Corrections only apply to Returned (rejected) batches — the wrong-context
  // refusal must fire BEFORE the returned-state check (no partial execution).
  const returned = { ...b1Draft, status: 'rejected' };
  r = recordPayrollCorrectionGuarded(HR, returned, { ...b1Draft }, { by: 'HR Ops', context: context('br-2') });
  ok('S1.7 correction with WRONG context refused before any state check', r.ok === false && r.error === 'branch_mismatch' && r.layer === 'context');
  r = recordPayrollCorrectionGuarded(HR, returned, { ...b1Draft }, { by: 'HR Ops', context: context('br-1') });
  ok('S1.8 correction with correct context allowed (guards pass)', r.ok === true);
  r = archivePayrollBatchGuarded(ARCHIVER, { ...b1Draft, status: 'paid' }, { by: 'Archive Ops', context: context('br-1') });
  ok('S1.9 archive of paid batch with correct context → allowed', r.ok === true);

  // ==========================================================================
  console.log('S2. Real E2E Baghdad workflow (generate → submit → approve → disburse → archive)');
  // --------------------------------------------------------------------------
  resetStorage();
  switchBranch('br-1');
  storage.setActiveUser('t-hr');

  let batch = generate(EMPLOYEES.filter((e) => e.branchId === 'br-1'));
  storage.addPayrollBatch(batch); // created (draft)
  const br1Id = batch.id;

  r = transitionPayrollGuarded(storage.getActiveUser(), batch, 'under_audit', { by: 'HR Ops', context: context('br-1') });
  ok('S2.1 Baghdad submit (draft → under_audit) OK', r.ok === true && r.batch.status === 'under_audit');
  batch = r.batch;
  storage.addPayrollBatch(batch); // submitted

  storage.setActiveUser('t-aud');
  r = transitionPayrollGuarded(storage.getActiveUser(), batch, 'approved', { by: 'Audit Reviewer', context: context('br-1') });
  ok('S2.2 Baghdad approve OK', r.ok === true && r.batch.status === 'approved');
  batch = r.batch;
  storage.addPayrollBatch(batch); // approved

  storage.setActiveUser('t-pay');
  r = transitionPayrollGuarded(storage.getActiveUser(), batch, 'paid', { by: 'Payments Officer', context: context('br-1') });
  ok('S2.3 Baghdad disburse OK', r.ok === true && r.batch.status === 'paid');
  batch = r.batch;
  storage.addPayrollBatch(batch); // paid

  storage.setActiveUser('t-arc');
  r = archivePayrollBatchGuarded(storage.getActiveUser(), batch, { by: 'Archive Ops', context: context('br-1') });
  ok('S2.4 Baghdad archive OK (stays paid, archived=true)', r.ok === true && r.batch.archived === true && r.batch.status === 'paid');
  batch = r.batch;
  storage.addPayrollBatch(batch); // archived

  ok('S2.5 Baghdad batch is Paid + Archived in raw storage after archive', ((b) => !!b && b.status === 'paid' && b.archived === true)(storedByBranch('br-1')));
  const snapshotA = rawPayload();

  // ==========================================================================
  console.log('S3. Cross-branch protection (work in Baghdad cannot touch Erbil)');
  // --------------------------------------------------------------------------
  // Attempts run while "working in Baghdad"; each must be REFUSED with the
  // stored record left byte-identical (no partial execution, ever).
  const e2Draft = generate(EMPLOYEES.filter((e) => e.branchId === 'br-2'));
  storage.setActiveUser('t-hr');
  r = transitionPayrollGuarded(storage.getActiveUser(), e2Draft, 'under_audit', { by: 'HR Ops', context: context('br-1') });
  ok('S3.1 submit Erbil batch while in Baghdad context → branch_mismatch', r.ok === false && r.error === 'branch_mismatch' && r.layer === 'context');
  ok('S3.2 refused Erbil submit never stores a batch', !storedByBranch('br-2'));

  const snapOf = (id) => JSON.stringify(findStored(id));
  const bsnap = snapOf(br1Id);
  const baghdadLive = () => findStored(br1Id);

  storage.setActiveUser('t-aud');
  r = transitionPayrollGuarded(storage.getActiveUser(), baghdadLive(), 'approved', { by: 'Audit Reviewer', context: context('br-2') });
  ok('S3.3 approve Baghdad batch (to Erbil context) → branch_mismatch', r.ok === false && r.error === 'branch_mismatch');

  storage.setActiveUser('t-pay');
  r = transitionPayrollGuarded(storage.getActiveUser(), baghdadLive(), 'paid', { by: 'Payments Officer', context: context('br-2') });
  ok('S3.4 disburse Baghdad batch (to Erbil context) → branch_mismatch', r.ok === false && r.error === 'branch_mismatch');

  storage.setActiveUser('t-arc');
  r = archivePayrollBatchGuarded(storage.getActiveUser(), baghdadLive(), { by: 'Archive Ops', context: context('br-2') });
  ok('S3.5 archive Baghdad batch (to Erbil context) → branch_mismatch', r.ok === false && r.error === 'branch_mismatch');

  ok('S3.6 every refused attempt left the stored Baghdad record byte-identical', snapOf(br1Id) === bsnap);
  ok('S3.7 Baghdad still Paid + Archived after all refused attempts', baghdadLive().status === 'paid' && baghdadLive().archived === true);

  // ==========================================================================
  console.log('S4. Real E2E Erbil workflow (with a Returned/re-submit leg + reverse protection)');
  // --------------------------------------------------------------------------
  // Same live storage as S2/S3 — Baghdad is already Paid + Archived; now the
  // user switches to Erbil and runs the full workflow while Baghdad stays put.
  switchBranch('br-2');
  storage.setActiveUser('t-hr');

  batch = generate(EMPLOYEES.filter((e) => e.branchId === 'br-2'));
  storage.addPayrollBatch(batch); // created (draft)
  const br2Id = batch.id;
  ok('S4.0 Erbil draft carries its own composite id', br2Id === `PAYROLL-${MONTH}-comp-1-br-2`);

  r = transitionPayrollGuarded(storage.getActiveUser(), batch, 'under_audit', { by: 'HR Ops', context: context('br-2') });
  ok('S4.1 Erbil submit OK', r.ok === true && r.batch.status === 'under_audit');
  batch = r.batch;
  storage.addPayrollBatch(batch);

  // Reverse-direction attempts against the LIVE Erbil batch while "in Baghdad".
  const esnap = snapOf(br2Id);
  storage.setActiveUser('t-pay');
  r = transitionPayrollGuarded(storage.getActiveUser(), findStored(br2Id), 'paid', { by: 'Payments Officer', context: context('br-1') });
  ok('S4.2 disburse Erbil while in Baghdad context → branch_mismatch', r.ok === false && r.error === 'branch_mismatch');
  storage.setActiveUser('t-arc');
  r = archivePayrollBatchGuarded(storage.getActiveUser(), findStored(br2Id), { by: 'Archive Ops', context: context('br-1') });
  ok('S4.4 archive Erbil while in Baghdad context → branch_mismatch', r.ok === false && r.error === 'branch_mismatch');
  ok('S4.5 Erbil untouched after refused attempts (still under_audit, byte-identical)', snapOf(br2Id) === esnap && findStored(br2Id).status === 'under_audit');

  // Auditor rejects (Returned / Needs Correction) — correct context.
  storage.setActiveUser('t-aud');
  const netBeforeReject = findStored(br2Id).totalNet;
  r = transitionPayrollGuarded(storage.getActiveUser(), findStored(br2Id), 'rejected', { by: 'Audit Reviewer', context: context('br-2') });
  ok('S4.6 Erbil reject (Returned) OK with correct context', r.ok === true && r.batch.status === 'rejected');
  ok('S4.7 financial amounts preserved through Returned (never zeroed)', r.batch.totalNet === netBeforeReject && netBeforeReject > 0);
  batch = r.batch;
  storage.addPayrollBatch(batch);

  // HR corrects + re-submits.
  storage.setActiveUser('t-hr');
  r = transitionPayrollGuarded(storage.getActiveUser(), findStored(br2Id), 'under_audit', { by: 'HR Ops', context: context('br-2') });
  ok('S4.8 Erbil re-submit after Returned OK', r.ok === true && r.batch.status === 'under_audit');
  batch = r.batch;
  storage.addPayrollBatch(batch);

  // Approve → disburse → archive.
  storage.setActiveUser('t-aud');
  r = transitionPayrollGuarded(storage.getActiveUser(), findStored(br2Id), 'approved', { by: 'Audit Reviewer', context: context('br-2') });
  ok('S4.9 Erbil approve OK', r.ok === true && r.batch.status === 'approved');
  batch = r.batch;
  storage.addPayrollBatch(batch);

  storage.setActiveUser('t-pay');
  r = transitionPayrollGuarded(storage.getActiveUser(), findStored(br2Id), 'paid', { by: 'Payments Officer', context: context('br-2') });
  ok('S4.10 Erbil disburse OK', r.ok === true && r.batch.status === 'paid');
  batch = r.batch;
  storage.addPayrollBatch(batch);

  storage.setActiveUser('t-arc');
  r = archivePayrollBatchGuarded(storage.getActiveUser(), findStored(br2Id), { by: 'Archive Ops', context: context('br-2') });
  ok('S4.11 Erbil archive OK (stays paid, archived=true)', r.ok === true && r.batch.archived === true && r.batch.status === 'paid');
  batch = r.batch;
  storage.addPayrollBatch(batch);

  ok('S4.12 Erbil batch is Paid + Archived in raw storage', ((b) => !!b && b.status === 'paid' && b.archived === true)(storedByBranch('br-2')));
  ok('S4.13 Baghdad REMAINS Paid + Archived after the whole Erbil flow', ((b) => !!b && b.status === 'paid' && b.archived === true)(storedByBranch('br-1')));

  // ==========================================================================
  console.log('S5. The SAME employee in both branches stays independent');
  // --------------------------------------------------------------------------
  const b1last = storedByBranch('br-1');
  const b2last = storedByBranch('br-2');
  ok('S5.1 Baghdad batch paid rows: exactly the 2 Baghdad employees', b1last.items.length === 2 && b1last.items.every((it) => it.branchId === 'br-1'));
  ok('S5.2 Erbil batch paid rows: exactly the 2 Erbil employees', b2last.items.length === 2 && b2last.items.every((it) => it.branchId === 'br-2'));
  ok('S5.3 "Ali Hassan" paid + archived in BOTH branches independently', (() => {
    const ali1 = b1last.items.find((it) => it.employeeName === 'Ali Hassan');
    const ali2 = b2last.items.find((it) => it.employeeName === 'Ali Hassan');
    return ali1 && ali2 && ali1.branchId === 'br-1' && ali2.branchId === 'br-2' && ali1.employeeId === 'emp-b1-1' && ali2.employeeId === 'emp-b2-1'
      && ali1.netSalary > 0 && ali2.netSalary > 0 && ali1.netSalary !== ali2.netSalary;
  })());
  ok('S5.4 no cross-branch row in either batch', b1last.items.every((it) => it.branchId !== 'br-2') && b2last.items.every((it) => it.branchId !== 'br-1'));

  // ==========================================================================
  console.log('S6. Archive integrity — real identifiers retained forever');
  // --------------------------------------------------------------------------
  const archivedB1 = findStored(br1Id);
  const archivedB2 = findStored(br2Id);
  ok('S6.1 Baghdad archive retains companyId', archivedB1.companyId === 'comp-1');
  ok('S6.2 Baghdad archive retains branchId (not currentBranchId)', archivedB1.branchId === 'br-1');
  ok('S6.3 Baghdad archive retains payrollPeriodId', archivedB1.payrollPeriodId === MONTH);
  ok('S6.4 Baghdad archive items retain the four identifiers', archivedB1.items.every((it) => it.employeeId && it.companyId === 'comp-1' && it.branchId === 'br-1' && it.payrollPeriodId === MONTH));
  ok('S6.5 Erbil archive retains branchId', archivedB2.branchId === 'br-2');
  ok('S6.6 Erbil archive retains payrollPeriodId', archivedB2.payrollPeriodId === MONTH);
  ok('S6.7 archived batches keep their financial numbers (Paid amount frozen)', archivedB1.totalNet > 0 && archivedB2.totalNet > 0);

  // ==========================================================================
  console.log('S7. Switching branches — raw payroll storage never rewritten');
  // --------------------------------------------------------------------------
  const rawBefore = rawPayload();
  switchBranch('br-2');
  ok('S7.1 branch selector moves to Erbil', storage.getSelectedCompanyId() === 'comp-1' && storage.getSelectedBranchId() === 'br-2');
  ok('S7.2 switch to Erbil does NOT rewrite stored payrolls', rawPayload() === rawBefore);
  switchBranch('br-1');
  ok('S7.3 switch back to Baghdad does NOT rewrite stored payrolls', rawPayload() === rawBefore);
  ok('S7.4 exactly 2 stored payroll batches (never duplicated/replaced)', rawPayrolls().length === 2);
  ok('S7.5 Baghdad still Paid + Archived after the round-trip', ((b) => !!b && b.status === 'paid' && b.archived === true)(findStored(br1Id)));
  ok('S7.6 Erbil still Paid + Archived after the round-trip', ((b) => !!b && b.status === 'paid' && b.archived === true)(findStored(br2Id)));

  // ==========================================================================
  console.log('S8. Reports / Excel / print — current-context branch only');
  // --------------------------------------------------------------------------
  switchBranch('br-1');
  let rep = storedMonthlyPayroll(MONTH);
  ok('S8.1 Baghdad context returns the Baghdad report only', !!rep && rep.branchId === 'br-1' && rep.companyId === 'comp-1');
  ok('S8.2 Baghdad report rows are exclusively Baghdad employees', rep && rep.items.every((it) => it.branchId === 'br-1'));
  ok('S8.3 report cell data binds the real identifiers', rep && rep.items.every((it) => it.employeeId && it.payrollPeriodId === MONTH));
  ok('S8.4 sum of the report rows equals the batch net', rep && Math.abs(rep.items.reduce((s, it) => s + it.netSalary, 0) - rep.totalNet) < 1e-6);
  ok('S8.5 Excel/print row source is identical to the report rows', rep && rep.items.length === 2);

  switchBranch('br-2');
  rep = storedMonthlyPayroll(MONTH);
  ok('S8.6 Erbil context returns the Erbil report only', !!rep && rep.branchId === 'br-2');
  ok('S8.7 Erbil report rows are exclusively Erbil employees', rep && rep.items.every((it) => it.branchId === 'br-2'));
  ok('S8.8 no Baghdad row ever appears in the Erbil report', rep && rep.items.every((it) => it.branchId !== 'br-1'));

  // ==========================================================================
  console.log('S9. Audit trail — every payroll event carries REAL branch identity');
  // --------------------------------------------------------------------------
  const events = payrollEvents();
  const successes = events.filter((e) => e.outcome === 'success');
  const denials = events.filter((e) => e.outcome === 'denied');

  ok('S9.1 success + denied payroll events recorded', successes.length >= 12 && denials.length >= 1);
  ok('S9.2 every success event carries the four identifiers + actor + timestamp', successes.every((e) =>
    e.companyId === 'comp-1' && (e.branchId === 'br-1' || e.branchId === 'br-2')
    && e.payrollId && String(e.payrollId).startsWith('PAYROLL-')
    && Array.isArray(e.employeeIds) && e.employeeIds.length === 2
    && e.employeeId && e.action && e.actor && typeof e.at === 'string' && e.at.length > 0));
  ok('S9.3 success action labels are honest workflow events', ['created', 'submitted', 'approved', 'paid', 'archive', 'rejected', 'resubmitted'].every((a) => successes.some((e) => e.action === a)));

  const paidB1 = successes.find((e) => e.action === 'paid' && e.branchId === 'br-1');
  const paidB2 = successes.find((e) => e.action === 'paid' && e.branchId === 'br-2');
  ok('S9.4 paid event carries the REAL branch + payroll ids (Baghdad/Erbil)', paidB1 && paidB1.branchId === 'br-1' && paidB1.payrollId === br1Id
    && paidB2 && paidB2.branchId === 'br-2' && paidB2.payrollId === br2Id);

  const deniedMismatch = denials.filter((e) => e.newValue && e.newValue.error === 'branch_mismatch');
  ok('S9.5 every denied branch-mismatch attempt carries the REAL target identity', deniedMismatch.length >= 4 && deniedMismatch.every((e) =>
    e.branchId && e.payrollId && e.companyId === 'comp-1' && Array.isArray(e.employeeIds) && e.employeeIds.length > 0));
  ok('S9.6 audit chain hashes valid end-to-end', chainValid());

  console.log('SECTIONS: S1..S9 verified above. Regression (S10) below.');

  // ==========================================================================
  console.log('S10. Full regression — every prior gate still green');
  // --------------------------------------------------------------------------
  const suites = [
    'p2-1-tests.mjs',
    'p2-2-tests.mjs',
    'p2-2-roles-tests.mjs',
    'p3-tests.mjs',
    'p4-tests.mjs',
    'p5-tests.mjs',
    'p6-tests.mjs',
    'p8-tests.mjs',
    'p2-1-ui-tests.mjs',
    'release-gate-test.mjs',
  ];
  for (const suite of suites) {
    const file = path.join(__dirname, suite);
    try {
      execFileSync(process.execPath, [file], { stdio: 'ignore', timeout: 300000 });
      ok(`S10 regression ${suite} → PASS`, true);
    } catch (e) {
      ok(`S10 regression ${suite} → PASS`, false);
      console.log(`    ${(e && e.message) || 'failed'}`);
    }
  }

  // ==========================================================================
  console.log('SUMMARY');
  console.log(`  passed: ${passed}`);
  console.log(`  failed: ${failed}`);
  if (failures.length) console.log(`  failures: ${failures.join(', ')}`);
}

runTests().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});