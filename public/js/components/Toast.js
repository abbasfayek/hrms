// ==========================================
// Toast Notification Component
// ==========================================

import { Icons } from '../icons.js';
import { escapeHtml } from '../types.js';

class ToastManager {
  constructor() {
    this.container = null;
    this.ensureContainer();
  }

  ensureContainer() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  }

  show(message, type = 'success', duration = 3500) {
    this.ensureContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconHtml = Icons.checkCircle(18);
    if (type === 'danger') iconHtml = Icons.alertCircle(18);
    if (type === 'warning') iconHtml = Icons.alertCircle(18);

    toast.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        ${iconHtml}
        <span>${escapeHtml(message)}</span>
      </div>
    `;

    this.container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  success(msg) {
    this.show(msg, 'success');
  }

  error(msg) {
    this.show(msg, 'danger');
  }

  warning(msg) {
    this.show(msg, 'warning');
  }
}

export const toast = new ToastManager();
