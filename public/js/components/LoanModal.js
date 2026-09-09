// ==========================================
// Employee Loan & Advance Management Modal
// ==========================================

import { storage } from '../storage.js';
import { toast } from './Toast.js';
import { createModal } from './Modal.js';
import { formatCurrency, getCurrentMonth } from '../types.js';
import { i18n, t } from '../i18n.js';

export function openLoanModal(defaultEmployeeId = null, onSaved) {
  const state = storage.getState();
  const { employees, settings } = state;
  const isEn = i18n.getLang() === 'en';
  const activeEmployees = employees.filter((e) => e.status === 'active' || e.status === 'probation');
  const selectedEmpId = defaultEmployeeId || (activeEmployees[0]?.id || '');
  const currentMonth = getCurrentMonth();

  const bodyHtml = `
    <form id="loan-form">
      <div class="grid grid-cols-2">
        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${isEn ? 'Employee *' : 'الموظف *'}</label>
          <select class="form-select" name="employeeId" required>
            ${activeEmployees
              .map(
                (emp) => `
              <option value="${emp.id}" ${emp.id === selectedEmpId ? 'selected' : ''}>
                ${emp.fullName} (${emp.jobTitle} - ${emp.department})
              </option>
            `
              )
              .join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Total Advance Amount *' : 'مبلغ السلفة الإجمالي *'} (${settings.currencySymbol})</label>
          <input type="number" step="0.01" min="1" class="form-input" name="totalAmount" id="loan-total-amount" value="3000" required>
          <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${isEn ? 'From 1 and up to any amount — no upper limit.' : 'من دولار واحد فما فوق — لا يوجد حد أقصى.'}</div>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Number of Repayment Months (Installments) *' : 'عدد أشهر السداد (الأقساط) *'}</label>
          <input type="number" min="1" max="36" class="form-input" name="installmentsCount" id="loan-installments-count" value="3" required>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Deduction Start Month (Payroll) *' : 'شهر بداية الخصم من مسير الرواتب *'}</label>
          <input type="month" class="form-input" name="startDate" value="${currentMonth}" required>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Calculated Monthly Installment' : 'قيمة القسط الشهري المحسوبة'}</label>
          <input type="text" class="form-input" id="loan-monthly-installment" readonly style="background:var(--bg-card-hover); font-weight:700;">
        </div>

        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${isEn ? 'Reason for Granting Advance *' : 'سبب منح السلفة *'}</label>
          <textarea class="form-textarea" name="reason" required placeholder="${isEn ? 'e.g. education expenses, urgent personal circumstances...' : 'مثال: سلفة لتغطية مصاريف دراسية، ظروف شخصية طارئة...'}"></textarea>
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-primary submit-loan-btn">${isEn ? 'Record & Approve Advance' : 'تسجيل واعتماد السلفة'}</button>
  `;

  createModal({
    title: isEn ? 'Grant a Financial Advance to an Employee' : 'تسجيل ومنح سلفة مالية للموظف',
    size: 'md',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      const totalInput = overlay.querySelector('#loan-total-amount');
      const countInput = overlay.querySelector('#loan-installments-count');
      const monthlyInput = overlay.querySelector('#loan-monthly-installment');

      function updateInstallment() {
        const total = Number(totalInput.value) || 0;
        const count = Number(countInput.value) || 1;
        const monthly = count > 0 ? (total / count).toFixed(2) : 0;
        monthlyInput.value = formatCurrency(monthly, settings.currencySymbol);
      }

      totalInput.addEventListener('input', updateInstallment);
      countInput.addEventListener('input', updateInstallment);
      updateInstallment();

      overlay.querySelector('.close-modal-btn').addEventListener('click', close);

      overlay.querySelector('.submit-loan-btn').addEventListener('click', () => {
        const form = overlay.querySelector('#loan-form');
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }

        const formData = new FormData(form);
        const totalAmount = Number(formData.get('totalAmount')) || 0;
        const installmentsCount = Number(formData.get('installmentsCount')) || 1;
        const installmentAmount = parseFloat((totalAmount / installmentsCount).toFixed(2));
        const startDate = formData.get('startDate');
        const emp = employees.find((e) => e.id === formData.get('employeeId'));
        if (storage.employeeScopeError(emp)) {
          toast.error(isEn ? 'This employee has no Company/Branch assigned — assign both in their profile before saving this record.' : 'هذا الموظف غير مربوط بشركة وفرع — قم بتعيينهما في ملفه قبل حفظ هذا السجل.');
          return;
        }

        // Generate installments array
        const installments = [];
        let [startYear, startMonth] = startDate.split('-').map(Number);

        for (let i = 0; i < installmentsCount; i++) {
          const m = String(startMonth).padStart(2, '0');
          installments.push({
            month: `${startYear}-${m}`,
            amount: installmentAmount,
            isPaid: false,
          });
          startMonth++;
          if (startMonth > 12) {
            startMonth = 1;
            startYear++;
          }
        }

        const loanRecord = {
          id: `loan-${Date.now()}`,
          employeeId: formData.get('employeeId'),
          totalAmount,
          paidAmount: 0,
          remainingAmount: totalAmount,
          installmentAmount,
          installmentsCount,
          startDate,
          reason: formData.get('reason'),
          status: 'active',
          installments,
          createdAt: new Date().toISOString(),
        };

        storage.addLoan(loanRecord);
        storage.addAudit('add', 'loan', `${emp?.fullName || ''} — ${formatCurrency(totalAmount, settings.currencySymbol)}`, loanRecord.id);
        toast.success(isEn ? `Advance of ${formatCurrency(totalAmount, settings.currencySymbol)} granted successfully` : `تم تسجيل السلفة بقيمة ${formatCurrency(totalAmount, settings.currencySymbol)} بنجاح`);
        close();
        if (onSaved) onSaved(loanRecord);
      });
    },
  });
}
