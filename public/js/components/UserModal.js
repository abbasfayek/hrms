// ==========================================
// User & Granular Permission Setup Modal
// - Bilingual (AR / EN)
// - Role presets auto-check a default permission set
// - Every permission can be fine-tuned per user
// - Company / branch scope for restricted roles
// ==========================================

import { storage } from '../storage.js';
import { createModal } from './Modal.js';
import { i18n, t } from '../i18n.js';
import { toast } from './Toast.js';
import { PERMISSION_MODULES, PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, escapeHtml } from '../types.js';
import { auth } from '../auth.js';

export function openUserModal(user = null, onSaved) {
  const isEdit = !!user;
  const isEn = i18n.getLang() === 'en';
  const state = storage.getState();
  const companies = state.companies;

  const data = user || {
    id: `usr-${Date.now()}`,
    name: '',
    nameEn: '',
    username: '',
    password: '',
    email: '',
    role: 'company_hr',
    permissions: [...(DEFAULT_ROLE_PERMISSIONS.company_hr || [])],
    assignedCompanyId: companies[0]?.id || 'comp-1',
    assignedBranchId: companies[0]?.branches[0]?.id || 'br-1',
    jobTitle: '',
    avatar: 'م',
  };

  // Safe (escaped) versions of user-controlled fields for template interpolation
  const safe = {
    name: escapeHtml(data.name || ''),
    nameEn: escapeHtml(data.nameEn || ''),
    email: escapeHtml(data.email || ''),
    username: escapeHtml(data.username || ''),
    jobTitle: escapeHtml(data.jobTitle || ''),
  };

  const compLabel = (c) => (isEn && c.nameEn ? c.nameEn : c.nameAr);
  const branchLabel = (b) => (isEn && b.nameEn ? b.nameEn : `${b.nameAr} (${b.city})`);

  const modulePerms = (moduleId) => Object.keys(PERMISSIONS).filter((p) => PERMISSIONS[p].module === moduleId);

  const renderPermissionGroup = (selected) => {
    return PERMISSION_MODULES.map((module) => {
      const perms = modulePerms(module.id);
      if (perms.length === 0) return '';
      const selectedCount = perms.filter((p) => selected.includes(p)).length;
      const rows = perms
        .map((p) => {
          const checked = selected.includes(p) ? 'checked' : '';
          const label = isEn ? PERMISSIONS[p].en : PERMISSIONS[p].ar;
          return `
            <label class="perm-item" title="${label}">
              <input type="checkbox" name="perm" value="${p}" ${checked}>
              <span class="perm-checkbox"></span>
              <span class="perm-label">${label}</span>
            </label>
          `;
        })
        .join('');
      const name = isEn ? module.nameEn : module.nameAr;
      return `
        <div class="perm-card" data-module-card="${module.id}">
          <div class="perm-card-header">
            <div class="perm-card-title">
              <span class="perm-module-icon" style="background:${module.color}22; color:${module.color}; border-color:${module.color}55;">${name.charAt(0)}</span>
              <span class="perm-module-name">${name}</span>
              <span class="perm-count" style="color:${module.color};">${selectedCount}/${perms.length}</span>
            </div>
            <div class="perm-card-actions">
              <button type="button" class="btn btn-xs perm-select-all" data-module="${module.id}">${t('users.selectAllModule')}</button>
              <button type="button" class="btn btn-xs perm-clear-all" data-module="${module.id}">${t('users.clearModule')}</button>
            </div>
          </div>
          <div class="perm-grid">${rows}</div>
        </div>
      `;
    }).join('');
  };

  const bodyHtml = `
    <form id="user-form">
      <div class="grid grid-cols-2">
        <div class="form-group">
          <label class="form-label">${isEn ? 'Full Name (Local) *' : 'الاسم الكامل (بالعربية) *'}</label>
          <input type="text" class="form-input" name="name" value="${safe.name}" required placeholder="${t('users.fullNamePlaceholder')}">
        </div>
        <div class="form-group">
          <label class="form-label">${t('users.nameEn')}</label>
          <input type="text" class="form-input" name="nameEn" value="${safe.nameEn}" placeholder="${t('users.nameEnPlaceholder')}">
        </div>

        <div class="form-group">
          <label class="form-label">${t('users.email')}</label>
          <input type="email" class="form-input" name="email" value="${safe.email}" required placeholder="user@company.com">
        </div>
        <div class="form-group">
          <label class="form-label">${t('users.username')}</label>
          <input type="text" class="form-input" name="username" value="${safe.username}" required placeholder="${t('users.usernamePlaceholder')}">
        </div>

        <div class="form-group">
          <label class="form-label">${t('users.password')}</label>
          <input type="password" class="form-input" name="password" value="${data.password || ''}" required placeholder="${t('users.passwordPlaceholder')}">
        </div>
        <div class="form-group">
          <label class="form-label">${t('users.jobTitle')}</label>
          <input type="text" class="form-input" name="jobTitle" value="${safe.jobTitle}" placeholder="${t('users.jobTitlePlaceholder')}">
        </div>

        <!-- Role + Scope -->
        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${t('users.scopeRole')}</label>
          <select class="form-select" name="role" id="user-role-select" required>
            <option value="super_admin" ${data.role === 'super_admin' ? 'selected' : ''}>${t('users.roleSuperAdmin')}</option>
            <option value="company_hr" ${data.role === 'company_hr' ? 'selected' : ''}>${t('users.roleCompanyHr')}</option>
            <option value="branch_hr" ${data.role === 'branch_hr' ? 'selected' : ''}>${t('users.roleBranchHr')}</option>
            <option value="payroll_admin" ${data.role === 'payroll_admin' ? 'selected' : ''}>${t('users.rolePayrollAdmin')}</option>
            <option value="audit_reviewer" ${data.role === 'audit_reviewer' ? 'selected' : ''}>${t('users.roleAuditReviewer')}</option>
            <option value="payments_officer" ${data.role === 'payments_officer' ? 'selected' : ''}>${t('users.rolePaymentsOfficer')}</option>
          </select>
        </div>

        <div class="form-group" id="user-company-group">
          <label class="form-label">${t('users.compScopeLabel')} *</label>
          <select class="form-select" name="assignedCompanyId" id="user-company-select">
            ${companies.map((c) => `<option value="${c.id}" ${c.id === data.assignedCompanyId ? 'selected' : ''}>${compLabel(c)}</option>`).join('')}
          </select>
        </div>

        <div class="form-group" id="user-branch-group">
          <label class="form-label">${t('users.branchScopeLabel')} *</label>
          <select class="form-select" name="assignedBranchId" id="user-branch-select">
            <!-- Rendered dynamically -->
          </select>
        </div>
      </div>

      <!-- Detailed permissions -->
      <div class="perms-section">
        <div class="perms-section-header">
          <div>
            <strong>${t('users.permissionsSection')}</strong>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${t('users.permissionsHelp')}</div>
          </div>
          <div class="perm-summary">
            <span class="perm-summary-count" id="perm-total-count">0</span>
            <button type="button" class="btn btn-xs btn-outline" id="btn-reset-role-defaults">
              ↺ ${isEn ? 'Reset to role defaults' : 'استعادة إعدادات الدور'}
            </button>
          </div>
        </div>
        <div class="perms-groups-grid" id="perms-groups">
          ${renderPermissionGroup(data.permissions || [])}
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-primary submit-user-btn">${t('save')}</button>
  `;

  const collectPermissions = (overlay) => {
    return Array.from(overlay.querySelectorAll('input[name="perm"]:checked')).map((cb) => cb.value);
  };

  const applyRoleDefaults = (overlay, role) => {
    const defaults = DEFAULT_ROLE_PERMISSIONS[role] || [];
    overlay.querySelectorAll('input[name="perm"]').forEach((cb) => {
      cb.checked = defaults.includes(cb.value);
    });
    refreshPermissionState(overlay);
  };

  const applyToggleAllForModule = (overlay, moduleId, checked) => {
    const perms = modulePerms(moduleId);
    overlay.querySelectorAll('input[name="perm"]').forEach((cb) => {
      if (perms.includes(cb.value)) cb.checked = checked;
    });
    refreshPermissionState(overlay);
  };

  const refreshPermissionState = (overlay) => {
    const checkedAll = Array.from(overlay.querySelectorAll('input[name="perm"]'));
    const checkedCount = checkedAll.filter((cb) => cb.checked).length;
    const totalCount = checkedAll.length;
    const countEl = overlay.querySelector('#perm-total-count');
    if (countEl) countEl.textContent = isEn ? `${checkedCount} of ${totalCount} selected` : `${checkedCount} من ${totalCount} محدد`;
    // Update per-card counters
    PERMISSION_MODULES.forEach((module) => {
      const card = overlay.querySelector(`[data-module-card="${module.id}"]`);
      const perms = modulePerms(module.id);
      if (!card || perms.length === 0) return;
      const selCount = perms.filter((p) => overlay.querySelector(`input[name="perm"][value="${p}"]`)?.checked).length;
      const badge = card.querySelector('.perm-count');
      if (badge) badge.textContent = `${selCount}/${perms.length}`;
    });
  };

  createModal({
    title: isEdit
      ? (isEn ? `Edit User & Permissions: ${safe.name}` : `تعديل بيانات المستخدم والصلاحيات: ${safe.name}`)
      : t('users.addNewUser'),
    size: 'lg',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      const roleSelect = overlay.querySelector('#user-role-select');
      const compGroup = overlay.querySelector('#user-company-group');
      const branchGroup = overlay.querySelector('#user-branch-group');
      const compSelect = overlay.querySelector('#user-company-select');
      const branchSelect = overlay.querySelector('#user-branch-select');

      function updateBranchesDropdown() {
        const comp = companies.find((c) => c.id === compSelect.value);
        if (!comp) return;
        branchSelect.innerHTML = (comp.branches || [])
          .map((b) => `<option value="${b.id}" ${b.id === data.assignedBranchId ? 'selected' : ''}>${branchLabel(b)}</option>`)
          .join('');
      }

      function updateRoleVisibility(applyDefaults = true) {
        const role = roleSelect.value;
        // Phase 2 (Spec v1.0): the financial roles (payroll_admin, audit_reviewer,
        // payments_officer) are company-scoped — company selector shown, branch hidden.
        const companyScoped = ['company_hr', 'payroll_admin', 'audit_reviewer', 'payments_officer'].includes(role);
        if (role === 'super_admin') {
          compGroup.style.display = 'none';
          branchGroup.style.display = 'none';
        } else if (companyScoped) {
          compGroup.style.display = 'block';
          branchGroup.style.display = 'none';
        } else {
          compGroup.style.display = 'block';
          branchGroup.style.display = 'block';
          updateBranchesDropdown();
        }
        if (applyDefaults) applyRoleDefaults(overlay, role);
      }

      roleSelect.addEventListener('change', () => updateRoleVisibility(true));
      compSelect.addEventListener('change', updateBranchesDropdown);
      // On brand-new users apply the selected role's defaults; on edit keep the saved custom set.
      updateRoleVisibility(!isEdit);

      // Module-level select-all / clear-all
      overlay.querySelectorAll('.perm-select-all').forEach((btn) => {
        btn.addEventListener('click', () => applyToggleAllForModule(overlay, btn.dataset.module, true));
      });
      overlay.querySelectorAll('.perm-clear-all').forEach((btn) => {
        btn.addEventListener('click', () => applyToggleAllForModule(overlay, btn.dataset.module, false));
      });

      // Reset to role defaults
      overlay.querySelector('#btn-reset-role-defaults')?.addEventListener('click', () => {
        applyRoleDefaults(overlay, roleSelect.value);
        toast.info(isEn ? 'Permissions reset to the selected role defaults.' : 'تمت استعادة الصلاحيات الافتراضية للدور المحدد.');
      });

      // Count initial selection
      refreshPermissionState(overlay);

      overlay.querySelector('.close-modal-btn').addEventListener('click', close);
      overlay.querySelector('.submit-user-btn').addEventListener('click', async () => {
        const form = overlay.querySelector('#user-form');
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }

        const permissions = collectPermissions(overlay);
        if (permissions.length === 0) {
          toast.error(t('users.noPermissionsError'));
          return;
        }

        const formData = new FormData(form);
        const role = formData.get('role');
        const submittedPassword = formData.get('password').trim();
        const isAlreadyHashed = submittedPassword.startsWith('pbkdf2$');
        // Hash a newly-entered plaintext password so no raw credential is ever
        // persisted locally or on the server (C-4). Already-hashed values are
        // preserved untouched to avoid double-hashing on an edit.
        const generatedPasswordHash = await auth.hashPassword(submittedPassword, isAlreadyHashed);
        const updatedUser = {
          ...data,
          name: formData.get('name'),
          nameEn: formData.get('nameEn') || data.nameEn || '',
          username: formData.get('username').trim(),
          password: generatedPasswordHash,
          email: formData.get('email'),
          jobTitle: formData.get('jobTitle') || '',
          role,
          permissions,
          assignedCompanyId: role === 'super_admin' ? 'all' : formData.get('assignedCompanyId'),
          // Phase 2: financial roles are company-scoped — branch always forced to
          // 'all' (their batches span branches within the assigned company).
          assignedBranchId: role === 'super_admin' || ['company_hr', 'payroll_admin', 'audit_reviewer', 'payments_officer'].includes(role) ? 'all' : formData.get('assignedBranchId'),
          avatar: (formData.get('name') || 'م').charAt(0),
        };

        const usersList = state.users.filter((u) => u.id !== updatedUser.id);
        usersList.push(updatedUser);
        storage.saveUsers(usersList);

        storage.addAudit(isEn ? 'edit' : 'تعديل', 'user', `${updatedUser.name} (${updatedUser.username}) — ${permissions.length} ${t('users.permissions')}`, updatedUser.id);

        toast.success(isEdit ? t('users.savedSuccess').replace('{name}', updatedUser.name) : t('users.createdSuccess').replace('{name}', updatedUser.name));
        close();
        if (onSaved) onSaved();
      });
    },
  });
}