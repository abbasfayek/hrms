// ==========================================
// Leave Request Modal Component (With Configurable Days Off & Edit Mode)
// ==========================================

import { storage } from '../storage.js';
import { toast } from './Toast.js';
import { createModal } from './Modal.js';
import { countWorkingDays, listCompanyHolidayDatesInRange } from '../types.js';
import { calculateLeaveBalance } from '../engines/leaveEngine.js';
import { i18n, t } from '../i18n.js';

export function openLeaveRequestModal(defaultEmployeeId = null, onSaved, existingLeave = null) {
  const state = storage.getState();
  const { employees, leaves, settings } = state;
  const isEn = i18n.getLang() === 'en';
  const activeEmployees = employees.filter((e) => e.status === 'active' || e.status === 'probation' || e.status === 'on_leave');

  const isEdit = !!existingLeave;
  const editData = existingLeave || {};

  const selectedEmpId = editData.employeeId || defaultEmployeeId || (activeEmployees[0]?.id || '');
  const todayStr = new Date().toISOString().split('T')[0];
  const weekendDays = Array.isArray(settings.weekendDays) ? settings.weekendDays.map(Number) : [6, 0];
  const excludedDaysLabel = (() => {
    if (!weekendDays.length) return '';
    const names = isEn ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    return names.filter((_, i) => weekendDays.includes(i)).join(isEn ? ', ' : '، ');
  })();

  const leaveTypeOptions = [
    ['annual', isEn ? 'Annual Leave' : 'إجازة سنوية اعتيادية'],
    ['sick', isEn ? 'Sick Leave' : 'إجازة مرضية'],
    ['emergency', isEn ? 'Emergency Leave' : 'إجازة اضطرارية'],
    ['unpaid', isEn ? 'Unpaid Leave' : 'إجازة بدون راتب'],
    ['maternity', isEn ? 'Maternity Leave' : 'إجازة أمومة / وضع'],
    ['paternity', isEn ? 'Paternity Leave' : 'إجازة رعاية مولود / أبوة'],
    ['hajj', isEn ? 'Religious Leave (Hajj / Umrah)' : 'إجازة مناسك (حج / عمرة)'],
    ['marriage', isEn ? 'Marriage Leave' : 'إجازة زواج'],
    ['bereavement', isEn ? 'Bereavement Leave' : 'إجازة وفاة'],
  ];

  const bodyHtml = `
    <form id="leave-request-form">
      <div class="grid grid-cols-2">
        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${isEn ? 'Employee *' : 'الموظف *'}</label>
          <select class="form-select" name="employeeId" id="leave-emp-select" required ${isEdit ? 'disabled' : ''}>
            ${activeEmployees.map((emp) => `<option value="${emp.id}" ${emp.id === selectedEmpId ? 'selected' : ''}>${emp.fullName} (${emp.employeeNumber} - ${emp.department})</option>`).join('')}
          </select>
          ${isEdit ? `<input type="hidden" name="employeeId" value="${selectedEmpId}">` : ''}
        </div>

        <div class="form-group" style="grid-column: span 2;" id="emp-live-balance-box"></div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Leave Type *' : 'نوع الإجازة *'}</label>
          <select class="form-select" name="leaveType" id="leave-type-select" required>
            ${leaveTypeOptions.map(([val, label]) => `<option value="${val}" ${editData.leaveType === val ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Request Status' : 'حالة الطلب'}</label>
          <select class="form-select" name="status" id="leave-status-select">
            <option value="approved" ${isEdit ? (editData.status === 'approved' ? 'selected' : '') : 'selected'}>${isEn ? 'Approved & Direct (deducted from balance)' : 'معتمدة ومباشرة (تخصم من الرصيد)'}</option>
            <option value="pending" ${editData.status === 'pending' ? 'selected' : ''}>${isEn ? 'Under review & approval' : 'قيد المراجعة والاعتماد'}</option>
            <option value="rejected" ${editData.status === 'rejected' ? 'selected' : ''}>${isEn ? 'Rejected' : 'مرفوضة'}</option>
            ${isEdit ? `<option value="cancelled" ${editData.status === 'cancelled' ? 'selected' : ''}>${isEn ? 'Cancelled (restores balance)' : 'ملغاة (تعيد الرصيد)'}</option>` : ''}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Start Date *' : 'تاريخ البداية *'}</label>
          <input type="date" class="form-input" name="startDate" id="leave-start-date" value="${editData.startDate || todayStr}" required>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'End Date *' : 'تاريخ النهاية *'}</label>
          <input type="date" class="form-input" name="endDate" id="leave-end-date" value="${editData.endDate || todayStr}" required>
        </div>

        <div class="form-group" style="grid-column: span 2;">
          <div style="background:var(--bg-card-hover); padding:10px 14px; border-radius:var(--radius-md); font-size:13.5px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
            <span>${isEn ? 'Calculated days' : 'عدد الأيام المحتسبة'} <span id="leave-holiday-excluded-badge"></span>${excludedDaysLabel ? `<span style="font-size:11px; color:var(--text-muted); background:rgba(239,68,68,0.08); padding:2px 6px; border-radius:4px;">(${isEn ? 'excluded' : 'مستثنى'}: ${excludedDaysLabel})</span>` : ''}:</span>
            <strong style="color:var(--primary); font-size:18px;" id="calculated-days-label">${editData.daysCount || 1} ${isEn ? 'days' : 'يوم'}</strong>
          </div>
          <div id="leave-half-day-block" style="display:none; margin-top:8px; font-size:13px;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" name="halfDay" id="leave-half-day" style="width:16px; height:16px; accent-color:var(--primary);">
              <span>${isEn ? 'Half day only (0.5 day)' : 'نصف يوم فقط (0.5 يوم)'}</span>
            </label>
          </div>
        </div>

        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${isEn ? 'Leave Reason & Notes' : 'سبب الإجازة وملاحظات'}</label>
          <textarea class="form-textarea" name="reason" placeholder="${isEn ? 'Reason for leave or additional details...' : 'سبب الإجازة أو تفاصيل إضافية...'}">${editData.reason || ''}</textarea>
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-primary submit-leave-btn">
      ${isEdit ? (isEn ? 'Save Changes' : '✏️ حفظ التعديلات') : (isEn ? 'Submit Leave Request' : '✅ تسجيل طلب الإجازة')}
    </button>
  `;

  createModal({
    title: isEdit ? (isEn ? 'Edit Leave Request' : 'تعديل طلب إجازة') : (isEn ? 'Record & Submit a New Leave Request' : 'تسجيل وتقديم طلب إجازة جديد'),
    size: 'md',
    bodyHtml,
    footerHtml,
onOpen: (overlay, close) => {
      const startInput = overlay.querySelector('#leave-start-date');
      const endInput = overlay.querySelector('#leave-end-date');
      const daysLabel = overlay.querySelector('#calculated-days-label');
      const balanceBox = overlay.querySelector('#emp-live-balance-box');
      const halfBlock = overlay.querySelector('#leave-half-day-block');
      const halfCheckbox = overlay.querySelector('#leave-half-day');

      function getEmpId() {
        if (isEdit) return selectedEmpId;
        return overlay.querySelector('#leave-emp-select')?.value || selectedEmpId;
      }

      function effectiveDays(forSubmit = false) {
        const sameDay = startInput.value === endInput.value;
        halfBlock.style.display = sameDay ? 'block' : 'none';
        if (halfCheckbox && halfCheckbox.checked && !sameDay) {
          halfCheckbox.checked = false;
        }
        const isHalf = halfCheckbox && halfCheckbox.checked && sameDay;
        const empId = getEmpId();
        const emp = employees.find((e) => e.id === empId);
        const holidayDates = emp
          ? listCompanyHolidayDatesInRange(state.holidays, emp, startInput.value, endInput.value)
          : [];
        const counted = countWorkingDays(startInput.value, endInput.value, weekendDays, holidayDates);
        return isHalf ? Math.min(0.5, counted) : counted;
      }

      function updateDaysAndBalance() {
        const empId = getEmpId();
        const emp = employees.find((e) => e.id === empId);
        const days = effectiveDays();
        daysLabel.textContent = `${days} ${isEn ? 'days' : 'يوم'}`;

        const holidayDates = emp
          ? listCompanyHolidayDatesInRange(state.holidays, emp, startInput.value, endInput.value)
          : [];
        const holBadge = overlay.querySelector('#leave-holiday-excluded-badge');
        if (holBadge) {
          holBadge.innerHTML = holidayDates.length
            ? `<span style="font-size:11px; color:var(--primary); background:rgba(79,70,229,0.08); padding:2px 6px; border-radius:4px; margin-inline-end:4px;">• ${holidayDates.length} ${isEn ? 'official holiday(s)' : 'عطلة رسمية'} ${isEn ? 'excluded' : 'مستثناة'}</span>`
            : '';
        }

        if (emp) {
          const bal = calculateLeaveBalance(emp, leaves, new Date(), settings);
          balanceBox.innerHTML = `
            <div style="background:var(--primary-light); border:1px solid rgba(79,70,229,0.2); padding:10px 14px; border-radius:var(--radius-md); font-size:12.5px; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <span style="color:var(--text-muted);">${isEn ? 'Remaining annual balance: ' : 'رصيد الإجازات السنوية المتبقي: '}</span>
                <strong style="color:var(--primary); font-size:14px;">${bal.remainingAnnualBalance} ${isEn ? 'days' : 'يوم'}</strong>
              </div>
              <div style="color:var(--text-muted); font-size:12px;">(${isEn ? 'Carried' : 'مرحّل'}: ${bal.carriedOver} • ${isEn ? 'Used' : 'مستهلك'}: ${bal.usedAnnualDays})</div>
            </div>
          `;
        }
      }

      function availableAnnualFor(empId) {
        let reqs = leaves;
        if (isEdit && existingLeave) reqs = reqs.filter((l) => l.id !== existingLeave.id);
        const emp = employees.find((e) => e.id === empId);
        const bal = calculateLeaveBalance(emp, reqs, new Date(), settings);
        const pendingAnnual = reqs
          .filter((l) => l.employeeId === empId && l.status === 'pending' && l.leaveType === 'annual')
          .reduce((sum, l) => sum + (Number(l.daysCount) || 0), 0);
        return parseFloat((bal.remainingAnnualBalance - pendingAnnual).toFixed(2));
      }

      if (!isEdit) {
        overlay.querySelector('#leave-emp-select')?.addEventListener('change', updateDaysAndBalance);
      }
      startInput.addEventListener('change', updateDaysAndBalance);
      endInput.addEventListener('change', updateDaysAndBalance);
      halfCheckbox.addEventListener('change', updateDaysAndBalance);
      if (isEdit && Number(editData.daysCount) > 0 && Number(editData.daysCount) % 1 !== 0) {
        halfCheckbox.checked = true;
      }
      updateDaysAndBalance();

      overlay.querySelector('.close-modal-btn').addEventListener('click', close);

      overlay.querySelector('.submit-leave-btn').addEventListener('click', () => {
        const form = overlay.querySelector('#leave-request-form');
        if (!form.checkValidity()) { form.reportValidity(); return; }

        const formData = new FormData(form);
        const empId = formData.get('employeeId');
        const emp = employees.find((e) => e.id === empId);
        if (storage.employeeScopeError(emp)) {
          toast.error(storage.recordErrorText(storage.employeeScopeError(emp), isEn));
          return;
        }

        let daysCount = effectiveDays();
        if (daysCount <= 0) {
          toast.error(isEn ? 'The leave end date must be on or after the start date' : 'تاريخ نهاية الإجازة يجب أن يكون مساوياً أو بعد تاريخ البداية');
          return;
        }
        if (halfCheckbox.checked && startInput.value !== endInput.value) {
          toast.error(isEn ? 'Half day can only be used for a single-day leave' : 'نصف اليوم يُستخدم فقط لإجازة ليوم واحد');
          return;
        }

        const leaveType = formData.get('leaveType');
        const status = formData.get('status');
        if (leaveType === 'annual') {
          const available = availableAnnualFor(empId);
          if (daysCount > available) {
            toast.error(isEn
              ? `Annual leave balance is insufficient — only ${available} days available (including pending reservations).`
              : `رصيد الإجازة السنوية غير كافٍ — المتاح ${available} يوم (بما فيها الطلبات المعلقة).`);
            return;
          }
        }

        if (isEdit) {
          const updatedLeave = {
            ...existingLeave,
            leaveType,
            startDate: formData.get('startDate'),
            endDate: formData.get('endDate'),
            daysCount,
            reason: formData.get('reason') || '',
            status,
            approvedBy: status === 'approved' ? (isEn ? 'Human Resources Department' : 'إدارة الموارد البشرية') : status === 'cancelled' ? undefined : existingLeave.approvedBy,
            approvalDate: status === 'approved' ? todayStr : status === 'cancelled' ? undefined : existingLeave.approvalDate,
            updatedAt: new Date().toISOString(),
          };
          const res = storage.updateLeave(updatedLeave);
          if (!res.ok) {
            toast.error(storage.recordErrorText(res.error, isEn));
            return;
          }
          toast.success(isEn ? `Leave updated successfully (${daysCount} days)` : `تم تعديل الإجازة بنجاح (${daysCount} يوم)`);
        } else {
          const leaveRecord = {
            id: `leave-${Date.now()}`,
            employeeId: formData.get('employeeId'),
            leaveType,
            startDate: formData.get('startDate'),
            endDate: formData.get('endDate'),
            daysCount,
            reason: formData.get('reason') || '',
            status,
            approvedBy: status === 'approved' ? (isEn ? 'Human Resources Department' : 'إدارة الموارد البشرية') : undefined,
            approvalDate: status === 'approved' ? todayStr : undefined,
            createdAt: new Date().toISOString(),
          };
          const res = storage.addLeave(leaveRecord);
          if (!res.ok) {
            toast.error(storage.recordErrorText(res.error, isEn));
            return;
          }
          toast.success(isEn ? `Leave recorded successfully (${daysCount} days)` : `تم تسجيل الإجازة بنجاح (${daysCount} يوم)`);
        }
        close();
        if (onSaved) onSaved();
      });
    },
  });
}
