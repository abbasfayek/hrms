// ==========================================
// Payroll Full Return Modal (P4 Fix #1)
// ==========================================
// Prompts the user for a mandatory return reason and executes
// a structured financial full return on an already-paid payroll batch.
// ==========================================

import { i18n } from '../i18n.js';
import { escapeHtml } from '../types.js';
import { toast } from './Toast.js';

export function openPayrollFullReturnModal({ batch, onConfirmed, isEn = i18n.getLang() === 'en' } = {}) {
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
          🔁 ${isEn ? 'Full Return / Reversal of Paid Payroll' : 'إعادة / ترجيع كامل لمسير رواتب مصروف'}
        </h3>
        <button type="button" class="btn-close-modal" style="background:none; border:none; font-size:20px; cursor:pointer; color:var(--text-muted);">&times;</button>
      </div>

      <div style="font-size:13px; color:var(--text-muted); margin-bottom:16px; line-height:1.5;">
        ${isEn
          ? `You are about to execute a full return for payroll month <strong>${escapeHtml(batch.month)}</strong>. This will reverse applied loan deductions, record audit metadata, and mark the batch as fully returned. The original record is preserved.`
          : `أنت على وشك تنفيذ ترجيع كامل لمسير رواتب شهر <strong>${escapeHtml(batch.month)}</strong>. سيتم عكس خصومات السلف المرتبطة وتسجيل سجل التدقيق والترجيع مع الاحتفاظ بالسجل الأصلي للمسير دون حذفه.`}
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:var(--text-main);">
          ${isEn ? 'Return Reason (Mandatory) *' : 'سبب الترجيع (إلزامي) *'}
        </label>
        <textarea id="full-return-reason-input" rows="3" placeholder="${isEn ? 'Enter detailed reason for full return...' : 'أدخل سبب الترجيع بالتفصيل...'}" style="width:100%; padding:10px; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-input); color:var(--text-main); font-size:13px; resize:vertical;"></textarea>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px; border-top:1px solid var(--border-color); padding-top:14px;">
        <button type="button" class="btn btn-outline btn-cancel-modal" style="padding:8px 16px;">
          ${isEn ? 'Cancel' : 'إلغاء'}
        </button>
        <button type="button" class="btn btn-danger btn-confirm-full-return" style="padding:8px 20px;">
          ${isEn ? 'Confirm Full Return' : 'تأكيد الترجيع الكامل'}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();

  overlay.querySelector('.btn-close-modal').addEventListener('click', closeModal);
  overlay.querySelector('.btn-cancel-modal').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  overlay.querySelector('.btn-confirm-full-return').addEventListener('click', () => {
    const reasonInput = overlay.querySelector('#full-return-reason-input');
    const reason = (reasonInput.value || '').trim();
    if (!reason) {
      toast.error(isEn ? 'Please enter a mandatory return reason.' : 'يرجى إدخال سبب الترجيع الإلزامي.');
      reasonInput.focus();
      return;
    }
    closeModal();
    if (onConfirmed) onConfirmed(reason);
  });
}
