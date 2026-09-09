// ==========================================
// Audit & Activity Log View
// - Bilingual (AR / EN)
// - Requires audit.view permission
// ==========================================

import { storage } from '../storage.js';
import { i18n, t } from '../i18n.js';
import { can } from '../types.js';

const ACTION_STYLES = {
  add: 'badge-success',
  edit: 'badge-info',
  delete: 'badge-danger',
  approve: 'badge-success',
  reject: 'badge-danger',
  generate: 'badge-primary',
  export: 'badge-info',
  settle: 'badge-success',
  reset: 'badge-warning',
};

const ACTION_KEYS = {
  add: 'audit.action.add',
  edit: 'audit.action.edit',
  delete: 'audit.action.delete',
  approve: 'audit.action.approve',
  reject: 'audit.action.reject',
  generate: 'audit.action.generate',
  export: 'audit.action.export',
  settle: 'audit.action.settle',
  reset: 'audit.action.reset',
};

export function renderAuditView(container) {
  const state = storage.getState();
  const currentUser = state.currentUser;
  const isEn = i18n.getLang() === 'en';

  if (!can(currentUser, 'audit.view')) {
    container.innerHTML = `
      <div class="card" style="padding:40px; text-align:center; color:var(--text-muted); margin-top:20px;">
        <div style="font-size:15px; font-weight:700;">${t('audit.noAccess')}</div>
      </div>
    `;
    return;
  }

  const log = state.audit || [];
  const actionLabel = (action) => {
    const key = ACTION_KEYS[action];
    return key ? t(key) : action;
  };
  const badgeClass = (action) => ACTION_STYLES[action] || 'badge-gray';

  const renderRows = (entries) => {
    if (!entries.length) {
      return `
        <tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">${t('audit.empty')}</td></tr>
      `;
    }
    return entries
      .map((e) => {
        const at = new Date(e.at).toLocaleString(isEn ? 'en-US' : 'ar', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        return `
          <tr>
            <td style="white-space:nowrap;">${at}</td>
            <td><strong>${e.userName || '-'}</strong></td>
            <td><span class="badge ${badgeClass(e.action)}" style="font-size:11px;">${actionLabel(e.action)}</span></td>
            <td>${e.targetType || '-'}</td>
            <td style="font-size:12.5px;">${e.summary || '-'}</td>
          </tr>
        `;
      })
      .join('');
  };

  container.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:20px;">
      <div>
        <h2 style="font-size:20px; font-weight:800; color:var(--text-main);">${t('audit.title')}</h2>
        <p style="font-size:13px; color:var(--text-muted);">${t('audit.subtitle')}</p>
      </div>
      <div style="position:relative; min-width:260px;">
        <input type="text" class="form-input" id="audit-search" placeholder="${t('audit.searchPlaceholder')}" style="padding-right:34px;">
      </div>
    </div>

    <div class="card" style="padding:0; overflow:hidden;">
      <div style="padding:14px 20px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between;">
        <div style="font-weight:700; font-size:14px; color:var(--text-main);">${t('audit.title')}</div>
        <span class="badge badge-primary" id="audit-count">${t('audit.resultsCount').replace('{count}', log.length)}</span>
      </div>
      <div class="table-container" style="border:none;">
        <table class="table">
          <thead>
            <tr>
              <th>${t('audit.dateTime')}</th>
              <th>${t('audit.user')}</th>
              <th>${t('audit.action')}</th>
              <th>${t('audit.target')}</th>
              <th>${t('audit.details')}</th>
            </tr>
          </thead>
          <tbody id="audit-body">
            ${renderRows(log.slice(0, 300))}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const searchInput = container.querySelector('#audit-search');
  const auditBody = container.querySelector('#audit-body');
  const auditCount = container.querySelector('#audit-count');

  searchInput?.addEventListener('input', () => {
    const q = (searchInput.value || '').trim().toLowerCase();
    const filtered = q
      ? log.filter((e) => (e.userName || '').toLowerCase().includes(q) || (e.targetType || '').toLowerCase().includes(q) || (e.summary || '').toLowerCase().includes(q))
      : log;
    auditBody.innerHTML = renderRows(filtered.slice(0, 300));
    auditCount.textContent = t('audit.resultsCount').replace('{count}', filtered.length);
  });
}