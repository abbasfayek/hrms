// ==========================================
// Employees Directory & Management View (Bilingual & Multi-Company)
// ==========================================

import { storage } from '../storage.js';
import { Icons } from '../icons.js';
import { formatCurrency, formatDate, CONTRACT_TYPE_LABELS, DEPARTMENTS_LIST, can, resolveEmployeeCurrency } from '../types.js';
import { i18n, t } from '../i18n.js';
import { openEmployeeModal } from './EmployeeModal.js';
import { openEmployeeDetailDrawer } from './EmployeeDetailDrawer.js';
import { openExcelImportModal } from './ExcelImportModal.js';
import { openClearanceCertificateModal } from './ClearanceCertificateModal.js';
import { showConfirmDialog } from './Modal.js';
import { toast } from './Toast.js';
import { openPayslipModal } from './PayslipModal.js';

export function renderEmployeesView(container, options = {}) {
  const state = storage.getState();
  const { employees, rawEmployees, companies, settings } = state;
  const sym = settings.currencySymbol || '$';
  const isEn = i18n.getLang() === 'en';
  const currentUser = state.currentUser;
  const canAdd = can(currentUser, 'employees.add');
  const canEdit = can(currentUser, 'employees.edit');
  const canDelete = can(currentUser, 'employees.delete');
  const canViewPayroll = can(currentUser, 'payroll.view');
  const canViewEosb = can(currentUser, 'eosb.view');

  let searchQuery = '';
  let selectedDept = 'all';
  let selectedStatus = 'all';
  let selectedGosi = 'all';
  let selectedAllowance = 'all';
  let currentTab = options.tab || 'active'; // 'active' or 'archive'

  function render() {
    const isArchive = currentTab === 'archive';

    // Separate active from archived
    const activeList = employees.filter((e) => e.status !== 'resigned' && e.status !== 'terminated');
    const archiveList = employees.filter((e) => e.status === 'resigned' || e.status === 'terminated');

    const currentBaseList = isArchive ? archiveList : activeList;

    const filtered = currentBaseList.filter((emp) => {
      const matchSearch =
        !searchQuery ||
        emp.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (emp.fullNameEn && emp.fullNameEn.toLowerCase().includes(searchQuery.toLowerCase())) ||
        emp.employeeNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.jobTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (emp.nationalId && emp.nationalId.includes(searchQuery));

      const matchDept = selectedDept === 'all' || emp.department === selectedDept;
      const matchStatus = selectedStatus === 'all' || emp.status === selectedStatus;

      const matchGosi =
        selectedGosi === 'all' ||
        (selectedGosi === 'gosi_covered' && Boolean(emp.isSubjectToGosi)) ||
        (selectedGosi === 'gosi_exempt' && !emp.isSubjectToGosi);

      const hasHousing = (Number(emp.housingAllowance) || 0) > 0;
      const hasTransport = (Number(emp.transportAllowance) || 0) > 0;

      const matchAllowance =
        selectedAllowance === 'all' ||
        (selectedAllowance === 'has_housing' && hasHousing) ||
        (selectedAllowance === 'has_transport' && hasTransport) ||
        (selectedAllowance === 'has_both' && hasHousing && hasTransport) ||
        (selectedAllowance === 'no_allowances' && !hasHousing && !hasTransport);

      return matchSearch && matchDept && matchStatus && matchGosi && matchAllowance;
    });

    container.innerHTML = `
      <!-- Top Action Bar -->
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:20px;">
        <div>
          <h2 style="font-size:20px; font-weight:800; color:var(--text-main);">
            ${isArchive ? (isEn ? '📁 Former & Resigned Employees Archive' : '📁 أرشيف الموظفين السابقين والمستقيلين') : t('employeeDirectory')}
          </h2>
          <p style="font-size:13px; color:var(--text-muted);">
            ${isArchive ? (isEn ? 'Permanent historical record of former/resigned employees (never deleted)' : 'سجل تاريخي دائم لجميع الموظفين المستقيلين والمنتهية خدماتهم (محفوظ للأبد دون حذف)') : t('employeeDirectorySub')}
          </p>
        </div>

        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          ${canAdd ? `
            <button type="button" class="btn btn-outline" id="btn-import-employees-excel">
              ${Icons.upload(16)} ${t('importExcel')}
            </button>
          ` : ''}
          <button type="button" class="btn btn-outline" id="btn-export-employees-xlsx">
            ${Icons.download(16)} ${t('exportExcel')}
          </button>
          ${canAdd ? `
            <button type="button" class="btn btn-primary" id="btn-add-employee">
              ${Icons.userPlus(16)} ${t('addNewEmployee')}
            </button>
          ` : ''}
        </div>
      </div>

      <!-- Navigation Tabs (Active vs Archive) -->
      <div class="tabs-header" style="margin-bottom:16px;">
        <button type="button" class="tab-btn ${!isArchive ? 'active' : ''}" id="tab-active-emps">
          ${Icons.userCheck(16)} ${t('activeEmployees')} (${activeList.length})
        </button>
        <button type="button" class="tab-btn ${isArchive ? 'active' : ''}" id="tab-archive-emps">
          ${Icons.fileText(16)} ${t('archivedEmployees')} (${archiveList.length})
        </button>
      </div>

      <!-- Filter & Search Toolbar -->
      <div class="card" style="padding:16px; margin-bottom:20px;">
        <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
          <div class="search-box" style="flex:1; min-width:240px;">
            <input type="text" class="form-input" id="emp-search-input" value="${searchQuery}" placeholder="${t('searchPlaceholder')}">
            <span class="search-icon">${Icons.search(16)}</span>
          </div>

          <div style="min-width:180px;">
            <select class="form-select" id="dept-filter-select">
              <option value="all">${t('allDepartments')}</option>
              ${DEPARTMENTS_LIST.map((d) => `<option value="${d}" ${selectedDept === d ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
          </div>

          <div style="min-width:160px;">
            <select class="form-select" id="status-filter-select">
              <option value="all">${t('allStatuses')}</option>
              ${!isArchive ? `
                <option value="active" ${selectedStatus === 'active' ? 'selected' : ''}>${t('statusActive')}</option>
                <option value="probation" ${selectedStatus === 'probation' ? 'selected' : ''}>${t('statusProbation')}</option>
                <option value="on_leave" ${selectedStatus === 'on_leave' ? 'selected' : ''}>${t('statusOnLeave')}</option>
              ` : `
                <option value="resigned" ${selectedStatus === 'resigned' ? 'selected' : ''}>${isEn ? 'Resigned' : 'استقالة'}</option>
                <option value="terminated" ${selectedStatus === 'terminated' ? 'selected' : ''}>${isEn ? 'Terminated' : 'إنهاء خدمة'}</option>
              `}
            </select>
          </div>

          <!-- Social Security Filter -->
          <div style="min-width:180px;">
            <select class="form-select" id="gosi-filter-select">
              <option value="all" ${selectedGosi === 'all' ? 'selected' : ''}>${isEn ? '🛡️ All Social Security Statuses' : '🛡️ جميع حالات التأمينات'}</option>
              <option value="gosi_covered" ${selectedGosi === 'gosi_covered' ? 'selected' : ''}>${isEn ? '✓ Registered in Social Security' : '✓ المسجلون في التأمينات الاجتماعية'}</option>
              <option value="gosi_exempt" ${selectedGosi === 'gosi_exempt' ? 'selected' : ''}>${isEn ? '✕ Exempt / Not Registered' : '✕ غير المسجلين (غير خاضع)'}</option>
            </select>
          </div>

          <!-- Allowance Filter (Requirement 2) -->
          <div style="min-width:190px;">
            <select class="form-select" id="allowance-filter-select">
              <option value="all" ${selectedAllowance === 'all' ? 'selected' : ''}>${isEn ? '💰 All Allowances' : '💰 جميع البدلات'}</option>
              <option value="has_housing" ${selectedAllowance === 'has_housing' ? 'selected' : ''}>${isEn ? '🏠 Has Housing Allowance' : '🏠 لديه بدل سكن'}</option>
              <option value="has_transport" ${selectedAllowance === 'has_transport' ? 'selected' : ''}>${isEn ? '🚗 Has Transport Allowance' : '🚗 لديه بدل نقل'}</option>
              <option value="has_both" ${selectedAllowance === 'has_both' ? 'selected' : ''}>${isEn ? '🏠🚗 Has Both (Housing & Transport)' : '🏠🚗 لديه بدل سكن ونقل معاً'}</option>
              <option value="no_allowances" ${selectedAllowance === 'no_allowances' ? 'selected' : ''}>${isEn ? '🚫 No Allowances' : '🚫 بدون بدلات'}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Employees List Table -->
      <div class="card" style="padding:0; overflow:hidden;">
        <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between;">
          <div style="font-weight:700; font-size:15px; color:var(--text-main); display:flex; align-items:center; gap:10px;">
            <span>${isArchive ? (isEn ? 'Archived Employee Records' : 'سجلات الموظفين المؤرشفين') : t('employeeDirectory')}</span>
            <span class="badge ${isArchive ? 'badge-gray' : 'badge-primary'}">${filtered.length} ${isEn ? 'employees' : 'موظف'}</span>
          </div>
          ${isArchive ? `<span style="font-size:12px; color:var(--text-muted);">${isEn ? 'Historical records preserved and excluded from active payroll runs' : 'جميع السجلات محفوظة تاريخياً ولا يتم استهلاكها في مسيرات الرواتب الجديدة'}</span>` : ''}
        </div>

        <div class="table-container" style="border:none;">
          <table class="table">
            <thead>
              <tr>
                <th>${t('employeeCol')}</th>
                <th>${t('jobCol')}</th>
                <th>${t('statusCol')}</th>
                <th>${t('hireDateCol')}</th>
                <th>${t('totalSalaryCol')}</th>
                <th>${isEn ? 'Social Security' : 'التأمينات الاجتماعية'}</th>
                <th style="text-align:left;">${t('actionsCol')}</th>
              </tr>
            </thead>
            <tbody id="employees-table-body">
              ${
                filtered.length === 0
                  ? `<tr><td colspan="7" style="text-align:center; padding:36px; color:var(--text-muted);">
                      ${isArchive ? (isEn ? 'No archived employees found' : 'لا يوجد موظفون في سجل الأرشيف حالياً') : (isEn ? 'No employees found matching criteria' : 'لا يوجد موظفون مسجلون يطابقون معايير البحث')}
                    </td></tr>`
                  : filtered
                      .map((emp) => {
                        const empSym = (resolveEmployeeCurrency(emp, settings, companies).symbol) || '$';
                        const totalSalary =
                          (Number(emp.basicSalary) || 0) +
                          (Number(emp.housingAllowance) || 0) +
                          (Number(emp.transportAllowance) || 0) +
                          (Number(emp.otherAllowances) || 0);

                        const comp = companies.find((c) => c.id === emp.companyId);
                        const branch = comp ? (comp.branches || []).find((b) => b.id === emp.branchId) : null;
                        const empDisplayName = isEn && emp.fullNameEn ? emp.fullNameEn : emp.fullName;
                        const compDisplayName = comp ? (isEn && comp.nameEn ? comp.nameEn : comp.nameAr) : '';

                        return `
                        <tr data-emp-id="${emp.id}">
                          <td>
                            <div style="display:flex; align-items:center; gap:12px;">
                              <div class="user-avatar" style="width:36px; height:36px; font-size:14px; ${isArchive ? 'background:var(--border-color); color:var(--text-muted);' : ''}">
                                ${empDisplayName.charAt(0)}
                              </div>
                              <div>
                                <div style="font-weight:700; color:var(--text-main);">${empDisplayName}</div>
                                <div style="font-size:12px; color:var(--text-muted);">${emp.employeeNumber} • ${emp.phone || emp.email || '-'}</div>
                                <div style="font-size:11px; color:var(--primary); font-weight:600; margin-top:2px;">
                                  ${compDisplayName} ${branch ? `• ${branch.nameAr}` : ''}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div style="font-weight:600;">${emp.department}</div>
                            <div style="font-size:12px; color:var(--text-muted);">${emp.jobTitle}</div>
                          </td>
                          <td>
                            ${getStatusBadge(emp.status)}
                          </td>
                          <td>${formatDate(emp.hireDate)}</td>
                          <td>
                            <div style="font-weight:700; color:var(--text-main);">${formatCurrency(totalSalary, empSym)}</div>
                            <div style="font-size:11.5px; color:var(--text-muted);">${t('basicSalary')}: ${formatCurrency(emp.basicSalary, empSym)}</div>
                          </td>
                          <td>
                            ${emp.isSubjectToGosi ? `<span class="badge badge-success">${isEn ? 'Covered' : 'خاضع'} (${formatCurrency(emp.gosiRegisteredWage, empSym)})</span>` : `<span class="badge badge-gray">${isEn ? 'Exempt' : 'غير خاضع'}</span>`}
                          </td>
                          <td>
                            <div style="display:flex; align-items:center; gap:6px; justify-content:flex-end;">
                              <button type="button" class="btn btn-icon btn-sm btn-outline btn-view-emp" title="${t('viewFullProfile')}">
                                ${Icons.eye(15)}
                              </button>
                              ${canEdit && !isArchive ? `
                                <button type="button" class="btn btn-icon btn-sm btn-outline btn-edit-emp" title="${t('edit')}">
                                  ${Icons.edit(15)}
                                </button>
                                ${canViewPayroll ? `
                                  <button type="button" class="btn btn-sm btn-outline btn-payslip-emp" style="color:var(--primary); font-size:11.5px; padding:4px 8px;" title="${isEn ? 'View Payslip' : 'قسيمة الراتب'}">
                                    📋 ${isEn ? 'Payslip' : 'قسيمة'}
                                  </button>
                                ` : ''}
                                ${canEdit ? `
                                  <button type="button" class="btn btn-sm btn-outline btn-archive-emp" style="color:var(--warning); border-color:var(--warning); font-size:11.5px; padding:4px 8px;" title="${t('archiveEmployee')}">
                                    📁 ${t('archiveEmployee')}
                                  </button>
                                ` : ''}
                                ${canDelete ? `
                                  <button type="button" class="btn btn-icon btn-sm btn-outline btn-delete-emp" style="color:var(--danger);" title="${t('delete')}">
                                    ${Icons.trash(15)}
                                  </button>
                                ` : ''}
                              ` : ''}
                              ${isArchive && canViewEosb ? `
                                <button type="button" class="btn btn-sm btn-outline btn-clearance-emp" style="color:var(--primary); font-size:11.5px; padding:4px 8px;" title="${t('clearanceCertificate')}">
                                  📜 ${t('clearanceCertificate')}
                                </button>
                              ` : ''}
                              ${isArchive && canEdit ? `
                                <button type="button" class="btn btn-sm btn-success btn-reactivate-emp" style="font-size:11.5px; padding:4px 8px;" title="${t('reactivateEmployee')}">
                                  ✓ ${t('reactivateEmployee')}
                                </button>
                              ` : ''}
                            </div>
                          </td>
                        </tr>
                      `;
                      })
                      .join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Attach Tab switching
    container.querySelector('#tab-active-emps')?.addEventListener('click', () => {
      currentTab = 'active';
      selectedStatus = 'all';
      render();
    });

    container.querySelector('#tab-archive-emps')?.addEventListener('click', () => {
      currentTab = 'archive';
      selectedStatus = 'all';
      render();
    });

    // Search & Filters
    container.querySelector('#emp-search-input')?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      render();
    });

    container.querySelector('#dept-filter-select')?.addEventListener('change', (e) => {
      selectedDept = e.target.value;
      render();
    });

    container.querySelector('#status-filter-select')?.addEventListener('change', (e) => {
      selectedStatus = e.target.value;
      render();
    });

    container.querySelector('#gosi-filter-select')?.addEventListener('change', (e) => {
      selectedGosi = e.target.value;
      render();
    });

    container.querySelector('#allowance-filter-select')?.addEventListener('change', (e) => {
      selectedAllowance = e.target.value;
      render();
    });

    // Import from Excel
    container.querySelector('#btn-import-employees-excel')?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        openExcelImportModal(() => render());
      } catch (err) {
        console.error('Error opening Excel import modal:', err);
        toast.error('Error opening import: ' + err.message);
      }
    });

    // Add Employee
    container.querySelector('#btn-add-employee')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!canAdd) return;
      const guard = storage.branchWriteGuard();
      if (guard) {
        toast.error(guard.message);
        return;
      }
      try {
        openEmployeeModal(null, () => render());
      } catch (err) {
        console.error('Error opening Employee modal:', err);
        toast.error('Error opening modal: ' + err.message);
      }
    });

    // Export to Excel / CSV
    container.querySelector('#btn-export-employees-xlsx')?.addEventListener('click', () => {
      const exportData = filtered.map((e) => {
        const comp = companies.find((c) => c.id === e.companyId);
        const branch = comp ? (comp.branches || []).find((b) => b.id === e.branchId) : null;
        return {
          [isEn ? 'Company Code' : 'كود الشركة']: comp ? comp.code : '-',
          [isEn ? 'Company Name' : 'اسم الشركة']: comp ? (isEn && comp.nameEn ? comp.nameEn : comp.nameAr) : '-',
          [isEn ? 'Branch Name' : 'اسم الفرع']: branch ? branch.nameAr : '-',
          [isEn ? 'Employee ID' : 'الرقم الوظيفي']: e.employeeNumber,
          [isEn ? 'Full Name' : 'الاسم الكامل']: e.fullName,
          [isEn ? 'Department' : 'القسم']: e.department,
          [isEn ? 'Job Title' : 'المسمى الوظيفي']: e.jobTitle,
          [isEn ? 'Hire Date' : 'تاريخ التعيين']: e.hireDate,
          [isEn ? 'Contract' : 'نوع العقد']: e.contractType,
          [isEn ? 'Status' : 'الحالة']: e.status,
          [isEn ? 'Basic Salary' : 'الراتب الأساسي']: e.basicSalary,
          [isEn ? 'Housing' : 'بدل السكن']: e.housingAllowance || 0,
          [isEn ? 'Transport' : 'بدل النقل']: e.transportAllowance || 0,
          [isEn ? 'Other Allowances' : 'بدلات أخرى']: e.otherAllowances || 0,
          [isEn ? 'Social Security' : 'خاضع للتأمينات']: e.isSubjectToGosi ? (isEn ? 'Yes' : 'نعم') : (isEn ? 'No' : 'لا'),
          [isEn ? 'Registered Wage' : 'الأجر المسجل للتأمينات']: e.gosiRegisteredWage || 0,
          [isEn ? 'Bank Name' : 'اسم البنك']: e.bankName || '',
          [isEn ? 'IBAN' : 'الآيبان']: e.iban || '',
          [isEn ? 'National ID' : 'رقم الهوية']: e.nationalId || '',
          [isEn ? 'Phone' : 'الجوال']: e.phone || '',
          [isEn ? 'Email' : 'البريد']: e.email || '',
        };
      });

      if (window.XLSX) {
        try {
          const ws = XLSX.utils.json_to_sheet(exportData);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, isArchive ? 'Archived' : 'Active');
          XLSX.writeFile(wb, `Employees_${isArchive ? 'Archived' : 'Active'}_${new Date().toISOString().split('T')[0]}.xlsx`);
          toast.success(isEn ? 'Exported Excel file successfully' : 'تم تصدير ملف الموظفين بنجاح');
          return;
        } catch(err) {
          console.warn('XLSX export fallback:', err);
        }
      }

      // Direct CSV export fallback
      const headers = Object.keys(exportData[0] || {});
      const csvRows = exportData.map(row => headers.map(h => `"${(row[h] !== undefined ? row[h] : '').toString().replace(/"/g, '""')}"`).join(','));
      const csvContent = '\uFEFF' + [headers.join(','), ...csvRows].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Employees_${isArchive ? 'Archived' : 'Active'}_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(isEn ? 'Exported CSV file successfully' : 'تم تصدير ملف الموظفين بنجاح');
    });

    // Row Actions
    container.querySelectorAll('tr[data-emp-id]').forEach((row) => {
      const empId = row.getAttribute('data-emp-id');
      const emp = (rawEmployees || employees).find((e) => e.id === empId);
      if (!emp) return;

      // View Drawer
      row.querySelector('.btn-view-emp')?.addEventListener('click', () => {
        openEmployeeDetailDrawer(emp, () => render());
      });

      // Edit Modal
      row.querySelector('.btn-edit-emp')?.addEventListener('click', () => {
        if (!canEdit) return;
        openEmployeeModal(emp, () => render());
      });

      // Payslip
      row.querySelector('.btn-payslip-emp')?.addEventListener('click', () => {
        if (!canViewPayroll) return;
        openPayslipModal(emp);
      });

      // Soft Archive
      row.querySelector('.btn-archive-emp')?.addEventListener('click', () => {
        if (!canEdit) return;
        showConfirmDialog({
          title: isEn ? `Archive Employee: ${emp.fullName}` : `أرشفة الموظف: ${emp.fullName}`,
          message: isEn 
            ? `Are you sure you want to archive <strong>${emp.fullName}</strong> as resigned/former? Data is permanently preserved.`
            : `هل تريد تحويل الموظف <strong>${emp.fullName}</strong> إلى الأرشيف كموظف مستقيل/منتهي الخدمة؟ (سيتم الاحتفاظ بكافة بياناته وسجلاته ولن يظهر في مسيرات الرواتب الجديدة).`,
          confirmText: isEn ? '📁 Confirm Archive' : '📁 تأكيد الأرشفة',
          onConfirm: () => {
            emp.status = 'resigned';
            emp.archivedAt = new Date().toISOString();
            storage.updateEmployee(emp);
            storage.addAudit('edit', 'employee', `${emp.fullName} → ${isEn ? 'archived' : 'أُرشِف'}`, empId);
            toast.success(isEn ? `Employee ${emp.fullName} archived` : `تم أرشفة الموظف ${emp.fullName} بنجاح`);
            render();
          },
        });
      });

      // Hard Delete
      row.querySelector('.btn-delete-emp')?.addEventListener('click', () => {
        if (!canDelete) return;
        showConfirmDialog({
          title: t('delete'),
          message: isEn ? `Are you sure you want to permanently delete <strong>${emp.fullName}</strong>?` : `هل أنت متأكد من رغبتك في حذف الموظف <strong>${emp.fullName}</strong> نهائياً؟`,
          confirmText: isEn ? 'Permanent Delete' : 'حذف نهائي',
          onConfirm: () => {
            storage.deleteEmployee(empId);
            storage.addAudit('delete', 'employee', `${emp.fullName} — ${isEn ? 'permanently deleted' : 'حذف نهائي'}`, empId);
            toast.success(isEn ? `Employee ${emp.fullName} deleted` : `تم حذف الموظف ${emp.fullName} بنجاح`);
            render();
          },
        });
      });

      // Clearance Certificate
      row.querySelector('.btn-clearance-emp')?.addEventListener('click', () => {
        if (!canViewEosb) return;
        openClearanceCertificateModal(emp);
      });

      // Reactivate Employee
      row.querySelector('.btn-reactivate-emp')?.addEventListener('click', () => {
        if (!canEdit) return;
        showConfirmDialog({
          title: isEn ? `Reactivate Employee: ${emp.fullName}` : `إعادة تفعيل الموظف: ${emp.fullName}`,
          message: isEn ? `Reactivate <strong>${emp.fullName}</strong> to active working status?` : `هل تريد إعادة تفعيل الموظف <strong>${emp.fullName}</strong> ليعود موظفاً نشطاً على رأس العمل؟`,
          confirmText: isEn ? '✓ Yes, Reactivate' : '✓ نعم، إعادة تفعيل',
          onConfirm: () => {
            emp.status = 'active';
            storage.updateEmployee(emp);
            storage.addAudit('edit', 'employee', `${emp.fullName} → ${isEn ? 'reactivated' : 'إعادة تفعيل'}`, empId);
            toast.success(isEn ? `Employee ${emp.fullName} reactivated` : `تمت إعادة تفعيل الموظف ${emp.fullName} بنجاح`);
            render();
          },
        });
      });
    });
  }

  render();

  if (options.openNewModal) {
    openEmployeeModal(null, () => render());
  }
}

function getStatusBadge(status) {
  const isEn = i18n.getLang() === 'en';
  switch (status) {
    case 'active':
      return `<span class="badge badge-success">${isEn ? 'Active' : 'على رأس العمل'}</span>`;
    case 'probation':
      return `<span class="badge badge-warning">${isEn ? 'Probation' : 'تحت التجربة'}</span>`;
    case 'on_leave':
      return `<span class="badge badge-info">${isEn ? 'On Leave' : 'في إجازة'}</span>`;
    case 'resigned':
      return `<span class="badge badge-gray">${isEn ? 'Resigned' : 'مستقيل'}</span>`;
    case 'terminated':
      return `<span class="badge badge-danger">${isEn ? 'Terminated' : 'منتهي الخدمة'}</span>`;
    default:
      return `<span class="badge badge-gray">${status}</span>`;
  }
}
