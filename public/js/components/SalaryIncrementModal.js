// ==========================================
// Salary Increment & Progression Modal
// ==========================================

import { storage } from '../storage.js';
import { toast } from './Toast.js';
import { createModal } from './Modal.js';
import { formatCurrency, formatDate } from '../types.js';
import { applySalaryIncrement } from '../engines/incrementEngine.js';
import { i18n, t } from '../i18n.js';

export function openSalaryIncrementModal(defaultEmployee = null, onSaved) {
  const state = storage.getState();
  const { employees, settings } = state;
  const isEn = i18n.getLang() === 'en';
  const activeEmployees = employees.filter((e) => e.status === 'active' || e.status === 'probation');
  const selectedEmpId = defaultEmployee ? defaultEmployee.id : (activeEmployees[0]?.id || '');
  const todayStr = new Date().toISOString().split('T')[0];

  const bodyHtml = `
    <form id="salary-increment-form">
      <div class="grid grid-cols-2">
        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${isEn ? 'Employee Eligible for Increment *' : 'الموظف المستحق للزيادة *'}</label>
          <select class="form-select" name="employeeId" id="inc-emp-select" required>
            ${activeEmployees
              .map(
                (emp) => `
              <option value="${emp.id}" ${emp.id === selectedEmpId ? 'selected' : ''}>
                ${emp.fullName} (${emp.jobTitle} - ${isEn ? 'Basic' : 'أساسي'}: ${formatCurrency(emp.basicSalary, settings.currencySymbol)})
              </option>
            `
              )
              .join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Increment Type *' : 'نوع الزيادة *'}</label>
          <select class="form-select" name="type" id="inc-type-select" required>
            <option value="percentage">${isEn ? 'Percentage (%)' : 'نسبة مئوية (%)'}</option>
            <option value="fixed_amount">${isEn ? 'Fixed Amount' : 'مبلغ مالي ثابت'} (${settings.currencySymbol})</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Increment Value *' : 'قيمة الزيادة *'}</label>
          <input type="number" step="0.5" min="0.5" class="form-input" name="value" id="inc-value-input" value="10" required>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Effective & Application Date *' : 'تاريخ سريان وتطبيق الزيادة *'}</label>
          <input type="date" class="form-input" name="effectiveDate" value="${todayStr}" required>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Approving Authority / Decision Maker' : 'صاحب الاعتماد / القرار'}</label>
          <input type="text" class="form-input" name="approvedBy" value="${isEn ? 'General Manager / Board' : 'المدير العام / مجلس الإدارة'}" required>
        </div>

        <div class="form-group" style="grid-column: span 2;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:700;">
            <input type="checkbox" id="inc-prop-check" style="width:16px; height:16px;">
            <span>${isEn ? 'Increase housing & transport allowances proportionally with the same percentage as the basic salary' : 'زيادة بدلات السكن والنقل نسبياً بنفس نسبة زيادة الراتب الأساسي'}</span>
          </label>
        </div>

        <!-- Live Impact Comparison Card -->
        <div class="form-group" style="grid-column: span 2;">
          <div class="card" style="padding:16px; background:var(--bg-card-hover); border-color:var(--border-color);">
            <div style="font-weight:700; font-size:13.5px; margin-bottom:10px; color:var(--text-main);">
              ${isEn ? 'Salary Impact Comparison:' : 'مقارنة أثر الزيادة على الراتب:'}
            </div>
            <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:14px;">
              <div style="background:var(--bg-card); padding:12px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
                <div style="color:var(--text-muted); font-size:12px;">${isEn ? 'Current salary before increment:' : 'الراتب الحالي قبل الزيادة:'}</div>
                <div style="font-weight:700; font-size:16px; color:var(--text-main);" id="inc-old-salary-label">0.00 ${settings.currencySymbol}</div>
                <div style="font-size:11.5px; color:var(--text-muted);" id="inc-old-basic-label">${isEn ? 'Basic' : 'أساسي'}: 0.00 ${settings.currencySymbol}</div>
              </div>
              <div style="background:var(--success-light); padding:12px; border-radius:var(--radius-md); border:1px solid rgba(16, 185, 129, 0.3);">
                <div style="color:#065f46; font-size:12px; font-weight:700;">${isEn ? 'New salary after increment:' : 'الراتب الجديد بعد تطبيق الزيادة:'}</div>
                <div style="font-weight:800; font-size:17px; color:var(--success);" id="inc-new-salary-label">0.00 ${settings.currencySymbol}</div>
                <div style="font-size:11.5px; color:#065f46; font-weight:600;" id="inc-new-basic-label">${isEn ? 'Basic' : 'أساسي'}: 0.00 ${settings.currencySymbol}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${isEn ? 'Reason & Justification for Increment *' : 'سبب ومبررات الزيادة *'}</label>
          <textarea class="form-textarea" name="reason" required placeholder="${isEn ? 'e.g. exceptional annual appraisal, job promotion, outstanding performance reward...' : 'مثال: التقييم السنوي الاستثنائي، ترقية وظيفية، مكافأة أداء متميز...'}"></textarea>
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-success submit-inc-btn">
      ${Icons.check(16)} ${isEn ? 'Apply & Approve Salary Increment' : 'تطبيق واعتماد زيادة الراتب'}
    </button>
  `;

  createModal({
    title: isEn ? 'Apply a Salary Increment & Adjust Financial Structure' : 'تطبيق زيادة راتب وتعديل الهيكل المالي',
    size: 'md',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      const empSelect = overlay.querySelector('#inc-emp-select');
      const typeSelect = overlay.querySelector('#inc-type-select');
      const valInput = overlay.querySelector('#inc-value-input');
      const propCheck = overlay.querySelector('#inc-prop-check');

      const oldSalaryLabel = overlay.querySelector('#inc-old-salary-label');
      const oldBasicLabel = overlay.querySelector('#inc-old-basic-label');
      const newSalaryLabel = overlay.querySelector('#inc-new-salary-label');
      const newBasicLabel = overlay.querySelector('#inc-new-basic-label');

      function updatePreview() {
        const empId = empSelect.value;
        const emp = employees.find((e) => e.id === empId);
        if (!emp) return;

        const type = typeSelect.value;
        const value = Number(valInput.value) || 0;
        const updateHousingAndTransportProportionally = propCheck.checked;

        const { updatedEmployee, incrementRecord } = applySalaryIncrement({
          employee: emp,
          type,
          value,
          effectiveDate: todayStr,
          reason: 'preview',
          approvedBy: 'preview',
          updateHousingAndTransportProportionally,
        });

        oldSalaryLabel.textContent = formatCurrency(incrementRecord.previousTotalSalary, settings.currencySymbol);
        oldBasicLabel.textContent = `${isEn ? 'Basic' : 'أساسي'}: ${formatCurrency(incrementRecord.previousBasicSalary, settings.currencySymbol)}`;
        newSalaryLabel.textContent = formatCurrency(incrementRecord.newTotalSalary, settings.currencySymbol);
        newBasicLabel.textContent = `${isEn ? 'Basic' : 'أساسي'}: ${formatCurrency(incrementRecord.newBasicSalary, settings.currencySymbol)}`;
      }

      empSelect.addEventListener('change', updatePreview);
      typeSelect.addEventListener('change', updatePreview);
      valInput.addEventListener('input', updatePreview);
      propCheck.addEventListener('change', updatePreview);
      updatePreview();

      overlay.querySelector('.close-modal-btn').addEventListener('click', close);

      overlay.querySelector('.submit-inc-btn').addEventListener('click', () => {
        const form = overlay.querySelector('#salary-increment-form');
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }

        const formData = new FormData(form);
        const empId = formData.get('employeeId');
        const emp = employees.find((e) => e.id === empId);
        if (storage.employeeScopeError(emp)) {
          toast.error(isEn ? 'This employee has no Company/Branch assigned — assign both in their profile before applying this increment.' : 'هذا الموظف غير مربوط بشركة وفرع — قم بتعيينهما في ملفه قبل تطبيق الزيادة.');
          return;
        }
        const type = formData.get('type');
        const value = Number(formData.get('value')) || 0;
        const effectiveDate = formData.get('effectiveDate');
        const approvedBy = formData.get('approvedBy');
        const reason = formData.get('reason');
        const updateHousingAndTransportProportionally = propCheck.checked;

        const { updatedEmployee, incrementRecord } = applySalaryIncrement({
          employee: emp,
          type,
          value,
          effectiveDate,
          reason,
          approvedBy,
          updateHousingAndTransportProportionally,
        });

        const resUpdate = storage.updateEmployee(updatedEmployee);
        if (resUpdate && resUpdate.ok === false) {
          toast.error(storage.recordErrorText(resUpdate.error, isEn));
          return;
        }
        const resIncrement = storage.addIncrement(incrementRecord);
        if (resIncrement && resIncrement.ok === false) {
          toast.error(storage.recordErrorText(resIncrement.error, isEn));
          return;
        }

        toast.success(isEn ? `Salary increment applied successfully for ${emp.fullName}` : `تم بنجاح تطبيق زيادة الراتب للموظف ${emp.fullName}`);
        close();
        if (onSaved) onSaved(incrementRecord);
      });
    },
  });
}
