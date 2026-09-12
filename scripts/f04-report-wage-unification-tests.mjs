// ==========================================
// F-04 Regression Tests: Unified Report Wage Calculations with wageEngine SSOT
// ==========================================

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JS = `file:///${path.resolve(__dirname, '../public/js').replace(/\\/g, '/')}/`;

// Mock localStorage for storage/i18n
const mockStore = new Map();
globalThis.localStorage = {
  getItem(k) { return mockStore.has(k) ? mockStore.get(k) : null; },
  setItem(k, v) { mockStore.set(k, String(v)); },
  removeItem(k) { mockStore.delete(k); },
  clear() { mockStore.clear(); }
};

const { getDailyRate, getHourlyRate, getMinuteRate, computeReportProratedSalary } = await import(`${JS}engines/wageEngine.js`);
const { generateMonthlyPayroll } = await import(`${JS}engines/payrollEngine.js`);

let passed = 0;
let total = 0;
function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('\n--- Running F-04 Report Wage Unification Tests ---');

const emp = {
  id: 'emp-1',
  fullName: 'Ahmed Zaki',
  basicSalary: 3000,
  housingAllowance: 600,
  transportAllowance: 400,
  otherAllowances: 200,
  status: 'active',
};
// base for calendarDays = 3000 + 600 + 400 + 200 = 4200
// base for fixed30 = 3000 + 600 + 400 = 4000

// TEST 1: Actual Calendar Days Configuration
test('Actual calendar days: report calculation uses exact calendar days of the month from wageEngine', () => {
  const settings = {
    dailyRateMethod: 'calendarDays',
    workingDaysPerMonth: 30,
  };

  // January (31 days)
  const rateJan = getDailyRate(emp, settings, { month: '2026-01' });
  const expectedJanRate = 4200 / 31;
  assert.equal(rateJan, expectedJanRate);

  const reportProratedJan = computeReportProratedSalary(emp, settings, {
    month: '2026-01',
    payableDays: 15,
    isCurrentMonth: true,
  });
  const expectedJanProrated = parseFloat((15 * expectedJanRate).toFixed(2));
  assert.equal(reportProratedJan, expectedJanProrated, 'Prorated salary must match wageEngine calendarDays');

  // February 2026 (28 days)
  const rateFeb = getDailyRate(emp, settings, { month: '2026-02' });
  const expectedFebRate = 4200 / 28;
  assert.equal(rateFeb, expectedFebRate);

  const reportProratedFeb = computeReportProratedSalary(emp, settings, {
    month: '2026-02',
    payableDays: 28,
    isCurrentMonth: true,
  });
  assert.equal(reportProratedFeb, 4200, 'Full month calendarDays must equal total gross');
});

// TEST 2: Fixed 30-Day Configuration
test('Fixed 30-day configuration: report calculation divides base by 30 regardless of calendar length', () => {
  const settings = {
    dailyRateMethod: 'fixed30',
    workingDaysPerMonth: 26, // Should be ignored when fixed30 is chosen
  };

  // Even for January (31 days), fixed30 divides by 30
  const rate = getDailyRate(emp, settings, { month: '2026-01' });
  const expectedDaily = 4000 / 30;
  assert.equal(rate, expectedDaily);

  const reportProrated = computeReportProratedSalary(emp, settings, {
    month: '2026-01',
    payableDays: 30,
    isCurrentMonth: true,
  });
  assert.equal(reportProrated, 4200, 'Full month (30 days) at fixed30 must equal total gross (4200)');
});

// TEST 3: Attendance, Absences & Late Penalties Integration
test('Attendance / absence / penalty deductions match payroll engine calculation chain', () => {
  const settings = {
    dailyRateMethod: 'workingDays',
    workingDaysPerMonth: 30,
    workingHoursPerDay: 8,
  };

  const dailyRate = getDailyRate(emp, settings, { month: '2026-09' });
  const minuteRate = getMinuteRate(emp, settings, { month: '2026-09' });

  const absenceDays = 2;
  const lateMinutes = 90;
  const payableDays = 30;

  const reportResult = computeReportProratedSalary(emp, settings, {
    month: '2026-09',
    payableDays,
    absenceDays,
    lateMinutes,
    isCurrentMonth: true,
  });

  const totalGross = 4200;
  const expectedAbsenceCost = 2 * dailyRate;
  const expectedLateCost = 90 * minuteRate;
  const expectedResult = parseFloat(Math.max(0, totalGross - expectedAbsenceCost - expectedLateCost).toFixed(2));

  assert.equal(reportResult, expectedResult, 'Report calculation must subtract absence and late deductions at wageEngine rates');
});

// TEST 4: Comparison with Stored Payroll Result
test('Stored payroll consistency: report result matches stored payroll item exactly for past/disbursed months', () => {
  const settings = {
    dailyRateMethod: 'workingDays',
    workingDaysPerMonth: 30,
  };

  const storedPayrollItem = {
    employeeId: 'emp-1',
    employeeName: 'Ahmed Zaki',
    basicSalary: 3000,
    grossSalary: 4200,
    netSalary: 3850.50,
    absenceDeduction: 266.67,
    lateDeduction: 82.83,
  };

  // When stored item is available for a finalized month, report returns stored net salary
  const reportResult = computeReportProratedSalary(emp, settings, {
    month: '2026-08',
    storedItem: storedPayrollItem,
    isCurrentMonth: false,
  });

  assert.equal(reportResult, 3850.50, 'Report must use stored payroll net salary when month is finalized');
});

// TEST 5: PayrollEngine and Report Agreement on Fresh Generation
test('Zero drift: generateMonthlyPayroll and computeReportProratedSalary agree on earned salary', () => {
  const settings = {
    dailyRateMethod: 'workingDays',
    workingDaysPerMonth: 30,
    workingHoursPerDay: 8,
    gosiEmployeePercent: 0,
    gosiCompanyPercent: 0,
  };

  // Generate payroll with 1 absence day
  const attendance = [
    { employeeId: 'emp-1', date: '2026-09-05', status: 'absent' },
  ];

  const batch = generateMonthlyPayroll(
    [emp],
    [],
    [],
    attendance,
    { month: '2026-09' },
    settings
  );

  const generatedItem = batch.items[0];
  const reportSalary = computeReportProratedSalary(emp, settings, {
    month: '2026-09',
    payableDays: 30,
    absenceDays: 1,
    lateMinutes: 0,
    isCurrentMonth: true,
  });

  // generated netSalary should be gross - absence deduction
  assert.equal(generatedItem.grossSalary, 4200);
  assert.equal(reportSalary, generatedItem.grossSalary - generatedItem.absenceDeduction);
});

console.log(`\nF-04 Test Summary: ${passed}/${total} passed`);
if (passed !== total) process.exit(1);
