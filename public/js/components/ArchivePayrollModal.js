// ==========================================
// Archive Previous Months Payroll Modal
// One-time batch archival of months that were paid manually outside the
// system (before the app went live). Records a monthly summary only — no
// per-employee breakdown — so legacy months appear in the disbursed &
// archived payroll log without re-entering every employee from scratch.
// ==========================================

import { createModal } from './Modal.js';
import { storage } from '../storage.js';
import { Icons } from '../icons.js';
import { formatPayMonth } from '../types.js';
import { toast } from './Toast.js';
import { t, i18n } from '../i18n.js';

export function openArchivePayrollModal({ onDone }) {
  const isEn = i18n.getLang() === 'en';
  const todayISO = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getFullYear();

  const rowHtml = (month = '', gross = '', deductions = '', count = '', paidDate = todayISO, note = '') => `
    <div class="archive-payroll-row" style="display:grid; grid-template-columns:110px 1fr 1fr 1fr 90px 130px 1fr 36px; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap;">
      <input type="month" class="form-input ap-month" value="${month}" style="padding:7px 8px;" title="${isEn ? 'Month' : 'الشهر'}">
      <input type="number" class="form-input ap-gross" value="${gross}" min="0" step="0.01" placeholder="${isEn ? 'Total Gross' : 'إجمالي الاستحقاق'}" style="padding:7px 8px;" inputmode="decimal">
      <input type="number" class="form-input ap-deductions" value="${deductions}" min="0" step="0.01" placeholder="${isEn ? 'Total Deductions' : 'إجمالي الاستقطاع'}" style="padding:7px 8px;" inputmode="decimal">
      <input type="number" class="form-input ap-net" min="0" step="0.01" placeholder="${isEn ? 'Net' : 'الصافي (تلقائي)'}" style="padding:7px 8px;" inputmode="decimal">
      <input type="number" class="form-input ap-count" value="${count}" min="1" placeholder="${isEn ? 'Employees' : 'عدد الموظفين'}" style="padding:7px 8px;" inputmode="numeric">
      <input type="date" class="form-input ap-paid-date" value="${paidDate}" style="padding:7px 8px;" title="${isEn ? 'Disbursed date' : 'تاريخ الصرف'}">
      <input type="text" class="form-input ap-note" value="${note}" placeholder="${isEn ? 'Note (optional)' : 'ملاحظة (اختياري)'}" style="padding:7px 8px;">
      <button type="button" class="btn btn-icon btn-outline ap-remove" title="${isEn ? 'Remove' : 'حذف'}">${Icons.trash(15)}</button>
    </div>
  `;

  const fillers = Array.from({ length: 8 }, (_, i) => String(i + 1).padStart(2, '0')).map(
    (m) => rowHtml(`${currentYear}-${m}`),
  ).join('');

  const bodyHtml = `
    <div style="margin-bottom:16px;">
      <div style="font-size:13.5px; font-weight:800; color:var(--text-main);">
        ${isEn ? 'One-time archival of previously paid months' : 'أرشفة لمرة واحدة للأشهر التي تم صرفها مسبقاً'}
      </div>
      <div style="font-size:12.5px; color:var(--text-muted); margin-top:4px; line-height:1.7;">
        ${isEn
          ? 'Record the total gross, total deductions and net amount paid for each legacy month. Each row becomes a paid & archived payroll in the disbursed log — no need to re-enter every employee.'
          : 'سجّل إجمالي الاستحقاق والاستقطاع والصافي لكل شهر سابق. كل صف يتحول إلى مسير مدفوع ومؤرشف في سجل الرواتب المصروفة، بدون إعادة إدخال تفاصيل كل موظف من الصفر.'}
      </div>
    </div>

    <div class="card" style="padding:0; overflow:hidden; margin-bottom:12px;">
      <div style="padding:12px 16px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <button type="button" class="btn btn-outline btn-sm" id="btn-ap-fill-year">
          ${Icons.plus(14)} ${isEn ? 'Add Jan → Aug of this year' : 'إضافة أشهر 1 → 8 من هذه السنة'}
        </button>
        <button type="button" class="btn btn-outline btn-sm" id="btn-ap-add-row">
          ${Icons.plus(14)} ${isEn ? 'Add empty row' : 'إضافة صف فارغ'}
        </button>
        <span style="flex:1;"></span>
        <span style="font-size:11.5px; color:var(--text-muted);">
          ${isEn ? 'Net = Gross − Deductions (auto-calculated)' : 'الصافي = الاستحقاق − الاستقطاع (يُحسب تلقائياً)'}
        </span>
      </div>
      <div style="padding:14px 16px; overflow-x:auto;" id="ap-rows">
        ${fillers}
      </div>
    </div>

    <div class="alert-box alert-warning" style="padding:12px 16px; border-radius:8px; font-size:12.5px;">
      ${isEn
        ? 'Existing payroll for a month already saved in the system will be replaced by the archived summary.'
        : 'إذا كان يوجد مسير محفوظ لأي شهر من هذه الأشهر، سيتم استبداله بالملخص المؤرشف.'}
    </div>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-primary" id="btn-ap-save">
      ${Icons.checkCircle(16)} ${isEn ? 'Archive Months' : 'أرشفة الأشهر المحددة'}
    </button>
  `;

  createModal({
    title: `${isEn ? 'Archive Pre-App Payrolls' : 'أرشفة رواتب الأشهر السابقة'}`,
    size: 'lg',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      const rowsEl = overlay.querySelector('#ap-rows');

      const addRow = (html) => {
        const div = document.createElement('div');
        div.innerHTML = html;
        rowsEl.appendChild(div.firstElementChild);
        bindRow(rowsEl.lastElementChild);
      };

      const bindRow = (row) => {
        const gross = row.querySelector('.ap-gross');
        const deps = row.querySelector('.ap-deductions');
        const net = row.querySelector('.ap-net');
        const recalc = () => {
          const g = Number(gross.value) || 0;
          const d = Number(deps.value) || 0;
          net.value = (g - d).toFixed(2);
        };
        gross.addEventListener('input', recalc);
        deps.addEventListener('input', recalc);
        row.querySelector('.ap-remove')?.addEventListener('click', () => row.remove());
      };

      rowsEl.querySelectorAll('.archive-payroll-row').forEach(bindRow);

      overlay.querySelector('#btn-ap-add-row')?.addEventListener('click', () => addRow(rowHtml()));
      overlay.querySelector('#btn-ap-fill-year')?.addEventListener('click', () => {
        [...rowsEl.querySelectorAll('.archive-payroll-row')].forEach((r) => r.remove());
        addRow(fillers);
        [...rowsEl.querySelectorAll('.archive-payroll-row')].forEach(bindRow);
      });

      overlay.querySelectorAll('.close-modal-btn').forEach((b) => b.addEventListener('click', close));

      overlay.querySelector('#btn-ap-save')?.addEventListener('click', () => {
        const rows = [...rowsEl.querySelectorAll('.archive-payroll-row')];
        const valid = [];
        for (const row of rows) {
          const month = row.querySelector('.ap-month').value;
          const gross = Number(row.querySelector('.ap-gross').value) || 0;
          const deductions = Number(row.querySelector('.ap-deductions').value) || 0;
          const net = Number(row.querySelector('.ap-net').value);
          const count = Number(row.querySelector('.ap-count').value) || 0;
          const paidDate = row.querySelector('.ap-paid-date').value || todayISO;
          const note = row.querySelector('.ap-note').value.trim();
          if (!month) continue;
          if (count === 0 && gross === 0 && deductions === 0 && !net) {
            toast.warning(isEn ? 'Fill the totals for each month or remove empty rows.' : 'عبّئ إجماليات كل شهر أو احذف الصفوف الفارغة.');
            return;
          }
          valid.push({ month, gross, deductions, net: Number.isFinite(net) ? net : gross - deductions, count, paidDate, note });
        }
        if (valid.length === 0) {
          toast.warning(isEn ? 'Select at least one month to archive.' : 'حدد شهراً واحداً على الأقل للأرشفة.');
          return;
        }

        const createdAt = new Date().toISOString();
        const paidBy = storage.getActiveUser()?.name || 'Finance Manager';

        valid.forEach(({ month, gross, deductions, net, count, paidDate, note }) => {
          // Reuse an existing batch id for this month (or the standard
          // PAYROLL-{month} format) so the cross-device merge keys on the SAME
          // id and the archived copy replaces any draft, never duplicating it.
          const existing = storage.getState().payrolls.find((b) => b.month === month);
          const batchId = existing && existing.id ? existing.id : `PAYROLL-${month}`;
          const batch = {
            id: batchId,
            month,
            title: isEn ? `Monthly Payroll ${month}` : `مسير الرواتب الشهري ${formatPayMonth(month)}`,
            issueDate: paidDate,
            status: 'paid',
            totalGross: gross,
            totalDeductions: deductions,
            totalNet: net,
            totalCompanyGosi: 0,
            employeesCount: count,
            items: [],
            createdAt,
            isArchivedLegacy: true,
            archiveNote: note || (isEn ? 'Recorded after the fact (manual archival)' : 'سُجل بأثر رجعي (أرشفة يدوية)'),
            releasePayDay: 25,
            releaseDate: `${month}-25`,
            releaseStatus: 'released',
            releasedAt: new Date(paidDate).toISOString(),
            releasedBy: paidBy,
            paidAt: new Date(paidDate).toISOString(),
            paidBy,
          };
          storage.addPayrollBatch(batch);
          storage.addAudit('archive', 'payroll', `${month} → ${isEn ? 'archived as paid (legacy)' : 'أرشفة كمسير مدفوع (سابق)'}`, batch.id);
        });

        toast.success(isEn ? `Archived ${valid.length} month(s) to the disbursed log.` : `تمت أرشفة ${valid.length} شهراً من المسيرات إلى سجل الرواتب المصروفة.`);
        close();
        if (onDone) onDone();
      });
    },
  });
}