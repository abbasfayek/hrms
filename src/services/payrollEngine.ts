import type {
  Employee,
  PayrollBatch,
  PayrollItem,
  OvertimeRecord,
  LoanAdvance,
  AttendanceRecord,
  SystemSettings,
} from '../types/hrms';
import { getApprovedOvertimeSummary } from './overtimeEngine';

export interface PayrollGenerationOptions {
  month: string; // YYYY-MM e.g. "2026-08"
  title?: string;
  issueDate?: string;
}

/**
 * Generate monthly payroll batch for all active employees
 */
export function generateMonthlyPayroll(
  employees: Employee[],
  overtimeRecords: OvertimeRecord[],
  loans: LoanAdvance[],
  attendanceRecords: AttendanceRecord[],
  options: PayrollGenerationOptions,
  settings: SystemSettings
): PayrollBatch {
  const month = options.month;
  const issueDate = options.issueDate || new Date().toISOString().split('T')[0];
  const title = options.title || `مسير رواتب شهر ${month}`;

  // Filter eligible employees (active or probation)
  const eligibleEmployees = employees.filter(
    (emp) => emp.status === 'active' || emp.status === 'probation'
  );

  const items: PayrollItem[] = eligibleEmployees.map((emp) => {
    // 1. Basic and allowances
    const basicSalary = emp.basicSalary || 0;
    const housingAllowance = emp.housingAllowance || 0;
    const transportAllowance = emp.transportAllowance || 0;
    const otherAllowances = emp.otherAllowances || 0;

    // 2. Overtime
    const otSummary = getApprovedOvertimeSummary(emp.id, month, overtimeRecords);
    const overtimeHours = otSummary.totalHours;
    const overtimeAmount = otSummary.totalAmount;

    // 3. Attendance deductions (Absence and Lateness)
    const empAttendance = attendanceRecords.filter(
      (att) => att.employeeId === emp.id && att.date.startsWith(month)
    );

    const absentDaysCount = empAttendance.filter((att) => att.status === 'absent').length;
    const totalLateMinutes = empAttendance.reduce((sum, att) => sum + (att.lateMinutes || 0), 0);

    const dailyWage = (basicSalary + housingAllowance + transportAllowance) / (settings.workingDaysPerMonth || 30);
    const hourlyWage = dailyWage / (settings.workingHoursPerDay || 8);
    const minuteWage = hourlyWage / 60;

    const absenceDeduction = parseFloat((absentDaysCount * dailyWage).toFixed(2));
    const lateDeduction = parseFloat((totalLateMinutes * minuteWage).toFixed(2));

    // 4. Loans & Advances Installments
    const activeLoans = loans.filter(
      (l) => l.employeeId === emp.id && l.status === 'active' && l.remainingAmount > 0
    );
    let loanInstallment = 0;
    activeLoans.forEach((loan) => {
      // Find matching installment for this month or take default installmentAmount
      const matchingInstallment = loan.installments.find((inst) => inst.month === month && !inst.isPaid);
      if (matchingInstallment) {
        loanInstallment += matchingInstallment.amount;
      } else if (loan.installmentAmount > 0) {
        loanInstallment += Math.min(loan.installmentAmount, loan.remainingAmount);
      }
    });
    loanInstallment = parseFloat(loanInstallment.toFixed(2));

    // 5. Social Insurance (GOSI / Social Security)
    // In Saudi/Gulf law, GOSI is usually calculated on (Basic + Housing)
    const gosiBase = basicSalary + housingAllowance;
    const gosiEmployeeRate = emp.gosiDeductionRate !== undefined 
      ? emp.gosiDeductionRate 
      : (settings.gosiEmployeePercent || 9.75);
    const gosiCompanyRate = settings.gosiCompanyPercent || 11.75;

    const gosiEmployeeDeduction = parseFloat(((gosiBase * gosiEmployeeRate) / 100).toFixed(2));
    const gosiCompanyContribution = parseFloat(((gosiBase * gosiCompanyRate) / 100).toFixed(2));

    // 6. Bonuses & Other earnings
    const bonuses = 0;
    const otherEarnings = 0;

    // 7. Gross Earnings
    const grossSalary = parseFloat(
      (basicSalary + housingAllowance + transportAllowance + otherAllowances + overtimeAmount + bonuses + otherEarnings).toFixed(2)
    );

    // 8. Total Deductions
    const penaltiesDeduction = 0;
    const otherDeductions = 0;
    const totalDeductions = parseFloat(
      (absenceDeduction + lateDeduction + loanInstallment + gosiEmployeeDeduction + penaltiesDeduction + otherDeductions).toFixed(2)
    );

    // 9. Net Salary
    const netSalary = parseFloat(Math.max(0, grossSalary - totalDeductions).toFixed(2));

    return {
      id: `PI-${emp.id}-${month}`,
      employeeId: emp.id,
      employeeNumber: emp.employeeNumber,
      employeeName: emp.fullName,
      department: emp.department,
      jobTitle: emp.jobTitle,
      bankName: emp.bankName || 'البنك الأهلي',
      iban: emp.iban || 'SA0000000000000000000000',
      basicSalary,
      housingAllowance,
      transportAllowance,
      otherAllowances,
      overtimeHours,
      overtimeAmount,
      bonuses,
      otherEarnings,
      grossSalary,
      absenceDays: absentDaysCount,
      absenceDeduction,
      lateMinutes: totalLateMinutes,
      lateDeduction,
      loanInstallment,
      gosiEmployeeDeduction,
      gosiCompanyContribution,
      penaltiesDeduction,
      otherDeductions,
      totalDeductions,
      netSalary,
      isPaid: false,
    };
  });

  const totalGross = parseFloat(items.reduce((sum, it) => sum + it.grossSalary, 0).toFixed(2));
  const totalDeductions = parseFloat(items.reduce((sum, it) => sum + it.totalDeductions, 0).toFixed(2));
  const totalNet = parseFloat(items.reduce((sum, it) => sum + it.netSalary, 0).toFixed(2));
  const totalCompanyGosi = parseFloat(items.reduce((sum, it) => sum + it.gosiCompanyContribution, 0).toFixed(2));

  return {
    id: `PAYROLL-${month}`,
    month,
    title,
    issueDate,
    status: 'draft',
    totalGross,
    totalDeductions,
    totalNet,
    totalCompanyGosi,
    employeesCount: items.length,
    items,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Generate Wage Protection System (WPS) / Bank Transfer text file
 */
export function generateWPSFile(batch: PayrollBatch, settings: SystemSettings): string {
  const header = `WPS,${settings.commercialRegistration || '1010101010'},${settings.companyName},${batch.month},${batch.employeesCount},${batch.totalNet},${settings.currency || 'SAR'}`;
  const rows = batch.items.map((it, idx) => {
    return `${idx + 1},${it.employeeNumber},${it.employeeName},${it.iban},${it.bankName},${it.basicSalary},${it.housingAllowance},${it.otherAllowances + it.transportAllowance + it.overtimeAmount},${it.totalDeductions},${it.netSalary}`;
  });

  return [header, ...rows].join('\n');
}
