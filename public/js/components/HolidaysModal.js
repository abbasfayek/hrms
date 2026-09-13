// ==========================================
// Company Paid Holidays & Vacations Modal
// ==========================================

import { storage } from '../storage.js';
import { createModal } from './Modal.js';
import { dateDiffDays, formatDate } from '../types.js';
import { t, i18n } from '../i18n.js';
import { toast } from './Toast.js';

export function openHolidayModal(holiday = null, onSaved) {
  const isEdit = !!holiday;
  const isEn = i18n.getLang() === 'en';
  const state = storage.getState();
  const { companies } = state;

  const todayStr = new Date().toISOString().split('T')[0];

  const data = holiday || {
    id: `hol-${Date.now()}`,
    name: '',
    startDate: todayStr,
    endDate: todayStr,
    daysCount: 1,
    reasonCategory: 'religious_eid',
    notes: '',
    companyId: 'all',
    branchId: 'all',
    isPaid: true,
  };

  const bodyHtml = `
    <form id="holiday-form">
      <div class="form-group">
        <label class="form-label">${isEn ? 'Occasion / Official Holiday Name *' : 'اسم المناسبة / العطلة الرسمية *'}</label>
        <input type="text" class="form-input" name="name" value="${data.name}" required placeholder="${isEn ? 'e.g. Eid Al-Fitr / Official company holiday' : 'مثال: عطلة عيد الفطر المبارك / إجازة رسمية بقرار الإدارة'}">
      </div>

      <div class="grid grid-cols-2">
        <div class="form-group">
          <label class="form-label">${isEn ? 'From (Start Date) *' : 'من تاريخ (بداية العطلة) *'}</label>
          <input type="date" class="form-input" name="startDate" id="hol-start-date" value="${data.startDate}" required>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'To (End Date) *' : 'إلى تاريخ (نهاية العطلة) *'}</label>
          <input type="date" class="form-input" name="endDate" id="hol-end-date" value="${data.endDate}" required>
        </div>
      </div>

      <div class="grid grid-cols-2">
        <div class="form-group">
          <label class="form-label">${isEn ? 'Reason / Origin of the Holiday *' : 'سبب ومنشأ العطلة *'}</label>
          <select class="form-select" name="reasonCategory">
            <option value="religious_eid" ${data.reasonCategory === 'religious_eid' ? 'selected' : ''}>${isEn ? 'Religious occasions (Eid Al-Fitr / Al-Adha)' : 'أعياد ومناسبات دينية (عيد الفطر / الأضحى)'}</option>
            <option value="national_holiday" ${data.reasonCategory === 'national_holiday' ? 'selected' : ''}>${isEn ? 'National / official holiday' : 'عطلة وطنية / رسمية'}</option>
            <option value="company_decision" ${data.reasonCategory === 'company_decision' ? 'selected' : ''}>${isEn ? 'Exceptional leave by company management decision' : 'إجازة استثنائية بقرار من إدارة الشركة'}</option>
            <option value="emergency_closure" ${data.reasonCategory === 'emergency_closure' ? 'selected' : ''}>${isEn ? 'Emergency / weather closure' : 'ظرف طارئ / أحوال جوية'}</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Company / Establishment Applied To *' : 'الشركة المطبق عليها *'}</label>
          <select class="form-select" name="companyId" id="hol-company-select">
            <option value="all" ${data.companyId === 'all' ? 'selected' : ''}>${isEn ? 'All companies & branches (public holiday)' : 'كافة الشركات والفروع (عطلة عامة)'}</option>
            ${companies
              .map(
                (c) => `
              <option value="${c.id}" ${c.id === data.companyId ? 'selected' : ''}>${isEn && c.nameEn ? c.nameEn : c.nameAr}</option>
            `
              )
              .join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Branch Applied To *' : 'الفرع المطبق عليه *'}</label>
          <select class="form-select" name="branchId" id="hol-branch-select">
            <option value="all" ${data.branchId === 'all' ? 'selected' : ''}>${isEn ? 'All branches' : 'جميع الفروع'}</option>
          </select>
          <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">
            ${isEn ? 'The holiday applies to all employees of the selected branch only; choose “All branches” for the whole company.' : 'تُطبق العطلة على موظفي ذلك الفرع فقط، أو اختر «جميع الفروع» لتشمل كامل الشركة.'}
          </div>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${isEn ? 'Administrative details / reason for granting' : 'البيان والتفاصيل الإدارية / سبب المنح'}</label>
        <textarea class="form-input" name="notes" rows="2" placeholder="${isEn ? 'Write the details of the holiday decision...' : 'اكتب تفاصيل قرار منح العطلة...'}">${data.notes || ''}</textarea>
      </div>

      <!-- Paid Status Note -->
      <div class="card" style="padding:12px 16px; background:linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(79, 70, 229, 0.08) 100%); border:1px solid rgba(16, 185, 129, 0.3);">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div style="font-size:13px; font-weight:700; color:var(--success);">
            ✅ ${isEn ? 'Fully paid official holiday (counts as attendance for all employees)' : 'عطلة رسمية مدفوعة الأجر بالكامل (تعتبر دواماً واحتساباً لكافة الموظفين)'}
          </div>
          <span class="badge badge-success" id="lbl-hol-days-count">${isEn ? 'Duration:' : 'المدة:'} ${data.daysCount} ${isEn ? 'days' : 'أيام'}</span>
        </div>
        <div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">
          ${isEn ? 'Employees are not recorded as absent during this period, and their wages are fully counted in payroll.' : 'لا يتم تسجيل الموظفين كغائبين خلال هذه الفترة، وتُحتسب أجورهم كاملة ضمن مسير الرواتب.'}
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-primary submit-hol-btn">${isEdit ? t('save') : (isEn ? 'Add Official Holiday' : 'إضافة العطلة الرسمية')}</button>
  `;

  createModal({
    title: isEdit ? `${isEn ? 'Edit Holiday: ' : 'تعديل العطلة: '}${data.name}` : (isEn ? 'Add Official Holiday / Company Vacation' : 'إضافة عطلة رسمية / إجازة للمنشأة'),
    size: 'md',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      const startInput = overlay.querySelector('#hol-start-date');
      const endInput = overlay.querySelector('#hol-end-date');
      const lblDays = overlay.querySelector('#lbl-hol-days-count');
      const companySelect = overlay.querySelector('#hol-company-select');
      const branchSelect = overlay.querySelector('#hol-branch-select');

      function updateDuration() {
        const d1 = startInput.value;
        const d2 = endInput.value;
        const count = dateDiffDays(d1, d2);
        if (lblDays) lblDays.textContent = `${isEn ? 'Duration:' : 'المدة:'} ${count} ${isEn ? 'days' : 'أيام'}`;
      }

      function populateBranches() {
        const compId = companySelect?.value;
        const comp = companies.find((c) => c.id === compId);
        const branchOptions = [
          `<option value="all" ${data.branchId === 'all' ? 'selected' : ''}>${isEn ? 'All branches' : 'جميع الفروع'}</option>`,
        ];
        if (comp) {
          (comp.branches || []).forEach((b) => {
            branchOptions.push(`<option value="${b.id}" ${b.id === data.branchId ? 'selected' : ''}>${isEn && b.nameEn ? b.nameEn : b.nameAr}</option>`);
          });
        }
        if (branchSelect) branchSelect.innerHTML = branchOptions.join('');
      }

      companySelect?.addEventListener('change', populateBranches);
      populateBranches();

      startInput.addEventListener('change', updateDuration);
      endInput.addEventListener('change', updateDuration);
      updateDuration();

      overlay.querySelector('.close-modal-btn').addEventListener('click', close);
      overlay.querySelector('.submit-hol-btn').addEventListener('click', () => {
        const form = overlay.querySelector('#holiday-form');
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }

        const formData = new FormData(form);
        const startDate = formData.get('startDate');
        const endDate = formData.get('endDate');

        const newHol = {
          ...data,
          name: formData.get('name'),
          startDate,
          endDate,
          daysCount: dateDiffDays(startDate, endDate),
          reasonCategory: formData.get('reasonCategory'),
          companyId: formData.get('companyId'),
          branchId: formData.get('branchId'),
          notes: formData.get('notes'),
          isPaid: true,
        };

        const state = storage.getState();
        const holidays = state.holidays || [];

        if (isEdit) {
          const updated = holidays.map((h) => (h.id === data.id ? newHol : h));
          storage.saveHolidays(updated);
          toast.success(isEn ? `Holiday ${newHol.name} updated successfully` : `تم تعديل العطلة ${newHol.name} بنجاح`);
        } else {
          const res = storage.addHoliday(newHol);
          if (res && res.ok === false) {
            toast.error(storage.recordErrorText(res.error, isEn));
            return;
          }
          toast.success(isEn ? `Official holiday ${newHol.name} added successfully` : `تمت إضافة العطلة الرسمية ${newHol.name} بنجاح`);
        }

        close();
        if (onSaved) onSaved(newHol);
      });
    },
  });
}
