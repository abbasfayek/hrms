// ==========================================
// Employee Absence & Delay Logging Modal
// ==========================================

import { storage } from '../storage.js';
import { createModal } from './Modal.js';
import { formatCurrency, formatDate } from '../types.js';
import { t, tf, i18n } from '../i18n.js';
import { toast } from './Toast.js';
import { getDailyRate, getMinuteRate } from '../engines/wageEngine.js';

export function openAbsenceModal(defaultEmployeeId = null, onSaved, prefill = {}) {
  const state = storage.getState();
  const { employees, settings } = state;
  const isEn = i18n.getLang() === 'en';

  if (employees.length === 0) {
    toast.error(t('att.absenceNoEmployees'));
    return;
  }

  const initialEmp = (defaultEmployeeId && employees.find((e) => e.id === defaultEmployeeId)) || employees[0];
  const todayStr = new Date().toISOString().split('T')[0];
  const initialDate = prefill.date || todayStr;

  const bodyHtml = `
    <form id="absence-form">
      <div id="absence-edit-banner" class="alert alert-warning" style="display:none; margin-bottom:12px; padding:10px 14px; font-size:12.5px; background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.35); border-radius:var(--radius-md);">
        ${isEn ? 'An attendance record already exists for this employee on this date — you are now editing it.' : 'يوجد سجل حضور لهذا الموظف في نفس التاريخ — يتم الآن التعديل على السجل الموجود بدلاً من إنشاء سجل جديد.'}
      </div>
      <div class="form-group">
        <label class="form-label">${t('att.affectedEmployee')} *</label>
        <select class="form-select" name="employeeId" id="absence-emp-select" required>
          ${employees
            .map(
              (e) => `
            <option value="${e.id}" ${e.id === initialEmp.id ? 'selected' : ''}>
              ${e.fullName} (${e.employeeNumber} - ${e.department})
            </option>
          `
            )
            .join('')}
        </select>
      </div>

      <div class="grid grid-cols-2">
        <div class="form-group">
          <label class="form-label">${t('att.todayDate')} *</label>
          <input type="date" class="form-input" name="date" id="absence-date-input" value="${initialDate}" required>
        </div>

        <div class="form-group">
          <label class="form-label">${t('att.recordTypeImpact')} *</label>
          <select class="form-select" name="status" id="absence-type-select" required>
            <option value="absent">${t('att.absentUnexcused')}</option>
            <option value="excused_absence">${t('att.excusedAbsence')}</option>
            <option value="late">${t('att.lateArrival')}</option>
            <option value="early_leave">${t('att.earlyDeparture')}</option>
          </select>
        </div>
      </div>

      <!-- Late Minutes Input Container -->
      <div class="form-group" id="late-minutes-container" style="display:none;">
        <label class="form-label">${t('att.earlyDepartureMinutes')} *</label>
        <input type="number" class="form-input" name="lateMinutes" id="late-minutes-input" value="30" min="1" max="480">
      </div>

      <!-- Absence Days Factor -->
      <div class="form-group" id="absence-factor-container">
        <label class="form-label">${t('att.deductionDayFactor')}</label>
        <select class="form-select" name="deductibleDays" id="deductible-days-select">
          <option value="1">${t('att.deductOneDay')}</option>
          <option value="2">${t('att.deductTwoDays')}</option>
          <option value="0.5">${t('att.deductHalfDay')}</option>
          <option value="0">${t('att.noDeduction')}</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">${t('att.adminReasonNotes')}</label>
        <textarea class="form-input" name="notes" rows="2" placeholder="${t('att.absenceReasonPlaceholder')}"></textarea>
      </div>

      <!-- Live Deduction Impact Box -->
      <div class="card" style="padding:14px; background:var(--bg-card-hover); border:1px solid var(--border-color);">
        <div style="font-weight:700; font-size:13px; color:var(--text-main); margin-bottom:6px;">
          💰 ${t('att.payrollDeductionEstimate')}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:12.5px; color:var(--text-muted);" id="lbl-wage-rate-info">${tf('att.dailyWageValue', { amount: '0.00' })}</span>
          <strong style="font-size:16px; color:var(--danger);" id="lbl-calculated-deduction">- 0.00 ${settings.currencySymbol}</strong>
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-danger submit-absence-btn">${t('att.submitAbsence')}</button>
  `;

  createModal({
    title: t('att.absenceModalTitle'),
    size: 'md',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      const empSelect = overlay.querySelector('#absence-emp-select');
      const dateInput = overlay.querySelector('#absence-date-input');
      const banner = overlay.querySelector('#absence-edit-banner');
      const typeSelect = overlay.querySelector('#absence-type-select');
      const lateContainer = overlay.querySelector('#late-minutes-container');
      const lateInput = overlay.querySelector('#late-minutes-input');
      const factorContainer = overlay.querySelector('#absence-factor-container');
      const factorSelect = overlay.querySelector('#deductible-days-select');
      const lblWageInfo = overlay.querySelector('#lbl-wage-rate-info');
      const lblDeduction = overlay.querySelector('#lbl-calculated-deduction');

      function refreshExisting() {
        const existing = storage.findAttendanceByDay(empSelect.value, dateInput.value);
        if (!existing) {
          banner.style.display = 'none';
          return;
        }
        banner.style.display = 'block';
        const typeMap = { absent: 'absent', late: 'late', early_leave: 'early_leave', excused: 'excused_absence' };
        if (typeMap[existing.status]) {
          typeSelect.value = typeMap[existing.status];
        }
        if (existing.lateMinutes) lateInput.value = existing.lateMinutes;
        if (existing.deductibleDays !== undefined && existing.deductibleDays !== null && existing.deductibleDays !== '') {
          factorSelect.value = String(existing.deductibleDays);
        }
        const reasonInput = overlay.querySelector('[name="notes"]');
        if (reasonInput && existing.notes) reasonInput.value = existing.notes || '';
        updateCalculations();
      }

      function updateCalculations() {
        const empId = empSelect.value;
        const emp = employees.find((e) => e.id === empId);
        if (!emp) return;

        // Daily/Minute wage from the SSOT wage engine (historical default:
        // working-days divisor, matching payroll absence deductions).
        const dailyWage = getDailyRate(emp, settings, { defaultMethod: 'workingDays' });
        const minuteWage = getMinuteRate(emp, settings, { defaultMethod: 'workingDays' });

        const type = typeSelect.value;
        let deduction = 0;

        if (type === 'absent') {
          lateContainer.style.display = 'none';
          factorContainer.style.display = 'block';
          const factor = Number(factorSelect.value) || 1;
          deduction = dailyWage * factor;
          lblWageInfo.textContent = tf('att.dailyWageValue', { amount: formatCurrency(dailyWage, settings.currencySymbol) });
        } else if (type === 'excused_absence') {
          lateContainer.style.display = 'none';
          factorContainer.style.display = 'none';
          deduction = 0;
          lblWageInfo.textContent = t('att.justifiedAbsence');
        } else if (type === 'late' || type === 'early_leave') {
          lateContainer.style.display = 'block';
          factorContainer.style.display = 'none';
          const minutes = Number(lateInput.value) || 0;
          deduction = minutes * minuteWage;
          lblWageInfo.textContent = tf('att.minuteWageValue', { amount: formatCurrency(minuteWage, settings.currencySymbol) });
        }

        lblDeduction.textContent = `- ${formatCurrency(deduction, settings.currencySymbol)}`;
      }

      empSelect.addEventListener('change', () => { updateCalculations(); refreshExisting(); });
      typeSelect.addEventListener('change', updateCalculations);
      factorSelect.addEventListener('change', updateCalculations);
      lateInput.addEventListener('input', updateCalculations);
      dateInput.addEventListener('change', refreshExisting);
      updateCalculations();
      refreshExisting();

      overlay.querySelector('.close-modal-btn').addEventListener('click', close);
      overlay.querySelector('.submit-absence-btn').addEventListener('click', () => {
        const form = overlay.querySelector('#absence-form');
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
        const type = formData.get('status');
        const lateMinutes = type === 'late' || type === 'early_leave' ? (Number(formData.get('lateMinutes')) || 0) : 0;
        if (lateMinutes < 0) {
          toast.error(storage.recordErrorText('negative_value', isEn));
          return;
        }

        const date = formData.get('date');
        const existing = storage.findAttendanceByDay(empId, date);
        if (existing && (existing.status === 'present' || existing.status === 'half_day')) {
          toast.error(isEn ? 'This record is a present/half-day attendance, not an absence — edit it from the attendance screen.' : 'هذا السجل حضور/نصف يوم وليس غياباً — عدّله من شاشة تسجيل الحضور.');
          return;
        }

        const attendanceRecord = {
          id: existing ? existing.id : `att-${Date.now()}`,
          companyId: emp.companyId,
          branchId: emp.branchId,
          employeeId: empId,
          date,
          status: type === 'excused_absence' ? 'excused' : type === 'late' ? 'late' : type === 'early_leave' ? 'early_leave' : 'absent',
          lateMinutes,
          notes: formData.get('notes') || (type === 'absent' ? (isEn ? 'Unexcused absence' : 'غياب غير مبرر') : (isEn ? 'Recorded delay' : 'تأخير مسجل')),
          checkIn: type === 'late' ? '09:30' : '08:00',
          checkOut: type === 'early_leave' ? '14:00' : '17:00',
          createdAt: existing ? existing.createdAt : new Date().toISOString(),
        };
        if (type === 'absent') {
          attendanceRecord.deductibleDays = Number(factorSelect.value);
        }

        const res = existing
          ? storage.updateAttendance({ ...existing, ...attendanceRecord })
          : storage.addAttendance(attendanceRecord);
        if (!res.ok) {
          toast.error(storage.recordErrorText(res.error, isEn));
          return;
        }
        toast.success(tf('att.absenceSaved', { type: type === 'absent' ? t('att.absence') : t('att.attendanceRecord'), employee: emp?.fullName || '' }));
        close();
        if (onSaved) onSaved(res.saved);
      });
    },
  });
}
