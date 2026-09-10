// =========================================================
// P2.2b Test Matrix — Phase 2 (Spec v1.0): Roles, granular
// permissions, scope and the guarded payroll action stack.
// Usage: node scripts/p2-2-roles-tests.mjs  (npm run p22:roles:test)
//
// Verifies the Phase 2 deliverables WITHOUT touching the Phase 1
// state machine:
//   1. New roles + fine-grained permission ids are registered.
//   2. Each financial role may only reach its sanctioned actions
//      (permission layer).
//   3. No user can out-of-scope a batch (scope layer).
//   4. Even a fully-permissioned role cannot skip the state machine
//      (state layer). cancelPayment stays dormant (paid is terminal).
//   5. The guard stack is the only path to Phase 1 transitions.
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
const {
  can,
  getEffectivePermissions,
  DEFAULT_ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  USER_ROLES,
  PERMISSIONS,
} = await import(`${JS}types.js`);
const { generateMonthlyPayroll, transitionPayroll, canTransitionPayroll, archivePayrollBatch } = await import(`${JS}engines/payrollEngine.js`);
const {
  requirePayrollAction,
  transitionPayrollGuarded,
  recordPayrollCorrectionGuarded,
  archivePayrollBatchGuarded,
  userScope,
  payrollBatchInScope,
  PAYROLL_ACTION_PERMISSIONS,
  PAYROLL_TRANSITION_ACTION,
} = await import(`${JS}engines/payrollAccess.js`);

store.clear();
storage.seedIfMissing();
storage.saveCompanies(defaultCompanies);
storage.saveSettings({ ...defaultSettings, currency: 'USD', currencySymbol: '$', dailyRateMethod: 'fixed30' });

const mkEmp = (id, extra = {}) => ({
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
  ...extra,
});
const empA = mkEmp('emp-p2b-a');
const empOther = mkEmp('emp-p2b-other', { companyId: 'comp-2', branchId: 'br-9' });
storage.saveEmployees([empA, empOther]);

const mkUser = (id, role, assignedCompanyId = 'comp-1', assignedBranchId = 'all') => ({
  id, username: id, password: 'x', name: id, role, assignedCompanyId, assignedBranchId, permissions: null,
});
const uPayrollAdmin = mkUser('u-pa-admin', 'payroll_admin');
const uAuditReviewer = mkUser('u-pa-reviewer', 'audit_reviewer');
const uPaymentsOfficer = mkUser('u-pa-payments', 'payments_officer');
const uSuperAdmin = { id: 'u-pa-super', username: 'u-pa-super', password: 'x', name: 'Super', role: 'super_admin', assignedCompanyId: 'all', assignedBranchId: 'all', permissions: null };

const state0 = storage.getState();
const batchDraft = generateMonthlyPayroll([empA], state0.overtime, state0.loans, state0.attendance, { month: '2026-03', issueDate: '2026-03-31', title: 'D', companies: defaultCompanies }, state0.settings);
const batchAudit = transitionPayroll(batchDraft, 'under_audit', { by: 'HR' }).batch;
const batchApproved = transitionPayroll(batchAudit, 'approved', { by: 'Audit' }).batch;
const batchPaid = transitionPayroll(batchApproved, 'paid', { by: 'Pay' }).batch;
const batchRejected = transitionPayroll(batchAudit, 'rejected', { by: 'Audit', rejectionReason: 'check' }).batch;
const batchOtherDraft = generateMonthlyPayroll([empOther], state0.overtime, state0.loans, state0.attendance, { month: '2026-03', issueDate: '2026-03-31', title: 'D2', companies: defaultCompanies }, state0.settings);
const batchOtherAudit = transitionPayroll(batchOtherDraft, 'under_audit', { by: 'HR' }).batch;

console.log('  [P2.2b role registry + fine-grained permission ids]');
ok('USER_ROLES registers payroll_admin', !!USER_ROLES.payroll_admin && (USER_ROLES.payroll_admin.badgeClass || '').includes('purple'));
ok('USER_ROLES registers audit_reviewer', !!USER_ROLES.audit_reviewer && (USER_ROLES.audit_reviewer.badgeClass || '').includes('cyan'));
ok('USER_ROLES registers payments_officer', !!USER_ROLES.payments_officer && (USER_ROLES.payments_officer.badgeClass || '').includes('gold'));
ok('ALL_PERMISSIONS catalog has payroll.submit', ALL_PERMISSIONS.includes('payroll.submit'));
ok('ALL_PERMISSIONS catalog has payroll.reject', ALL_PERMISSIONS.includes('payroll.reject'));
ok('ALL_PERMISSIONS catalog has payroll.cancelPayment', ALL_PERMISSIONS.includes('payroll.cancelPayment'));
ok('ALL_PERMISSIONS catalog has payroll.archive', ALL_PERMISSIONS.includes('payroll.archive'));
ok('catalog keeps legacy ids (approve/disburse/export)', ALL_PERMISSIONS.includes('payroll.approve') && ALL_PERMISSIONS.includes('payroll.disburse') && ALL_PERMISSIONS.includes('payroll.export'));
ok('PERMISSIONS label exists for the 4 new ids', ['payroll.submit', 'payroll.reject', 'payroll.cancelPayment', 'payroll.archive'].every((p) => !!(PERMISSIONS[p] && PERMISSIONS[p].ar && PERMISSIONS[p].en)));

console.log('  [P2.2b default role matrices]');
const defPa = DEFAULT_ROLE_PERMISSIONS.payroll_admin;
const defAr = DEFAULT_ROLE_PERMISSIONS.audit_reviewer;
const defPo = DEFAULT_ROLE_PERMISSIONS.payments_officer;
ok('payroll_admin matrix: generate/edit/submit/export', ['payroll.view', 'payroll.generate', 'payroll.edit', 'payroll.submit', 'payroll.export'].every((p) => defPa.includes(p)));
ok('payroll_admin matrix: NO approve/reject/disburse/archive', ['payroll.approve', 'payroll.reject', 'payroll.disburse', 'payroll.archive', 'payroll.cancelPayment'].every((p) => !defPa.includes(p)));
ok('audit_reviewer matrix: approve/reject given', defAr.includes('payroll.approve') && defAr.includes('payroll.reject'));
ok('audit_reviewer matrix: NO generate/edit/submit/disburse/archive/export', ['payroll.generate', 'payroll.edit', 'payroll.submit', 'payroll.disburse', 'payroll.archive', 'payroll.export'].every((p) => !defAr.includes(p)));
ok('payments_officer matrix: view+disburse only for payroll', defPo.includes('payroll.view') && defPo.includes('payroll.disburse'));
ok('payments_officer matrix: NO generate/edit/submit/approve/reject/export/archive', ['payroll.generate', 'payroll.edit', 'payroll.submit', 'payroll.approve', 'payroll.reject', 'payroll.export', 'payroll.archive'].every((p) => !defPo.includes(p)));
ok('company_hr lost payroll.approve (archived to submit)', !DEFAULT_ROLE_PERMISSIONS.company_hr.includes('payroll.approve') && DEFAULT_ROLE_PERMISSIONS.company_hr.includes('payroll.submit'));

console.log('  [P2.2b can() + effective permissions]');
ok('can(): payroll_admin may submit', can(uPayrollAdmin, 'payroll.submit') === true);
ok('can(): payroll_admin cannot approve', can(uPayrollAdmin, 'payroll.approve') === false);
ok('can(): audit_reviewer may reject', can(uAuditReviewer, 'payroll.reject') === true);
ok('can(): payments_officer may disburse', can(uPaymentsOfficer, 'payroll.disburse') === true);
ok('can(): super_admin defaults to all 10 payroll perms', ['payroll.view', 'payroll.generate', 'payroll.edit', 'payroll.approve', 'payroll.reject', 'payroll.submit', 'payroll.cancelPayment', 'payroll.archive', 'payroll.export', 'payroll.disburse'].every((p) => can(uSuperAdmin, p)));
const wExplicit = { ...uPayrollAdmin, permissions: ['payroll.approve'] };
ok('explicit permissions array overrides the role defaults (admin grant honored)', can(wExplicit, 'payroll.approve') === true && can(wExplicit, 'payroll.submit') === false);
ok('resolver falls back to role defaults when permissions are null', getEffectivePermissions(uPayrollAdmin).includes('payroll.submit'));

console.log('  [P2.2b ALLOWED actions through the guard stack]');
ok('payroll_admin: generate on draft', requirePayrollAction(uPayrollAdmin, 'generate', batchDraft).ok === true);
ok('payroll_admin: edit on draft', requirePayrollAction(uPayrollAdmin, 'edit', batchDraft).ok === true);
ok('payroll_admin: submit on draft', requirePayrollAction(uPayrollAdmin, 'submit', batchDraft).ok === true);
ok('payroll_admin: resubmit on rejected', requirePayrollAction(uPayrollAdmin, 'submit', batchRejected).ok === true);
ok('payroll_admin: export', requirePayrollAction(uPayrollAdmin, 'export', batchDraft).ok === true);
ok('audit_reviewer: approve on under_audit', requirePayrollAction(uAuditReviewer, 'approve', batchAudit).ok === true);
ok('audit_reviewer: reject on under_audit', requirePayrollAction(uAuditReviewer, 'reject', batchAudit).ok === true);
ok('payments_officer: disburse on approved (payment queue point)', requirePayrollAction(uPaymentsOfficer, 'disburse', batchApproved).ok === true);
ok('super_admin: archive on paid', requirePayrollAction(uSuperAdmin, 'archive', batchPaid).ok === true);
ok('super_admin: every prep/review/pay action', ['generate', 'edit', 'submit', 'approve', 'reject', 'disburse'].every((a) => requirePayrollAction(uSuperAdmin, a, batchDraft).ok || requirePayrollAction(uSuperAdmin, a, batchAudit).ok || requirePayrollAction(uSuperAdmin, a, batchApproved).ok || requirePayrollAction(uSuperAdmin, a, batchDraft).ok));

console.log('  [P2.2b FORBIDDEN actions (permission layer)]');
ok('payroll_admin: cannot approve under_audit', requirePayrollAction(uPayrollAdmin, 'approve', batchAudit).ok === false && requirePayrollAction(uPayrollAdmin, 'approve', batchAudit).layer === 'permission');
ok('payroll_admin: cannot reject under_audit', requirePayrollAction(uPayrollAdmin, 'reject', batchAudit).ok === false && requirePayrollAction(uPayrollAdmin, 'reject', batchAudit).layer === 'permission');
ok('payroll_admin: cannot disburse approved', requirePayrollAction(uPayrollAdmin, 'disburse', batchApproved).ok === false && requirePayrollAction(uPayrollAdmin, 'disburse', batchApproved).layer === 'permission');
ok('payroll_admin: cannot archive paid', requirePayrollAction(uPayrollAdmin, 'archive', batchPaid).ok === false && requirePayrollAction(uPayrollAdmin, 'archive', batchPaid).layer === 'permission');
ok('audit_reviewer: cannot generate/edit/submit', ['generate', 'edit', 'submit'].every((a) => requirePayrollAction(uAuditReviewer, a, batchDraft).ok === false && requirePayrollAction(uAuditReviewer, a, batchDraft).layer === 'permission'));
ok('audit_reviewer: cannot disburse approved', requirePayrollAction(uAuditReviewer, 'disburse', batchApproved).ok === false && requirePayrollAction(uAuditReviewer, 'disburse', batchApproved).layer === 'permission');
ok('audit_reviewer: cannot export (view-only reviewer)', requirePayrollAction(uAuditReviewer, 'export', batchAudit).ok === false && requirePayrollAction(uAuditReviewer, 'export', batchAudit).layer === 'permission');
ok('payments_officer: cannot generate/edit/submit', ['generate', 'edit', 'submit'].every((a) => requirePayrollAction(uPaymentsOfficer, a, batchDraft).ok === false));
ok('payments_officer: cannot approve/reject', ['approve', 'reject'].every((a) => requirePayrollAction(uPaymentsOfficer, a, batchAudit).ok === false));
ok('payments_officer: cannot export/archive', requirePayrollAction(uPaymentsOfficer, 'export', batchApproved).ok === false && requirePayrollAction(uPaymentsOfficer, 'archive', batchPaid).ok === false);

console.log('  [P2.2b state layer: permissions can never skip the state machine]');
ok('super_admin: submit already-under-audit → state violation', requirePayrollAction(uSuperAdmin, 'submit', batchAudit).ok === false && requirePayrollAction(uSuperAdmin, 'submit', batchAudit).layer === 'state');
ok('super_admin: disburse on under_audit → state violation', requirePayrollAction(uSuperAdmin, 'disburse', batchAudit).ok === false && requirePayrollAction(uSuperAdmin, 'disburse', batchAudit).layer === 'state');
ok('super_admin: approve on approved → state violation', requirePayrollAction(uSuperAdmin, 'approve', batchApproved).ok === false && requirePayrollAction(uSuperAdmin, 'approve', batchApproved).layer === 'state');
ok('super_admin: archive on approved (not paid) → state violation', requirePayrollAction(uSuperAdmin, 'archive', batchApproved).ok === false && requirePayrollAction(uSuperAdmin, 'archive', batchApproved).layer === 'state');
ok('super_admin: guarded draft→paid is blocked with a state error', transitionPayrollGuarded(uSuperAdmin, batchDraft, 'paid').layer === 'state');
ok('super_admin: guarded draft→approved cannot skip audit', transitionPayrollGuarded(uSuperAdmin, batchDraft, 'approved').layer === 'state');
ok('super_admin: guarded paid→approved cannot unwind a paid batch (cancelPayment stays dormant), state-layer refusal', transitionPayrollGuarded(uSuperAdmin, batchPaid, 'approved').ok === false && transitionPayrollGuarded(uSuperAdmin, batchPaid, 'approved').layer === 'state');
ok('super_admin: guarded paid→approved never touches the engine (input stays paid)', (() => { const r = transitionPayrollGuarded(uSuperAdmin, batchPaid, 'approved'); return r.batch && r.batch.status === 'paid' && batchPaid.status === 'paid'; })());
ok('super_admin: guarded unknown destination never reaches the engine', transitionPayrollGuarded(uSuperAdmin, batchDraft, 'paid').ok === false);

console.log('  [P2.2b cross-role escalation is impossible without the permission]');
ok('payments_officer: guarded approve of under_audit is refused', transitionPayrollGuarded(uPaymentsOfficer, batchAudit, 'approved').ok === false && transitionPayrollGuarded(uPaymentsOfficer, batchAudit, 'approved').layer === 'permission');
ok('payroll_admin: guarded disburse of approved is refused', transitionPayrollGuarded(uPayrollAdmin, batchApproved, 'paid').ok === false && transitionPayrollGuarded(uPayrollAdmin, batchApproved, 'paid').layer === 'permission');
ok('audit_reviewer: guarded disburse of approved is refused', transitionPayrollGuarded(uAuditReviewer, batchApproved, 'paid').ok === false && transitionPayrollGuarded(uAuditReviewer, batchApproved, 'paid').layer === 'permission');
ok('explicit grant honors the action (design: admin may override defaults)', transitionPayrollGuarded(wExplicit, batchAudit, 'approved').ok === true);
ok('explicit grant still cannot violate the state machine', transitionPayrollGuarded(wExplicit, batchDraft, 'approved').ok === false && transitionPayrollGuarded(wExplicit, batchDraft, 'approved').layer === 'state');

console.log('  [P2.2b scope layer]');
ok('userScope: super_admin is global', userScope(uSuperAdmin).companyId === 'all' && userScope(uSuperAdmin).branchId === 'all');
ok('userScope: financial roles are company-scoped', userScope(uPayrollAdmin).companyId === 'comp-1' && userScope(uAuditReviewer).companyId === 'comp-1' && userScope(uPaymentsOfficer).companyId === 'comp-1');
ok('userScope: branch_hr keeps its branch, financial roles force branch all', userScope({ role: 'branch_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'br-1' }).branchId === 'br-1' && userScope(uPayrollAdmin).branchId === 'all');
ok('payroll_admin: out-of-company batch → scope violation', requirePayrollAction(uPayrollAdmin, 'submit', batchOtherDraft).ok === false && requirePayrollAction(uPayrollAdmin, 'submit', batchOtherDraft).layer === 'scope');
ok('audit_reviewer: out-of-company under-audit batch → scope violation', requirePayrollAction(uAuditReviewer, 'approve', batchOtherAudit).ok === false && requirePayrollAction(uAuditReviewer, 'approve', batchOtherAudit).layer === 'scope');
ok('payments_officer: out-of-company approved batch → scope violation', requirePayrollAction(uPaymentsOfficer, 'disburse', transitionPayroll(batchOtherAudit, 'approved', {}).batch).ok === false);
ok('payrollBatchInScope: own company batch is inside scope', payrollBatchInScope(uPayrollAdmin, batchDraft) === true);
ok('payrollBatchInScope: other company batch is outside scope', payrollBatchInScope(uPayrollAdmin, batchOtherDraft) === false);
ok('payrollBatchInScope: super_admin sees every company', payrollBatchInScope(uSuperAdmin, batchOtherDraft) === true);
ok('branch_hr: br-1 batch OK, br-2 batch blocked', requirePayrollAction({ role: 'branch_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'br-1', permissions: null }, 'generate', batchDraft).ok === true && requirePayrollAction(mkUser('u-br-2', 'branch_hr', 'comp-1', 'br-2'), 'generate', batchDraft).ok === false && requirePayrollAction(mkUser('u-br-2', 'branch_hr', 'comp-1', 'br-2'), 'generate', batchDraft).layer === 'scope');
ok('guarded transition enforces scope too', transitionPayrollGuarded(uPaymentsOfficer, transitionPayroll(batchOtherAudit, 'approved', {}).batch, 'paid').ok === false && transitionPayrollGuarded(uPaymentsOfficer, transitionPayroll(batchOtherAudit, 'approved', {}).batch, 'paid').layer === 'scope');

console.log('  [P2.2b storage visibility honors the financial roles scope]');
storage.addEmployee(empA);
storage.addEmployee(empOther);
storage.addUser(uPayrollAdmin);
storage.addUser(uAuditReviewer);
storage.addUser(uPaymentsOfficer);
storage.addUser(uSuperAdmin);
storage.setActiveUser('u-pa-admin');
let sPa = storage.getState();
ok('payroll_admin sees only its company employees', sPa.employees.some((e) => e.id === 'emp-p2b-a') && !sPa.employees.some((e) => e.id === 'emp-p2b-other'));
storage.setActiveUser('u-pa-reviewer');
ok('audit_reviewer sees only its company employees', !storage.getState().employees.some((e) => e.id === 'emp-p2b-other'));
storage.setActiveUser('u-pa-payments');
ok('payments_officer sees only its company employees', !storage.getState().employees.some((e) => e.id === 'emp-p2b-other'));
storage.setActiveUser('u-pa-super');
ok('super_admin sees every company', storage.getState().employees.some((e) => e.id === 'emp-p2b-other'));

console.log('  [P2.2b archive is a guarded, flag-based, paid-only operation]');
ok('archive on draft is refused by the engine', archivePayrollBatch(batchDraft, { by: 'S' }).ok === false);
ok('archive requires paid', archivePayrollBatch(batchApproved, { by: 'S' }).error === 'archive_requires_paid:approved');
const archRes = archivePayrollBatchGuarded(uSuperAdmin, batchPaid, { by: 'Super' });
ok('super_admin guarded archive succeeds', archRes.ok === true);
ok('archive flags the batch (no status change)', archRes.batch.archived === true && archRes.batch.status === 'paid');
ok('archive stamps archivedAt/archivedBy', !!archRes.batch.archivedAt && archRes.batch.archivedBy === 'Super');
ok('archive appends an archive entry to the audit history', archRes.batch.auditHistory.some((a) => a.action === 'archive'));
ok('archive never mutates the input batch', !batchPaid.archived);
ok('archive does not alter the Phase 1 state machine', canTransitionPayroll(batchPaid, 'paid').ok === false && canTransitionPayroll(batchPaid, 'approved').ok === false);
ok('payroll_admin cannot archive (permission layer)', archivePayrollBatchGuarded(uPayrollAdmin, batchPaid, { by: 'P' }).ok === false);
ok('audit_reviewer cannot archive (permission layer)', archivePayrollBatchGuarded(uAuditReviewer, batchPaid, { by: 'A' }).ok === false);

console.log('  [P2.2b correction is guarded the same way]');
const fixed = { ...batchRejected, items: batchRejected.items.map((it) => ({ ...it, overtimeAmount: (it.overtimeAmount || 0) + 5 })) };
ok('payroll_admin may record a correction on a Returned batch', recordPayrollCorrectionGuarded(uPayrollAdmin, batchRejected, fixed, { by: 'P' }).ok === true);
ok('audit_reviewer cannot record a correction', recordPayrollCorrectionGuarded(uAuditReviewer, batchRejected, fixed, { by: 'A' }).ok === false && recordPayrollCorrectionGuarded(uAuditReviewer, batchRejected, fixed, { by: 'A' }).layer === 'permission');
ok('payments_officer cannot record a correction', recordPayrollCorrectionGuarded(uPaymentsOfficer, batchRejected, fixed, { by: 'P' }).ok === false);
ok('payroll_admin correction out of scope is a scope violation', recordPayrollCorrectionGuarded(uPayrollAdmin, transitionPayroll(batchOtherDraft, 'under_audit', {}).batch, fixed, { by: 'P' }).ok === false);

console.log('  [P2.2b mapping sanity]');
ok('each transition has a sanctioned action', PAYROLL_TRANSITION_ACTION.under_audit === 'submit' && PAYROLL_TRANSITION_ACTION.approved === 'approve' && PAYROLL_TRANSITION_ACTION.rejected === 'reject' && PAYROLL_TRANSITION_ACTION.paid === 'disburse');
ok('each action maps to a distinct permission', PAYROLL_ACTION_PERMISSIONS.submit !== PAYROLL_ACTION_PERMISSIONS.approve && PAYROLL_ACTION_PERMISSIONS.archive === 'payroll.archive');

console.log(`\nP2.2b Roles/Permissions/Scope: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}