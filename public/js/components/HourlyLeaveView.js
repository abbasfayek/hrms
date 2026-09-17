// ==========================================
// Hourly Leaves Management View (Bilingual AR / EN)
// ==========================================

import { storage } from '../storage.js';
import { Icons } from '../icons.js';
import { formatDate, getCurrentMonth, can } from '../types.js';
import { openHourlyLeaveModal } from './HourlyLeaveModal.js';
import { openRecordPreview } from './RecordPreviewModal.js';
import { getEmployeeHourlyQuota, calculateHourlyBalance } from '../engines/hourlyLeaveEngine.js';
import { showConfirmDialog } from './Modal.js';
import { toast } from './Toast.js';
import { i18n, t } from '../i18n.js';

export function renderHourlyLeaveView(container, options = {}) {
  const state = storage.getState();
  const { employees, companies, settings, hourlyLeaves } = state;
  const isEn = i18n.getLang() === 'en';
  const canView = can(state.currentUser, 'hourlyLeaves.view');
  const canEdit = can(state.currentUser, 'hourlyLeaves.edit');
  const canApprove = can(state.currentUser, 'hourlyLeaves.approve');
  const canDelete = can(state.currentUser, 'hourlyLeaves.delete');

  let selectedMonth = options.month || getCurrentMonth();
  let statusFilter = 'all';

  function render() {
    // Filter leaves by month
    const monthLeaves = hourlyLeaves.filter((l) => {
      const lMonth = (l.date || '').slice(0, 7);
      const matchMonth = lMonth === selectedMonth;
      const matchStatus = statusFilter === 'all' || l.status === statusFilter;
      return matchMonth && matchStatus;
    });

    const totalHoursApproved = monthLeaves
      .filter((l) => l.status === 'approved')
      .reduce((s, l) => s + (Number(l.hours) || 0), 0);

    const pendingRequests = monthLeaves.filter((l) => l.status === 'pending');

    container.innerHTML = `
      <!-- Top Action Bar -->
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:20px;">
        <div>
          <h2 style="font-size:20px; font-weight:800; color:var(--text-main);">
            ${isEn ? 'Hourly Leaves & Time-off Permissions' : 'الإجازات الزمنية (بالساعة)'}
          </h2>
          <p style="font-size:13px; color:var(--text-muted);">
            ${isEn ? 'Manage monthly short permissions & hourly quotas (non-cumulative, renewed monthly)' : 'إدارة ومتابعة أذونات وساعات الخروج الشهرية (غير قابلة للتدوير وتتجدد كل شهر)'}
          </p>
        </div>

        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <input type="month" class="form-input" id="hl-month-picker" value="${selectedMonth}" style="width:160px; font-weight:700;">
          <button type="button" class="btn btn-outline" id="btn-export-hl-excel">
            ${Icons.download(16)} ${t('exportExcel')}
          </button>
          <button type="button" class="btn btn-primary" id="btn-add-hourly-leave">
            ${Icons.plus(16)} ${isEn ? 'Request Hourly Leave' : 'طلب إجازة زمنية'}
          </button>
        </div>
      </div>

      <!-- KPI Summary Cards -->
      <div class="grid grid-cols-4" style="margin-bottom:20px;">
        <div class="card" style="padding:16px;">
          <div style="font-size:12px; color:var(--text-muted);">${isEn ? 'Total Approved Hours (Month)' : 'إجمالي الساعات المصروفة للشهر'}</div>
          <div style="font-size:24px; font-weight:900; color:var(--primary); margin-top:4px;">
            ${totalHoursApproved} <span style="font-size:14px; font-weight:600;">${isEn ? 'hrs' : 'ساعة'}</span>
          </div>
          <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">${isEn ? 'During month' : 'خلال شهر'} ${selectedMonth}</div>
        </div>

        <div class="card" style="padding:16px;">
          <div style="font-size:12px; color:var(--text-muted);">${isEn ? 'Pending Approvals' : 'الطلبات المعلقة للموافقة'}</div>
          <div style="font-size:24px; font-weight:900; color:var(--warning); margin-top:4px;">${pendingRequests.length}</div>
          <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">${isEn ? 'Awaiting HR decision' : 'بانتظار قرار الموارد البشرية'}</div>
        </div>

        <div class="card" style="padding:16px;">
          <div style="font-size:12px; color:var(--text-muted);">${isEn ? 'Approved Permissions Count' : 'إجمالي أذونات الخروج المعتمدة'}</div>
          <div style="font-size:24px; font-weight:900; color:var(--success); margin-top:4px;">
            ${monthLeaves.filter((l) => l.status === 'approved').length}
          </div>
          <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">${isEn ? 'Hourly exit passes' : 'إذن مغادرة بالساعة'}</div>
        </div>

        <div class="card" style="padding:16px;">
          <div style="font-size:12px; color:var(--text-muted);">${isEn ? 'Default Monthly Quota' : 'حصة الساعات الافتراضية'}</div>
          <div style="font-size:24px; font-weight:900; color:var(--info); margin-top:4px;">
            ${settings.defaultHourlyLeaveQuota || 4} <span style="font-size:14px; font-weight:600;">${isEn ? 'hrs/month' : 'ساعة/شهر'}</span>
          </div>
          <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">${isEn ? 'Per employee per month' : 'لكل موظف شهرياً'}</div>
        </div>
      </div>

      <!-- Filters & Search -->
      <div class="card" style="padding:14px 20px; margin-bottom:16px; background:var(--bg-card-hover);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <button type="button" class="btn btn-sm ${statusFilter === 'all' ? 'btn-primary' : 'btn-outline'} filter-btn" data-status="all">${isEn ? 'All' : 'الكل'} (${monthLeaves.length})</button>
            <button type="button" class="btn btn-sm ${statusFilter === 'approved' ? 'btn-primary' : 'btn-outline'} filter-btn" data-status="approved">${isEn ? 'Approved' : 'معتمدة'}</button>
            <button type="button" class="btn btn-sm ${statusFilter === 'pending' ? 'btn-primary' : 'btn-outline'} filter-btn" data-status="pending">${isEn ? 'Pending' : 'معلقة'} (${pendingRequests.length})</button>
            <button type="button" class="btn btn-sm ${statusFilter === 'rejected' ? 'btn-primary' : 'btn-outline'} filter-btn" data-status="rejected">${isEn ? 'Rejected' : 'مرفوضة'}</button>
          </div>

          <div style="font-size:12.5px; color:var(--text-muted);">
            ${isEn ? 'Hourly quota resets at the start of each month and does not carry over' : 'تتجدد حصة الساعات في بداية كل شهر ولا يتم ترحيلها'}
          </div>
        </div>
      </div>

      <!-- Requests Table -->
      <div class="card" style="padding:0; overflow:hidden;">
        <div class="table-container" style="border:none;">
          <table class="table">
            <thead>
              <tr>
                <th>${t('employeeCol')}</th>
                <th>${isEn ? 'Permission Date' : 'تاريخ الإذن'}</th>
                <th>${isEn ? 'Time Slot' : 'فترة الخروج'}</th>
                <th>${isEn ? 'Hours' : 'عدد الساعات'}</th>
                <th>${isEn ? 'Month Balance' : 'رصيد الشهر'}</th>
                <th>${t('reason')}</th>
                <th>${t('statusCol')}</th>
                <th style="text-align:left;">${t('actionsCol')}</th>
              </tr>
            </thead>
            <tbody>
              ${
                monthLeaves.length === 0
                  ? `<tr><td colspan="8" style="text-align:center; padding:36px; color:var(--text-muted);">
                      ${isEn ? 'No hourly leave requests recorded for this month' : 'لا توجد طلبات إجازة زمنية مسجلة لهذا الشهر'}
                    </td></tr>`
                  : monthLeaves
                      .map((req) => {
                        const emp = employees.find((e) => e.id === req.employeeId);
                        const empName = emp ? (isEn && emp.fullNameEn ? emp.fullNameEn : emp.fullName) : req.employeeName;
                        const bal = emp ? calculateHourlyBalance(emp.id, hourlyLeaves, selectedMonth, getEmployeeHourlyQuota(emp, companies.find(c => c.id === emp.companyId), settings)) : null;

                        return `
                        <tr data-hl-id="${req.id}">
                          <td>
                            <strong>${empName}</strong>
                            <div style="font-size:11.5px; color:var(--text-muted);">${emp ? emp.department : '-'}</div>
                          </td>
                          <td><strong>${formatDate(req.date)}</strong></td>
                          <td>
                            ${req.startTime && req.endTime ? `<span class="badge badge-gray">${req.startTime} - ${req.endTime}</span>` : '-'}
                          </td>
                          <td>
                            <strong style="color:var(--primary); font-size:15px;">${req.hours}</strong> <span style="font-size:11px;">${isEn ? 'hrs' : 'ساعة'}</span>
                          </td>
                          <td>
                            ${
                              bal
                                ? `<span style="font-size:12px;">${isEn ? `Remaining: <strong>${bal.remainingHours}</strong> of ${bal.quotaHours}` : `متبقي: <strong>${bal.remainingHours}</strong> من ${bal.quotaHours}`}</span>`
                                : '-'
                            }
                          </td>
                          <td style="max-width:200px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
                            ${req.reason || '-'}
                          </td>
                          <td>
                            ${
                              req.status === 'approved'
                                ? `<span class="badge badge-success">${isEn ? 'Approved' : 'معتمد'}</span>`
                                : req.status === 'rejected'
                                  ? `<span class="badge badge-danger">${isEn ? 'Rejected' : 'مرفوض'}</span>`
                                  : `<span class="badge badge-warning">${isEn ? 'Pending' : 'قيد الانتظار'}</span>`
                            }
                          </td>
                          <td>
                            <div style="display:flex; align-items:center; gap:6px; justify-content:flex-end;">
                              ${canView ? `
                                <button type="button" class="btn btn-icon btn-sm btn-outline btn-view-hl" data-id="${req.id}" title="${t('view')}">
                                  ${Icons.eye(14)}
                                </button>
                              ` : ''}
                              ${canEdit ? `
                                <button type="button" class="btn btn-icon btn-sm btn-outline btn-edit-hl" data-id="${req.id}" title="${t('edit')}">
                                  ${Icons.edit(14)}
                                </button>
                              ` : ''}
                              ${
                                req.status === 'pending'
                                  ? `
                                  <button type="button" class="btn btn-sm btn-success btn-approve-hl" data-id="${req.id}">
                                    ${Icons.check(14)} ${t('approve')}
                                  </button>
                                  <button type="button" class="btn btn-sm btn-outline btn-reject-hl" data-id="${req.id}" style="color:var(--danger); border-color:var(--danger);">
                                    ${Icons.x(14)} ${t('reject')}
                                  </button>
                                `
                                  : ''
                              }
                              ${canDelete ? `
                                <button type="button" class="btn btn-icon btn-sm btn-outline btn-delete-hl" data-id="${req.id}" style="color:var(--danger);">
                                  ${Icons.trash(14)}
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

    // Event Listeners
    container.querySelector('#hl-month-picker')?.addEventListener('change', (e) => {
      selectedMonth = e.target.value;
      render();
    });

    container.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        statusFilter = btn.getAttribute('data-status');
        render();
      });
    });

    container.querySelector('#btn-add-hourly-leave')?.addEventListener('click', () => {
      openHourlyLeaveModal(null, () => render());
    });

    // View (read-only preview)
    container.querySelectorAll('.btn-view-hl').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!canView) return;
        const id = btn.getAttribute('data-id');
        const req = hourlyLeaves.find((l) => l.id === id);
        if (req) openRecordPreview('hourlyLeave', req, { employees, companies, settings });
      });
    });

    // Edit
    container.querySelectorAll('.btn-edit-hl').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!canEdit) {
          toast.error(isEn ? 'Insufficient permissions' : 'لا تملك صلاحية التعديل');
          return;
        }
        const id = btn.getAttribute('data-id');
        const req = hourlyLeaves.find((l) => l.id === id);
        if (req) openHourlyLeaveModal(req, () => render());
      });
    });

    // Approve
    container.querySelectorAll('.btn-approve-hl').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (!canApprove) { // RBAC gate
          toast.error(isEn ? 'Insufficient permissions' : 'لا تملك صلاحية الاعتماد');
          return;
        }
        const req = hourlyLeaves.find((l) => l.id === id);
        if (!req) return;

        req.status = 'approved';
        req.approvedAt = new Date().toISOString();
        req.approvedBy = state.currentUser ? state.currentUser.name : (isEn ? 'Manager' : 'المدير');
        const res = storage.updateHourlyLeave(req);
        if (res && res.ok === false) {
          toast.error(storage.recordErrorText(res.error, isEn));
          render();
          return;
        }
        toast.success(isEn ? 'Hourly leave approved' : 'تم اعتماد الإجازة الزمنية بنجاح');
        render();
      });
    });

    // Reject
    container.querySelectorAll('.btn-reject-hl').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (!canApprove) { // RBAC gate
          toast.error(isEn ? 'Insufficient permissions' : 'لا تملك صلاحية الرفض');
          return;
        }
        const req = hourlyLeaves.find((l) => l.id === id);
        if (!req) return;

        req.status = 'rejected';
        req.rejectedAt = new Date().toISOString();
        const res = storage.updateHourlyLeave(req);
        if (res && res.ok === false) {
          toast.error(storage.recordErrorText(res.error, isEn));
          render();
          return;
        }
        toast.info(isEn ? 'Hourly leave rejected' : 'تم رفض طلب الإجازة الزمنية');
        render();
      });
    });

    // Delete
    container.querySelectorAll('.btn-delete-hl').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (!canDelete) { // RBAC gate
          toast.error(isEn ? 'Insufficient permissions' : 'لا تملك صلاحية الحذف');
          return;
        }
        showConfirmDialog({
          title: t('delete'),
          message: isEn ? 'Are you sure you want to delete this hourly leave request?' : 'هل أنت متأكد من رغبتك في حذف طلب الإجازة الزمنية هذا؟',
          confirmText: t('delete'),
          onConfirm: () => {
            storage.deleteHourlyLeave(id);
            toast.success(isEn ? 'Request deleted' : 'تم حذف الطلب بنجاح');
            render();
          },
        });
      });
    });

    // Export Excel / CSV
    container.querySelector('#btn-export-hl-excel')?.addEventListener('click', () => {
      const exportData = monthLeaves.map((l) => {
        const emp = employees.find((e) => e.id === l.employeeId);
        return {
          [isEn ? 'Emp ID' : 'الرقم الوظيفي']: emp ? emp.employeeNumber : '-',
          [isEn ? 'Employee Name' : 'اسم الموظف']: emp ? (isEn && emp.fullNameEn ? emp.fullNameEn : emp.fullName) : l.employeeName,
          [isEn ? 'Department' : 'القسم']: emp ? emp.department : '-',
          [isEn ? 'Date' : 'التاريخ']: l.date,
          [isEn ? 'Start Time' : 'وقت البداية']: l.startTime || '-',
          [isEn ? 'End Time' : 'وقت النهاية']: l.endTime || '-',
          [isEn ? 'Hours' : 'عدد الساعات']: l.hours,
          [isEn ? 'Status' : 'الحالة']: l.status === 'approved' ? (isEn ? 'Approved' : 'معتمد') : l.status === 'rejected' ? (isEn ? 'Rejected' : 'مرفوض') : (isEn ? 'Pending' : 'معلق'),
          [isEn ? 'Reason' : 'السبب']: l.reason || '-',
        };
      });

      if (window.XLSX) {
        try {
          if (!can(storage.getActiveUser(), 'reports.export')) { // RBAC gate (C-5)
            toast.error(isEn ? 'Insufficient permissions' : 'لا تملك صلاحية التصدير');
            return;
          }
          const ws = XLSX.utils.json_to_sheet(exportData);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, 'Hourly Leaves');
          XLSX.writeFile(wb, `Hourly_Leaves_${selectedMonth}.xlsx`);
          toast.success(isEn ? 'Exported successfully' : 'تم التصدير بنجاح');
          return;
        } catch(err) {}
      }

      // Fallback CSV
      const headers = Object.keys(exportData[0] || {});
      const csvRows = exportData.map(row => headers.map(h => `"${(row[h] !== undefined ? row[h] : '').toString().replace(/"/g, '""')}"`).join(','));
      const csvContent = '\uFEFF' + [headers.join(','), ...csvRows].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Hourly_Leaves_${selectedMonth}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(isEn ? 'Exported CSV successfully' : 'تم التصدير بنجاح (.csv)');
    });
  }

  render();
}
