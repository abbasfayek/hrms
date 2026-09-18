// P17 — FR-1-D2b System Admin Reactivation Suite.
//
// A fully-returned payroll (status 'approved' + fullReturn.completed === true)
// is administratively frozen (D2 returned_batch_immutable gate on the server
// and reactivation_required on the client engines). FR-1-D2b adds the ONE
// sanctioned release: a System Admin reactivation write, requiring
//   1. an authenticated super_admin ACTOR, AND       (isSuper + can reactivate)
//   2. a stored record that is genuinely fully-returned, AND
//   3. a structurally-valid reactivation PAYLOAD (marker with mandatory reason,
//      previousStatus 'approved', reactivated audit entry, original full-return
//      preserved in returnHistory, zero financial movement).
// The engine operation (reactivateFullReturnedBatch) lands the batch in the
// correction state (status 'rejected', fullReturnState 'reactivated',
// returnState 'needs_correction') WITHOUT touching rejectionHistory, loans or
// any financial value — the reactivation is NOT a new state-matrix edge and it
// is NOT an approval/re-pay shortcut, so once sanctioned the batch goes through
// the normal rejected -> under_audit -> approved -> paid pipeline again.
//
// In-memory only: mock localStorage; server assertions go through
// scopeValidateWrite exactly like P16. Never touches data/ or commit-level state.

if (!globalThis.window) globalThis.window = globalThis;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
  };
}

const JS = 'file:///C:/Users/Pc%20Zone/Desktop/hr/public/js/';

let passed = 0;
let failed = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
};
const json = (v) => JSON.stringify(v, null, 0);
const clone = (v) => JSON.parse(JSON.stringify(v));

const {
  ALL_PERMISSIONS: SERVER_PERMS,
  getEffectivePerms: serverPerms,
  scopeValidateWrite,
} = await import('../server-authz.mjs');

const {
  reactivateFullReturnedBatch,
  transitionPayroll,
  PAYROLL_RETURN_STATE,
} = await import(`${JS}engines/payrollEngine.js`);

const {
  requirePayrollAction,
  reactivateFullReturnedBatchGuarded,
  transitionPayrollGuarded,
  setAuditDeniedHook,
} = await import(`${JS}engines/payrollAccess.js`);

const { ALL_PERMISSIONS: CLIENT_PERMS } = await import(`${JS}types.js`);

const { disbursePayrollAtomic } = await import(`${JS}engines/payrollDisbursement.js`);

const { storage } = await import(`${JS}storage.js`);

const SUP = { id: 'usr-sup', username: 'usr-sup', name: 'Super', role: 'super_admin', assignedCompanyId: 'all', assignedBranchId: 'all', permissions: null };

const mkUser = (id, role, comp, br, perms = null) => ({
  id, username: id, name: id, role, companyId: comp, branchId: br,
  permissionKey: role, permissions: perms,
});
const ctxOf = (u) => ({
  user: u,
  scope: {
    companyId: u.companyId, branchId: u.branchId,
    compScoped: true, branchScoped: true, allowedBranchIds: new Set([u.branchId]),
  },
});
const superCtx = (declaredBranchId, declaredCompanyId = 'comp-1') => ({
  user: SUP, declaredBranchId, declaredCompanyId, scope: { compScoped: false, branchScoped: false },
});

// ---------------------------------------------------------------------------
// Fixtures (pages mirror the P16 returned batch so ALL D2 lock semantics apply)
// ---------------------------------------------------------------------------
const returnedBatch = {
  id: 'p-ret-1',
  month: '2026-09',
  status: 'approved',
  companyId: 'comp-1',
  branchId: 'br-1',
  updatedAt: '2026-09-16T00:00:00Z',
  revision: 4,
  fullReturn: { completed: true, previousStatus: 'paid', reason: 'Customer requested reversal', displacedCorrectionId: 'C-1', at: '2026-09-16T00:00:00Z' },
  auditHistory: [
    { action: 'full_return', from: 'paid', to: 'approved', at: '2026-09-16T00:00:00Z' },
    { action: 'approved', from: 'under_audit', to: 'approved', at: '2026-09-15T00:00:00Z' },
  ],
  rejectionHistory: [
    { by: 'r-1', at: '2026-09-10T00:00:00Z', reason: 'prior audit note' },
  ],
  ratesSnapshot: { base: 1, USD: 1300 },
  governance: { approvedBy: 'r-1', approvedAt: '2026-09-15T00:00:00Z' },
  currencyModel: { base: 'IQD', rates: { USD: 1300 } },
  totalsByCurrency: [
    { code: 'USD', gross: 2000, deductions: 240, net: 1760, gosi: 60, companyGosi: 30 },
  ],
  totalGross: 2000,
  totalDeductions: 240,
  totalNet: 1760,
  totalGosi: 60,
  totalCompanyGosi: 30,
  totalEOSB: 0,
  items: [
    {
      employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1',
      employeeName: 'Emp One',
      currency: 'USD', salaryCurrency: 'USD',
      exchangeRate: 1300, exchangeRateDate: '2026-08-01T00:00:00Z',
      baseCurrency: 'IQD', baseAmount: 2600000, exchangeRateStatus: 'locked',
      basicSalary: 1000, housingAllowance: 400, transportAllowance: 200,
      otherAllowances: 100, overtimeAmount: 50, bonuses: 250, totalEarnings: 2000,
      grossSalary: 2000, gosiEmployeeDeduction: 60, gosiCompanyContribution: 30,
      loanInstallment: 0, absentDays: 1, absenceDeduction: 100,
      lateMinutes: 30, lateDeduction: 50, otherDeductions: 20,
      penaltiesDeduction: 10, totalDeductions: 240, netSalary: 1760,
      loans: [],
    },
  ],
};

const freshApprovedFinal = clone(returnedBatch);
freshApprovedFinal.fullReturn = undefined;
delete freshApprovedFinal.fullReturn;
freshApprovedFinal.auditHistory = returnedBatch.auditHistory.filter((a) => a.action !== 'full_return');

const mockEmployees = () => [{ id: 'emp-1', companyId: 'comp-1', branchId: 'br-1' }];

const cohr = ctxOf(mkUser('c', 'company_hr', 'comp-1', 'br-1'));
const officer = ctxOf(mkUser('o', 'payments_officer', 'comp-1', 'br-1'));
const reviewer = ctxOf(mkUser('r', 'audit_reviewer', 'comp-1', 'br-1'));
const payrollAdmin = ctxOf(mkUser('p', 'payroll_admin', 'comp-1', 'br-1'));

// ---------------------------------------------------------------------------
console.log('\n[A] Permission inventory parity — payroll.reactivate in both');
ok('A1. server ALL_PERMISSIONS exposes payroll.reactivate',
  SERVER_PERMS.includes('payroll.reactivate'));
ok('A2. client ALL_PERMISSIONS exposes payroll.reactivate',
  CLIENT_PERMS.includes('payroll.reactivate'));
ok('A3. inventory parity for the reactivate permission',
  SERVER_PERMS.includes('payroll.reactivate') === CLIENT_PERMS.includes('payroll.reactivate'));
ok('A4. super_admin receives payroll.reactivate through ALL_PERMISSIONS (default perms)',
  serverPerms(SUP).includes('payroll.reactivate'));

// ---------------------------------------------------------------------------
console.log('\n[B] Engine: reactivateFullReturnedBatch — sanctioned operation');
const engineOut = () => reactivateFullReturnedBatch(clone(returnedBatch), { by: 'Super', reason: 'Reopened for correction after client review' });

const res1 = engineOut();
ok('B1. fully-returned batch is reactivated ok',
  res1.ok === true, json(res1));
ok('B2. lands in PAYROLL_RETURN_STATE (rejected, returned/needs-correction safety)',
  res1.ok && res1.batch.status === PAYROLL_RETURN_STATE && PAYROLL_RETURN_STATE === 'rejected', json(res1.batch && res1.batch.status));
ok('B3. fullReturnState=reactivated, returnState=needs_correction',
  res1.ok && res1.batch.fullReturnState === 'reactivated' && res1.batch.returnState === 'needs_correction');
ok('B4. completed full-return lock marker is cleared (not carried forward)',
  res1.ok && !(res1.batch.fullReturn && res1.batch.fullReturn.completed === true) && res1.batch.fullReturn === undefined);
ok('B5. original full-return event preserved in returnHistory (byte for byte)',
  res1.ok && Array.isArray(res1.batch.returnHistory) && res1.batch.returnHistory.length === 1 && json(res1.batch.returnHistory[0]) === json(returnedBatch.fullReturn));
ok('B6. reactivation marker present: completed + mandatory reason + previousStatus approved',
  res1.ok && res1.batch.reactivation && res1.batch.reactivation.completed === true &&
    String(res1.batch.reactivation.reason || '').trim().length > 0 &&
    res1.batch.reactivation.previousStatus === 'approved' &&
    json(res1.batch.reactivation.previousRevision) === '4');
ok('B7. revision increments exactly once',
  res1.ok && res1.batch.revision === 5);

// Financial byte/semantic equivalence BEFORE vs AFTER (spec FA-004).
const finShape = (b) => json({
  totals: [b.totalGross, b.totalDeductions, b.totalNet, b.totalGosi, b.totalCompanyGosi, b.totalEOSB],
  totalsByCurrency: b.totalsByCurrency,
  ratesSnapshot: b.ratesSnapshot,
  governance: b.governance,
  currencyModel: b.currencyModel,
  items: b.items,
});
ok('B8. financial byte-equivalence preserved across reactivation',
  res1.ok && finShape(returnedBatch) === finShape(res1.batch), finShape(res1.batch) === finShape(returnedBatch) ? '' : 'financial shape changed');
ok('B9. rejectionHistory untouched (append-only audit trail preserved)',
  res1.ok && json(res1.batch.rejectionHistory) === json(returnedBatch.rejectionHistory));
ok('B10. loans modelless: no loan field touched (item loanInstallment + item loans preserved)',
  res1.ok && res1.batch.items[0].loanInstallment === 0 && json(res1.batch.items[0].loans) === '[]');
ok('B11. audit triple stamp: auditHistory has reactivated approved->rejected',
  res1.ok && Array.isArray(res1.batch.auditHistory) && res1.batch.auditHistory.some((a) => a && a.action === 'reactivated' && a.from === 'approved' && a.to === 'rejected' && a.revision === 5), json(res1.batch.auditHistory));
ok('B12. audit triple stamp: auditAttempts has reactivated attempt',
  res1.ok && Array.isArray(res1.batch.auditAttempts) && res1.batch.auditAttempts.some((a) => a && a.result === 'reactivated' && a.fromVersion === 4 && a.toVersion === 5), json(res1.batch.auditAttempts));
ok('B13. audit triple stamp: versions gained a reactivation entry',
  res1.ok && Array.isArray(res1.batch.versions) && res1.batch.versions.some((v) => v && v.type === 'reactivation' && v.version === 5 && v.status === 'rejected'));

// Negative engine cases.
const negReason = reactivateFullReturnedBatch(clone(returnedBatch), { by: 'Super' });
ok('B14. missing mandatory reason refused (missing_reactivation_reason)',
  negReason.ok === false && negReason.error === 'missing_reactivation_reason', json(negReason));
const negState = reactivateFullReturnedBatch(clone(freshApprovedFinal), { by: 'Super', reason: 'x' });
ok('B15. non-returned (fresh approved) batch refused (only_fully_returned_can_reactivate)',
  negState.ok === false && negState.error === 'only_fully_returned_can_reactivate', json(negState));
const negPrev = reactivateFullReturnedBatch({ ...clone(returnedBatch), status: 'under_audit' }, { by: 'Super', reason: 'x' });
ok('B16. non-approved locked batch refused (reactivate_requires_previous_approved)',
  negPrev.ok === false && negPrev.error === 'reactivate_requires_previous_approved', json(negPrev));

// Reactivation must NOT be a new state-matrix edge: plain transition approved->rejected stays illegal.
const edgeCheck = transitionPayroll(clone(returnedBatch), 'rejected', { by: 'Super', reason: 'x' });
ok('B17. approved->rejected is NOT a generic transition edge (dedicated op only)',
  edgeCheck.ok === false, json(edgeCheck));

// ---------------------------------------------------------------------------
console.log('\n[C] Client guard stack: requirePayrollAction / guarded wrapper');
const gateFor = (user, batch) => requirePayrollAction(user, 'reactivate', batch);

ok('C1. super_admin + default inventory -> reactivate allowed at guard',
  (() => { const g = gateFor(SUP, clone(returnedBatch)); return g.ok === true; })(), json(gateFor(SUP, clone(returnedBatch))));
ok('C2. payroll.edit holder CANNOT reactivate (forbidden_action:reactivate)',
  (() => { const g = gateFor(mkUser('h', 'company_hr', 'comp-1', 'br-1'), clone(returnedBatch)); return g.ok === false && g.error === 'forbidden_action:reactivate' && g.layer === 'permission'; })());
ok('C3. payroll.disburse holder CANNOT reactivate',
  (() => { const g = gateFor(mkUser('o', 'payments_officer', 'comp-1', 'br-1'), clone(returnedBatch)); return g.ok === false && g.error === 'forbidden_action:reactivate'; })());
ok('C4. payroll.reactivate holder who is NOT super_admin refused (super_admin_required)',
  (() => { const g = gateFor(mkUser('hr2', 'company_hr', 'comp-1', 'br-1', ['payroll.edit', 'payroll.reactivate']), clone(returnedBatch)); return g.ok === false && g.error === 'super_admin_required' && g.layer === 'permission'; })());
ok('C5. super WITHOUT reactivate (explicit restricted inventory) refused at permission layer',
  (() => { const supNoRe = { ...SUP, permissions: ['payroll.view'] }; const g = gateFor(supNoRe, clone(returnedBatch)); return g.ok === false && g.error === 'forbidden_action:reactivate'; })());
ok('C6. reactivate on a NOT fully-returned fresh approved batch refused (reactivate_requires_fully_returned)',
  (() => { const g = gateFor(SUP, clone(freshApprovedFinal)); return g.ok === false && g.error === 'reactivate_requires_fully_returned' && g.layer === 'state'; })());
ok('C7. disburse on the fully-returned batch STILL refused (reactivation_required)',
  (() => { const g = requirePayrollAction(mkUser('o', 'payments_officer', 'comp-1', 'br-1'), 'disburse', clone(returnedBatch)); return g.ok === false && g.error === 'reactivation_required'; })());

// Denied attempts raise an audit-denial event via the hook.
const evs = [];
setAuditDeniedHook((ev) => evs.push(ev));
const deniedGuarded = reactivateFullReturnedBatchGuarded(mkUser('hr2', 'company_hr', 'comp-1', 'br-1', ['payroll.edit', 'payroll.reactivate']), clone(returnedBatch), { reason: 'x' });
ok('C8. guarded wrapper reflects the non-super denial (super_admin_required)',
  deniedGuarded.ok === false && deniedGuarded.error === 'super_admin_required', json(deniedGuarded));
ok('C9. denied reactivation fires audit-denial event (action=reactivate)',
  evs.some((e) => e && e.action === 'reactivate' && e.error === 'super_admin_required'), json(evs[evs.length - 1]));

const guardedOk = reactivateFullReturnedBatchGuarded(SUP, clone(returnedBatch), { by: 'Super', reason: 'Reopened for correction after client review' });
ok('C10. guarded wrapper allows the sanctioned super reactivation and records it',
  guardedOk.ok === true && guardedOk.batch.status === 'rejected' && guardedOk.batch.revision === 5, json(guardedOk && guardedOk.batch && { s: guardedOk.batch.status, r: guardedOk.batch.revision }));

// ---------------------------------------------------------------------------
console.log('\n[D] Server authorization: the sanctioned write is accepted ONLY for a real System Admin');
const sGate = (rec, stored = [clone(returnedBatch)]) =>
  scopeValidateWrite('payrolls', [rec], superCtx('br-1'), mockEmployees, stored);

ok('D1. sanctioned reactivation payload accepted for the stored returned batch',
  (() => { const r = sGate(res1.batch); return r.ok === true; })(), json(sGate(res1.batch)));
ok('D2. non-super (with payroll.reactivate) sanctioned payload refused (returned_batch_immutable)',
  (() => {
    const staged = ctxOf(mkUser('hr2', 'company_hr', 'comp-1', 'br-1', ['payroll.edit', 'payroll.reactivate']));
    const r = scopeValidateWrite('payrolls', [res1.batch], staged, mockEmployees, [clone(returnedBatch)]);
    return r.ok === false && r.reason === 'returned_batch_immutable' && r.status === 403;
  })());
ok('D3. forged marker (reactivation without any real audit writer) refused',
  (() => {
    const forged = clone(res1.batch);
    forged.auditHistory = returnedBatch.auditHistory.slice(); // no reactivated entry
    forged.reactivation.previousStatus = 'draft';
    const r = sGate(forged);
    return !r.ok && r.reason === 'returned_batch_immutable';
  })());
ok('D4. structurally-valid payload WITH a financial tamper refused',
  (() => {
    const tampered = clone(res1.batch);
    tampered.items[0].netSalary = 9999;
    const r = sGate(tampered);
    return !r.ok && r.reason === 'returned_batch_immutable';
  })());
ok('D5. version-identical stored batch: super non-sanctioned edit STILL frozen (returned_batch_immutable)',
  (() => {
    const rec = clone(returnedBatch); rec.updatedAt = '2026-09-16T01:00:00Z'; rec.displayNumber = 'MT-BAD';
    const r = sGate(rec);
    return !r.ok && r.reason === 'returned_batch_immutable';
  })());
ok('D6. out-of-scope sanctioned payload refused: scope_violation (super write still branch-bound)',
  (() => {
    const wrong = { ...clone(res1.batch), branchId: 'br-9' };
    const r = sGate(wrong);
    return !r.ok && r.reason === 'scope_violation';
  })());

// ---------------------------------------------------------------------------
console.log('\n[E] Post-reactivation life: lock lifted, normal pipeline restored');
const reactivatedStored = res1.batch;
const asStored = { payrolls: [clone(reactivatedStored)], loans: [] };
const getStateDat = () => ({ payrolls: asStored.payrolls, loans: asStored.loans });

ok('E1. stored reactivated batch is no longer a returned record (fullReturn gone)',
  !(reactivatedStored.fullReturn && reactivatedStored.fullReturn.completed === true) && reactivatedStored.status === 'rejected');

// Ordinary HR correction write on the reactivated (rejected) batch passes the
// server: same-status edit by the payroll.edit holder is a normal write again.
ok('E2. payroll.edit holder can edit the reactivated (rejected) batch (no immutability gate)',
  (() => {
    const rec = clone(reactivatedStored);
    rec.updatedAt = '2026-09-17T00:00:00Z';
    rec.displayNumber = 'CORRECT-1';
    const r = scopeValidateWrite('payrolls', [rec], payrollAdmin, mockEmployees, [clone(reactivatedStored)]);
    return r.ok === true;
  })(), json(scopeValidateWrite('payrolls', [clone(reactivatedStored)], payrollAdmin, mockEmployees, [clone(reactivatedStored)])));

// Resubmit path: rejected -> under_audit by payroll_admin.
const sub = transitionPayrollGuarded(mkUser('p', 'payroll_admin', 'comp-1', 'br-1'), clone(reactivatedStored), 'under_audit', { by: 'Payroll' });
ok('E3. reactivated batch can be re-submitted (rejected -> under_audit)',
  sub.ok === true && sub.batch.status === 'under_audit', json(sub));
// Re-approval: under_audit -> approved by audit_reviewer.
const appr = transitionPayrollGuarded(mkUser('r', 'audit_reviewer', 'comp-1', 'br-1'), clone(sub.batch), 'approved', { by: 'Audit' });
ok('E4. re-approved (under_audit -> approved) after reactivation',
  appr.ok === true && appr.batch.status === 'approved', json(appr));
// Disburse path: approved -> paid through the D2-exempted pipeline again.
ok('E5. disburse guard cleared after reactivation (no reactivation_required)',
  (() => { const g = requirePayrollAction(mkUser('o', 'payments_officer', 'comp-1', 'br-1'), 'disburse', appr.batch); return g.ok === true; })(),
  json(requirePayrollAction(mkUser('o', 'payments_officer', 'comp-1', 'br-1'), 'disburse', appr.batch)));
const atomicStorage = {
  getState: getStateDatSafe,
  addPayrollBatch: (b) => { asStored.payrolls = [b]; },
  saveLoans: (l) => { asStored.loans = l; },
  addAudit: () => {},
  _saveDisbursement: () => {},
};
function getStateDatSafe() { return getStateDat(); }
let disb = null;
try {
  disb = disbursePayrollAtomic({ user: mkUser('o', 'payments_officer', 'comp-1', 'br-1'), batch: clone(appr.batch), storage: atomicStorage, by: 'Officer' });
} catch (e) { disb = { ok: false, error: e && e.message }; }
ok('E6. atomic disbursement works again after reactivation + re-approval',
  disb && disb.ok === true && disb.batch && disb.batch.status === 'paid', json(disb));

// ---------------------------------------------------------------------------
console.log('\n[F] Lock regression anchors unchanged (D2 fail-closed behavior)');
ok('F1. ordinary HR financial edit on the frozen returned record refused (returned_batch_immutable)',
  (() => { const rec = clone(returnedBatch); rec.updatedAt = '2026-09-16T01:00:00Z'; rec.items[0].netSalary = 9999; const r = scopeValidateWrite('payrolls', [rec], cohr, mockEmployees, [clone(returnedBatch)]); return r.ok === false && r.reason === 'returned_batch_immutable'; })());
ok('F2. super financial edit on the frozen returned record refused (returned_batch_immutable)',
  (() => { const rec = clone(returnedBatch); rec.updatedAt = '2026-09-16T01:00:00Z'; rec.items[0].netSalary = 9999; const r = sGate(rec); return !r.ok && r.reason === 'returned_batch_immutable'; })());
ok('F3. frozen returned batch: approved->paid still refused at server (returned_batch_immutable)',
  (() => { const rec = clone(returnedBatch); rec.updatedAt = '2026-09-16T01:00:00Z'; rec.status = 'paid'; const r = sGate(rec); return !r.ok && r.reason === 'returned_batch_immutable'; })());
ok('F4. disbursePayrollAtomic on frozen returned batch still refused before any mutation',
  (() => {
    const eng = { getState: () => ({ payrolls: [clone(returnedBatch)], loans: [{ id: 'L-1', paidAmount: 0, remainingAmount: 500, status: 'active' }] }), set: () => {}, saveLoans: () => {}, savePayroll: () => {}, _saveDisbursement: () => {} };
    let err = null;
    try { const r = disbursePayrollAtomic({ user: SUP, batch: clone(returnedBatch), storage: eng, by: 'Super' }); err = r && r.error; } catch (e) { err = e && e.message; }
    return err === 'reactivation_required';
  })());

// ---------------------------------------------------------------------------
console.log('\n[G] User-facing error text (storage) for the new codes');
['only_fully_returned_can_reactivate', 'reactivate_requires_previous_approved', 'missing_reactivation_reason', 'super_admin_required', 'reactivate_requires_fully_returned'].forEach((code) => {
  ok(`G-en ${code} message present`, typeof storage.recordErrorText(code, true) === 'string' && storage.recordErrorText(code, true).length > 10);
  ok(`G-ar ${code} message present`, typeof storage.recordErrorText(code, false) === 'string' && storage.recordErrorText(code, false).length > 10);
});

console.log('\n==========================================================');
console.log(`P17 FR-1-D2b REACTIVATION SUITE: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log('  x ' + f));
  process.exit(1);
} else {
  console.log('All System Admin reactivation anchors verified.');
}