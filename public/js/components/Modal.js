// ==========================================
// Reusable Modal Component
// ==========================================

import { Icons } from '../icons.js';
import { t } from '../i18n.js';

export function createModal({ title, size = 'md', bodyHtml, footerHtml, onOpen, onClose }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const sizeClass = size === 'lg' ? 'modal-lg' : size === 'xl' ? 'modal-xl' : '';

  overlay.innerHTML = `
    <div class="modal-content ${sizeClass}">
      <div class="modal-header">
        <div class="modal-title">${title}</div>
        <button type="button" class="btn btn-icon btn-outline close-btn">
          ${Icons.x(18)}
        </button>
      </div>
      <div class="modal-body">
        ${bodyHtml}
      </div>
      ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.2s ease';
    setTimeout(() => {
      overlay.remove();
      if (onClose) onClose();
    }, 200);
  };

  overlay.querySelector('.close-btn').addEventListener('click', close);

  if (onOpen) onOpen(overlay, close);

  return { overlay, close };
}

export function showConfirmDialog({ title, message, confirmText = t('confirm'), cancelText = t('cancel'), onConfirm }) {
  createModal({
    title: `<span style="color:var(--danger);">${Icons.alertCircle(20)} ${title}</span>`,
    size: 'sm',
    bodyHtml: `<p style="font-size:15px; color:var(--text-main);">${message}</p>`,
    footerHtml: `
      <button type="button" class="btn btn-secondary cancel-dialog-btn">${cancelText}</button>
      <button type="button" class="btn btn-danger confirm-dialog-btn">${confirmText}</button>
    `,
    onOpen: (overlay, close) => {
      overlay.querySelector('.cancel-dialog-btn').addEventListener('click', close);
      overlay.querySelector('.confirm-dialog-btn').addEventListener('click', () => {
        close();
        if (onConfirm) onConfirm();
      });
    },
  });
}
