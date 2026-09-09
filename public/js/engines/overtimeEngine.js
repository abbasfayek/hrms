// ==========================================
// HRMS Overtime Engine: Wage & Multipliers
// ==========================================

import { getHourlyRate } from './wageEngine.js';

/**
 * Calculates hourly rate based on basic salary
 * Standard labor law formula: Basic Salary / (30 days * 8 hours) = Basic / 240
 * Routed through the SSOT wage engine (historical default: basicMonthly).
 */
export function calculateHourlyRate(basicSalary, settings = {}) {
  const rate = getHourlyRate({ basicSalary }, settings, { defaultMethod: 'basicMonthly' });
  return parseFloat(rate.toFixed(2));
}

/**
 * Calculates overtime financial amount
 */
export function calculateOvertimeAmount(hours, hourlyRate, multiplier = 1.5) {
  return parseFloat((Number(hours) * Number(hourlyRate) * Number(multiplier)).toFixed(2));
}

/**
 * Summarize approved overtime for an employee in a given payroll period (YYYY-MM)
 */
export function getApprovedOvertimeSummary(employeeId, payrollPeriod, overtimeRecords = []) {
  const records = overtimeRecords.filter(
    (ot) =>
      ot.employeeId === employeeId &&
      ot.status === 'approved' &&
      (ot.payrollPeriod === payrollPeriod || (ot.date && ot.date.startsWith(payrollPeriod)))
  );

  const totalHours = records.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
  const totalAmount = records.reduce((sum, r) => sum + (Number(r.totalAmount) || 0), 0);

  return {
    totalHours: parseFloat(totalHours.toFixed(2)),
    totalAmount: parseFloat(totalAmount.toFixed(2)),
    records,
  };
}
