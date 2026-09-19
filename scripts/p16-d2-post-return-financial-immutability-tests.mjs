// P16 — FR-1-D2 Post-Return Financial Immutability (server-authoritative seal).
//
// After a structured full return a payroll batch lives in the machine as
// status='approved' with fullReturn.completed === true. D2 hardens that state:
//   • the paid-batch seal covers ALL monetary fields, currency snapshots, batch
//     totals, totalsByCurrency and governance/currency model (not just 7 items);
//   • a completed post-return batch becomes RETURNED_IMMUTABLE for ordinary AND
//     super writers (financial edits, metadata edits, status changes — even
//     approved→paid — all fail closed; a content-identical echo stays allowed);
//   • client engines refuse disburse / clearPayrollAmounts on returned batches
//     (reactivation_required) with an audit-denial event, and mirror the paid
//     seal field-for-field (single source of truth).
//
// In-memory only: mock localStorage; every server assertion goes through
// scopeValidateWrite / validateSuperWrite with explicit storedData, exactly the
// P12/P13 invocation pattern. Never touches data/ or commit-level state.

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
const json = (v) => JSON.stringify(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

const {
  PAYROLL_MONETARY_FIELDS,
  PAYROLL_CURRENCY_SNAPSHOT_FIELDS,
  PAYROLL_BATCH_TOTAL_FIELDS,
  scopeValidateWrite,
} = await import('../server-authz.mjs');

const {
  MONETARY_FIELDS,
  CURRENCY_SNAPSHOT_FIELDS,
  clearPayrollAmounts,
  transitionPayroll,
} = await import(`${JS}engines/payrollEngine.js`);

const {
  requirePayrollAction,
  transitionPayrollGuarded,
  setAuditDeniedHook,
} = await import(`${JS}engines/payrollAccess.js`);

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
// Fixtures
// ---------------------------------------------------------------------------
// A payroll that completed a structured full return: status approved +
// fullReturn.completed, with the full financial + currency + totals shape a
// sealed batch carries.
const returnedBatch = {
  id: 'p-ret-1',
  month: '2026-09',
  status: 'approved',
  companyId: 'comp-1',
  branchId: 'br-1',
  updatedAt: '2026-09-16T00:00:00Z',
  revision: 4,
  fullReturn: { completed: true, previousStatus: 'paid', reason: 'Customer requested reversal', at: '2026-09-16T00:00:00Z' },
  auditHistory: [
    { action: 'full_return', from: 'paid', to: 'approved', at: '2026-09-16T00:00:00Z' },
    { action: 'approved', from: 'under_audit', to: 'approved', at: '2026-09-15T00:00:00Z' },
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
    },
  ],
};

const retEdit = (mutator, bumpedAt = '2026-09-16T01:00:00Z') => {
  const rec = clone(returnedBatch);
  rec.updatedAt = bumpedAt;
  mutator(rec);
  return rec;
};

// A FRESH (never returned) approved batch — a control fixture with the same
// money shape as the returned one, for the unchanged-behavior anchors.
const returnedBatchMaster = clone(returnedBatch);
const freshApprovedFinal = {
  ...returnedBatchMaster,
  fullReturn: undefined,
  auditHistory: returnedBatchMaster.auditHistory.filter((a) => a.action !== 'full_return'),
  updatedAt: '2026-09-15T00:00:00Z',
};
delete freshApprovedFinal.fullReturn;

// A PAID batch (pre-return) used for the paid-seal anchors + full-return payload.
const paidBatch = {
  id: 'p-paid-1', month: '2026-09', status: 'paid', companyId: 'comp-1', branchId: 'br-1',
  updatedAt: '2026-09-15T00:00:00Z', revision: 3,
  ratesSnapshot: { base: 1, USD: 1300 },
  governance: { approvedBy: 'r-1', approvedAt: '2026-09-15T00:00:00Z' },
  currencyModel: { base: 'IQD', rates: { USD: 1300 } },
  totalsByCurrency: [{ code: 'USD', gross: 2000, deductions: 240, net: 1760, gosi: 60, companyGosi: 30 }],
  totalGross: 2000, totalDeductions: 240, totalNet: 1760, totalGosi: 60, totalCompanyGosi: 30, totalEOSB: 0,
  items: [
    {
      employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1',
      currency: 'USD', salaryCurrency: 'USD', exchangeRate: 1300,
      exchangeRateDate: '2026-08-01T00:00:00Z', baseCurrency: 'IQD', baseAmount: 2600000,
      exchangeRateStatus: 'locked',
      basicSalary: 1000, housingAllowance: 400, transportAllowance: 200,
      otherAllowances: 100, overtimeAmount: 50, bonuses: 250, totalEarnings: 2000,
      grossSalary: 2000, gosiEmployeeDeduction: 60, gosiCompanyContribution: 30,
      loanInstallment: 0, absentDays: 1, absenceDeduction: 100,
      lateMinutes: 30, lateDeduction: 50, otherDeductions: 20,
      penaltiesDeduction: 10, totalDeductions: 240, netSalary: 1760,
    },
  ],
};

const mockEmployees = () => [
  { id: 'emp-1', companyId: 'comp-1', branchId: 'br-1' },
];

const cohr = ctxOf(mkUser('c', 'company_hr', 'comp-1', 'br-1'));
const officer = ctxOf(mkUser('o', 'payments_officer', 'comp-1', 'br-1'));
const reviewer = ctxOf(mkUser('r', 'audit_reviewer', 'comp-1', 'br-1'));

// ---------------------------------------------------------------------------
console.log('\n[A] Paid-batch seal expansion — D2 NEWly-sealed fields + anchors');

const paidTamper = (mutator) => {
  const rec = clone(paidBatch);
  rec.updatedAt = '2026-09-15T01:00:00Z';
  mutator(rec);
  return rec;
};

// Money fields the OLD seal never inspected must now be refused on a paid batch.
ok('A1. bonuses tamper on paid item rejected (paid_batch_snapshot_immutable)',
  (() => { const r = scopeValidateWrite('payrolls', [paidTamper((b) => { b.items[0].bonuses = 999; })], cohr, mockEmployees, [clone(paidBatch)]); return r.ok === false && r.reason === 'paid_batch_snapshot_immutable' && r.status === 403; })());
ok('A2. housingAllowance tamper on paid item rejected',
  (() => { const r = scopeValidateWrite('payrolls', [paidTamper((b) => { b.items[0].housingAllowance = 0; })], cohr, mockEmployees, [clone(paidBatch)]); return r.ok === false && r.reason === 'paid_batch_snapshot_immutable'; })());
ok('A3. gosiCompanyContribution tamper on paid item rejected',
  (() => { const r = scopeValidateWrite('payrolls', [paidTamper((b) => { b.items[0].gosiCompanyContribution = 5; })], cohr, mockEmployees, [clone(paidBatch)]); return r.ok === false && r.reason === 'paid_batch_snapshot_immutable'; })());
ok('A4. loanInstallment tamper on paid item rejected',
  (() => { const r = scopeValidateWrite('payrolls', [paidTamper((b) => { b.items[0].loanInstallment = 100; })], cohr, mockEmployees, [clone(paidBatch)]); return r.ok === false && r.reason === 'paid_batch_snapshot_immutable'; })());
ok('A5. penaltiesDeduction tamper on paid item rejected',
  (() => { const r = scopeValidateWrite('payrolls', [paidTamper((b) => { b.items[0].penaltiesDeduction = 1; })], cohr, mockEmployees, [clone(paidBatch)]); return r.ok === false && r.reason === 'paid_batch_snapshot_immutable'; })());
ok('A6. batch totalNet tamper on paid batch rejected',
  (() => { const r = scopeValidateWrite('payrolls', [paidTamper((b) => { b.totalNet = 9999; })], cohr, mockEmployees, [clone(paidBatch)]); return r.ok === false && r.reason === 'paid_batch_snapshot_immutable'; })());
ok('A7. totalsByCurrency tamper on paid batch rejected',
  (() => { const r = scopeValidateWrite('payrolls', [paidTamper((b) => { b.totalsByCurrency[0].net = 999; })], cohr, mockEmployees, [clone(paidBatch)]); return r.ok === false && r.reason === 'paid_batch_snapshot_immutable'; })());
ok('A8. governance tamper on paid batch rejected',
  (() => { const r = scopeValidateWrite('payrolls', [paidTamper((b) => { b.governance.approvedBy = 'hacker'; })], cohr, mockEmployees, [clone(paidBatch)]); return r.ok === false && r.reason === 'paid_batch_snapshot_immutable'; })());
ok('A9. unchanged paid echo accepted',
  (() => { const r = scopeValidateWrite('payrolls', [clone(paidBatch)], cohr, mockEmployees, [clone(paidBatch)]); return r.ok === true; })());

// ---------------------------------------------------------------------------
console.log('\n[B] Fresh-approved controls — D2 must NOT change the normal machine');

ok('B1. fresh approved→paid by payments_officer still allowed',
  (() => { const r = scopeValidateWrite('payrolls', [{ ...clone(freshApprovedFinal), status: 'paid', updatedAt: '2026-09-15T01:00:00Z' }], officer, mockEmployees, [clone(freshApprovedFinal)]); return r.ok === true; })());
ok('B2. fresh approved same-status edit by company_hr still allowed',
  (() => { const r = scopeValidateWrite('payrolls', [{ ...clone(freshApprovedFinal), updatedAt: '2026-09-15T01:00:00Z' }], cohr, mockEmployees, [clone(freshApprovedFinal)]); return r.ok === true; })());

// ---------------------------------------------------------------------------
console.log('\n[C] Post-return immutability — returned_batch_immutable (ordinary writers)');

const gate = (rec, ctx = cohr, stored = [clone(returnedBatch)]) =>
  scopeValidateWrite('payrolls', [rec], ctx, mockEmployees, stored);

ok('C1. financial edit netSalary on returned -> returned_batch_immutable 403',
  (() => { const r = gate(retEdit((b) => { b.items[0].netSalary = 9999; })); return r.ok === false && r.reason === 'returned_batch_immutable' && r.status === 403; })());
ok('C2. bonuses edit on returned -> returned_batch_immutable 403',
  (() => { const r = gate(retEdit((b) => { b.items[0].bonuses = 999; })); return r.ok === false && r.reason === 'returned_batch_immutable'; })());
ok('C3. housingAllowance edit on returned -> returned_batch_immutable 403',
  (() => { const r = gate(retEdit((b) => { b.items[0].housingAllowance = 1; })); return r.ok === false && r.reason === 'returned_batch_immutable'; })());
ok('C4. non-financial metadata edit on returned -> returned_batch_immutable 403',
  (() => { const r = gate(retEdit((b) => { b.displayNumber = 'MT-BAD'; })); return r.ok === false && r.reason === 'returned_batch_immutable'; })());
ok('C5. batch total edit on returned -> returned_batch_immutable 403',
  (() => { const r = gate(retEdit((b) => { b.totalNet = 1; })); return r.ok === false && r.reason === 'returned_batch_immutable'; })());
ok('C6. totalsByCurrency edit on returned -> returned_batch_immutable 403',
  (() => { const r = gate(retEdit((b) => { b.totalsByCurrency[0].net = 1; })); return r.ok === false && r.reason === 'returned_batch_immutable'; })());
ok('C7. ratesSnapshot tamper on returned -> returned_batch_immutable 403',
  (() => { const r = gate(retEdit((b) => { b.ratesSnapshot = { base: 1, USD: 999 }; })); return r.ok === false && r.reason === 'returned_batch_immutable'; })());
ok('C8. identical returned echo, only updatedAt bumped -> allowed',
  (() => { const rec = clone(returnedBatch); rec.updatedAt = '2026-09-16T02:00:00Z'; return gate(rec).ok === true; })());
ok('C9. byte-identical returned echo -> allowed',
  (() => gate(clone(returnedBatch)).ok === true)());
ok('C10. returned approved->paid attempt by payments_officer denied',
  (() => { const r = gate(retEdit((b) => { b.status = 'paid'; }), officer); return r.ok === false && r.reason === 'returned_batch_immutable'; })());
ok('C11. returned -> rejected denied',
  (() => { const r = gate(retEdit((b) => { b.status = 'rejected'; }), reviewer); return r.ok === false && r.reason === 'returned_batch_immutable'; })());
ok('C12. returned -> under_audit denied',
  (() => { const r = gate(retEdit((b) => { b.status = 'under_audit'; }), reviewer); return r.ok === false && r.reason === 'returned_batch_immutable'; })());
ok('C13. returned -> draft denied',
  (() => { const r = gate(retEdit((b) => { b.status = 'draft'; }), cohr); return r.ok === false && r.reason === 'returned_batch_immutable'; })());

// Scope check still runs FIRST: a cross-company write is a scope violation, not
// an immutability verdict (a different company must not leak the returned state).
ok('C14. cross-company edit attempt on returned -> scope_violation',
  (() => {
    const other = ctxOf(mkUser('c2', 'company_hr', 'comp-2', 'br-2'));
    const r = gate(retEdit((b) => { b.items[0].netSalary = 9999; }), other);
    return r.ok === false && r.reason === 'scope_violation';
  })());

// ---------------------------------------------------------------------------
console.log('\n[D] Post-return immutability — super_admin');

const sGate = (rec, stored = [clone(returnedBatch)]) =>
  scopeValidateWrite('payrolls', [rec], superCtx('br-1'), mockEmployees, stored);

ok('D1. super financial edit on returned -> returned_batch_immutable 403',
  (() => { const r = sGate(retEdit((b) => { b.items[0].netSalary = 9999; })); return !r.ok && r.reason === 'returned_batch_immutable' && r.status === 403; })());
ok('D2. super returned approved->paid -> returned_batch_immutable 403',
  (() => { const r = sGate(retEdit((b) => { b.status = 'paid'; })); return !r.ok && r.reason === 'returned_batch_immutable'; })());
ok('D3. super identical returned echo -> allowed',
  (() => sGate(clone(returnedBatch)).ok === true)());
ok('D4. super returned-batch updatedAt-only bump -> allowed',
  (() => { const rec = clone(returnedBatch); rec.updatedAt = '2026-09-16T03:00:00Z'; return sGate(rec).ok === true; })());

// ---------------------------------------------------------------------------
console.log('\n[E] Paid exit path (pre-return) unchanged — full-return anchors');

const paidStored = [clone(paidBatch)];
ok('E1. paid->approved without full-return marker -> paid_batch_immutable',
  (() => { const r = scopeValidateWrite('payrolls', [{ ...clone(paidBatch), status: 'approved', updatedAt: '2026-09-16T00:00:00Z' }], reviewer, mockEmployees, paidStored); return r.ok === false && r.reason === 'paid_batch_immutable'; })());

const fullReturnPayload = {
  ...clone(paidBatch),
  status: 'approved',
  updatedAt: '2026-09-16T00:00:00Z',
  fullReturn: { completed: true, previousStatus: 'paid', reason: 'Customer requested reversal', at: '2026-09-16T00:00:00Z' },
  auditHistory: (paidBatch.auditHistory || []).concat([{ action: 'full_return', from: 'paid', to: 'approved', at: '2026-09-16T00:00:00Z' }]),
  rejectedBy: undefined,
};

ok('E2. genuine full-return payload by cancelPayment holder still accepted',
  (() => { const r = scopeValidateWrite('payrolls', [clone(fullReturnPayload)], reviewer, mockEmployees, paidStored); return r.ok === true; })());
const tamperedReturn = clone(fullReturnPayload);
tamperedReturn.items[0].netSalary = 9999;
ok('E3. financial tamper inside a full return -> paid_batch_snapshot_immutable',
  (() => { const r = scopeValidateWrite('payrolls', [tamperedReturn], reviewer, mockEmployees, paidStored); return r.ok === false && r.reason === 'paid_batch_snapshot_immutable'; })());

// ---------------------------------------------------------------------------
console.log('\n[F] Seal-field parity — server and client engines one-on-one');

const sorted = (a) => JSON.stringify([...a].sort());
ok('F1. server PAYROLL_MONETARY_FIELDS == engine MONETARY_FIELDS',
  sorted(PAYROLL_MONETARY_FIELDS) === sorted(MONETARY_FIELDS), `${PAYROLL_MONETARY_FIELDS.length}/${MONETARY_FIELDS.length}`);
ok('F2. server PAYROLL_CURRENCY_SNAPSHOT_FIELDS == engine CURRENCY_SNAPSHOT_FIELDS',
  sorted(PAYROLL_CURRENCY_SNAPSHOT_FIELDS) === sorted(CURRENCY_SNAPSHOT_FIELDS));
ok('F3. batch-total registry covers all six totals',
  ['totalGross', 'totalDeductions', 'totalNet', 'totalGosi', 'totalCompanyGosi', 'totalEOSB'].every((f) => PAYROLL_BATCH_TOTAL_FIELDS.includes(f)));
ok('F4. currency snapshot registry covers snapshots',
  ['currency', 'salaryCurrency', 'exchangeRate', 'exchangeRateDate', 'baseCurrency', 'baseAmount', 'exchangeRateStatus'].every((f) => PAYROLL_CURRENCY_SNAPSHOT_FIELDS.includes(f)));
ok('F5. monetary registry covers all client monetary fields',
  MONETARY_FIELDS.every((f) => PAYROLL_MONETARY_FIELDS.includes(f)));

// ---------------------------------------------------------------------------
console.log('\n[G] Client engine guards — disburse / clear on returned batches');

const retForEngine = clone(returnedBatch);

ok('G1. requirePayrollAction(disburse, returned) -> reactivation_required:state',
  (() => {
    const g = requirePayrollAction(mkUser('o', 'payments_officer', 'comp-1', 'br-1'), 'disburse', retForEngine);
    return g.ok === false && g.error === 'reactivation_required' && g.layer === 'state';
  })());
ok('G2. requirePayrollAction(disburse, fresh approved) still ok',
  (() => {
    const g = requirePayrollAction(mkUser('o', 'payments_officer', 'comp-1', 'br-1'), 'disburse', freshApprovedFinal);
    return g.ok === true;
  })());

const events = [];
setAuditDeniedHook((ev) => events.push(ev));
const guarded = transitionPayrollGuarded(mkUser('o', 'payments_officer', 'comp-1', 'br-1'), clone(retForEngine), 'paid');
ok('G3. transitionPayrollGuarded returned->paid blocked (reactivation_required)',
  guarded && guarded.ok === false && guarded.error === 'reactivation_required' && guarded.layer === 'state', json(guarded));
ok('G4. audit-denial event fires with action=disburse error=reactivation_required',
  events.some((e) => e && e.action === 'disburse' && String(e.error).includes('reactivation_required')), json(events[events.length - 1]));

// disbursePayrollAtomic must refuse BEFORE any loan mutation.
const engineStorage = {
  getState: () => ({ payrolls: [clone(retForEngine)], loans: [{ id: 'L-1', paidAmount: 0, remainingAmount: 500, status: 'active' }] }),
  set: () => {},
  saveLoans: () => {},
  savePayroll: () => {},
  _saveDisbursement: () => {},
};
let atomicError = null;
let loansAfterAttempt = null;
try {
  const res = disbursePayrollAtomic({ user: SUP, batch: clone(retForEngine), storage: engineStorage, by: 'Super' });
  atomicError = res && res.error;
  loansAfterAttempt = engineStorage.getState().loans;
} catch (e) {
  atomicError = e && e.message;
}
ok('G5. disbursePayrollAtomic on returned batch -> reactivation_required',
  atomicError === 'reactivation_required', json(atomicError));
ok('G6. no loan mutation happened under the refused disburse',
  loansAfterAttempt && loansAfterAttempt.length === 1 && loansAfterAttempt[0].paidAmount === 0 && loansAfterAttempt[0].remainingAmount === 500, json(loansAfterAttempt));

// clearPayrollAmounts returns an unchanged clone for paid/returned, warns once.
const warns = [];
const origWarn = console.warn;
console.warn = (m) => warns.push(String(m));
const clearedPaid = clearPayrollAmounts(clone(paidBatch));
const clearedRet = clearPayrollAmounts(clone(retForEngine));
const clearedDraft = clearPayrollAmounts({ ...clone(freshApprovedFinal), status: 'draft' });
console.warn = origWarn;

ok('G7. clearPayrollAmounts on paid batch returns an UNCHANGED clone',
  clearedPaid.status === 'paid' && clearedPaid.items[0].netSalary === paidBatch.items[0].netSalary && !clearedPaid.isAmountsCleared, json({ s: clearedPaid.status, net: clearedPaid.items[0].netSalary, isAmountsCleared: clearedPaid.isAmountsCleared }));
ok('G8. clearPayrollAmounts on returned batch returns an UNCHANGED clone',
  clearedRet.status === 'approved' && clearedRet.items[0].netSalary === returnedBatch.items[0].netSalary && !clearedRet.isAmountsCleared, json({ s: clearedRet.status, net: clearedRet.items[0].netSalary }));
ok('G9. clearPayrollAmounts warns on paid/returned (never silently mutates)',
  warns.some((w) => w.includes('clearPayrollAmounts is not applicable to paid/returned batches; refusing')), json(warns));
ok('G10. clearPayrollAmounts still clears a draft/returned-unmarked batch',
  clearedDraft.status === 'draft' && clearedDraft.items[0].netSalary === 0 && clearedDraft.isAmountsCleared === true, json({ s: clearedDraft.status, net: clearedDraft.items[0].netSalary }));

// ---------------------------------------------------------------------------
console.log('\n[H] User-facing error text (storage)');

ok('H1. reactivation_required has an EN message',
  typeof storage.recordErrorText('reactivation_required', true) === 'string' && storage.recordErrorText('reactivation_required', true).length > 20);
ok('H2. reactivation_required has an AR message',
  typeof storage.recordErrorText('reactivation_required', false) === 'string' && storage.recordErrorText('reactivation_required', false).length > 20);

console.log('\n==========================================================');
console.log(`P16 FR-1-D2 POST-RETURN FINANCIAL IMMUTABILITY: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log('  x ' + f));
  process.exit(1);
} else {
  console.log('All post-return financial immutability anchors verified.');
}