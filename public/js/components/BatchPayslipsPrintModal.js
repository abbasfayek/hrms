// ==========================================
// Batch All-in-One Printable Payslip Receipts Booklet
// Isolated, Multi-page, 1 receipt per employee with official signatures
// ==========================================

import { createModal } from './Modal.js';
import { Icons } from '../icons.js';
import { formatCurrency, formatDate, formatPayMonth, escapeHtml, formatAmountWithCode } from '../types.js';
import { t, i18n } from '../i18n.js';

export function openBatchPayslipsPrintModal(payrollBatch, settings, company = null, companies = []) {
  const items = payrollBatch.items || [];
  const isEn = i18n.getLang() === 'en';
  const programName = isEn ? 'HRMS Enterprise' : 'بينو سوفت لإدارة الموارد البشرية';
  const compName = company ? company.nameAr : (settings.companyName || 'بينو سوفت');
  const compNameEn = company ? company.nameEn : (settings.companyNameEn || 'HRMS Enterprise');
  const crNo = company ? company.commercialRegistration : (settings.commercialRegistration || '-');
  const taxNo = company ? company.taxNumber : (settings.taxNumber || '-');
  const currencySymbol = company ? company.currencySymbol : (settings.currencySymbol || '$');
  const fallbackCode = (company && company.currency) || settings.currency || 'USD';
  const companyPhone = settings.companyPhone || '';
  const companyEmail = settings.companyEmail || '';
  const companyWhatsApp = settings.companyWhatsApp || '';
  const getBranchLabel = buildBranchLabelResolver(companies, isEn);
  const payrollMonth = formatPayMonth(payrollBatch.month);
  const printDate = formatDate(new Date().toISOString().split('T')[0]);
  const documentRef = `PR-${payrollBatch.month}-${(payrollBatch.id || '').slice(-6).toUpperCase()}`;

  const bodyHtml = `
    <!-- Top Print Control Bar -->
    <div style="background:var(--bg-card-hover); padding:16px 20px; border-radius:var(--radius-md); margin-bottom:24px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;" class="no-print">
      <div>
        <div style="font-weight:800; font-size:16px; color:var(--text-main);">
          📄 ${isEn ? 'Batch Employee Payslips Printing' : 'طباعة وصولات وقسائم صرف الرواتب لكافة الموظفين'}
        </div>
        <div style="font-size:12.5px; color:var(--text-muted); margin-top:2px;">
          ${isEn ? `Salary month (${formatPayMonth(payrollBatch.month)}) • Total (${items.length}) employee receipts ready for isolated printing` : `مسير شهر (${formatPayMonth(payrollBatch.month)}) • إجمالي (${items.length}) وصل صرف مخصص للطباعة الرسمية المنفصلة`}
        </div>
      </div>

      <div style="display:flex; align-items:center; gap:10px;">
        <button type="button" class="btn btn-primary" id="btn-trigger-isolated-print">
          ${Icons.printer(18)} ${isEn ? 'Start Isolated Printing Now' : '🖨️ فتح نافذة الطباعة الرسمية المعزولة'}
        </button>
      </div>
    </div>

    <!-- Preview Container (Scrollable inside modal) -->
    <div style="max-height: 500px; overflow-y:auto; padding: 4px; display:flex; flex-direction:column; gap:20px;">
      ${items.map((it, idx) => generateSingleSlipHtml(it, payrollBatch, { compName, compNameEn, crNo, taxNo, currencySymbol, fallbackCode, companyPhone, companyEmail, companyWhatsApp, isEn, getBranchLabel, programName, payrollMonth, printDate, documentRef, itemsCount: items.length, slipIndex: idx + 1 }, false)).join('')}
    </div>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-primary" id="btn-footer-print">
      ${Icons.printer(18)} ${isEn ? 'Print All Payslips (Isolated)' : 'طباعة كافة الوصولات (معزول رسمي)'}
    </button>
  `;

  createModal({
    title: `${isEn ? 'Batch Payslip Receipts' : 'وصولات وقسائم صرف الرواتب المجمعة'} (${formatPayMonth(payrollBatch.month)})`,
    size: 'lg',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      overlay.querySelector('.close-modal-btn').addEventListener('click', close);
      
      const handlePrint = () => {
        printIsolatedBatchPayslips(payrollBatch, settings, company, companies);
      };

      overlay.querySelector('#btn-trigger-isolated-print')?.addEventListener('click', handlePrint);
      overlay.querySelector('#btn-footer-print')?.addEventListener('click', handlePrint);
    },
  });
}

function buildBranchLabelResolver(companies, isEn) {
  const map = {};
  (companies || []).forEach((c) => {
    (c.branches || []).forEach((b) => {
      map[b.id] = isEn && b.nameEn ? b.nameEn : b.nameAr;
    });
  });
  return (item) => (item && item.branchId && map[item.branchId]) ? map[item.branchId] : '';
}

function generateSingleSlipHtml(it, payrollBatch, opts, isForPrintWindow = false) {
  const { compName, compNameEn, crNo, taxNo, currencySymbol, fallbackCode, companyPhone, companyEmail, companyWhatsApp, isEn, getBranchLabel, programName, payrollMonth, printDate, documentRef, itemsCount, slipIndex } = opts;
  // P2.2: every payslip prints in the employee's own currency (code shown),
  // falling back to the company/global currency for legacy batches.
  const curCode = it.currency || fallbackCode || 'USD';
  const fmt = (amt) => formatAmountWithCode(amt, curCode);
  const slipNo = `REC-${escapeHtml(it.employeeNumber || 'EMP')}-${payrollBatch.month}`;
  const branchName = escapeHtml(getBranchLabel ? getBranchLabel(it) : '');
  const safeEmpName = escapeHtml(it.employeeName || '');
  const safeEmpNumber = escapeHtml(it.employeeNumber || '');
  const safeDepartment = escapeHtml(it.department || '');
  const safeJobTitle = escapeHtml(it.jobTitle || '-');
  const safeBankName = escapeHtml(it.bankName || '-');
  const safeIban = escapeHtml(it.iban || '-');
  const absenceDeduction = Number(it.absenceDeduction) || 0;
  const lateDeduction = Number(it.lateDeduction) || 0;
  const loanInstallment = Number(it.loanInstallment) || 0;
  const gosiEmp = Number(it.gosiEmployeeDeduction) || 0;
  const otherDeds = (Number(it.penaltiesDeduction) || 0) + (Number(it.otherDeductions) || 0);
  const programNameDisplay = programName || (isEn ? 'HRMS Enterprise' : 'بينو سوفت لإدارة الموارد البشرية');
  const pageInfo = isEn ? `Page ${slipIndex} of ${itemsCount}` : `صفحة ${slipIndex} من ${itemsCount}`;
  const docRef = documentRef || `PR-${payrollBatch.month}-${(payrollBatch.id || '').slice(-6).toUpperCase()}`;

  return `
    <div class="receipt-slip-page" style="background:#ffffff; color:#0f172a; padding:24px 28px; border-radius:8px; border:${isForPrintWindow ? 'none' : '1px solid #cbd5e1'}; font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; ${isForPrintWindow ? 'page-break-after: always; break-after: page;' : ''}">
      
      <!-- Slip Header -->
      <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #4f46e5; padding-bottom:12px; margin-bottom:16px;">
        <div>
          <h2 style="font-size:18px; font-weight:900; color:#1e1b4b; margin:0;">${compName}</h2>
          <div style="font-size:11.5px; color:#64748b; margin-top:2px;">${compNameEn}</div>
          <div style="font-size:11px; color:#64748b; margin-top:3px;">
            ${isEn ? 'CR:' : 'السجل التجاري:'} <strong>${crNo}</strong> • ${isEn ? 'Tax No:' : 'الرقم الضريبي:'} <strong>${taxNo}</strong>
          </div>
          ${companyPhone || companyEmail ? `
            <div style="font-size:10px; color:#64748b; margin-top:3px;" dir="ltr" style="text-align:left;">
              ${companyPhone ? `📞 ${companyPhone}` : ''}${companyPhone && companyEmail ? ' • ' : ''}${companyEmail ? `✉️ ${companyEmail}` : ''}${companyWhatsApp && companyWhatsApp !== companyPhone ? ` 💬 +${companyWhatsApp.replace(/\D/g, '')}` : ''}
            </div>
          ` : ''}
        </div>

        <div style="text-align:${isEn ? 'right' : 'left'};">
          <div style="display:inline-block; background:#4f46e5; color:#ffffff; padding:4px 12px; border-radius:4px; font-weight:800; font-size:13px;">
            ${isEn ? 'OFFICIAL SALARY RECEIPT' : 'سند ووصل صرف راتب رسمي'}
          </div>
          <div style="font-size:12px; font-weight:700; color:#0f172a; margin-top:4px;">
            ${isEn ? 'Period:' : 'فترة الراتب:'} ${formatPayMonth(payrollBatch.month)}
          </div>
          <div style="font-size:10.5px; color:#64748b;">
            ${isEn ? 'Receipt #:' : 'رقم السند:'} ${slipNo} • ${isEn ? 'Date:' : 'التاريخ:'} ${formatDate(payrollBatch.issueDate)}
          </div>
        </div>
      </div>

      <!-- Employee Info Box -->
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px; margin-bottom:14px; display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; font-size:12px;">
        <div>${isEn ? 'Employee Name:' : 'اسم الموظف:'} <strong style="color:#0f172a; font-size:13px;">${safeEmpName}</strong></div>
        <div>${isEn ? 'Employee ID:' : 'الرقم الوظيفي:'} <strong style="color:#0f172a;">${safeEmpNumber}</strong></div>
        <div>${isEn ? 'Department:' : 'القسم / الإدارة:'} <strong style="color:#0f172a;">${safeDepartment}</strong></div>
        <div>${isEn ? 'Job Title:' : 'المسمى الوظيفي:'} <strong style="color:#0f172a;">${safeJobTitle}</strong></div>
        <div>${isEn ? 'Bank Name:' : 'البنك المحول إليه:'} <strong style="color:#0f172a;">${safeBankName}</strong></div>
        <div>${isEn ? 'IBAN:' : 'رقم الآيبان:'} <strong style="font-family:monospace; color:#0f172a; font-size:11px;">${safeIban}</strong></div>
        <div>${isEn ? 'Branch:' : 'الفرع:'} <strong style="color:#0f172a;">${branchName}</strong></div>
      </div>

      <!-- Earnings and Deductions 2-Column Grid -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:14px; margin-bottom:14px;">
        
        <!-- Earnings Table (المستحقات) -->
        <div style="border:1px solid #cbd5e1; border-radius:6px; overflow:hidden;">
          <div style="background:#f1f5f9; padding:6px 10px; font-weight:800; font-size:12px; color:#1e293b; border-bottom:1px solid #cbd5e1; display:flex; justify-content:space-between;">
            <span>${isEn ? 'Earnings & Allowances' : 'المستحقات والبدلات'}</span>
            <span>${isEn ? 'Amount' : 'المبلغ'}</span>
          </div>
          <div style="padding:8px 10px; display:flex; flex-direction:column; gap:5px; font-size:11.5px;">
            <div style="display:flex; justify-content:space-between;">
              <span>${isEn ? 'Basic Salary:' : 'الراتب الأساسي:'}</span>
              <strong>${fmt(it.basicSalary)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span>${isEn ? 'Housing Allowance:' : 'بدل السكن:'}</span>
              <strong>${fmt(it.housingAllowance)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span>${isEn ? 'Transport Allowance:' : 'بدل المواصلات والنقل:'}</span>
              <strong>${fmt(it.transportAllowance)}</strong>
            </div>
            ${it.otherAllowances > 0 ? `
              <div style="display:flex; justify-content:space-between;">
                <span>${isEn ? 'Other Allowances:' : 'بدلات أخرى:'}</span>
                <strong>${fmt(it.otherAllowances)}</strong>
              </div>
            ` : ''}
            ${it.overtimeAmount > 0 ? `
              <div style="display:flex; justify-content:space-between; color:#4f46e5;">
                <span>${isEn ? `Overtime (${it.overtimeHours} hrs):` : `العمل الإضافي (${it.overtimeHours} ساعة):`}</span>
                <strong>+ ${fmt(it.overtimeAmount)}</strong>
              </div>
            ` : ''}
            ${it.bonuses > 0 ? `
              <div style="display:flex; justify-content:space-between; color:#10b981;">
                <span>${isEn ? 'Bonuses & Incentives:' : 'حوافز ومكافآت:'}</span>
                <strong>+ ${fmt(it.bonuses)}</strong>
              </div>
            ` : ''}
            <div style="border-top:1px solid #cbd5e1; padding-top:5px; margin-top:3px; display:flex; justify-content:space-between; font-weight:800; font-size:12px; color:#1e1b4b;">
              <span>${isEn ? 'Total Gross Earnings:' : 'إجمالي الاستحقاقات:'}</span>
              <span>${fmt(it.grossSalary)}</span>
            </div>
          </div>
        </div>

        <!-- Deductions Table (الاستقطاعات) -->
        <div style="border:1px solid #cbd5e1; border-radius:6px; overflow:hidden;">
          <div style="background:#f1f5f9; padding:6px 10px; font-weight:800; font-size:12px; color:#1e293b; border-bottom:1px solid #cbd5e1; display:flex; justify-content:space-between;">
            <span>${isEn ? 'Deductions & Advances' : 'الاستقطاعات والخصومات'}</span>
            <span>${isEn ? 'Amount' : 'المبلغ'}</span>
          </div>
          <div style="padding:8px 10px; display:flex; flex-direction:column; gap:5px; font-size:11.5px;">
            ${loanInstallment > 0 ? `
              <div style="display:flex; justify-content:space-between; color:#b45309;">
                <span>${isEn ? 'Loan Advance Installment:' : 'قسط السلفة / القرض الشهري:'}</span>
                <strong>- ${fmt(loanInstallment)}</strong>
              </div>
            ` : ''}
            <div style="display:flex; justify-content:space-between;">
              <div>
                <span>${isEn ? 'Social Security:' : 'التأمينات الاجتماعية:'}</span>
                ${it.isSubjectToGosi ? `<span style="font-size:10px; color:#64748b;">(${it.gosiEmployeePercent || 0}%)</span>` : ''}
              </div>
              <strong style="color:${gosiEmp > 0 ? '#dc2626' : '#64748b'};">
                ${gosiEmp > 0 ? `- ${fmt(gosiEmp)}` : '0.00'}
              </strong>
            </div>
            ${absenceDeduction > 0 ? `
              <div style="display:flex; justify-content:space-between; color:#dc2626;">
                <span>${isEn ? `Absence Deduction (${it.absenceDays || 1} d):` : `خصم أيام الغياب (${it.absenceDays || 1} يوم):`}</span>
                <strong>- ${fmt(absenceDeduction)}</strong>
              </div>
            ` : ''}
            ${lateDeduction > 0 ? `
              <div style="display:flex; justify-content:space-between; color:#dc2626;">
                <span>${isEn ? `Late Deduction (${it.lateMinutes || 0} m):` : `خصم دقائق التأخير (${it.lateMinutes || 0} دقيقة):`}</span>
                <strong>- ${fmt(lateDeduction)}</strong>
              </div>
            ` : ''}
            ${otherDeds > 0 ? `
              <div style="display:flex; justify-content:space-between; color:#dc2626;">
                <span>${isEn ? 'Penalties & Other Deductions:' : 'جزاءات وخصومات أخرى:'}</span>
                <strong>- ${fmt(otherDeds)}</strong>
              </div>
            ` : ''}
            <div style="border-top:1px solid #cbd5e1; padding-top:5px; margin-top:3px; display:flex; justify-content:space-between; font-weight:800; font-size:12px; color:#dc2626;">
              <span>${isEn ? 'Total Deductions:' : 'إجمالي الاستقطاعات:'}</span>
              <span>- ${fmt(it.totalDeductions)}</span>
            </div>
          </div>
        </div>

      </div>

      <!-- Grand Net Payable Banner -->
      <div style="background:#1e1b4b; color:#ffffff; padding:12px 18px; border-radius:6px; display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
        <div>
          <div style="font-size:11px; color:#cbd5e1;">${isEn ? 'Net Payable Salary (Transferred to Bank)' : 'صافي الراتب المستحق للصرف والتحويل البنكي'}</div>
          <div style="font-size:20px; font-weight:900; color:#38bdf8; margin-top:2px;">
            ${fmt(it.netSalary)}
          </div>
        </div>
        <div style="text-align:${isEn ? 'right' : 'left'}; font-size:11px; color:#cbd5e1; background:rgba(255,255,255,0.08); padding:5px 10px; border-radius:4px; border:1px solid rgba(255,255,255,0.15);">
          ${isEn ? 'Company Social Security Share:' : 'مساهمة المنشأة في التأمينات:'} <strong>${fmt(it.gosiCompanyContribution)}</strong>
        </div>
      </div>

      <!-- Official Signatures Box -->
      <div style="display:grid; grid-template-columns: repeat(3, 1fr); text-align:center; font-size:11.5px; color:#334155; padding-top:10px; border-top:1px dashed #cbd5e1;">
        <div>
          <strong>${isEn ? 'Prepared by: Payroll / Accountant' : 'إعداد: مسؤول الرواتب / المحاسب'}</strong>
          <div style="margin-top:24px; border-bottom:1px dotted #94a3b8; width:70%; margin-left:auto; margin-right:auto;"></div>
          <div style="font-size:10px; color:#64748b; margin-top:3px;">${isEn ? 'Signature & Date' : 'التوقيع والتاريخ'}</div>
        </div>

        <div>
          <strong>${isEn ? 'Approved by: HR / Finance' : 'اعتماد: مدير الموارد البشرية / المالية'}</strong>
          <div style="margin-top:24px; border-bottom:1px dotted #94a3b8; width:70%; margin-left:auto; margin-right:auto;"></div>
          <div style="font-size:10px; color:#64748b; margin-top:3px;">${isEn ? 'Official Stamp & Approval' : 'الختم والاعتماد'}</div>
        </div>

        <div>
          <strong>${isEn ? 'Acknowledged & Received by Employee' : 'إقرار واستلام الموظف المستفيد'}</strong>
          <div style="margin-top:24px; border-bottom:1px dotted #94a3b8; width:70%; margin-left:auto; margin-right:auto;"></div>
          <div style="font-size:10px; color:#64748b; margin-top:3px;">${isEn ? 'Employee Signature' : 'توقيع المستلم'}</div>
        </div>
      </div>

      <!-- Enhanced Footer with Program Name, Document Ref, Page Info -->
      <div class="no-print" style="display:none;">
        <div style="margin-top:16px; padding-top:12px; border-top:1px solid #e2e8f0; font-size:10px; color:#64748b; text-align:center;">
          <div>${isEn ? 'Document Ref:' : 'رقم المستند:'} <strong>${docRef}</strong></div>
          <div style="margin-top:4px;">${isEn ? 'Print Date:' : 'تاريخ الطباعة:'} ${printDate}</div>
          <div style="margin-top:4px;">${pageInfo}</div>
        </div>
      </div>
      
      <!-- Print-only Footer -->
      <div style="display:none;" class="print-only-footer">
        <div style="margin-top:16px; padding-top:12px; border-top:1px solid #e2e8f0; font-size:9px; color:#64748b; text-align:center;">
          <div>${isEn ? 'Document Ref:' : 'رقم المستند:'} <strong>${docRef}</strong></div>
          <div style="margin-top:2px;">${isEn ? 'Print Date:' : 'تاريخ الطباعة:'} ${printDate}</div>
          <div style="margin-top:2px;">${pageInfo}</div>
          <div style="margin-top:6px; font-weight:700; color:#4f46e5; font-size:10px;">
            ${isEn ? `Issued from ${programNameDisplay}` : `صادر من برنامج ${programNameDisplay}`}
          </div>
        </div>
      </div>

    </div>
  `;
}

export function printIsolatedBatchPayslips(payrollBatch, settings, company = null, companies = []) {
  const items = payrollBatch.items || [];
  const isEn = i18n.getLang() === 'en';
  const programName = isEn ? 'HRMS Enterprise' : 'بينو سوفت لإدارة الموارد البشرية';
  const compName = company ? company.nameAr : (settings.companyName || 'بينو سوفت');
  const compNameEn = company ? company.nameEn : (settings.companyNameEn || 'HRMS Enterprise');
  const crNo = company ? company.commercialRegistration : (settings.commercialRegistration || '-');
  const taxNo = company ? company.taxNumber : (settings.taxNumber || '-');
  const currencySymbol = company ? company.currencySymbol : (settings.currencySymbol || '$');
  const fallbackCode = (company && company.currency) || settings.currency || 'USD';
  const companyPhone = settings.companyPhone || '';
  const companyEmail = settings.companyEmail || '';
  const companyWhatsApp = settings.companyWhatsApp || '';
  const getBranchLabel = buildBranchLabelResolver(companies, isEn);
  const payrollMonth = formatPayMonth(payrollBatch.month);
  const printDate = formatDate(new Date().toISOString().split('T')[0]);
  const documentRef = `PR-${payrollBatch.month}-${(payrollBatch.id || '').slice(-6).toUpperCase()}`;

  const win = window.open('', '_blank', 'width=850,height=950');
  if (!win) {
    alert(isEn ? 'Please allow popups to print payslips' : 'يرجى السماح بالنوافذ المنبثقة لطباعة الوصولات');
    return;
  }

  const slipsHtml = items
    .map((it, idx) => generateSingleSlipHtml(it, payrollBatch, { compName, compNameEn, crNo, taxNo, currencySymbol, fallbackCode, companyPhone, companyEmail, companyWhatsApp, isEn, getBranchLabel, programName, payrollMonth, printDate, documentRef, itemsCount: items.length, slipIndex: idx + 1 }, true))
    .join('');

  win.document.write(`<!DOCTYPE html>
<html dir="${isEn ? 'ltr' : 'rtl'}" lang="${isEn ? 'en' : 'ar'}">
<head>
  <meta charset="UTF-8">
  <title>${isEn ? 'Batch Payslip Receipts' : 'وصولات صرف الرواتب المجمعة'} - ${formatPayMonth(payrollBatch.month)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #fff; color: #0f172a; padding: 20px; font-size: 12px; }
    .receipt-slip-page {
      page-break-after: always;
      break-after: page;
      margin-bottom: 20px;
      padding: 24px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
    }
    .receipt-slip-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    @media print {
      body { padding: 0; }
      .receipt-slip-page {
        border: none;
        border-radius: 0;
        padding: 16px 20px;
        margin-bottom: 0;
        page-break-after: always !important;
        break-after: page !important;
      }
      .no-print { display: none !important; }
      .print-only-footer { display: block !important; }
    }
  </style>
</head>
<body>
  ${slipsHtml}
  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 400);
    };
  </script>
</body>
</html>`);

  win.document.close();
}
