// ==========================================
// HRMS Payroll Engine & WPS Generator
// ==========================================

import { getApprovedOvertimeSummary } from './overtimeEngine.js';
import { getDailyRate, getHourlyRate, getMinuteRate } from './wageEngine.js';
import { resolveEmployeeCurrency, countAbsenceDays } from '../types.js';
import { t } from '../i18n.js';

/**
 * Generate monthly payroll batch for all active employees.
 * P2.2 multi-currency: every item carries the employee's currency code and
 * symbol (employee > company > global settings), and the batch adds a
 * totalsByCurrency array so reports can show per-currency segmented totals
 * instead of ever merging different currencies into one blended number.
 */
export function generateMonthlyPayroll(
  employees,
  overtimeRecords,
  loans,
  attendanceRecords,
  options,
  settings
) {
  const month = options.month;
  const adjustments = Array.isArray(options.adjustments) ? options.adjustments : [];
  const companies = Array.isArray(options.companies) ? options.companies : [];
  const issueDate = options.issueDate || new Date().toISOString().split('T')[0];
  const title = options.title || `${t('payroll.monthlyPayroll')} ${month}`;

  // Filter active and probation employees, and only those already hired by the
  // end of the pay month so no future hires leak into the list.
  const [monthYear, monthNum] = String(month).split('-').map(Number);
  const monthEnd = monthNum ? new Date(Date.UTC(monthYear, monthNum, 0)) : null;
  const monthEndStr = monthEnd ? `${monthEnd.getUTCFullYear()}-${String(monthEnd.getUTCMonth() + 1).padStart(2, '0')}-${String(monthEnd.getUTCDate()).padStart(2, '0')}` : '';

  const eligibleEmployees = employees.filter((emp) => {
    if (emp.status !== 'active' && emp.status !== 'probation') return false;
    if (emp.hireDate && monthEndStr && emp.hireDate > monthEndStr) return false;
    return true;
  });

  const items = eligibleEmployees.map((emp) => {
    const basicSalary = Number(emp.basicSalary) || 0;
    const housingAllowance = Number(emp.housingAllowance) || 0;
    const transportAllowance = Number(emp.transportAllowance) || 0;
    const otherAllowances = Number(emp.otherAllowances) || 0;

    // P2.2: resolve the currency bound to this employee's salary (profile →
    // company → global settings) and stamp it on the item so every report and
    // payslip can print the employee's own currency code.
    const employeeCurrency = resolveEmployeeCurrency(emp, settings, companies);
    const currency = employeeCurrency.code || settings.currency || 'USD';
    const currencySymbol = employeeCurrency.symbol || settings.currencySymbol || '$';

    // Overtime
    const otSummary = getApprovedOvertimeSummary(emp.id, month, overtimeRecords);
    const overtimeHours = otSummary.totalHours;
    const overtimeAmount = otSummary.totalAmount;

    // Attendance deductions (Absence & Delays)
    const empAttendance = attendanceRecords.filter(
      (att) => att.employeeId === emp.id && att.date && att.date.startsWith(month)
    );

    // P2.2 half-day fix: absence days are the SUM of each absent record's
    // deductibleDays factor (0.5 = half day, 1 = full day), so a half-day
    // absence is never rounded up to a full day in payroll.
    const absentDaysCount = countAbsenceDays(empAttendance);
    const totalLateMinutes = empAttendance.reduce((sum, att) => sum + (Number(att.lateMinutes) || 0), 0);

    // Daily/Hourly/Minute wage come from the single source of truth
    // (wageEngine). Historical default: working-days divisor.
    const dailyWage = getDailyRate(emp, settings, { month, defaultMethod: 'workingDays' });
    const hourlyWage = getHourlyRate(emp, settings, { month, defaultMethod: 'workingDays' });
    const minuteWage = getMinuteRate(emp, settings, { month, defaultMethod: 'workingDays' });

    const absenceDeduction = parseFloat((absentDaysCount * dailyWage).toFixed(2));
    const lateDeduction = parseFloat((totalLateMinutes * minuteWage).toFixed(2));

    // Loans & Advances
    const activeLoans = (loans || []).filter(
      (l) => l.employeeId === emp.id && l.status === 'active' && Number(l.remainingAmount) > 0
    );
    let loanInstallment = 0;
    activeLoans.forEach((loan) => {
      const schedule = loan.installments || [];
      const matchInst = schedule.find((inst) => inst.month === month && !inst.isPaid);
      if (matchInst) {
        loanInstallment += Number(matchInst.amount) || 0;
      } else if (schedule.length === 0 && Number(loan.installmentAmount) > 0) {
        // Loans without an explicit monthly schedule are treated as an
        // automatic installment run, capped by the remaining balance.
        loanInstallment += Math.min(Number(loan.installmentAmount), Number(loan.remainingAmount));
      }
    });
    loanInstallment = parseFloat(loanInstallment.toFixed(2));

    // Social Insurance / Employee Insurance contributions (0% default)
    let gosiBase = 0;
    let gosiEmpRate = 0;
    let gosiCompRate = 0;
    let gosiEmployeeDeduction = 0;
    let gosiCompanyContribution = 0;

    if (emp.isSubjectToGosi !== false) {
      gosiBase = emp.gosiRegisteredWage !== undefined && Number(emp.gosiRegisteredWage) > 0
        ? Number(emp.gosiRegisteredWage)
        : (basicSalary + housingAllowance);

      // Read the generalized setting first, then the legacy gosi* key, then 0.
      const empRate = emp.gosiEmployeePercent !== undefined && Number(emp.gosiEmployeePercent) >= 0
        ? Number(emp.gosiEmployeePercent)
        : (Number(settings.socialInsuranceEmployeePercent ?? settings.gosiEmployeePercent) || 0);

      const compRate = emp.gosiCompanyPercent !== undefined && Number(emp.gosiCompanyPercent) >= 0
        ? Number(emp.gosiCompanyPercent)
        : (Number(settings.socialInsuranceCompanyPercent ?? settings.gosiCompanyPercent) || 0);

      gosiEmpRate = empRate;
      gosiCompRate = compRate;
      gosiEmployeeDeduction = parseFloat(((gosiBase * gosiEmpRate) / 100).toFixed(2));
      gosiCompanyContribution = parseFloat(((gosiBase * gosiCompRate) / 100).toFixed(2));
    }

    // One-off bonuses and deductions are stored as adjustment records and
    // must be included in the selected payroll month.
    const employeeAdjustments = adjustments.filter((entry) => entry.employeeId === emp.id && entry.payrollPeriod === month);
    const bonuses = employeeAdjustments
      .filter((entry) => entry.type === 'bonus')
      .reduce((sum, entry) => sum + Math.abs(Number(entry.amount) || 0), 0);
    const otherEarnings = 0;

    const grossSalary = parseFloat(
      (basicSalary + housingAllowance + transportAllowance + otherAllowances + overtimeAmount + bonuses + otherEarnings).toFixed(2)
    );

    const penaltiesDeduction = employeeAdjustments
      .filter((entry) => entry.type === 'deduction')
      .reduce((sum, entry) => sum + Math.abs(Number(entry.amount) || 0), 0);
    const otherDeductions = 0;
    const totalDeductions = parseFloat(
      (absenceDeduction + lateDeduction + loanInstallment + gosiEmployeeDeduction + penaltiesDeduction + otherDeductions).toFixed(2)
    );

    const netSalary = parseFloat(Math.max(0, grossSalary - totalDeductions).toFixed(2));

    return {
      id: `PI-${emp.id}-${month}`,
      month,
      employeeId: emp.id,
      companyId: emp.companyId || '',
      branchId: emp.branchId || '',
      employeeNumber: emp.employeeNumber,
      employeeName: emp.fullName,
      department: emp.department,
      jobTitle: emp.jobTitle,
      bankName: emp.bankName || '',
      iban: emp.iban || '',
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
      isSubjectToGosi: emp.isSubjectToGosi !== false,
      gosiRegisteredWage: gosiBase,
      gosiEmployeePercent: gosiEmpRate,
      gosiCompanyPercent: gosiCompRate,
      gosiEmployeeDeduction,
      gosiCompanyContribution,
      penaltiesDeduction,
      otherDeductions,
      totalDeductions,
      netSalary,
      currency,
      currencySymbol,
      isPaid: false,
    };
  });

  // P2.2: segment the batch totals by currency. The legacy numeric
  // totalGross/totalDeductions/totalNet are kept for backward compatibility,
  // but all display code must use totalsByCurrency so different currencies are
  // never summed together.
  const currencyGroups = {};
  items.forEach((it) => {
    const code = it.currency || settings.currency || 'USD';
    if (!currencyGroups[code]) {
      currencyGroups[code] = { code, symbol: it.currencySymbol || settings.currencySymbol || '$', gross: 0, deductions: 0, net: 0, companyGosi: 0, count: 0 };
    }
    const g = currencyGroups[code];
    g.gross += it.grossSalary || 0;
    g.deductions += it.totalDeductions || 0;
    g.net += it.netSalary || 0;
    g.companyGosi += it.gosiCompanyContribution || 0;
    g.count += 1;
  });
  const totalsByCurrency = Object.values(currencyGroups).map((g) => ({
    code: g.code,
    symbol: g.symbol,
    gross: parseFloat(g.gross.toFixed(2)),
    deductions: parseFloat(g.deductions.toFixed(2)),
    net: parseFloat(g.net.toFixed(2)),
    companyGosi: parseFloat(g.companyGosi.toFixed(2)),
    count: g.count,
  }));

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
    totalsByCurrency,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Compute the scheduled payroll release date for a batch from each branch's
 * "payDay" setting (day of month, default 25). When a batch covers several
 * branches, the release is scheduled for the LAST branch's payday so nothing
 * is released before it is due. Released batches keep their stored data and
 * are never re-scheduled.
 */
export function computePayrollReleaseSchedule(batch, companies = []) {
  if (!batch) return batch;
  if (batch.releaseStatus === 'released') return batch;

  const payDays = new Set();
  (batch.items || []).forEach((it) => {
    const comp = companies.find((c) => c.id === it.companyId);
    const br = comp ? (comp.branches || []).find((b) => b.id === it.branchId) : null;
    const pd = Number(br && br.payDay);
    if (pd >= 1 && pd <= 31) payDays.add(pd);
  });
  const fallback = (companies || [])
    .flatMap((c) => (c.branches || []).map((b) => Number(b.payDay)).filter((pd) => pd >= 1 && pd <= 31));
  const payDay = payDays.size ? Math.max(...payDays) : (fallback.length ? Math.max(...fallback) : 25);
  // Always recompute for pending (non-released) batches so a branch payDay
  // edit in Companies/Branches settings is reflected immediately.
  batch.releasePayDay = payDay;
  batch.releaseDate = `${batch.month}-${String(payDay).padStart(2, '0')}`;
  if (!batch.releaseStatus) batch.releaseStatus = 'scheduled';
  return batch;
}

/**
 * Generate a generic bank payroll file (CSV) for salary transfer.
 * Formatted for banks/aggregators; columns are generic (no country-specific
 * wage-protection scheme).
 */
export function generateBankPayrollFile(batch, settings) {
  const header = `${t('bankFile.crNumber')},${t('bankFile.companyName')},${t('bankFile.month')},${t('bankFile.employeesCount')},${t('bankFile.totalTransferred')},${t('bankFile.currency')}`;
  // P2.2: never merge different currencies in a total. The currency cell
  // holds a single currency code, or an explicit per-currency breakdown when a
  // batch mixes currencies (rows below stay numeric per employee).
  const totalByCurrency = (batch.totalsByCurrency || []).filter((g) => g && g.count > 0);
  let currencyCell = settings.currency || '';
  if (totalByCurrency.length === 1) {
    currencyCell = totalByCurrency[0].code || currencyCell;
  } else if (totalByCurrency.length > 1) {
    currencyCell = totalByCurrency.map((g) => `${g.code} ${g.net.toFixed(2)}`).join(' + ');
  }
  const meta = `${settings.commercialRegistration || ''},${settings.companyName},${batch.month},${batch.employeesCount},${batch.totalNet},${currencyCell}`;

  const columns = `${t('bankFile.num')},${t('bankFile.employeeNumber')},${t('bankFile.employeeName')},${t('bankFile.iban')},${t('bankFile.bankName')},${t('bankFile.basicSalary')},${t('bankFile.housing')},${t('bankFile.otherAllowances')},${t('bankFile.totalDeductions')},${t('bankFile.netTransferred')}`;

  const rows = batch.items.map((it, idx) => {
    const otherAllow = it.otherAllowances + it.transportAllowance + it.overtimeAmount;
    return `${idx + 1},${it.employeeNumber},"${it.employeeName}",${it.iban},"${it.bankName}",${it.basicSalary},${it.housingAllowance},${otherAllow},${it.totalDeductions},${it.netSalary}`;
  });

  return [header, meta, '', columns, ...rows].join('\n');
}

/**
 * Legacy alias for backward compatibility with older imports.
 */
export const generateWPSFile = generateBankPayrollFile;
