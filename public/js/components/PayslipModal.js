// ==========================================
// Payslip Modal - Detailed Salary Breakdown & Isolated Receipt Print
// Includes: Full earnings, GOSI, Loans, Deductions, Prorated salary & Clean Print
// ==========================================

import { storage } from "../storage.js";
import { createModal } from "./Modal.js";
import { formatCurrency, formatDate, resolveEmployeeCurrency, formatPayMonth, escapeHtml, formatAmountWithCode } from "../types.js";
import { Icons } from "../icons.js";
import { t, i18n } from '../i18n.js';
import { getDailyRate, getHourlyRate, getMinuteRate } from '../engines/wageEngine.js';

export function openPayslipModal(employee, targetMonth = null) {
  if (!employee) return;
  const state = storage.getState();
  const { loans, attendance, overtime, settings, companies, payrolls } = state;
  const curRec = resolveEmployeeCurrency(employee, settings, companies);
  const curCode = curRec.code || settings.currency || 'USD';
  const v = (amt) => formatAmountWithCode(amt, curCode);
  const sym = curRec.symbol || "$";
  const isEn = i18n.getLang() === 'en';

  const comp = companies.find((c) => c.id === employee.companyId);
  const branch = comp ? (comp.branches || []).find((b) => b.id === employee.branchId) : null;
  const companyDisplay = comp
    ? (isEn && comp.nameEn ? comp.nameEn : comp.nameAr)
    : (settings.companyName || '');
  const branchDisplay = branch
    ? (isEn && branch.nameEn ? branch.nameEn : branch.nameAr)
    : '';

  const today = new Date();
  const currentMonthStr = today.toISOString().slice(0, 7);
  const month = targetMonth || currentMonthStr;
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const isCurrentMonth = month === currentMonthStr;
  const daysWorked = isCurrentMonth ? today.getDate() : daysInMonth;

  // Salary components
  const basic = Number(employee.basicSalary) || 0;
  const housing = Number(employee.housingAllowance) || 0;
  const transport = Number(employee.transportAllowance) || 0;
  const other = Number(employee.otherAllowances) || 0;
  const gross = basic + housing + transport + other;
  const overtimeRateMult = Number(settings.overtimeRegularRate) || 1.5;
  // Daily wage from the SSOT wage engine (historical default: working days).
  const dailyWage = getDailyRate(employee, settings, { month, defaultMethod: 'workingDays' });

  // Prorated salary up to daysWorked
  const proratedSalary = parseFloat((dailyWage * daysWorked).toFixed(2));

  // Overtime for this month
  const monthOvertime = overtime.filter(
    (o) => o.employeeId === employee.id && o.status === "approved" && (o.date || "").startsWith(month)
  );
  const totalOvertimeHours = monthOvertime.reduce((s, o) => s + (Number(o.hours) || 0), 0);
  const overtimeRate = getHourlyRate(employee, settings, { month, defaultMethod: 'workingDays' }) * overtimeRateMult;
  const overtimeAmount = parseFloat((totalOvertimeHours * overtimeRate).toFixed(2));

  // Social Security / Insurance deduction
  const gosiDeduction = employee.isSubjectToGosi !== false
    ? parseFloat(((Number(employee.gosiRegisteredWage) || (basic + housing)) * ((Number(employee.gosiEmployeePercent) || 0) / 100)).toFixed(2))
    : 0;
  const gosiCompany = employee.isSubjectToGosi !== false
    ? parseFloat(((Number(employee.gosiRegisteredWage) || (basic + housing)) * ((Number(employee.gosiCompanyPercent) || 0) / 100)).toFixed(2))
    : 0;

  // Loan installment for this month
  const activeLoans = loans.filter((l) => l.employeeId === employee.id && l.status === "active");
  const loanInstallment = activeLoans.reduce((s, l) => s + (Number(l.installmentAmount || l.monthlyInstallment) || 0), 0);

  // Absence / late deductions
  const empAtt = attendance.filter((a) => a.employeeId === employee.id && (a.date || "").startsWith(month));
  const absenceDays = empAtt.filter((a) => a.status === "absent").length;
  const lateMinutes = empAtt.reduce((s, a) => s + (Number(a.lateMinutes) || 0), 0);
  const absenceDeduction = parseFloat((absenceDays * dailyWage).toFixed(2));
  const lateDeduction = parseFloat((lateMinutes * getMinuteRate(employee, settings, { month, defaultMethod: 'workingDays' })).toFixed(2));

  // Totals
  const totalAdditions = gross + overtimeAmount;
  const totalDeductions = gosiDeduction + loanInstallment + absenceDeduction + lateDeduction;
  const netSalary = parseFloat(Math.max(0, totalAdditions - totalDeductions).toFixed(2));
  const netProrated = parseFloat(Math.max(0, proratedSalary + overtimeAmount - totalDeductions).toFixed(2));

  const safeEmpName = escapeHtml(employee.fullName);
  const safeEmpNumber = escapeHtml(employee.employeeNumber);
  const safeDepartment = escapeHtml(employee.department);
  const safeJobTitle = escapeHtml(employee.jobTitle);
  const safeCompanyDisplay = escapeHtml(companyDisplay);
  const safeBranchDisplay = escapeHtml(branchDisplay);

  const monthBatch = (payrolls || []).find((b) => b.month === month);
  const isMonthReleased = !!monthBatch && (monthBatch.releaseStatus === 'released' || monthBatch.status === 'paid');

  const bodyHtml = `
    <div class="payslip-wrapper print-page" style="font-family: 'Cairo', sans-serif;">
      <!-- Header -->
      <div style="text-align:center; border-bottom:2px solid var(--primary); padding-bottom:16px; margin-bottom:20px;">
        <div style="font-size:22px; font-weight:900; color:var(--primary);">${isEn ? 'Official Payslip & Receipt' : '📋 قسيمة واستلام الراتب التفصيلية'}</div>
        <div style="font-size:13px; color:var(--text-muted); margin-top:4px;">${safeCompanyDisplay}${safeBranchDisplay ? ` • ${safeBranchDisplay}` : ''} • راتب ${formatPayMonth(month)}</div>
        ${isMonthReleased ? `
        <div style="display:inline-flex; align-items:center; gap:6px; margin-top:10px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.4); color:var(--success); font-size:12px; font-weight:800; padding:5px 14px; border-radius:20px;">
          ✅ ${isEn ? 'Released on payday' : 'تم التحرير في يوم الصرف'}: ${formatDate(monthBatch.releasedAt || monthBatch.paidAt)}
        </div>` : ''}
      </div>

      <!-- Employee Info -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:20px; font-size:13px; background:var(--bg-card-hover); padding:12px 16px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
        <div><span style="color:var(--text-muted);">${t('leaves.employee')}: </span><strong>${safeEmpName}</strong></div>
        <div><span style="color:var(--text-muted);">${t('employeeModal.employeeNumber')}: </span><strong>${safeEmpNumber}</strong></div>
        <div><span style="color:var(--text-muted);">${t('leaves.department')}: </span><strong>${safeDepartment}</strong></div>
        <div><span style="color:var(--text-muted);">${t('employeeModal.jobTitle')}: </span><strong>${safeJobTitle}</strong></div>
        <div><span style="color:var(--text-muted);">${t('employeeModal.hireDate')}: </span><strong>${formatDate(employee.hireDate)}</strong></div>
        <div><span style="color:var(--text-muted);">${isEn ? 'Salary Period' : 'الشهر المحاسبي'}: </span><strong>${isEn ? formatPayMonth(month) : `راتب ${formatPayMonth(month)}`} (${daysWorked}/${daysInMonth} ${isEn ? 'days' : 'يوم'})</strong></div>
      </div>

      <!-- Prorated Salary Alert -->
      ${isCurrentMonth ? `
      <div style="background:rgba(79,70,229,0.08); border:1px solid rgba(79,70,229,0.2); border-radius:var(--radius-md); padding:10px 14px; margin-bottom:16px; font-size:12.5px; display:flex; justify-content:space-between; align-items:center;">
        <span>🗓️ ${isEn ? 'Prorated salary to date' : 'الراتب المستحق المحتسب حتى اليوم'} (${daysWorked} / ${daysInMonth} ${isEn ? 'days' : 'يوم'}):</span>
        <strong style="color:var(--primary); font-size:16px;">${v(netProrated)}</strong>
      </div>
      ` : ""}

      <!-- Salary Table -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <!-- Additions -->
        <div>
          <div style="font-weight:800; font-size:14px; color:var(--success); margin-bottom:10px; display:flex; align-items:center; gap:6px;">
            ${Icons.plus(16)} ${isEn ? 'Earnings & Allowances' : 'المستحقات والبدلات'}
          </div>
          <table style="width:100%; font-size:13px; border-collapse:collapse;">
            <tbody>
              <tr style="border-bottom:1px solid var(--border-color);">
                <td style="padding:7px 0; color:var(--text-muted);">${t('basicSalary')}</td>
                <td style="text-align:left; font-weight:700;">${v(basic)}</td>
              </tr>
              <tr style="border-bottom:1px solid var(--border-color);">
                <td style="padding:7px 0; color:var(--text-muted);">${t('payroll.housing')}</td>
                <td style="text-align:left; font-weight:700;">${v(housing)}</td>
              </tr>
              <tr style="border-bottom:1px solid var(--border-color);">
                <td style="padding:7px 0; color:var(--text-muted);">${t('payroll.transport')}</td>
                <td style="text-align:left; font-weight:700;">${v(transport)}</td>
              </tr>
              ${other > 0 ? `<tr style="border-bottom:1px solid var(--border-color);">
                <td style="padding:7px 0; color:var(--text-muted);">${t('otherAllowances')}</td>
                <td style="text-align:left; font-weight:700;">${v(other)}</td>
              </tr>` : ""}
              ${overtimeAmount > 0 ? `<tr style="border-bottom:1px solid var(--border-color);">
                <td style="padding:7px 0; color:var(--text-muted);">${isEn ? 'Overtime' : 'عمل إضافي'} (${totalOvertimeHours} ${isEn ? 'hrs' : 'ساعة'})</td>
                <td style="text-align:left; font-weight:700; color:var(--success);">+${v(overtimeAmount)}</td>
              </tr>` : ""}
              <tr style="background:rgba(16,185,129,0.06);">
                <td style="padding:8px 0; font-weight:900; font-size:14px;">${t('reports.total')} ${isEn ? 'Earnings' : 'الاستحقاقات'}</td>
                <td style="text-align:left; font-weight:900; font-size:14px; color:var(--success);">${v(totalAdditions)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Deductions -->
        <div>
          <div style="font-weight:800; font-size:14px; color:var(--danger); margin-bottom:10px; display:flex; align-items:center; gap:6px;">
            ${Icons.x(16)} ${isEn ? 'Deductions & Advances' : 'الاستقطاعات والسلف'}
          </div>
          <table style="width:100%; font-size:13px; border-collapse:collapse;">
            <tbody>
              ${gosiDeduction > 0 ? `<tr style="border-bottom:1px solid var(--border-color);">
                <td style="padding:7px 0; color:var(--text-muted);">${isEn ? 'Social Security (Employee)' : 'التأمينات الاجتماعية (الموظف)'} (${employee.gosiEmployeePercent || 0}%)</td>
                <td style="text-align:left; font-weight:700; color:var(--danger);">-${v(gosiDeduction)}</td>
              </tr>` : ""}
              ${loanInstallment > 0 ? `<tr style="border-bottom:1px solid var(--border-color);">
                <td style="padding:7px 0; color:var(--text-muted);">${isEn ? 'Loan / Advance Installment' : 'قسط السلفة الشهرية'}</td>
                <td style="text-align:left; font-weight:700; color:var(--danger);">-${v(loanInstallment)}</td>
              </tr>` : ""}
              ${absenceDeduction > 0 ? `<tr style="border-bottom:1px solid var(--border-color);">
                <td style="padding:7px 0; color:var(--text-muted);">${isEn ? 'Absence Deduction' : 'خصم غياب'} (${absenceDays} ${isEn ? 'days' : 'يوم'})</td>
                <td style="text-align:left; font-weight:700; color:var(--danger);">-${v(absenceDeduction)}</td>
              </tr>` : ""}
              ${lateDeduction > 0 ? `<tr style="border-bottom:1px solid var(--border-color);">
                <td style="padding:7px 0; color:var(--text-muted);">${isEn ? 'Late Deduction' : 'خصم تأخر'} (${lateMinutes} ${isEn ? 'min' : 'دقيقة'})</td>
                <td style="text-align:left; font-weight:700; color:var(--danger);">-${v(lateDeduction)}</td>
              </tr>` : ""}
              ${totalDeductions === 0 ? `<tr><td colspan="2" style="padding:7px 0; color:var(--text-muted); text-align:center;">${isEn ? 'No deductions' : 'لا توجد استقطاعات'}</td></tr>` : ""}
              <tr style="background:rgba(239,68,68,0.06);">
                <td style="padding:8px 0; font-weight:900; font-size:14px;">${isEn ? 'Total Deductions' : 'إجمالي الاستقطاع'}</td>
                <td style="text-align:left; font-weight:900; font-size:14px; color:var(--danger);">-${v(totalDeductions)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Net Salary Box -->
      <div style="margin-top:20px; background:linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(79,70,229,0.1) 100%); border:2px solid var(--success); border-radius:var(--radius-lg); padding:16px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-size:13px; color:var(--text-muted);">${isEn ? 'Net Payable Salary (Full Month)' : 'صافي الراتب المستحق للشهر الكامل'} (${daysInMonth} ${isEn ? 'days' : 'يوم'})</div>
          <div style="font-size:24px; font-weight:900; color:var(--success);">${v(netSalary)}</div>
        </div>
        ${isCurrentMonth ? `<div style="text-align:left;">
          <div style="font-size:13px; color:var(--text-muted);">${isEn ? 'Net to date' : 'صافي حتى اليوم'} (${daysWorked} ${isEn ? 'days' : 'يوم'})</div>
          <div style="font-size:20px; font-weight:900; color:var(--primary);">${v(netProrated)}</div>
        </div>` : ""}
      </div>

      <!-- Company Social Security Note -->
      ${gosiCompany > 0 ? `
      <div style="margin-top:12px; font-size:12px; color:var(--text-muted); background:var(--bg-card-hover); padding:8px 12px; border-radius:var(--radius-md);">
        🏦 ${isEn ? 'Company Social Security Share (Paid by employer)' : 'حصة الشركة في التأمينات الاجتماعية (تتحملها المنشأة)'}: ${v(gosiCompany)} | ${isEn ? 'Total Social Security Contribution' : 'إجمالي اشتراك التأمينات'}: ${v(gosiDeduction + gosiCompany)}
      </div>
      ` : ""}
    </div>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-primary" id="btn-print-payslip">🖨️ ${isEn ? 'Print Payslip Receipt' : 'طباعة وصل الراتب فقط'}</button>
  `;

  createModal({
    title: `${isEn ? 'Payslip' : 'قسيمة راتب'}: ${employee.fullName} — ${formatPayMonth(month)}`,
    size: "lg",
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      overlay.querySelector(".close-modal-btn").addEventListener("click", close);
      overlay.querySelector("#btn-print-payslip")?.addEventListener("click", () => {
        printIsolatedPayslip({
          employee,
          month,
          companyDisplay,
          branchDisplay,
          basic,
          housing,
          transport,
          other,
          overtimeAmount,
          totalOvertimeHours,
          totalAdditions,
          gosiDeduction,
          gosiCompany,
          loanInstallment,
          absenceDeduction,
          lateDeduction,
          totalDeductions,
          netSalary,
          settings,
          sym,
          isEn
        });
      });
    },
  });
}

function printIsolatedPayslip(data) {
  const { employee, month, companyDisplay, branchDisplay, basic, housing, transport, other, overtimeAmount, totalOvertimeHours, totalAdditions, gosiDeduction, gosiCompany, loanInstallment, absenceDeduction, lateDeduction, totalDeductions, netSalary, settings, sym, isEn } = data;
  
  const safeEmpName = escapeHtml(employee.fullName);
  const safeEmpNumber = escapeHtml(employee.employeeNumber);
  const safeDepartment = escapeHtml(employee.department);
  const safeJobTitle = escapeHtml(employee.jobTitle);
  const safeCompanyDisplay = escapeHtml(companyDisplay || settings.companyName || 'BenoSoft');
  const safeBranchDisplay = escapeHtml(branchDisplay || '-');
  const safeCompanyNameEn = escapeHtml(settings.companyNameEn || '');
  const safeCommercialReg = escapeHtml(settings.commercialRegistration || '');
  
  const receiptNo = `PAY-RCP-${Date.now().toString().slice(-6)}`;
  const win = window.open('', '_blank', 'width=780,height=880');
  
  win.document.write(`<!DOCTYPE html>
<html dir="${isEn ? 'ltr' : 'rtl'}" lang="${isEn ? 'en' : 'ar'}">
<head>
  <meta charset="UTF-8">
  <title>${isEn ? 'Official Payslip' : 'وصل استلام الراتب الرسمي'} - ${safeEmpName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #0f172a; padding: 32px; font-size: 13px; }
    .header { text-align: center; border-bottom: 3px solid #4f46e5; padding-bottom: 16px; margin-bottom: 20px; }
    .header h1 { font-size: 22px; font-weight: 900; color: #1e1b4b; }
    .header p { font-size: 12px; color: #64748b; margin-top: 3px; }
    .badge-receipt { display: inline-block; background: #4f46e5; color: #fff; padding: 4px 14px; border-radius: 20px; font-size: 13px; font-weight: 800; margin-top: 8px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
    .info-row { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; }
    .info-row span { font-size: 11px; color: #64748b; display: block; }
    .info-row strong { font-size: 14px; color: #0f172a; }
    .breakdown-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
    .box { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .box-title { background: #f1f5f9; padding: 8px 12px; font-weight: 800; font-size: 13px; border-bottom: 1px solid #e2e8f0; }
    .box-body { padding: 12px; }
    .item-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #e2e8f0; }
    .item-row:last-child { border-bottom: none; }
    .amount-box { background: #1e1b4b; color: #fff; border-radius: 10px; padding: 18px 24px; text-align: center; margin: 20px 0; }
    .amount-box .label { font-size: 13px; color: #a5b4fc; }
    .amount-box .value { font-size: 32px; font-weight: 900; color: #38bdf8; margin-top: 4px; }
    .sigs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 30px; border-top: 1px dashed #cbd5e1; padding-top: 20px; text-align: center; font-size: 12px; color: #475569; }
    .sig-line { border-bottom: 1px dotted #94a3b8; width: 80%; margin: 28px auto 4px; }
    @media print { body { padding: 16px; } .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${safeCompanyDisplay}</h1>
    <p>${safeCompanyNameEn} ${safeBranchDisplay !== '-' ? '• ' + safeBranchDisplay : ''} ${safeCommercialReg ? '• ' + (isEn ? 'CR: ' : 'سجل: ') + safeCommercialReg : ''}</p>
    <div class="badge-receipt">${isEn ? 'OFFICIAL SALARY PAYSLIP & RECEIPT' : 'وصل استلام وقسيمة الراتب الرسمية'}</div>
  </div>

  <div class="info-grid">
    <div class="info-row"><span>${isEn ? 'Employee Name' : 'اسم الموظف'}</span><strong>${safeEmpName}</strong></div>
    <div class="info-row"><span>${isEn ? 'Employee ID' : 'الرقم الوظيفي'}</span><strong>${safeEmpNumber}</strong></div>
    <div class="info-row"><span>${isEn ? 'Department' : 'القسم'}</span><strong>${safeDepartment}</strong></div>
    <div class="info-row"><span>${isEn ? 'Job Title' : 'المسمى الوظيفي'}</span><strong>${safeJobTitle}</strong></div>
    <div class="info-row"><span>${isEn ? 'Salary Period' : 'فترة الراتب'}</span><strong>${isEn ? formatPayMonth(month) : `راتب ${formatPayMonth(month)}`}</strong></div>
    <div class="info-row"><span>${isEn ? 'Receipt Number' : 'رقم الوصل'}</span><strong>${receiptNo}</strong></div>
    <div class="info-row"><span>${isEn ? 'Branch' : 'الفرع'}</span><strong>${safeBranchDisplay}</strong></div>
  </div>

  <div class="breakdown-grid">
    <div class="box">
      <div class="box-title" style="color:#059669;">${isEn ? '1. Earnings & Allowances' : '1. المستحقات والبدلات'}</div>
      <div class="box-body">
        <div class="item-row"><span>${isEn ? 'Basic Salary' : 'الراتب الأساسي'}</span><strong>${v(basic)}</strong></div>
        <div class="item-row"><span>${isEn ? 'Housing Allowance' : 'بدل السكن'}</span><strong>${v(housing)}</strong></div>
        <div class="item-row"><span>${isEn ? 'Transport Allowance' : 'بدل النقل'}</span><strong>${v(transport)}</strong></div>
        ${other > 0 ? `<div class="item-row"><span>${isEn ? 'Other Allowances' : 'بدلات أخرى'}</span><strong>${v(other)}</strong></div>` : ''}
        ${overtimeAmount > 0 ? `<div class="item-row"><span>${isEn ? 'Overtime Pay' : 'أجر الإضافي'} (${totalOvertimeHours} ${isEn ? 'hrs' : 'ساعة'})</span><strong style="color:#059669;">+ ${v(overtimeAmount)}</strong></div>` : ''}
        <div class="item-row" style="font-weight:900; border-top:1px solid #cbd5e1; margin-top:6px; padding-top:8px;">
          <span>${isEn ? 'Gross Earnings' : 'إجمالي الاستحقاقات'}</span><strong style="color:#059669;">${v(totalAdditions)}</strong>
        </div>
      </div>
    </div>

    <div class="box">
      <div class="box-title" style="color:#dc2626;">${isEn ? '2. Deductions & Advances' : '2. الاستقطاعات والسلف'}</div>
      <div class="box-body">
        ${gosiDeduction > 0 ? `<div class="item-row"><span>${isEn ? 'Social Security (Employee)' : 'التأمينات الاجتماعية (الموظف)'}</span><strong style="color:#dc2626;">- ${v(gosiDeduction)}</strong></div>` : ''}
        ${loanInstallment > 0 ? `<div class="item-row"><span>${isEn ? 'Loan / Advance Installment' : 'قسط السلفة / القرض'}</span><strong style="color:#dc2626;">- ${v(loanInstallment)}</strong></div>` : ''}
        ${absenceDeduction > 0 ? `<div class="item-row"><span>${isEn ? 'Absence Deduction' : 'خصم غياب'}</span><strong style="color:#dc2626;">- ${v(absenceDeduction)}</strong></div>` : ''}
        ${lateDeduction > 0 ? `<div class="item-row"><span>${isEn ? 'Late Arrival Deduction' : 'خصم تأخير'}</span><strong style="color:#dc2626;">- ${v(lateDeduction)}</strong></div>` : ''}
        <div class="item-row" style="font-weight:900; border-top:1px solid #cbd5e1; margin-top:6px; padding-top:8px;">
          <span>${isEn ? 'Total Deductions' : 'إجمالي الاستقطاعات'}</span><strong style="color:#dc2626;">- ${v(totalDeductions)}</strong>
        </div>
      </div>
    </div>
  </div>

  <div class="amount-box">
    <div class="label">${isEn ? 'NET PAYABLE SALARY' : 'صافي الراتب المستحق المحول'}</div>
    <div class="value">${v(netSalary)}</div>
  </div>

  ${gosiCompany > 0 ? `
  <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px 12px; font-size:11.5px; color:#64748b; margin-bottom:20px;">
    ${isEn ? 'Employer Social Security Contribution' : 'مساهمة المنشأة في التأمينات الاجتماعية'}: ${v(gosiCompany)}
  </div>
  ` : ''}

  <div class="sigs">
    <div>
      <div>${isEn ? 'Payroll Officer' : 'إعداد مسؤول الرواتب'}</div>
      <div class="sig-line"></div>
      <div>${isEn ? 'Signature & Date' : 'التوقيع والتاريخ'}</div>
    </div>
    <div>
      <div>${isEn ? 'HR / Finance Manager' : 'اعتماد المدير المالي / الموارد البشرية'}</div>
      <div class="sig-line"></div>
      <div>${isEn ? 'Signature & Stamp' : 'التوقيع والختم'}</div>
    </div>
    <div>
      <div>${isEn ? 'Employee Signature' : 'توقيع الموظف بالاستلام'}</div>
      <div class="sig-line"></div>
      <div>${isEn ? 'Signature' : 'التوقيع'}</div>
    </div>
  </div>

  <div class="no-print" style="text-align:center; margin-top:24px;">
    <button onclick="window.print()" style="padding:10px 30px; background:#4f46e5; color:#fff; border:none; border-radius:8px; font-size:15px; font-weight:700; cursor:pointer;">🖨️ ${isEn ? 'Print Payslip' : 'طباعة الوصل'}</button>
  </div>
</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 400);
}
