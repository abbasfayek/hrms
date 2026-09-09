// ==========================================
// Deletion Log & Restore Modal
// Every permanently deleted record is archived here so a super admin
// (مدير النظام / المبرمج) can restore it at any time.
// ==========================================

import { createModal, showConfirmDialog } from './Modal.js';
import { Icons } from '../icons.js';
import { i18n } from '../i18n.js';
import { storage } from '../storage.js';
import { toast } from './Toast.js';
import { escapeHtml } from '../types.js';

export function openDeletedRecordsModal() {
  const isEn = i18n.getLang() === 'en';

  const collectionLabel = (col) => {
    const map = {
      companies: ['الشركات', 'Companies'],
      users: ['المستخدمون', 'Users'],
      employees: ['الموظفون', 'Employees'],
      leaves: ['الإجازات', 'Leaves'],
      hourly_leaves: ['الإجازات الزمنية', 'Hourly Leaves'],
      overtime: ['ساعات العمل الإضافي', 'Overtime'],
      loans: ['السلف والقروض', 'Loans & Advances'],
      increments: ['زيادات الرواتب', 'Salary Increments'],
      attendance: ['الحضور والانصراف', 'Attendance'],
      holidays: ['العطل الرسمية', 'Official Holidays'],
      payrolls: ['مسيرات الرواتب', 'Payrolls'],
      eosb: ['مستحقات نهاية الخدمة', 'EOSB'],
      settings: ['الإعدادات', 'Settings'],
    };
    const pair = map[col] || [col, col];
    return isEn ? pair[1] : pair[0];
  };

  const recordName = (rec) => {
    const d = rec.data || {};
    return escapeHtml(String(d.fullName || d.name || d.nameAr || d.username || d.title || d.id || rec.id || '—'));
  };

  const renderList = (overlay, keyword) => {
    const q = (keyword || '').trim().toLowerCase();
    const list = storage.getDeletedRecords().filter(
      (r) => !q
        || r.collection.toLowerCase().includes(q)
        || recordName(r).toLowerCase().includes(q)
        || (r.deletedBy || '').toLowerCase().includes(q)
    );

    const body = overlay.querySelector('#restore-records-body');
    if (!body) return;

    if (!list.length) {
      body.innerHTML = `
        <div style="text-align:center; padding:48px 20px; color:var(--text-muted);">
          <div style="font-size:40px; opacity:.4; margin-bottom:12px;">${Icons.trash(40)}</div>
          <strong style="font-size:15px;">${isEn ? 'Deletion log is empty' : 'سجل الحذف فارغ'}</strong>
          <div style="font-size:12.5px; margin-top:6px;">${isEn
            ? 'Everything you delete while this system runs is kept here for recovery.'
            : 'أي سجل تحذفه أثناء استخدام النظام يُحفظ هنا لاسترجاعه بسهولة.'}</div>
        </div>
      `;
      return;
    }

    body.innerHTML = list.map((rec) => {
      const name = recordName(rec);
      const at = new Date(rec.deletedAt || Date.now()).toLocaleString(isEn ? 'en-GB' : 'ar-IQ', { dateStyle: 'short', timeStyle: 'short' });
      const safeDeletedBy = escapeHtml(rec.deletedByName || rec.deletedBy);
      const safeReason = rec.reason && rec.reason !== 'deleted' ? escapeHtml(rec.reason) : '';
      return `
        <div class="card" style="padding:12px 14px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
            <div style="min-width:0; flex:1;">
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span class="badge" style="background:var(--primary-light); color:var(--primary); font-weight:800;">${collectionLabel(rec.collection)}</span>
                <span style="font-weight:800; font-size:14px; color:var(--text-main); word-break:break-word;">${name}</span>
              </div>
              <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
                ${isEn ? `Deleted ${at} by <strong>${safeDeletedBy}</strong>` : `حُذف ${at} بواسطة <strong>${safeDeletedBy}</strong>`}
                ${safeReason ? ` • ${isEn ? 'reason' : 'السبب'}: ${safeReason}` : ''}
              </div>
            </div>
            <div style="display:flex; gap:6px; flex-shrink:0;">
              <button type="button" class="btn btn-sm btn-primary btn-restore-rec" data-id="${rec.id}">${Icons.upload(14)} ${isEn ? 'Restore' : 'استرجاع'}</button>
              <button type="button" class="btn btn-sm btn-icon btn-outline btn-purge-rec" data-id="${rec.id}" style="color:var(--danger);" title="${isEn ? 'Erase forever' : 'حذف نهائي لا يمكن استرجاعه'}">${Icons.trash(15)}</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    body.querySelectorAll('.btn-restore-rec').forEach((btn) => {
      btn.addEventListener('click', () => {
        const res = storage.restoreDeletedRecord(btn.getAttribute('data-id'));
        if (res.success) {
          toast.success(isEn ? 'Record restored successfully' : 'تم استرجاع السجل بنجاح');
          storage.notify();
          renderList(overlay, (overlay.querySelector('#restore-search-input') || {}).value || '');
        } else {
          toast.error(isEn ? 'Could not restore this record' : 'تعذر استرجاع هذا السجل');
        }
      });
    });

    body.querySelectorAll('.btn-purge-rec').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        showConfirmDialog({
          title: isEn ? 'Erase record forever' : 'حذف نهائي للسجل',
          message: isEn
            ? 'This permanently erases the record. It can never be restored again. Continue?'
            : 'سيتم مسح هذا السجل نهائياً ولن يمكن استرجاعه أبداً. هل تريد المتابعة؟',
          confirmText: isEn ? 'Yes, erase' : 'نعم، امسح نهائياً',
          onConfirm: () => {
            storage.purgeDeletedRecord(id);
            toast.success(isEn ? 'Record erased permanently' : 'تم مسح السجل نهائياً');
            storage.notify();
            renderList(overlay, (overlay.querySelector('#restore-search-input') || {}).value || '');
          },
        });
      });
    });
  };

  createModal({
    title: `${isEn ? '🗑️ Deletion Log & Recovery' : '🗑️ سجل الحذف والاسترجاع'}`,
    size: 'lg',
    bodyHtml: `
      <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
        <div class="search-box" style="flex:1; max-width:340px;">
          <input type="text" class="form-input" id="restore-search-input" placeholder="${isEn
            ? 'Search type, name or user...'
            : 'ابحث بالنوع أو الاسم أو المستخدم...'}">
          <span class="search-icon">${Icons.clock(15)}</span>
        </div>
        <span style="font-size:12.5px; color:var(--text-muted); font-weight:700;">
          ${isEn ? 'Recovery available' : 'الاسترجاع متاح'} ✓
        </span>
      </div>
      <div id="restore-records-body"></div>
    `,
    footerHtml: `
      <button type="button" class="btn btn-secondary close-modal-btn">${isEn ? 'Close' : 'إغلاق'}</button>
    `,
    onOpen: (overlay, close) => {
      overlay.querySelector('.close-modal-btn').addEventListener('click', close);
      const search = overlay.querySelector('#restore-search-input');
      search.addEventListener('input', () => renderList(overlay, search.value));
      renderList(overlay, '');
    },
  });
}