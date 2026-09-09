// ==========================================
// Companies & Branches Management View
// ==========================================

import { storage } from '../storage.js';
import { Icons } from '../icons.js';
import { i18n, t } from '../i18n.js';
import { can } from '../types.js';
import { defaultCurrencies } from '../seedData.js';
import { createModal, showConfirmDialog } from './Modal.js';
import { toast } from './Toast.js';

export function renderCompaniesView(container) {
  const state = storage.getState();
  const { companies, rawEmployees = [] } = state;
  const isEn = i18n.getLang() === 'en';
  const canManage = can(state.currentUser, 'companies.manage');

  container.innerHTML = `
    <!-- Top Action Bar -->
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:20px;">
      <div>
        <h2 style="font-size:20px; font-weight:800; color:var(--text-main);">${t('companiesTitle')}</h2>
        <p style="font-size:13px; color:var(--text-muted);">${t('companiesSub')}</p>
      </div>

      ${canManage ? `
        <button type="button" class="btn btn-primary" id="btn-add-company">
          ${Icons.plus(16)} ${t('addNewCompany')}
        </button>
      ` : ''}
    </div>

    <!-- Companies Grid -->
    <div style="display:flex; flex-direction:column; gap:20px;">
      ${companies.length === 0 ? `
        <div class="card" style="text-align:center; padding:40px; color:var(--text-muted);">
          <div style="margin-bottom:12px;">${Icons.building(36)}</div>
          <div style="font-size:15px; font-weight:700;">${isEn ? 'No companies registered yet' : 'لا توجد شركات مسجلة حالياً'}</div>
          <div style="font-size:13px; margin-top:4px;">${isEn ? 'Click the "Add New Company" button to create your first company.' : 'انقر على زر "إضافة شركة جديدة" لإنشاء أول شركة.'}</div>
        </div>
      ` : companies
        .map((comp) => {
          const compEmployees = rawEmployees.filter((e) => e.companyId === comp.id);
          return `
        <div class="card" style="padding:22px; border-right:4px solid var(--primary);" data-comp-id="${comp.id}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:14px; margin-bottom:18px;">
            <div style="display:flex; align-items:center; gap:14px;">
              <div style="width:48px; height:48px; border-radius:var(--radius-md); background:var(--primary-gradient); display:flex; align-items:center; justify-content:center; color:#fff; font-weight:900; font-size:18px;">
                ${comp.code || comp.nameAr.charAt(0)}
              </div>
              <div>
                <h3 style="font-size:17px; font-weight:800; color:var(--text-main);">${comp.nameAr}</h3>
                <div style="font-size:12.5px; color:var(--text-muted);">${comp.nameEn || ''} • ${isEn ? 'Code:' : 'كود:'} <span style="font-weight:700;">${comp.code}</span></div>
                <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
                  ${t('crNumber')}: <strong>${comp.commercialRegistration || '-'}</strong> • ${t('vatNumber')}: <strong>${comp.taxNumber || '-'}</strong> • ${t('currency')}: <strong>${comp.currency} (${comp.currencySymbol})</strong>
                </div>
              </div>
            </div>

            <div style="display:flex; align-items:center; gap:8px;">
              <span class="badge badge-primary">${compEmployees.length} ${isEn ? 'employees' : 'موظف مسجل'}</span>
              ${canManage ? `
                <button type="button" class="btn btn-sm btn-outline btn-edit-company" data-comp-id="${comp.id}" title="${t('editCompany')}">
                  ${Icons.edit(14)} ${t('edit')}
                </button>
                <button type="button" class="btn btn-sm btn-outline btn-add-branch-to-comp" data-comp-id="${comp.id}">
                  ${Icons.plus(14)} ${t('addNewBranch')}
                </button>
                <button type="button" class="btn btn-sm btn-icon btn-outline btn-delete-company" data-comp-id="${comp.id}" style="color:var(--danger);" title="${t('deleteCompany')}">
                  ${Icons.trash(14)}
                </button>
              ` : ''}
            </div>
          </div>

          <!-- Branches Section -->
          <div style="background:var(--bg-card-hover); border-radius:var(--radius-md); padding:14px 18px; border:1px solid var(--border-color);">
            <div style="font-size:13px; font-weight:700; color:var(--text-main); margin-bottom:10px; display:flex; align-items:center; justify-content:space-between;">
              <span>${Icons.building(15)} ${isEn ? `Branches & locations (${(comp.branches || []).length})` : `فروع ومواقع الشركة (${(comp.branches || []).length} فرع)`}:</span>
            </div>

            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap:12px;">
              ${(comp.branches || [])
                .map((br) => {
                  const branchEmps = compEmployees.filter((e) => e.branchId === br.id);
                  return `
                <div style="background:var(--bg-card); padding:12px; border-radius:var(--radius-md); border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;" data-branch-id="${br.id}">
                  <div>
                    <div style="display:flex; align-items:center; gap:6px;">
                      <span style="font-weight:700; font-size:13.5px; color:var(--text-main);">${br.nameAr}</span>
                      <span class="badge ${(br.branchType || 'main') === 'main' ? 'badge-primary' : 'badge-warning'}" style="font-size:10px; padding:2px 6px; border-radius:10px;">
                        ${(br.branchType || 'main') === 'main' ? (isEn ? 'Main' : 'رئيسي') : (isEn ? 'Sub' : 'فرعي')}
                      </span>
                    </div>
                    <div style="font-size:11.5px; color:var(--text-muted);">${br.city} • ${br.nameEn || ''}</div>
                    <div style="display:flex; align-items:center; gap:6px; margin-top:6px;">
                      <span class="badge badge-gray" style="font-size:11px;">${branchEmps.length} ${isEn ? 'emp.' : 'موظف'}</span>
                      ${br.payDay ? `<span class="badge badge-info" style="font-size:11px;">📅 ${isEn ? 'Payday' : 'صرف الرواتب'}: ${br.payDay}</span>` : ''}
                    </div>
                  </div>
                  <div style="display:flex; align-items:center; gap:6px;">
                    ${canManage ? `
                    <button type="button" class="btn btn-icon btn-sm btn-outline btn-edit-branch" data-comp-id="${comp.id}" data-branch-id="${br.id}" title="${t('editBranch')}">
                      ${Icons.edit(12)}
                    </button>
                    ${(comp.branches || []).length > 1 ? `
                      <button type="button" class="btn btn-icon btn-sm btn-outline btn-delete-branch" data-comp-id="${comp.id}" data-branch-id="${br.id}" style="color:var(--danger);" title="${t('deleteBranch')}">
                        ${Icons.trash(12)}
                      </button>
                    ` : ''}
                    ` : ''}
                  </div>
                </div>
              `;
                })
                .join('')}
            </div>
          </div>
        </div>
      `;
        })
        .join('')}
    </div>
  `;

  // Add Company Modal
  container.querySelector('#btn-add-company')?.addEventListener('click', () => {
    openCompanyModal(null, () => renderCompaniesView(container));
  });

  // Edit Company
  container.querySelectorAll('.btn-edit-company').forEach((btn) => {
    btn.addEventListener('click', () => {
      const compId = btn.getAttribute('data-comp-id');
      const comp = companies.find((c) => c.id === compId);
      if (comp) openCompanyModal(comp, () => renderCompaniesView(container));
    });
  });

  // Delete Company
  container.querySelectorAll('.btn-delete-company').forEach((btn) => {
    btn.addEventListener('click', () => {
      const compId = btn.getAttribute('data-comp-id');
      const comp = companies.find((c) => c.id === compId);
      if (!comp) return;

      const compEmployees = rawEmployees.filter((e) => e.companyId === comp.id);

      showConfirmDialog({
        title: isEn ? `Delete Company: ${comp.nameAr}` : `حذف الشركة: ${comp.nameAr}`,
        message: isEn ? `Are you sure you want to delete company <strong>${comp.nameAr}</strong> and all its branches? ${compEmployees.length > 0 ? `<br><span style="color:var(--danger); font-weight:700;">Warning: ${compEmployees.length} employees are linked to this company and their links will be removed.</span>` : ''}` : `هل أنت متأكد من رغبتك في حذف الشركة <strong>${comp.nameAr}</strong> وفروعها بالكامل؟ ${compEmployees.length > 0 ? `<br><span style="color:var(--danger); font-weight:700;">تحذير: يوجد ${compEmployees.length} موظف مسجل تحت هذه الشركة وسيتم حذف ارتباطاتهم.</span>` : ''}`,
        confirmText: isEn ? 'Yes, delete company' : 'نعم، حذف الشركة',
        onConfirm: () => {
          const updatedCompanies = companies.filter((c) => c.id !== compId);
          storage.saveCompanies(updatedCompanies);
          storage.addAudit('delete', 'company', `${comp.nameAr}`, compId);
          toast.success(isEn ? `Company ${comp.nameAr} deleted successfully` : `تم حذف الشركة ${comp.nameAr} بنجاح`);
          renderCompaniesView(container);
        },
      });
    });
  });

  // Add Branch
  container.querySelectorAll('.btn-add-branch-to-comp').forEach((btn) => {
    btn.addEventListener('click', () => {
      const compId = btn.getAttribute('data-comp-id');
      openBranchModal(compId, null, () => renderCompaniesView(container));
    });
  });

  // Edit Branch
  container.querySelectorAll('.btn-edit-branch').forEach((btn) => {
    btn.addEventListener('click', () => {
      const compId = btn.getAttribute('data-comp-id');
      const branchId = btn.getAttribute('data-branch-id');
      const comp = companies.find((c) => c.id === compId);
      const branch = comp ? (comp.branches || []).find((b) => b.id === branchId) : null;
      if (comp && branch) openBranchModal(compId, branch, () => renderCompaniesView(container));
    });
  });

  // Delete Branch
  container.querySelectorAll('.btn-delete-branch').forEach((btn) => {
    btn.addEventListener('click', () => {
      const compId = btn.getAttribute('data-comp-id');
      const branchId = btn.getAttribute('data-branch-id');
      const comp = companies.find((c) => c.id === compId);
      const branch = comp ? (comp.branches || []).find((b) => b.id === branchId) : null;
      if (!comp || !branch) return;

      showConfirmDialog({
        title: isEn ? `Delete Branch: ${branch.nameAr}` : `حذف الفرع: ${branch.nameAr}`,
        message: isEn ? `Delete branch <strong>${branch.nameAr}</strong> from company ${comp.nameAr}?` : `هل أنت متأكد من حذف الفرع <strong>${branch.nameAr}</strong> من شركة ${comp.nameAr}؟`,
        confirmText: isEn ? 'Yes, delete branch' : 'نعم، حذف الفرع',
        onConfirm: () => {
          const updatedCompanies = companies.map((c) => {
            if (c.id === compId) {
              return {
                ...c,
                branches: (c.branches || []).filter((b) => b.id !== branchId),
              };
            }
            return c;
          });
          storage.saveCompanies(updatedCompanies);
          storage.addAudit('delete', 'branch', `${branch.nameAr} (${comp.nameAr})`, branchId);
          toast.success(isEn ? `Branch ${branch.nameAr} deleted successfully` : `تم حذف الفرع ${branch.nameAr} بنجاح`);
          renderCompaniesView(container);
        },
      });
    });
  });
}

function openCompanyModal(company = null, onSaved) {
  const isEdit = !!company;
  const isEn = i18n.getLang() === 'en';
  if (!can(storage.getActiveUser(), 'companies.manage')) return;
  const data = company || {
    id: `comp-${Date.now()}`,
    nameAr: '',
    nameEn: '',
    code: '',
    commercialRegistration: '',
    taxNumber: '',
    currency: 'SAR',
    currencySymbol: 'ر.س',
    branches: [
      { id: `br-${Date.now()}`, nameAr: 'الفرع الرئيسي', nameEn: 'Main Branch', city: 'الرئيسي', payDay: 25 }
    ]
  };

  const bodyHtml = `
    <form id="company-form">
      <div class="grid grid-cols-2">
        <div class="form-group">
          <label class="form-label">${isEn ? 'Company Name (Arabic) *' : 'اسم الشركة بالعربي *'}</label>
          <input type="text" class="form-input" name="nameAr" value="${data.nameAr}" required placeholder="${isEn ? 'e.g. Vision Tech Group' : 'مثال: شركة الرؤية المتقدمة'}">
        </div>
        <div class="form-group">
          <label class="form-label">${isEn ? 'Company Name (English)' : 'اسم الشركة بالإنجليزي'}</label>
          <input type="text" class="form-input" name="nameEn" value="${data.nameEn || ''}" placeholder="e.g. Vision Tech Group">
        </div>
        <div class="form-group">
          <label class="form-label">${isEn ? 'Company Code *' : 'رمز كود الشركة *'}</label>
          <input type="text" class="form-input" name="code" value="${data.code}" required placeholder="e.g. VTG">
        </div>
        <div class="form-group">
          <label class="form-label">${t('crNumber')}</label>
          <input type="text" class="form-input" name="commercialRegistration" value="${data.commercialRegistration || ''}" placeholder="1010xxxxxx">
        </div>
        <div class="form-group">
          <label class="form-label">${t('vatNumber')}</label>
          <input type="text" class="form-input" name="taxNumber" value="${data.taxNumber || ''}" placeholder="300xxxxxxxxx">
        </div>
        <div class="form-group">
          <label class="form-label">${t('currency')} ${isEn ? 'and Symbol *' : 'ورمزها *'}</label>
          <select class="form-select" name="currency">
            ${defaultCurrencies.map((c) => `<option value="${c.code}|${c.symbol}" ${data.currency === c.code ? 'selected' : ''}>${isEn ? (c.nameEn || c.nameAr) : c.nameAr} (${c.code} - ${c.symbol})</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${isEn ? 'Hourly Leave Quota (hours/month)' : 'رصيد الإجازات الزمنية (ساعات/شهر)'}</label>
          <input type="number" step="0.5" class="form-input" name="hourlyLeaveQuota" value="${data.hourlyLeaveQuota !== undefined ? data.hourlyLeaveQuota : 4}" placeholder="4">
        </div>
        ${!isEdit ? `
        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${isEn ? 'Initial Main Branch Name *' : 'اسم الفرع الأولي الرئيسي *'}</label>
          <input type="text" class="form-input" name="mainBranchName" value="${isEn ? 'Main Branch' : 'الفرع الرئيسي'}" required>
        </div>
        ` : ''}
      </div>
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-primary submit-comp-btn">${t('save')}</button>
  `;

  createModal({
    title: isEdit ? `${isEn ? 'Edit Company: ' : 'تعديل بيانات الشركة: '}${data.nameAr}` : t('addNewCompany'),
    size: 'md',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      overlay.querySelector('.close-modal-btn').addEventListener('click', close);
      overlay.querySelector('.submit-comp-btn').addEventListener('click', () => {
        const form = overlay.querySelector('#company-form');
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }

        const formData = new FormData(form);
        const [curr, currSymbol] = formData.get('currency').split('|');

        const state = storage.getState();
        const companies = state.companies || [];

        if (isEdit) {
          const updated = companies.map((c) => {
            if (c.id === data.id) {
              return {
                ...c,
                nameAr: formData.get('nameAr'),
                nameEn: formData.get('nameEn') || '',
                code: formData.get('code').toUpperCase(),
                commercialRegistration: formData.get('commercialRegistration') || '',
                taxNumber: formData.get('taxNumber') || '',
                currency: curr,
                currencySymbol: currSymbol,
                hourlyLeaveQuota: Number(formData.get('hourlyLeaveQuota')) || 4,
              };
            }
            return c;
          });
          storage.saveCompanies(updated);
          storage.addAudit('edit', 'company', `${formData.get('nameAr')}`, data.id);
          toast.success(isEn ? `Company ${formData.get('nameAr')} updated successfully` : `تم تعديل بيانات الشركة ${formData.get('nameAr')} بنجاح`);
        } else {
          const compId = `comp-${Date.now()}`;
          const newCompany = {
            id: compId,
            nameAr: formData.get('nameAr'),
            nameEn: formData.get('nameEn') || '',
            code: formData.get('code').toUpperCase(),
            commercialRegistration: formData.get('commercialRegistration') || '',
            taxNumber: formData.get('taxNumber') || '',
            currency: curr,
            currencySymbol: currSymbol,
            hourlyLeaveQuota: Number(formData.get('hourlyLeaveQuota')) || 4,
            branches: [
              {
                id: `br-${Date.now()}`,
                companyId: compId,
                nameAr: formData.get('mainBranchName'),
                nameEn: 'Main Branch',
                city: 'الرئيسي',
                payDay: 25,
              },
            ],
          };
          storage.addCompany(newCompany);
          storage.addAudit('add', 'company', `${newCompany.nameAr}`, compId);
          toast.success(isEn ? `Company ${newCompany.nameAr} added successfully` : `تمت إضافة الشركة ${newCompany.nameAr} بنجاح`);
        }

        close();
        if (onSaved) onSaved();
      });
    },
  });
}

function openBranchModal(companyId, branch = null, onSaved) {
  const isEdit = !!branch;
  const isEn = i18n.getLang() === 'en';
  if (!can(storage.getActiveUser(), 'companies.manage')) return;
  const state = storage.getState();
  const company = state.companies.find((c) => c.id === companyId);
  if (!company) return;

  const data = branch || {
    id: `br-${Date.now()}`,
    nameAr: '',
    nameEn: '',
    city: '',
    payDay: 25,
    branchType: 'main',
    parentBranchId: null,
  };

  const bodyHtml = `
    <form id="branch-form">
      <div class="grid grid-cols-2">
        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${isEn ? 'Parent Company' : 'الشركة التابع لها الفرع'}</label>
          <input type="text" class="form-input" value="${company.nameAr}" readonly style="background:var(--bg-card-hover);">
        </div>
        <div class="form-group">
          <label class="form-label">${isEn ? 'Branch Name (Arabic) *' : 'اسم الفرع بالعربي *'}</label>
          <input type="text" class="form-input" name="nameAr" value="${data.nameAr}" required placeholder="${isEn ? 'e.g. Khobar & Eastern Region Branch' : 'مثال: فرع الخبر والمنطقة الشرقية'}">
        </div>
        <div class="form-group">
          <label class="form-label">${isEn ? 'Branch Name (English)' : 'اسم الفرع بالإنجليزي'}</label>
          <input type="text" class="form-input" name="nameEn" value="${data.nameEn || ''}" placeholder="e.g. Khobar Branch">
        </div>
        <div class="form-group">
          <label class="form-label">${isEn ? 'Branch Type *' : 'نوع الفرع *'}</label>
          <select class="form-input" name="branchType" required>
            <option value="main" ${data.branchType === 'main' ? 'selected' : ''}>${isEn ? 'Main Branch (Head Office)' : 'فرع رئيسي'}</option>
            <option value="sub" ${data.branchType === 'sub' ? 'selected' : ''}>${isEn ? 'Sub-Branch' : 'فرع فرعي'}</option>
          </select>
        </div>
        <div class="form-group" id="parent-branch-group" style="display:${data.branchType === 'sub' ? '' : 'none'};">
          <label class="form-label">${isEn ? 'Main Branch (Parent)' : 'الفرع الرئيسي (الأب)'}</label>
          <select class="form-input" name="parentBranchId">
            <option value="">${isEn ? 'Select...' : 'اختر...'}</option>
            ${(company.branches || []).filter((b) => b.id !== data.id && (b.branchType || 'main') === 'main').map((b) => `<option value="${b.id}" ${data.parentBranchId === b.id ? 'selected' : ''}>${b.nameAr}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${isEn ? 'City / Location *' : 'المدينة / الموقع الجغرافي *'}</label>
          <input type="text" class="form-input" name="city" value="${data.city}" required placeholder="${isEn ? 'e.g. Khobar / Dammam' : 'مثال: الخبر / الدمام'}">
        </div>
        <div class="form-group">
          <label class="form-label">${isEn ? 'Payroll Release Day of Month (Payday)' : 'يوم تحرير / صرف الرواتب من الشهر'}</label>
          <input type="number" class="form-input" name="payDay" min="1" max="31" value="${data.payDay ?? 25}" required>
          <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${isEn ? 'Salaries of this branch are scheduled to be released on this day (default: 25).' : 'تُجدول رواتب هذا الفرع لتُتحرر في هذا اليوم من كل شهر (الافتراضي: 25).'}</div>
        </div>
        <div class="form-group" style="display:flex; align-items:flex-end;">
          <div style="font-size:12px; color:var(--text-muted); background:var(--bg-card-hover); border:1px solid var(--border-color); padding:10px 12px; border-radius:8px; width:100%;">
            💰 ${isEn ? 'On payday the month payroll becomes available with a review preview, then the final release is confirmed by the manager.' : 'في يوم الصرف يصبح مسير الشهر متاحاً للمراجعة المسبقة ثم يتم تأكيد التحرير النهائي من قبل الإدارة.'}
          </div>
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-primary submit-branch-btn">${t('save')}</button>
  `;

  createModal({
    title: isEdit ? `${isEn ? 'Edit Branch: ' : 'تعديل الفرع: '}${data.nameAr}` : `${t('addNewBranch')} - ${company.nameAr}`,
    size: 'md',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      overlay.querySelector('.close-modal-btn').addEventListener('click', close);

      const typeSelect = overlay.querySelector('select[name="branchType"]');
      const parentGroup = overlay.querySelector('#parent-branch-group');
      if (typeSelect && parentGroup) {
        typeSelect.addEventListener('change', () => {
          parentGroup.style.display = typeSelect.value === 'sub' ? '' : 'none';
        });
      }

      overlay.querySelector('.submit-branch-btn').addEventListener('click', () => {
        const form = overlay.querySelector('#branch-form');
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }

        const formData = new FormData(form);
        const branchTypeVal = formData.get('branchType') || 'main';
        const parentBranchVal = formData.get('parentBranchId') || null;

        const updatedCompanies = state.companies.map((c) => {
          if (c.id === companyId) {
            let updatedBranches;
            if (isEdit) {
              updatedBranches = (c.branches || []).map((b) => {
                if (b.id === data.id) {
                  return {
                    ...b,
                    nameAr: formData.get('nameAr'),
                    nameEn: formData.get('nameEn') || '',
                    city: formData.get('city'),
                    payDay: Number(formData.get('payDay')) || 25,
                    branchType: branchTypeVal,
                    parentBranchId: branchTypeVal === 'sub' ? parentBranchVal : null,
                  };
                }
                return b;
              });
            } else {
              const newBranch = {
                id: `br-${Date.now()}`,
                companyId,
                nameAr: formData.get('nameAr'),
                nameEn: formData.get('nameEn') || '',
                city: formData.get('city'),
                payDay: Number(formData.get('payDay')) || 25,
                branchType: branchTypeVal,
                parentBranchId: branchTypeVal === 'sub' ? parentBranchVal : null,
              };
              updatedBranches = [...(c.branches || []), newBranch];
            }
            return { ...c, branches: updatedBranches };
          }
          return c;
        });

        storage.saveCompanies(updatedCompanies);
        storage.addAudit(isEdit ? 'edit' : 'add', 'branch', `${formData.get('nameAr')} (${company.nameAr})`, data.id);
        toast.success(isEn ? `Branch ${formData.get('nameAr')} saved successfully` : `تم حفظ الفرع ${formData.get('nameAr')} بنجاح`);
        close();
        if (onSaved) onSaved();
      });
    },
  });
}
