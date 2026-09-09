// ==========================================
// Attendance, Overtime & Holidays Management View
// ==========================================

import { storage } from '../storage.js';
import { Icons } from '../icons.js';
import { can, formatCurrency, formatDate, formatAmountWithCode, resolveEmployeeCurrency, summarizeCurrencySegments } from '../types.js';
import { openOvertimeModal } from './OvertimeModal.js';
import { openAttendanceModal } from './AttendanceModal.js';
import { openAbsenceModal } from './AbsenceModal.js';
import { openHolidayModal } from './HolidaysModal.js';
import { openRecordPreview } from './RecordPreviewModal.js';
import { syncBiometricLogs } from '../engines/biometricEngine.js';
import { showConfirmDialog } from './Modal.js';
import { toast } from './Toast.js';
import { i18n, t, tf } from '../i18n.js';

export function renderAttendanceOvertimeView(container, options = {}) {
  const state = storage.getState();
  const { employees, attendance, overtime, holidays = [], settings, companies } = state;
  const isEn = i18n.getLang() === 'en';
  const currentUser = state.currentUser;
  const canApproveOvertime = can(currentUser, 'overtime.approve');
  const canDeleteOvertime = can(currentUser, 'overtime.delete');
  const canEditOvertime = can(currentUser, 'overtime.edit');
  const canAddAttendance = can(currentUser, 'attendance.add');
  const canEditAttendance = can(currentUser, 'attendance.edit');
  const canDeleteAttendance = can(currentUser, 'attendance.delete');
  const canViewRecords = can(currentUser, 'attendance.view');
  const canAddOvertime = can(currentUser, 'overtime.add');

  let activeSubTab = options.subTab || 'overtime'; // 'overtime' | 'attendance' | 'holidays'

  // Summary Metrics
  const approvedOvertime = overtime.filter((o) => o.status === 'approved');
  const totalOvertimeHours = approvedOvertime.reduce((sum, o) => sum + (Number(o.hours) || 0), 0);
  const totalOvertimeCost = approvedOvertime.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
  const approvedOvertimeSegments = approvedOvertime.map((o) => {
    const emp = employees.find((e) => e.id === o.employeeId);
    const cur = resolveEmployeeCurrency(emp, settings, companies);
    return { code: o.currency || cur.code, amount: Number(o.totalAmount) || 0 };
  });
  const totalOvertimeCostSegmented = summarizeCurrencySegments(approvedOvertimeSegments);

  function renderSubTab() {
    const contentArea = container.querySelector('#attendance-ot-content-area');
    if (!contentArea) return;

    if (activeSubTab === 'overtime') {
      contentArea.innerHTML = `
        <div class="card" style="padding:0; overflow:hidden;">
          <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between;">
            <div style="font-weight:700; font-size:15px; color:var(--text-main);">
              ${t('att.overtimeLogTitle')}
            </div>
            <span class="badge badge-primary">${tf('att.totalRecords',{count:overtime.length})}</span>
          </div>

          <div class="table-container" style="border:none;">
            <table class="table">
              <thead>
                <tr>
                  <th>${t('att.employee')}</th><th>${t('att.date')}</th><th>${t('att.financialPeriod')}</th><th>${t('att.hours')}</th><th>${t('att.calculationMultiplier')}</th><th>${t('att.hourlyWage')}</th><th>${t('att.totalPayable')}</th><th>${t('att.reason')}</th><th>${t('att.status')}</th><th style="text-align:left;">${t('att.action')}</th>
                </tr>
              </thead>
              <tbody>
                ${
                  overtime.length === 0
                    ? `<tr><td colspan="10" style="text-align:center; padding:32px; color:var(--text-muted);">${t('att.noOvertimeRecords')}</td></tr>`
                    : overtime
                        .map((ot) => {
                          const emp = employees.find((e) => e.id === ot.employeeId);
                          const cur = resolveEmployeeCurrency(emp, settings, companies);
                          const curCode = ot.currency || cur.code;
                          return `
                      <tr data-ot-id="${ot.id}">
                        <td>
                          <strong>${emp ? emp.fullName : t('att.unknown')}</strong>
                          <div style="font-size:11.5px; color:var(--text-muted);">${emp ? emp.employeeNumber : ''}</div>
                        </td>
                        <td>${formatDate(ot.date)}</td>
                        <td><span class="badge badge-gray">${ot.payrollPeriod}</span></td>
                        <td><strong>${tf('att.hoursValue',{count:ot.hours})}</strong></td>
                        <td>${(ot.multiplier ?? ot.rateMultiplier ?? 1.5)}x (${(ot.type === 'weekend' || ot.type === 'holiday' || ot.isHoliday) ? t('att.officialHoliday') : t('att.regularDay')})</td>
                        <td>${formatAmountWithCode(ot.hourlyRate, curCode)}</td>
                        <td><strong style="color:var(--primary);">${formatAmountWithCode(ot.totalAmount, curCode)}</strong></td>
                        <td>${ot.reason || '-'}</td>
                        <td>
                          <span class="badge ${ot.status === 'approved' ? 'badge-success' : ot.status === 'pending' ? 'badge-warning' : 'badge-danger'}">
                            ${ot.status === 'approved' ? (isEn ? 'Approved' : 'معتمد') : ot.status === 'pending' ? (isEn ? 'Pending' : 'معلق') : (isEn ? 'Rejected' : 'مرفوض')}
                          </span>
                        </td>
                        <td>
                          <div style="display:flex; align-items:center; gap:6px; justify-content:flex-end;">
                            ${canViewRecords ? `
                              <button type="button" class="btn btn-icon btn-sm btn-outline btn-view-ot" title="${t('view')}">
                                ${Icons.eye(14)}
                              </button>
                            ` : ''}
                            ${canEditOvertime ? `
                              <button type="button" class="btn btn-icon btn-sm btn-outline btn-edit-ot" title="${t('edit')}">
                                ${Icons.edit(14)}
                              </button>
                            ` : ''}
                            ${canApproveOvertime && ot.status === 'pending' ? `
                              <button type="button" class="btn btn-icon btn-sm btn-success btn-approve-ot" title="${t('att.approve')}">
                                ${Icons.check(14)}
                              </button>
                            ` : ''}
                            ${canDeleteOvertime ? `
                              <button type="button" class="btn btn-icon btn-sm btn-outline btn-delete-ot" style="color:var(--danger);" title="${t('att.delete')}">
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

      // Event handlers for OT
      contentArea.querySelectorAll('.btn-view-ot').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (!canViewRecords) return;
          const row = e.target.closest('tr');
          const otId = row?.getAttribute('data-ot-id');
          const ot = overtime.find((o) => o.id === otId);
          if (ot) openRecordPreview('overtime', ot, { employees, companies, settings });
        });
      });

      contentArea.querySelectorAll('.btn-edit-ot').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (!canEditOvertime) return;
          const row = e.target.closest('tr');
          const otId = row?.getAttribute('data-ot-id');
          const ot = overtime.find((o) => o.id === otId);
          if (ot) openOvertimeModal(ot, () => renderAttendanceOvertimeView(container, { subTab: 'overtime' }));
        });
      });

      contentArea.querySelectorAll('.btn-approve-ot').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (!canApproveOvertime) return;
          const row = e.target.closest('tr');
          const otId = row?.getAttribute('data-ot-id');
          const ot = overtime.find((o) => o.id === otId);
          if (ot) {
            ot.status = 'approved';
            storage.saveOvertime(overtime);
            toast.success(t('att.overtimeApproved'));
            renderAttendanceOvertimeView(container, { subTab: 'overtime' });
          }
        });
      });

      contentArea.querySelectorAll('.btn-delete-ot').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (!canDeleteOvertime) return;
          const row = e.target.closest('tr');
          const otId = row?.getAttribute('data-ot-id');
          showConfirmDialog({
            title: isEn ? 'Delete Overtime Record' : 'حذف سجل الإضافي',
            message: isEn ? 'Are you sure you want to delete this record?' : 'هل أنت متأكد من حذف هذا السجل؟',
            confirmText: isEn ? 'Yes, delete' : 'نعم، حذف',
            onConfirm: () => {
              storage.deleteOvertime(otId);
              toast.success(t('att.recordDeleted'));
              renderAttendanceOvertimeView(container, { subTab: 'overtime' });
            },
          });
        });
      });
    } else if (activeSubTab === 'attendance') {
      contentArea.innerHTML = `
        <div class="card" style="padding:0; overflow:hidden;">
          <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between;">
            <div style="font-weight:700; font-size:15px; color:var(--text-main);">
              ${t('att.attendanceTab')}
            </div>
            <span class="badge badge-primary">${tf('att.recordedMovements',{count:attendance.length})}</span>
          </div>

          <div class="table-container" style="border:none;">
            <table class="table">
              <thead>
                <tr>
                  <th>${t('att.employee')}</th><th>${t('att.date')}</th><th>${t('att.checkInTime')}</th><th>${t('att.checkOutTime')}</th><th>${t('att.workingHours')}</th><th>${t('att.delayMinutes')}</th><th>${t('att.dayStatus')}</th><th>${t('att.sourceAndNotes')}</th><th style="text-align:left;">${t('att.action')}</th>
                </tr>
              </thead>
              <tbody>
                ${
                  attendance.length === 0
                    ? `<tr><td colspan="9" style="text-align:center; padding:32px; color:var(--text-muted);">${t('att.noAttendanceRecords')}</td></tr>`
                    : attendance
                        .map((att) => {
                          const emp = employees.find((e) => e.id === att.employeeId);
                          return `
                      <tr data-att-id="${att.id}" data-att-status="${att.status}">
                        <td><strong>${emp ? emp.fullName : t('att.unknown')}</strong></td>
                        <td>${formatDate(att.date)}</td>
                        <td>${att.checkIn || '-'}</td>
                        <td>${att.checkOut || '-'}</td>
                        <td>${tf('att.hoursValue',{count:att.workingHours||8})}</td>
                        <td>
                          ${
                            att.lateMinutes > 0
                              ? `<strong style="color:var(--danger);">${att.lateMinutes} ${isEn ? 'min' : 'دقيقة'}</strong>`
                              : `<span style="color:var(--text-muted);">${t('att.none')}</span>`
                          }
                        </td>
                        <td>
                          <span class="badge ${att.status === 'present' ? 'badge-success' : att.status === 'late' ? 'badge-warning' : att.status === 'half_day' ? 'badge-info' : 'badge-danger'}">
                            ${att.status === 'present' ? (isEn ? 'Present' : 'حاضر') : att.status === 'late' ? (isEn ? 'Late' : 'متأخر') : att.status === 'absent' ? (isEn ? 'Absent' : 'غائب') : att.status === 'half_day' ? (isEn ? 'Half Day' : 'نصف يوم') : att.status === 'early_leave' ? (isEn ? 'Early Departure' : 'انصراف مبكر') : att.status === 'excused' || att.status === 'excused_absence' ? (isEn ? 'Excused Absence' : 'غياب مبرر') : att.status}
                          </span>
                        </td>
                        <td>
                          <div>${att.notes || '-'}</div>
                          ${att.source === 'biometric_device' ? `<span class="badge badge-info" style="font-size:10px; margin-top:2px;">${t('att.biometricDevice')}</span>` : ''}
                        </td>
                        <td>
                          <div style="display:flex; align-items:center; gap:6px; justify-content:flex-end;">
                            ${canViewRecords ? `
                              <button type="button" class="btn btn-icon btn-sm btn-outline btn-view-att" title="${t('view')}">
                                ${Icons.eye(14)}
                              </button>
                            ` : ''}
                            ${canEditAttendance ? `
                              <button type="button" class="btn btn-icon btn-sm btn-outline btn-edit-att" title="${t('edit')}">
                                ${Icons.edit(14)}
                              </button>
                            ` : ''}
                            ${canDeleteAttendance ? `
                              <button type="button" class="btn btn-icon btn-sm btn-outline btn-delete-att" style="color:var(--danger);" title="${t('delete')}">
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

      // Event handlers for Attendance rows: View / Edit / Delete.
      // Edit routing: absence-type statuses (early_leave / excused) open the
      // Absence (delay) screen; work-type statuses open the Attendance screen.
      contentArea.querySelectorAll('.btn-view-att').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (!canViewRecords) return;
          const row = e.target.closest('tr');
          const attId = row?.getAttribute('data-att-id');
          const att = attendance.find((a) => a.id === attId);
          if (att) openRecordPreview('attendance', att, { employees, companies, settings });
        });
      });

      contentArea.querySelectorAll('.btn-edit-att').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (!canEditAttendance) return;
          const row = e.target.closest('tr');
          const attId = row?.getAttribute('data-att-id');
          const att = attendance.find((a) => a.id === attId);
          if (!att) return;
          const prefill = { employeeId: att.employeeId, date: att.date };
          if (att.status === 'early_leave' || att.status === 'excused' || att.status === 'excused_absence') {
            openAbsenceModal(prefill.employeeId, () => renderAttendanceOvertimeView(container, { subTab: 'attendance' }), { date: prefill.date });
          } else {
            openAttendanceModal(() => renderAttendanceOvertimeView(container, { subTab: 'attendance' }), prefill);
          }
        });
      });

      contentArea.querySelectorAll('.btn-delete-att').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (!canDeleteAttendance) return;
          const row = e.target.closest('tr');
          const attId = row?.getAttribute('data-att-id');
          showConfirmDialog({
            title: isEn ? 'Delete Attendance Record' : 'حذف سجل الحضور',
            message: isEn ? 'Are you sure you want to delete this attendance record?' : 'هل أنت متأكد من حذف سجل الحضور هذا؟',
            confirmText: isEn ? 'Yes, delete' : 'نعم، حذف',
            onConfirm: () => {
              storage.deleteAttendance(attId);
              toast.success(t('att.recordDeleted'));
              renderAttendanceOvertimeView(container, { subTab: 'attendance' });
            },
          });
        });
      });
    } else if (activeSubTab === 'holidays') {
      contentArea.innerHTML = `
        <div class="card" style="padding:0; overflow:hidden;">
          <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between;">
            <div>
              <div style="font-weight:700; font-size:15px; color:var(--text-main);">
                ${t('att.holidaysTitle')}
              </div>
              <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
                ${t('att.holidaysSubtitle')}
              </div>
            </div>
            ${canAddAttendance ? `
            <button type="button" class="btn btn-sm btn-primary" id="btn-add-holiday-inner">
              ${Icons.plus(14)} ${t('att.addOfficialHoliday')}
            </button>
            ` : ''}
          </div>

          <div class="table-container" style="border:none;">
            <table class="table">
              <thead>
                <tr>
                  <th>${t('att.occasionHoliday')}</th><th>${t('att.fromDate')}</th><th>${t('att.toDate')}</th><th>${t('att.daysCount')}</th><th>${t('att.occasionType')}</th><th>${t('att.applicationScope')}</th><th>${t('att.financialStatus')}</th>
                  <th style="text-align:left;">${t('att.actions')}</th>
                </tr>
              </thead>
              <tbody>
                ${
                  holidays.length === 0
                    ? `<tr><td colspan="8" style="text-align:center; padding:32px; color:var(--text-muted);">${t('att.noHolidays')}</td></tr>`
                    : holidays
                        .map((h) => {
                          const comp = companies.find((c) => c.id === h.companyId);
                          const branch = comp ? (comp.branches || []).find((b) => b.id === h.branchId) : null;
                          const scopeLabel = h.companyId === 'all'
                            ? t('att.allCompanies')
                            : comp
                              ? (i18n.getLang() === 'en' ? comp.nameEn : comp.nameAr)
                              : '-';
                          const branchLabel = branch
                            ? (i18n.getLang() === 'en' && branch.nameEn ? branch.nameEn : branch.nameAr)
                            : (h.branchId && h.companyId !== 'all' ? (isEn ? 'All branches' : 'جميع الفروع') : '');
                          const scopeHtml = `${scopeLabel}${branchLabel ? ` • ${branchLabel}` : ''}`;
                          return `
                      <tr data-hol-id="${h.id}">
                        <td>
                          <strong>${h.name}</strong>
                          <div style="font-size:11.5px; color:var(--text-muted);">${h.notes || ''}</div>
                        </td>
                        <td>${formatDate(h.startDate)}</td>
                        <td>${formatDate(h.endDate)}</td>
                        <td><span class="badge badge-primary">${tf('att.daysValue',{count:h.daysCount})}</span></td>
                        <td>
                          <span class="badge badge-gray">
                            ${
                              h.reasonCategory === 'religious_eid'
                                ? t('att.religiousEid')
                                : h.reasonCategory === 'national_holiday'
                                ? t('att.nationalHoliday')
                                : h.reasonCategory === 'company_decision'
                                ? t('att.companyDecision')
                                : t('att.emergency')
                            }
                          </span>
                        </td>
                        <td>${scopeHtml}</td><td><span class="badge badge-success">${t('att.fullyPaid')}</span></td>
                        <td>
                          <div style="display:flex; align-items:center; gap:6px; justify-content:flex-end;">
                            ${canViewRecords ? `
                              <button type="button" class="btn btn-icon btn-sm btn-outline btn-view-hol" title="${t('view')}">
                                ${Icons.eye(14)}
                              </button>
                            ` : ''}
                            ${canEditAttendance ? `
                              <button type="button" class="btn btn-icon btn-sm btn-outline btn-edit-hol" title="${t('edit')}">
                                ${Icons.edit(14)}
                              </button>
                            ` : ''}
                            ${canDeleteAttendance ? `
                              <button type="button" class="btn btn-icon btn-sm btn-outline btn-delete-hol" style="color:var(--danger);" title="${t('delete')}">
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

      // Event handlers for Holidays
      contentArea.querySelector('#btn-add-holiday-inner')?.addEventListener('click', () => {
        if (!canAddAttendance) return;
        openHolidayModal(null, () => renderAttendanceOvertimeView(container, { subTab: 'holidays' }));
      });

      contentArea.querySelectorAll('.btn-view-hol').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (!canViewRecords) return;
          const row = e.target.closest('tr');
          const holId = row?.getAttribute('data-hol-id');
          const hol = holidays.find((h) => h.id === holId);
          if (hol) openRecordPreview('holiday', hol, { employees, companies, settings });
        });
      });

      contentArea.querySelectorAll('.btn-edit-hol').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (!canEditAttendance) return;
          const row = e.target.closest('tr');
          const holId = row?.getAttribute('data-hol-id');
          const hol = holidays.find((h) => h.id === holId);
          if (hol) openHolidayModal(hol, () => renderAttendanceOvertimeView(container, { subTab: 'holidays' }));
        });
      });

      contentArea.querySelectorAll('.btn-delete-hol').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (!canDeleteAttendance) return;
          const row = e.target.closest('tr');
          const holId = row?.getAttribute('data-hol-id');
          showConfirmDialog({
            title: isEn ? 'Delete Official Holiday' : 'حذف العطلة الرسمية',
            message: isEn ? 'Are you sure you want to delete this holiday?' : 'هل أنت متأكد من حذف هذه العطلة؟',
            confirmText: isEn ? 'Yes, delete' : 'نعم، حذف',
            onConfirm: () => {
              storage.deleteHoliday(holId);
              toast.success(t('att.holidayDeleted'));
              renderAttendanceOvertimeView(container, { subTab: 'holidays' });
            },
          });
        });
      });
    }
  }

  container.innerHTML = `
    <!-- Top Header -->
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:20px;">
      <div>
        <h2 style="font-size:20px; font-weight:800; color:var(--text-main);">${t('att.title')}</h2><p style="font-size:13px; color:var(--text-muted);">${t('att.subtitle')}</p>
      </div>

      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <button type="button" class="btn btn-outline" id="btn-sync-bio-top">
          ${Icons.refresh(16)} ${t('att.syncBio')}
        </button>
        <button type="button" class="btn btn-outline" id="btn-open-holiday-modal">
          ${Icons.calendar(16)} ${t('att.addHoliday')}
        </button>
        <button type="button" class="btn btn-danger" id="btn-open-absence-modal">
          ${Icons.clock(16)} ${t('att.recordAbsenceDelay')}
        </button>
        <button type="button" class="btn btn-primary" id="btn-open-ot-modal">
          ${Icons.plus(16)} ${t('att.recordOvertime')}
        </button>
      </div>
    </div>

    <!-- KPI Summary Grid -->
    <div class="grid grid-cols-3" style="margin-bottom:20px;">
      <div class="card stat-card stat-success">
        <div>
          <div class="stat-label">${t('att.totalApprovedOvertimeCost')}</div>
          <div class="stat-value" style="font-size:16px; line-height:1.5;">${totalOvertimeCostSegmented}</div>
          <div class="stat-sub">${t('att.calculatedActualSalary')}</div>
        </div>
        <div class="stat-icon-wrapper">${Icons.dollar(24)}</div>
      </div>

      <div class="card stat-card stat-primary">
        <div>
          <div class="stat-label">${t('att.totalOvertimeHours')}</div><div class="stat-value">${tf('att.hoursValue',{count:totalOvertimeHours})}</div><div class="stat-sub">${t('att.regularDaysHolidays')}</div>
        </div>
        <div class="stat-icon-wrapper">${Icons.clock(24)}</div>
      </div>

      <div class="card stat-card stat-info">
        <div>
          <div class="stat-label">${t('att.approvedHolidays')}</div><div class="stat-value">${tf('att.holidaysValue',{count:holidays.length})}</div><div class="stat-sub">${t('att.paidTimeAllEmployees')}</div>
        </div>
        <div class="stat-icon-wrapper">${Icons.calendar(24)}</div>
      </div>
    </div>

    <!-- Sub Tabs -->
    <div class="tabs-header">
      <button type="button" class="tab-btn ${activeSubTab === 'overtime' ? 'active' : ''}" id="tab-btn-ot">
        ${Icons.dollar(16)} ${t('att.overtimeTab')} (${overtime.length})
      </button>
      <button type="button" class="tab-btn ${activeSubTab === 'attendance' ? 'active' : ''}" id="tab-btn-att">
        ${Icons.clock(16)} ${t('att.attendanceTab')} (${attendance.length})
      </button>
      <button type="button" class="tab-btn ${activeSubTab === 'holidays' ? 'active' : ''}" id="tab-btn-hol">
        ${Icons.calendar(16)} ${t('att.holidaysTab')} (${holidays.length})
      </button>
    </div>

    <!-- Tab Content -->
    <div id="attendance-ot-content-area"></div>
  `;

  // Attach Sub Tab buttons
  const tabOt = container.querySelector('#tab-btn-ot');
  const tabAtt = container.querySelector('#tab-btn-att');
  const tabHol = container.querySelector('#tab-btn-hol');

  tabOt?.addEventListener('click', () => {
    activeSubTab = 'overtime';
    tabOt.classList.add('active');
    tabAtt.classList.remove('active');
    tabHol.classList.remove('active');
    renderSubTab();
  });

  tabAtt?.addEventListener('click', () => {
    activeSubTab = 'attendance';
    tabAtt.classList.add('active');
    tabOt.classList.remove('active');
    tabHol.classList.remove('active');
    renderSubTab();
  });

  tabHol?.addEventListener('click', () => {
    activeSubTab = 'holidays';
    tabHol.classList.add('active');
    tabOt.classList.remove('active');
    tabAtt.classList.remove('active');
    renderSubTab();
  });

  // Action Buttons
  container.querySelector('#btn-open-holiday-modal')?.addEventListener('click', () => {
    openHolidayModal(null, () => renderAttendanceOvertimeView(container, { subTab: 'holidays' }));
  });

  container.querySelector('#btn-sync-bio-top')?.addEventListener('click', async () => {
    if (employees.length === 0) {
      toast.error(t('att.noEmployeesToSync'));
      return;
    }
    toast.info(t('att.importingBiometric'));
    const res = await syncBiometricLogs(settings, employees);
    if (res.success) {
      toast.success(res.message);
      renderAttendanceOvertimeView(container, { subTab: 'attendance' });
    }
  });

  container.querySelector('#btn-open-absence-modal')?.addEventListener('click', () => {
    if (!canAddAttendance) return;
    openAbsenceModal(null, () => renderAttendanceOvertimeView(container, { subTab: 'attendance' }));
  });

  container.querySelector('#btn-open-ot-modal')?.addEventListener('click', () => {
    if (!canAddOvertime) return;
    openOvertimeModal(null, () => renderAttendanceOvertimeView(container, { subTab: 'overtime' }));
  });

  renderSubTab();
}
