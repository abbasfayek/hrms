import type { Employee, OvertimeRecord, OvertimeRateMultiplier, SystemSettings } from '../types/hrms';

/**
 * Calculates hourly rate based on basic salary
 * Standard labor law formula: Basic Salary / (30 days * 8 hours) = Basic / 240
 */
export function calculateHourlyRate(
  basicSalary: number,
  settings?: SystemSettings
): number {
  const days = settings?.workingDaysPerMonth || 30;
  const hours = settings?.workingHoursPerDay || 8;
  const totalMonthlyHours = days * hours;
  return totalMonthlyHours > 0 ? parseFloat((basicSalary / totalMonthlyHours).toFixed(2)) : 0;
}

/**
 * Calculates overtime financial amount
 */
export function calculateOvertimeAmount(
  hours: number,
  hourlyRate: number,
  multiplier: OvertimeRateMultiplier
): number {
  return parseFloat((hours * hourlyRate * multiplier).toFixed(2));
}

/**
 * Create a new calculated overtime record
 */
export function createOvertimeRecord(
  employee: Employee,
  data: {
    date: string;
    hours: number;
    multiplier: OvertimeRateMultiplier;
    type: 'regular_day' | 'weekend' | 'holiday';
    reason: string;
    payrollPeriod?: string;
  },
  settings?: SystemSettings
): OvertimeRecord {
  const hourlyRate = calculateHourlyRate(employee.basicSalary, settings);
  const totalAmount = calculateOvertimeAmount(data.hours, hourlyRate, data.multiplier);

  const dateObj = new Date(data.date);
  const defaultPeriod = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;

  return {
    id: `OT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    employeeId: employee.id,
    date: data.date,
    hours: data.hours,
    multiplier: data.multiplier,
    hourlyRate,
    totalAmount,
    type: data.type,
    reason: data.reason,
    status: 'approved',
    payrollPeriod: data.payrollPeriod || defaultPeriod,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Summarize approved overtime for an employee in a given payroll period (YYYY-MM)
 */
export function getApprovedOvertimeSummary(
  employeeId: string,
  payrollPeriod: string,
  overtimeRecords: OvertimeRecord[]
): { totalHours: number; totalAmount: number; records: OvertimeRecord[] } {
  const records = overtimeRecords.filter(
    (ot) =>
      ot.employeeId === employeeId &&
      ot.status === 'approved' &&
      (ot.payrollPeriod === payrollPeriod || ot.date.startsWith(payrollPeriod))
  );

  const totalHours = records.reduce((sum, r) => sum + r.hours, 0);
  const totalAmount = records.reduce((sum, r) => sum + r.totalAmount, 0);

  return {
    totalHours: parseFloat(totalHours.toFixed(2)),
    totalAmount: parseFloat(totalAmount.toFixed(2)),
    records,
  };
}
