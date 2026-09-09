// ==========================================
// Comprehensive Reports & Audit Hub (Audit, Month Comparison, Excel Export)
// ==========================================

import { storage } from '../storage.js';
import { Icons } from '../icons.js';
import { formatCurrency, formatDate, STATUS_LABELS, LEAVE_TYPE_LABELS, 
getCurrentMonth, can, countAbsenceDays } from '../types.js';
import { calculateLeaveBalance } from '../engines/leaveEngine.js';
import { toast } from './Toast.js';
import { i18n, t, tf } from '../i18n.js';

export function renderReportsView(container, options = {}) {
  const state = storage.getState();
  const { employees, companies, leaves, overtime, loans, attendance, increments, eosb, settings } = state;
  const sym = settings.currencySymbol || '$';
  const isEn = i18n.getLang() === 'en';
  const hd = (ar, en) => (isEn ? en : ar);

  // ------------------------------------------------------------------
  // C-1: Reports MUST be built from the stored, actually disbursed
  // payroll batches (state.payrolls), never from generateMonthlyPayroll().
  // A month is only treated as a real payroll when a stored batch with
  // status === 'paid' exists in the system.
  // ------------------------------------------------------------------
  function getStoredMonthlyPayroll(month) {
    const batches = storage.getState().payrolls || [];
    return batches.find((b) => b.month === month) || null;
  }

  function payrollStatusInfo(batch, month) {
    if (!batch) {
      return {
        paid: false,
        badge: 'badge-danger',
        badgeText: isEn ? 'No Stored Payroll' : 'لا يوجد مسير مخزن',
        bannerType: 'danger',
        bannerTitle: isEn ? `No payroll record exists for ${month}` : `لا يوجد سجل مسير مخزن لشهر ${month}`,
        bannerText: isEn
          ? `This month was never processed / disbursed in the system, so no payroll figures are available. No data has been fabricated. Generate it from the Payroll screen and disburse it first.`
          : `لم يتم تجهيز أو صرف مسير هذا الشهر داخل النظام، لذا لا تتوفر أرقام رواتب. لم يتم توليد أي بيانات. أنشئ المسير من شاشة الرواتب وصرفه أولاً.`,
      };
    }
    if (batch.status === 'paid') {
      return {
        paid: true,
        badge: 'badge-success',
        badgeText: isEn ? 'Paid & Disbursed' : 'مصروف ومدفوع',
        bannerType: 'success',
        bannerTitle: isEn ? `Disbursed payroll for ${month}` : `مسير مصروف لشهر ${month}`,
        bannerText: isEn
          ? `Paid on ${formatDate(batch.paidAt)} by ${batch.paidBy || 'HR'}. Figures below are the actual stored disbursed amounts.`
          : `تم الصرف بتاريخ ${formatDate(batch.paidAt)} بواسطة ${batch.paidBy || 'HR'}. الأرقام أدناه هي المبالغ المخزنة الفعلية.`,
      };
    }
    const statusAr = batch.status === 'approved' ? 'معتمد (غير مصروف)' : batch.status === 'under_audit' ? 'قيد التدقيق المالي' : 'مسودة (غير منتج)';
    const statusEn = batch.status === 'approved' ? 'Approved (not disbursed)' : batch.status === 'under_audit' ? 'Under financial audit' : 'Draft (not finalized)';
    return {
      paid: false,
      badge: 'badge-warning',
      badgeText: isEn ? statusEn : statusAr,
      bannerType: 'warning',
      bannerTitle: isEn ? `Payroll for ${month} is ${statusEn}` : `مسير شهر ${month} ${statusAr}`,
      bannerText: isEn
        ? `This payroll exists but has NOT been disbursed (status: ${batch.status}). Do not treat it as an official payment.`
        : `هذا المسير موجود لكنه لم يُصرف بعد (الحالة: ${batch.status}). لا يجوز اعتباره صرفاً رسمياً.`,
    };
  }

  function monthAlertHtml(type, title, text) {
    const colors = {
      success: 'rgba(16,185,129,0.08)',
      warning: 'rgba(245,158,11,0.10)',
      danger: 'rgba(239,68,68,0.08)',
    };
    const border = {
      success: 'var(--success)',
      warning: 'var(--warning)',
      danger: 'var(--danger)',
    };
    return `<div style="padding:12px 16px; border-radius:10px; margin-bottom:16px; border:1px solid ${border[type]}; background:${colors[type]}; display:flex; align-items:flex-start; gap:10px;">
      <span style="font-size:16px; line-height:1.2;">${type === 'success' ? '✅' : type === 'warning' ? '⚠️' : '⛔'}</span>
      <div>
        <div style="font-weight:800; font-size:13px; color:var(--text-main);">${title}</div>
        <div style="font-size:12.5px; color:var(--text-muted); margin-top:2px; line-height:1.6;">${text}</div>
      </div>
    </div>`;
  }

  let activeReportType = options.type || 'audit'; // 'audit' | 'comparison' | 'payroll' | 'gosi' | 'leaves' | 'overtime' | 'eosb'
  let reportMonth = getCurrentMonth();

  // Month comparison state
  const prevDate = new Date();
  prevDate.setMonth(prevDate.getMonth() - 1);
  let prevMonth = prevDate.toISOString().slice(0, 7);
  let nextMonth = getCurrentMonth();

  function exportToXLSX(filename, sheetName, data) {
    if (!data || data.length === 0) {
      toast.info(t('reports.noExportData'));
      return;
    }

    if (window.XLSX) {
      try {
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31).replace(/[\[\]\:\*\?\/\\]/g, ''));
        XLSX.writeFile(wb, `${filename}_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast.success(t('reports.excelExported'));
        return;
      } catch (err) {
        console.warn('XLSX library failed, fallback to native Excel XML:', err);
      }
    }

    // Native Excel XML Spreadsheet (.xls) fallback
    try {
      const headers = Object.keys(data[0]);
      let xml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<!--[if gte mso 9]>
<xml>
 <x:ExcelWorkbook>
  <x:ExcelWorksheets>
   <x:ExcelWorksheet>
    <x:Name>${sheetName.slice(0, 31).replace(/[\[\]\:\*\?\/\\]/g, '')}</x:Name>
    <x:WorksheetOptions>
     <x:DisplayGridlines/>
     ${isEn ? '' : '<x:DisplayRightToLeft/>'}
    </x:WorksheetOptions>
   </x:ExcelWorksheet>
  </x:ExcelWorksheets>
 </x:ExcelWorkbook>
</xml>
<![endif]-->
<style>
  th { background-color: #1e3a8a; color: #ffffff; font-weight: bold; border: 1px solid #0f172a; padding: 8px; }
  td { border: 1px solid #cbd5e1; padding: 6px; }
</style>
</head>
<body>
<table>
  <thead>
    <tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>
  </thead>
  <tbody>
    ${data
      .map(
        (row) => `
      <tr>${headers.map((h) => `<td>${row[h] !== undefined && row[h] !== null ? row[h] : ''}</td>`).join('')}</tr>
    `
      )
      .join('')}
  </tbody>
</table>
</body>
</html>`;

      const blob = new Blob(['\uFEFF' + xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}_${new Date().toISOString().split('T')[0]}.xls`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(t('reports.excelExported'));
    } catch (e) {
      console.error('Export error:', e);
      toast.error(t('reports.exportFailed'));
    }
  }

  function renderReportContent() {
    const reportArea = container.querySelector('#report-details-container');
    if (!reportArea) return;

    // ==========================================
    // 1. AUDIT REPORT (تقرير التدقيق الشامل)
    // ==========================================
    if (activeReportType === 'audit') {
      const storedBatch = getStoredMonthlyPayroll(reportMonth);
      const payInfo = payrollStatusInfo(storedBatch, reportMonth);

      const auditRows = (storedBatch ? storedBatch.items : []).map((it) => {
        const emp = employees.find((e) => e.id === it.employeeId);

        // Annual Leave Calculations (Safe Employee Object)
        const empObject = emp || { id: it.employeeId, fullName: 'Unknown', hireDate: '2023-01-01', annualLeaveEntitlement: 30 };
        const leaveBal = calculateLeaveBalance(empObject, leaves, new Date(), settings);
        
        // Month leaves taken (days)
        const monthLeavesTaken = leaves
          .filter((l) => l.employeeId === it.employeeId && l.status === 'approved' && (l.startDate || '').startsWith(reportMonth))
          .reduce((sum, l) => sum + (Number(l.daysCount) || 0), 0);

        // Loans Info
        const activeEmpLoans = loans.filter((ln) => ln.employeeId === it.employeeId && ln.status === 'active');
        const remainingLoanTotal = activeEmpLoans.reduce((sum, ln) => sum + (Number(ln.remainingAmount) || 0), 0);

        // Absences & Penalties
        const empAtt = attendance.filter((a) => a.employeeId === it.employeeId && (a.date || '').startsWith(reportMonth));
        const absenceDays = countAbsenceDays(empAtt);
        const lateMinutes = empAtt.reduce((sum, a) => sum + (Number(a.lateMinutes) || 0), 0);

        // Prorated Salary to Date
        const totalGross =
          (Number(emp?.basicSalary) || 0) +
          (Number(emp?.housingAllowance) || 0) +
          (Number(emp?.transportAllowance) || 0) +
          (Number(emp?.otherAllowances) || 0);
        const [reportYear, reportMonthNumber] = reportMonth.split('-').map(Number);
        const isCurrentMonth = reportYear === new Date().getFullYear() && reportMonthNumber === new Date().getMonth() + 1;
        const daysInReportMonth = new Date(reportYear, reportMonthNumber, 0).getDate();
        const payableDays = isCurrentMonth ? new Date().getDate() : daysInReportMonth;
        const proratedSalaryToDate = parseFloat(((totalGross / daysInReportMonth) * payableDays).toFixed(2));

        return {
          emp,
          it,
          leaveBal,
          monthLeavesTaken,
          remainingLoanTotal,
          absenceDays,
          lateMinutes,
          proratedSalaryToDate,
        };
      });

      const batchNet = storedBatch ? (Number(storedBatch.totalNet) || auditRows.reduce((s, r) => s + (Number(r.it.netSalary) || 0), 0)) : 0;
      const batchGross = storedBatch ? (Number(storedBatch.totalGross) || auditRows.reduce((s, r) => s + (Number(r.it.grossSalary) || 0), 0)) : 0;

      reportArea.innerHTML = `
        <div class="card" style="padding:20px; margin-bottom:20px; background:linear-gradient(135deg, rgba(79, 70, 229, 0.05) 0%, rgba(16, 185, 129, 0.05) 100%); border:1px solid var(--border-color);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span class="badge badge-primary" style="font-size:12px;">${t('reports.financialAuditUnit')}</span>
                ${storedBatch ? `<span class="badge ${payInfo.badge}" style="font-size:12px;">${payInfo.badgeText}</span>` : ''}
                <h3 style="font-size:17px; font-weight:800; color:var(--text-main);">${tf('reports.employeeAuditTitle', { month: reportMonth })}</h3>
              </div>
              <p style="font-size:12.5px; color:var(--text-muted); margin-top:4px;">
                ${isEn ? 'Consolidated audit report built from the stored payroll: Basic, Allowances, Overtime, Social Security, Advances, Absences, Leaves, and Net Pay' : 'تقرير موحد مبني على المسير المخزن فعلياً: الرواتب، البدلات، الإضافي، التأمينات، السلف، الغياب، إجازات الشهر، الرصيد المتبقي، وصافي الراتب'}
              </p>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <input type="month" class="form-input" id="report-month-input" value="${reportMonth}" style="width:160px; padding:6px 10px; font-weight:700;">
              <button type="button" class="btn btn-outline" id="btn-export-audit-xlsx" ${auditRows.length === 0 && !storedBatch ? 'disabled' : ''}>
                ${Icons.download(16)} ${isEn ? 'Export Audit (Excel)' : 'تصدير تقرير التدقيق'}
              </button>
              <button type="button" class="btn btn-primary" onclick="window.print()">
                ${Icons.printer(16)} ${isEn ? 'Print Report' : 'طباعة التقرير'}
              </button>
            </div>
          </div>
        </div>

        ${monthAlertHtml(payInfo.bannerType, payInfo.bannerTitle, payInfo.bannerText)}

        ${storedBatch && storedBatch.items && storedBatch.items.length === 0 ? `
        <div class="card" style="padding:20px; text-align:center;">
          <div style="font-size:32px; margin-bottom:8px;">📁</div>
          <div style="font-weight:800; font-size:15px; color:var(--text-main);">
            ${isEn ? 'A stored payroll exists for this month but without per-employee items' : 'يوجد مسير مخزن لهذا الشهر لكن بدون تفاصيل لكل موظف'}
          </div>
          <div style="font-size:12.5px; color:var(--text-muted); margin-top:6px; line-height:1.7;">
            ${isEn
              ? `The batch total for ${reportMonth} is: Gross ${formatCurrency(batchGross, sym)} — Deductions — Net ${formatCurrency(batchNet, sym)}. Item-level rows are unavailable (legacy/archived entry), so the table below is intentionally omitted instead of fabricating rows.`
              : `إجمالي مسير ${reportMonth} هو: استحقاق ${formatCurrency(batchGross, sym)} — خصومات — صافي ${formatCurrency(batchNet, sym)}. تفاصيل كل موظف غير متوفرة (إدخال سابق/مؤرشف)، ولذا تم حذف الجدول عمداً بدلاً من توليد صفوف وهمية.`}
          </div>
        </div>
        ` : ''}

        ${auditRows.length > 0 ? `
        <div class="card" style="padding:0; overflow:hidden;">
          <div class="table-container" style="border:none; overflow-x:auto;">
            <table class="table" style="font-size:12px; white-space:nowrap;">
              <thead>
                <tr style="background:var(--bg-card-hover);">
                  <th>${t('reports.number')}</th>
                  <th>${t('reports.employee')}</th>
                  <th>${t('reports.department')}</th>
                  <th>${t('reports.basicSalary')}</th>
                  <th>${t('reports.allowances')}</th>
                  <th>${t('reports.overtime')}</th>
                  <th>${t('reports.grossSalary')}</th>
                  <th style="color:var(--warning);">${isEn ? 'Loan Installment' : 'قسط السلفة'}</th>
                  <th style="color:var(--danger);">${isEn ? 'Absences & Penalties' : 'خصم غياب وتأخر'}</th>
                  <th>${isEn ? 'Social Security (Emp)' : 'تأمينات الموظف'}</th>
                  <th>${t('reports.netSalary')}</th>
                  <th>${t('reports.monthlyLeaves')}</th>
                  <th>${t('reports.remainingLeaveBalance')}</th>
                  <th>${t('reports.remainingAdvances')}</th>
                </tr>
              </thead>
              <tbody>
                ${auditRows
                  .map(
                    (row) => `
                  <tr>
                    <td><strong>${row.emp ? row.emp.employeeNumber : '-'}</strong></td>
                    <td><strong>${row.it.employeeName}</strong></td>
                    <td>${row.it.department}</td>
                    <td>${formatCurrency(row.it.basicSalary, sym)}</td>
                    <td>${formatCurrency(row.it.housingAllowance + row.it.transportAllowance + row.it.otherAllowances, sym)}</td>
                    <td>${row.it.overtimeAmount > 0 ? formatCurrency(row.it.overtimeAmount, sym) : '-'}</td>
                    <td><strong>${formatCurrency(row.it.grossSalary, sym)}</strong></td>
                    <td style="color:var(--warning);">${row.it.loanInstallment > 0 ? '- ' + formatCurrency(row.it.loanInstallment, sym) : '-'}</td>
                    <td style="color:var(--danger);">${row.it.absenceDeduction + row.it.lateDeduction > 0 ? '- ' + formatCurrency(row.it.absenceDeduction + row.it.lateDeduction, sym) : '-'}</td>
                    <td style="color:var(--danger);">- ${formatCurrency(row.it.gosiEmployeeDeduction, sym)}</td>
                    <td><strong style="color:var(--success); font-size:13.5px;">${formatCurrency(row.it.netSalary, sym)}</strong></td>
                    <td><span class="badge ${row.monthLeavesTaken > 0 ? 'badge-warning' : 'badge-gray'}">${tf('reports.daysValue', { count: row.monthLeavesTaken })}</span></td>
                    <td><strong style="color:var(--primary);">${tf('reports.daysValue', { count: (row.leaveBal.remainingAnnualBalance !== undefined ? row.leaveBal.remainingAnnualBalance : (row.leaveBal.remainingDays || 0)) })}</strong></td>
                    <td><strong style="color:${row.remainingLoanTotal > 0 ? 'var(--danger)' : 'var(--text-muted)'};">${formatCurrency(row.remainingLoanTotal, sym)}</strong></td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
              <tfoot>
                <tr style="background:var(--bg-card-hover); font-weight:800;">
                  <td colspan="6">${t('reports.grandTotal')}</td>
                  <td>${formatCurrency(batchGross, sym)}</td>
                  <td style="color:var(--warning);">- ${formatCurrency(auditRows.reduce((s, x) => s + (x.it.loanInstallment || 0), 0), sym)}</td>
                  <td style="color:var(--danger);">- ${formatCurrency(auditRows.reduce((s, x) => s + (x.it.absenceDeduction + x.it.lateDeduction), 0), sym)}</td>
                  <td style="color:var(--danger);">- ${formatCurrency(auditRows.reduce((s, x) => s + x.it.gosiEmployeeDeduction, 0), sym)}</td>
                  <td style="color:var(--success); font-size:15px;">${formatCurrency(batchNet, sym)}</td>
                  <td colspan="3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        ` : ''}
      `;

      reportArea.querySelector('#report-month-input')?.addEventListener('change', (e) => {
        reportMonth = e.target.value;
        renderReportContent();
      });

      reportArea.querySelector('#btn-export-audit-xlsx')?.addEventListener('click', () => {
        if (!can(storage.getActiveUser(), 'reports.export')) { // RBAC gate (C-5)
          toast.error(isEn ? 'Insufficient permissions' : 'لا تملك صلاحية التصدير');
          return;
        }
        if (!storedBatch || !storedBatch.items || storedBatch.items.length === 0) {
          toast.info(isEn ? 'No stored payroll rows for this month to export.' : 'لا توجد صفوف مسير مخزنة لهذا الشهر للتصدير.');
          return;
        }
        const exportData = auditRows.map((r) => ({
          [hd('الرقم الوظيفي', 'Employee ID')]: r.emp ? r.emp.employeeNumber : '-',
          [hd('اسم الموظف', 'Employee Name')]: r.it.employeeName,
          [hd('القسم', 'Department')]: r.it.department,
          [hd('الراتب الأساسي', 'Basic Salary')]: r.it.basicSalary,
          [hd('بدل السكن', 'Housing Allowance')]: r.it.housingAllowance,
          [hd('بدل النقل', 'Transport Allowance')]: r.it.transportAllowance,
          [hd('بدلات أخرى', 'Other Allowances')]: r.it.otherAllowances,
          [hd('أجر الإضافي', 'Overtime Pay')]: r.it.overtimeAmount,
          [hd('إجمالي الراتب', 'Gross Salary')]: r.it.grossSalary,
          [hd('قسط السلفة', 'Loan Installment')]: r.it.loanInstallment,
          [hd('خصم غياب وتأخر', 'Absence & Late Deduction')]: r.it.absenceDeduction + r.it.lateDeduction,
          [hd('خصم التأمينات (الموظف)', 'Insurance Deduction (Employee)')]: r.it.gosiEmployeeDeduction,
          [hd('مساهمة التأمينات (الشركة)', 'Insurance Contribution (Company)')]: r.it.gosiCompanyContribution,
          [hd('صافي الراتب المستحق', 'Net Payable')]: r.it.netSalary,
          [hd('الحالة', 'Payroll Status')]: payInfo.badgeText,
          [hd('الراتب المستحق حتى تاريخ اليوم', 'Prorated Salary To Date')]: r.proratedSalaryToDate,
          [hd('أيام الإجازة خلال الشهر', 'Leave Days Taken')]: r.monthLeavesTaken,
          [hd('رصيد الإجازات السنوي المتبقي', 'Remaining Annual Leave')]: r.leaveBal.remainingAnnualBalance !== undefined ? r.leaveBal.remainingAnnualBalance : (r.leaveBal.remainingDays || 0),
          [hd('إجمالي السلف المتبقية', 'Remaining Loans Total')]: r.remainingLoanTotal,
        }));
        exportToXLSX(`Audit_Report_${reportMonth}`, (isEn ? `Audit_Report_${reportMonth}` : `تقرير_التدقيق_${reportMonth}`), exportData);
      });

    // ==========================================
    // 2. MONTH COMPARISON & GOSI TOTALS (Requirement 9)
    // ==========================================
    } else if (activeReportType === 'comparison') {
      const batchPrev = getStoredMonthlyPayroll(prevMonth);
      const batchNext = getStoredMonthlyPayroll(nextMonth);
      const infoPrev = payrollStatusInfo(batchPrev, prevMonth);
      const infoNext = payrollStatusInfo(batchNext, nextMonth);

      const compareItemsPrev = (batchPrev && batchPrev.items) || [];
      const compareItemsNext = (batchNext && batchNext.items) || [];
      const canCompare = compareItemsPrev.length > 0 && compareItemsNext.length > 0;

      const comparisonRows = canCompare ? employees.map((emp) => {
        const itemPrev = compareItemsPrev.find((x) => x.employeeId === emp.id);
        const itemNext = compareItemsNext.find((x) => x.employeeId === emp.id);

        const prevGross = itemPrev ? itemPrev.grossSalary : 0;
        const nextGross = itemNext ? itemNext.grossSalary : 0;
        const prevNet = itemPrev ? itemPrev.netSalary : 0;
        const nextNet = itemNext ? itemNext.netSalary : 0;
        const diffNet = nextNet - prevNet;

        // GOSI contributions
        const prevGosi = itemPrev ? (itemPrev.gosiEmployeeDeduction + itemPrev.gosiCompanyContribution) : 0;
        const nextGosi = itemNext ? (itemNext.gosiEmployeeDeduction + itemNext.gosiCompanyContribution) : 0;

        // Determine specific variance reasons
        const reasons = [];
        if (!itemPrev && itemNext) {
          reasons.push(isEn ? 'New hire joined this month' : 'موظف جديد التحق بالعمل هذا الشهر');
        } else if (itemPrev && !itemNext) {
          reasons.push(isEn ? 'Employee terminated or resigned' : 'موظف تم إنهاء خدماته / استقال');
        } else if (itemPrev && itemNext) {
          // Basic salary difference
          if (itemNext.basicSalary !== itemPrev.basicSalary) {
            const d = itemNext.basicSalary - itemPrev.basicSalary;
            reasons.push(`${isEn ? 'Basic Salary change' : 'تعديل راتب أساسي'} (${d > 0 ? '+' : ''}${formatCurrency(d, sym)})`);
          }
          // Overtime difference
          if (itemNext.overtimeAmount !== itemPrev.overtimeAmount) {
            const d = itemNext.overtimeAmount - itemPrev.overtimeAmount;
            reasons.push(`${isEn ? 'Overtime diff' : 'فارق عمل إضافي'} (${d > 0 ? '+' : ''}${formatCurrency(d, sym)})`);
          }
          // Loan installment difference
          if (itemNext.loanInstallment !== itemPrev.loanInstallment) {
            const d = itemNext.loanInstallment - itemPrev.loanInstallment;
            reasons.push(`${isEn ? 'Loan installment diff' : 'فارق قسط سلفة'} (${d > 0 ? '-' : '+'}${formatCurrency(Math.abs(d), sym)})`);
          }
          // Absence difference
          const prevAbs = itemPrev.absenceDeduction + itemPrev.lateDeduction;
          const nextAbs = itemNext.absenceDeduction + itemNext.lateDeduction;
          if (nextAbs !== prevAbs) {
            const d = nextAbs - prevAbs;
            reasons.push(`${isEn ? 'Absence/penalty diff' : 'فارق خصم غياب/تأخير'} (${d > 0 ? '-' : '+'}${formatCurrency(Math.abs(d), sym)})`);
          }
          // Allowances difference
          const prevAllow = itemPrev.housingAllowance + itemPrev.transportAllowance + itemPrev.otherAllowances;
          const nextAllow = itemNext.housingAllowance + itemNext.transportAllowance + itemNext.otherAllowances;
          if (nextAllow !== prevAllow) {
            const d = nextAllow - prevAllow;
            reasons.push(`${isEn ? 'Allowance change' : 'تعديل في البدلات'} (${d > 0 ? '+' : ''}${formatCurrency(d, sym)})`);
          }
        }

        const reasonText = reasons.length > 0 ? reasons.join(' • ') : (isEn ? 'No variance in pay items' : 'لا يوجد تغيير في الراتب والبنود');

        return {
          emp,
          itemPrev,
          itemNext,
          prevGross,
          nextGross,
          prevNet,
          nextNet,
          diffNet,
          prevGosi,
          nextGosi,
          reasonText,
        };
      }) : [];

      // Totals always come from the STORED batch totals (never recomputed).
      const totalPrevGross = batchPrev ? (Number(batchPrev.totalGross) || 0) : 0;
      const totalNextGross = batchNext ? (Number(batchNext.totalGross) || 0) : 0;
      const totalPrevNet = batchPrev ? (Number(batchPrev.totalNet) || 0) : 0;
      const totalNextNet = batchNext ? (Number(batchNext.totalNet) || 0) : 0;
      const totalDiff = totalNextNet - totalPrevNet;
      const canShowTotals = !!batchPrev && !!batchNext;

      // GOSI Totals across all employees for comparison
      const totalPrevGosiEmp = compareItemsPrev.reduce((s, x) => s + (x.gosiEmployeeDeduction || 0), 0);
      const totalNextGosiEmp = compareItemsNext.reduce((s, x) => s + (x.gosiEmployeeDeduction || 0), 0);
      const totalPrevGosiComp = batchPrev ? (Number(batchPrev.totalCompanyGosi) || 0) : 0;
      const totalNextGosiComp = batchNext ? (Number(batchNext.totalCompanyGosi) || 0) : 0;
      const totalGrandGosiPrev = totalPrevGosiEmp + totalPrevGosiComp;
      const totalGrandGosiNext = totalNextGosiEmp + totalNextGosiComp;

      reportArea.innerHTML = `
        <div class="card" style="padding:20px; margin-bottom:20px; background:var(--bg-card-hover); border:1px solid var(--border-color);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
              <h3 style="font-size:17px; font-weight:800; color:var(--text-main);">${t('reports.monthComparisonTitle')}</h3>
              <p style="font-size:12.5px; color:var(--text-muted); margin-top:2px;">
                ${isEn ? 'Detailed variance analysis between two stored & disbursed payrolls' : 'مقارنة شاملة بين شهرين من المسيرات المخزنة الفعلية فقط، مع مجاميع التأمينات الاجتماعية'}
              </p>
            </div>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <div style="display:flex; align-items:center; gap:6px;">
                <label style="font-size:12px; font-weight:700;">${t('reports.previousMonth')}</label>
                <input type="month" class="form-input" id="comp-prev-month" value="${prevMonth}" style="width:150px; padding:6px 10px;">
              </div>
              <div style="display:flex; align-items:center; gap:6px;">
                <label style="font-size:12px; font-weight:700;">${t('reports.comparisonMonth')}</label>
                <input type="month" class="form-input" id="comp-next-month" value="${nextMonth}" style="width:150px; padding:6px 10px;">
              </div>
              <button type="button" class="btn btn-outline" id="btn-export-comparison-xlsx" ${!canCompare ? 'disabled' : ''}>
                ${Icons.download(16)} ${isEn ? 'Export Excel' : 'تصدير Excel'}
              </button>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:10px;">
            <span class="badge ${infoPrev.badge}" style="font-size:12px;">${prevMonth}: ${infoPrev.badgeText}</span>
            <span class="badge ${infoNext.badge}" style="font-size:12px;">${nextMonth}: ${infoNext.badgeText}</span>
          </div>
        </div>

        ${monthAlertHtml(infoPrev.bannerType === 'danger' ? 'warning' : infoPrev.bannerType, infoPrev.bannerTitle, isEn ? `Previous month: ${infoPrev.bannerText}` : `الشهر السابق: ${infoPrev.bannerText}`)}
        ${monthAlertHtml(infoNext.bannerType === 'danger' ? 'warning' : infoNext.bannerType, infoNext.bannerTitle, isEn ? `Comparison month: ${infoNext.bannerText}` : `شهر المقارنة: ${infoNext.bannerText}`)}

        ${!canShowTotals ? `
        <div class="card" style="padding:20px; text-align:center; margin-bottom:20px;">
          <div style="font-size:32px; margin-bottom:8px;">📊</div>
          <div style="font-weight:800; font-size:15px; color:var(--text-main);">
            ${isEn ? 'Comparison requires both months to have a stored payroll' : 'المقارنة تتطلب وجود مسير مخزن للشهرين'}
          </div>
          <div style="font-size:12.5px; color:var(--text-muted); margin-top:6px; line-height:1.7;">
            ${isEn
              ? 'The system never fabricates payroll figures. Select two months with a stored & disbursed payroll to see the variance analysis.'
              : 'النظام لا يولّد أرقام رواتب وهمية إطلاقاً. اختر شهرين يحتويان على مسير محفوظ ومصروف لعرض تحليل الفروق.'}
          </div>
        </div>
        ` : ''}

        <!-- Comparison KPI Cards -->
        <div class="grid grid-cols-4" style="margin-bottom:20px;">
          <div class="card" style="padding:16px;">
            <div style="font-size:12px; color:var(--text-muted);">${tf('reports.previousMonthPayroll', { month: prevMonth })}</div>
            <div style="font-size:20px; font-weight:900; color:${infoPrev.paid ? 'var(--text-main)' : 'var(--text-muted)'}; margin-top:4px;">${formatCurrency(totalPrevNet, sym)}</div>
            <div style="font-size:11px; color:var(--text-muted);">${isEn ? 'Gross' : 'الإجمالي'}: ${formatCurrency(totalPrevGross, sym)} · ${infoPrev.badgeText}</div>
          </div>

          <div class="card" style="padding:16px;">
            <div style="font-size:12px; color:var(--text-muted);">${tf('reports.comparisonMonthPayroll', { month: nextMonth })}</div>
            <div style="font-size:20px; font-weight:900; color:${infoNext.paid ? 'var(--primary)' : 'var(--text-muted)'}; margin-top:4px;">${formatCurrency(totalNextNet, sym)}</div>
            <div style="font-size:11px; color:var(--text-muted);">${isEn ? 'Gross' : 'الإجمالي'}: ${formatCurrency(totalNextGross, sym)} · ${infoNext.badgeText}</div>
          </div>

          <div class="card" style="padding:16px;">
            <div style="font-size:12px; color:var(--text-muted);">${t('reports.netDifference')}</div>
            <div style="font-size:20px; font-weight:900; color:${canShowTotals ? (totalDiff >= 0 ? 'var(--success)' : 'var(--danger)') : 'var(--text-muted)'}; margin-top:4px;">
              ${canShowTotals ? (totalDiff >= 0 ? '+' : '') + formatCurrency(totalDiff, sym) : (isEn ? '—' : '—')}
            </div>
            <div style="font-size:11px; color:var(--text-muted);">${canShowTotals ? (totalDiff >= 0 ? (isEn ? 'Net increase' : 'زيادة في الرواتب') : (isEn ? 'Net decrease' : 'نقصان في الرواتب')) : (isEn ? 'Both months must be stored' : 'يلزم وجود المسيرين')}</div>
          </div>

          <!-- Total Social Security Summary Card -->
          <div class="card" style="padding:16px; background:linear-gradient(135deg, rgba(6,182,212,0.06) 0%, rgba(79,70,229,0.06) 100%);">
            <div style="font-size:12px; color:var(--text-muted);">${isEn ? 'Total Social Security' : 'إجمالي اشتراك التأمينات الاجتماعية'}</div>
            <div style="font-size:20px; font-weight:900; color:var(--info); margin-top:4px;">${formatCurrency(totalGrandGosiNext, sym)}</div>
            <div style="font-size:11px; color:var(--text-muted);">
              ${isEn ? 'Emp' : 'الموظف'}: ${formatCurrency(totalNextGosiEmp, sym)} • ${isEn ? 'Co' : 'الشركة'}: ${formatCurrency(totalNextGosiComp, sym)}
            </div>
          </div>
        </div>

        ${canCompare ? `
        <!-- Comparison Table -->
        <div class="card" style="padding:0; overflow:hidden;">
          <div class="table-container" style="border:none;">
            <table class="table" style="font-size:12.5px;">
              <thead>
                <tr>
                  <th>${t('reports.employee')}</th>
                  <th>${t('reports.department')}</th>
                  <th>${tf('reports.netMonth', { month: prevMonth })}</th>
                  <th>${tf('reports.netMonth', { month: nextMonth })}</th>
                  <th>${t('reports.variance')}</th>
                  <th>${isEn ? 'Social Security (Employee + Company)' : 'التأمينات الاجتماعية (موظف + شركة)'}</th>
                  <th>${t('reports.varianceReason')}</th>
                </tr>
              </thead>
              <tbody>
                ${comparisonRows
                  .map((row) => {
                    const diffColor = row.diffNet > 0 ? 'var(--success)' : row.diffNet < 0 ? 'var(--danger)' : 'var(--text-muted)';
                    const diffSign = row.diffNet > 0 ? '+' : '';
                    return `
                    <tr>
                      <td>
                        <strong>${row.emp.fullName}</strong>
                        <div style="font-size:11px; color:var(--text-muted);">${row.emp.employeeNumber}</div>
                      </td>
                      <td>${row.emp.department}</td>
                      <td><strong>${formatCurrency(row.prevNet, sym)}</strong></td>
                      <td><strong>${formatCurrency(row.nextNet, sym)}</strong></td>
                      <td><strong style="color:${diffColor}; font-size:14px;">${diffSign}${formatCurrency(row.diffNet, sym)}</strong></td>
                      <td>
                        <strong>${formatCurrency(row.nextGosi, sym)}</strong>
                        <div style="font-size:10.5px; color:var(--text-muted);">${row.itemNext ? `${isEn ? 'Emp' : 'موظف'}: ${formatCurrency(row.itemNext.gosiEmployeeDeduction, sym)} | ${isEn ? 'Co' : 'شركة'}: ${formatCurrency(row.itemNext.gosiCompanyContribution, sym)}` : '-'}</div>
                      </td>
                      <td>
                        <span style="font-size:12px; color:var(--text-main); line-height:1.4;">${row.reasonText}</span>
                      </td>
                    </tr>
                  `;
                  })
                  .join('')}
              </tbody>
              <tfoot>
                <tr style="background:var(--bg-card-hover); font-weight:800;">
                  <td colspan="2">${t('reports.grandTotal')}</td>
                  <td>${formatCurrency(totalPrevNet, sym)}</td>
                  <td>${formatCurrency(totalNextNet, sym)}</td>
                  <td style="color:${totalDiff >= 0 ? 'var(--success)' : 'var(--danger)'};">${totalDiff >= 0 ? '+' : ''}${formatCurrency(totalDiff, sym)}</td>
                  <td>${formatCurrency(totalGrandGosiNext, sym)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        ` : ''}
      `;

      reportArea.querySelector('#comp-prev-month')?.addEventListener('change', (e) => {
        prevMonth = e.target.value;
        renderReportContent();
      });

      reportArea.querySelector('#comp-next-month')?.addEventListener('change', (e) => {
        nextMonth = e.target.value;
        renderReportContent();
      });

      reportArea.querySelector('#btn-export-comparison-xlsx')?.addEventListener('click', () => {
        if (!can(storage.getActiveUser(), 'reports.export')) { // RBAC gate (C-5)
          toast.error(isEn ? 'Insufficient permissions' : 'لا تملك صلاحية التصدير');
          return;
        }
        const exportData = comparisonRows.map((r) => ({
          [hd('الرقم الوظيفي', 'Employee ID')]: r.emp.employeeNumber,
          [hd('اسم الموظف', 'Employee Name')]: r.emp.fullName,
          [hd('القسم', 'Department')]: r.emp.department,
          [hd(`صافي شهر ${prevMonth}`, `Net of ${prevMonth}`)]: r.prevNet,
          [hd(`صافي شهر ${nextMonth}`, `Net of ${nextMonth}`)]: r.nextNet,
          [hd('قيمة الفارق', 'Difference')]: r.diffNet,
          [hd('إجمالي التأمينات الاجتماعية', 'Total Social Insurance')]: r.nextGosi,
          [hd('سبب الفرق بالتفصيل', 'Detailed Reason')]: r.reasonText,
        }));
        exportToXLSX(`Month_Comparison_${prevMonth}_vs_${nextMonth}`, (isEn ? `Month_Comparison_${prevMonth}_vs_${nextMonth}` : `مقارنة_${prevMonth}_مع_${nextMonth}`), exportData);
      });

    // ==========================================
    // 3. PAYROLL REPORT
    // ==========================================
    } else if (activeReportType === 'payroll') {
      const storedBatch = getStoredMonthlyPayroll(reportMonth);
      const payInfo = payrollStatusInfo(storedBatch, reportMonth);
      const payrollItems = (storedBatch ? storedBatch.items : []) || [];

      reportArea.innerHTML = `
        <div class="card" style="padding:20px; margin-bottom:20px; background:var(--bg-card-hover);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <h3 style="font-size:16px; font-weight:800; color:var(--text-main);">${tf('reports.payrollDetailTitle', { month: reportMonth })}</h3>
                ${storedBatch ? `<span class="badge ${payInfo.badge}" style="font-size:12px;">${payInfo.badgeText}</span>` : ''}
              </div>
              <p style="font-size:12.5px; color:var(--text-muted);">${t('reports.payrollDetailSubtitle')}</p>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <input type="month" class="form-input" id="report-month-input" value="${reportMonth}" style="width:160px; padding:6px 10px; font-weight:700;">
              <button type="button" class="btn btn-outline btn-sm" id="btn-export-rep-payroll" ${payrollItems.length === 0 ? 'disabled' : ''}>
                ${Icons.download(14)} ${isEn ? 'Export Excel' : 'تصدير Excel'}
              </button>
              <button type="button" class="btn btn-primary btn-sm" onclick="window.print()">
                ${Icons.printer(14)} ${isEn ? 'Print Report' : 'طباعة التقرير'}
              </button>
            </div>
          </div>
        </div>

        ${monthAlertHtml(payInfo.bannerType, payInfo.bannerTitle, payInfo.bannerText)}

        ${storedBatch && storedBatch.items && storedBatch.items.length === 0 ? `
        <div class="card" style="padding:20px; text-align:center;">
          <div style="font-size:32px; margin-bottom:8px;">📁</div>
          <div style="font-weight:800; font-size:15px; color:var(--text-main);">
            ${isEn ? 'No per-employee items in the stored batch for this month' : 'لا توجد بنود لكل موظف في المسير المخزن لهذا الشهر'}
          </div>
          <div style="font-size:12.5px; color:var(--text-muted); margin-top:6px; line-height:1.7;">
            ${isEn ? 'Legacy/archived entry — only batch totals are stored.' : 'إدخال سابق/مؤرشف — يتم تخزين إجماليات المسير فقط.'}
          </div>
        </div>
        ` : ''}

        ${payrollItems.length > 0 ? `
        <div class="card" style="padding:0; overflow:hidden;">
          <div class="table-container" style="border:none;">
            <table class="table">
              <thead>
                <tr>
                  <th>${t('payroll.employee')}</th>
                  <th>${t('payroll.basicSalary')}</th>
                  <th>${t('payroll.housing')}</th>
                  <th>${t('payroll.transport')}</th>
                  <th>${t('payroll.overtime')}</th>
                  <th>${t('payroll.totalEarnings')}</th>
                  <th>${isEn ? 'Social Security' : 'تأمينات'}</th>
                  <th>${isEn ? 'Loan Advance' : 'سلفة'}</th>
                  <th>${isEn ? 'Absence/Late' : 'خصم غياب'}</th>
                  <th>${t('payroll.netSalaryTransferred')}</th>
                </tr>
              </thead>
              <tbody>
                ${payrollItems
                  .map(
                    (it) => `
                  <tr>
                    <td><strong>${it.employeeName}</strong></td>
                    <td>${formatCurrency(it.basicSalary, sym)}</td>
                    <td>${formatCurrency(it.housingAllowance, sym)}</td>
                    <td>${formatCurrency(it.transportAllowance, sym)}</td>
                    <td>${it.overtimeAmount > 0 ? formatCurrency(it.overtimeAmount, sym) : '-'}</td>
                    <td><strong>${formatCurrency(it.grossSalary, sym)}</strong></td>
                    <td><span style="color:var(--danger);">- ${formatCurrency(it.gosiEmployeeDeduction, sym)}</span></td>
                    <td style="color:var(--warning);">${it.loanInstallment > 0 ? '- ' + formatCurrency(it.loanInstallment, sym) : '-'}</td>
                    <td style="color:var(--danger);">${it.absenceDeduction + it.lateDeduction > 0 ? '- ' + formatCurrency(it.absenceDeduction + it.lateDeduction, sym) : '-'}</td>
                    <td><strong style="color:var(--success); font-size:14px;">${formatCurrency(it.netSalary, sym)}</strong></td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
              <tfoot>
                <tr style="background:var(--bg-card-hover); font-weight:800;">
                  <td colspan="5">${t('reports.overallTotal')}</td>
                  <td>${formatCurrency(storedBatch.totalGross, sym)}</td>
                  <td colspan="3" style="color:var(--danger);">- ${formatCurrency(storedBatch.totalDeductions, sym)}</td>
                  <td style="color:var(--success); font-size:16px;">${formatCurrency(storedBatch.totalNet, sym)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        ` : ''}
      `;

      reportArea.querySelector('#report-month-input')?.addEventListener('change', (e) => {
        reportMonth = e.target.value;
        renderReportContent();
      });

      reportArea.querySelector('#btn-export-rep-payroll')?.addEventListener('click', () => {
        if (!can(storage.getActiveUser(), 'reports.export')) { // RBAC gate (C-5)
          toast.error(isEn ? 'Insufficient permissions' : 'لا تملك صلاحية التصدير');
          return;
        }
        if (payrollItems.length === 0) {
          toast.info(isEn ? 'No stored payroll rows for this month to export.' : 'لا توجد صفوف مسير مخزنة لهذا الشهر للتصدير.');
          return;
        }
        const exportData = payrollItems.map((it) => ({
          [hd('الموظف', 'Employee')]: it.employeeName,
          [hd('القسم', 'Department')]: it.department,
          [hd('الأساسي', 'Basic')]: it.basicSalary,
          [hd('بدل السكن', 'Housing')]: it.housingAllowance,
          [hd('بدل النقل', 'Transport')]: it.transportAllowance,
          [hd('الإضافي', 'Overtime')]: it.overtimeAmount,
          [hd('إجمالي الراتب', 'Gross')]: it.grossSalary,
          [hd('التأمينات (الموظف)', 'Insurance (Employee)')]: it.gosiEmployeeDeduction,
          [hd('قسط السلفة', 'Loan Installment')]: it.loanInstallment,
          [hd('خصم غياب', 'Absence Deduction')]: it.absenceDeduction + it.lateDeduction,
          [hd('صافي الراتب', 'Net Salary')]: it.netSalary,
        }));
        exportToXLSX(`Payroll_Report_${reportMonth}`, (isEn ? `Payroll_Report_${reportMonth}` : `رواتب_${reportMonth}`), exportData);
      });

    // ==========================================
    // 4. GOSI REPORT
    // ==========================================
    } else if (activeReportType === 'gosi') {
      const activeEmps = employees.filter((e) => e.status === 'active' || e.status === 'probation');
      
      const gosiRows = activeEmps.map((emp) => {
        const isSubject = emp.isSubjectToGosi !== false;
        const regWage = isSubject ? (Number(emp.gosiRegisteredWage) || ((Number(emp.basicSalary) || 0) + (Number(emp.housingAllowance) || 0))) : 0;
        const empPct = isSubject ? (Number(emp.gosiEmployeePercent) || (Number(settings.socialInsuranceEmployeePercent) !== undefined ? Number(settings.socialInsuranceEmployeePercent) : (Number(settings.gosiEmployeePercent) || 0))) : 0;
        const compPct = isSubject ? (Number(emp.gosiCompanyPercent) || (Number(settings.socialInsuranceCompanyPercent) !== undefined ? Number(settings.socialInsuranceCompanyPercent) : (Number(settings.gosiCompanyPercent) || 0))) : 0;
        
        const empDeduction = parseFloat(((regWage * empPct) / 100).toFixed(2));
        const compContribution = parseFloat(((regWage * compPct) / 100).toFixed(2));
        const totalContribution = parseFloat((empDeduction + compContribution).toFixed(2));

        return {
          emp,
          isSubject,
          regWage,
          empPct,
          compPct,
          empDeduction,
          compContribution,
          totalContribution,
        };
      });

      const totalRegWage = gosiRows.reduce((s, r) => s + r.regWage, 0);
      const totalEmpDeduction = gosiRows.reduce((s, r) => s + r.empDeduction, 0);
      const totalCompContribution = gosiRows.reduce((s, r) => s + r.compContribution, 0);
      const grandTotalGosi = gosiRows.reduce((s, r) => s + r.totalContribution, 0);

      reportArea.innerHTML = `
        <div class="card" style="padding:20px; margin-bottom:20px; background:var(--bg-card-hover);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
              <h3 style="font-size:16px; font-weight:800; color:var(--text-main);">${t('reports.gosiTitle')}</h3>
              <p style="font-size:12.5px; color:var(--text-muted);">${t('reports.gosiSubtitle')}</p>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <button type="button" class="btn btn-outline btn-sm" id="btn-export-rep-gosi">
                ${Icons.download(14)} ${isEn ? 'Export Excel' : 'تصدير Excel'}
              </button>
              <button type="button" class="btn btn-primary btn-sm" onclick="window.print()">
                ${Icons.printer(14)} ${isEn ? 'Print' : 'طباعة'}
              </button>
            </div>
          </div>
        </div>

        <div class="card" style="padding:0; overflow:hidden;">
          <div class="table-container" style="border:none;">
            <table class="table">
              <thead>
                <tr>
                  <th>${t('leaves.employee')}</th>
                  <th>${t('leaves.department')}</th>
                  <th>${t('reports.registeredWage')}</th>
                  <th>${t('reports.employeeRate')}</th>
                  <th>${t('reports.employeeDeduction')}</th>
                  <th>${t('reports.companyRate')}</th>
                  <th>${t('reports.companyContribution')}</th>
                  <th>${t('reports.totalContribution')}</th>
                </tr>
              </thead>
              <tbody>
                ${gosiRows
                  .map(
                    (r) => `
                  <tr>
                    <td><strong>${r.emp.fullName}</strong></td>
                    <td>${r.emp.department}</td>
                    <td>${r.isSubject ? formatCurrency(r.regWage, sym) : `<span class="badge badge-gray">${t('reports.notSubject')}</span>`}</td>
                    <td>${r.isSubject ? r.empPct + '%' : '-'}</td>
                    <td><strong style="color:var(--danger);">${r.isSubject ? formatCurrency(r.empDeduction, sym) : '-'}</strong></td>
                    <td>${r.isSubject ? r.compPct + '%' : '-'}</td>
                    <td><strong style="color:var(--info);">${r.isSubject ? formatCurrency(r.compContribution, sym) : '-'}</strong></td>
                    <td><strong style="color:var(--primary); font-size:13.5px;">${r.isSubject ? formatCurrency(r.totalContribution, sym) : '-'}</strong></td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
              <tfoot>
                <tr style="background:var(--bg-card-hover); font-weight:800;">
                  <td colspan="2">${t('reports.overallTotal')}</td>
                  <td>${formatCurrency(totalRegWage, sym)}</td>
                  <td>-</td>
                  <td style="color:var(--danger);">${formatCurrency(totalEmpDeduction, sym)}</td>
                  <td>-</td>
                  <td style="color:var(--info);">${formatCurrency(totalCompContribution, sym)}</td>
                  <td style="color:var(--primary); font-size:15px;">${formatCurrency(grandTotalGosi, sym)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      `;

      reportArea.querySelector('#btn-export-rep-gosi')?.addEventListener('click', () => {
        const exportData = gosiRows.map((r) => ({
          [isEn ? 'Employee' : 'الموظف']: r.emp.fullName,
          [isEn ? 'Department' : 'القسم']: r.emp.department,
          [isEn ? 'Registered Wage' : 'الأجر المسجل']: r.regWage,
          [isEn ? 'Employee %' : 'نسبة الموظف %']: r.empPct,
          [isEn ? 'Employee Deduction' : 'استقطاع الموظف']: r.empDeduction,
          [isEn ? 'Company %' : 'نسبة الشركة %']: r.compPct,
          [isEn ? 'Company Share' : 'مساهمة الشركة']: r.compContribution,
          [isEn ? 'Total Monthly Contribution' : 'إجمالي الاشتراك الشهري']: r.totalContribution,
        }));
        exportToXLSX(`SocialSecurity_Report`, isEn ? 'SocialSecurity_Report' : 'تقرير_التأمينات_الاجتماعية', exportData);
      });

    // ==========================================
    // 5. LEAVES REPORT
    // ==========================================
    } else if (activeReportType === 'leaves') {
      const year = new Date().getFullYear();
      const rows = employees.map((emp) => {
        const bal = calculateLeaveBalance(emp, leaves, new Date(), settings);
        return { emp, bal };
      });

      reportArea.innerHTML = `
        <div class="card" style="padding:20px; margin-bottom:20px; background:var(--bg-card-hover);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
              <h3 style="font-size:16px; font-weight:800; color:var(--text-main);">${tf('reports.annualLeaveTitle', { year })}</h3>
              <p style="font-size:12.5px; color:var(--text-muted);">${t('reports.annualLeaveSubtitle')}</p>
            </div>
            <button type="button" class="btn btn-outline btn-sm" id="btn-export-rep-leaves">
              ${Icons.download(14)} ${isEn ? 'Export Excel' : 'تصدير Excel'}
            </button>
          </div>
        </div>

        <div class="card" style="padding:0; overflow:hidden;">
          <div class="table-container" style="border:none;">
            <table class="table">
              <thead>
                <tr>
                  <th>${t('leaves.employee')}</th>
                  <th>${t('leaves.department')}</th>
                  <th>${t('reports.annualEntitlement')}</th>
                  <th>${t('reports.carriedBalance')}</th>
                  <th>${t('reports.totalAvailable')}</th>
                  <th>${t('reports.used')}</th>
                  <th>${t('leaves.remainingBalance')}</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (r) => `
                  <tr>
                    <td><strong>${r.emp.fullName}</strong></td>
                    <td>${r.emp.department}</td>
                    <td>${r.bal.annualEntitlement} ${isEn ? 'days' : 'يوم'}</td>
                    <td>${r.bal.carriedOver} ${isEn ? 'days' : 'يوم'}</td>
                    <td><strong>${r.bal.totalAvailable} ${isEn ? 'days' : 'يوم'}</strong></td>
                    <td><span style="color:var(--danger);">${r.bal.usedAnnualDays} ${isEn ? 'days' : 'يوم'}</span></td>
                    <td><strong style="color:var(--success); font-size:14px;">${r.bal.remainingAnnualBalance} ${isEn ? 'days' : 'يوم'}</strong></td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      reportArea.querySelector('#btn-export-rep-leaves')?.addEventListener('click', () => {
        if (!can(storage.getActiveUser(), 'reports.export')) { // RBAC gate (C-5)
          toast.error(isEn ? 'Insufficient permissions' : 'لا تملك صلاحية التصدير');
          return;
        }
        const exportData = rows.map((r) => ({
          [hd('الرقم الوظيفي', 'Employee ID')]: r.emp.employeeNumber,
          [hd('اسم الموظف', 'Employee Name')]: r.emp.fullName,
          [hd('القسم', 'Department')]: r.emp.department,
          [hd('الاستحقاق السنوي', 'Annual Entitlement')]: r.bal.annualEntitlement,
          [hd('الرصيد المرحل', 'Carried Over')]: r.bal.carriedOver,
          [hd('الإجمالي المتاح', 'Total Available')]: r.bal.totalAvailable,
          [hd('المستهلك', 'Used')]: r.bal.usedAnnualDays,
          [hd('الرصيد المتبقي', 'Remaining')]: r.bal.remainingAnnualBalance,
        }));
        exportToXLSX(`Leaves_Report_${year}`, (isEn ? `Leaves_Report_${year}` : `أرصدة_الإجازات_${year}`), exportData);
      });

    // ==========================================
    // 6. OVERTIME REPORT
    // ==========================================
    } else if (activeReportType === 'overtime') {
      const monthOt = overtime.filter((o) => (o.date || '').startsWith(reportMonth));

      reportArea.innerHTML = `
        <div class="card" style="padding:20px; margin-bottom:20px; background:var(--bg-card-hover);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
              <h3 style="font-size:16px; font-weight:800; color:var(--text-main);">${tf('reports.overtimeTitle', { month: reportMonth })}</h3>
              <p style="font-size:12.5px; color:var(--text-muted);">${t('reports.overtimeSubtitle')}</p>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <input type="month" class="form-input" id="report-month-input" value="${reportMonth}" style="width:160px; padding:6px 10px;">
              <button type="button" class="btn btn-outline btn-sm" id="btn-export-rep-ot">
                ${Icons.download(14)} ${isEn ? 'Export Excel' : 'تصدير Excel'}
              </button>
            </div>
          </div>
        </div>

        <div class="card" style="padding:0; overflow:hidden;">
          <div class="table-container" style="border:none;">
            <table class="table">
              <thead>
                <tr>
                  <th>${t('leaves.employee')}</th>
                  <th>${t('reports.date')}</th>
                  <th>${t('reports.hours')}</th>
                  <th>${t('reports.multiplier')}</th>
                  <th>${t('reports.calculatedAmount')}</th>
                  <th>${t('reports.reason')}</th>
                  <th>${t('reports.status')}</th>
                </tr>
              </thead>
              <tbody>
                ${
                  monthOt.length === 0
                    ? `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">${t('reports.noOvertime')}</td></tr>`
                    : monthOt
                        .map((ot) => {
                          const emp = employees.find((e) => e.id === ot.employeeId);
                          return `
                      <tr>
                        <td><strong>${emp ? emp.fullName : t('reports.unknown')}</strong></td>
                        <td>${formatDate(ot.date)}</td>
                        <td>${ot.hours ?? 0} ${isEn ? 'hrs' : 'ساعة'}</td>
                        <td>${(ot.multiplier ?? ot.rateMultiplier ?? 1.5)}x</td>
                        <td><strong>${formatCurrency(ot.totalAmount ?? ot.calculatedAmount, sym)}</strong></td>
                        <td>${ot.reason || '-'}</td>
                        <td><span class="badge ${ot.status === 'approved' ? 'badge-success' : 'badge-warning'}">${ot.status === 'approved' ? t('reports.approved') : t('reports.pending')}</span></td>
                      </tr>
                    `;
                        })
                        .join('')
                }
              </tbody>
            </table>
          </div>
        </div>
      `;

      reportArea.querySelector('#report-month-input')?.addEventListener('change', (e) => {
        reportMonth = e.target.value;
        renderReportContent();
      });

      reportArea.querySelector('#btn-export-rep-ot')?.addEventListener('click', () => {
        if (!can(storage.getActiveUser(), 'reports.export')) { // RBAC gate (C-5)
          toast.error(isEn ? 'Insufficient permissions' : 'لا تملك صلاحية التصدير');
          return;
        }
        const exportData = monthOt.map((ot) => {
          const emp = employees.find((e) => e.id === ot.employeeId);
          return {
            [isEn ? 'Employee' : 'الموظف']: emp ? emp.fullName : '-',
            [isEn ? 'Date' : 'التاريخ']: ot.date,
            [isEn ? 'Hours' : 'الساعات']: ot.hours ?? 0,
            [isEn ? 'Multiplier' : 'المعامل']: ot.multiplier ?? ot.rateMultiplier ?? 1.5,
            [isEn ? 'Amount' : 'المبلغ']: ot.totalAmount ?? ot.calculatedAmount,
            [isEn ? 'Reason' : 'السبب']: ot.reason,
            [isEn ? 'Status' : 'الحالة']: ot.status,
          };
        });
        exportToXLSX(`Overtime_Report_${reportMonth}`, (isEn ? `Overtime_Report_${reportMonth}` : `العمل_الإضافي_${reportMonth}`), exportData);
      });

    // ==========================================
    // 7. EOSB REPORT
    // ==========================================
    } else if (activeReportType === 'eosb') {
      reportArea.innerHTML = `
        <div class="card" style="padding:20px; margin-bottom:20px; background:var(--bg-card-hover);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
              <h3 style="font-size:16px; font-weight:800; color:var(--text-main);">${t('reports.eosbTitle')}</h3>
              <p style="font-size:12.5px; color:var(--text-muted);">${t('reports.eosbSubtitle')}</p>
            </div>
            <button type="button" class="btn btn-outline btn-sm" id="btn-export-rep-eosb">
              ${Icons.download(14)} ${isEn ? 'Export Excel' : 'تصدير Excel'}
            </button>
          </div>
        </div>

        <div class="card" style="padding:0; overflow:hidden;">
          <div class="table-container" style="border:none;">
            <table class="table">
              <thead>
                <tr>
                  <th>${t('leaves.employee')}</th>
                  <th>${t('leaves.department')}</th>
                  <th>${t('reports.hireDate')}</th>
                  <th>${t('reports.terminationDate')}</th>
                  <th>${t('reports.servicePeriod')}</th>
                  <th>${t('reports.eosbAward')}</th>
                  <th>${t('reports.leaveCashout')}</th>
                  <th>${t('reports.netSettlement')}</th>
                </tr>
              </thead>
              <tbody>
                ${
                  eosb.length === 0
                    ? `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">${t('reports.noSettlements')}</td></tr>`
                    : eosb
                        .map(
                          (item) => `
                      <tr>
                        <td><strong>${item.employeeName}</strong></td>
                        <td>${item.department}</td>
                        <td>${formatDate(item.hireDate)}</td>
                        <td>${formatDate(item.terminationDate)}</td>
                        <td>${tf('reports.serviceDuration', { years: item.serviceYears, months: item.serviceMonths })}</td>
                        <td>${formatCurrency(item.finalEOSBAmount, sym)}</td>
                        <td>${formatCurrency(item.leaveCompensationAmount, sym)}</td>
                        <td><strong style="color:var(--success); font-size:14px;">${formatCurrency(item.netSettlementAmount, sym)}</strong></td>
                      </tr>
                    `
                        )
                        .join('')
                }
              </tbody>
            </table>
          </div>
        </div>
      `;

      reportArea.querySelector('#btn-export-rep-eosb')?.addEventListener('click', () => {
        if (!can(storage.getActiveUser(), 'reports.export')) { // RBAC gate (C-5)
          toast.error(isEn ? 'Insufficient permissions' : 'لا تملك صلاحية التصدير');
          return;
        }
        const exportData = eosb.map((r) => ({
          [hd('الموظف', 'Employee')]: r.employeeName,
          [hd('القسم', 'Department')]: r.department,
          [hd('تاريخ التعيين', 'Hire Date')]: r.hireDate,
          [hd('تاريخ الإنهاء', 'Termination Date')]: r.terminationDate,
          [hd('مدة الخدمة', 'Service Duration')]: `${r.serviceYears}Y ${r.serviceMonths}M`,
          [hd('مكافأة نهاية الخدمة', 'EOSB Gratuity')]: r.finalEOSBAmount,
          [hd('بدل رصيد الإجازات', 'Leave Compensation')]: r.leaveCompensationAmount,
          [hd('صافي المخالصة', 'Net Settlement')]: r.netSettlementAmount,
        }));
        exportToXLSX(`EOSB_Settlements_Report`, (isEn ? `EOSB_Settlements_Report` : `نهاية_الخدمة`), exportData);
      });
    }
  }

  container.innerHTML = `
    <!-- Top Header -->
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:20px;">
      <div>
        <h2 style="font-size:20px; font-weight:800; color:var(--text-main);">
          ${isEn ? 'Reports, Audit & Excel Exports' : 'التقارير والتدقيق الشامل وتصدير Excel'}
        </h2>
        <p style="font-size:13px; color:var(--text-muted);">
          ${isEn ? 'Comprehensive financial audit, monthly comparisons, payroll, and social security analytics' : 'تقارير التدقيق المالي، مقارنة الأشهر والفرق، مسير الرواتب، وتأمينات الضمان'}
        </p>
      </div>
    </div>

    <!-- Report Selector Tabs (Hourly Leaves removed) -->
    <div class="tabs-header" style="flex-wrap:wrap; gap:6px;">
      <button type="button" class="tab-btn ${activeReportType === 'audit' ? 'active' : ''}" id="rep-tab-audit">
        ${Icons.shieldCheck(16)} ${isEn ? '🌟 Audit Report' : '🌟 تقرير التدقيق الشامل'}
      </button>
      <button type="button" class="tab-btn ${activeReportType === 'comparison' ? 'active' : ''}" id="rep-tab-comparison">
        ${Icons.trendingUp(16)} ${isEn ? '📈 Month Variance' : '📈 مقارنة الأشهر والفرق'}
      </button>
      <button type="button" class="tab-btn ${activeReportType === 'payroll' ? 'active' : ''}" id="rep-tab-payroll">
        ${Icons.dollar(16)} ${isEn ? 'Payroll Report' : 'تقرير مسير الرواتب'}
      </button>
      <button type="button" class="tab-btn ${activeReportType === 'gosi' ? 'active' : ''}" id="rep-tab-gosi">
        ${Icons.shieldCheck(16)} ${isEn ? 'Social Security Report' : 'تقرير التأمينات والتأمين الاجتماعي'}
      </button>
      <button type="button" class="tab-btn ${activeReportType === 'leaves' ? 'active' : ''}" id="rep-tab-leaves">
        ${Icons.calendar(16)} ${isEn ? 'Leave Balances' : 'تقرير أرصدة الإجازات'}
      </button>
      <button type="button" class="tab-btn ${activeReportType === 'overtime' ? 'active' : ''}" id="rep-tab-ot">
        ${Icons.clock(16)} ${isEn ? 'Overtime Report' : 'تقرير العمل الإضافي'}
      </button>
      <button type="button" class="tab-btn ${activeReportType === 'eosb' ? 'active' : ''}" id="rep-tab-eosb">
        ${Icons.award(16)} ${isEn ? 'EOSB Report' : 'تقرير نهاية الخدمة'}
      </button>
    </div>

    <!-- Report Container -->
    <div id="report-details-container"></div>
  `;

  // Attach Sub Tab buttons
  const tabAudit = container.querySelector('#rep-tab-audit');
  const tabComparison = container.querySelector('#rep-tab-comparison');
  const tabPayroll = container.querySelector('#rep-tab-payroll');
  const tabGosi = container.querySelector('#rep-tab-gosi');
  const tabLeaves = container.querySelector('#rep-tab-leaves');
  const tabOt = container.querySelector('#rep-tab-ot');
  const tabEosb = container.querySelector('#rep-tab-eosb');

  const updateTabSelection = (type, clickedBtn) => {
    activeReportType = type;
    [tabAudit, tabComparison, tabPayroll, tabGosi, tabLeaves, tabOt, tabEosb].forEach((b) => b?.classList.remove('active'));
    clickedBtn.classList.add('active');
    renderReportContent();
  };

  tabAudit?.addEventListener('click', () => updateTabSelection('audit', tabAudit));
  tabComparison?.addEventListener('click', () => updateTabSelection('comparison', tabComparison));
  tabPayroll?.addEventListener('click', () => updateTabSelection('payroll', tabPayroll));
  tabGosi?.addEventListener('click', () => updateTabSelection('gosi', tabGosi));
  tabLeaves?.addEventListener('click', () => updateTabSelection('leaves', tabLeaves));
  tabOt?.addEventListener('click', () => updateTabSelection('overtime', tabOt));
  tabEosb?.addEventListener('click', () => updateTabSelection('eosb', tabEosb));

  renderReportContent();
}
