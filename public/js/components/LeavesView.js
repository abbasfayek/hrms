// ==========================================
// Leaves Management & Balances View
// ==========================================

import { storage } from '../storage.js';
import { Icons } from '../icons.js';
import { formatDate, LEAVE_TYPE_LABELS, can } from '../types.js';
import { calculateLeaveBalance } from '../engines/leaveEngine.js';
import { openLeaveRequestModal } from './LeaveRequestModal.js';
import { openYearEndRolloverModal } from './YearEndRolloverModal.js';
import { showConfirmDialog } from './Modal.js';
import { toast } from './Toast.js';
import { t, tf, i18n } from '../i18n.js';

export function renderLeavesView(container, options = {}) {
  const state = storage.getState();
  const { employees, leaves, settings } = state;
  const isEn = i18n.getLang() === 'en';
  const canAddLeaves = can(state.currentUser, 'leaves.add');
  const canApproveLeaves = can(state.currentUser, 'leaves.approve');
  const canEditLeaves = can(state.currentUser, 'leaves.edit');
  const canDeleteLeaves = can(state.currentUser, 'leaves.delete');

  const activeEmployees = employees.filter((e) => e.status === 'active' || e.status === 'probation');
  const pendingLeaves = leaves.filter((l) => l.status === 'pending');
  const empName = (l) => {
    const e = employees.find((x) => x.id === l?.employeeId);
    return e?.fullName || l?.employeeId || '';
  };

  // Compute all balances
  const balances = activeEmployees.map((emp) => calculateLeaveBalance(emp, leaves, new Date(), settings));

  const totalRemainingDays = balances.reduce((sum, b) => sum + Math.max(0, b.remainingAnnualBalance), 0);
  const totalUsedDays = balances.reduce((sum, b) => sum + b.usedAnnualDays, 0);

  let activeTab = options.tab || 'balances'; // 'balances' | 'requests'

  function renderTabs() {
    const contentArea = container.querySelector('#leaves-tab-content-area');
    if (!contentArea) return;

    if (activeTab === 'balances') {
      contentArea.innerHTML = `
        <div class="card" style="padding:0; overflow:hidden;">
          <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between;">
            <div style="font-weight:700; font-size:15px; color:var(--text-main);">
              ${t('leaves.balanceReportTitle')}
            </div>
            <span class="badge badge-primary">${tf('leaves.activeEmployeeCount', { count: balances.length })}</span>
          </div>

          <div class="table-container" style="border:none;">
            <table class="table">
              <thead>
                <tr>
                  <th>${t('leaves.employee')}</th>
                  <th>${t('leaves.department')}</th>
                  <th>${t('leaves.annualEntitlement')}</th>
                  <th>${t('leaves.carriedOverBalance')}</th>
                  <th>${t('leaves.accruedThisYear')}</th>
                  <th>${t('leaves.usedDays')}</th>
                  <th>${t('leaves.remainingBalance')}</th>
                  <th>${t('leaves.pendingRequests')}</th>
                </tr>
              </thead>
              <tbody>
                ${balances
                  .map(
                    (b) => `
                  <tr>
                    <td><strong>${b.employeeName}</strong></td>
                    <td><span style="color:var(--text-muted); font-size:13px;">${b.department}</span></td>
                    <td><span class="badge badge-gray">${b.annualEntitlement} ${isEn ? 'days/yr' : 'يوم/سنة'}</span></td>
                    <td><strong style="color:var(--text-main);">${b.carriedOver} ${isEn ? 'days' : 'يوم'}</strong></td>
                    <td><span style="color:var(--text-muted);">${b.accruedCurrentYear} ${isEn ? 'days' : 'يوم'}</span></td>
                    <td><strong style="color:var(--danger);">${b.usedAnnualDays} ${isEn ? 'days' : 'يوم'}</strong></td>
                    <td>
                      <span class="badge ${b.remainingAnnualBalance > 5 ? 'badge-success' : b.remainingAnnualBalance > 0 ? 'badge-warning' : 'badge-danger'}" style="font-size:13px; font-weight:800;">
                        ${b.remainingAnnualBalance} ${isEn ? 'days' : 'يوم'}
                      </span>
                    </td>
                    <td>
                      ${b.pendingDays > 0 ? `<span class="badge badge-warning">${b.pendingDays} ${isEn ? 'pending' : 'يوم معلق'}</span>` : `<span style="color:var(--text-muted);">-</span>`}
                    </td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else {
      // Requests Tab
      contentArea.innerHTML = `
        <div class="card" style="padding:0; overflow:hidden;">
          <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between;">
            <div style="font-weight:700; font-size:15px; color:var(--text-main);">
              ${isEn ? 'Leave Requests & Approvals Log' : 'سجل طلبات الإجازات والموافقات'}
            </div>
            <span class="badge badge-primary">${leaves.length} ${isEn ? 'total requests' : 'طلب إجمالي'}</span>
          </div>

          <div class="table-container" style="border:none;">
            <table class="table">
              <thead>
                <tr>
                  <th>${t('leaves.employee')}</th>
                  <th>${t('leaveType')}</th>
                  <th>${t('period')}</th>
                  <th>${t('duration')}</th>
                  <th>${t('reason')}</th>
                  <th>${t('submissionDate')}</th>
                  <th>${t('statusCol')}</th>
                  <th style="text-align:left;">${t('actionsCol')}</th>
                </tr>
              </thead>
              <tbody>
                ${
                  leaves.length === 0
                    ? `<tr><td colspan="8" style="text-align:center; padding:32px; color:var(--text-muted);">${t('noLeavesRecorded')}</td></tr>`
                    : leaves
                        .map((l) => {
                          const emp = employees.find((e) => e.id === l.employeeId);
                          const leaveTypeLabel = LEAVE_TYPE_LABELS[l.leaveType] ? (isEn ? LEAVE_TYPE_LABELS[l.leaveType].en : LEAVE_TYPE_LABELS[l.leaveType].ar) : l.leaveType;
                          const statusLabel = l.status === 'approved' ? (isEn ? 'Approved' : 'معتمدة') : l.status === 'rejected' ? (isEn ? 'Rejected' : 'مرفوضة') : l.status === 'cancelled' ? (isEn ? 'Cancelled' : 'ملغاة') : (isEn ? 'Pending' : 'قيد الانتظار');
                          return `
                      <tr data-leave-id="${l.id}">
                        <td><strong>${emp ? emp.fullName : (isEn ? 'Unknown' : 'غير معروف')}</strong></td>
                        <td>
                          <span class="badge badge-primary" style="font-size:11.5px;">
                            ${leaveTypeLabel}
                          </span>
                        </td>
                        <td>${formatDate(l.startDate)} ${isEn ? 'to' : 'إلى'} ${formatDate(l.endDate)}</td>
                        <td><strong style="color:var(--primary);">${l.daysCount} ${isEn ? 'days' : 'يوم'}</strong></td>
                        <td style="max-width:180px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${l.reason || '-'}</td>
                        <td>${formatDate(l.createdAt)}</td>
                        <td>
                          <span class="badge ${l.status === 'approved' ? 'badge-success' : l.status === 'rejected' ? 'badge-danger' : l.status === 'cancelled' ? 'badge-gray' : 'badge-warning'}">
                            ${statusLabel}
                          </span>
                        </td>
                        <td>
                          <div style="display:flex; align-items:center; gap:6px; justify-content:flex-end;">
                            ${l.status === 'pending' && canApproveLeaves ? `
                              <button type="button" class="btn btn-sm btn-success btn-approve-leave" title="${t('approve')}">
                                ${Icons.check(14)} ${isEn ? 'Approve' : 'اعتماد'}
                              </button>
                              <button type="button" class="btn btn-sm btn-danger btn-reject-leave" title="${t('reject')}">
                                ${Icons.x(14)} ${isEn ? 'Reject' : 'رفض'}
                              </button>
                            ` : ''}
                            ${(l.status === 'pending' || l.status === 'approved') && canEditLeaves ? `
                              <button type="button" class="btn btn-sm btn-outline btn-cancel-leave" title="${isEn ? 'Cancel leave (restores balance)' : 'إلغاء الإجازة (يعيد الرصيد)'}">
                                ${Icons.x(14)} ${isEn ? 'Cancel' : 'إلغاء'}
                              </button>
                            ` : ''}
                            ${canEditLeaves ? `
                              <button type="button" class="btn btn-icon btn-sm btn-outline btn-edit-leave" title="${t('edit')}">
                                ${Icons.edit(14)}
                              </button>
                            ` : ''}
                            ${canDeleteLeaves ? `
                              <button type="button" class="btn btn-icon btn-sm btn-outline btn-delete-leave" style="color:var(--danger);" title="${t('delete')}">
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

      // Attach actions in requests tab
      contentArea.querySelectorAll('tr').forEach((row) => {
        const leaveId = row.getAttribute('data-leave-id');
        const leave = leaves.find((l) => l.id === leaveId);

        row.querySelector('.btn-approve-leave')?.addEventListener('click', () => {
          if (!canApproveLeaves) return;
          const res = storage.updateLeave({
            ...leave,
            status: 'approved',
            approvedBy: isEn ? 'HR Department' : 'إدارة الموارد البشرية',
            approvalDate: new Date().toISOString().split('T')[0],
          });
          if (!res.ok) {
            toast.error(storage.recordErrorText(res.error, isEn));
            return;
          }
          storage.addAudit('approve', 'leave', `${empName(leave)} — ${leave.startDate} → ${leave.endDate}`, leaveId);
          toast.success(isEn ? 'Leave request approved' : 'تم اعتماد طلب الإجازة واقتطاع الأيام من الرصيد');
          renderLeavesView(container, { tab: 'requests' });
        });

        row.querySelector('.btn-reject-leave')?.addEventListener('click', () => {
          if (!canApproveLeaves) return;
          const res = storage.updateLeave({
            ...leave,
            status: 'rejected',
            rejectionReason: isEn ? 'Rejected by HR' : 'رفض من إدارة الموارد البشرية',
          });
          if (!res.ok) {
            toast.error(storage.recordErrorText(res.error, isEn));
            return;
          }
          storage.addAudit('reject', 'leave', `${empName(leave)} — ${leave.startDate} → ${leave.endDate}`, leaveId);
          toast.warning(isEn ? 'Leave request rejected' : 'تم رفض طلب الإجازة');
          renderLeavesView(container, { tab: 'requests' });
        });

        row.querySelector('.btn-cancel-leave')?.addEventListener('click', () => {
          if (!canEditLeaves) return;
          const emp = employees.find((e) => e.id === leave?.employeeId);
          showConfirmDialog({
            title: isEn ? 'Cancel Leave' : 'إلغاء الإجازة',
            message: isEn
              ? `Cancel this leave for ${emp?.fullName || ''}? The days will be returned to the balance.`
              : `إلغاء إجازة ${emp?.fullName || ''}؟ ستُعاد الأيام إلى الرصيد.`,
            confirmText: isEn ? 'Yes, Cancel' : 'نعم، إلغاء',
            onConfirm: () => {
              const res = storage.updateLeave({ ...leave, status: 'cancelled' });
              if (!res.ok) {
                toast.error(storage.recordErrorText(res.error, isEn));
                return;
              }
              storage.addAudit('cancel', 'leave', `${empName(leave)} — ${leave.startDate} → ${leave.endDate}`, leaveId);
              toast.success(isEn ? 'Leave cancelled — days returned to balance' : 'تم إلغاء الإجازة وأعيدت الأيام إلى الرصيد');
              renderLeavesView(container, { tab: 'requests' });
            },
          });
        });

        row.querySelector('.btn-edit-leave')?.addEventListener('click', () => {
          if (!canEditLeaves) return;
          if (!leave) return;
          openLeaveRequestModal(null, () => renderLeavesView(container, { tab: 'requests' }), leave);
        });

        row.querySelector('.btn-delete-leave')?.addEventListener('click', () => {
          if (!canDeleteLeaves) return;
          const emp = employees.find((e) => e.id === leave?.employeeId);
          showConfirmDialog({
            title: isEn ? 'Delete Leave Record' : 'حذف طلب الإجازة',
            message: isEn ? `Are you sure you want to delete leave record for ${emp?.fullName || ''}?` : `هل أنت متأكد من حذف سجل إجازة ${emp?.fullName || ''}؟`,
            confirmText: isEn ? 'Yes, Delete' : 'نعم، حذف',
            onConfirm: () => {
              storage.deleteLeave(leaveId);
              storage.addAudit('delete', 'leave', `${emp?.fullName || ''} — ${leave.startDate} → ${leave.endDate}`, leaveId);
              toast.success(isEn ? 'Leave record deleted' : 'تم حذف سجل الإجازة');
              renderLeavesView(container, { tab: 'requests' });
            },
          });
        });
      });
    }
  }

  container.innerHTML = `
    <!-- Top Action Bar -->
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:20px;">
      <div>
        <h2 style="font-size:20px; font-weight:800; color:var(--text-main);">${t('leaveManagementTitle')}</h2>
        <p style="font-size:13px; color:var(--text-muted);">${t('leavesManagementSub')}</p>
      </div>

      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        ${canEditLeaves ? `
          <button type="button" class="btn btn-outline" id="btn-open-rollover-modal">
            ${Icons.refresh(16)} ${t('rolloverYearBalance')}
          </button>
        ` : ''}
        ${canAddLeaves ? `
          <button type="button" class="btn btn-primary" id="btn-open-leave-modal">
            ${Icons.plus(16)} ${t('requestLeave')}
          </button>
        ` : ''}
      </div>
    </div>

    <!-- KPI Summary Grid -->
    <div class="grid grid-cols-3" style="margin-bottom:20px;">
      <div class="card stat-card stat-success">
        <div>
          <div class="stat-label">${t('totalRemainingBalance')}</div>
          <div class="stat-value">${totalRemainingDays.toFixed(1)} ${isEn ? 'days' : 'يوم'}</div>
          <div class="stat-sub">${t('availableForUse')}</div>
        </div>
        <div class="stat-icon-wrapper">${Icons.calendar(24)}</div>
      </div>

      <div class="card stat-card stat-primary">
        <div>
          <div class="stat-label">${t('usedLeaveDaysThisYear')}</div>
          <div class="stat-value">${totalUsedDays} ${isEn ? 'days' : 'يوم'}</div>
          <div class="stat-sub">${t('acrossAllDepts')}</div>
        </div>
        <div class="stat-icon-wrapper">${Icons.award(24)}</div>
      </div>

      <div class="card stat-card stat-warning">
        <div>
          <div class="stat-label">${t('pendingLeaveReviews')}</div>
          <div class="stat-value">${pendingLeaves.length} ${isEn ? 'requests' : 'طلب'}</div>
          <div class="stat-sub">${t('requiresReview')}</div>
        </div>
        <div class="stat-icon-wrapper">${Icons.clock(24)}</div>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="tabs-header">
      <button type="button" class="tab-btn ${activeTab === 'balances' ? 'active' : ''}" id="tab-btn-balances">
        ${Icons.calendar(16)} ${t('balancesTableTab')}
      </button>
      <button type="button" class="tab-btn ${activeTab === 'requests' ? 'active' : ''}" id="tab-btn-requests">
        ${Icons.fileText(16)} ${t('requestsHistoryTab')} (${leaves.length})
      </button>
    </div>

    <!-- Tab Content Container -->
    <div id="leaves-tab-content-area"></div>
  `;

  // Attach tab switching events
  const tabBalances = container.querySelector('#tab-btn-balances');
  const tabRequests = container.querySelector('#tab-btn-requests');

  tabBalances?.addEventListener('click', () => {
    activeTab = 'balances';
    tabBalances.classList.add('active');
    tabRequests.classList.remove('active');
    renderTabs();
  });

  tabRequests?.addEventListener('click', () => {
    activeTab = 'requests';
    tabRequests.classList.add('active');
    tabBalances.classList.remove('active');
    renderTabs();
  });

  container.querySelector('#btn-open-leave-modal')?.addEventListener('click', () => {
    if (!canAddLeaves) return;
    openLeaveRequestModal(null, () => renderLeavesView(container, { tab: activeTab }));
  });

  container.querySelector('#btn-open-rollover-modal')?.addEventListener('click', () => {
    if (!canEditLeaves) return;
    openYearEndRolloverModal(() => renderLeavesView(container, { tab: activeTab }));
  });

  renderTabs();

  if (options.openLeaveModal && canAddLeaves) {
    openLeaveRequestModal(null, () => renderLeavesView(container, { tab: activeTab }));
  } else if (options.openRolloverModal && canEditLeaves) {
    openYearEndRolloverModal(() => renderLeavesView(container, { tab: activeTab }));
  }
}
