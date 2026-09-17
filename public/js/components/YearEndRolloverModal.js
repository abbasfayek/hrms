// ==========================================
// Year-End Leave Rollover & New Year Balance Wizard
// ==========================================

import { storage } from '../storage.js';
import { toast } from './Toast.js';
import { createModal } from './Modal.js';
import { Icons } from '../icons.js';
import { formatCurrency } from '../types.js';
import { executeYearEndRollover, calculateLeaveBalance } from '../engines/leaveEngine.js';
import { i18n, t } from '../i18n.js';

export function openYearEndRolloverModal(onExecuted) {
  const state = storage.getState();
  const { employees, leaves, settings, selectedCompanyId, selectedBranchId } = state;
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  const isEn = i18n.getLang() === 'en';

  const bodyHtml = `
    <div style="display:flex; flex-direction:column; gap:18px;">
      
      <!-- Informational Banner -->
      <div class="alert-box alert-info">
        <div style="font-size:18px;">${Icons.refresh(20)}</div>
        <div>
          <strong>${t('rolloverBannerText')}</strong>
          <div style="font-size:12.5px; margin-top:2px;">
            ${t('rolloverBannerSub')}
          </div>
        </div>
      </div>

      <!-- Configuration Grid -->
      <div class="card" style="padding:16px; background:var(--bg-card-hover);">
        <div class="grid grid-cols-3">
          <div class="form-group">
            <label class="form-label">${t('targetYear')}</label>
            <input type="number" class="form-input" id="rollover-target-year" value="${nextYear}" min="2024" max="2035">
          </div>

          <div class="form-group">
            <label class="form-label">${t('maxCarryoverDays')}</label>
            <input type="number" class="form-input" id="rollover-max-days" value="${settings.maxCarryOverDays || 15}" min="0" max="60">
            <span style="font-size:11.5px; color:var(--text-muted);">${isEn ? '0 means roll over all days with no limit' : '0 يعني ترحيل كافة الأيام بدون حد'}</span>
          </div>

          <div class="form-group">
            <label class="form-label">${t('rolloverOption')}</label>
            <select class="form-select" id="rollover-mode-select">
              <option value="rollover" selected>${t('rolloverToNewYear')}</option>
              <option value="cashout">${t('cashoutRemaining')}</option>
            </select>
          </div>
        </div>

        <div style="margin-top:10px; display:flex; align-items:center; gap:10px;">
          <input type="checkbox" id="rollover-renew-entitlement" checked style="width:18px; height:18px; cursor:pointer;">
          <label for="rollover-renew-entitlement" style="font-size:13.5px; font-weight:700; cursor:pointer; color:var(--text-main);">
            ${t('autoRenewEntitlement')}
          </label>
        </div>
      </div>

      <!-- Live Preview Table -->
      <div>
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <h4 style="font-size:14px; font-weight:700; color:var(--text-main);">${isEn ? 'Preview Rollover Impact on Employees' : 'معاينة أثر الترحيل على الموظفين'}</h4>
          <span class="badge badge-primary" id="rollover-preview-count">0 ${isEn ? 'active employees' : 'موظف نشط'}</span>
        </div>

        <div class="table-container" style="max-height: 260px; overflow-y:auto;">
          <table class="table">
            <thead>
              <tr>
                <th>${t('att.employee')}</th>
                <th>${isEn ? 'Current Remaining Balance' : 'الرصيد المتبقي حالياً'}</th>
                <th>${isEn ? 'Rolled Over to New Year' : 'الرصيد المرحّل للسنة الجديدة'}</th>
                <th>${isEn ? 'Expired / Cashed Out' : 'الأيام الساقطة / المصروفة'}</th>
                <th>${isEn ? 'New Annual Entitlement' : 'الاستحقاق السنوي الجديد'}</th>
              </tr>
            </thead>
            <tbody id="rollover-preview-tbody">
              <!-- Rendered dynamically -->
            </tbody>
          </table>
        </div>
      </div>

    </div>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-success execute-rollover-btn">
      ${Icons.check(16)} ${isEn ? 'Approve, Roll Over & Add New Year Balance' : 'اعتماد وترحيل وإضافة رصيد السنة الجديدة'}
    </button>
  `;

  createModal({
    title: t('rolloverWizardTitle'),
    size: 'lg',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      const yearInput = overlay.querySelector('#rollover-target-year');
      const maxDaysInput = overlay.querySelector('#rollover-max-days');
      const modeSelect = overlay.querySelector('#rollover-mode-select');
      const renewCheck = overlay.querySelector('#rollover-renew-entitlement');
      const previewTbody = overlay.querySelector('#rollover-preview-tbody');
      const countBadge = overlay.querySelector('#rollover-preview-count');

      function updatePreview() {
        const targetYear = Number(yearInput.value) || nextYear;
        const maxDays = Number(maxDaysInput.value);
        const cashOutUnused = modeSelect.value === 'cashout';
        const renewAnnualEntitlement = renewCheck.checked;

        const { rolloverResults } = executeYearEndRollover(
          employees,
          leaves,
          { targetYear, maxCarryOverDays: maxDays, cashOutUnused, renewAnnualEntitlement },
          settings
        );

        countBadge.textContent = `${rolloverResults.length} ${isEn ? 'active employees' : 'موظف نشط'}`;

        previewTbody.innerHTML = rolloverResults
          .map(
            (r) => `
            <tr>
              <td><strong>${r.employeeName}</strong></td>
              <td><span class="badge badge-gray">${r.previousRemaining} ${isEn ? 'days' : 'يوم'}</span></td>
              <td><strong style="color:var(--success);">${r.carriedOverToNewYear} ${isEn ? 'days' : 'يوم'}</strong></td>
              <td>
                ${
                  cashOutUnused
                    ? `<span style="color:var(--primary); font-weight:700;">${isEn ? 'Cash payout' : 'صرف نقدي'} (${formatCurrency(r.cashOutAmount, settings.currencySymbol)})</span>`
                    : r.expiredDays > 0
                    ? `<span style="color:var(--danger); font-weight:700;">${isEn ? 'Expired' : 'سقوط'} ${r.expiredDays} ${isEn ? 'days' : 'يوم'}</span>`
                    : '<span style="color:var(--text-muted);">-</span>'
                }
              </td>
              <td><strong style="color:var(--primary);">+ ${r.newAnnualEntitlement} ${isEn ? 'days' : 'يوم'}</strong></td>
            </tr>
          `
          )
          .join('');
      }

      yearInput.addEventListener('input', updatePreview);
      maxDaysInput.addEventListener('input', updatePreview);
      modeSelect.addEventListener('change', updatePreview);
      renewCheck.addEventListener('change', updatePreview);
      updatePreview();

      overlay.querySelector('.close-modal-btn').addEventListener('click', close);

      overlay.querySelector('.execute-rollover-btn').addEventListener('click', () => {
        const targetYear = Number(yearInput.value) || nextYear;
        const maxDays = Number(maxDaysInput.value);
        const cashOutUnused = modeSelect.value === 'cashout';
        const renewAnnualEntitlement = renewCheck.checked;

        const { updatedEmployees, rolloverResults } = executeYearEndRollover(
          employees,
          leaves,
          { targetYear, maxCarryOverDays: maxDays, cashOutUnused, renewAnnualEntitlement },
          settings
        );

        // X-1: merge only the rolled-over employees back into the FULL stored
        // collection, so out-of-scope employees are preserved unchanged.
        storage.mergeEmployeeUpdatesById(updatedEmployees);
        const rolloverScoped = selectedCompanyId !== 'all' || selectedBranchId !== 'all';
        toast.success(
          rolloverScoped
            ? (isEn ? `Leave balances rolled over & renewed for ${targetYear} for the selected company/branch scope (${rolloverResults.length} employees).` : `تم بنجاح ترحيل وتجديد أرصدة الإجازات لسنة ${targetYear} للنطاق المحدد (${rolloverResults.length} موظف).`)
            : (isEn ? `Leave balances rolled over & renewed for ${targetYear} for all employees (${rolloverResults.length} employees).` : `تم بنجاح ترحيل وتجديد أرصدة الإجازات لسنة ${targetYear} لجميع الموظفين (${rolloverResults.length} موظف).`)
        );
        close();
        if (onExecuted) onExecuted(rolloverResults);
      });
    },
  });
}
