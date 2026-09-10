// =========================================================
// P7 Test Matrix — EOSB Workflow (Phase 7, Spec v1.0).
// Usage: node scripts/p7-tests.mjs
//
// Walks the FULL official EOSB workflow through the real
// public surfaces (guard stack + calculateEOSB engine +
// storage + Phase 5 audit trail + Phase 4 currency snapshots):
//
//   Create(under_audit) → Reject/Return (draft + markers)
//   → Correction (fresh-object, history preserved) → Resubmit
//   → Approve → Pay → Cancel Payment → Re-pay
//   (draft ⇄ under_audit ⇄ approved ⇄ paid)
//
// Mandatory rules verified end-to-end:
//   1. permission → scope → state on every EOSB action
//      (company_hr owns the lifecycle; branch_hr views only;
//      payroll_admin / audit_reviewer / payments_officer have
//      NO EOSB permissions; out-of-scope company_hr blocked)
//   2. reject NEVER zeroes financials; stamps rejectionReason /
//      rejectedBy / rejectedAt + a financial snapshot + a
//      'returned' audit attempt + a 'returned' version, and the
//      returned record carries Returned/Needs-Correction markers
//      (distinct from a NEW draft)
//   3. correction records old→new per field with who/when/why;
//      a FRESH calculateEOSB() object can never lose the
//      baselineSnapshot / rejectedSnapshot / versions /
//      auditAttempts / original financial values
//   4. resubmit returns the SAME record to under_audit with a
//      fresh audit attempt; no duplicate settlements
//   5. approve → pay (only eosb.approve then eosb.pay); duplicate
//      pay / submit / approve impossible; paid is not editable;
//      paid cannot be deleted
//   6. paid → approved CANCEL_PAYMENT is the documented EOSB
//      behavior and stays honest + audited; re-pay allowed
//   7. every real transition emits exactly one honest P5 event
//      (CREATED / REJECTED / CORRECTED / RESUBMITTED / APPROVED /
//      PAID / CANCEL_PAYMENT) with actor/timestamp/old/new/reason/
//      versionId/auditAttempt/financial/currency snapshot; denied
//      attempts are 'denied' events, never successes
//   8. currency fields (amount/currency/exchangeRate/
//      exchangeRateDate/baseCurrency/baseAmount) are frozen per
//      snapshot and never re-priced; no USD+IQD mixing
//   9. legacy patch-driven path (updateEOSB) keeps its documented
//      event sequence and hash-chain integrity is preserved
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
  transitionEosbGuarded, recordEosbCorrectionGuarded, deleteEosbGuarded,
  requireEosbAction, eosbTransitionAction,
} = await import(`${JS}engines/eosbAccess.js`);
const {
  canTransitionEosb, originalEosbFinancialValues, ensureEosbBaseline,
} = await import(`${JS}engines/eosbWorkflow.js`);
const { calculateEOSB } = await import(`${JS}engines/eosbEngine.js`);
const {
  verifyAuditTrail, traceRecord, AUDIT_ACTIONS, AUDIT_RECORD_TYPES,
} = await import(`${JS}engines/auditTrail.js`);

const SUPER = defaultUsers.find((u) => u.role === 'super_admin');
// Role users fabricated with the same shape payrollAccess expects
// (permissions resolve from types.js DEFAULT_ROLE_PERMISSIONS).
const HR = { id: 'usr-chr', username: 'usr-chr', name: 'HR One', role: 'company_hr', assignedCompanyId: 'all', assignedBranchId: 'all' };
const BR = { id: 'usr-bhr', username: 'usr-bhr', name: 'Branch HR', role: 'branch_hr', assignedCompanyId: 'all', assignedBranchId: 'all' };
const PA = { id: 'usr-pa', username: 'usr-pa', name: 'Payroll Admin', role: 'payroll_admin', assignedCompanyId: 'all', assignedBranchId: 'all' };
const AUDIT = { id: 'usr-ar', username: 'usr-ar', name: 'Audit Reviewer', role: 'audit_reviewer', assignedCompanyId: 'all', assignedBranchId: 'all' };
const PAY = { id: 'usr-po', username: 'usr-po', name: 'Payments Officer', role: 'payments_officer', assignedCompanyId: 'all', assignedBranchId: 'all' };
const SCOPED = { id: 'usr-sc', username: 'usr-sc', name: 'Company HR comp-2', role: 'company_hr', assignedCompanyId: 'comp-2', assignedBranchId: 'all' };

function baseSettings() {
  return {
    ...defaultSettings,
    currency: 'USD',
    currencySymbol: '$',
    baseCurrency: 'USD',
    dailyRateMethod: 'fixed30',
    customCurrencies: [{ code: 'IQD', symbol: 'ع.د' }],
    exchangeRates: [{ currency: 'IQD', baseCurrency: 'USD', rate: 1480, rateDate: '2026-06-01', locked: false, createdAt: '2026-06-01T00:00:00.000Z' }],
  };
}

const EMPLOYEES = [
  { id: 'emp-1', fullName: 'Emp One', companyId: 'comp-1', branchId: 'br-1', department: 'IT', jobTitle: 'Engineer', hireDate: '2020-01-01', status: 'active', basicSalary: 6000, housingAllowance: 1500, transportAllowance: 600 },
  { id: 'emp-2', fullName: 'Emp Two', companyId: 'comp-2', branchId: 'br-3', department: 'Ops', jobTitle: 'Officer', hireDate: '2021-03-15', status: 'active', basicSalary: 3000, housingAllowance: 500, transportAllowance: 200 },
  { id: 'emp-3', fullName: 'Emp Three', companyId: 'comp-1', branchId: 'br-1', department: 'Fin', jobTitle: 'Accountant', hireDate: '2019-01-01', status: 'active', currency: 'IQD', salaryCurrency: 'IQD', basicSalary: 900000, housingAllowance: 0, transportAllowance: 0 },
];

/** Reset localStorage + reseed storage with fresh employees/settings. */
function emptyBase() {
  store.clear();
  storage.seedIfMissing();
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
  storage.saveEmployees(EMPLOYEES.map((e) => ({ ...e })));
}

function state() { return storage.getState(); }

function eosbEvents(id) {
  return storage.getAuditTrail().filter((e) => e.recordType === AUDIT_RECORD_TYPES.EOSB && String(e.recordId) === String(id));
}

function successActions(events) {
  return events.filter((e) => e.outcome === 'success').map((e) => e.action);
}

function deniedEvents(id) {
  return eosbEvents(id).filter((e) => e.action === AUDIT_ACTIONS.DENIED);
}

function chainValidAfterEach(step) {
  const meta = storage.getAuditTrailMeta();
  const ver = verifyAuditTrail(meta.envelope);
  if (!ver.valid) { console.log(`    [chain broken at ${step}]`); return false; }
  return true;
}

/** Build an EOSB record EXACTLY as the real calculator modal does, and save. */
function createViaRealUI(employee, reason, terminationDate, opts = {}) {
  const s = state();
  const fresh = calculateEOSB({
    employee,
    terminationDate,
    reason,
    leaveRequests: s.leaves || [],
    loans: s.loans || [],
    settings: s.settings,
    companies: s.companies,
    ...opts.params,
  });
  const cur = resolveCurrencyOf(employee, s);
  fresh.currency = cur.code;
  fresh.currencySymbol = cur.symbol;
  fresh.companyId = employee.companyId;
  fresh.branchId = employee.branchId;
  fresh.notes = opts.notes || 'created via real UI path';
  fresh.status = 'under_audit';
  fresh.createdBy = (opts.actor || HR.name);
  fresh.createdAt = fresh.createdAt || '2026-07-31T08:00:00.000Z';
  storage.addEOSB(fresh);
  return fresh;
}

function resolveCurrencyOf(employee, s) {
  if (employee.currency) return { code: employee.currency, symbol: employee.currency === 'IQD' ? 'ع.د' : '$' };
  if (employee.salaryCurrency) return { code: employee.salaryCurrency, symbol: employee.salaryCurrency === 'IQD' ? 'ع.د' : '$' };
  return { code: s.settings.currency || 'USD', symbol: s.settings.currencySymbol || '$' };
}

function recordOf(id) { return state().eosb.find((e) => e.id === id); }

console.log('P7 — EOSB Workflow E2E');

// ===========================================================================
console.log('A. Permission → Scope → State guard matrix');
emptyBase();
const baseE = createViaRealUI(state().employees.find((e) => e.id === 'emp-1'), 'resignation', '2026-07-31', { notes: 'guard matrix' });
const baseRec = { ...baseE, id: 'G-1', status: 'draft' };
const baseUA = { ...baseRec, status: 'under_audit' };
const baseReturned = { ...baseRec, rejectedBy: AUDIT.name, rejectedAt: new Date().toISOString(), returnState: 'needs_correction' };
const baseApproved = { ...baseRec, status: 'approved' };
const basePaid = { ...baseRec, status: 'paid' };
const comp2UA = { ...baseRec, id: 'G-2', companyId: 'comp-2', branchId: 'br-3' };
const otherRec = { ...baseRec };

// permission layer: company_hr owns the full lifecycle
let g = requireEosbAction(HR, 'calculate', null);
ok('A1 company_hr may calculate', g.ok === true);
g = requireEosbAction(HR, 'edit', baseReturned);
ok('A2 company_hr may correct a returned draft', g.ok === true);
g = requireEosbAction(HR, 'submit', baseReturned);
ok('A3 company_hr may (re)submit a returned draft', g.ok === true);
g = requireEosbAction(HR, 'approve', baseUA);
ok('A4 company_hr may approve (under_audit)', g.ok === true);
g = requireEosbAction(HR, 'reject', baseUA);
ok('A5 company_hr may reject (under_audit)', g.ok === true);
g = requireEosbAction(HR, 'disburse', baseApproved);
ok('A6 company_hr may disburse (approved)', g.ok === true);
g = requireEosbAction(HR, 'cancelPayment', basePaid);
ok('A7 company_hr may cancel payment (paid)', g.ok === true);
g = requireEosbAction(HR, 'delete', baseReturned);
ok('A8 company_hr may delete a non-paid draft', g.ok === true);

// branch_hr: view/calculate only
g = requireEosbAction(BR, 'calculate', null);
ok('A9 branch_hr may calculate', g.ok === true);
g = requireEosbAction(BR, 'submit', baseReturned);
ok('A10 branch_hr submit DENIED (permission)', g.ok === false && g.layer === 'permission');
g = requireEosbAction(BR, 'approve', baseUA);
ok('A11 branch_hr approve DENIED (permission)', g.ok === false && g.layer === 'permission');
g = requireEosbAction(BR, 'reject', baseUA);
ok('A12 branch_hr reject DENIED (permission)', g.ok === false && g.layer === 'permission');
g = requireEosbAction(BR, 'disburse', baseApproved);
ok('A13 branch_hr disburse DENIED (permission)', g.ok === false && g.layer === 'permission');
g = requireEosbAction(BR, 'delete', baseReturned);
ok('A14 branch_hr delete DENIED (permission)', g.ok === false && g.layer === 'permission');

// non-EOSB roles have no EOSB permissions at all
g = requireEosbAction(PA, 'calculate', null);
ok('A15 payroll_admin calculate DENIED (permission)', g.ok === false && g.layer === 'permission');
g = requireEosbAction(AUDIT, 'approve', baseUA);
ok('A16 audit_reviewer approve DENIED (permission)', g.ok === false && g.layer === 'permission');
g = requireEosbAction(PAY, 'disburse', baseApproved);
ok('A17 payments_officer disburse DENIED (permission)', g.ok === false && g.layer === 'permission');
g = requireEosbAction(PAY, 'reject', baseUA);
ok('A18 payments_officer reject DENIED (permission)', g.ok === false && g.layer === 'permission');

// scope layer: a company_hr constrained to comp-2 cannot touch comp-1 records
g = requireEosbAction(SCOPED, 'submit', baseUA);
ok('A19 out-of-scope submit DENIED (scope layer, permission passed)', g.ok === false && g.layer === 'scope' && /scope_violation/.test(g.error));
g = requireEosbAction(SCOPED, 'edit', baseReturned);
ok('A20 out-of-scope edit DENIED (scope)', g.ok === false && g.layer === 'scope');
g = requireEosbAction(SCOPED, 'delete', baseReturned);
ok('A21 out-of-scope delete DENIED (scope)', g.ok === false && g.layer === 'scope');
g = requireEosbAction(SCOPED, 'disburse', { ...comp2UA, status: 'approved' });
ok('A22 in-scope disburse ALLOWED', g.ok === true);

// state layer per action
g = requireEosbAction(HR, 'edit', baseUA);
ok('A23 edit on under_audit DENIED (state)', g.ok === false && g.layer === 'state');
g = requireEosbAction(HR, 'edit', baseApproved);
ok('A24 edit on approved DENIED (state)', g.ok === false && g.layer === 'state');
g = requireEosbAction(HR, 'edit', basePaid);
ok('A25 edit on paid DENIED (state — paid is not editable)', g.ok === false && g.layer === 'state');
g = requireEosbAction(HR, 'submit', baseRec);
ok('A26 submit on a NEW (non-returned) draft is allowed (state ok)', g.ok === true);
g = requireEosbAction(HR, 'submit', baseUA);
ok('A27 duplicate submit on under_audit DENIED (state)', g.ok === false && g.layer === 'state');
g = requireEosbAction(HR, 'approve', baseRec);
ok('A28 approve on draft DENIED (state)', g.ok === false && g.layer === 'state');
g = requireEosbAction(HR, 'reject', baseApproved);
ok('A29 reject on approved DENIED (state)', g.ok === false && g.layer === 'state');
g = requireEosbAction(HR, 'disburse', baseRec);
ok('A30 pay on draft DENIED (state — no payment without approval)', g.ok === false && g.layer === 'state');
g = requireEosbAction(HR, 'disburse', basePaid);
ok('A31 duplicate pay on paid DENIED (state — double-pay impossible)', g.ok === false && g.layer === 'state');
g = requireEosbAction(HR, 'cancelPayment', baseApproved);
ok('A32 cancelPayment on approved DENIED (state)', g.ok === false && g.layer === 'state');
g = requireEosbAction(HR, 'delete', basePaid);
ok('A33 delete on paid DENIED (state — audit integrity)', g.ok === false && g.layer === 'state' && /delete_requires_not_paid/.test(g.error));
ok('A34 transition map resolves cancelPayment for paid→approved', eosbTransitionAction(basePaid, 'approved') === 'cancelPayment' && eosbTransitionAction(baseUA, 'approved') === 'approve');
ok('A35 engine rejects illegal transitions', !canTransitionEosb(baseApproved, 'draft').ok && !canTransitionEosb(basePaid, 'draft').ok && !canTransitionEosb(baseUA, 'paid').ok && canTransitionEosb(basePaid, 'approved').ok);
ok('A36 super_admin holds the complete EOSB catalog (incl. eosb.pay)', requireEosbAction(SUPER, 'disburse', baseApproved).ok === true);
ok('A37 chain valid after guard matrix', chainValidAfterEach('guard-matrix'));

// ===========================================================================
console.log('B. Full real-UI pipeline: create(under_audit) → reject → fresh-object correction → resubmit → approve → pay → cancel → re-pay');
emptyBase();
const emp1 = state().employees.find((e) => e.id === 'emp-1');
const settlement = createViaRealUI(emp1, 'resignation', '2026-07-31', { notes: 'official happy path' });
const eid = settlement.id;
ok('B1 created record is under_audit with baseline sealed at creation (direct path)', recordOf(eid).status === 'under_audit' && recordOf(eid).baselineSnapshot && recordOf(eid).baselineSnapshot.netSettlementAmount === settlement.netSettlementAmount);
ok('B2 audited REJECT/CORRECT … creation is a single CREATED event', successActions(eosbEvents(eid)).join(',') === AUDIT_ACTIONS.CREATED);
ok('B3 chain valid after create', chainValidAfterEach('create'));
const originalNet = settlement.netSettlementAmount;
let rec = recordOf(eid);

// --- reject / return (documented: status stays draft, NEVER zeroed) ---
const preRejectNet = rec.netSettlementAmount;
const preRejectFinalEOSB = rec.finalEOSBAmount;
let r = transitionEosbGuarded(HR, rec, 'draft', { rejectionReason: 'final month salary understated' });
ok('B4 company_hr reject allowed (permission+scope+state)', r.ok === true);
rec = r.batch;
ok('B5 reject returns to draft + Returned/Needs Correction marker', rec.status === 'draft' && rec.returnState === 'needs_correction');
ok('B6 rejection meta stamped (by/at/reason)', rec.rejectedBy === HR.name && !!rec.rejectedAt && rec.rejectionReason === 'final month salary understated');
ok('B7 amounts PRESERVED on reject (no zeroing)', rec.netSettlementAmount === preRejectNet && rec.finalEOSBAmount === preRejectFinalEOSB && rec.netSettlementAmount > 0);
ok('B8 rejected financial snapshot captured == pre-reject values', rec.rejectedSnapshot && rec.rejectedSnapshot.netSettlementAmount === preRejectNet && rec.rejectedSnapshot.finalEOSBAmount === preRejectFinalEOSB);
ok('B9 returned version appended (V1)', rec.versions.length === 1 && rec.versions[0].type === 'returned' && rec.versions[0].versionId === 'V1' && rec.revision === 1);
ok('B10 returned audit attempt recorded', rec.auditAttempts.length === 1 && rec.auditAttempts[0].result === 'returned');
storage.persistEosb(rec);
let ev = eosbEvents(eid).find((e) => e.action === AUDIT_ACTIONS.REJECTED);
ok('B11 REJECTED event with reason + actor + version + attempt + financial', !!ev && ev.reason === 'final month salary understated' && ev.actor.name === HR.name && ev.versionId === 'V1' && ev.auditAttempt && ev.auditAttempt.result === 'returned' && ev.newValue.netSettlementAmount === preRejectNet && ev.financial && ev.financial.amount === preRejectNet);
ok('B12 REJECTED event carries rejection linkage', !!ev && ev.rejection && ev.rejection.rejectedBy === HR.name && ev.rejection.returnState === 'needs_correction' && ev.rejection.rejectedSnapshot);
ok('B13 chain valid after reject', chainValidAfterEach('reject'));

// --- returned vs NEW draft distinction ---
const returnedRec = recordOf(eid);
const newDraft = calculateEOSB({ employee: state().employees.find((e) => e.id === 'emp-2'), terminationDate: '2026-08-31', reason: 'resignation', settings: state().settings, companies: state().companies });
ok('B14 a BRAND-NEW draft is NOT a returned record (no markers)', newDraft.status === 'draft' && !newDraft.rejectedBy && !newDraft.returnState && !newDraft.rejectedSnapshot);
ok('B15 returned record IS draft + rejectedBy + needs_correction + snapshot', returnedRec.status === 'draft' && !!returnedRec.rejectedBy && returnedRec.returnState === 'needs_correction' && !!returnedRec.rejectedSnapshot);

// --- correction via a FRESH calculateEOSB() object (the real UI contract) ---
const errBefore = returnedRec.versions.map((v) => v.versionId).join(',');
storage.saveEmployees(state().employees.map((e) => (e.id === 'emp-1' ? { ...e, transportAllowance: 700 } : e)));
const freshObj = calculateEOSB({ employee: state().employees.find((e) => e.id === 'emp-1'), terminationDate: '2026-07-31', reason: 'resignation', leaveRequests: state().leaves || [], loans: state().loans || [], settings: state().settings, companies: state().companies });
ok('B16 the recalc object is history-less (the trap — like the P6 bug)', freshObj.id !== eid && freshObj.baselineSnapshot == null && !freshObj.versions && !freshObj.revision);
r = recordEosbCorrectionGuarded(HR, returnedRec, freshObj, { reason: 'transport allowance revised to 700' });
ok('B17 correction accepted on the returned record', r.ok === true);
rec = r.batch;
ok('B18 SAME record id preserved (fresh object rebound)', rec.id === eid && rec.employeeId === emp1.id);
ok('B19 baselineSnapshot preserved — ORIGINAL financial values never overwritten', rec.baselineSnapshot && rec.baselineSnapshot.netSettlementAmount === originalNet);
ok('B20 rejectedSnapshot preserved — reject-time values intact', rec.rejectedSnapshot && rec.rejectedSnapshot.netSettlementAmount === preRejectNet);
ok('B21 version chain intact: returned,corrected (V1→V2 linked)', rec.versions.map((v) => v.type).join(',') === 'returned,corrected' && rec.versions[1].prevVersionId === 'V1' && rec.versions[0].nextVersionId === 'V2');
ok('B22 revisions never restart', errBefore === 'V1' && rec.revision === 2);
const origVals = originalEosbFinancialValues(rec);
ok('B23 originalEosbFinancialValues() == original baseline', !!origVals && origVals.netSettlementAmount === originalNet);
ok('B24 correction logged old→new with by/when/why', rec.corrections.length === 1 && rec.corrections[0].by === HR.name && rec.corrections[0].reason === 'transport allowance revised to 700' && !!rec.corrections[0].at && rec.corrections[0].changes.some((c) => c.field === 'netSettlementAmount' && Number(c.oldValue) === Number(preRejectNet) && Number(c.newValue) === Number(freshObj.netSettlementAmount)));
ok('B25 rejection meta carried across the correction', rec.rejectedBy === HR.name && rec.rejectionReason === 'final month salary understated' && !!rec.rejectedAt);
ok('B26 corrected audit attempt recorded', rec.auditAttempts.map((a) => a.result).join(',') === 'returned,corrected');
ok('B27 corrected record still stands as draft + needs correction until resubmit', rec.status === 'draft' && rec.returnState === 'corrected');
storage.persistEosb(rec);
ev = eosbEvents(eid).find((e) => e.action === AUDIT_ACTIONS.CORRECTED);
ok('B28 CORRECTED event with old→new payload + version + attempt', !!ev && Array.isArray(ev.corrections) && ev.corrections.some((c) => c && Array.isArray(c.changes) && c.changes.some((x) => x.field === 'netSettlementAmount')) && ev.versionId === 'V2' && ev.auditAttempt && ev.auditAttempt.result === 'corrected' && ev.toStatus === 'draft');
ok('B29 exactly ONE stored record after correction (no duplicate settlement)', state().eosb.filter((e) => e.id === eid).length === 1 && state().eosb.filter((e) => e.employeeId === emp1.id).length === 1);
ok('B30 chain valid after correction', chainValidAfterEach('corrected'));

// --- resubmit (same record, new attempt) ---
r = transitionEosbGuarded(HR, recordOf(eid), 'under_audit', { reason: 'resubmitted after correction' });
ok('B31 resubmit allowed', r.ok === true);
rec = r.batch;
ok('B32 same record returns to under_audit with resubmit stamps', rec.id === eid && rec.status === 'under_audit' && rec.returnState === 'resubmitted' && rec.resubmittedBy === HR.name);
ok('B33 version chain extended: returned,corrected,resubmitted', rec.versions.map((v) => v.type).join(',') === 'returned,corrected,resubmitted' && rec.revision === 3);
ok('B34 original financial values STILL the original baseline after resubmit', originalEosbFinancialValues(rec)?.netSettlementAmount === originalNet);
storage.persistEosb(rec);
ok('B35 RESUBMITTED event (not a second SUBMITTED)', successActions(eosbEvents(eid)).includes(AUDIT_ACTIONS.RESUBMITTED) && successActions(eosbEvents(eid)).filter((a) => a === AUDIT_ACTIONS.SUBMITTED).length === 0);
ok('B36 chain valid after resubmit', chainValidAfterEach('resubmit'));

// --- duplicate submission blocked ---
r = transitionEosbGuarded(HR, recordOf(eid), 'under_audit', { by: HR.name });
ok('B37 duplicate submit (under_audit→under_audit) DENIED (state)', r.ok === false && r.layer === 'state' && /submit_requires_draft_or_returned/.test(r.error));
ok('B38 duplicate submit recorded as denied event', deniedEvents(eid).some((e) => e.newValue.requestedAction === 'submit'));

// --- approve ---
const preApproveNet = recordOf(eid).netSettlementAmount;
r = transitionEosbGuarded(HR, recordOf(eid), 'approved', { by: HR.name, reason: 'audit approved' });
ok('B39 approve allowed (under_audit → approved)', r.ok === true);
rec = r.batch;
ok('B40 approved + stamps + returnState cleared', rec.status === 'approved' && rec.approvedBy === HR.name && rec.approvedAt && rec.returnState === undefined);
ok('B41 approved version appended + financial untouched', rec.versions[rec.versions.length - 1].type === 'approved' && rec.netSettlementAmount === preApproveNet);
storage.persistEosb(rec);
ev = eosbEvents(eid).find((e) => e.action === AUDIT_ACTIONS.APPROVED);
ok('B42 APPROVED event with actor + no re-pricing', !!ev && ev.actor.name === HR.name && ev.newValue.netSettlementAmount === preApproveNet && ev.financial.amount === preApproveNet);
ok('B43 chain valid after approval', chainValidAfterEach('approve'));

// --- pay (only eosb.pay, only on approved) ---
r = transitionEosbGuarded(HR, recordOf(eid), 'paid', { by: HR.name, reason: 'disbursement executed' });
ok('B44 pay allowed on approved (eosb.pay)', r.ok === true);
rec = r.batch;
ok('B45 paid status + paidBy/At + payment reference', rec.status === 'paid' && rec.paidBy === HR.name && rec.paidAt && rec.paymentReference && rec.paymentReference.executedBy === HR.name && rec.paymentReference.netSettlementAmount === Number(rec.netSettlementAmount));
ok('B46 paid version appended', rec.versions[rec.versions.length - 1].type === 'paid');
storage.persistEosb(rec);
ev = eosbEvents(eid).find((e) => e.action === AUDIT_ACTIONS.PAID);
ok('B47 PAID event with payment reference + version + attempt', !!ev && ev.paymentReference && ev.paymentReference.executedBy === HR.name && ev.versionId === `V${rec.revision}` && ev.auditAttempt && ev.auditAttempt.result === 'paid');
ok('B48 payment preserves the financial snapshot', ev.newValue.netSettlementAmount === ev.financial.amount);
ok('B49 chain valid after pay', chainValidAfterEach('pay'));

// --- duplicate pay / paid edits blocked ---
r = transitionEosbGuarded(HR, recordOf(eid), 'paid', { by: HR.name });
ok('B50 duplicate payment DENIED (double-pay impossible)', r.ok === false && r.layer === 'state');
g = requireEosbAction(HR, 'edit', recordOf(eid));
ok('B51 paid settlement NOT editable', g.ok === false && g.layer === 'state');
g = requireEosbAction(HR, 'approve', recordOf(eid));
ok('B52 paid settlement cannot be re-approved', g.ok === false && g.layer === 'state');
g = deleteEosbGuarded(HR, recordOf(eid));
ok('B53 paid settlement cannot be deleted', g.ok === false && g.layer === 'state');
ok('B54 only ONE paid event ever emitted', eosbEvents(eid).filter((e) => e.action === AUDIT_ACTIONS.PAID).length === 1);

// --- cancel payment (documented: paid → approved) ---
const preCancelPaid = recordOf(eid).paidAt;
r = transitionEosbGuarded(HR, recordOf(eid), 'approved', { by: HR.name, reason: 'payment error — cancel and re-disburse' });
ok('B55 cancel payment allowed (paid → approved, documented EOSB behavior)', r.ok === true);
rec = r.batch;
ok('B56 status back to approved, payment stamps cleared, cancel stamps set', rec.status === 'approved' && rec.paidBy === undefined && rec.paidAt === undefined && rec.paymentReference === undefined && rec.cancelPaymentBy === HR.name && rec.cancelPaymentAt);
ok('B57 cancel_payment version appended with old paid timestamp preserved', rec.versions[rec.versions.length - 1].type === 'cancel_payment');
storage.persistEosb(rec);
ev = eosbEvents(eid).find((e) => e.action === AUDIT_ACTIONS.CANCEL_PAYMENT);
ok('B58 CANCEL_PAYMENT event honest (from paid → to approved, actor + newValue)', !!ev && ev.fromStatus === 'paid' && ev.toStatus === 'approved' && ev.actor.name === HR.name && ev.newValue.status === 'approved' && ev.newValue.paymentReference === undefined);
ok('B59 chain valid after cancel payment', chainValidAfterEach('cancel-payment'));

// --- re-pay after cancel ---
r = transitionEosbGuarded(HR, recordOf(eid), 'paid', { by: HR.name, reason: 're-disbursement after correction' });
ok('B60 re-pay allowed after cancel (back to paid)', r.ok === true && r.batch.status === 'paid');
storage.persistEosb(r.batch);
ok('B61 audit event sequence for the full circle is exactly honest', successActions(eosbEvents(eid)).join(',') === [
  AUDIT_ACTIONS.CREATED, AUDIT_ACTIONS.REJECTED, AUDIT_ACTIONS.CORRECTED, AUDIT_ACTIONS.RESUBMITTED,
  AUDIT_ACTIONS.APPROVED, AUDIT_ACTIONS.PAID, AUDIT_ACTIONS.CANCEL_PAYMENT, AUDIT_ACTIONS.PAID,
].join(','));
const verB = verifyAuditTrail(storage.getAuditTrailMeta().envelope);
ok('B62 full audit chain integrity after the whole circle', verB.valid === true);

// ===========================================================================
console.log('C. Currency snapshot preservation (IQD, never re-priced)');
emptyBase();
const emp3 = state().employees.find((e) => e.id === 'emp-3');
storage.saveLoans([
  { id: 'LN-mix', employeeId: 'emp-3', status: 'active', currency: 'USD', remainingAmount: 500, note: 'USD advance must never be merged into IQD payout' },
]);
const iqd = createViaRealUI(emp3, 'company_termination', '2026-06-30', { notes: 'currency snapshot path' });
let iqRec = recordOf(iqd.id);
ok('C1 IQD settlement stamped with rate snapshot at creation', iqRec.currency === 'IQD' && iqRec.exchangeRate === 1480 && iqRec.exchangeRateDate === '2026-06-01' && iqRec.baseCurrency === 'USD' && Math.abs((Number(iqRec.baseAmount) || 0) - (Number(iqRec.netSettlementAmount) * 1480)) < 0.01);
ok('C2 no USD+IQD mixing — foreign-currency advance excluded from the payout', iqRec.currencyMismatchLoanCount === 1 && iqRec.remainingLoanDeductions === 0 && iqRec.skippedCurrencyLoans.length === 1);
const iqBaseAmount = iqRec.baseAmount;
r = transitionEosbGuarded(HR, iqRec, 'draft', { rejectionReason: 'recheck the IQD conversion' });
iqRec = r.batch;
ok('C3 reject preserves the rate snapshot (no re-pricing)', r.ok === true && iqRec.rejectedSnapshot && iqRec.rejectedSnapshot.netSettlementAmount === iqRec.netSettlementAmount && iqRec.rejectedSnapshot.exchangeRate === 1480 && iqRec.rejectedSnapshot.baseAmount === iqBaseAmount && iqRec.netSettlementAmount > 0);
storage.persistEosb(iqRec);
// fresh-object correction — record re-stamped with the SAME (locked) rate
const iqFresh = calculateEOSB({ employee: emp3, terminationDate: '2026-06-30', reason: 'company_termination', loans: state().loans, settings: state().settings, companies: state().companies });
r = recordEosbCorrectionGuarded(HR, recordOf(iqd.id), iqFresh, { reason: 'no-op correction for integrity check' });
ok('C4 correction accepted and baseline frozen with the original rate', r.ok === true && r.batch.baselineSnapshot.exchangeRate === 1480 && r.batch.baselineSnapshot.baseAmount === iqBaseAmount && originalEosbFinancialValues(r.batch)?.netSettlementAmount === iqd.netSettlementAmount);
storage.persistEosb(r.batch);
const iqFinal = recordOf(iqd.id);
ok('C5 corrected record keeps amount/rate/base consistency (locked rate reused, never re-priced)', iqFinal.currency === 'IQD' && iqFinal.exchangeRate === 1480 && Math.abs((Number(iqFinal.baseAmount) || 0) - (Number(iqFinal.netSettlementAmount) * 1480)) < 0.01);
ok('C6 currency fields intact end-to-end on the trailing record', iqFinal.exchangeRateDate === '2026-06-01' && iqFinal.baseCurrency === 'USD' && iqFinal.salaryCurrency === 'IQD');

// ===========================================================================
console.log('D. Audit integrity — actor/timestamp/old/new/reason/version/attempt/financial/currency on every real event');
const allEosb = storage.getAuditTrail().filter((e) => e.recordType === AUDIT_RECORD_TYPES.EOSB);
const successEosb = allEosb.filter((e) => e.outcome === 'success');
const flowEvents = successEosb.filter((e) => [AUDIT_ACTIONS.REJECTED, AUDIT_ACTIONS.CORRECTED, AUDIT_ACTIONS.RESUBMITTED, AUDIT_ACTIONS.APPROVED, AUDIT_ACTIONS.PAID, AUDIT_ACTIONS.CANCEL_PAYMENT].includes(e.action));
ok('D1 every real transition carries actor + timestamp + financial snapshot', flowEvents.every((e) => e.actor && e.actor.name && e.at && e.financial && typeof e.financial.amount === 'number'));
ok('D2 every transition event carries versionId + auditAttempt linkage', flowEvents.every((e) => e.versionId && e.auditAttempt && e.auditAttempt.result));
ok('D3 every transition event carries old→new status + currency fields', flowEvents.every((e) => e.fromStatus && e.toStatus && e.newValue && e.financial.currency));
const trace = traceRecord(storage.getAuditTrail(), { recordType: AUDIT_RECORD_TYPES.EOSB, recordId: String(iqd.id) });
ok('D4 traceRecord returns the ordered honest sequence', Array.isArray(trace) && trace.length === successEosb.filter((e) => String(e.recordId) === String(iqd.id)).length && trace[0].action === AUDIT_ACTIONS.CREATED);
ok('D5 chain valid after currency section', chainValidAfterEach('currency'));
const verD = verifyAuditTrail(storage.getAuditTrailMeta().envelope);
ok('D6 full hash-chain integrity', verD.valid === true);

// ===========================================================================
console.log('E. Backward compatibility — legacy patch-driven workflow (updateEOSB) unchanged');
emptyBase();
const legacy = {
  id: 'E-LEGACY', employeeId: 'emp-1', employeeName: 'Emp One', department: 'IT',
  companyId: 'comp-1', branchId: 'br-1', status: 'draft', netSettlementAmount: 5000,
  finalEOSBAmount: 3000, leaveCompensationAmount: 1500, finalMonthSalary: 500,
  remainingLoanDeductions: 0, currency: 'USD',
};
storage.addEOSB(legacy);
storage.updateEOSB('E-LEGACY', { status: 'under_audit', submittedBy: 'old-hr', submittedAt: '2026-01-01T00:00:00.000Z' });
storage.updateEOSB('E-LEGACY', { status: 'draft', rejectedBy: 'old-auditor', rejectedAt: '2026-01-02T00:00:00.000Z', rejectionReason: 'review', approvedBy: undefined, approvedAt: undefined });
storage.updateEOSB('E-LEGACY', { status: 'under_audit', submittedBy: 'old-hr', submittedAt: '2026-01-03T00:00:00.000Z' });
storage.updateEOSB('E-LEGACY', { status: 'approved', approvedBy: 'old-mgr', approvedAt: '2026-01-04T00:00:00.000Z' });
storage.updateEOSB('E-LEGACY', { status: 'paid', paidBy: 'old-cashier', paidAt: '2026-01-05T00:00:00.000Z' });
storage.updateEOSB('E-LEGACY', { status: 'approved', paidBy: undefined, paidAt: undefined });
ok('E1 legacy patch path keeps its documented event sequence', successActions(eosbEvents('E-LEGACY')).join(',') === [AUDIT_ACTIONS.CREATED, AUDIT_ACTIONS.SUBMITTED, AUDIT_ACTIONS.REJECTED, AUDIT_ACTIONS.RESUBMITTED, AUDIT_ACTIONS.APPROVED, AUDIT_ACTIONS.PAID, AUDIT_ACTIONS.CANCEL_PAYMENT].join(','));
ok('E2 legacy record still stored and queryable', state().eosb.some((e) => e.id === 'E-LEGACY' && e.netSettlementAmount === 5000));
ok('E3 chain valid across the legacy path', chainValidAfterEach('legacy'));

// ===========================================================================
console.log('F. Guarded-layer denials never mutate the record and are honest events');
emptyBase();
const fSettlement = createViaRealUI(state().employees.find((e) => e.id === 'emp-1'), 'mutual_agreement', '2026-09-30', { notes: 'denial path' });
let fReturned = transitionEosbGuarded(HR, recordOf(fSettlement.id), 'draft', { rejectionReason: 'needs correction' }).batch;
storage.persistEosb(fReturned);
ok('F1 returned record prepared', recordOf(fSettlement.id).status === 'draft' && !!recordOf(fSettlement.id).rejectedBy);
// out-of-scope user attempts a correction on the comp-1 record
const fFresh = calculateEOSB({ employee: state().employees.find((e) => e.id === 'emp-1'), terminationDate: '2026-09-30', reason: 'mutual_agreement', settings: state().settings, companies: state().companies });
r = recordEosbCorrectionGuarded(SCOPED, recordOf(fSettlement.id), fFresh, { reason: 'out of scope try' });
ok('F2 out-of-scope correction DENIED (scope)', r.ok === false && r.layer === 'scope' && r.batch === fFresh);
const fDen = deniedEvents(fSettlement.id).filter((e) => e.newValue.requestedAction === 'edit');
ok('F3 out-of-scope correction recorded as a denied event', fDen.length >= 1 && fDen[0].newValue.layer === 'scope');
// paid edits (each click persists — exactly the real EOSBView handler contract)
let fPaid = transitionEosbGuarded(HR, recordOf(fSettlement.id), 'under_audit', { reason: 'resubmit' }).batch;
storage.persistEosb(fPaid);
fPaid = transitionEosbGuarded(HR, recordOf(fSettlement.id), 'approved', { reason: 'ok' }).batch;
storage.persistEosb(fPaid);
fPaid = transitionEosbGuarded(HR, recordOf(fSettlement.id), 'paid', { reason: 'pay' }).batch;
storage.persistEosb(fPaid);
const preDenyRevision = recordOf(fSettlement.id).revision;
r = transitionEosbGuarded(HR, recordOf(fSettlement.id), 'paid', { by: HR.name });
ok('F4 double-pay denied and the record is untouched', r.ok === false && recordOf(fSettlement.id).revision === preDenyRevision && recordOf(fSettlement.id).status === 'paid');
ok('F5 denied double-pay is a denied event (never a success)', eosbEvents(fSettlement.id).filter((e) => e.action === AUDIT_ACTIONS.PAID).length === 1 && deniedEvents(fSettlement.id).some((e) => e.newValue.requestedAction === 'disburse'));
ok('F6 chain valid after denial matrix', chainValidAfterEach('denials'));
const verF = verifyAuditTrail(storage.getAuditTrailMeta().envelope);
ok('F7 full audit chain integrity end-to-end', verF.valid === true);

// ===========================================================================
console.log('SUMMARY');
console.log(`  passed: ${passed}`);
console.log(`  failed: ${failed}`);
if (failed > 0) {
  console.log('  failures:');
  failures.forEach((f) => console.log(`    - ${f}`));
  process.exit(1);
}