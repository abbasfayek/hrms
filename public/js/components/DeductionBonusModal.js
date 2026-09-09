// ==========================================
// Salary Deduction OR Bonus Award Modal (Create, Edit, Delete)
// ==========================================

import { storage } from '../storage.js';
import { createModal, showConfirmDialog } from './Modal.js';
import { formatCurrency, formatDate } from '../types.js';
import { toast } from './Toast.js';
import { Icons } from '../icons.js';
import { t, i18n } from '../i18n.js';

export function openDeductionBonusModal(defaultEmployeeId = null, onSaved, existingRecord = null) {
  const state = storage.getState();
  const { employees, settings } = state;
  const sym = settings.currencySymbol || '$';
  const isEn = i18n.getLang() === 'en';

  if (employees.length === 0) {
    toast.error(isEn ? 'Please add employees first' : 'يرجى إضافة موظفين أولاً');
    return;
  }

  const isEdit = !!existingRecord;
  const initialEmpId = existingRecord ? existingRecord.employeeId : (defaultEmployeeId || employees[0].id);
  const initialType = existingRecord ? (existingRecord.type === 'bonus' ? 'bonus' : 'deduction') : 'deduction';
  const initialAmount = existingRecord ? Math.abs(Number(existingRecord.amount) || 0) : '';
  const initialPeriod = existingRecord ? existingRecord.payrollPeriod : new Date().toISOString().slice(0, 7);
  const initialReason = existingRecord ? (existingRecord.reason || '') : '';
  const initialDate = existingRecord ? (existingRecord.date || new Date().toISOString().split('T')[0]) : new Date().toISOString().split('T')[0];

  const bodyHtml = `
    <form id="ded-bonus-form">
      <div class="form-group">
        <label class="form-label">${isEn ? 'Employee *' : 'الموظف *'}</label>
        <select class="form-select" name="employeeId" id="ded-emp-select" required>
          ${employees.map((e) => `
            <option value="${e.id}" ${e.id === initialEmpId ? 'selected' : ''}>
              ${e.fullName} (${e.employeeNumber} - ${e.department})
            </option>
          `).join('')}
        </select>
      </div>

      <!-- Type Selector -->
      <div class="form-group">
        <label class="form-label">${isEn ? 'Transaction Type *' : 'نوع العملية *'}</label>
        <div style="display:flex; gap:12px;">
          <label style="display:flex; align-items:center; gap:8px; flex:1; padding:12px 16px; border:2px solid var(--border-color); border-radius:var(--radius-md); cursor:pointer; transition: all 0.2s;" id="label-bonus">
            <input type="radio" name="type" value="bonus" id="type-bonus" ${initialType === 'bonus' ? 'checked' : ''}>
            <span>
              <strong style="color:var(--success);">🎁 ${isEn ? 'Grant Bonus' : 'منح مكافأة'}</strong>
              <div style="font-size:11.5px; color:var(--text-muted);">${isEn ? 'Add amount to monthly salary' : 'إضافة مبلغ إلى الراتب الشهري'}</div>
            </span>
          </label>
          <label style="display:flex; align-items:center; gap:8px; flex:1; padding:12px 16px; border:2px solid var(--border-color); border-radius:var(--radius-md); cursor:pointer; transition: all 0.2s;" id="label-deduction">
            <input type="radio" name="type" value="deduction" id="type-deduction" ${initialType === 'deduction' ? 'checked' : ''}>
            <span>
              <strong style="color:var(--danger);">✂️ ${isEn ? 'Salary Deduction' : 'قطع راتب / خصم مالي'}</strong>
              <div style="font-size:11.5px; color:var(--text-muted);">${isEn ? 'Deduct amount from monthly salary' : 'اقتطاع مبلغ من الراتب الشهري'}</div>
            </span>
          </label>
        </div>
      </div>

      <div class="grid grid-cols-2">
        <div class="form-group">
          <label class="form-label">${isEn ? 'Amount *' : 'المبلغ *'}</label>
          <input type="number" class="form-input" name="amount" step="0.01" min="0.01" value="${initialAmount}" required placeholder="${isEn ? 'Enter amount' : 'أدخل المبلغ'}">
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Financial Month *' : 'الفترة المالية (الشهر) *'}</label>
          <input type="month" class="form-input" name="payrollPeriod" value="${initialPeriod}" required>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${isEn ? 'Reason & Justification *' : 'السبب والوصف *'}</label>
        <input type="text" class="form-input" name="reason" value="${initialReason}" required
          placeholder="${isEn ? 'e.g. Q2 Performance Bonus / Penalty for unauthorized delay' : 'مثال: مكافأة الأداء المتميز / خصم جزاء غياب بدون عذر'}">
      </div>

      <div class="form-group">
        <label class="form-label">${isEn ? 'Decision Date' : 'تاريخ القرار'}</label>
        <input type="date" class="form-input" name="date" value="${initialDate}">
      </div>

      <!-- Preview Box -->
      <div class="card" id="ded-bonus-preview" style="padding:12px 16px; background:var(--bg-card-hover); border:1px solid var(--border-color);">
        <div style="font-size:12.5px; color:var(--text-muted);">
          ${isEn ? 'This adjustment will be factored into the employee’s monthly payroll automatically.' : 'سيتم إضافة/اقتطاع هذا المبلغ من مسير رواتب الموظف في الشهر المحدد تلقائياً'}
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <div style="display:flex; justify-content:space-between; width:100%;">
      <div>
        ${isEdit ? `
          <button type="button" class="btn btn-outline delete-ded-btn" style="color:var(--danger); border-color:rgba(239,68,68,0.4);">
            ${Icons.trash(16)} ${isEn ? 'Delete Record' : 'حذف الحركة'}
          </button>
        ` : ''}
      </div>
      <div style="display:flex; gap:8px;">
        <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
        <button type="button" class="btn btn-primary submit-ded-bonus-btn">
          ${isEdit ? (isEn ? '✓ Save Changes' : '✓ حفظ التعديلات') : (isEn ? '✓ Apply & Save' : '✓ حفظ وتطبيق')}
        </button>
      </div>
    </div>
  `;

  createModal({
    title: isEdit ? (isEn ? 'Edit Deduction or Bonus' : 'تعديل الخصم أو المكافأة') : (isEn ? 'Salary Deduction or Bonus Award' : 'قطع راتب أو منح مكافأة'),
    size: 'md',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      const bonusRadio = overlay.querySelector('#type-bonus');
      const dedRadio = overlay.querySelector('#type-deduction');
      const labelBonus = overlay.querySelector('#label-bonus');
      const labelDed = overlay.querySelector('#label-deduction');

      function updateTypeStyle() {
        if (bonusRadio.checked) {
          labelBonus.style.borderColor = 'var(--success)';
          labelBonus.style.background = 'rgba(16,185,129,0.06)';
          labelDed.style.borderColor = 'var(--border-color)';
          labelDed.style.background = '';
        } else {
          labelDed.style.borderColor = 'var(--danger)';
          labelDed.style.background = 'rgba(239,68,68,0.06)';
          labelBonus.style.borderColor = 'var(--border-color)';
          labelBonus.style.background = '';
        }
      }

      bonusRadio.addEventListener('change', updateTypeStyle);
      dedRadio.addEventListener('change', updateTypeStyle);
      updateTypeStyle();

      overlay.querySelector('.close-modal-btn').addEventListener('click', close);

      // Handle Delete (if in Edit Mode)
      overlay.querySelector('.delete-ded-btn')?.addEventListener('click', () => {
        showConfirmDialog({
          title: isEn ? 'Delete Adjustment' : 'حذف حركة الخصم / المكافأة',
          message: isEn ? 'Are you sure you want to delete this adjustment? This will recalculate the employee payroll.' : 'هل أنت متأكد من رغبتك في حذف هذا الخصم/المكافأة؟ سيتم تحديث مسير الرواتب تلقائياً.',
          confirmText: isEn ? 'Yes, Delete' : '✓ نعم، احذف',
          onConfirm: () => {
            const currentIncrements = storage.get('hrms_increments_v3', []);
            const updated = currentIncrements.filter((x) => x.id !== existingRecord.id);
            storage.saveIncrements(updated);
            toast.success(isEn ? 'Adjustment deleted successfully' : 'تم حذف الحركة بنجاح');
            close();
            if (onSaved) onSaved(null);
          },
        });
      });

      // Handle Submit (Create or Update)
      overlay.querySelector('.submit-ded-bonus-btn').addEventListener('click', () => {
        const form = overlay.querySelector('#ded-bonus-form');
        if (!form.checkValidity()) { form.reportValidity(); return; }

        const formData = new FormData(form);
        const empId = formData.get('employeeId');
        const emp = employees.find((e) => e.id === empId);
        if (storage.employeeScopeError(emp)) {
          toast.error(isEn ? 'This employee has no Company/Branch assigned — assign both in their profile before saving this record.' : 'هذا الموظف غير مربوط بشركة وفرع — قم بتعيينهما في ملفه قبل حفظ هذا السجل.');
          return;
        }
        const type = formData.get('type');
        const amount = Number(formData.get('amount'));
        const payrollPeriod = formData.get('payrollPeriod');
        const reason = formData.get('reason');
        const date = formData.get('date');

        const record = {
          id: existingRecord ? existingRecord.id : `ded-bon-${Date.now()}`,
          companyId: emp.companyId,
          branchId: emp.branchId,
          employeeId: empId,
          type: type === 'bonus' ? 'bonus' : 'deduction',
          amount: type === 'bonus' ? amount : -amount,
          payrollPeriod,
          reason,
          date,
          appliedAt: existingRecord ? existingRecord.appliedAt : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const currentIncrements = storage.get('hrms_increments_v3', []);
        let updated;
        if (isEdit) {
          updated = currentIncrements.map((x) => (x.id === existingRecord.id ? record : x));
        } else {
          updated = [record, ...currentIncrements];
        }
        storage.saveIncrements(updated);

        const typeLabel = type === 'bonus' ? (isEn ? 'Bonus' : 'مكافأة') : (isEn ? 'Deduction' : 'قطع راتب');
        toast.success(isEn ? `${typeLabel} saved for ${emp?.fullName}` : `تم حفظ ${typeLabel} بمبلغ ${formatCurrency(amount, sym)} للموظف ${emp?.fullName}`);
        close();
        if (onSaved) onSaved(record);
      });
    },
  });
}

/**
 * Open list modal to view, edit, or delete all deductions and bonuses
 */
export function openDeductionsBonusesListModal(currentMonth, onUpdated) {
  const state = storage.getState();
  const { employees, increments, settings } = state;
  const sym = settings.currencySymbol || '$';
  const isEn = i18n.getLang() === 'en';

  const adjustments = (increments || []).filter(
    (x) => x.type === 'bonus' || x.type === 'deduction'
  );

  const bodyHtml = `
    <div style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
      <div>
        <div style="font-size:14px; font-weight:700; color:var(--text-main);">${isEn ? 'Deductions & Bonuses Adjustment Log' : 'سجل حركات الخصومات والمكافآت الشهرية'}</div>
        <div style="font-size:12px; color:var(--text-muted);">${isEn ? 'Manage and edit all one-off additions and penalty deductions' : 'يمكنك تعديل أو حذف أي خصم أو مكافأة تم تسجيلها'}</div>
      </div>
      <button type="button" class="btn btn-sm btn-primary" id="btn-add-new-from-list">
        ${Icons.plus(14)} ${isEn ? 'Add New Deduction/Bonus' : 'إضافة خصم أو مكافأة جديدة'}
      </button>
    </div>

    <div class="card" style="padding:0; overflow:hidden;">
      <div class="table-container" style="border:none; max-height:420px; overflow-y:auto;">
        <table class="table" style="font-size:12.5px;">
          <thead>
            <tr>
              <th>${isEn ? 'Employee' : 'الموظف'}</th>
              <th>${isEn ? 'Type' : 'النوع'}</th>
              <th>${isEn ? 'Amount' : 'المبلغ'}</th>
              <th>${isEn ? 'Month' : 'الشهر'}</th>
              <th>${isEn ? 'Reason' : 'السبب'}</th>
              <th>${isEn ? 'Date' : 'التاريخ'}</th>
              <th style="text-align:left;">${isEn ? 'Actions' : 'الإجراءات'}</th>
            </tr>
          </thead>
          <tbody>
            ${
              adjustments.length === 0
                ? `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">${isEn ? 'No deductions or bonuses recorded yet' : 'لا توجد حركات خصم أو مكافآت مسجلة حالياً'}</td></tr>`
                : adjustments
                    .map((adj) => {
                      const emp = employees.find((e) => e.id === adj.employeeId);
                      const isBonus = adj.type === 'bonus';
                      const amt = Math.abs(Number(adj.amount) || 0);
                      return `
                  <tr data-adj-id="${adj.id}">
                    <td>
                      <strong>${emp ? emp.fullName : (isEn ? 'Unknown' : 'غير محدد')}</strong>
                      <div style="font-size:11px; color:var(--text-muted);">${emp ? emp.employeeNumber : ''}</div>
                    </td>
                    <td>
                      <span class="badge ${isBonus ? 'badge-success' : 'badge-danger'}">
                        ${isBonus ? (isEn ? '🎁 Bonus' : '🎁 مكافأة') : (isEn ? '✂️ Deduction' : '✂️ خصم')}
                      </span>
                    </td>
                    <td><strong style="color:${isBonus ? 'var(--success)' : 'var(--danger)'}; font-size:13.5px;">${isBonus ? '+' : '-'}${formatCurrency(amt, sym)}</strong></td>
                    <td><span class="badge badge-gray">${adj.payrollPeriod || '-'}</span></td>
                    <td style="max-width:200px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${adj.reason}</td>
                    <td>${formatDate(adj.date)}</td>
                    <td style="text-align:left;">
                      <button type="button" class="btn btn-sm btn-outline btn-edit-adj" style="padding:4px 8px;" title="${isEn ? 'Edit' : 'تعديل'}">
                        ${Icons.edit(14)}
                      </button>
                    </td>
                  </tr>
                `;
                    })
                    .join('')
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  createModal({
    title: isEn ? 'Deductions & Bonuses Register' : 'سجل الخصومات والمكافآت',
    size: 'lg',
    bodyHtml,
    footerHtml: `<button type="button" class="btn btn-secondary close-modal-btn">${t('close')}</button>`,
    onOpen: (overlay, close) => {
      overlay.querySelector('.close-modal-btn').addEventListener('click', close);

      overlay.querySelector('#btn-add-new-from-list')?.addEventListener('click', () => {
        close();
        openDeductionBonusModal(null, () => {
          if (onUpdated) onUpdated();
        });
      });

      overlay.querySelectorAll('.btn-edit-adj').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const row = e.target.closest('tr');
          const adjId = row?.getAttribute('data-adj-id');
          const adj = adjustments.find((x) => x.id === adjId);
          if (adj) {
            close();
            openDeductionBonusModal(adj.employeeId, () => {
              if (onUpdated) onUpdated();
            }, adj);
          }
        });
      });
    },
  });
}
