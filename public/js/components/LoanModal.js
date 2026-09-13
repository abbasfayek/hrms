// ==========================================
// Employee Loan & Advance Management Modal
// ==========================================

import { storage } from '../storage.js';
import { toast } from './Toast.js';
import { createModal } from './Modal.js';
import { getCurrentMonth, getAllCurrencies, resolveEmployeeCurrency, formatAmountWithCode } from '../types.js';
import { i18n, t } from '../i18n.js';

export function openLoanModal(defaultEmployeeId = null, onSaved, existingLoan = null) {
  const state = storage.getState();
  const { employees, settings, companies } = state;
  const isEn = i18n.getLang() === 'en';
  const isEdit = !!existingLoan;
  const activeEmployees = employees.filter((e) => e.status === 'active' || e.status === 'probation');
  const selectedEmpId = isEdit
    ? existingLoan.employeeId
    : (defaultEmployeeId || (activeEmployees[0]?.id || ''));
  const currentMonth = getCurrentMonth();

  // P2.2 loan-currency rule: an advance must carry an EXPLICIT currency. The
  // employee's resolved salary currency is the default so installments are
  // withheld in the same currency as the salary.
  const currencies = getAllCurrencies(settings);
  const curOf = (empId) => {
    const emp = employees.find((e) => e.id === empId);
    return emp
      ? resolveEmployeeCurrency(emp, settings, companies)
      : { code: settings.currency || 'USD', symbol: settings.currencySymbol || '$' };
  };
  const initialCurCode = (existingLoan && existingLoan.currency)
    ? String(existingLoan.currency).trim().toUpperCase()
    : curOf(selectedEmpId).code;

  // A loan that already has recorded payments/deductions is financially locked:
  // only the reason may be edited, never the amount, schedule or start month.
  const paymentsExist = isEdit && (
    (Number(existingLoan.paidAmount) || 0) > 0 ||
    (existingLoan.installments || []).some((x) => x.isPaid) ||
    (Number(existingLoan.remainingAmount) || 0) < Number(existingLoan.totalAmount || existingLoan.amount || 0)
  );

  const prefilled = {
    total: isEdit ? (Number(existingLoan.totalAmount) || Number(existingLoan.amount) || 0) : 3000,
    count: isEdit
      ? (Number(existingLoan.installmentsCount) || (existingLoan.installments || []).length || 3)
      : 3,
    start: isEdit ? (existingLoan.startDate || existingLoan.installments?.[0]?.month || currentMonth) : currentMonth,
    reason: isEdit ? (existingLoan.reason || '') : '',
  };

  const lockNote = paymentsExist
    ? `<div style="font-size:11.5px; color:var(--warning); margin-top:6px; line-height:1.7; padding:8px 10px; background:rgba(245,158,11,0.1); border-radius:8px;">
        ${isEn
          ? '🔒 This advance already has recorded payments/deductions, so the amount, installments and start month are locked. Only the reason can be edited to protect financial records.'
          : '🔒 هذه السلفة تم تسديد مدفوعات / استقطاعات لها مسبقاً، لذلك تم قفل المبلغ وعدد الأقساط وشهر البداية. يمكن تعديل السبب فقط حفاظاً على السجلات المالية.'}
      </div>`
    : '';

  const bodyHtml = `
    <form id="loan-form">
      <div class="grid grid-cols-2">
        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${isEn ? 'Employee *' : 'الموظف *'}</label>
          <select class="form-select" name="employeeId" required ${isEdit ? 'disabled' : ''}>
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
          <label class="form-label">${isEn ? 'Total Advance Amount *' : 'مبلغ السلفة الإجمالي *'} (<strong id="loan-cur-code-amount">${initialCurCode}</strong>)</label>
          <input type="number" step="0.01" min="1" class="form-input" name="totalAmount" id="loan-total-amount" value="${prefilled.total}" ${paymentsExist ? 'disabled' : 'required'}>
          ${paymentsExist ? '' : `<div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${isEn ? 'From 1 and up to any amount — in the currency selected below.' : 'من واحد فما فوق — بعملة السلفة المحددة أدناه.'}</div>`}
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Currency of the Advance *' : 'عملة السلفة *'}</label>
          <select class="form-select" name="currency" id="loan-currency-select" ${paymentsExist ? 'disabled' : 'required'}>
            ${currencies
              .map(
                (c) => `
              <option value="${c.code}" ${(c.code === initialCurCode ? 'selected' : '')}>
                ${c.code}${c.symbol ? ' (' + c.symbol + ')' : ''} — ${isEn ? c.nameEn : c.nameAr}
              </option>
            `
              )
              .join('')}
          </select>
          <div id="loan-currency-note" style="font-size:11px; color:var(--text-muted); margin-top:4px; line-height:1.6;"></div>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Number of Repayment Months (Installments) *' : 'عدد أشهر السداد (الأقساط) *'}</label>
          <input type="number" min="1" max="36" class="form-input" name="installmentsCount" id="loan-installments-count" value="${prefilled.count}" ${paymentsExist ? 'disabled' : 'required'}>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Deduction Start Month (Payroll) *' : 'شهر بداية الخصم من مسير الرواتب *'}</label>
          <input type="month" class="form-input" name="startDate" value="${prefilled.start}" ${paymentsExist ? 'disabled' : 'required'}>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Calculated Monthly Installment' : 'قيمة القسط الشهري المحسوبة'}</label>
          <input type="text" class="form-input" id="loan-monthly-installment" readonly style="background:var(--bg-card-hover); font-weight:700;" value="${isEdit ? formatAmountWithCode(((Number(existingLoan.totalAmount) || 0) / (Number(existingLoan.installmentsCount) || (existingLoan.installments || []).length || 1)), initialCurCode) : ''}">
        </div>

        ${paymentsExist ? `<div style="grid-column: span 2;">${lockNote}</div>` : ''}

        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${isEn ? 'Reason for Granting Advance *' : 'سبب منح السلفة *'}</label>
          <textarea class="form-textarea" name="reason" required placeholder="${isEn ? 'e.g. education expenses, urgent personal circumstances...' : 'مثال: سلفة لتغطية مصاريف دراسية، ظروف شخصية طارئة...'}">${prefilled.reason}</textarea>
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-primary submit-loan-btn">${isEdit ? (isEn ? 'Save Changes' : 'حفظ التعديلات') : (isEn ? 'Record & Approve Advance' : 'تسجيل واعتماد السلفة')}</button>
  `;

  createModal({
    title: isEdit
      ? (isEn ? 'Edit Advance Record' : 'تعديل سجل السلفة')
      : (isEn ? 'Grant a Financial Advance to an Employee' : 'تسجيل ومنح سلفة مالية للموظف'),
    size: 'md',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      const totalInput = overlay.querySelector('#loan-total-amount');
      const countInput = overlay.querySelector('#loan-installments-count');
      const monthlyInput = overlay.querySelector('#loan-monthly-installment');
      const currencySelect = overlay.querySelector('#loan-currency-select');
      const currencyNote = overlay.querySelector('#loan-currency-note');
      const empSelect = overlay.querySelector('select[name="employeeId"]');
      const curCodeAmountLabel = overlay.querySelector('#loan-cur-code-amount');
      const empName = (id) => employees.find((e) => e.id === id)?.fullName || '';

      function currentCurCode() {
        return currencySelect ? (currencySelect.value || initialCurCode) : initialCurCode;
      }

      function updateCurrencyNote() {
        if (!currencyNote) return;
        const sel = currentCurCode();
        const salary = curOf(isEdit ? existingLoan.employeeId : (empSelect ? empSelect.value : selectedEmpId)).code;
        if (curCodeAmountLabel) curCodeAmountLabel.textContent = sel;
        if (sel === salary) {
          currencyNote.innerHTML = isEn
            ? `✅ ${isEn ? 'Same currency as this employee\'s salary' : 'نفس عملة راتب هذا الموظف'} (<strong>${salary}</strong>) — ${isEn ? 'the installment will be withheld from payroll.' : 'سيتم استقطاع القسط من المسير.'}`
            : `✅ ${isEn ? 'Same currency as this employee\'s salary' : 'نفس عملة راتب هذا الموظف'} (<strong>${salary}</strong>) — ${isEn ? 'the installment will be withheld from payroll.' : 'سيتم استقطاع القسط من المسير.'}`;
        } else {
          currencyNote.innerHTML = `⚠️ <span style="color:var(--warning);">${isEn
            ? `Different from this employee's salary currency (<strong>${salary}</strong>) — payroll <strong>will NOT</strong> deduct this installment to prevent currency mixing.`
            : `مختلفة عن عملة راتب هذا الموظف (<strong>${salary}</strong>) — لن يستقطع المسير هذا القسط لمنع خلط العملات.`}</span>`;
        }
      }

      function updateInstallment() {
        const total = Number(totalInput.value) || 0;
        const count = Number(countInput.value) || 1;
        const monthly = count > 0 ? (total / count).toFixed(2) : 0;
        monthlyInput.value = formatAmountWithCode(monthly, currentCurCode());
      }

      if (!paymentsExist) {
        totalInput.addEventListener('input', updateInstallment);
        countInput.addEventListener('input', updateInstallment);
        currencySelect.addEventListener('change', () => { updateInstallment(); updateCurrencyNote(); });
        empSelect?.addEventListener('change', () => {
          const auto = curOf(empSelect.value).code;
          if (auto && currencySelect) currencySelect.value = auto;
          updateInstallment();
          updateCurrencyNote();
        });
        updateInstallment();
      }
      updateCurrencyNote();

      overlay.querySelector('.close-modal-btn').addEventListener('click', close);

      overlay.querySelector('.submit-loan-btn').addEventListener('click', () => {
        const form = overlay.querySelector('#loan-form');
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }

        const formData = new FormData(form);
        const empId = isEdit ? existingLoan.employeeId : formData.get('employeeId');
        const emp = employees.find((e) => e.id === empId);

        // P2.2: the loan currency is explicit and required. Legacy records keep
        // their stored code; otherwise it is resolved from the employee's
        // salary currency as the safe default.
        const currency = paymentsExist
          ? (String(existingLoan.currency || curOf(empId).code || 'USD').trim().toUpperCase())
          : (String(formData.get('currency') || curOf(empId).code || 'USD').trim().toUpperCase());
        const currencyRec = currencies.find((c) => c.code === currency) || curOf(empId);

        const totalAmount = paymentsExist
          ? Number(existingLoan.totalAmount || existingLoan.amount || 0)
          : (Number(formData.get('totalAmount')) || 0);
        const installmentsCount = paymentsExist
          ? (Number(existingLoan.installmentsCount) || (existingLoan.installments || []).length || 1)
          : (Number(formData.get('installmentsCount')) || 1);
        const startDate = paymentsExist
          ? (existingLoan.startDate || existingLoan.installments?.[0]?.month)
          : formData.get('startDate');
        const installmentAmount = parseFloat((totalAmount / Math.max(1, installmentsCount)).toFixed(2));
        const reason = formData.get('reason') || existingLoan?.reason || '';

        if (!isEdit && storage.employeeScopeError(emp)) {
          toast.error(isEn ? 'This employee has no Company/Branch assigned — assign both in their profile before saving this record.' : 'هذا الموظف غير مربوط بشركة وفرع — قم بتعيينهما في ملفه قبل حفظ هذا السجل.');
          return;
        }

        const baseRecord = isEdit ? { ...existingLoan } : {
          id: `loan-${Date.now()}`,
          createdAt: new Date().toISOString(),
        };
        baseRecord.employeeId = empId;
        baseRecord.currency = currency;
        baseRecord.currencySymbol = (currencyRec && currencyRec.symbol) || '';
        baseRecord.totalAmount = totalAmount;
        baseRecord.paidAmount = isEdit ? (Number(existingLoan.paidAmount) || 0) : 0;
        baseRecord.remainingAmount = paymentsExist
          ? (Number(existingLoan.remainingAmount) || totalAmount)
          : totalAmount;
        baseRecord.installmentAmount = installmentAmount;
        baseRecord.installmentsCount = installmentsCount;
        baseRecord.startDate = startDate;
        baseRecord.reason = reason;
        baseRecord.status = isEdit ? (existingLoan.status || 'active') : 'active';
        baseRecord.installments = paymentsExist
          ? (existingLoan.installments || [])
          : (() => {
              const schedule = [];
              let [startYear, startMonth] = startDate.split('-').map(Number);
              for (let i = 0; i < installmentsCount; i++) {
                schedule.push({
                  month: `${startYear}-${String(startMonth).padStart(2, '0')}`,
                  amount: installmentAmount,
                  isPaid: false,
                });
                startMonth++;
                if (startMonth > 12) { startMonth = 1; startYear++; }
              }
              return schedule;
            })();
        if (isEdit) baseRecord.updatedAt = new Date().toISOString();

        const auditLabel = `${empName(empId)} — ${totalAmount} ${currency}`;
        if (isEdit) {
          const res = storage.updateLoan(baseRecord);
          if (res && res.ok === false) {
            toast.error(storage.recordErrorText(res.error, isEn));
            return;
          }
          storage.addAudit('update', 'loan', auditLabel, baseRecord.id);
          toast.success(isEn ? 'Advance record updated successfully' : 'تم تحديث سجل السلفة بنجاح');
        } else {
          const res = storage.addLoan(baseRecord);
          if (res && res.ok === false) {
            toast.error(storage.recordErrorText(res.error, isEn));
            return;
          }
          storage.addAudit('add', 'loan', auditLabel, baseRecord.id);
          toast.success(isEn ? `Advance of ${formatAmountWithCode(totalAmount, currency)} granted successfully` : `تم تسجيل السلفة بقيمة ${formatAmountWithCode(totalAmount, currency)} بنجاح`);
        }
        close();
        if (onSaved) onSaved(baseRecord);
      });
    },
  });
}