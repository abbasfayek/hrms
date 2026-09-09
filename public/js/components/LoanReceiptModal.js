// ==========================================
// Loan Repayment Receipt Modal (وصل تسديد السلف) - Bilingual
// ==========================================

import { storage } from '../storage.js';
import { createModal } from './Modal.js';
import { formatDate, escapeHtml, getAllCurrencies, resolveEmployeeCurrency, formatAmountWithCode } from '../types.js';
import { toast } from './Toast.js';
import { t, i18n } from '../i18n.js';

export function openLoanReceiptModal(loan = null, onSaved) {
  const state = storage.getState();
  const { employees, loans, settings, companies } = state;
  const isEn = i18n.getLang() === 'en';

  // P2.2 loan-currency rule: a receipt always prints with the advance's OWN
  // currency code, never the global settings symbol.
  const curCodeOf = (l) => {
    if (l && l.currency) return String(l.currency).trim().toUpperCase();
    const emp = l ? employees.find((e) => e.id === l.employeeId) : null;
    return emp
      ? (resolveEmployeeCurrency(emp, settings, companies).code || settings.currency || 'USD')
      : (settings.currency || 'USD');
  };
  const symOf = (code) => (getAllCurrencies(settings).find((c) => c.code === code) || {}).symbol || settings.currencySymbol || '';

  // If no specific loan passed, show selector
  const activeLoans = loans.filter((l) => (l.remainingAmount || 0) > 0);
  const initialLoan = loan || activeLoans[0];

  if (!initialLoan && !loan) {
    toast.error(t('loans.noActiveAdvance'));
    return;
  }

  const todayStr = new Date().toISOString().split('T')[0];

  const bodyHtml = `
    <div id="loan-receipt-body">
      <div class="form-group">
        <label class="form-label">${isEn ? 'Select Advance to Repay *' : 'اختر السلفة للتسديد *'}</label>
        <select class="form-select" id="loan-receipt-select">
          ${activeLoans.map((l) => {
            const emp = employees.find((e) => e.id === l.employeeId);
            const cc = curCodeOf(l);
            return `<option value="${l.id}" ${initialLoan && l.id === initialLoan.id ? 'selected' : ''}>
              ${emp ? emp.fullName : (isEn ? 'Employee' : 'موظف')} — ${isEn ? 'Total: ' : 'إجمالي: '}${formatAmountWithCode(l.totalAmount, cc)} | ${isEn ? 'Remaining: ' : 'المتبقي: '}${formatAmountWithCode(l.remainingAmount, cc)}
            </option>`;
          }).join('')}
        </select>
      </div>

      <!-- Live Loan Info Card -->
      <div id="loan-info-card" style="margin-bottom:16px; padding:14px 16px; background:var(--bg-card-hover); border-radius:var(--radius-md); border:1px solid var(--border-color); font-size:13px;">
        <!-- Filled dynamically -->
      </div>

      <div class="grid grid-cols-2">
        <div class="form-group">
          <label class="form-label">${isEn ? 'Payment Amount *' : 'مبلغ التسديد *'}</label>
          <input type="number" class="form-input" id="loan-pay-amount" step="0.01" min="0.01" placeholder="${isEn ? 'Enter payment amount' : 'أدخل مبلغ التسديد'}">
        </div>
        <div class="form-group">
          <label class="form-label">${isEn ? 'Payment Date *' : 'تاريخ الدفع *'}</label>
          <input type="date" class="form-input" id="loan-pay-date" value="${todayStr}">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${isEn ? 'Payment Method' : 'طريقة السداد'}</label>
        <select class="form-select" id="loan-pay-method">
          <option value="cash">${isEn ? 'Cash' : 'نقداً'}</option>
          <option value="bank_transfer">${isEn ? 'Bank Transfer' : 'تحويل بنكي'}</option>
          <option value="salary_deduction" selected>${isEn ? 'Salary Deduction' : 'خصم من الراتب الشهري'}</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">${isEn ? 'Notes / Payment Details' : 'ملاحظات / بيان الدفع'}</label>
        <input type="text" class="form-input" id="loan-pay-notes" placeholder="${isEn ? 'e.g. August installment' : 'مثال: تسديد قسط شهر أغسطس'}">
      </div>
    </div>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${isEn ? 'Close' : 'إغلاق'}</button>
    <button type="button" class="btn btn-outline" id="btn-print-loan-receipt">🖨️ ${isEn ? 'Print Receipt Only' : 'طباعة الوصل فقط'}</button>
    <button type="button" class="btn btn-primary" id="btn-save-loan-payment">✓ ${isEn ? 'Record Payment & Save' : 'تسجيل الدفعة وحفظ الوصل'}</button>
  `;

  createModal({
    title: isEn ? 'Loan Repayment Receipt' : 'وصل تسديد السلفة',
    size: 'md',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      const loanSelect = overlay.querySelector('#loan-receipt-select');
      const infoCard = overlay.querySelector('#loan-info-card');
      const amountInput = overlay.querySelector('#loan-pay-amount');

      function updateLoanInfo() {
        const lId = loanSelect.value;
        const l = loans.find((x) => x.id === lId);
        if (!l) return;
        const emp = employees.find((e) => e.id === l.employeeId);
        infoCard.innerHTML = `
          <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px;">
            <div><span style="color:var(--text-muted);">${isEn ? 'Employee:' : 'الموظف:'}</span><br><strong>${escapeHtml(emp ? emp.fullName : '-')}</strong></div>
            <div><span style="color:var(--text-muted);">${isEn ? 'Total Advance:' : 'إجمالي السلفة:'}</span><br><strong>${formatAmountWithCode(l.totalAmount, curCodeOf(l))}</strong></div>
            <div><span style="color:var(--text-muted);">${isEn ? 'Remaining:' : 'المبلغ المتبقي:'}</span><br><strong style="color:var(--danger);">${formatAmountWithCode(l.remainingAmount, curCodeOf(l))}</strong></div>
            <div><span style="color:var(--text-muted);">${isEn ? 'Currency:' : 'العملة:'}</span><br><strong style="direction:ltr; unicode-bidi:embed;">${curCodeOf(l)}</strong></div>
            <div><span style="color:var(--text-muted);">${isEn ? 'Monthly Installment:' : 'القسط الشهري:'}</span><br><strong>${formatAmountWithCode(l.installmentAmount, curCodeOf(l))}</strong></div>
            <div><span style="color:var(--text-muted);">${isEn ? 'Installments Left:' : 'عدد الأقساط المتبقية:'}</span><br><strong>${l.remainingInstallments || '-'} ${isEn ? 'inst.' : 'قسط'}</strong></div>
            <div><span style="color:var(--text-muted);">${isEn ? 'Reason:' : 'سبب السلفة:'}</span><br><strong>${escapeHtml(l.reason || '-')}</strong></div>
          </div>
        `;
        // Pre-fill with installment amount
        amountInput.value = l.installmentAmount || '';
        amountInput.max = l.remainingAmount;
      }

      loanSelect.addEventListener('change', updateLoanInfo);
      updateLoanInfo();

      // Print receipt
      overlay.querySelector('#btn-print-loan-receipt')?.addEventListener('click', () => {
        const lId = loanSelect.value;
        const l = loans.find((x) => x.id === lId);
        if (!l) return;
        const emp = employees.find((e) => e.id === l.employeeId);
        const payAmount = Number(amountInput.value) || l.installmentAmount;
        const payDate = overlay.querySelector('#loan-pay-date').value;
        const method = overlay.querySelector('#loan-pay-method');
        const methodText = method.options[method.selectedIndex].text;
        const notes = overlay.querySelector('#loan-pay-notes').value;

        printLoanReceipt({ l, emp, payAmount, payDate, methodText, notes, settings, curCode: curCodeOf(l), isEn });
      });

      // Save & close
      overlay.querySelector('.close-modal-btn')?.addEventListener('click', close);
      overlay.querySelector('#btn-save-loan-payment')?.addEventListener('click', () => {
        const lId = loanSelect.value;
        const l = loans.find((x) => x.id === lId);
        if (!l) { toast.error(t('loans.selectAdvance')); return; }
        const payAmount = Number(amountInput.value);
        if (!payAmount || payAmount <= 0) { toast.error(t('loans.invalidAmount')); return; }
        if (payAmount > l.remainingAmount) { toast.error(t('loans.amountExceedsRemaining')); return; }

        const payDate = overlay.querySelector('#loan-pay-date').value;
        const notes = overlay.querySelector('#loan-pay-notes').value;

        // Update loan remaining
        l.remainingAmount = Math.max(0, (l.remainingAmount || 0) - payAmount);
        if (l.remainingAmount <= 0) l.status = 'settled';

        const allLoans = storage.get('hrms_loans_v3', []);
        const idx = allLoans.findIndex((x) => x.id === l.id);
        if (idx !== -1) allLoans[idx] = l;
        storage.saveLoans(allLoans);

        const emp = employees.find((e) => e.id === l.employeeId);
        const cc = curCodeOf(l);
        toast.success(
          isEn
            ? `Payment of ${formatAmountWithCode(payAmount, cc)} recorded for ${emp?.fullName || ''}`
            : `تم تسجيل دفعة ${formatAmountWithCode(payAmount, cc)} لسلفة ${emp?.fullName || ''}`
        );

        // Auto-print
        const method = overlay.querySelector('#loan-pay-method');
        const methodText = method.options[method.selectedIndex].text;
        printLoanReceipt({ l: { ...l, remainingAmount: l.remainingAmount + payAmount }, emp, payAmount, payDate, methodText, notes, settings, curCode: cc, isEn });

        close();
        if (onSaved) onSaved();
      });
    },
  });
}

function printLoanReceipt({ l, emp, payAmount, payDate, methodText, notes, settings, curCode, isEn }) {
  const safeCurCode = escapeHtml(String(curCode || settings.currency || 'USD'));
  const receiptNo = `LOAN-RCP-${Date.now().toString().slice(-6)}`;
  const win = window.open('', '_blank', 'width=680,height=700');
  const safeEmpName = escapeHtml(emp?.fullName || '-');
  const safeEmpNumber = escapeHtml(emp?.employeeNumber || '-');
  const safeMethodText = escapeHtml(methodText);
  const safeNotes = notes ? escapeHtml(notes) : '';
  const safeCompanyName = escapeHtml(settings.companyName || (isEn ? 'Main Company' : 'الشركة الرئيسية'));
  const safeCompanyNameEn = escapeHtml(settings.companyNameEn || '');
  const safeCommercialReg = escapeHtml(settings.commercialRegistration || '');

  win.document.write(`<!DOCTYPE html>
<html dir="${isEn ? 'ltr' : 'rtl'}" lang="${isEn ? 'en' : 'ar'}">
<head>
  <meta charset="UTF-8">
  <title>${isEn ? 'Loan Repayment Receipt' : t('payroll.advancePaymentReceipt')}</title>
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
    .amount-box { background: #1e1b4b; color: #fff; border-radius: 10px; padding: 18px 24px; text-align: center; margin: 20px 0; }
    .amount-box .label { font-size: 13px; color: #a5b4fc; }
    .amount-box .value { font-size: 32px; font-weight: 900; color: #38bdf8; margin-top: 4px; }
    .remaining { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 16px; text-align: center; color: #dc2626; font-size: 13px; font-weight: 700; margin-bottom: 20px; }
    .notes-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; margin-bottom: 20px; font-size: 12.5px; color: #334155; }
    .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 24px; border-top: 1px dashed #cbd5e1; padding-top: 20px; text-align: center; font-size: 12px; color: #475569; }
    .sig-line { border-bottom: 1px dotted #94a3b8; width: 80%; margin: 28px auto 4px; }
    @media print { body { padding: 16px; } .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${safeCompanyName}</h1>
    <p>${safeCompanyNameEn} ${safeCommercialReg ? (isEn ? '• Reg. No: ' : '• س.ت: ') + safeCommercialReg : ''}</p>
    <div class="badge-receipt">${isEn ? 'OFFICIAL LOAN REPAYMENT RECEIPT' : 'وصل تسديد سلفة رسمي'}</div>
  </div>

  <div class="info-grid">
    <div class="info-row"><span>${isEn ? 'Employee Name' : 'اسم الموظف'}</span><strong>${safeEmpName}</strong></div>
    <div class="info-row"><span>${t('employeeModal.employeeNumber')}</span><strong>${safeEmpNumber}</strong></div>
    <div class="info-row"><span>${isEn ? 'Receipt No.' : 'رقم الوصل'}</span><strong>${receiptNo}</strong></div>
    <div class="info-row"><span>${isEn ? 'Payment Date' : 'تاريخ الدفع'}</span><strong>${payDate || new Date().toLocaleDateString('en-US')}</strong></div>
    <div class="info-row"><span>${isEn ? 'Original Advance Total' : 'إجمالي السلفة الأصلية'}</span><strong>${formatAmountWithCode(l.totalAmount, safeCurCode)}</strong></div>
    <div class="info-row"><span>${isEn ? 'Currency' : 'العملة'}</span><strong>${safeCurCode}</strong></div>
    <div class="info-row"><span>${isEn ? 'Payment Method' : 'طريقة السداد'}</span><strong>${safeMethodText}</strong></div>
  </div>

  <div class="amount-box">
    <div class="label">${isEn ? 'PAID IN THIS INSTALLMENT' : 'المبلغ المسدَّد في هذه الدفعة'}</div>
    <div class="value">${formatAmountWithCode(payAmount, safeCurCode)}</div>
  </div>

  <div class="remaining">
    ${isEn ? 'Remaining advance balance after this payment: ' : 'الرصيد المتبقي من السلفة بعد هذه الدفعة: '}${formatAmountWithCode(Math.max(0, (l.remainingAmount || 0) - payAmount), safeCurCode)}
  </div>

  ${safeNotes ? `<div class="notes-box">📝 ${isEn ? 'Notes & Details: ' : 'البيان والملاحظات: '}${safeNotes}</div>` : ''}

  <div class="sigs">
    <div>
      <div>${isEn ? 'Payroll / Finance Officer (Prepared by)' : 'مسؤول المالية والرواتب (إعداد)'}</div>
      <div class="sig-line"></div>
      <div>${isEn ? 'Signature & Date' : 'التوقيع والتاريخ'}</div>
    </div>
    <div>
      <div>${isEn ? 'Employee (Acknowledgment)' : 'الموظف المستفيد (إقرار واستلام)'}</div>
      <div class="sig-line"></div>
      <div>${isEn ? 'Signature' : 'التوقيع'}</div>
    </div>
  </div>

  <div class="no-print" style="text-align:center; margin-top:24px;">
    <button onclick="window.print()" style="padding:10px 30px; background:#4f46e5; color:#fff; border:none; border-radius:8px; font-size:15px; font-weight:700; cursor:pointer;">🖨️ ${isEn ? 'Print Receipt' : 'طباعة الوصل'}</button>
  </div>
</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 400);
}