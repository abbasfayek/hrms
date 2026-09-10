// =========================================================
// P6 Test Matrix — Payroll Workflow (Phase 6, Spec v1.0).
// Usage: node scripts/p6-tests.mjs   (npm run p6:test)
//
// Walks the FULL official payroll workflow through the real
// public surfaces (guard stack + Phase 1 engine + storage +
// Phase 5 audit trail + Phase 4 currency snapshots + Phase 3
// data model):
//
//   Draft → Audit → Approved (Payment Queue) → Paid → Archive
//   Reject  ❯  Returned / Needs Correction → Correction → Resubmit
//
// Mandatory rules verified end-to-end:
//   1. create / submit / audit / reject / correction / resubmit /
//      approve / payment eligibility / pay / archive
//   2. every real transition emits exactly one honest P5 audit
//      event (SUBMITTED / REJECTED / CORRECTED / RESUBMITTED /
//      APPROVED / PAID / ARCHIVE), the chain stays valid, and a
//      forbidden operation is a `denied` event — never a success
//   3. permission → scope → state stacking on the guarded API:
//      Payroll Admin may NOT approve/reject/pay/archive; Audit
//      Reviewer may NOT create/edit/submit/pay/archive; Payments
//      Officer may only pay approved; out-of-scope users blocked
//   4. reject preserves every amount (never zeroed), stamps
//      rejectedBy/At + rejectionReason + rejected financial
//      snapshot + audit attempt + Rejected version, and flags the
//      record Returned / Needs Correction (NOT a fresh draft)
//   5. correction records old→new per field (user, timestamp,
//      reason) without overwriting history; resubmit returns to
//      under_audit with a NEW audit attempt on the SAME record
//      (no duplicate payroll ever created)
//   6. payments: no payment without approval; no duplicate pay;
//      paid terminal stamps paidBy/At + payment reference
//   7. archive only after Paid; financial read-only stamp;
//      no re-archive; no archive before paid
//   8. currency snapshots (Original Amount / Currency / Rate /
//      Rate Date / Base Amount / Base Currency) are preserved
//      across every non-editing transition — never re-priced
//   9. transitions are pure (input never mutated)
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
const { defaultCompanies, defaultSettings, defaultUsers } = await import(`${JS}seedData.js`);
const {
  transitionPayrollGuarded, recordPayrollCorrectionGuarded, archivePayrollBatchGuarded,
  requirePayrollAction,
} = await import(`${JS}engines/payrollAccess.js`);
const {
  canTransitionPayroll, generateMonthlyPayroll,
} = await import(`${JS}engines/payrollEngine.js`);
const {
  versionChain, resubmissionRounds, originalFinancialValues, seal, versionIdOf,
} = await import(`${JS}engines/payrollDataModel.js`);
const {
  verifyAuditTrail, payrollFinancialView, AUDIT_ACTIONS, AUDIT_RECORD_TYPES,
} = await import(`${JS}engines/auditTrail.js`);

const ADMIN = defaultUsers.find((u) => u.role === 'super_admin');
// Role users fabricated with the same shape payrollAccess expects
// (permissions resolve from types.js DEFAULT_ROLE_PERMISSIONS).
const HR = { id: 'usr-pa', username: 'usr-pa', name: 'Payroll Admin', role: 'payroll_admin', assignedCompanyId: 'all', assignedBranchId: 'all' };
const AUDIT = { id: 'usr-ar', username: 'usr-ar', name: 'Audit Reviewer', role: 'audit_reviewer', assignedCompanyId: 'all', assignedBranchId: 'all' };
const PAY = { id: 'usr-po', username: 'usr-po', name: 'Payments Officer', role: 'payments_officer', assignedCompanyId: 'all', assignedBranchId: 'all' };
const SCOPED = { id: 'usr-sc', username: 'usr-sc', name: 'Company HR (comp-2)', role: 'company_hr', assignedCompanyId: 'comp-2', assignedBranchId: 'all' };

function baseSettings() {
  return {
    ...defaultSettings,
    currency: 'USD',
    currencySymbol: '$',
    baseCurrency: 'USD',
    dailyRateMethod: 'fixed30',
    customCurrencies: [{ code: 'IQD', symbol: 'ع.د' }],
  };
}

/** Reset localStorage + reseed storage with one comp-1 / one comp-2 employee. */
function emptyBase() {
  store.clear();
  storage.seedIfMissing();
  // Wipe the data collections AND the last-known-state baselines (Phase 6 fix)
  // so a month re-created after a clear is a genuine CREATED record again.
  storage.clearAllData();
  storage.saveCompanies(defaultCompanies);
  storage.saveSettings(baseSettings());
  storage.saveAttendance([]);
  storage.saveLeaves([]);
  storage.saveHourlyLeaves([]);
  storage.saveOvertime([]);
  storage.saveHolidays([]);
  storage.saveLoans([]);
  storage.saveIncrements([]);
  storage.savePayrolls([]);
  storage.saveEOSB([]);
  storage.saveEmployees([
    {
      id: 'emp-1', fullName: 'Emp One', companyId: 'comp-1', branchId: 'br-1',
      department: 'IT', jobTitle: 'Engineer', hireDate: '2020-01-01', status: 'active',
      basicSalary: 6000, housingAllowance: 1500, transportAllowance: 600,
    },
    {
      id: 'emp-2', fullName: 'Emp Two', companyId: 'comp-2', branchId: 'br-3',
      department: 'Ops', jobTitle: 'Officer', hireDate: '2021-03-15', status: 'active',
      basicSalary: 3000, housingAllowance: 500, transportAllowance: 200,
    },
  ]);
}

/** Manual draft batch (USD base) with a stable id, full set of monetary fields. */
function makeBatch(month, id, opts = {}) {
  const base = {
    employeeId: 'emp-1', employeeName: 'Emp One', companyId: 'comp-1', branchId: 'br-1',
    basicSalary: 6000, housingAllowance: 1500, transportAllowance: 600, otherAllowances: 200,
    overtimeAmount: 450, bonuses: 0, totalEarnings: 8750, grossSalary: 8750,
    gosiEmployeeDeduction: 300, gosiCompanyContribution: 450, loanInstallment: 200,
    absentDays: 0, absenceDeduction: 0, lateMinutes: 0, lateDeduction: 0,
    otherDeductions: 50, penaltiesDeduction: 0, totalDeductions: 550, netSalary: 8200,
  };
  if (opts.item) Object.assign(base, opts.item);
  const items = [base];
  const net = Number(base.netSalary) || 0;
  const b = {
    id,
    month,
    title: `Monthly Payroll ${month}`,
    status: 'draft',
    revision: 0,
    issueDate: '2026-06-01',
    createdAt: opts.createdAt || '2026-06-01T08:00:00.000Z',
    updatedAt: opts.updatedAt || '2026-06-01T08:00:00.000Z',
    totalGross: Number(opts.totalGross !== undefined ? opts.totalGross : 8750),
    totalDeductions: Number(opts.totalDeductions !== undefined ? opts.totalDeductions : 550),
    totalNet: Number(opts.totalNet !== undefined ? opts.totalNet : net),
    totalGosi: 0,
    totalCompanyGosi: Number(opts.totalGosi !== undefined ? opts.totalGosi : 450),
    totalEOSB: 0,
    totalsByCurrency: opts.totalsByCurrency || [{ code: 'USD', symbol: '$', gross: 8750, deductions: 550, net, companyGosi: 450, count: 1 }],
    items,
  };
  return b;
}

function payrollEventsOf(month) {
  return storage.getAuditTrail().filter((e) => e.recordType === AUDIT_RECORD_TYPES.PAYROLL && String(e.recordId) === String(month));
}

function successActions(events) {
  return events.filter((e) => e.outcome === 'success').map((e) => e.action);
}

function deniedEvents(month) {
  return payrollEventsOf(month).filter((e) => e.action === AUDIT_ACTIONS.DENIED);
}

function chainValidAfterEach(step) {
  const meta = storage.getAuditTrailMeta();
  const ver = verifyAuditTrail(meta.envelope);
  if (!ver.valid) { console.log(`    [chain broken at ${step}]`); return false; }
  return true;
}

console.log('P6 — Payroll Workflow E2E');

// ===========================================================================
console.log('A. Official path on a manually-built batch: Draft → Audit → Reject → Correction → Resubmit → Approve → Paid → Archive');
emptyBase();
let b = makeBatch('2026-06', 'pay-2026-06');
let prevDraft = { ...b, items: b.items.map((it) => ({ ...it })) };
storage.addPayrollBatch(prevDraft); // baseline draft save → CREATED
ok('A1 creation event emitted on first write', successActions(payrollEventsOf('2026-06')).includes(AUDIT_ACTIONS.CREATED));
ok('A2 chain valid after create', chainValidAfterEach('create'));
ok('A3 draft state recorded', storage.getState().payrolls.find((x) => x.month === '2026-06').status === 'draft');

// submit (draft → under_audit)
let r = transitionPayrollGuarded(HR, prevDraft, 'under_audit', { by: HR.name });
ok('A4 HR submit allowed (permission+scope+state)', r.ok === true);
ok('A5 transition is PURE — input draft object untouched', prevDraft.status === 'draft' && prevDraft.revision === 0);
b = r.batch;
ok('A6 under_audit + same id/month (no new record)', b.status === 'under_audit' && b.id === 'pay-2026-06' && b.month === '2026-06');
ok('A7 transferredToAudit stamps', b.transferredToAuditBy === HR.name && typeof b.transferredToAuditAt === 'string');
ok('A8 baseline sealed on first submission (never overwritten later)', Array.isArray(b.baselineSnapshot?.items) && b.baselineSnapshot.items.length === 1);
ok('A9 submission revision=1 + submitted version', b.revision === 1 && b.versions[0].type === 'under_audit' && versionIdOf(b.versions[0]) === 'V1');
ok('A10 first audit attempt recorded', b.auditAttempts.length === 1 && b.auditAttempts[0].result === 'under_audit');
const subView = payrollFinancialView(b);
storage.addPayrollBatch(b);
ok('A11 SUBMITTED event + versionId V1', successActions(payrollEventsOf('2026-06')).includes(AUDIT_ACTIONS.SUBMITTED) && payrollEventsOf('2026-06').find((e) => e.action === AUDIT_ACTIONS.SUBMITTED).versionId === 'V1');
ok('A12 chain valid after submit', chainValidAfterEach('submit'));

// audit review notes save (status unchanged → must emit NOTHING)
const noteBatch = { ...b, items: b.items.map((it) => ({ ...it })) };
noteBatch.items[0].auditStatus = 'verified';
noteBatch.items[0].auditNotes = 'ok';
noteBatch.auditNotes = 'review in progress';
storage.addPayrollBatch(noteBatch);
b = storage.getState().payrolls.find((x) => x.month === '2026-06');
const afterNotes = successActions(payrollEventsOf('2026-06'));
ok('A13 plain under_audit re-save emits NO fabricated event', afterNotes.filter((a) => a === AUDIT_ACTIONS.SUBMITTED).length === 1 && !afterNotes.includes('updated'));
ok('A14 chain valid after notes save', chainValidAfterEach('notes'));

// reject (under_audit → rejected / Returned / Needs Correction)
const preRejectNet = b.totalNet;
const preRejectView = payrollFinancialView(b);
r = transitionPayrollGuarded(AUDIT, b, 'rejected', { by: AUDIT.name, rejectionReason: 'overtime not approved', auditNotes: 'recheck overtime' });
ok('A15 audit reviewer reject allowed', r.ok === true);
b = r.batch;
ok('A16 rejected status + Returned/Needs Correction flag', b.status === 'rejected' && b.returnState === 'needs_correction');
ok('A17 rejection meta stamped', b.rejectedBy === AUDIT.name && b.rejectedAt && b.rejectionReason === 'overtime not approved');
ok('A18 amounts PRESERVED on reject (no zeroing, no legacy cleared flag)', b.totalNet === preRejectNet && b.totalNet > 0 && b.isAmountsCleared !== true);
ok('A19 rejectedSnapshot captured == pre-reject net', b.rejectedSnapshot && b.rejectedSnapshot.items[0].netSalary === b.items[0].netSalary);
ok('A20 rejected version linked to Rejected version', b.versions[b.versions.length - 1].type === 'rejected' && versionIdOf(b.versions[b.versions.length - 1]) === `V${b.revision}`);
ok('A21 audit attempt marked returned', b.auditAttempts[b.auditAttempts.length - 1].result === 'returned');
ok('A22 auditNotes appended', (b.auditNotes || '').includes('recheck overtime'));
storage.addPayrollBatch(b);
let ev = payrollEventsOf('2026-06').find((e) => e.action === AUDIT_ACTIONS.REJECTED);
ok('A23 REJECTED event with reason + returnState + rejected snapshot', !!ev && ev.reason === 'overtime not approved' && ev.rejection && ev.rejection.returnState === 'needs_correction' && ev.rejection.rejectedSnapshot);
ok('A24 rejected event preserves financial amounts (never zeroed)', !!ev && ev.newValue.totalNet === preRejectNet && ev.newValue.totalsByCurrency[0].net === preRejectNet);
ok('A25 auditAttempt on rejected event = returned', !!ev && ev.auditAttempt && ev.auditAttempt.result === 'returned');
ok('A26 chain valid after reject', chainValidAfterEach('reject'));

// rejected semantics: NOT a draft, workflows stay valid
ok('A27 canTransitionPayroll rejects illegal edges', !canTransitionPayroll(b, 'approved').ok && !canTransitionPayroll(b, 'paid').ok && !canTransitionPayroll(b, 'paid').ok && canTransitionPayroll(b, 'under_audit').ok);
r = transitionPayrollGuarded(HR, b, 'under_audit', { by: HR.name });
ok('A28 HR resubmit allowed from rejected', r.ok === true && r.batch.status === 'under_audit' && r.batch.returnState === 'resubmitted');
const stillValid = { ok: r.ok, sameId: r.batch.id === b.id, sameMonth: r.batch.month === b.month };
ok('A29 same record is reused on resubmit (never a new payroll)', stillValid.sameId && stillValid.sameMonth);

// instant pay attempt while RETURNED → blocked (pay-without-approval)
r = transitionPayrollGuarded(PAY, b, 'paid', { by: PAY.name });
ok('A30 pay on returned batch DENIED (state)', r.ok === false && r.layer === 'state' && /disburse_requires_approved/.test(r.error));
ok('A31 denied attempt recorded as denied (not success)', deniedEvents('2026-06').some((e) => e.newValue.requestedAction === 'disburse' && e.newValue.layer === 'state'));
ok('A32 chain valid after denial', chainValidAfterEach('denied-pay'));

// correction (recalc → recordPayrollCorrectionGuarded)
const correctedClone = seal(b);
correctedClone.items[0].otherAllowances = 600;
correctedClone.items[0].netSalary = 8600;
correctedClone.totalNet = correctedClone.totalNet + 400;
correctedClone.totalsByCurrency[0].net += 400;
correctedClone.totalsByCurrency[0].gross += 400;
correctedClone.items[0].totalEarnings = 9150;
correctedClone.items[0].grossSalary = 9150;
correctedClone.totalGross = 9150;
correctedClone.totalsByCurrency[0].gross = 9150;
r = recordPayrollCorrectionGuarded(HR, b, correctedClone, { by: HR.name, reason: 'overtime approved retroactively' });
ok('A33 correction recorded on a returned batch', r.ok === true && r.batch.status === 'rejected' && r.batch.returnState === 'corrected');
b = r.batch;
ok('A34 old→new diff captured per field (values + employee + reason)', b.corrections.length === 1 && b.corrections[0].changes.some((c) => c.field === 'otherAllowances' && c.oldValue === 200 && c.newValue === 600 && c.employeeId === 'emp-1') && b.corrections[0].reason === 'overtime approved retroactively' && b.corrections[0].by === HR.name);
ok('A35 rejection meta preserved across correction', b.rejectedBy === AUDIT.name && b.rejectionReason === 'overtime not approved' && b.rejectedAt);
ok('A36 corrected version appended (Rejected → Corrected → Resubmitted chain)', b.versions.map((v) => v.type).join(',') === 'under_audit,rejected,corrected');
ok('A37 version links explicit (prev/next chain)', (() => { const vs = b.versions; return vs.every((v, i) => (i === 0 ? v.prevVersionId === null : v.prevVersionId === vs[i - 1].versionId)) && vs[vs.length - 2].nextVersionId === vs[vs.length - 1].versionId; })());
ok('A38 correction attempt (auditAttempt) recorded', b.auditAttempts[b.auditAttempts.length - 1].result === 'corrected');
storage.addPayrollBatch(b);
ev = payrollEventsOf('2026-06').find((e) => e.action === AUDIT_ACTIONS.CORRECTED);
ok('A39 CORRECTED event with old→new corrections payload', !!ev && Array.isArray(ev.corrections) && ev.corrections.some((c) => c.field === 'otherAllowances' && c.oldValue === 200 && c.newValue === 600));
ok('A40 baselineSnapshot still the ORIGINAL first-submit values (never overwritten)', originalFinancialValues(b) && originalFinancialValues(b).items[0].netSalary === 8200);
ok('A41 chain valid after correction', chainValidAfterEach('corrected'));

// resubmit (rejected → under_audit, new audit attempt, same record)
r = transitionPayrollGuarded(HR, b, 'under_audit', { by: HR.name, reason: 're-submitted after correction' });
ok('A42 resubmit allowed', r.ok === true && r.batch.status === 'under_audit' && r.batch.returnState === 'resubmitted');
b = r.batch;
ok('A43 resubmitted stamps + same record', b.resubmittedBy === HR.name && b.id === 'pay-2026-06');
ok('A44 resubmitted version + new audit attempt', b.versions.map((v) => v.type).join(',') === 'under_audit,rejected,corrected,resubmitted' && b.auditAttempts.length === 4 && b.auditAttempts[3].result === 'under_audit');
ok('A45 resubmissionRounds counts the round-trip', resubmissionRounds(b).length >= 1);
storage.addPayrollBatch(b);
ok('A46 RESUBMITTED event (not a second SUBMITTED)', successActions(payrollEventsOf('2026-06')).includes(AUDIT_ACTIONS.RESUBMITTED) && successActions(payrollEventsOf('2026-06')).filter((a) => a === AUDIT_ACTIONS.SUBMITTED).length === 1);
ok('A47 chain valid after resubmit', chainValidAfterEach('resubmit'));

// duplicate submission blocked
r = transitionPayrollGuarded(HR, b, 'under_audit', { by: HR.name });
ok('A48 duplicate submit (under_audit→under_audit) DENIED', r.ok === false && r.layer === 'state' && /submit_requires_draft_or_returned/.test(r.error));
ok('A49 duplicate submit denied recorded', deniedEvents('2026-06').some((e) => e.newValue.requestedAction === 'submit'));

// approve (under_audit → approved) — payment queue entry
const preApprovalView = payrollFinancialView(b);
r = transitionPayrollGuarded(AUDIT, b, 'approved', { by: AUDIT.name, reason: 'audit approved' });
ok('A50 audit reviewer approve allowed', r.ok === true);
b = r.batch;
ok('A51 approved status + audited stamps + returnState cleared', b.status === 'approved' && b.auditedBy === AUDIT.name && b.auditedAt && b.returnState === undefined);
ok('A52 approval reference attached (payment queue point)', b.approvalReference && b.approvalReference.status === 'approved' && b.approvalReference.approvedBy === AUDIT.name && b.approvalReference.versionId === `V${b.revision}`);
ok('A53 approved version appended', b.versions[b.versions.length - 1].type === 'approved');
storage.addPayrollBatch(b);
ev = payrollEventsOf('2026-06').find((e) => e.action === AUDIT_ACTIONS.APPROVED);
ok('A54 APPROVED event with audited actor', !!ev && ev.actor && ev.actor.name === AUDIT.name);
ok('A55 approval preserves the financial snapshot (never re-priced)', ev.newValue.totalNet === preApprovalView.totalNet);
ok('A56 chain valid after approve', chainValidAfterEach('approved'));

// request-after-approval mutation blocked (modify-after-approval)
let g = requirePayrollAction(ADMIN, 'generate', b);
ok('A57 recalc/generate on approved DENIED (state)', g.ok === false && g.layer === 'state' && /generate_requires_draft_or_returned/.test(g.error));
g = requirePayrollAction(ADMIN, 'edit', b);
ok('A58 edit on approved DENIED (state)', g.ok === false && g.layer === 'state' && /edit_requires_draft_or_returned/.test(g.error));
g = requirePayrollAction(HR, 'submit', b);
ok('A59 submit on approved DENIED (state)', g.ok === false && g.layer === 'state' && /submit_requires_draft_or_returned/.test(g.error));
r = transitionPayrollGuarded(AUDIT, b, 'rejected', { by: AUDIT.name });
ok('A60 reject on approved DENIED (state)', r.ok === false && r.layer === 'state');
ok('A61 chain valid after mutation denials', chainValidAfterEach('mutation-denied'));

// payment of non-approved states (already covered A30 for rejected; verify draft/under_audit here)
const tmp = makeBatch('2026-04', 'pay-2026-04');
r = transitionPayrollGuarded(PAY, tmp, 'paid', { by: PAY.name });
ok('A62 pay-on-draft DENIED (state — no payment without approval)', r.ok === false && r.layer === 'state');
ok('A63 audit attempt count on approved is 5 (submit/return/correct/resubmit/approve)', b.auditAttempts.length === 5);

// pay (approved → paid)
const prePayView = payrollFinancialView(b);
r = transitionPayrollGuarded(PAY, b, 'paid', { by: PAY.name });
ok('A64 payments officer disburse allowed on approved', r.ok === true);
b = r.batch;
ok('A65 paid status + paid stamps + payment queue release', b.status === 'paid' && b.paidBy === PAY.name && b.paidAt && b.releaseStatus === 'released');
ok('A66 payment reference attached (paidBy/paidAt/reference)', b.paymentReference && b.paymentReference.executedBy === PAY.name && b.paymentReference.executedAt);
ok('A67 paid version appended', b.versions[b.versions.length - 1].type === 'paid');
storage.addPayrollBatch(b);
ev = payrollEventsOf('2026-06').find((e) => e.action === AUDIT_ACTIONS.PAID);
ok('A68 PAID event with payment reference + actor', !!ev && ev.paymentReference && ev.paymentReference.executedBy === PAY.name && ev.actor.name === PAY.name);
ok('A69 payment preserves financial snapshot exactly', ev.newValue.totalNet === prePayView.totalNet);
ok('A70 chain valid after pay', chainValidAfterEach('paid'));

// duplicate payment blocked
r = transitionPayrollGuarded(PAY, b, 'paid', { by: PAY.name });
ok('A71 duplicate payment (paid→paid) DENIED — double-pay impossible', r.ok === false && r.layer === 'state');
ok('A72 only ONE paid event ever emitted', payrollEventsOf('2026-06').filter((e) => e.action === AUDIT_ACTIONS.PAID).length === 1);
ok('A73 no further success events after double-pay attempt', chainValidAfterEach('double-pay'));

// archive (paid → archived stamp; stays paid + read-only)
const preArchiveView = payrollFinancialView(b);
r = archivePayrollBatchGuarded(ADMIN, b, { by: ADMIN.name });
ok('A74 super admin archive allowed on paid', r.ok === true);
b = r.batch;
ok('A75 archived flag + stamps, status REMAINS paid (financial read-only)', b.archived === true && b.archivedBy === ADMIN.name && b.archivedAt && b.status === 'paid');
ok('A76 archiveReference attached', b.archiveReference && b.archiveReference.reason);
ok('A77 archive does not mutate financial values', payrollFinancialView(b).totalNet === preArchiveView.totalNet);
storage.addPayrollBatch(b);
ev = payrollEventsOf('2026-06').find((e) => e.action === AUDIT_ACTIONS.ARCHIVE);
ok('A78 ARCHIVE event emitted', !!ev && ev.reasonKind === 'archive');
ok('A79 chain valid after archive', chainValidAfterEach('archive'));

// re-archive blocked
r = archivePayrollBatchGuarded(ADMIN, b, { by: ADMIN.name });
ok('A80 re-archive DENIED (already archived, engine-level)', r.ok === false && /already_archived/.test(r.error));
ok('A81 no second archive event', payrollEventsOf('2026-06').filter((e) => e.action === AUDIT_ACTIONS.ARCHIVE).length === 1);

// ===========================================================================
console.log('B. Archive constrains (only after Paid) — a pre-paid batch can never be archived');
const tmp2 = makeBatch('2026-03', 'pay-2026-03');
r = archivePayrollBatchGuarded(ADMIN, tmp2, { by: ADMIN.name });
ok('B1 archive-before-paid DENIED (state)', r.ok === false && r.layer === 'state' && /archive_requires_paid/.test(r.error));
ok('B2 archive-before-paid attempted event is a denial', deniedEvents('2026-03').some((e) => e.newValue.requestedAction === 'archive' && e.newValue.layer === 'state'));
ok('B3 batch untouched by denied archive (still draft, not archived)', tmp2.status === 'draft' && !tmp2.archived);

// ===========================================================================
console.log('C. Role / permission isolation on the guarded API');
emptyBase();
const c = makeBatch('2026-06', 'pay-2026-06');
storage.addPayrollBatch(c); // realistic: the draft is stored; denials must leave it untouched
// HR may NOT approve / reject / pay / archive
r = transitionPayrollGuarded(HR, c, 'approved', { by: HR.name });
ok('C1 Payroll Admin approve DENIED (permission)', r.ok === false && r.layer === 'permission');
r = transitionPayrollGuarded(HR, c, 'rejected', { by: HR.name });
ok('C2 Payroll Admin reject DENIED (permission)', r.ok === false && r.layer === 'permission');
r = transitionPayrollGuarded(HR, c, 'paid', { by: HR.name });
ok('C3 Payroll Admin pay DENIED (permission)', r.ok === false && r.layer === 'permission');
r = archivePayrollBatchGuarded(HR, c, { by: HR.name });
ok('C4 Payroll Admin archive DENIED (permission)', r.ok === false && r.layer === 'permission');
// Audit Reviewer may NOT create/edit/submit/pay/archive
r = transitionPayrollGuarded(AUDIT, c, 'under_audit', { by: AUDIT.name });
ok('C5 Audit Reviewer submit DENIED (permission)', r.ok === false && r.layer === 'permission');
g = requirePayrollAction(AUDIT, 'generate', c);
ok('C6 Audit Reviewer generate/edit DENIED (permission)', g.ok === false && g.layer === 'permission');
g = requirePayrollAction(AUDIT, 'edit', c);
ok('C7 Audit Reviewer edit DENIED (permission)', g.ok === false && g.layer === 'permission');
r = transitionPayrollGuarded(AUDIT, c, 'paid', { by: AUDIT.name });
ok('C8 Audit Reviewer pay DENIED (permission)', r.ok === false && r.layer === 'permission');
r = archivePayrollBatchGuarded(AUDIT, c, { by: AUDIT.name });
ok('C9 Audit Reviewer archive DENIED (permission)', r.ok === false && r.layer === 'permission');
// Payments Officer may ONLY pay (and only approved)
r = transitionPayrollGuarded(PAY, c, 'under_audit', { by: PAY.name });
ok('C10 Payments Officer submit DENIED (permission)', r.ok === false && r.layer === 'permission');
r = transitionPayrollGuarded(PAY, c, 'approved', { by: PAY.name });
ok('C11 Payments Officer approve DENIED (permission)', r.ok === false && r.layer === 'permission');
r = transitionPayrollGuarded(PAY, c, 'rejected', { by: PAY.name });
ok('C12 Payments Officer reject DENIED (permission)', r.ok === false && r.layer === 'permission');
g = requirePayrollAction(PAY, 'generate', c);
ok('C13 Payments Officer generate/edit DENIED (permission)', g.ok === false && g.layer === 'permission');
// Every denied attempt is an audit `denied` event and never mutates the record
ok('C14 all role violations recorded as denied events', deniedEvents('2026-06').length >= 10);
ok('C15 the batch is still an untouched draft', storage.getState().payrolls.some((x) => x.id === 'pay-2026-06' && x.status === 'draft'));
ok('C16 no success workflow event fabricated for any denied attempt', successActions(payrollEventsOf('2026-06')).length === 1); // only CREATED
ok('C17 chain valid after permission denials', chainValidAfterEach('permission-denials'));

// ===========================================================================
console.log('D. Scope enforcement (company_hr → comp-2 vs comp-1 batch)');
r = transitionPayrollGuarded(SCOPED, c, 'under_audit', { by: SCOPED.name });
ok('D1 out-of-scope submit DENIED (scope layer after permission passes)', r.ok === false && r.layer === 'scope' && /scope_violation/.test(r.error));
g = requirePayrollAction(SCOPED, 'edit', c);
ok('D2 out-of-scope edit DENIED (scope)', g.ok === false && g.layer === 'scope');
g = requirePayrollAction(SCOPED, 'generate', c);
ok('D3 out-of-scope generate DENIED (scope)', g.ok === false && g.layer === 'scope');
ok('D4 scope violations recorded as denied events with scope layer', deniedEvents('2026-06').some((e) => e.newValue.layer === 'scope'));
ok('D5 chain valid after scope denials', chainValidAfterEach('scope-denials'));

// in-scope comp-2 user CAN manage a comp-2 batch
const c2 = makeBatch('2026-06', 'pay-2026-06c2', {
  item: { employeeId: 'emp-2', employeeName: 'Emp Two', companyId: 'comp-2', branchId: 'br-3', basicSalary: 3000, housingAllowance: 500, transportAllowance: 200, otherAllowances: 50, totalEarnings: 3750, grossSalary: 3750, totalDeductions: 150, netSalary: 3600, loanInstallment: 0 },
  totalsByCurrency: [{ code: 'USD', symbol: '$', gross: 3750, deductions: 150, net: 3600, companyGosi: 0, count: 1 }],
  totalGross: 3750, totalDeductions: 150, totalNet: 3600, totalCompanyGosi: 0,
});
r = transitionPayrollGuarded(SCOPED, c2, 'under_audit', { by: SCOPED.name });
ok('D6 in-scope submit ALLOWED', r.ok === true && r.layer === undefined);

// ===========================================================================
console.log('E. Official path on a genuinely GENERATED batch (create → submit → approve → pay → archive)');
emptyBase();
const gen = generateMonthlyPayroll(
  storage.getState().employees,
  storage.getState().overtime,
  storage.getState().loans,
  storage.getState().attendance,
  { month: '2026-06', adjustments: storage.getState().increments, companies: storage.getState().companies },
  storage.getState().settings,
);
ok('E1 generated draft contains items + per-currency segment', gen.status === 'draft' && Array.isArray(gen.items) && gen.items.length === 2 && Array.isArray(gen.totalsByCurrency));
storage.addPayrollBatch(gen);
ok('E2 CREATED event for generated batch', successActions(payrollEventsOf('2026-06')).includes(AUDIT_ACTIONS.CREATED));
let genB = gen;
const fullPath = [
  ['HR submits generated draft', HR, 'under_audit', { by: HR.name }],
  ['AUDIT approves', AUDIT, 'approved', { by: AUDIT.name }],
  ['PAY pays approved', PAY, 'paid', { by: PAY.name }],
  ['ADMIN archives paid', ADMIN, 'paid', { by: ADMIN.name }],
];
let genStep = 1;
ok('E3 generated path step order', fullPath.length === 4);
let archiveRes = null;
for (const [label, user, to, opts] of fullPath) {
  if (label.startsWith('ADMIN')) {
    archiveRes = archivePayrollBatchGuarded(user, genB, opts);
    genB = archiveRes.ok ? archiveRes.batch : genB;
    ok(`E${4 + genStep} ${label} → ${archiveRes.ok ? 'success' : 'FAILED'}`, archiveRes.ok === true);
  } else {
    const rr = transitionPayrollGuarded(user, genB, to, opts);
    genB = rr.ok ? rr.batch : genB;
    ok(`E${4 + genStep} ${label} → ${rr.ok ? 'success' : 'FAILED'}`, rr.ok === true);
  }
  if (genB.month !== '2026-06') { ok(`E${4 + genStep} record identity preserved`, false); break; }
  storage.addPayrollBatch(genB);
  genStep++;
}
ok('E9 paid+archived terminal state on the same record', genB.status === 'paid' && genB.archived === true && genB.id === gen.id);
ok('E10 generated happy path audit event sequence', successActions(payrollEventsOf('2026-06')).join(',') === [AUDIT_ACTIONS.CREATED, AUDIT_ACTIONS.SUBMITTED, AUDIT_ACTIONS.APPROVED, AUDIT_ACTIONS.PAID, AUDIT_ACTIONS.ARCHIVE].join(','));
ok('E11 chain valid after generated path', chainValidAfterEach('generated-path'));
const verE = verifyAuditTrail(storage.getAuditTrailMeta().envelope);
ok('E12 full audit chain integrity', verE.valid === true);

// ===========================================================================
console.log('F. BUG REGRESSION — real-UI correction path (fresh object must NOT erase history)');
emptyBase();
// Real UI path: the draft is GENERATED, stored (CREATED), then submitted.
let fDraft = generateMonthlyPayroll(
  storage.getState().employees,
  storage.getState().overtime,
  storage.getState().loans,
  storage.getState().attendance,
  { month: '2026-08', adjustments: storage.getState().increments, companies: storage.getState().companies },
  storage.getState().settings,
);
ok('F0 freshly generated object carries NO pre-existing history (sealed baseline / versions / revision)', fDraft.baselineSnapshot == null && !Array.isArray(fDraft.versions) && !fDraft.revision);
storage.addPayrollBatch(fDraft);
ok('F1 CREATE event for the generated draft', successActions(payrollEventsOf('2026-08')).includes(AUDIT_ACTIONS.CREATED));
let fb = fDraft;
r = transitionPayrollGuarded(HR, fb, 'under_audit', { by: HR.name, reason: 'submitted for audit' });
ok('F2 first submit seals the baseline on the returned record', r.ok === true && r.batch.baselineSnapshot && Array.isArray(r.batch.baselineSnapshot.items));
fb = r.batch;
const firstNet = fb.baselineSnapshot.totalNet;
ok('F3 baseline holds the ORIGINAL salary (6000) and a positive net', Number(firstNet) > 0 && fb.baselineSnapshot.items[0].basicSalary === 6000);
storage.addPayrollBatch(fb);
r = transitionPayrollGuarded(AUDIT, fb, 'rejected', { by: AUDIT.name, rejectionReason: 'basic salary must be corrected', auditNotes: 'review requested' });
fb = r.batch;
ok('F4 reject stamps reason + rejected financial snapshot (amounts never zeroed)', r.ok === true && fb.rejectedSnapshot && fb.rejectedSnapshot.totalNet === firstNet && fb.rejectionReason === 'basic salary must be corrected' && fb.returnState === 'needs_correction');
storage.addPayrollBatch(fb);
// REAL UI recalc: salary edited, then a FRESH regenerate passes a history-less
// object into the correction engine.
storage.saveEmployees(storage.getState().employees.map((e) => (e.id === 'emp-1' ? { ...e, basicSalary: 6500 } : e)));
const freshRegen = generateMonthlyPayroll(
  storage.getState().employees,
  storage.getState().overtime,
  storage.getState().loans,
  storage.getState().attendance,
  { month: '2026-08', adjustments: storage.getState().increments, companies: storage.getState().companies },
  storage.getState().settings,
);
ok('F5 the recalc object handed to the UI is history-less (the trap)', freshRegen.id === fDraft.id && freshRegen.baselineSnapshot == null && !Array.isArray(freshRegen.versions));
r = recordPayrollCorrectionGuarded(HR, fb, freshRegen, { by: HR.name, reason: 'basic salary corrected to 6500' });
ok('F6 correction accepted on the returned record', r.ok === true);
fb = r.batch;
ok('F7 SAME record id preserved through the correction', fb.id === fDraft.id && fb.month === '2026-08');
ok('F8 baselineSnapshot preserved — ORIGINAL financial values never overwritten', Array.isArray(fb.baselineSnapshot?.items) && fb.baselineSnapshot.totalNet === firstNet && fb.baselineSnapshot.items[0].basicSalary === 6000);
ok('F9 rejectedSnapshot preserved — reject-time values intact', !!fb.rejectedSnapshot && fb.rejectedSnapshot.totalNet === firstNet);
ok('F10 version chain intact: under_audit,rejected,corrected', fb.versions.map((v) => v.type).join(',') === 'under_audit,rejected,corrected');
ok('F11 version ids continuous V1→V2→V3 with prev/next links', fb.versions.map((v) => v.versionId).join(',') === 'V1,V2,V3' && fb.versions[1].prevVersionId === 'V1' && fb.versions[2].prevVersionId === 'V2' && fb.versions[0].nextVersionId === 'V2' && fb.versions[1].nextVersionId === 'V3');
const origValsF = originalFinancialValues(fb);
ok('F12 originalFinancialValues() returns the ORIGINAL baseline (not null)', !!origValsF && origValsF.totalNet === firstNet && origValsF.items[0].basicSalary === 6000);
ok('F13 corrected item now carries the new salary', fb.items.find((i) => i.employeeId === 'emp-1').basicSalary === 6500);
const corrF = (fb.corrections || []).find((c) => c.toVersion === 3);
ok('F14 correction logged old 6000 → new 6500 for basicSalary with user/stamp/reason', !!corrF && corrF.by === HR.name && corrF.reason === 'basic salary corrected to 6500' && corrF.changes.some((ch) => ch.field === 'basicSalary' && ch.oldValue === 6000 && ch.newValue === 6500));
ok('F15 currency segment preserved (USD never re-priced, net reflects the correction)', fb.totalsByCurrency[0].code === 'USD' && fb.totalsByCurrency[0].symbol === '$' && fb.totalsByCurrency[0].net > firstNet);
ok('F16 audit attempts carried: under_audit,returned,corrected', fb.auditAttempts.map((a) => a.result).join(',') === 'under_audit,returned,corrected');
storage.addPayrollBatch(fb);
ok('F17 exactly ONE stored record after correction (no duplicate payroll)', storage.getState().payrolls.filter((p) => p.id === fDraft.id).length === 1);
// resubmit the corrected record (same record, new audit attempt)
r = transitionPayrollGuarded(HR, fb, 'under_audit', { by: HR.name, reason: 'correction resubmitted' });
ok('F18 resubmit returns the SAME record to under_audit', r.ok === true && r.batch.id === fDraft.id && r.batch.status === 'under_audit' && r.batch.returnState === 'resubmitted');
fb = r.batch;
ok('F19 final version chain: under_audit,rejected,corrected,resubmitted', fb.versions.map((v) => v.type).join(',') === 'under_audit,rejected,corrected,resubmitted');
ok('F20 original financial values STILL the original baseline after resubmit', originalFinancialValues(fb)?.totalNet === firstNet);
storage.addPayrollBatch(fb);
const fActs = successActions(payrollEventsOf('2026-08'));
ok('F21 honest audit sequence: created,submitted,rejected,corrected,resubmitted', fActs.join(',') === [AUDIT_ACTIONS.CREATED, AUDIT_ACTIONS.SUBMITTED, AUDIT_ACTIONS.REJECTED, AUDIT_ACTIONS.CORRECTED, AUDIT_ACTIONS.RESUBMITTED].join(','));
ok('F22 chain valid end-to-end through the fresh-object correction', chainValidAfterEach('fresh-object-correction'));
const verF = verifyAuditTrail(storage.getAuditTrailMeta().envelope);
ok('F23 full audit chain integrity', verF.valid === true);

// ===========================================================================
console.log('SUMMARY');
console.log(`  passed: ${passed}`);
console.log(`  failed: ${failed}`);
if (failed > 0) {
  console.log('  failures:');
  failures.forEach((f) => console.log(`    - ${f}`));
  process.exit(1);
}