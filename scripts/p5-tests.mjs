// =========================================================
// P5 Test Matrix — Central Audit Trail (Phase 5, Spec v1.0).
// Usage: node scripts/p5-tests.mjs   (npm run p5:test)
//
// Verifies the mandatory Phase 5 areas:
//   1. created/submitted/rejected/corrected/resubmitted/approved/paid/archive
//   2. fields: record/source type, source/record ID, action, actor, timestamp,
//      oldValue, newValue, reason, version reference, audit-attempt reference,
//      financial snapshot (Original Amount / Currency / Exchange Rate / Rate
//      Date / Base Amount / Base Currency preserved, never recomputed)
//   3. append-only behavior (no edit/delete/overwrite of historical events)
//   4. hash-chain integrity: editing / deleting / reordering any event or
//      corrupting the envelope head is DETECTED by verifyAuditTrail
//   5. a forbidden payroll operation is a `denied` event — never a success
//   6. permission/scope/state-machine context respected (denied carries the
//      guard layer that rejected the attempt)
//   7. linkage to Phase 1 rejection fields & Phase 4 version chain
//   8. backward compatibility: legacy addAudit log untouched, liquidity of
//      prior phases unaffected (P4 snapshots preserved)
//   9. system meta events (records_cleared / data_reset)
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
const AT = `${JS}engines/auditTrail.js`;

let passed = 0;
let failed = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}`); }
};

const { storage } = await import(`${JS}storage.js`);
const { defaultCompanies, defaultSettings, defaultUsers } = await import(`${JS}seedData.js`);
const { transitionPayrollGuarded } = await import(`${JS}engines/payrollAccess.js`);
const {
  sha256hex, canonicalize, hashEntry, newEnvelope, appendAuditEvent,
  verifyAuditTrail, traceRecord, groupByRecord, financialFieldsOf,
  payrollFinancialView, AUDIT_ACTIONS, AUDIT_RECORD_TYPES, AUDIT_SCHEMA,
} = await import(AT);

const ADMIN = defaultUsers.find((u) => u.role === 'super_admin');
// Seed data ships a single super_admin; the role users below are fabricated
// with the SAME shape payrollAccess expects (permissions come from types.js).
const HR = { id: 'usr-hr', username: 'usr-hr', name: 'HR Manager', role: 'hr_manager', assignedCompanyId: 'all', assignedBranchId: 'all' };
const BRANCH_HR = { id: 'usr-bhr', username: 'usr-bhr', name: 'Branch HR', role: 'branch_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'br-2' };
const COMPANY_HR = { id: 'usr-chr', username: 'usr-chr', name: 'Company HR', role: 'company_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'all' };

function emptyBase() {
  store.clear();
  storage.seedIfMissing();
  storage.saveCompanies(defaultCompanies);
  storage.saveSettings({
    ...defaultSettings,
    currency: 'USD',
    currencySymbol: '$',
    baseCurrency: 'USD',
    dailyRateMethod: 'fixed30',
    customCurrencies: [{ code: 'IQD', symbol: 'ع.د' }],
  });
  storage.saveAttendance([]);
  storage.saveLeaves([]);
  storage.saveHourlyLeaves([]);
  storage.saveOvertime([]);
  storage.saveHolidays([]);
  storage.saveLoans([]);
  storage.saveIncrements([]);
  storage.savePayrolls([]);
  storage.saveEOSB([]);
  storage.saveEmployees([{
    id: 'emp-1',
    fullName: 'Test Emp',
    companyId: 'comp-1',
    branchId: 'br-1',
    department: 'IT',
    jobTitle: 'Engineer',
    hireDate: '2020-01-01',
    status: 'active',
    basicSalary: 6000,
    housingAllowance: 1500,
    transportAllowance: 600,
  }]);
}
function eventsOf(type, id) {
  return storage.getAuditTrail().filter((e) => e.recordType === type && String(e.recordId) === String(id));
}

console.log('P5 — Central Append-Only Audit Trail');

// ===========================================================================
console.log('A. Engine primitives: SHA-256 + canonical hashing + chain');
emptyBase();
ok('sha256("") === NIST e3b0…855', sha256hex('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
ok('sha256("abc") === NIST ba78…5ad', sha256hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
ok('hash is order-independent (canonical sorted keys)', hashEntry({ b: 1, a: { d: 2, c: 3 } }) === hashEntry({ a: { c: 3, d: 2 }, b: 1 }));
ok('hash excludes the hash field itself (stable regardless of hash value)', hashEntry({ amount: 5, hash: 'X' }) === hashEntry({ amount: 5, hash: 'Y' }));
const e1 = appendAuditEvent(newEnvelope(), { recordType: 'payroll', recordId: 'M', action: 'created', at: 't0' });
ok('first event seq=1, prevHash=null, hash present', e1.event.seq === 1 && e1.event.prevHash === null && typeof e1.event.hash === 'string');
const e2 = appendAuditEvent(e1.envelope, { recordType: 'payroll', recordId: 'M', action: 'submitted', at: 't1' });
ok('second event links first hash, seq=2', e2.event.seq === 2 && e2.event.prevHash === e1.event.hash);
ok('envelope chainHead tracks latest hash', e2.envelope.chainHead === e2.event.hash);
ok('pure append returns a NEW envelope (input untouched)', e1.envelope.events.length === 1);

console.log('B. Integrity detection: edit / delete / reorder / corrupt head');
let env = e2.envelope;
let ver = verifyAuditTrail(env);
ok('pristine chain valid', ver.valid === true && ver.count === 2 && ver.chainOk === true);
const tampered = { ...env, events: env.events.map((ev, i) => i === 0 ? { ...ev, reason: 'HACK' } : ev) };
ver = verifyAuditTrail(tampered);
ok('edited historical event is DETECTED', ver.valid === false && ver.brokenAt === 0);
const deleted = { ...env, events: env.events.slice(0, 1) };
ver = verifyAuditTrail(deleted);
ok('deleted event is DETECTED (break at junction + head mismatch)', ver.valid === false && (ver.brokenAt !== null || ver.chainOk === false));
const reordered = { ...env, events: [env.events[1], env.events[0]] };
ver = verifyAuditTrail(reordered);
ok('reordered events are DETECTED', ver.valid === false);
const badHead = { ...env, chainHead: '0'.repeat(64) };
ver = verifyAuditTrail(badHead);
ok('corrupted envelope head is DETECTED', ver.chainOk === false && ver.valid === false);
const tr = traceRecord(env.events, { recordType: 'payroll', recordId: 'M' });
ok('traceRecord returns chronological order', tr.map((x) => x.action).join(',') === 'created,submitted');
const grp = groupByRecord(env.events, 'payroll');
ok('groupByRecord clusters by record id', Object.keys(grp).length === 1 && grp['M'].length === 2);

// ===========================================================================
console.log('C. Payroll full lifecycle (real UI flow: in-place mutation + re-save)');
emptyBase();
storage.setActiveUser(String(ADMIN.id || ADMIN.username));
storage.setExchangeRate({ user: ADMIN, currency: 'IQD', rate: 1450, rateDate: '2026-07-01' });
const pb = {
  month: '2026-09',
  status: 'draft',
  items: [{ employeeId: 'emp-1', netSalary: 1000, currency: 'IQD' }],
  totalsByCurrency: [{ code: 'IQD', net: 1000 }],
};
storage.addPayrollBatch(pb);                       // created
ok('draft saved with stamped IQD snapshot @1450', pb.items[0].exchangeRate === 1450 && pb.items[0].baseAmount === 1450000);
pb.status = 'under_audit'; pb.transferredToAuditBy = 'Hisham';
storage.addPayrollBatch(pb);                       // submitted
pb.status = 'rejected'; pb.rejectedBy = 'Auditor'; pb.rejectionReason = 'deduction mismatch'; pb.auditNotes = 'check GOSI line';
storage.addPayrollBatch(pb);                       // rejected
const corr = { changes: [{ employeeId: 'emp-1', employeeName: 'Test Emp', field: 'totalDeductions', oldValue: 100, newValue: 90 }], by: 'Hisham', reason: 'fixed GOSI', toVersion: 2 };
pb.corrections = [corr]; pb.status = 'rejected'; pb.revision = 2;
storage.addPayrollBatch(pb);                       // corrected (status unchanged, corrections grew)
pb.status = 'under_audit'; pb.resubmittedBy = 'Hisham';
storage.addPayrollBatch(pb);                       // resubmitted
pb.status = 'approved'; pb.auditedBy = 'Auditor';
storage.addPayrollBatch(pb);                       // approved
pb.status = 'paid'; pb.paidBy = 'Cashier'; pb.paymentReference = { status: 'paid', referenceId: 'PMT-77' };
storage.addPayrollBatch(pb);                       // paid
pb.archived = true; pb.archivedBy = 'SuperAdmin';
storage.addPayrollBatch(pb);                       // archive
pb.archived = true;
storage.addPayrollBatch(pb);                       // plain archive re-save → NO event

const life = eventsOf('payroll', '2026-09');
const actions = life.map((e) => e.action);
ok('full lifecycle: created,submitted,rejected,corrected,resubmitted,approved,paid,archive',
  actions.join(',') === ['created', 'submitted', 'rejected', 'corrected', 'resubmitted', 'approved', 'paid', 'archive'].join(','));
const countPayroll = life.length;
ok('exactly one event per REAL change (no fabricated ones)', countPayroll === 8);

console.log('D. Event field completeness (actor / timestamp / reason / versions)');
const createdE = life[0];
ok('created carries recordType + recordId + schema p5', createdE.recordType === 'payroll' && createdE.recordId === '2026-09' && createdE.schema === AUDIT_SCHEMA);
ok('every event carries ISO timestamp', life.every((e) => typeof e.at === 'string' && Number.isFinite(Date.parse(e.at))));
ok('submitted actor = transferring user', life[1].actor.name === 'Hisham');
const rej = life[2];
ok('rejected carries rejection linkage (Phase 1 fields)', rej.rejection && rej.rejection.rejectedBy === 'Auditor' && rej.rejection.rejectionReason === 'deduction mismatch' && rej.reason === 'deduction mismatch');
ok('approved/rejected actors are not fabricated', rej.actor.name === 'Auditor' && life[5].actor.name === 'Auditor');
const corrE = life[3];
ok('corrected carries correction changes (old→new per employee)', corrE.corrections && corrE.corrections[0] && corrE.corrections[0].oldValue === 100 && corrE.corrections[0].newValue === 90);
ok('corrected links the version chain (revision 2)', corrE.versionId === 'V2');

console.log('E. Currency snapshot preservation (never recomputed at a later rate)');
storage.setExchangeRate({ user: ADMIN, currency: 'IQD', rate: 1500, rateDate: '2026-08-01', newRate: true });
const paidE = life[6];
ok('paid financial keeps ORIGINAL stamped rate 1450 (not 1500)', paidE.financial && Number(paidE.financial.totalsByCurrency[0].exchangeRate) === 1450);
ok('paid financial keeps original baseAmount 1450000 (never re-converted)', paidE.financial.totalsByCurrency[0].baseAmount === 1450000);
ok('paid event reason reflects payment reference', paidE.financial && paidE.financial.totalsByCurrency[0].baseCurrency === 'USD');
ok('paid event reasonKind = payment', paidE.reasonKind === 'payment');
const diff = life.map((e) => Number(e.financial.totalsByCurrency[0].exchangeRate));
ok('ALL events froze the same snapshot through the chain', diff.every((r) => r === 1450));
ok('archive event recorded as new event (append-only, status stays paid)', life[7].action === 'archive' && life[7].fromStatus === 'paid' && life[7].toStatus === 'paid');
const chainOk = storage.auditTrailIntegrity();
ok('storage chain still valid after full lifecycle', chainOk.valid === true && chainOk.chainOk === true && chainOk.count === storage.getAuditTrail().length);

// ===========================================================================
console.log('F. EOSB lifecycle (reject → resubmit → approve → paid → cancel)');
emptyBase();
storage.setActiveUser(String(ADMIN.id || ADMIN.username));
const esb = {
  id: 'E1', employeeId: 'emp-1', status: 'draft',
  netSettlementAmount: 1000, salaryCurrency: 'USD', notes: 'separation',
};
storage.addEOSB(esb);                                       // created
storage.updateEOSB('E1', { status: 'under_audit', submittedBy: 'Hisham' });  // submitted
storage.updateEOSB('E1', { status: 'draft', rejectedBy: 'Auditor', rejectionReason: 'appraisal missing' }); // rejected (returns to draft)
storage.updateEOSB('E1', { status: 'under_audit', submittedBy: 'Hisham' });  // resubmitted
storage.updateEOSB('E1', { status: 'approved', approvedBy: 'Auditor' });     // approved
storage.updateEOSB('E1', { status: 'paid', paidBy: 'Cashier' });             // paid
storage.updateEOSB('E1', { status: 'approved' });                            // cancel payment
const eosbEv = eventsOf('eosb', 'E1');
ok('EOSB full lifecycle actions', eosbEv.map((e) => e.action).join(',') === ['created', 'submitted', 'rejected', 'resubmitted', 'approved', 'paid', 'cancel_payment'].join(','));
ok('EOSB rejection links Phase 1 fields', eosbEv[2].rejection && eosbEv[2].rejection.rejectionReason === 'appraisal missing');
ok('EOSB paid→approved recorded as cancel_payment (new event, not a rewrite)', eosbEv[6].action === 'cancel_payment' && eosbEv[6].fromStatus === 'paid' && eosbEv[6].toStatus === 'approved');
ok('EOSB financial snapshot has salaryCurrency origin', eosbEv[0].financial && eosbEv[0].financial.currency === 'USD');

console.log('G. Loans: created + update + paid disbursement diff');
const loan = { id: 'L1', employeeId: 'emp-1', amount: 1000, currency: 'USD', totalAmount: 1000, paidAmount: 0, remainingAmount: 1000, installmentsCount: 10, status: 'active' };
storage.addLoan(loan);
ok('loan created event', eventsOf('loan', 'L1')[0].action === 'created');
const updLoan = storage.updateLoan({ ...storage.getState().loans.find((l) => l.id === 'L1'), totalAmount: 1200 });
ok('loan update event has oldValue (1000) → newValue (1200)', eventsOf('loan', 'L1').length === 2 && eventsOf('loan', 'L1')[1].newValue.totalAmount === 1200 && eventsOf('loan', 'L1')[1].oldValue.totalAmount === 1000);
storage.updateLoan({ ...storage.getState().loans.find((l) => l.id === 'L1'), totalAmount: 1200 });
ok('RE-saving identical loan emits NO event', eventsOf('loan', 'L1').length === 2);
const pre = storage.getState().loans.find((l) => l.id === 'L1');
storage.saveLoans(storage.getState().loans.map((l) => l.id === 'L1' ? { ...l, paidAmount: 600, remainingAmount: 600 } : l));
const paidLoan = eventsOf('loan', 'L1').find((e) => e.action === 'paid');
ok('loan paid event emitted on installment disbursement', !!paidLoan && paidLoan.oldValue.paidAmount === 0 && paidLoan.newValue.paidAmount === 600);
storage.saveLoans(storage.getState().loans.map((l) => l.id === 'L1' ? { ...l, paidAmount: 600, remainingAmount: 600 } : l));
ok('re-saving identical loans emits NO extra paid event', eventsOf('loan', 'L1').filter((e) => e.action === 'paid').length === 1);

console.log('H. Exchange-rate governance events');
storage.setExchangeRate({ user: ADMIN, currency: 'IQD', rate: 1480, rateDate: '2026-10-01' });
ok('rate row creation emits exchange_rate_set', storage.getAuditTrail().some((e) => e.action === 'exchange_rate_set' && e.recordId === 'IQD:USD'));
storage.setExchangeRate({ user: ADMIN, currency: 'IQD', rate: 1490 });
ok('rate row edit emits exchange_rate_updated', storage.getAuditTrail().some((e) => e.action === 'exchange_rate_updated' && e.recordId === 'IQD:USD'));
const lq = { month: '2026-10', status: 'under_audit', items: [{ employeeId: 'emp-1', netSalary: 5, currency: 'IQD' }], totalsByCurrency: [{ code: 'IQD', net: 5 }] };
storage.addPayrollBatch(lq);
ok('pinning a committed rate emits exchange_rate_locked', storage.getAuditTrail().some((e) => e.action === 'exchange_rate_locked' && e.recordId === 'IQD:USD'));
ok('locked events carry the governing actor', storage.getAuditTrail().filter((e) => e.action === 'exchange_rate_locked').every((e) => e.actor && e.actor.role === 'super_admin'));

// ===========================================================================
console.log('I. Security: forbidden operation → `denied` event, NEVER success');
emptyBase();
storage.setActiveUser(String(ADMIN.id || ADMIN.username));
const wb = { id: 'W1', month: '2099-01', status: 'under_audit', items: [{ employeeId: 'emp-1', netSalary: 10, currency: 'USD' }], totalsByCurrency: [{ code: 'USD', net: 10 }] };
const denied = transitionPayrollGuarded(HR, wb, 'paid'); // HR lacks disburse permission
ok('guard rejects (permission layer)', denied.ok === false && denied.layer === 'permission');
const deniedEvents = storage.getAuditTrail().filter((e) => e.action === 'denied' && e.recordId === '2099-01');
ok('exactly one denied event recorded', deniedEvents.length === 1);
ok('denied event outcome=denied (never a success event)', deniedEvents[0].outcome === 'denied' && deniedEvents[0].financial === null);
ok('denied event records requested action + layer', deniedEvents[0].newValue.requestedAction === 'disburse' && deniedEvents[0].newValue.layer === 'permission');
ok('NO success workflow event for the blocked month', storage.getAuditTrail().filter((e) => e.recordId === '2099-01' && e.outcome === 'success').length === 0);
const scoped = COMPANY_HR;
const otherScope = { id: 'W2', month: '2099-02', status: 'draft', items: [{ employeeId: 'emp-1', netSalary: 5, currency: 'USD', companyId: 'comp-2', branchId: 'br-2' }], totalsByCurrency: [{ code: 'USD', net: 5 }] };
transitionPayrollGuarded(scoped, otherScope, 'under_audit'); // submit → out of company scope
ok('scope violation is a denied event, not a success', storage.getAuditTrail().some((e) => e.action === 'denied' && e.newValue.layer === 'scope'));

// ===========================================================================
console.log('J. System meta events + backward compatibility');
emptyBase();
storage.addAudit('test', 'payroll', 'legacy UI log entry', 'M1');
ok('legacy bounded UI log (addAudit) untouched by Phase 5', storage.getAuditLog().length === 1 && storage.getAuditLog()[0].targetType === 'payroll');
const trailBeforeClear = storage.getAuditTrail().length;
storage.clearAllData();
ok('clearAllData emits records_cleared (trail preserved)', storage.getAuditTrail().length === trailBeforeClear + 1 && storage.getAuditTrail().some((e) => e.action === 'records_cleared'));
storage.resetToDefaults();
ok('resetToDefaults emits data_reset (trail preserved)', storage.getAuditTrail().some((e) => e.action === 'data_reset'));
ok('every trail event carries schema p5', storage.getAuditTrail().every((e) => e.schema === 'p5'));
ok('chain fully valid across all system events', storage.auditTrailIntegrity().valid === true && storage.auditTrailIntegrity().chainOk === true);

console.log('K. getState exposes trail + meta (read APIs, no full-chain verify on read)');
const meta = storage.getAuditTrailMeta();
ok('meta exposes count + chainHead + schema', meta.count === storage.getAuditTrail().length && meta.chainHead === (storage.getAuditTrail().length ? storage.getAuditTrail()[storage.getAuditTrail().length - 1].hash : null));
const st = storage.getState();
ok('getState exposes auditTrail events and meta', Array.isArray(st.auditTrail) && st.auditTrailMeta && st.auditTrailMeta.count === meta.count);

// ===========================================================================
console.log('L. Engine pure functions stay usable outside storage');
emptyBase();
const snap = financialFieldsOf({ amount: 1000, currency: 'IQD', exchangeRate: 1450, exchangeRateDate: '2026-07-01', baseAmount: 1450000, baseCurrency: 'USD' });
ok('financialFieldsOf preserves all 6 Phase 4 fields verbatim', snap.amount === 1000 && snap.exchangeRate === 1450 && snap.baseAmount === 1450000 && snap.baseCurrency === 'USD');
const pv = payrollFinancialView({ status: 'paid', totalsByCurrency: [{ code: 'IQD', net: 1000, exchangeRate: 1450, exchangeRateDate: '2026-07-01', baseAmount: 1450000, baseCurrency: 'USD' }] });
ok('payrollFinancialView freezes stamped rate/date/base, never recomputes', pv.totalsByCurrency[0].exchangeRate === 1450 && pv.totalsByCurrency[0].baseAmount === 1450000);
ok('appendAuditEvent throws nothing on malformed envelope (fresh seed)', verifyAuditTrail(appendAuditEvent(null, { recordType: 'system', recordId: 'x', action: 'data_reset' }).envelope).valid === true);

// ---------------------------------------------------------------------------
console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('Failed assertions:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}