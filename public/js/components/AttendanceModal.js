// ==========================================
// Daily Attendance & Time Registration Modal
// ==========================================

import { storage } from '../storage.js';
import { toast } from './Toast.js';
import { createModal } from './Modal.js';
import { t, i18n } from '../i18n.js';

export function openAttendanceModal(onSaved, prefill = {}) {
  const state = storage.getState();
  const { employees } = state;
  const isEn = i18n.getLang() === 'en';
  const activeEmployees = employees.filter((e) => e.status === 'active' || e.status === 'probation');
  const todayStr = new Date().toISOString().split('T')[0];
  const initialEmpId = (prefill.employeeId && activeEmployees.find((e) => e.id === prefill.employeeId)?.id) || activeEmployees[0]?.id || '';
  const initialDate = prefill.date || todayStr;

  const bodyHtml = `
    <form id="attendance-form">
      <div id="att-edit-banner" class="alert alert-warning" style="display:none; margin-bottom:12px; padding:10px 14px; font-size:12.5px; background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.35); border-radius:var(--radius-md);">
        ${isEn ? 'An attendance record already exists for this employee on this date — you are now editing it.' : 'يوجد سجل حضور لهذا الموظف في نفس التاريخ — يتم الآن التعديل على السجل الموجود بدلاً من إنشاء سجل جديد.'}
      </div>
      <div class="grid grid-cols-2">
        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${t('att.employee')} *</label>
          <select class="form-select" name="employeeId" id="att-emp-select" required>
            ${activeEmployees
              .map(
                (emp) => `
              <option value="${emp.id}" ${emp.id === initialEmpId ? 'selected' : ''}>
                ${emp.fullName} (${emp.employeeNumber} - ${emp.department})
              </option>
            `
              )
              .join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">${t('att.date')} *</label>
          <input type="date" class="form-input" name="date" id="att-date-input" value="${initialDate}" required>
        </div>

        <div class="form-group">
          <label class="form-label">${t('att.attendanceStatus')} *</label>
          <select class="form-select" name="status" id="att-status-select" required>
            <option value="present" selected>${t('att.presentOnTime')}</option>
            <option value="late">${t('statusLate')}</option>
            <option value="absent">${t('att.absentUnexcused')}</option>
            <option value="half_day">${t('att.halfDay')}</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">${t('att.checkInTime')}</label>
          <input type="time" class="form-input" name="checkIn" id="att-check-in" value="08:00">
        </div>

        <div class="form-group">
          <label class="form-label">${t('att.checkOutTime')}</label>
          <input type="time" class="form-input" name="checkOut" id="att-check-out" value="17:00">
        </div>

        <div class="form-group">
          <label class="form-label">${t('att.actualWorkingHours')}</label>
          <input type="number" step="0.25" min="0" class="form-input" name="workingHours" id="att-working-hours" value="8">
        </div>

        <div class="form-group">
          <label class="form-label">${t('att.delayIfAny')}</label>
          <input type="number" min="0" class="form-input" name="lateMinutes" id="att-late-minutes" value="0">
        </div>

        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${t('att.notes')}</label>
          <input type="text" class="form-input" name="notes" id="att-notes" placeholder="${t('att.attendanceNotes')}">
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-primary submit-att-btn">${t('att.saveAttendance')}</button>
  `;

  createModal({
    title: t('att.modalAttendanceTitle'),
    size: 'md',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      overlay.querySelector('.close-modal-btn').addEventListener('click', close);

      const empSelect = overlay.querySelector('#att-emp-select');
      const dateInput = overlay.querySelector('#att-date-input');
      const banner = overlay.querySelector('#att-edit-banner');

      function refreshExisting() {
        const existing = storage.findAttendanceByDay(empSelect.value, dateInput.value);
        if (!existing) {
          banner.style.display = 'none';
          overlay.querySelector('#att-status-select').value = 'present';
          overlay.querySelector('#att-check-in').value = '08:00';
          overlay.querySelector('#att-check-out').value = '17:00';
          overlay.querySelector('#att-working-hours').value = '8';
          overlay.querySelector('#att-late-minutes').value = '0';
          overlay.querySelector('#att-notes').value = '';
          return;
        }
        banner.style.display = 'block';
        // Only map statuses this screen can represent. Absence-only statuses
        // (early_leave / excused / half_day issued via the Absence screen) are
        // blocked from silent conversion later in the submit handler.
        if (['present', 'late', 'absent', 'half_day'].includes(existing.status)) {
          overlay.querySelector('#att-status-select').value = existing.status;
        }
        overlay.querySelector('#att-check-in').value = existing.checkIn || '';
        overlay.querySelector('#att-check-out').value = existing.checkOut || '';
        overlay.querySelector('#att-working-hours').value = existing.workingHours ?? 8;
        overlay.querySelector('#att-late-minutes').value = existing.lateMinutes || 0;
        overlay.querySelector('#att-notes').value = existing.notes || '';
      }
      empSelect.addEventListener('change', refreshExisting);
      dateInput.addEventListener('change', refreshExisting);
      refreshExisting();

      overlay.querySelector('.submit-att-btn').addEventListener('click', () => {
        const form = overlay.querySelector('#attendance-form');
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }

        const formData = new FormData(form);
        const empId = formData.get('employeeId');
        const emp = employees.find((e) => e.id === empId);
        if (storage.employeeScopeError(emp)) {
          toast.error(storage.recordErrorText(storage.employeeScopeError(emp), isEn));
          return;
        }

        const date = formData.get('date');
        const checkIn = formData.get('checkIn') || '';
        const checkOut = formData.get('checkOut') || '';
        if (checkIn && checkOut && checkOut < checkIn) {
          toast.error(storage.recordErrorText('checkout_before_checkin', isEn));
          return;
        }
        if (Number(formData.get('workingHours')) < 0 || Number(formData.get('lateMinutes')) < 0) {
          toast.error(storage.recordErrorText('negative_value', isEn));
          return;
        }

        const existing = storage.findAttendanceByDay(empId, date);
        if (existing && !['present', 'late', 'absent', 'half_day'].includes(existing.status)) {
          toast.error(isEn ? 'This attendance record holds an absence type that cannot be edited here — use the absence/delay screen for it.' : 'هذا السجل من نوع غياب لا يمكن تعديله من هنا — استخدم شاشة تسجيل الغياب والتأخير له.');
          return;
        }
        const rawWorkingHours = formData.get('workingHours');
        const attRecord = {
          id: existing ? existing.id : `att-${Date.now()}`,
          companyId: emp.companyId,
          branchId: emp.branchId,
          employeeId: empId,
          date,
          status: formData.get('status'),
          checkIn,
          checkOut,
          workingHours: rawWorkingHours === '' ? 8 : Math.max(0, Number(rawWorkingHours) || 0),
          lateMinutes: Number(formData.get('lateMinutes')) || 0,
          earlyDepartureMinutes: existing ? (existing.earlyDepartureMinutes || 0) : 0,
          notes: formData.get('notes') || '',
        };

        const res = existing
          ? storage.updateAttendance({ ...existing, ...attRecord })
          : storage.addAttendance(attRecord);
        if (!res.ok) {
          toast.error(storage.recordErrorText(res.error, isEn));
          return;
        }
        toast.success(t('att.attendanceSaved'));
        close();
        if (onSaved) onSaved(res.saved);
      });
    },
  });
}
