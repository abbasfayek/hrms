// ==========================================
// Users & Granular Permissions Management View
// - Bilingual (AR / EN)
// - Permission summary per user
// - Actions gated by the signed-in user's permissions
// ==========================================

import { storage } from '../storage.js';
import { Icons } from '../icons.js';
import { i18n, t } from '../i18n.js';
import { openUserModal } from './UserModal.js';
import { showConfirmDialog } from './Modal.js';
import { toast } from './Toast.js';
import { USER_ROLES, can, PERMISSION_MODULES, PERMISSIONS } from '../types.js';

export function renderUsersView(container, options = {}) {
  const state = storage.getState();
  const { users, companies } = state;
  const visibleUsers = users.filter((u) => !u.hidden);
  const currentUser = state.currentUser;
  const isEn = i18n.getLang() === 'en';

  const canManage = can(currentUser, 'users.manage');
  const canAudit = can(currentUser, 'audit.view');

  const moduleLabel = (id) => {
    const m = PERMISSION_MODULES.find((mod) => mod.id === id);
    return m ? (isEn ? m.nameEn : m.nameAr) : id;
  };

  const permModulesChips = (u) => {
    const perms = Array.isArray(u.permissions) ? u.permissions : [];
    const modules = PERMISSION_MODULES.filter((m) => perms.some((p) => (PERMISSIONS[p] || {}).module === m.id));
    const chips = modules.map((m) => `<span class="badge badge-gray" style="font-size:10px; margin:2px;">${isEn ? m.nameEn : m.nameAr}</span>`).join('');
    return `<span class="perm-chips">${chips || `<span class="badge badge-danger" style="font-size:10px;">${t('users.noScope')}</span>`}</span>`;
  };

  container.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:20px;">
      <div>
        <h2 style="font-size:20px; font-weight:800; color:var(--text-main);">${t('users.usersTable')}</h2>
        <p style="font-size:13px; color:var(--text-muted);">${t('usersSub')}</p>
      </div>

      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        ${
          canAudit
            ? `<button type="button" class="btn btn-outline" id="btn-audit-log">
                ${Icons.clock(16)} ${t('users.auditLog')}
              </button>`
            : ''
        }
        ${
          canManage
            ? `<button type="button" class="btn btn-primary" id="btn-add-user">
                ${Icons.userPlus(16)} ${t('users.addNewUser')}
              </button>`
            : ''
        }
      </div>
    </div>

    <div class="card" style="padding:0; overflow:hidden;">
      <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between;">
        <div style="font-weight:700; font-size:15px; color:var(--text-main);">
          ${t('users.usersTable')}
        </div>
        <span class="badge badge-primary">${t('users.count').replace('{count}', visibleUsers.length)}</span>
      </div>

      <div class="table-container" style="border:none;">
        <table class="table">
          <thead>
            <tr>
              <th>${t('users.user')}</th>
              <th>${t('users.usernameCol')}</th>
              <th>${t('email')}</th>
              <th>${t('users.userRole')}</th>
              <th>${t('users.permissions')}</th>
              <th>${t('users.companyScope')}</th>
              <th>${t('users.branchScope')}</th>
              <th style="text-align:left;">${t('actionsCol')}</th>
            </tr>
          </thead>
          <tbody>
            ${
              visibleUsers.length
                ? visibleUsers
                    .map((u) => {
                      const comp = companies.find((c) => c.id === u.assignedCompanyId);
                      const branch = comp ? (comp.branches || []).find((b) => b.id === u.assignedBranchId) : null;
                      const isCurrent = u.id === currentUser.id;
                      const permCount = Array.isArray(u.permissions) ? u.permissions.length : 0;
                      const roleObj = USER_ROLES[u.role];

                      return `
                <tr data-user-id="${u.id}">
                  <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                      <div class="user-avatar" style="width:34px; height:34px; font-size:13px;">${(u.name || '?').charAt(0)}</div>
                      <div>
                        <strong>${u.name}</strong>
                        <div style="font-size:11.5px; color:var(--text-muted);">${u.jobTitle || (isEn && u.nameEn ? u.nameEn : '') || '-'}</div>
                      </div>
                    </div>
                  </td>
                  <td><code style="background:var(--bg-card-hover); padding:3px 8px; border-radius:4px; font-weight:700;">${u.username || 'admin'}</code></td>
                  <td>${u.email}</td>
                  <td>
                    <span class="badge ${roleObj?.badgeClass || 'badge-gray'}">
                      ${isEn ? (roleObj?.nameEn || u.role) : (roleObj?.nameAr || u.role)}
                    </span>
                    ${isCurrent ? `<span class="badge badge-success" style="font-size:10px; display:block; margin-top:4px;">${t('users.you')}</span>` : ''}
                  </td>
                  <td title="${permCount} ${t('users.permissions')}">
                    <span class="badge badge-info" style="font-size:10px;">${isEn ? permCount + ' perms' : permCount + ' صلاحية'}</span>
                    <div style="margin-top:4px; display:flex; flex-wrap:wrap; gap:2px;">${permModulesChips(u)}</div>
                  </td>
                  <td>
                    ${u.role === 'super_admin' ? `<strong style="color:var(--primary);">${t('users.allCompaniesOption')}</strong>` : comp ? (isEn && comp.nameEn ? comp.nameEn : comp.nameAr) : '-'}
                  </td>
                  <td>
                    ${u.role === 'super_admin' ? `<strong style="color:var(--primary);">${t('users.allBranchesOption')}</strong>` : u.role === 'company_hr' ? `<strong>${t('users.allBranchesOption')}</strong>` : branch ? (isEn && branch.nameEn ? branch.nameEn : branch.nameAr) : '-'}
                  </td>
                  <td>
                    <div style="display:flex; align-items:center; gap:6px; justify-content:flex-end;">
                      ${
                        canManage
                          ? `<button type="button" class="btn btn-icon btn-sm btn-outline btn-edit-user" title="${t('users.editUser')}">
                              ${Icons.edit(14)}
                            </button>`
                          : ''
                      }
                      ${
                        canManage && !isCurrent && users.length > 1
                          ? `<button type="button" class="btn btn-icon btn-sm btn-outline btn-delete-user" style="color:var(--danger);" title="${t('users.deleteUser')}">
                              ${Icons.trash(14)}
                            </button>`
                          : ''
                      }
                    </div>
                  </td>
                </tr>
              `;
                    })
                    .join('')
                : `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">${t('users.empty')}</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Audit log navigation
  container.querySelector('#btn-audit-log')?.addEventListener('click', () => {
    if (options.onNavigate) options.onNavigate('audit');
    else if (window.hrmsApp) window.hrmsApp.navigateTo('audit');
  });

  // Add User
  container.querySelector('#btn-add-user')?.addEventListener('click', () => {
    if (!canManage) return toast.error(t('users.requiredUsersPermission'));
    openUserModal(null, () => renderUsersView(container, options));
  });

  // Edit / Delete User
  container.querySelectorAll('.btn-edit-user').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      const userId = row?.getAttribute('data-user-id');
      const user = visibleUsers.find((u) => u.id === userId);
      if (!user) return;
      if (!canManage) return toast.error(t('users.requiredUsersPermission'));
      openUserModal(user, () => renderUsersView(container, options));
    });
  });

  container.querySelectorAll('.btn-delete-user').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      const userId = row?.getAttribute('data-user-id');
      const user = visibleUsers.find((u) => u.id === userId);
      if (!user) return;
      if (!canManage) return toast.error(t('users.requiredUsersPermission'));

      showConfirmDialog({
        title: t('users.deleteTitle'),
        message: t('users.deleteMessage').replace('{name}', user.name),
        confirmText: t('users.confirmDelete'),
        onConfirm: () => {
          storage.saveUsers(visibleUsers.filter((u) => u.id !== userId));
          storage.addAudit(isEn ? 'delete' : 'حذف', 'user', `${user.name} (${user.username})`, user.id);
          toast.success(t('users.deletedSuccess'));
          renderUsersView(container, options);
        },
      });
    });
  });
}