import type { Employee, LeaveRequest, LeaveBalanceSummary, SystemSettings } from '../types/hrms';

/**
 * Calculates current leave balance summary for an employee
 */
export function calculateLeaveBalance(
  employee: Employee,
  leaveRequests: LeaveRequest[],
  asOfDate: Date = new Date(),
  settings?: SystemSettings
): LeaveBalanceSummary {
  const annualEntitlement = employee.annualLeaveEntitlement || settings?.defaultAnnualLeaveDays || 30;
  const carriedOver = employee.carriedOverLeaveBalance || 0;
  const adjustments = employee.manualLeaveAdjustment || 0;

  // Calculate accrued leave for the current year
  // Standard calculation: annualEntitlement * (dayOfYear / daysInYear)
  const currentYear = asOfDate.getFullYear();
  const yearStart = new Date(currentYear, 0, 1);
  const hireDate = new Date(employee.hireDate);
  
  // If hired this year, calculate from hire date, otherwise from Jan 1st
  const calculationStart = hireDate > yearStart ? hireDate : yearStart;
  const diffTime = Math.max(0, asOfDate.getTime() - calculationStart.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInYear = isLeap(currentYear) ? 366 : 365;

  // Accrual so far this year
  const accruedCurrentYear = parseFloat(((diffDays / daysInYear) * annualEntitlement).toFixed(2));

  // Filter approved leaves for this employee in the current calculation cycle
  const approvedLeaves = leaveRequests.filter(
    (req) => req.employeeId === employee.id && req.status === 'approved'
  );

  const usedAnnualDays = approvedLeaves
    .filter((req) => req.leaveType === 'annual')
    .reduce((sum, req) => sum + req.daysCount, 0);

  const usedOtherDays = approvedLeaves
    .filter((req) => req.leaveType !== 'annual')
    .reduce((sum, req) => sum + req.daysCount, 0);

  const pendingDays = leaveRequests
    .filter((req) => req.employeeId === employee.id && req.status === 'pending')
    .reduce((sum, req) => sum + req.daysCount, 0);

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
    lastCalculatedDate: asOfDate.toISOString().split('T')[0],
  };
}

export interface RolloverOptions {
  targetYear: number;
  maxCarryOverDays?: number;
  cashOutUnused: boolean; // Whether to pay remaining days as monetary cashout
  renewAnnualEntitlement: boolean;
}

export interface RolloverResultItem {
  employeeId: string;
  employeeName: string;
  previousRemaining: number;
  carriedOverToNewYear: number;
  expiredDays: number;
  cashedOutDays: number;
  cashOutAmount: number;
  newAnnualEntitlement: number;
  newStartingBalance: number;
}

/**
 * Execute year-end rollover and add new year leave balance
 */
export function executeYearEndRollover(
  employees: Employee[],
  leaveRequests: LeaveRequest[],
  options: RolloverOptions,
  settings: SystemSettings
): { updatedEmployees: Employee[]; rolloverResults: RolloverResultItem[] } {
  const maxCarryOver = options.maxCarryOverDays !== undefined 
    ? options.maxCarryOverDays 
    : (settings.maxCarryOverDays ?? 15);

  const rolloverResults: RolloverResultItem[] = [];
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

    const dailyWage = (emp.basicSalary + emp.housingAllowance + emp.transportAllowance) / 30;

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

    const newStartingBalance = carried;

    rolloverResults.push({
      employeeId: emp.id,
      employeeName: emp.fullName,
      previousRemaining: remaining,
      carriedOverToNewYear: carried,
      expiredDays: expired,
      cashedOutDays: cashedOut,
      cashOutAmount,
      newAnnualEntitlement: newAnnual,
      newStartingBalance,
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
