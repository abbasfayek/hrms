// ==========================================
// Hourly Leave Request Modal (نموذج طلب إجازة زمنية بالساعة)
// ==========================================

import { storage } from '../storage.js';
import { createModal } from './Modal.js';
import { toast } from './Toast.js';
import { getCurrentMonth } from '../types.js';
import {
  getEmployeeHourlyQuota,
  calculateHourlyBalance,
  validateHourlyLeaveRequest,
} from '../engines/hourlyLeaveEngine.js';
import { t, i18n } from '../i18n.js';

export function openHourlyLeaveModal(existing = null, onSaved) {
  const state = storage.getState();
  const { employees, companies, settings, hourlyLeaves } = state;
  const isEn = i18n.getLang() === 'en';

  if (employees.length === 0) {
    toast.error(isEn ? 'Please add employees first' : 'يرجى إضافة موظفين أولاً');
    return;
  }

  // Backward compatible: legacy callers pass an employeeId (string) as the
  // first argument. An object with an id means "edit this record".
  const isEdit = Boolean(existing && typeof existing === 'object' && existing.id);
  const defaultEmployeeId = isEdit ? existing.employeeId : existing;

  const initialEmp = (defaultEmployeeId && employees.find((e) => e.id === defaultEmployeeId)) || employees[0];
  const todayStr = new Date().toISOString().split('T')[0];
  const initialDate = isEdit ? (existing.date || todayStr) : todayStr;
  const initialHours = isEdit ? (existing.hours != null ? existing.hours : 2) : 2;
  const initialStart = isEdit ? (existing.startTime || '09:00') : '09:00';
  const initialEnd = isEdit ? (existing.endTime || '11:00') : '11:00';
  const initialReason = isEdit ? (existing.reason || '') : '';
  const initialStatus = isEdit ? (existing.status || 'approved') : 'approved';
  const modalTitle = isEdit ? (isEn ? 'Edit Hourly Leave' : 'تعديل إجازة زمنية (بالساعة)') : (isEn ? 'Hourly Leave Request' : 'طلب إجازة زمنية (بالساعة) — Hourly Leave');

  const bodyHtml = `
    <form id="hourly-leave-form">
      <div class="form-group">
        <label class="form-label">${isEn ? 'Employee *' : 'الموظف *'}</label>
        <select class="form-select" name="employeeId" id="hl-emp-select" required>
          ${employees.map((e) => `
            <option value="${e.id}" ${e.id === initialEmp.id ? 'selected' : ''}>
              ${e.fullName} (${e.employeeNumber} - ${e.department})
            </option>
          `).join('')}
        </select>
      </div>

      <!-- Realtime Balance Card -->
      <div id="hl-balance-card" style="margin-bottom:16px; padding:12px 16px; background:var(--bg-card-hover); border-radius:var(--radius-md); border:1px solid var(--border-color); font-size:13px;">
        <!-- Filled dynamically -->
      </div>

      <div class="grid grid-cols-2">
        <div class="form-group">
          <label class="form-label">${isEn ? 'Leave Date *' : 'تاريخ الإجازة الزمنية *'}</label>
          <input type="date" class="form-input" name="date" id="hl-date-input" value="${initialDate}" required>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Hours Required *' : 'عدد الساعات المطلوبة *'}</label>
          <input type="number" class="form-input" name="hours" id="hl-hours-input" step="0.5" min="0.5" max="8" value="${initialHours}" required placeholder="${isEn ? 'e.g. 2' : 'مثال: 2'}">
        </div>
      </div>

      <div class="grid grid-cols-2">
        <div class="form-group">
          <label class="form-label">${isEn ? 'From (Time)' : 'من الساعة'}</label>
          <input type="time" class="form-input" name="startTime" id="hl-start-time" value="${initialStart}">
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'To (Time)' : 'إلى الساعة'}</label>
          <input type="time" class="form-input" name="endTime" id="hl-end-time" value="${initialEnd}">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${isEn ? 'Leave Reason *' : 'سبب الإجازة الزمنية *'}</label>
        <input type="text" class="form-input" name="reason" value="${initialReason}" required placeholder="${isEn ? 'e.g. Hospital visit, family emergency, government errand' : 'مثال: مراجعة مستشفى، ظرف عائلي طارئ، مراجعة دائرة حكومية'}">
      </div>

      <div class="form-group">
        <label class="form-label">${isEn ? 'Request Status' : 'حالة الطلب'}</label>
        <select class="form-select" name="status" id="hl-status">
          <option value="approved" ${initialStatus === 'approved' ? 'selected' : ''}>${isEn ? 'Approved immediately' : 'معتمد فوراً'} (Approved)</option>
          <option value="pending" ${initialStatus === 'pending' ? 'selected' : ''}>${isEn ? 'Pending approval' : 'قيد الموافقة'} (Pending)</option>
        </select>
      </div>

      <div class="alert alert-info" style="margin-top:10px; font-size:12px; padding:10px 14px; background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.2); border-radius:var(--radius-md);">
        ℹ️ <strong>${isEn ? 'Note:' : 'ملاحظة:'}</strong> ${isEn ? 'Hourly leaves cannot be rolled over or accumulated; the quota renews automatically at the start of every calendar month.' : 'الإجازات الزمنية (بالساعة) غير قابلة للترحيل أو التراكم، وتتجدد الحصة تلقائياً في بداية كل شهر ميلادي.'}
      </div>
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-primary submit-hl-btn">✓ ${isEdit ? (isEn ? 'Save Changes' : 'حفظ التعديلات') : (isEn ? 'Record Hourly Leave' : 'تسجيل الإجازة الزمنية')}</button>
  `;

  createModal({
    title: modalTitle,
    size: 'md',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      const empSelect = overlay.querySelector('#hl-emp-select');
      const dateInput = overlay.querySelector('#hl-date-input');
      const hoursInput = overlay.querySelector('#hl-hours-input');
      const balanceCard = overlay.querySelector('#hl-balance-card');

      function updateBalanceDisplay() {
        const empId = empSelect.value;
        const emp = employees.find((e) => e.id === empId);
        const comp = companies.find((c) => c.id === emp?.companyId);
        const quota = getEmployeeHourlyQuota(emp, comp, settings);
        const dateVal = dateInput.value || todayStr;
        const month = dateVal.slice(0, 7);

        const allHourlyLeaves = storage.get('hrms_hourly_leaves_v3', []);
        // When editing, exclude the record itself so the balance reflects the
        // hours actually available for this request.
        const currentHourlyLeaves = isEdit && existing && existing.id
          ? allHourlyLeaves.filter((l) => l.id !== existing.id)
          : allHourlyLeaves;
        const balance = calculateHourlyBalance(empId, currentHourlyLeaves, month, quota);

        balanceCard.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
              <span style="color:var(--text-muted);">${isEn ? 'Month balance' : 'رصيد شهر'} (${month}):</span>
              <strong style="color:var(--primary); font-size:14px; margin-right:4px;">${quota} ${isEn ? 'hrs' : 'ساعات'}</strong>
            </div>
            <div>
              <span style="color:var(--text-muted);">${isEn ? 'Used:' : 'المستهلك:'}</span>
              <strong style="color:var(--warning); font-size:14px; margin-right:4px;">${balance.usedHours} ${isEn ? 'hrs' : 'س'}</strong>
            </div>
            <div>
              <span style="color:var(--text-muted);">${isEn ? 'Remaining this month:' : 'المتبقي للشهر:'}</span>
              <strong style="color:${balance.remainingHours > 0 ? 'var(--success)' : 'var(--danger)'}; font-size:15px; margin-right:4px;">
                ${balance.remainingHours} ${isEn ? 'hrs' : 'ساعات'}
              </strong>
            </div>
          </div>
        `;

        hoursInput.max = balance.remainingHours > 0 ? balance.remainingHours : 0;
      }

      empSelect.addEventListener('change', updateBalanceDisplay);
      dateInput.addEventListener('change', updateBalanceDisplay);
      updateBalanceDisplay();

      overlay.querySelector('.close-modal-btn')?.addEventListener('click', close);

      overlay.querySelector('.submit-hl-btn')?.addEventListener('click', () => {
        const form = overlay.querySelector('#hourly-leave-form');
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
        const comp = companies.find((c) => c.id === emp.companyId);
        const quota = getEmployeeHourlyQuota(emp, comp, settings);
        const date = formData.get('date');
        const hours = Number(formData.get('hours'));
        const startTime = formData.get('startTime');
        const endTime = formData.get('endTime');
        const reason = formData.get('reason');
        const status = formData.get('status');

        const allHourlyLeaves = storage.get('hrms_hourly_leaves_v3', []);
        const currentHourlyLeaves = isEdit && existing && existing.id
          ? allHourlyLeaves.filter((l) => l.id !== existing.id)
          : allHourlyLeaves;
        const validation = validateHourlyLeaveRequest(empId, hours, date, currentHourlyLeaves, quota);

        if (!validation.valid) {
          toast.error(validation.message);
          return;
        }

        if (isEdit && existing && existing.id) {
          const merged = {
            ...existing,
            companyId: emp.companyId,
            branchId: emp.branchId,
            employeeId: empId,
            date,
            hours,
            startTime,
            endTime,
            reason,
            status,
            approvedBy: status === 'approved' ? (existing.approvedBy || storage.getActiveUser()?.name || (isEn ? 'Manager' : 'المدير')) : null,
            updatedAt: new Date().toISOString(),
          };
          storage.updateHourlyLeave(merged);
          toast.success(isEn ? `Hourly leave updated (${hours} hrs) for ${emp?.fullName || ''}` : `تم تعديل الإجازة الزمنية (${hours} ساعة) للموظف ${emp?.fullName || ''}`);
          close();
          if (onSaved) onSaved(merged);
          return;
        }

        const newLeave = {
          id: `hl-${Date.now()}`,
          companyId: emp.companyId,
          branchId: emp.branchId,
          employeeId: empId,
          date,
          hours,
          startTime,
          endTime,
          reason,
          status,
          createdAt: new Date().toISOString(),
          approvedBy: status === 'approved' ? (storage.getActiveUser()?.name || (isEn ? 'Manager' : 'المدير')) : null,
        };

        const res = storage.addHourlyLeave(newLeave);
        if (!res.ok) {
          toast.error(storage.recordErrorText(res.error, isEn));
          return;
        }
        toast.success(isEn ? `Hourly leave (${hours} hrs) recorded for ${emp?.fullName || ''}` : `تم تسجيل إجازة زمنية (${hours} ساعة) للموظف ${emp?.fullName || ''}`);
        close();
        if (onSaved) onSaved(res.saved);
      });
    },
  });
}
