// ==========================================
// Payroll Reactivate Modal (FR-1-D2b)
// ==========================================
// System Admin ONLY: audited reactivation / reopen of a fully-returned payroll
// batch (approved + fullReturn.completed). Prompts for a mandatory reason and
// releases the D2 lock into the "Returned / Needs Correction" (rejected)
// reprocessing state. Financial values are NEVER recomputed or cleared.

import { i18n } from '../i18n.js';
import { escapeHtml } from '../types.js';
import { toast } from './Toast.js';

export function openPayrollReactivateModal({ batch, onConfirmed, isEn = i18n.getLang() === 'en' } = {}) {
  if (!batch) return;

  const existingOverlay = document.querySelector('.modal-overlay');
  if (existingOverlay) existingOverlay.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10000;';

  overlay.innerHTML = `
    <div class="modal-card" style="background:var(--bg-card); color:var(--text-main); padding:24px; border-radius:12px; width:100%; max-width:520px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.1); border:1px solid var(--border-color); direction:${isEn ? 'ltr' : 'rtl'}; text-align:${isEn ? 'left' : 'right'};">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid var(--border-color); padding-bottom:12px;">
        <h3 style="font-size:18px; font-weight:800; color:var(--text-main); margin:0;">
          🔓 ${isEn ? 'Reactivate Fully-Returned Payroll (System Admin)' : 'إعادة فتح مسير مُرجَّع بالكامل (System Admin)'}
        </h3>
        <button type="button" class="btn-close-modal" style="background:none; border:none; font-size:20px; cursor:pointer; color:var(--text-muted);">&times;</button>
      </div>

      <div style="font-size:13px; color:var(--text-muted); margin-bottom:16px; line-height:1.5;">
        ${isEn
          ? `You are about to reactivate payroll month <strong>${escapeHtml(batch.month)}</strong> which was fully returned. This audit-trailed System Admin action reopens the batch as <strong>Returned / Needs Correction</strong>. NO financial value, snapshot, total, payment or loan is changed by this action.`
          : `أنت على وشك إعادة فتح مسير رواتب شهر <strong>${escapeHtml(batch.month)}</strong> الذي تم ترجيعه بالكامل. هذا الإجراء الإداري المُدوَّن يعيد المسير كحالة <strong>مُرجَّع / يلزم تصحيح</strong>. لا يتغير أي قيمة مالية أو لقطة أو مجمّع أو صرف أو سلفة بموجب هذا الإجراء.`}
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:var(--text-main);">
          ${isEn ? 'Reactivation Reason (Mandatory) *' : 'سبب إعادة الفتح (إلزامي) *'}
        </label>
        <textarea id="reactivate-reason-input" rows="3" placeholder="${isEn ? 'Enter detailed reason for reactivation...' : 'أدخل سبب إعادة الفتح بالتفصيل...'}" style="width:100%; padding:10px; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-input); color:var(--text-main); font-size:13px; resize:vertical;"></textarea>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px; border-top:1px solid var(--border-color); padding-top:14px;">
        <button type="button" class="btn btn-outline btn-cancel-modal" style="padding:8px 16px;">
          ${isEn ? 'Cancel' : 'إلغاء'}
        </button>
        <button type="button" class="btn btn-danger btn-confirm-reactivate" style="padding:8px 20px;">
          ${isEn ? 'Confirm Reactivation' : 'تأكيد إعادة الفتح'}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();

  overlay.querySelector('.btn-close-modal').addEventListener('click', closeModal);
  overlay.querySelector('.btn-cancel-modal').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.querySelector('.btn-confirm-reactivate').addEventListener('click', () => {
    const reasonInput = overlay.querySelector('#reactivate-reason-input');
    const reason = (reasonInput.value || '').trim();
    if (!reason) {
      toast.error(isEn ? 'Please enter a mandatory reactivation reason.' : 'يرجى إدخال سبب إعادة الفتح الإلزامي.');
      reasonInput.focus();
      return;
    }
    closeModal();
    if (onConfirmed) onConfirmed(reason);
  });
}