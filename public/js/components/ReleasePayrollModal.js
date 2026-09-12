// ==========================================
// Release Payroll Modal - "Dual Release" final review & confirmation
// On payday the month payroll is displayed for review (preview), then the
// manager confirms the final release. Benefits everyone on the system.
// ==========================================

import { createModal } from "./Modal.js";
import { formatCurrency, formatDate, formatPayMonth } from "../types.js";
import { t, i18n } from '../i18n.js';

export function openReleasePayrollModal({ batch, companies, settings, onConfirm }) {
  const isEn = i18n.getLang() === 'en';
  const sym = settings.currencySymbol || '$';
  const items = batch.items || [];

  const branchIds = [...new Set(items.map((it) => it.branchId).filter(Boolean))];
  const branchNames = [];
  companies.forEach((c) => {
    (c.branches || []).forEach((b) => {
      if (branchIds.includes(b.id)) branchNames.push(isEn && b.nameEn ? b.nameEn : b.nameAr);
    });
  });
  const payDay = batch.releasePayDay || 25;
  const releaseDate = batch.releaseDate || `${batch.month}-${String(payDay).padStart(2, '0')}`;
  const alreadyReleased = batch.releaseStatus === 'released' || batch.status === 'paid';

  const rows = items
    .map((it, idx) => `
      <tr>
        <td style="padding:8px; color:var(--text-muted);">${idx + 1}</td>
        <td style="padding:8px;">${it.employeeNumber || '-'}</td>
        <td style="padding:8px;">
          <strong>${it.employeeName}</strong>
          <div style="font-size:11px; color:var(--text-muted);">${it.department || ''}</div>
        </td>
        <td style="padding:8px; text-align:left;"><strong style="color:var(--success);">${formatCurrency(it.netSalary, sym)}</strong></td>
      </tr>
    `)
    .join('');

  const bodyHtml = `
    <div style="font-size:13px;">
      <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:16px;">
        <div style="background:var(--bg-card-hover); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:10px 12px;">
          <div style="font-size:11px; color:var(--text-muted);">${isEn ? 'Payroll Month' : 'شهر المسير'}</div>
          <div style="font-weight:800; font-size:15px; color:var(--text-main);">${formatPayMonth(batch.month)}</div>
        </div>
        <div style="background:var(--bg-card-hover); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:10px 12px;">
          <div style="font-size:11px; color:var(--text-muted);">${isEn ? 'Release Date (Payday)' : 'موعد التحرير (يوم الصرف)'}</div>
          <div style="font-weight:800; font-size:15px; color:var(--primary);">${formatDate(releaseDate)} <span class="badge badge-info" style="font-size:10px;">${payDay} ${isEn ? '/ month' : '/ الشهر'}</span></div>
        </div>
        <div style="background:var(--bg-card-hover); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:10px 12px;">
          <div style="font-size:11px; color:var(--text-muted);">${isEn ? 'Beneficiaries' : 'عدد المستفيدين'}</div>
          <div style="font-weight:800; font-size:15px; color:var(--text-main);">${items.length} ${isEn ? 'employees' : 'موظف'}</div>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:16px; background:linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(79,70,229,0.1) 100%); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:12px 16px;">
        <div>
          <div style="font-size:11px; color:var(--text-muted);">${isEn ? 'Total Net Amount to be transferred (final)' : 'إجمالي صافي المبلغ النهائي المطلوب تحويله'}</div>
          <div style="font-size:22px; font-weight:900; color:var(--success);">${formatCurrency(batch.totalNet, sym)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px; color:var(--text-muted);">${isEn ? 'Branches included' : 'الفروع المشمولة'}</div>
          <div style="font-size:13px; font-weight:700; color:var(--text-main);">${branchNames.length ? branchNames.join(' • ') : (isEn ? 'All branches' : 'جميع الفروع')}</div>
        </div>
      </div>

      <div style="font-weight:700; font-size:14px; color:var(--text-main); margin-bottom:8px;">📋 ${isEn ? 'Final Review of Net Salaries' : 'المراجعة النهائية للمبالغ الصافية'} (${items.length})</div>

      ${
        items.length === 0
          ? `<div style="text-align:center; padding:28px; color:var(--text-muted); border:1px dashed var(--border-color); border-radius:var(--radius-md);">${isEn ? 'No employees in this payroll to release.' : 'لا يوجد موظفون في هذا المسير لتحريره.'}</div>`
          : `<div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); max-height:320px; overflow-y:auto;">
              <table class="table" style="font-size:12.5px;">
                <thead style="position:sticky; top:0; background:var(--bg-card-hover);">
                  <tr>
                    <th style="padding:8px;">#</th>
                    <th style="padding:8px;">${t('payroll.employee')}</th>
                    <th style="padding:8px; text-align:right;">${isEn ? 'Net Salary' : 'صافي الراتب'}</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>`
      }

      <div style="margin-top:14px; font-size:12px; color:var(--text-muted); background:var(--bg-card-hover); border:1px solid var(--border-color); padding:10px 14px; border-radius:var(--radius-md); display:flex; align-items:center; gap:8px;">
        💰 ${alreadyReleased
          ? (isEn ? 'This payroll has already been released. You are viewing the final review.' : 'تم تحرير هذا المسير مسبقاً. أنت تتصفح المراجعة النهائية فقط.')
          : (isEn ? 'By confirming, salaries are officially released (marked paid on payday) and loan/advance installments are settled. This action cannot be undone.' : 'بتأكيد التحرير، تُصرف الرواتب رسمياً في يوم الصرف وتسدد أقساط السلف المستقطعة. لا يمكن التراجع عن هذا الإجراء.')}
      </div>
    </div>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-release-btn">${t('cancel')}</button>
    ${!alreadyReleased ? `
      <button type="button" class="btn btn-success confirm-release-btn">
        💵 ${isEn ? 'Confirm Final Release & Pay Salaries' : 'تأكيد التحرير النهائي وصرف الرواتب'}
      </button>
    ` : ''}
  `;

  createModal({
    title: `${isEn ? 'Final Payroll Release' : 'التحرير النهائي للرواتب'} - ${formatPayMonth(batch.month)}`,
    size: 'lg',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      overlay.querySelector('.close-release-btn')?.addEventListener('click', close);
      const confirmBtn = overlay.querySelector('.confirm-release-btn');
      confirmBtn?.addEventListener('click', () => {
        if (confirmBtn.disabled) return;
        confirmBtn.disabled = true;
        close();
        if (onConfirm) onConfirm();
      });
    },
  });
}