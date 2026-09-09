// ==========================================
// Overtime Registration & Calculation Modal
// ==========================================

import { storage } from '../storage.js';
import { toast } from './Toast.js';
import { createModal } from './Modal.js';
import { formatCurrency, getCurrentMonth, escapeHtml } from '../types.js';
import { calculateHourlyRate, calculateOvertimeAmount } from '../engines/overtimeEngine.js';
import { i18n, t } from '../i18n.js';

export function openOvertimeModal(existing = null, onSaved) {
  const state = storage.getState();
  const { employees, settings } = state;
  const isEn = i18n.getLang() === 'en';
  const activeEmployees = employees.filter((e) => e.status === 'active' || e.status === 'probation');
  const todayStr = new Date().toISOString().split('T')[0];
  const currentPeriod = getCurrentMonth();
  const isEdit = Boolean(existing && existing.id);
  const initialEmpId = (existing && existing.employeeId && activeEmployees.find((e) => e.id === existing.employeeId)?.id) || activeEmployees[0]?.id || '';
  const initialDate = (existing && existing.date) || todayStr;
  const initialPeriod = (existing && (existing.payrollPeriod || (existing.date || '').slice(0, 7))) || currentPeriod;
  const initialHours = existing ? (Number(existing.hours) || 0) : 4;
  const initialType = ['regular_day', 'weekend', 'holiday'].includes(existing && existing.type) ? existing.type : 'regular_day';
  const titleTxt = isEdit ? (isEn ? 'Edit Overtime Hours' : 'تعديل ساعات العمل الإضافي') : (isEn ? 'Record & Calculate Overtime Hours' : 'تسجيل واحتساب ساعات العمل الإضافي');

  const bodyHtml = `
    <form id="overtime-form">
      <div class="grid grid-cols-2">
        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${isEn ? 'Eligible Employee *' : 'الموظف المستحق *'}</label>
          <select class="form-select" name="employeeId" id="ot-emp-select" required>
            ${activeEmployees
              .map(
                (emp) => `
              <option value="${emp.id}" ${emp.id === initialEmpId ? 'selected' : ''}>
                ${emp.fullName} (${emp.jobTitle} - ${isEn ? 'Basic' : 'أساسي'}: ${formatCurrency(emp.basicSalary, settings.currencySymbol)})
              </option>
            `
              )
              .join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Overtime Date *' : 'تاريخ العمل الإضافي *'}</label>
          <input type="date" class="form-input" name="date" id="ot-date-input" value="${initialDate}" required>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Target Payroll Period' : 'فترة مسير الرواتب المستهدفة'}</label>
          <input type="month" class="form-input" name="payrollPeriod" id="ot-period-input" value="${initialPeriod}" required>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Overtime Hours *' : 'عدد الساعات الإضافية *'}</label>
          <input type="number" step="0.5" min="0.5" max="24" class="form-input" name="hours" id="ot-hours-input" value="${initialHours}" required>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Day Type & Calculation Multiplier *' : 'نوع اليوم والمعامل الاحتسابي *'}</label>
          <select class="form-select" name="type" id="ot-type-select" required>
            <option value="regular_day" data-mult="1.5" ${initialType === 'regular_day' ? 'selected' : ''}>${isEn ? 'Regular Work Day (1.5x hourly rate)' : 'يوم عمل عادي (1.5x أجر الساعة)'}</option>
            <option value="weekend" data-mult="2.0" ${initialType === 'weekend' ? 'selected' : ''}>${isEn ? 'Weekly Holiday (2.0x hourly rate)' : 'عطلة أسبوعية (2.0x أجر الساعة)'}</option>
            <option value="holiday" data-mult="2.0" ${initialType === 'holiday' ? 'selected' : ''}>${isEn ? 'Official Holiday / Eid or National Day (2.0x hourly rate)' : 'عطلة رسمية / عيد أو يوم وطني (2.0x أجر الساعة)'}</option>
          </select>
        </div>

        <!-- Live Financial Summary Card -->
        <div class="form-group" style="grid-column: span 2;">
          <div class="card" style="padding:14px; background:var(--primary-light); border-color:rgba(99, 102, 241, 0.2);">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
              <span style="font-weight:700; color:var(--text-main);">${isEn ? 'Calculated Regular Hourly Rate:' : 'أجر الساعة العادي المحتسب:'}</span>
              <strong style="color:var(--text-main);" id="ot-hourly-rate-label">0.00 ${settings.currencySymbol}</strong>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; border-top:1px solid rgba(99, 102, 241, 0.2); padding-top:8px;">
              <span style="font-weight:800; font-size:15px; color:var(--primary);">${isEn ? 'Total Overtime Amount Due:' : 'إجمالي المبلغ المستحق للإضافي:'}</span>
              <strong style="font-size:18px; font-weight:800; color:var(--primary);" id="ot-total-amount-label">0.00 ${settings.currencySymbol}</strong>
            </div>
          </div>
        </div>

        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${isEn ? 'Reason & Justification for Overtime *' : 'سبب التكليف بالعمل الإضافي ومبرراته *'}</label>
          <textarea class="form-textarea" name="reason" required placeholder="${isEn ? 'e.g. emergency server maintenance, annual inventory closing, covering operational pressure...' : 'مثال: صيانة طارئة لخوادم النظام، إنهاء الجرد السنوي، تغطية ضغط عمليات...'}">${escapeHtml((existing && existing.reason) || '')}</textarea>
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-primary submit-ot-btn">${isEdit ? (isEn ? 'Save Changes' : 'حفظ التعديلات') : (isEn ? 'Record & Approve Overtime' : 'تسجيل واعتماد العمل الإضافي')}</button>
  `;

  createModal({
    title: titleTxt,
    size: 'md',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      const empSelect = overlay.querySelector('#ot-emp-select');
      const hoursInput = overlay.querySelector('#ot-hours-input');
      const typeSelect = overlay.querySelector('#ot-type-select');
      const hourlyRateLabel = overlay.querySelector('#ot-hourly-rate-label');
      const totalAmountLabel = overlay.querySelector('#ot-total-amount-label');

      let currentHourlyRate = 0;
      let currentTotal = 0;
      let currentMultiplier = 1.5;

      function updateCalculations() {
        const empId = empSelect.value;
        const emp = employees.find((e) => e.id === empId);
        if (!emp) return;

        currentHourlyRate = calculateHourlyRate(emp.basicSalary, settings);
        const hours = Number(hoursInput.value) || 0;
        const selectedOpt = typeSelect.selectedOptions[0];
        currentMultiplier = Number(selectedOpt?.getAttribute('data-mult')) || 1.5;

        currentTotal = calculateOvertimeAmount(hours, currentHourlyRate, currentMultiplier);

        hourlyRateLabel.textContent = formatCurrency(currentHourlyRate, settings.currencySymbol);
        totalAmountLabel.textContent = formatCurrency(currentTotal, settings.currencySymbol);
      }

      empSelect.addEventListener('change', updateCalculations);
      hoursInput.addEventListener('input', updateCalculations);
      typeSelect.addEventListener('change', updateCalculations);
      updateCalculations();

      overlay.querySelector('.close-modal-btn').addEventListener('click', close);

      overlay.querySelector('.submit-ot-btn').addEventListener('click', () => {
        const form = overlay.querySelector('#overtime-form');
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }

        const formData = new FormData(form);
        const empId = formData.get('employeeId');
        const emp = employees.find((e) => e.id === empId);
        if (storage.employeeScopeError(emp)) {
          toast.error(isEn ? 'This employee has no Company/Branch assigned — assign both in their profile before saving this record.' : 'هذا الموظف غير مربوط بشركة وفرع — قم بتعيينهما في ملفه قبل حفظ هذا السجل.');
          return;
        }

        const hours = Number(formData.get('hours')) || 0;
        const type = formData.get('type');
        const date = formData.get('date');
        const payrollPeriod = formData.get('payrollPeriod') || getCurrentMonth();
        const reason = formData.get('reason');

        const otRecord = {
          id: existing && existing.id ? existing.id : `ot-${Date.now()}`,
          companyId: emp.companyId,
          branchId: emp.branchId,
          employeeId: empId,
          date,
          hours,
          multiplier: currentMultiplier,
          hourlyRate: currentHourlyRate,
          totalAmount: currentTotal,
          type,
          reason,
          status: existing && existing.status ? existing.status : 'approved',
          payrollPeriod,
          createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const res = existing && existing.id
          ? storage.updateOvertime(otRecord)
          : (storage.addOvertime(otRecord), { ok: true, saved: otRecord });
        if (res && res.ok === false) {
          toast.error(storage.recordErrorText(res.error, isEn));
          return;
        }
        toast.success(isEn ? `Saved ${hours} overtime hours worth ${formatCurrency(currentTotal, settings.currencySymbol)} for ${emp.fullName}` : `تم حفظ ${hours} ساعات إضافية بقيمة ${formatCurrency(currentTotal, settings.currencySymbol)} للموظف ${emp.fullName}`);
        close();
        if (onSaved) onSaved(res && res.ok !== false ? (res.saved || otRecord) : otRecord);
      });
    },
  });
}
