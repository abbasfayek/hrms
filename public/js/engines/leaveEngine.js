// ==========================================
// HRMS Leave Engine: Accrual & Rollover Tool
// ==========================================

import { getDailyRate } from './wageEngine.js';

/**
 * Calculates leave balance summary for an employee
 */
export function calculateLeaveBalance(
  employee,
  leaveRequests = [],
  asOfDate = new Date(),
  settings = {}
) {
  const annualEntitlement = employee.annualLeaveEntitlement || settings.defaultAnnualLeaveDays || 30;
  const carriedOver = employee.carriedOverLeaveBalance || 0;
  const adjustments = employee.manualLeaveAdjustment || 0;

  // Calculate accrued leave for the current calendar year
  const asDate = typeof asOfDate === 'string' ? new Date(asOfDate) : asOfDate;
  const currentYear = asDate.getFullYear();
  const yearStart = new Date(currentYear, 0, 1);
  const hireDate = new Date(employee.hireDate);

  const calculationStart = hireDate > yearStart ? hireDate : yearStart;
  const diffTime = Math.max(0, asDate.getTime() - calculationStart.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  const isLeap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInYear = isLeap(currentYear) ? 366 : 365;

  const accruedCurrentYear = parseFloat(((diffDays / daysInYear) * annualEntitlement).toFixed(2));

  // Approved leaves
  const approvedLeaves = leaveRequests.filter(
    (req) => req.employeeId === employee.id && req.status === 'approved'
  );

  const usedAnnualDays = approvedLeaves
    .filter((req) => req.leaveType === 'annual')
    .reduce((sum, req) => sum + (Number(req.daysCount) || 0), 0);

  const usedOtherDays = approvedLeaves
    .filter((req) => req.leaveType !== 'annual')
    .reduce((sum, req) => sum + (Number(req.daysCount) || 0), 0);

  const pendingDays = leaveRequests
    .filter((req) => req.employeeId === employee.id && req.status === 'pending')
    .reduce((sum, req) => sum + (Number(req.daysCount) || 0), 0);

  const totalAvailable = parseFloat((carriedOver + accruedCurrentYear + adjustments).toFixed(2));
  const remainingAnnualBalance = parseFloat((totalAvailable - usedAnnualDays).toFixed(2));

  return {
    employeeId: employee.id,
    employeeName: employee.fullName,
    department: employee.department,
    annualEntitlement,
    carriedOver,
    accruedCurrentYear,
    adjustments,
    totalAvailable,
    usedAnnualDays,
    usedOtherDays,
    remainingAnnualBalance,
    pendingDays,
    lastCalculatedDate: asDate.toISOString().split('T')[0],
  };
}

/**
 * Execute year-end rollover and add new year leave balance
 */
export function executeYearEndRollover(
  employees,
  leaveRequests,
  options,
  settings
) {
  const maxCarryOver = options.maxCarryOverDays !== undefined 
    ? Number(options.maxCarryOverDays)
    : (settings.maxCarryOverDays ?? 15);

  const rolloverResults = [];
  const updatedEmployees = employees.map((emp) => {
    if (emp.status !== 'active' && emp.status !== 'probation') {
      return emp;
    }

    const currentBalance = calculateLeaveBalance(emp, leaveRequests, new Date(), settings);
    const remaining = Math.max(0, currentBalance.remainingAnnualBalance);

    let carried = 0;
    let expired = 0;
    let cashedOut = 0;
    let cashOutAmount = 0;

    // Daily wage comes from the SSOT wage engine. Historical default: fixed 30-day
    // divisor for leave cash-outs (Saudi labor practice).
    const dailyWage = getDailyRate(emp, settings, { defaultMethod: 'fixed30' });

    if (options.cashOutUnused) {
      cashedOut = remaining;
      cashOutAmount = parseFloat((cashedOut * dailyWage).toFixed(2));
      carried = 0;
      expired = 0;
    } else {
      if (maxCarryOver > 0 && remaining > maxCarryOver) {
        carried = maxCarryOver;
        expired = remaining - maxCarryOver;
      } else {
        carried = remaining;
        expired = 0;
      }
    }

    const newAnnual = options.renewAnnualEntitlement
      ? (emp.annualLeaveEntitlement || settings.defaultAnnualLeaveDays || 30)
      : 0;

    rolloverResults.push({
      employeeId: emp.id,
      employeeName: emp.fullName,
      previousRemaining: remaining,
      carriedOverToNewYear: carried,
      expiredDays: expired,
      cashedOutDays: cashedOut,
      cashOutAmount,
      newAnnualEntitlement: newAnnual,
      newStartingBalance: carried,
    });

    return {
      ...emp,
      carriedOverLeaveBalance: carried,
      currentYearAccruedLeave: 0,
      manualLeaveAdjustment: 0,
      lastYearBalanceRenewedDate: `${options.targetYear}-01-01`,
    };
  });

  return { updatedEmployees, rolloverResults };
}
