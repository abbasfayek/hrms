// ==========================================
// HRMS End of Service Benefits (EOSB) Engine
// ==========================================

import { calculateLeaveBalance } from './leaveEngine.js';
import { getDailyRate } from './wageEngine.js';
import { resolveEmployeeCurrency } from '../types.js';

export function calculateEOSB(params) {
  const {
    employee,
    terminationDate,
    reason,
    leaveRequests = [],
    loans = [],
    workedDaysInFinalMonth = 0,
    bonusCompensation = 0,
    otherDeductions = 0,
    notes = '',
    settings = {},
    companies = [],
    // Probation-failure payout mode:
    //   'salary_bond'           -> سند راتب: nominal (basic) salary only, no leave
    //                              cashout, no service gratuity, no service years.
    //   'salary_bond_plus_leave'-> سند راتب + cashout of the unused leave balance.
    probationPayout = 'salary_bond',
    lastWorkingDay = null,
  } = params;

  const hire = new Date(`${employee.hireDate}T00:00:00`);
  const term = new Date(`${terminationDate}T00:00:00`);

  const diffTime = Math.max(0, term.getTime() - hire.getTime());
  const totalServiceDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  const totalYearsExact = totalServiceDays / 365.25;
  let serviceYears = Math.floor(totalYearsExact);
  const remainingDaysAfterYears = totalServiceDays - Math.floor(serviceYears * 365.25);
  let serviceMonths = Math.floor(remainingDaysAfterYears / 30.4375);
  let serviceDays = Math.max(0, Math.floor(remainingDaysAfterYears - serviceMonths * 30.4375));

  const lastBasicSalary = Number(employee.basicSalary) || 0;
  const lastGrossSalary =
    lastBasicSalary +
    (Number(employee.housingAllowance) || 0) +
    (Number(employee.transportAllowance) || 0) +
    (Number(employee.otherAllowances) || 0);

  const monthlyWage = lastGrossSalary;
  // The final settlement is based on the actual number of calendar days in
  // the termination month, not a fixed 30-day divisor. Routed through the
  // SSOT wage engine (historical default: calendarDays).
  const daysInTerminationMonth = new Date(term.getFullYear(), term.getMonth() + 1, 0).getDate();
  const dailyWage = parseFloat(getDailyRate(employee, settings, { terminationDate, defaultMethod: 'calendarDays' }).toFixed(2));

  // 1. Gratuity accrual formula, fully configurable from settings.
  //    Years below eosbTier1Years accrue eosbTier1RateMonths of monthly wage per
  //    year; years at or above it accrue eosbTier2RateMonths.
  const tier1Rate = (Number(settings.eosbTier1RateMonths) >= 0) ? Number(settings.eosbTier1RateMonths) : 0.5;
  const tier1Years = (Number(settings.eosbTier1Years) > 0) ? Number(settings.eosbTier1Years) : 5;
  const tier2Rate = (Number(settings.eosbTier2RateMonths) >= 0) ? Number(settings.eosbTier2RateMonths) : 1;

  let fullAward = 0;
  if (totalYearsExact <= tier1Years) {
    fullAward = totalYearsExact * monthlyWage * tier1Rate;
  } else {
    const tier1Award = tier1Years * monthlyWage * tier1Rate;
    const subsequentYears = totalYearsExact - tier1Years;
    const subsequentAward = subsequentYears * monthlyWage * tier2Rate;
    fullAward = tier1Award + subsequentAward;
  }
  fullAward = parseFloat(Math.max(0, fullAward).toFixed(2));

  // 2. Entitlement ratio based on reason & custom settings
  const minYears = settings.eosbMinYearsForResignation !== undefined ? Number(settings.eosbMinYearsForResignation) : 2;
  const tier1Ratio = (Number(settings.eosbResignationTier1Pct) || 33.33) / 100;
  const tier2Ratio = (Number(settings.eosbResignationTier2Pct) || 66.66) / 100;
  const tier3Ratio = (Number(settings.eosbResignationTier3Pct) || 100) / 100;
  const companyTermRatio = (Number(settings.eosbCompanyTerminationPct) || 100) / 100;

  let entitlementRatio = 1.0;

  if (reason === 'resignation' || reason === 'non_renewal_by_employee') {
    if (totalYearsExact < minYears) {
      entitlementRatio = 0.0;
    } else if (totalYearsExact < tier1Years) {
      entitlementRatio = tier1Ratio;
    } else if (totalYearsExact < tier1Years * 2) {
      entitlementRatio = tier2Ratio;
    } else {
      entitlementRatio = tier3Ratio;
    }
  } else if (reason === 'summary_dismissal' || reason === 'article_80_violation' || reason === 'probation_failure') {
    entitlementRatio = 0.0;
  } else if (reason === 'company_termination' || reason === 'contract_expiration') {
    entitlementRatio = companyTermRatio;
  } else {
    // mutual_agreement, retirement, force_majeure
    entitlementRatio = 1.0;
  }

  let finalEOSBAmount = parseFloat((fullAward * entitlementRatio).toFixed(2));

  // 3. Unused Leave Compensation
  const leaveSummary = calculateLeaveBalance(employee, leaveRequests, term, settings);
  let unusedLeaveDays = Math.max(0, leaveSummary.remainingAnnualBalance);
  let leaveCompensationAmount = parseFloat((unusedLeaveDays * dailyWage).toFixed(2));

  // 4. Final Month Prorated Salary up to Termination Date (Requirement 6)
  let effectiveWorkedDays = Number(workedDaysInFinalMonth);
  if ((isNaN(effectiveWorkedDays) || effectiveWorkedDays <= 0) && (settings.eosbAutoIncludeFinalMonthSalary !== false)) {
    // Automatically calculate worked days from start of month up to termination date
    effectiveWorkedDays = term.getDate();
  } else if (isNaN(effectiveWorkedDays) || effectiveWorkedDays < 0) {
    effectiveWorkedDays = 0;
  }
  effectiveWorkedDays = Math.min(effectiveWorkedDays, daysInTerminationMonth);
  let finalMonthSalary = parseFloat((effectiveWorkedDays * dailyWage).toFixed(2));

  // 3b/4b. Probation-failure special payout (سند راتب): a person who failed the
  // probationary test receives only a salary bond equal to his nominal (basic)
  // monthly wage for the days actually worked in the final month — WITHOUT any
  // unused leave cashout and WITHOUT any years-of-service gratuity component.
  let settlementType = 'full';
  if (reason === 'probation_failure') {
    // Gratuity component is always zero for probation failures (ratio = 0 above).
    finalEOSBAmount = 0;
    serviceYears = 0;
    serviceMonths = 0;
    serviceDays = 0;
    const nominalDailyWage = parseFloat(getDailyRate(employee, settings, { terminationDate, defaultMethod: 'basicCalendar' }).toFixed(2));
    if (probationPayout === 'salary_bond_plus_leave') {
      // Bond covers the nominal final-month wage AND allows the unused leave
      // balance to be cashed out (also on the nominal wage), but never any
      // service gratuity.
      leaveCompensationAmount = parseFloat((unusedLeaveDays * nominalDailyWage).toFixed(2));
      finalMonthSalary = parseFloat((effectiveWorkedDays * nominalDailyWage).toFixed(2));
      settlementType = 'salary_bond_plus_leave';
    } else {
      // Default salary bond: nominal basic wage only, no leave cashout at all.
      leaveCompensationAmount = 0;
      unusedLeaveDays = 0;
      finalMonthSalary = parseFloat((effectiveWorkedDays * nominalDailyWage).toFixed(2));
      settlementType = 'salary_bond';
    }
  }

  // 5. Remaining Loan Deductions
  // P2.2 loan-currency rule: only outstanding advances in the SAME currency as
  // the employee's salary are deducted from the settlement. An advance in a
  // different currency is never mixed into this payout — it stays a separate
  // obligation and is reported below so the balance is never silently merged.
  const salaryCurrency = String(resolveEmployeeCurrency(employee, settings, companies).code || settings.currency || 'USD').toUpperCase();
  const activeLoans = (loans || []).filter((l) => l.employeeId === employee.id && l.status === 'active');
  const matchingCurrencyLoans = activeLoans.filter((l) => !l.currency || String(l.currency).toUpperCase() === salaryCurrency);
  const skippedCurrencyLoans = activeLoans.filter((l) => l.currency && String(l.currency).toUpperCase() !== salaryCurrency);
  const remainingLoanDeductions = parseFloat(
    matchingCurrencyLoans.reduce((sum, l) => sum + (Number(l.remainingAmount) || 0), 0).toFixed(2)
  );

  // 6. Net Settlement
  const totalPayable = finalEOSBAmount + leaveCompensationAmount + finalMonthSalary + (Number(bonusCompensation) || 0);
  const totalDeductible = remainingLoanDeductions + (Number(otherDeductions) || 0);
  const netSettlementAmount = parseFloat(Math.max(0, totalPayable - totalDeductible).toFixed(2));

  const clearanceItems = [
    { department: 'إدارة تقنية المعلومات IT', item: 'تسليم اللابتوب والبريد الإلكتروني والصلاحيات', isHandedOver: false },
    { department: 'الشؤون الإدارية والخدمات', item: 'تسليم بطاقة العمل ومفاتيح المكتب والسيارة', isHandedOver: false },
    { department: 'الإدارة المالية', item: 'تصفية العهد المالية والقروض والسلف المعلقة', isHandedOver: remainingLoanDeductions === 0 },
    { department: 'الموارد البشرية HR', item: 'تسليم التأمين الطبي وتوقيع مخالصة الاستلام النهائية', isHandedOver: false },
  ];

  return {
    id: `EOSB-${employee.id}-${Date.now()}`,
    employeeId: employee.id,
    employeeName: employee.fullName,
    department: employee.department,
    hireDate: employee.hireDate,
    terminationDate,
    lastWorkingDay: lastWorkingDay || terminationDate,
    reason,
    totalServiceDays,
    serviceYears,
    serviceMonths,
    serviceDays,
    lastBasicSalary,
    lastGrossSalary,
    eosbFullEntitlement: fullAward,
    entitlementRatio: parseFloat(entitlementRatio.toFixed(4)),
    finalEOSBAmount,
    unusedLeaveDays,
    dailyWage,
    daysInTerminationMonth,
    leaveCompensationAmount,
    workedDaysInFinalMonth: Number(workedDaysInFinalMonth),
    finalMonthSalary,
    bonusCompensation: Number(bonusCompensation),
    remainingLoanDeductions,
    salaryCurrency,
    skippedCurrencyLoans,
    currencyMismatchLoanCount: skippedCurrencyLoans.length,
    otherDeductions: Number(otherDeductions),
    netSettlementAmount,
    settlementType,
    servicePeriodNote: reason === 'probation_failure' ? 'probation_bond' : '',
    status: 'draft',
    clearanceItems,
    experienceCertificateIssued: true,
    notes,
    createdAt: new Date().toISOString(),
  };
}
