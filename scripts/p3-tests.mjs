// =========================================================
// P3 Test Matrix — Payroll Audit Data Model (Phase 3, Spec v1.0).
// Usage: node scripts/p3-tests.mjs   (npm run p3:test)
//
// Verifies the Phase 3 approved deliverables, additively layered on the
// Phase 1 engine with NO behavior change:
//   1. record creation (+ payrollSchema marker)
//   2. original financial values saved (sealed baseline, never overwritten)
//   3. rejection history (snapshot + rejected version with financial snapshot)
//   4. correction history (old → new, user/timestamp/reason)
//   5. version history (per-version sealed financial snapshots + explicit links)
//   6. old → new value tracking (item + summary level)
//   7. user + timestamp + reason on every recorded change
//   8. resubmission history (explicit R → C → R rounds)
//   9. backward compatibility (legacy record upgraded read-only, untouched)
//   10. no data loss on update (baseline + history survive save/load)
//   11. historical versions cannot break the audit trail (sealed deep copies)
// =========================================================

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
  };
}
if (!globalThis.window) globalThis.window = globalThis;

const JS = 'file:///C:/Users/Pc%20Zone/Desktop/hr/public/js/';

let passed = 0;
let failed = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}`); }
};

const { storage } = await import(`${JS}storage.js`);
const { defaultCompanies, defaultSettings } = await import(`${JS}seedData.js`);
const { generateMonthlyPayroll, transitionPayroll, recordPayrollCorrection, archivePayrollBatch } = await import(`${JS}engines/payrollEngine.js`);
const {
  PAYROLL_SCHEMA,
  versionChain,
  resubmissionRounds,
  originalFinancialValues,
  financialChangeLog,
  normalizeRecord,
  financialSnapshot,
  seal,
} = await import(`${JS}engines/payrollDataModel.js`);

const MONTH = '2026-09';
store.clear();
storage.seedIfMissing();
storage.saveCompanies(defaultCompanies);
storage.saveSettings({ ...defaultSettings, currency: 'USD', currencySymbol: '$', dailyRateMethod: 'fixed30' });
storage.saveAttendance([]);
storage.saveLeaves([]);
storage.saveHourlyLeaves([]);
storage.saveOvertime([]);
storage.saveHolidays([]);
storage.saveLoans([]);

const mkEmp = (id) => ({
  id,
  fullName: `Emp ${id}`,
  fullNameEn: `Emp ${id} En`,
  companyId: 'comp-1',
  branchId: 'br-1',
  department: 'IT',
  jobTitle: 'Engineer',
  hireDate: '2018-01-01',
  status: 'active',
  contractType: 'full_time',
  basicSalary: 6000,
  housingAllowance: 1500,
  transportAllowance: 600,
  otherAllowances: 0,
  gender: 'male',
});
storage.saveEmployees([mkEmp('p3-a'), mkEmp('p3-b')]);

const EMP_MONTHS = (it) => it.month === MONTH;
const totalNetOf = (b) => (b.items || []).reduce((s, i) => s + (Number(i.netSalary) || 0), 0);

console.log('  [P3.1 record creation]');
const t0 = generateMonthlyPayroll(
  storage.getState().employees,
  [], [], [],
  { month: MONTH, companies: defaultCompanies },
  storage.getState().settings
);
ok('batch generated as a draft with items + totals', t0.status === 'draft' && t0.items.length === 2 && t0.totalNet > 0);
ok('every item carries monetary fields', t0.items.every((it) => it.grossSalary > 0 && typeof it.netSalary === 'number'));

console.log('  [P3.2 original financial values saved on first submission]');
const s1 = transitionPayroll(t0, 'under_audit', { by: 'HR-Aya', rejectionReason: 'first submission' });
ok('submit ok', s1.ok === true && s1.batch.status === 'under_audit');
const b1 = s1.batch;
ok('schema marker stamped', b1.payrollSchema === PAYROLL_SCHEMA);
ok('baseline snapshot captured on first submit', !!b1.baselineSnapshot && b1.baselineSnapshot.baselineSource === 'first_submit');
ok('baseline sealed at submission metadata', b1.baselineSnapshot.capturedStatus === 'under_audit' && b1.baselineSnapshot.capturedBy === 'HR-Aya');
ok('baseline preserves ORIGINAL totals', b1.baselineSnapshot.totalNet === t0.totalNet);
ok('baseline preserves ORIGINAL per-item values', b1.baselineSnapshot.items[0].grossSalary === t0.items[0].grossSalary && b1.baselineSnapshot.items[0].netSalary === t0.items[0].netSalary);
ok('baseline is deep-independent (sealed)', (() => { const snap = financialSnapshot(b1); snap.items[0].netSalary = -1; return b1.items[0].netSalary > 0 && b1.baselineSnapshot.items[0].netSalary > 0; })());

console.log('  [P3.3 rejection history]');
const r2 = transitionPayroll(b1, 'rejected', { by: 'Audit-Khaled', rejectionReason: 'Review overtime entries', auditNotes: 'missing approvals' });
ok('reject ok', r2.ok === true && r2.batch.status === 'rejected');
const b2 = r2.batch;
ok('rejectedSnapshot stored', !!b2.rejectedSnapshot && b2.rejectedSnapshot.items.length === b2.items.length);
ok('rejection stamped with user/time/reason', b2.rejectedBy === 'Audit-Khaled' && b2.rejectedAt && b2.rejectionReason === 'Review overtime entries');
ok('rejected version appended with sealed financial snapshot', b2.versions.length === 2 && b2.versions[1].type === 'rejected' && b2.versions[1].status === 'rejected');
ok('rejected version carries point-in-time snapshot', b2.versions[1].financialSnapshot.totalNet === b1.totalNet);
ok('rejected version linked to previous', b2.versions[1].prevVersionId === b2.versions[0].versionId);
ok('previous version back-links the rejection', b2.versions[0].nextVersionId === b2.versions[1].versionId);

console.log('  [P3.4 correction history + P3.6 old → new]');
const toFix = { ...b2, items: b2.items.map((it) => ({ ...it })) };
toFix.items[0].overtimeAmount = 300;
toFix.items[0].grossSalary = 8400;
toFix.items[0].netSalary = 8400;
toFix.totalGross = 8100 + 8400;
toFix.totalNet = 8100 + 8400;
toFix.totalsByCurrency = (b2.totalsByCurrency || []).map((g) => ({ ...g, gross: 8100 + 8400, net: 8100 + 8400, deductions: 0 }));
const c3 = recordPayrollCorrection(b2, toFix, { by: 'HR-Aya', reason: 'Added approved overtime for emp-p3-a' });
ok('correction accepted on returned batch', c3.ok === true && c3.batch.status === 'rejected');
const b3 = c3.batch;
ok('correction recorded old→new per field', b3.corrections.length === 1 && b3.corrections[0].changes.some((ch) => ch.field === 'overtimeAmount' && ch.oldValue === 0 && ch.newValue === 300));
ok('correction recorded user/timestamp/reason', b3.corrections[0].by === 'HR-Aya' && !!b3.corrections[0].at && b3.corrections[0].reason === 'Added approved overtime for emp-p3-a');
ok('correction tracked old net → new net', b3.corrections[0].changes.some((ch) => ch.field === 'netSalary' && ch.oldValue === 8100 && ch.newValue === 8400));
ok('corrected version appended', b3.versions.length === 3 && b3.versions[2].type === 'corrected' && b3.versions[2].prevVersionId === b3.versions[1].versionId);
ok('corrected version snapshot reflects the new values', b3.versions[2].financialSnapshot.items[0].netSalary === 8400 && b3.versions[2].financialSnapshot.totalNet === 8100 + 8400);
ok('rejected version back-links the correction', b3.versions[1].nextVersionId === b3.versions[2].versionId);

console.log('  [P3.10 baseline never overwritten after update/correction]');
ok('original totalNet preserved despite correction', b3.baselineSnapshot.totalNet === t0.totalNet);
ok('original per-item values preserved despite correction', b3.baselineSnapshot.items[0].netSalary === 8100);
ok('current totals now differ (no data lost, both eras kept)', b3.totalNet === 8100 + 8400 && originalFinancialValues(b3).totalNet === t0.totalNet);

console.log('  [P3.5 version history — sealed per-version snapshots]');
const chain = versionChain(b3);
ok('every version has a stable versionId', chain.map((v) => v.versionId).join(',') === 'V1,V2,V3');
ok('every version exposes its post transition status', chain.map((v) => v.status).join(',') === 'under_audit,rejected,rejected');
ok('V1 snapshot = original, V3 snapshot = corrected (old→new at summary level)', chain[0].summary.totalNet === 16200 && chain[2].summary.totalNet === 16500);
ok('version history is ordered and fully linked', chain[0].prevVersionId === null && chain[0].nextVersionId === 'V2' && chain[2].prevVersionId === 'V2' && chain[2].nextVersionId === null);

console.log('  [P3.8 resubmission history — explicit R → C → R round]');
const u4 = transitionPayroll(b3, 'under_audit', { by: 'HR-Aya', rejectionReason: 'Corrected overtime, resubmitting' });
ok('resubmit ok', u4.ok === true && u4.batch.status === 'under_audit');
const b4 = u4.batch;
ok('resubmitted version appended with correct type', b4.versions[3].type === 'resubmitted' && b4.versions[3].status === 'under_audit');
ok('resubmitted version linked to corrected version', b4.versions[3].prevVersionId === 'V3' && b4.versions[3].nextVersionId === null);
ok('corrected version links forward to resubmitted', b4.versions[2].nextVersionId === 'V4');
ok('types chain preserved (backward compatible with P2.2 assertions)', b4.versions.map((v) => v.type).join(',') === 'under_audit,rejected,corrected,resubmitted');
const rounds = resubmissionRounds(b4);
ok('resubmissionRounds returns the explicit round', rounds.length === 1 && rounds[0].rejected === 'V2' && rounds[0].corrected === 'V3' && rounds[0].resubmitted === 'V4');

console.log('  [P3.7 approval + payment + archive references (user/time/reason)]');
const a5 = transitionPayroll(b4, 'approved', { by: 'Audit-Khaled', rejectionReason: 'approved for payment' });
ok('approve ok', a5.ok === true && a5.batch.status === 'approved');
const b5 = a5.batch;
ok('approval reference recorded', b5.approvalReference && b5.approvalReference.approvedBy === 'Audit-Khaled' && b5.approvalReference.versionId === 'V5' && !!b5.approvalReference.approvedAt);
const p6 = transitionPayroll(b5, 'paid', { by: 'Pay-Omar', referenceId: 'PAY-REF-P3-1' });
ok('paid ok', p6.ok === true && p6.batch.status === 'paid');
const b6 = p6.batch;
ok('payment reference recorded (no payment queue entity)', b6.paymentReference && b6.paymentReference.referenceId === 'PAY-REF-P3-1' && b6.paymentReference.executedBy === 'Pay-Omar' && b6.paymentReference.status === 'disbursed' && b6.paymentReference.versionId === 'V6');
ok('payment reference carries per-currency amounts', b6.paymentReference.amounts.length === 1 && b6.paymentReference.amounts[0].net === 16500);
const g7 = archivePayrollBatch(b6, { by: 'Super-Adel', reason: 'archived after disbursement' });
ok('archive ok', g7.ok === true && g7.batch.archived === true);
const b7 = g7.batch;
ok('archive reference recorded', b7.archiveReference && b7.archiveReference.archivedBy === 'Super-Adel' && !!b7.archiveReference.archivedAt);

console.log('  [P3.10 no data loss through the storage save/load path]');
storage.addPayrollBatch(b7);
const loaded = storage.getState().payrolls.find((b) => b.month === MONTH);
ok('stored record survives save + read', !!loaded && loaded.status === 'paid' && loaded.archived === true);
ok('baseline survives save/load', loaded.baselineSnapshot && loaded.baselineSnapshot.totalNet === 16200);
ok('rejection history survives save/load', loaded.rejectedSnapshot && loaded.rejectedBy === 'Audit-Khaled');
ok('correction history survives save/load', loaded.corrections && loaded.corrections[0].changes.length > 0);
ok('version history survives save/load with links + snapshots', loaded.versions.length === 6 && loaded.versions[3].prevVersionId === 'V3' && !!loaded.versions[2].financialSnapshot);
ok('payment/approval/archive references survive save/load', loaded.approvalReference.versionId === 'V5' && loaded.paymentReference.referenceId === 'PAY-REF-P3-1' && loaded.archiveReference.archivedBy === 'Super-Adel');
ok('ledger stays append-only and replicates history', (() => { const log = financialChangeLog(loaded); return log.length === 7 && log.map((e) => e.kind).join(',') === 'under_audit,rejected,corrected,under_audit,approved,paid,archive' && log[3].versionId === 'V4'; })());
ok('corrected ledger event attaches the field changes', financialChangeLog(loaded)[2].changes.some((ch) => ch.field === 'overtimeAmount' && ch.oldValue === 0 && ch.newValue === 300));
ok('every ledger event carries user + timestamp + version', financialChangeLog(loaded).every((e) => !!e.at && !!e.by && e.versionId));

console.log('  [P3.11 historical versions cannot break the audit trail]');
const evil = seal(b7);
evil.versions[1].financialSnapshot.items[0].netSalary = -99999;
evil.versions[1].totalNet = -99999;
evil.versions[2].financialSnapshot = { totalNet: -1 };
evil.auditHistory[1].reason = 'FORGED';
ok('mutating a historical version snapshot does not change the baseline', b7.baselineSnapshot.items[0].netSalary === 8100 && b7.baselineSnapshot.totalNet === 16200);
ok('mutating one version snapshot does not leak into sibling versions', b7.versions[0].financialSnapshot.items[0].netSalary === 8100 && b7.versions[3].financialSnapshot.totalNet === 16500);
ok('original financial values remain from the sealed baseline', originalFinancialValues(b7).totalNet === 16200);
ok('ledger is derived from independent authoritative fields, not the forged copy', financialChangeLog(b7)[1].reason !== 'FORGED' && financialChangeLog(b7).length === 7);
ok('the stored record itself was returned in a pristine copy', b7.auditHistory[1].reason !== 'FORGED' && b7.versions[1].financialSnapshot.items[0].netSalary === 8100);

console.log('  [P3.9 backward compatibility — legacy record upgraded read-only]');
const legacyVersions = [
  { type: 'under_audit', version: 1, by: 'HR-Aya', at: '2026-09-01T08:00:00.000Z', reason: '' },
  { type: 'rejected', version: 2, by: 'Audit-Khaled', at: '2026-09-02T08:00:00.000Z', reason: 'legacy reject' },
  { type: 'corrected', version: 3, by: 'HR-Aya', at: '2026-09-03T08:00:00.000Z', reason: 'legacy correction' },
  { type: 'resubmitted', version: 4, by: 'HR-Aya', at: '2026-09-04T08:00:00.000Z', reason: '' },
  { type: 'approved', version: 5, by: 'Audit-Khaled', at: '2026-09-05T08:00:00.000Z', reason: '' },
  { type: 'paid', version: 6, by: 'Pay-Omar', at: '2026-09-06T08:00:00.000Z', reason: '' },
];
const legacy = {
  id: `PAYROLL-${MONTH}`,
  month: MONTH,
  status: 'paid',
  revision: 6,
  totalGross: 16200, totalDeductions: 0, totalNet: 16200,
  items: [
    { employeeId: 'p3-a', employeeName: 'Emp p3-a', netSalary: 8100, grossSalary: 8100, overtimeAmount: 0, currency: 'USD' },
    { employeeId: 'p3-b', employeeName: 'Emp p3-b', netSalary: 8100, grossSalary: 8100, overtimeAmount: 0, currency: 'USD' },
  ],
  auditHistory: [
    { action: 'under_audit', from: 'draft', to: 'under_audit', by: 'HR-Aya', at: '2026-09-01T08:00:00.000Z', reason: '', revision: 1 },
    { action: 'rejected', from: 'under_audit', to: 'rejected', by: 'Audit-Khaled', at: '2026-09-02T08:00:00.000Z', reason: 'legacy reject', revision: 2 },
    { action: 'corrected', from: 'rejected', to: 'rejected', by: 'HR-Aya', at: '2026-09-03T08:00:00.000Z', reason: 'legacy correction', revision: 3 },
    { action: 'under_audit', from: 'rejected', to: 'under_audit', by: 'HR-Aya', at: '2026-09-04T08:00:00.000Z', reason: '', revision: 4 },
    { action: 'approved', from: 'under_audit', to: 'approved', by: 'Audit-Khaled', at: '2026-09-05T08:00:00.000Z', reason: '', revision: 5 },
    { action: 'paid', from: 'approved', to: 'paid', by: 'Pay-Omar', at: '2026-09-06T08:00:00.000Z', reason: '', revision: 6 },
  ],
  versions: legacyVersions,
  corrections: [],
  rejectedSnapshot: { status: 'rejected', totalNet: 16200, items: legacyVersions.slice(0, 2).map(() => ({ employeeId: 'p3-a', employeeName: 'Emp p3-a', netSalary: 8100, grossSalary: 8100, overtimeAmount: 0 })) },
  totalsByCurrency: [{ code: 'USD', symbol: '$', gross: 16200, deductions: 0, net: 16200, count: 2 }],
};
const legacyBefore = JSON.stringify(legacy);
const upgraded = normalizeRecord(legacy);
ok('legacy input record is never mutated', JSON.stringify(legacy) === legacyBefore);
ok('legacy readable with p3 schema marker', upgraded.payrollSchema === PAYROLL_SCHEMA && upgraded.recordModel === 'p3');
ok('legacy version ids are derived deterministically', upgraded.versions.map((v) => v.versionId).join(',') === 'V1,V2,V3,V4,V5,V6');
ok('legacy versions get explicit links from order', upgraded.versions[2].prevVersionId === 'V2' && upgraded.versions[2].nextVersionId === 'V4' && upgraded.versions[0].prevVersionId === null);
ok('legacy version status recovered from its audit entry', upgraded.versions.map((v) => v.status).join(',') === 'under_audit,rejected,rejected,under_audit,approved,paid');
ok('legacy tail snapshot synthesized without fabricating middle history', !!upgraded.versions[5].financialSnapshot.synthesized && upgraded.versions[1].financialSnapshot === undefined);
ok('normalization is idempotent (stable projection)', JSON.stringify(normalizeRecord(upgraded).versions.map((v) => v.versionId)) === JSON.stringify(upgraded.versions.map((v) => v.versionId)));
ok('legacy original financial values fall back to the rejected snapshot', (() => { const v = originalFinancialValues(upgraded); return v !== null && typeof v.totalNet === 'number'; })());
ok('normalize never breaks reads on corrupt records', normalizeRecord(null) === null && normalizeRecord(undefined) === undefined && JSON.stringify(normalizeRecord({ versions: null })) !== 'null');

console.log(`\nP3 tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failed assertions:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}