// =========================================================
// P2.2 Test Matrix — Multi-currency, Payroll lock,
// uniform View/Edit/Delete mutators & Month 8/9 attribution.
// Usage: node scripts/p2-2-tests.mjs   (npm run p22:test)
//
// Deliberately does NOT modify financial formulas — it only
// verifies the P2.2 approved deliverables: never merge
// currencies, Super-Admin payroll lock, storage mutators and
// per-month (Aug/Sep) carry-over integrity.
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
  formatAmountWithCode,
  summarizeCurrencySegments,
  summarizeCurrencySegmentsHtml,
  resolveEmployeeCurrency,
  isPayrollViewEnabled,
  listCompanyHolidayDatesInRange,
  countAbsenceDays,
} = await import(`${JS}types.js`);
const { generateMonthlyPayroll } = await import(`${JS}engines/payrollEngine.js`);
const { getApprovedOvertimeSummary } = await import(`${JS}engines/overtimeEngine.js`);

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

const empA = mkEmp('emp-p22-a');
const empB = mkEmp('emp-p22-b', { currency: 'IQD' });
storage.saveEmployees([empA, empB]);

console.log('  [P2.2 currency display helpers]');
ok('formatAmountWithCode renders code with amount', formatAmountWithCode(1500, 'USD') === '1,500.00 USD');
ok('formatAmountWithCode formats IQD', formatAmountWithCode(750000, 'IQD') === '750,000.00 IQD');
ok('formatAmountWithCode without code returns bare amount', formatAmountWithCode(0) === '0.00');
ok('same currency segments are summed into one', summarizeCurrencySegments([{ code: 'USD', amount: 100 }, { code: 'USD', amount: 200 }]) === '300.00 USD');
ok('different currencies are NEVER merged', summarizeCurrencySegments([{ code: 'USD', amount: 1500 }, { code: 'IQD', amount: 750000 }]) === '1,500.00 USD + 750,000.00 IQD');
ok('single-currency total still shows its code', summarizeCurrencySegments([{ code: 'USD', amount: 1500 }]) === '1,500.00 USD');
ok('empty segment list shows 0.00', summarizeCurrencySegments([]) === '0.00');

console.log('  [P2.2 resolveEmployeeCurrency precedence]');
ok('employee currency wins over company currency', resolveEmployeeCurrency({ id: 'e', currency: 'IQD', companyId: 'comp-1' }, storage.getState().settings, defaultCompanies).code === 'IQD');
ok('company currency applied when employee has none', resolveEmployeeCurrency({ id: 'e', companyId: 'comp-1' }, storage.getState().settings, defaultCompanies).code === 'USD');
ok('global settings currency applied when no company', resolveEmployeeCurrency({ id: 'e' }, { currency: 'EUR', currencySymbol: '€' }, []).code === 'EUR');
ok('USD is the final fallback', resolveEmployeeCurrency({ id: 'e' }, {}, []).code === 'USD');

console.log('  [P2.2 Super-Admin payroll lock]');
ok('payrollViewEnabled defaults to true', isPayrollViewEnabled({}) === true);
ok('explicit true stays enabled', isPayrollViewEnabled({ payrollViewEnabled: true }) === true);
ok('explicit false disables payroll view', isPayrollViewEnabled({ payrollViewEnabled: false }) === false);
ok('seedData defaultSettings ships payrollViewEnabled: true', defaultSettings.payrollViewEnabled === true);

console.log('  [P2.2 storage mutators: uniform View/Edit/Delete]');
storage.saveAttendance([]);
storage.saveLeaves([]);
storage.saveHourlyLeaves([]);
storage.saveOvertime([]);
storage.saveHolidays([]);

let res = storage.addAttendance({ id: 'att-p22-1', employeeId: empA.id, date: '2026-08-03', status: 'present', checkIn: '08:00', checkOut: '17:00', workingHours: 8 });
ok('attendance created', res.ok === true);
storage.deleteAttendance('att-p22-1');
ok('deleteAttendance removes the record', storage.getState().attendance.length === 0);
ok('deleted attendance is archived', storage.getDeletedRecords().some((r) => r.data && r.data.id === 'att-p22-1'));

storage.addOvertime({ id: 'ot-p22-1', employeeId: empA.id, date: '2026-08-15', hours: 2, rateMultiplier: 1.5, status: 'approved', totalAmount: 50 });
res = storage.updateOvertime({ id: 'ot-p22-1', employeeId: empA.id, date: '2026-08-15', hours: 3, rateMultiplier: 1.5, status: 'approved', totalAmount: 75 });
ok('updateOvertime returns ok on existing record', res.ok === true);
ok('updateOvertime applied new hours', storage.getState().overtime.find((o) => o.id === 'ot-p22-1')?.hours === 3);
res = storage.updateOvertime({ id: 'ot-missing', employeeId: empA.id, date: '2026-08-15', hours: 1 });
ok('updateOvertime rejects unknown record', res.ok === false && res.error === 'not_found');
storage.deleteOvertime('ot-p22-1');
ok('deleteOvertime removes the record', storage.getState().overtime.length === 0);
ok('deleted overtime is archived', storage.getDeletedRecords().some((r) => r.data && r.data.id === 'ot-p22-1'));

storage.addHourlyLeave({ id: 'hl-p22-1', employeeId: empA.id, date: '2026-08-06', hours: 1, startTime: '09:00', endTime: '10:00', reason: 'appointment', status: 'approved' });
storage.updateHourlyLeave({ id: 'hl-p22-1', employeeId: empA.id, date: '2026-08-06', hours: 2, startTime: '09:00', endTime: '11:00', reason: 'updated', status: 'approved' });
const hlSaved = storage.getState().hourlyLeaves.find((h) => h.id === 'hl-p22-1');
ok('updateHourlyLeave preserves id and applies edits', hlSaved && hlSaved.hours === 2 && hlSaved.reason === 'updated');
ok('hourly leave record was not duplicated', storage.getState().hourlyLeaves.filter((h) => h.id === 'hl-p22-1').length === 1);

storage.addHoliday({ id: 'hol-p22-1', name: 'Eid test', startDate: '2026-08-10', endDate: '2026-08-11', reasonCategory: 'religious_eid', companyId: 'all', branchId: 'all' });
storage.deleteHoliday('hol-p22-1');
ok('deleteHoliday removes the record', storage.getState().holidays.length === 0);
ok('deleted holiday is archived', storage.getDeletedRecords().some((r) => r.data && r.data.id === 'hol-p22-1'));

console.log('  [P2.2 month 8/9 carry-over attribution]');
storage.saveAttendance([]);
storage.saveOvertime([]);
storage.addAttendance({ id: 'att-aug', employeeId: empA.id, date: '2026-08-05', status: 'absent' });
storage.addAttendance({ id: 'att-sep', employeeId: empA.id, date: '2026-09-05', status: 'absent' });
storage.addOvertime({ id: 'ot-aug', employeeId: empA.id, date: '2026-08-15', hours: 2, rateMultiplier: 1.5, status: 'approved', totalAmount: 50 });
storage.addOvertime({ id: 'ot-sep', employeeId: empA.id, date: '2026-09-15', hours: 3, rateMultiplier: 1.5, status: 'approved', totalAmount: 75 });

const stateM = storage.getState();
const batchAug = generateMonthlyPayroll([empA], stateM.overtime, stateM.loans, stateM.attendance, { month: '2026-08', issueDate: '2026-08-31', title: 'Aug' }, stateM.settings);
const batchSep = generateMonthlyPayroll([empA], stateM.overtime, stateM.loans, stateM.attendance, { month: '2026-09', issueDate: '2026-09-30', title: 'Sep' }, stateM.settings);
const augItem = batchAug.items.find((it) => it.employeeId === empA.id);
const sepItem = batchSep.items.find((it) => it.employeeId === empA.id);
const dailyAug = 8100 / 30;
ok('Aug batch counts ONLY Aug absence (1 day)', Math.abs(augItem.absenceDeduction - dailyAug) < 0.01);
ok('Sep batch counts ONLY Sep absence (1 day)', Math.abs(sepItem.absenceDeduction - dailyAug) < 0.01);
ok('Sep absence never leaks into Aug attendance', augItem.absenceDeduction < 2 * dailyAug);
ok('Aug overtime summary excludes Sep record', getApprovedOvertimeSummary(empA.id, '2026-08', stateM.overtime).totalHours === 2);
ok('Sep overtime summary excludes Aug record', getApprovedOvertimeSummary(empA.id, '2026-09', stateM.overtime).totalHours === 3);
ok('Aug payroll item carries its own overtime', augItem.overtimeHours === 2);
ok('Sep payroll item carries its own overtime', sepItem.overtimeHours === 3);

storage.saveHolidays([
  { id: 'hol-aug', name: 'Aug holiday', startDate: '2026-08-10', endDate: '2026-08-11', companyId: 'all', branchId: 'all' },
  { id: 'hol-sep', name: 'Sep holiday', startDate: '2026-09-10', endDate: '2026-09-10', companyId: 'all', branchId: 'all' },
]);
const augHolidays = listCompanyHolidayDatesInRange(storage.getState().holidays, empA, '2026-08-01', '2026-08-31');
const sepHolidays = listCompanyHolidayDatesInRange(storage.getState().holidays, empA, '2026-09-01', '2026-09-30');
ok('Aug holiday dates counted in August only', augHolidays.length === 2 && augHolidays.every((d) => d.startsWith('2026-08')));
ok('Sep holiday counted in September only', sepHolidays.length === 1 && sepHolidays[0] === '2026-09-10');
ok('August holiday never leaks into September leave counting', !sepHolidays.some((d) => d.startsWith('2026-08')));

console.log('  [P2.2 half-day absence factor (deductibleDays=0.5)]');
const absentFull = { id: 'att-half-full', employeeId: empA.id, date: '2026-08-01', status: 'absent', deductibleDays: 1 };
const absentHalf = { id: 'att-half-050', employeeId: empA.id, date: '2026-08-02', status: 'absent', deductibleDays: 0.5 };
const absentLegacy = { id: 'att-half-legacy', employeeId: empA.id, date: '2026-08-03', status: 'absent' };
ok('countAbsenceDays: half-day sums to 0.5', countAbsenceDays([absentHalf]) === 0.5);
ok('countAbsenceDays: legacy absent record defaults to 1 full day', countAbsenceDays([absentLegacy]) === 1);
ok('countAbsenceDays: full + half = 1.5 (never merged to 2)', countAbsenceDays([absentFull, absentHalf]) === 1.5);
ok('countAbsenceDays: non-absent records are ignored', countAbsenceDays([{ status: 'present' }, { status: 'late' }]) === 0);
ok('countAbsenceDays: empty list is zero', countAbsenceDays([]) === 0);

console.log('  [P2.2 half-day absence in month 8/9 payroll]');
storage.saveAttendance([]);
storage.addAttendance({ id: 'att-hd-aug', employeeId: empA.id, date: '2026-08-05', status: 'absent', deductibleDays: 0.5 });
storage.addAttendance({ id: 'att-hd-sep', employeeId: empA.id, date: '2026-09-05', status: 'absent', deductibleDays: 0.5 });
storage.addAttendance({ id: 'att-coding-sep', employeeId: empA.id, date: '2026-09-06', status: 'absent' });
const stateHD = storage.getState();
const batchAugHD = generateMonthlyPayroll([empA], stateHD.overtime, stateHD.loans, stateHD.attendance, { month: '2026-08', issueDate: '2026-08-31', title: 'AugHD' }, stateHD.settings);
const batchSepHD = generateMonthlyPayroll([empA], stateHD.overtime, stateHD.loans, stateHD.attendance, { month: '2026-09', issueDate: '2026-09-30', title: 'SepHD' }, stateHD.settings);
const augHDItem = batchAugHD.items.find((it) => it.employeeId === empA.id);
const sepHDItem = batchSepHD.items.find((it) => it.employeeId === empA.id);
ok('Aug half-day absence recorded as 0.5 days', Math.abs(augHDItem.absenceDays - 0.5) < 0.0001);
ok('Sep half-day + full = 1.5 days (half-day never rounded to full)', Math.abs(sepHDItem.absenceDays - 1.5) < 0.0001);
ok('Aug half-day deduction equals 0.5 * daily wage', Math.abs(augHDItem.absenceDeduction - (dailyAug * 0.5)) < 0.01);
ok('Sep half-day deduction cut at exactly half', Math.abs(sepHDItem.absenceDeduction - (dailyAug * 1.5)) < 0.01);
ok('Sep half-day absence never leaks into Aug batch', Math.abs(augHDItem.absenceDays - 0.5) < 0.0001 && augHDItem.absenceDeduction < dailyAug);
ok('Aug half-day never counted in Sep batch', sepHDItem.absenceDays === 1.5);
ok('Sep half-day totalsByCurrency deduction is not merged across months', Math.abs(batchSepHD.totalDeductions - sepHDItem.totalDeductions) < 0.01);

console.log('  [P2.2 multi-currency payroll segmented totals]');
storage.saveAttendance([]);
storage.saveOvertime([]);
const stateMC = storage.getState();
const batchMC = generateMonthlyPayroll([empA, empB], stateMC.overtime, stateMC.loans, stateMC.attendance, { month: '2026-02', issueDate: '2026-02-28', title: 'MC', companies: defaultCompanies }, stateMC.settings);
const itA = batchMC.items.find((it) => it.employeeId === empA.id);
const itB = batchMC.items.find((it) => it.employeeId === empB.id);
ok('USD employee item stamped USD currency', itA && itA.currency === 'USD');
ok('IQD employee item stamped IQD currency', itB && itB.currency === 'IQD');
ok('totalsByCurrency segments per currency', Array.isArray(batchMC.totalsByCurrency) && batchMC.totalsByCurrency.length === 2);
const segUsd = batchMC.totalsByCurrency.find((g) => g.code === 'USD');
const segIqd = batchMC.totalsByCurrency.find((g) => g.code === 'IQD');
ok('USD segment net equals USD employee net', segUsd && Math.abs(segUsd.net - itA.netSalary) < 0.01);
ok('IQD segment net equals IQD employee net', segIqd && Math.abs(segIqd.net - itB.netSalary) < 0.01);
ok('legacy totalNet is kept for backward compatibility', typeof batchMC.totalNet === 'number' && batchMC.totalNet === Math.round((itA.netSalary + itB.netSalary) * 100) / 100);

console.log('  [P2.2 loan uniform Edit/Delete mutators]');
storage.saveLoans([]);
let lr = storage.addLoan({ id: 'loan-p22-1', employeeId: empA.id, totalAmount: 6000, paidAmount: 0, remainingAmount: 6000, installmentAmount: 2000, installmentsCount: 3, startDate: '2026-08-01', reason: 'education', status: 'active', installments: [] });
ok('addLoan created a loan record', storage.getState().loans.some((l) => l.id === 'loan-p22-1'));
lr = storage.updateLoan({ id: 'loan-p22-1', employeeId: empA.id, totalAmount: 6000, paidAmount: 0, remainingAmount: 6000, installmentAmount: 2000, installmentsCount: 3, startDate: '2026-08-01', reason: 'updated reason', status: 'active', installments: [] });
ok('updateLoan returns ok on existing record', lr.ok === true);
ok('updateLoan applied the edit', storage.getState().loans.find((l) => l.id === 'loan-p22-1')?.reason === 'updated reason');
ok('updateLoan keeps a single record (no duplication)', storage.getState().loans.filter((l) => l.id === 'loan-p22-1').length === 1);
lr = storage.updateLoan({ id: 'loan-missing', employeeId: empA.id, totalAmount: 100 });
ok('updateLoan rejects unknown record', lr.ok === false && lr.error === 'not_found');
storage.deleteLoan('loan-p22-1');
ok('deleteLoan removes the record', storage.getState().loans.length === 0);
ok('deleted loan is archived', storage.getDeletedRecords().some((r) => r.data && r.data.id === 'loan-p22-1'));
storage.saveLoans([]);

console.log('  [P2.2 currency display HTML helper (UI rendering)]');
const htmlMixed = summarizeCurrencySegmentsHtml([{ code: 'USD', amount: 1500 }, { code: 'IQD', amount: 750000 }]);
ok('mixed currencies render as separate lines, never one run of text stacked with +', (htmlMixed.match(/<div/g) || []).length === 2 && !htmlMixed.includes(' + '));
ok('each line keeps 2 decimals (750,000.00)', htmlMixed.includes('750,000.00'));
ok('currency code renders as a tinted span for colour distinction', htmlMixed.includes('<span style="color:#f59e0b; font-weight:700;">IQD</span>') && htmlMixed.includes('<span style="color:#0ea5e9; font-weight:700;">USD</span>'));
ok('lines are forced LTR so RTL layout cannot re-flow currency text', htmlMixed.includes('direction:ltr; unicode-bidi:embed'));
const htmlNeg = summarizeCurrencySegmentsHtml([{ code: 'USD', amount: 100 }], { sign: '-' });
ok('negative totals prefix every line with a minus', htmlNeg.includes('- 100.00'));
ok('single-currency total still renders a code line', summarizeCurrencySegmentsHtml([{ code: 'USD', amount: 1500 }]).includes('1,500.00 <span'));
ok('empty segments render a 0.00 placeholder', summarizeCurrencySegmentsHtml([]).includes('0.00'));

console.log('\n============================================');
console.log(`P2.2 TEST MATRIX: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failed:', failures.join(' | ')); }
console.log('============================================');
process.exit(failed ? 1 : 0);