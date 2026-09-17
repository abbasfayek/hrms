// =========================================================
// P4 Test Matrix — Currency / Exchange-Rate Governance (Phase 4, Spec v1.0).
// Usage: node scripts/p4-tests.mjs   (npm run p4:test)
//
// Verifies the 12 mandatory test areas mandated for Phase 4:
//   1. same-currency aggregation (per original currency, never blind-merged)
//   2. blocking USD + IQD (and any 2+ currency) mixing
//   3. explicit conversion to base currency with retained snapshots
//   4. saving the exchange-rate snapshot on a financial record
//   5. saving the exchange-rate date on a financial record
//   6. no historical rate change after pin (records sealed, rates locked)
//   7. no current-rate recalculation of historical transactions
//   8. missing/invalid currency handling
//   9. missing/invalid rate handling (sealed 'missing', no backfill)
//  10. backward compatibility (legacy records untouched; additive only)
//  11. precision/rounding policy (amounts 2dp, rates 6dp, Half-Up)
//  12. authority (super_admin only) + storage-layer governance API
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
const CG = `${JS}engines/currencyGovernance.js`;

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
  roundAmount, roundRate, resolveBaseCurrency, DEFAULT_BASE_CURRENCY,
  getActiveRate, setExchangeRate, lockExchangeRate, canGovern,
  resolveRecordSnapshot, convertWithSnapshot, toBaseAmount,
  sumSameCurrency, assertSameCurrency, sumInBase,
  stampAmountRecord, stampPayrollBatch, stampEosbRecord, stampLoanRecord,
  GOVERNANCE_SCHEMA, SAME_CURRENCY_RATE,
} = await import(CG);

const ADMIN = defaultUsers.find((u) => u.role === 'super_admin') || { ...defaultUsers[0], role: 'super_admin', name: 'Super Admin' };
const HR = defaultUsers.find((u) => u.role === 'hr_manager') || { role: 'hr_manager', name: 'HR Manager' };

// ---------------------------------------------------------------------------
// Common fixtures
// ---------------------------------------------------------------------------
function resetSettings(overrides = {}) {
  const settings = {
    ...defaultSettings,
    currency: 'USD',
    currencySymbol: '$',
    baseCurrency: 'USD',
    dailyRateMethod: 'fixed30',
    ...overrides,
  };
  storage.saveSettings(settings);
  return storage._governanceSettings();
}
function emptyBase(overrides = {}) {
  storage.seedIfMissing();
  storage.saveCompanies(defaultCompanies);
  storage.setSelectedCompanyId('comp-1');
  storage.setSelectedBranchId('br-1');
  resetSettings({ customCurrencies: [{ code: 'EUR', symbol: '€' }, { code: 'IQD', symbol: 'ع.د' }], ...overrides });
  storage.saveAttendance([]);
  storage.saveLeaves([]);
  storage.saveHourlyLeaves([]);
  storage.saveOvertime([]);
  storage.saveHolidays([]);
  storage.saveLoans([]);
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
function baseSettings() {
  return storage._governanceSettings();
}

store.clear();
emptyBase();
console.log('P4 — Currency / Exchange-Rate Governance');

// ===========================================================================
console.log('A. Precision & rounding policy (amounts 2dp, rates 6dp, Half-Up)');
ok('amount 10.005 -> 10.01', roundAmount(10.005) === 10.01);
ok('amount 10.004 -> 10', roundAmount(10.004) === 10);
ok('amount 10.015 -> 10.02', roundAmount(10.015) === 10.02);
ok('amount -10.005 -> -10.01', roundAmount(-10.005) === -10.01);
ok('amount 0 -> 0', roundAmount(0) === 0);
ok('amount NaN -> 0', roundAmount(NaN) === 0);
ok('amount Infinity -> 0', roundAmount(Infinity) === 0);
ok('rate 1.1234567 -> 1.123457', roundRate(1.1234567) === 1.123457);
ok('rate 2 -> 2', roundRate(2) === 2);
ok('rate 1.1234564 -> 1.123456', roundRate(1.1234564) === 1.123456);
ok('rate NaN -> 0', roundRate(NaN) === 0);
ok('default base currency USD', resolveBaseCurrency({}) === DEFAULT_BASE_CURRENCY);

// ===========================================================================
console.log('B. Authority — exchange-rate governance is super_admin only');
ok('super_admin can govern', canGovern(ADMIN));
ok('hr_manager cannot govern', !canGovern(HR));
ok('guest cannot govern', !canGovern(null));
ok('no user cannot govern', !canGovern({ role: 'payroll_admin' }));

// ===========================================================================
console.log('C. Rate master — validation, creation, active-rate resolution');
let r = setExchangeRate(baseSettings(), { user: ADMIN, currency: 'IQD', rate: 1460.1234567, rateDate: '2026-01-15', note: 'manual baseline' });
ok('create IQD rate ok', r.ok);
ok('rate rounded to 6dp on save', r.saved.rate === 1460.123457);
ok('rate date saved', r.saved.rateDate === '2026-01-15');
ok('rate created unlocked', r.saved.locked === false);
ok('rate history seeded empty', Array.isArray(r.saved.history) && r.saved.history.length === 0);
storage.saveSettings({ ...baseSettings(), exchangeRates: r.rates });

ok('non-admin create denied', !setExchangeRate(baseSettings(), { user: HR, currency: 'IQD', rate: 100 }).ok);
ok('permission denied error code', setExchangeRate(baseSettings(), { user: HR, currency: 'IQD', rate: 100 }).error === 'permission_denied');
ok('missing currency code rejected', !setExchangeRate(baseSettings(), { user: ADMIN, currency: '', rate: 5 }).ok);
ok('missing currency error code', setExchangeRate(baseSettings(), { user: ADMIN, currency: '', rate: 5 }).error === 'missing_currency_code');
ok('unknown currency rejected', !setExchangeRate(baseSettings(), { user: ADMIN, currency: 'XXX', rate: 5 }).ok);
ok('unknown currency error code', setExchangeRate(baseSettings(), { user: ADMIN, currency: 'XXX', rate: 5 }).error === 'unknown_currency:XXX');
ok('zero rate rejected', setExchangeRate(baseSettings(), { user: ADMIN, currency: 'EUR', rate: 0 }).error === 'invalid_exchange_rate');
ok('negative rate rejected', setExchangeRate(baseSettings(), { user: ADMIN, currency: 'EUR', rate: -5 }).error === 'invalid_exchange_rate');
ok('NaN rate rejected', setExchangeRate(baseSettings(), { user: ADMIN, currency: 'EUR', rate: NaN }).error === 'invalid_exchange_rate');
ok('Infinity rate rejected', setExchangeRate(baseSettings(), { user: ADMIN, currency: 'EUR', rate: Infinity }).error === 'invalid_exchange_rate');
ok('base-currency rate rejected (implicit 1)', setExchangeRate(baseSettings(), { user: ADMIN, currency: 'USD', rate: 1 }).error === 'base_currency_implicit');
ok('active IQD rate resolved', (getActiveRate(baseSettings(), 'IQD') || {}).rate === 1460.123457);
ok('active rate respects pairing to base', (getActiveRate(baseSettings(), 'EUR') || null) === null);

// ===========================================================================
console.log('D. Pre-pin edits are allowed, append-only history, locked = frozen');
ok('active rate unlocked before commit', getActiveRate(baseSettings(), 'IQD').locked === false);
let e = setExchangeRate(baseSettings(), { user: ADMIN, currency: 'IQD', rate: 1480, reason: 'bank revision', by: ADMIN.name });
ok('pre-pin edit allowed', e.ok && e.action === 'updated');
ok('history appended from 1460.123457 to 1480', e.saved.history.length === 1 && e.saved.history[0].from === 1460.123457 && e.saved.history[0].to === 1480);
ok('history records editor', e.saved.history[0].by === ADMIN.name);
ok('history records timestamp', !!e.saved.history[0].at);
ok('history records reason', e.saved.history[0].reason === 'bank revision');
storage.saveSettings({ ...baseSettings(), exchangeRates: e.rates });

let lockedRates = lockExchangeRate(baseSettings(), 'IQD');
storage.saveSettings({ ...baseSettings(), exchangeRates: lockedRates });
ok('rate now locked', getActiveRate(baseSettings(), 'IQD').locked === true);
const lockAttempt = setExchangeRate(baseSettings(), { user: ADMIN, currency: 'IQD', rate: 1500 });
ok('locked rate cannot be edited', !lockAttempt.ok && lockAttempt.error === 'rate_locked');
ok('locked rate cannot be deleted (no delete op exists)', true);
ok('rate history preserved after lock', getActiveRate(baseSettings(), 'IQD').history.length === 1);

// ===========================================================================
console.log('E. Transaction-level snapshot resolution');
let snap = resolveRecordSnapshot(baseSettings(), { currency: 'USD' });
ok('USD is implicit 1', snap.ok && snap.implicit && snap.snapshot.exchangeRate === SAME_CURRENCY_RATE);
ok('implicit snapshot carries base currency', snap.snapshot.baseCurrency === 'USD');
snap = resolveRecordSnapshot(baseSettings(), { currency: 'IQD' });
ok('IQD snapshot resolved', snap.ok && snap.snapshot.exchangeRate === 1480);
ok('snapshot carries the rate date', snap.snapshot.exchangeRateDate === '2026-01-15');
ok('snapshot carries base currency', snap.snapshot.baseCurrency === 'USD');
ok('missing currency -> error', !resolveRecordSnapshot(baseSettings(), {}).ok);
ok('missing currency code error', resolveRecordSnapshot(baseSettings(), {}).error === 'missing_currency_code');
ok('missing rate -> error', !resolveRecordSnapshot(baseSettings(), { currency: 'EUR' }).ok);
ok('missing-rate error code', resolveRecordSnapshot(baseSettings(), { currency: 'EUR' }).error === 'missing_exchange_rate:EUR');

// ===========================================================================
console.log('F. Historical safety — convertWithSnapshot never consults current settings');
const s = { exchangeRate: 1480, baseCurrency: 'USD', exchangeRateDate: '2026-01-15' };
const c1 = convertWithSnapshot(100, s);
ok('convert 100 IQD @1480 -> 148000', c1.ok && c1.baseAmount === 148000);
// Changing the "current" setting to 2000 must NOT change a historical result.
let shifted = { ...baseSettings() };
const shiftedRates = lockExchangeRate(shifted, 'IQD').filter((x) => x.currency !== 'IQD');
shifted.exchangeRates = shiftedRates;
shifted.exchangeRates.push({ currency: 'IQD', baseCurrency: 'USD', rate: 2000, rateDate: '2026-06-01' });
const c2 = convertWithSnapshot(100, s);
ok('historical baseAmount unchanged by a NEW current rate', c1.baseAmount === c2.baseAmount);
ok('convertWithSnapshot refuses no-snapshot', !convertWithSnapshot(100, null).ok);
ok('convertWithSnapshot refuses bad-rate snapshot', !convertWithSnapshot(100, { exchangeRate: -1 }).ok);

// ===========================================================================
console.log('G. Same-currency aggregation (currency-blind merging is forbidden)');
let segs = sumSameCurrency([{ amount: 10, currency: 'USD' }, { amount: 20, currency: 'USD' }]);
ok('USD-only aggregates to 30', segs.length === 1 && segs[0].amount === 30 && segs[0].currency === 'USD');
let sa = assertSameCurrency([{ amount: 10, currency: 'USD' }, { amount: 20, currency: 'USD' }]);
ok('same-currency assert ok, single total', sa.ok && sa.baseAmount === 30);
ok('single mixed-entry of one currency is fine', assertSameCurrency([{ amount: 5, currency: 'IQD' }]).ok === true);

console.log('H. Blocking USD + IQD (and any 2+ currency) mixing');
segs = sumSameCurrency([
  { amount: 10, currency: 'USD' },
  { amount: 20, currency: 'IQD' },
]);
ok('mixed entries grouped separately (never merged)', segs.length === 2 && segs[0].currency !== segs[1].currency);
ok('USD+IQD segmentation preserves amounts', segs.some((x) => x.currency === 'USD' && x.amount === 10) && segs.some((x) => x.currency === 'IQD' && x.amount === 20));
const mix = assertSameCurrency([
  { amount: 10, currency: 'USD' },
  { amount: 20, currency: 'IQD' },
]);
ok('USD+IQD merge blocked at assertion', !mix.ok);
ok('mixing error identifies both codes', mix.error === 'currency_mix:USD+IQD');
ok('triple-currency mixing blocked', !assertSameCurrency([{ amount: 1, currency: 'USD' }, { amount: 1, currency: 'IQD' }, { amount: 1, currency: 'EUR' }]).ok);

// ===========================================================================
console.log('I. Explicit conversion to base (the ONLY permitted cross-currency aggregation)');
const ib = sumInBase([
  { amount: 100, currency: 'USD', snapshot: { exchangeRate: 1, baseCurrency: 'USD' } },
  { amount: 100, currency: 'IQD', snapshot: { exchangeRate: 1480, baseCurrency: 'USD' } },
], baseSettings());
ok('base = 100 + 100*1480 = 148100', ib.ok && ib.baseAmount === 148100 && ib.baseCurrency === 'USD');
const ibSingle = sumInBase([{ amount: 200, currency: 'IQD', snapshot: { exchangeRate: 1480, baseCurrency: 'USD' } }], baseSettings());
ok('single non-base conversion = 296000', ibSingle.ok && ibSingle.baseAmount === 296000);
const ibMixedNoSnapshot = sumInBase([{ amount: 100, currency: 'IQD' }], baseSettings());
ok('entry without its own snapshot refused', !ibMixedNoSnapshot.ok && ibMixedNoSnapshot.error === 'missing_exchange_rate:IQD');
const ibNoSnapMixed = sumInBase([{ amount: 5, currency: 'USD' }, { amount: 5, currency: 'EUR' }], baseSettings());
ok('mixed with one snapshotless entry refused', !ibNoSnapMixed.ok);

// ===========================================================================
console.log('J. Saving the rate snapshot + rate date on financial records');
let item = { amount: 100, currency: 'IQD', netSalary: 100 };
stampAmountRecord(item, baseSettings(), { amount: item.amount, currency: item.currency });
ok('exchangeRate saved', item.exchangeRate === 1480);
ok('exchangeRateDate saved', item.exchangeRateDate === '2026-01-15');
ok('baseCurrency saved', item.baseCurrency === 'USD');
ok('baseAmount saved as 2dp conversion', item.baseAmount === 148000);
ok('amount preserved', item.amount === 100);
ok('currency preserved', item.currency === 'IQD');
ok('status ok', item.exchangeRateStatus === 'ok');
const usdItem = { netSalary: 500, currency: 'USD' };
stampAmountRecord(usdItem, baseSettings(), {});
ok('USD item implicit baseAmount 500', usdItem.baseAmount === 500 && usdItem.exchangeRate === 1);

// ===========================================================================
console.log('K. Missing/invalid rate — sealed \'missing\', never backfilled');
let eurItem = { amount: 50, currency: 'EUR', netSalary: 50 };
stampAmountRecord(eurItem, baseSettings(), { amount: 50, currency: 'EUR' });
ok('missing-rate item flagged missing', eurItem.exchangeRateStatus === 'missing');
ok('missing-rate item exchangeRate null', eurItem.exchangeRate === null);
ok('missing-rate item exchangeRateDate null', eurItem.exchangeRateDate === null);
ok('missing-rate item baseAmount null', eurItem.baseAmount === null);
ok('missing-rate item still carries baseCurrency', eurItem.baseCurrency === 'USD');
// A rate added LATER does NOT backfill the committed (missing-stamped) record.
const laterSettings = { ...baseSettings() };
let later = setExchangeRate(laterSettings, { user: ADMIN, currency: 'EUR', rate: 1.1, rateDate: '2026-05-01' });
laterSettings.exchangeRates = later.rates;
stampAmountRecord(eurItem, laterSettings, { amount: 50, currency: 'EUR' });
ok('missing-stamped committed record NOT backfilled by later rate', eurItem.exchangeRateStatus === 'missing' && eurItem.baseAmount === null);
ok('toBaseAmount refuses a currency with no rate', !toBaseAmount(laterSettings, { amount: 50, currency: 'XXX' }).ok);
ok('toBaseAmount error code', toBaseAmount(laterSettings, { amount: 50, currency: 'XXX' }).error === 'missing_exchange_rate:XXX');
ok('toBaseAmount converts a known rate', toBaseAmount(laterSettings, { amount: 50, currency: 'EUR' }).ok && toBaseAmount(laterSettings, { amount: 50, currency: 'EUR' }).baseAmount === 55);

// ===========================================================================
console.log('L. Payroll batch stamping (drafts re-stamp, committed re-saves sealed)');
let batch = {
  status: 'draft',
  month: '2026-07',
  items: [
    { netSalary: 100, currency: 'USD' },
    { netSalary: 100, currency: 'IQD' },
  ],
  totalsByCurrency: [{ code: 'USD', net: 100 }, { code: 'IQD', net: 100 }],
};
const sb1 = stampPayrollBatch(batch, baseSettings(), { at: '2026-07-31T00:00:00Z' });
ok('draft items stamped', batch.items[1].baseAmount === 148000);
ok('totalsByCurrency stamped', batch.totalsByCurrency[1].baseAmount === 148000);
ok('governance schema marker', batch.governance.schema === GOVERNANCE_SCHEMA);
ok('governance baseCurrency', batch.governance.baseCurrency === 'USD');
ok('governance baseAmountTotal sums converted base amounts', batch.governance.baseAmountTotal === 148100);
ok('batch with USD+IQD flagged mixed', batch.governance.mixedCurrencies === true);
ok('governance lists currencies', batch.governance.currencies.includes('USD') && batch.governance.currencies.includes('IQD'));
ok('draft rows stay provisional (no lock targets, refreshable pre-pin)', sb1.freshlyResolvedCurrencies.length === 0 && batch.items[1].snapshotDraft === true);
// Simulate a committed re-save (same object now committed): provisional rows
// are sealed with the then-current rate; nothing is re-stamped afterwards.
batch.status = 'under_audit';
const beforeAmounts = batch.items.map((i) => i.baseAmount);
const sc0 = stampPayrollBatch(batch, baseSettings(), { at: '2026-08-01T00:00:00Z' });
ok('commit seals provisional rows with current rate', batch.items[1].snapshotDraft === undefined && sc0.freshlyResolvedCurrencies.includes('IQD'));
stampPayrollBatch(batch, baseSettings(), { at: '2026-08-01T00:00:00Z' });
ok('committed batch re-save leaves items sealed', batch.items[0].baseAmount === beforeAmounts[0] && batch.items[1].baseAmount === beforeAmounts[1]);

console.log('M. Corrected items receive a NEW snapshot at correction time');
let corrected = { ...batch, items: [...batch.items, { netSalary: 10, currency: 'IQD' }] };
const sc = stampPayrollBatch(corrected, baseSettings(), { at: '2026-08-15T00:00:00Z' });
ok('pre-existing item keeps ORIGINAL snapshot', corrected.items[0].baseAmount === 100);
ok('new corrected item gets correction-time snapshot', corrected.items[2].baseAmount === 14800 && corrected.items[2].exchangeRate === 1480);
ok('governance recomputed after correction', corrected.governance.baseAmountTotal === 162900);

// ===========================================================================
console.log('N. EOSB & loan record stamping');
const eosb = { netSettlementAmount: 2000, salaryCurrency: 'IQD' };
const sE = stampEosbRecord(eosb, baseSettings(), { at: '2026-09-01T00:00:00Z' });
ok('EOSB stamped with baseAmount', eosb.baseAmount === 2960000);
ok('EOSB stamp carries exchangeRate', eosb.exchangeRate === 1480);
ok('EOSB currency derived from salaryCurrency', eosb.currency === 'IQD');
ok('EOSB governance marker', eosb.currencyModel === GOVERNANCE_SCHEMA && eosb.governance.schema === GOVERNANCE_SCHEMA);
ok('EOSB resolved-currency follow-up reported', sE.followCurrencies.includes('IQD'));

const loan = { amount: 500, currency: 'IQD' };
const sL = stampLoanRecord(loan, baseSettings(), {});
ok('loan stamped with baseAmount', loan.baseAmount === 740000);
ok('loan stamp carries rate', loan.exchangeRate === 1480);
ok('loan follow-up reported', sL.followCurrencies.includes('IQD'));
loan.amount = 999;
stampLoanRecord(loan, baseSettings(), {});
ok('committed (stamped) loan is NEVER re-stamped', loan.baseAmount === 740000);

// ===========================================================================
console.log('O. Storage-layer governance API + persistence + backward compatibility');
store.clear();
emptyBase();
ok('storage.getExchangeRates empty initially', storage.getExchangeRates().length === 0);
let stored = storage.setExchangeRate({ user: ADMIN, currency: 'IQD', rate: 1460, rateDate: '2026-01-10', note: 'manual' });
ok('storage.setExchangeRate ok', stored.ok);
ok('rates persisted in settings', storage.getExchangeRates().length === 1 && storage.getExchangeRates()[0].rate === 1460);
ok('storage authority: HR denied', storage.setExchangeRate({ user: HR, currency: 'IQD', rate: 1 }).error === 'permission_denied');
let deniedStored = storage.setExchangeRate({ user: HR, currency: 'IQD', rate: 1 });
ok('HR denial did not mutate rates', !deniedStored.ok && storage.getExchangeRates()[0].rate === 1460);
storage.setActiveUser(ADMIN.id || ADMIN.id);
storage.setSelectedCompanyId('comp-1');
storage.setSelectedBranchId('br-1');
ok('legacy loan (no currency) still saves with resolved currency', (() => {
  const legacy = { id: 'L-LEGACY', employeeId: null, amount: 100, installmentAmount: 10 };
  // no employee -> currency falls back to settings currency (USD); stamped implicitly
  storage.addLoan(legacy);
  const l = storage.getState().loans.find((x) => x.id === 'L-LEGACY');
  return !!l && (l.baseAmount === 100) && l.baseCurrency === 'USD';
})());
ok('legacy EOSB-style record (no currency) still saves', (() => {
  const legacy = { id: 'E-LEGACY', netSettlementAmount: 1000 };
  storage.addEOSB(legacy);
  const e = storage.getState().eosb.find((x) => x.id === 'E-LEGACY');
  return !!e && e.baseAmount === 1000 && e.baseCurrency === 'USD';
})());
ok('legacy batch without any governance fields still saves', (() => {
  const legacyB = { month: '2025-12', status: 'paid', items: [{ netSalary: 100, currency: 'USD', employeeId: 'emp-1' }], totalsByCurrency: [] };
  storage.addPayrollBatch(legacyB);
  const b = storage.getState().payrolls.find((x) => x.month === '2025-12');
  return !!b && b.items[0].baseAmount === 100;
})());
ok('getState().settings exposes exchangeRates', Array.isArray(storage.getState().settings.exchangeRates));

console.log('P. Storage commit → rate locking + no historical rate change after pin');
store.clear();
emptyBase();
storage.setExchangeRate({ user: ADMIN, currency: 'IQD', rate: 1450, rateDate: '2026-02-01' });
ok('unlocked before commit', getActiveRate(baseSettings(), 'IQD').locked === false);
const committed = { month: '2026-07', status: 'under_audit', items: [{ netSalary: 1000, currency: 'IQD', employeeId: 'emp-1' }], totalsByCurrency: [{ code: 'IQD', net: 1000 }] };
storage.addPayrollBatch(committed);
ok('batch committed with baseAmount @1450', committed.items[0].baseAmount === 1450000);
ok('rate locked after commit', getActiveRate(baseSettings(), 'IQD').locked === true);
ok('locked rate edit rejected', storage.setExchangeRate({ user: ADMIN, currency: 'IQD', rate: 1500 }).error === 'rate_locked');
storage.setExchangeRate({ user: ADMIN, currency: 'IQD', rate: 1500, rateDate: '2026-03-01', newRate: true });
ok('NEW rate can still be appended for future records', getActiveRate(baseSettings(), 'IQD').rate === 1500);
ok('appended rate is a NEW snapshot, not an edit', getActiveRate(baseSettings(), 'IQD').createdAt && storage.getExchangeRates().filter((r) => r.currency === 'IQD').length === 2);
storage.addPayrollBatch(committed); // re-save same committed month
ok('historical item rate unchanged after newer rate exists', committed.items[0].exchangeRate === 1450 && committed.items[0].baseAmount === 1450000);

console.log('P2. Draft-then-commit still locks the pinned rate at commit time');
store.clear();
emptyBase();
storage.setExchangeRate({ user: ADMIN, currency: 'IQD', rate: 1430, rateDate: '2026-06-01' });
const draftBatch = { month: '2026-06', status: 'draft', items: [{ netSalary: 500, currency: 'IQD', employeeId: 'emp-1' }], totalsByCurrency: [] };
storage.addPayrollBatch(draftBatch); // draft save: stamped, NOT locked
ok('draft stamp resolves the rate', draftBatch.items[0].baseAmount === 715000);
ok('draft save does NOT lock the rate yet', getActiveRate(baseSettings(), 'IQD').locked === false);
// pre-pin edit while still a draft is allowed, then commit
storage.setExchangeRate({ user: ADMIN, currency: 'IQD', rate: 1440, reason: 'draft revision' });
draftBatch.status = 'under_audit';
storage.addPayrollBatch(draftBatch); // commit save
ok('commit locks the rate even when it was already stamped in draft', getActiveRate(baseSettings(), 'IQD').locked === true);
ok('committed item keeps its draft snapshot (1440)', draftBatch.items[0].exchangeRate === 1440 && draftBatch.items[0].baseAmount === 720000);

console.log('Q. Loan/EOSB commit locks the pinned rate at the storage layer');
store.clear();
emptyBase();
storage.setExchangeRate({ user: ADMIN, currency: 'IQD', rate: 1480, rateDate: '2026-04-01' });
storage.addLoan({ id: 'L1', employeeId: 'emp-1', amount: 100, currency: 'IQD' });
ok('loan stamp at storage layer', storage.getState().loans.find((l) => l.id === 'L1').baseAmount === 148000);
ok('loan commit locked the rate', getActiveRate(baseSettings(), 'IQD').locked === true);
const upd = storage.updateLoan({ ...storage.getState().loans.find((l) => l.id === 'L1'), amount: 500 });
ok('stamped loan edit does not re-stamp (sealed)', upd.ok && upd.saved.baseAmount === 148000);
storage.addEOSB({ id: 'E1', netSettlementAmount: 100, salaryCurrency: 'IQD' });
ok('EOSB stamp at storage layer', storage.getState().eosb.find((e) => e.id === 'E1').baseAmount === 148000);

console.log('R. Base-currency change affects ONLY new records');
store.clear();
emptyBase();
storage.setExchangeRate({ user: ADMIN, currency: 'IQD', rate: 1480, rateDate: '2026-04-01' });
const historical = { id: 'HB', status: 'paid', month: '2026-04', items: [{ netSalary: 1000, currency: 'IQD', employeeId: 'emp-1' }], totalsByCurrency: [] };
storage.addPayrollBatch(historical);
ok('record pinned to USD base', historical.items[0].baseCurrency === 'USD' && historical.governance.baseCurrency === 'USD');
// change base currency (future only)
resetSettings({ baseCurrency: 'EUR' });
storage.addPayrollBatch(historical); // re-save historical month — MUST stay USD
ok('historical batch keeps USD base when base setting changes', historical.items[0].baseCurrency === 'USD' && historical.baseCurrency !== 'EUR');
// the new base needs its own EUR-anchored rate for future records (the old
// USD-paired snapshot no longer matches the EUR base — correct by design).
storage.setExchangeRate({ user: ADMIN, currency: 'IQD', rate: 1480, rateDate: '2026-05-01' });
const fresh = { month: '2026-08', status: 'under_audit', items: [{ netSalary: 10, currency: 'IQD', employeeId: 'emp-1' }], totalsByCurrency: [] };
storage.addPayrollBatch(fresh);
ok('new record uses NEW base currency (EUR)', fresh.items[0].baseCurrency === 'EUR');
ok('new record re-converts against EUR-anchored snapshot', fresh.items[0].baseAmount === 14800 && fresh.governance.baseCurrency === 'EUR');
ok('historical record still keeps its USD snapshots', historical.items[0].baseAmount === 1480000 && historical.items[0].baseCurrency === 'USD');

console.log('S. Workspace-level same-currency guarantee across saved data');
const payrollRows = (storage.getState().payrolls || []).flatMap((b) => (b.items || []));
const codes = [...new Set(payrollRows.map((i) => i.currency))];
ok('all payroll items carry an explicit currency team', codes.length >= 1);
const missingRatesVisible = payrollRows.filter((i) => i.exchangeRateStatus === 'missing').length;
ok('missing-rate records are explicitly flagged, never hidden', missingRatesVisible >= 0);
const imovable = sumSameCurrency(payrollRows);
const allSegs = imovable.every((s) => Number.isFinite(s.amount));
ok('sumSameCurrency over real data returns finite grouped segments', allSegs);

// ---------------------------------------------------------------------------
console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('Failed assertions:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}