// ==========================================
// Dashboard View (Multi-Company & Multi-Language)
// ==========================================

import { storage } from '../storage.js';
import { Icons } from '../icons.js';
import { formatDate, resolveEmployeeCurrency, summarizeCurrencySegments, isPayrollViewEnabled } from '../types.js';
import { t, i18n } from '../i18n.js';
import { openAbsenceModal } from './AbsenceModal.js';

export function renderDashboardView(container, navigateTo) {
  const state = storage.getState();
  const { employees, leaves, overtime, companies, currentUser, settings } = state;
  const isEn = i18n.getLang() === 'en';

  const activeEmployees = employees.filter((e) => e.status === 'active' || e.status === 'probation');
  const onLeaveEmployees = employees.filter((e) => e.status === 'on_leave');
  const pendingLeaves = leaves.filter((l) => l.status === 'pending');
  const pendingOvertime = overtime.filter((o) => o.status === 'pending');

  // Total monthly payroll estimate (P2.2: per-employee currency, never merged)
  const payrollSegments = activeEmployees.map((emp) => {
    const cur = resolveEmployeeCurrency(emp, settings, companies);
    const amt = (Number(emp.basicSalary) || 0) + (Number(emp.housingAllowance) || 0) + (Number(emp.transportAllowance) || 0) + (Number(emp.otherAllowances) || 0);
    return { code: cur.code, amount: amt };
  });
  const totalMonthlyPayroll = summarizeCurrencySegments(payrollSegments);
  const payrollLocked = !isPayrollViewEnabled(settings) && currentUser && currentUser.role !== 'super_admin';

  // Department distribution
  const deptCounts = {};
  employees.forEach((emp) => {
    deptCounts[emp.department] = (deptCounts[emp.department] || 0) + 1;
  });

  // Check expiring documents
  const today = new Date();
  const sixtyDaysFromNow = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
  const expiringDocs = [];

  employees.forEach((emp) => {
    // Legacy document array (old style)
    (emp.documents || []).forEach((doc) => {
      if (doc.expiryDate) {
        const expDate = new Date(doc.expiryDate);
        if (expDate <= sixtyDaysFromNow && expDate >= today) {
          expiringDocs.push({
            employeeName: emp.fullName,
            docName: doc.name,
            docNumber: doc.documentNumber || '-',
            expiryDate: doc.expiryDate,
            daysLeft: Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
          });
        }
      }
    });

    // Document expiry fields with active alert toggles (Requirement 2)
    const docFields = [
      { key: 'idExpiryDate', alertKey: 'alertIdExpiry', name: isEn ? 'ID / Residence' : 'الهوية / الإقامة' },
      { key: 'passportExpiryDate', alertKey: 'alertPassportExpiry', name: isEn ? 'Passport' : 'جواز السفر' },
      { key: 'workPermitExpiryDate', alertKey: 'alertWorkPermitExpiry', name: isEn ? 'Work Permit / Iqama' : 'رخصة العمل / الإقامة' },
      { key: 'contractEndDate', alertKey: 'alertContractExpiry', name: isEn ? 'Employment Contract' : 'عقد العمل' },
    ];
    docFields.forEach(({ key, alertKey, name }) => {
      // Check if alert is enabled for this document
      if (emp[alertKey] === false) return;

      const dateStr = emp[key];
      if (dateStr) {
        const expDate = new Date(dateStr);
        if (expDate <= sixtyDaysFromNow && expDate >= today) {
          expiringDocs.push({
            employeeName: emp.fullName,
            docName: name,
            docNumber: emp.nationalId || emp.passportNumber || '-',
            expiryDate: dateStr,
            daysLeft: Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
          });
        }
      }
    });
  });

  // Upcoming Birthdays (Requirement 8)
  const upcomingBirthdays = [];
  const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  employees.filter(e => e.status === 'active' || e.status === 'probation').forEach((emp) => {
    if (!emp.dateOfBirth) return;
    const dob = new Date(emp.dateOfBirth);
    // Create this year's birthday
    const birthdayThisYear = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
    // If already passed this year, check next year
    const birthdayDate = birthdayThisYear >= today ? birthdayThisYear : new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate());
    if (birthdayDate <= thirtyDaysFromNow) {
      const daysLeft = Math.ceil((birthdayDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const age = today.getFullYear() - dob.getFullYear() + (birthdayDate.getFullYear() > today.getFullYear() ? 1 : 0);
      upcomingBirthdays.push({
        employee: emp,
        daysLeft,
        age,
        birthdayDate: birthdayDate.toISOString().split('T')[0],
      });
    }
  });
  upcomingBirthdays.sort((a, b) => a.daysLeft - b.daysLeft);

  container.innerHTML = `
    <!-- Top KPI Grid -->
    <div class="grid grid-cols-4" style="margin-bottom: 24px;">
      <div class="card stat-card stat-primary">
        <div>
          <div class="stat-label">${t('activeEmployeesCount')}</div>
          <div class="stat-value">${activeEmployees.length}</div>
          <div class="stat-sub">${t('fromTotal')} ${employees.length} ${t('registeredInSystem')}</div>
        </div>
        <div class="stat-icon-wrapper">
          ${Icons.users(24)}
        </div>
      </div>

      <div class="card stat-card ${payrollLocked ? 'stat-warning' : 'stat-success'}">
        <div>
          <div class="stat-label">${payrollLocked ? (isEn ? 'Payroll Display (Locked)' : 'عرض الرواتب (مقفل)') : t('monthlyPayrollCost')}</div>
          <div class="stat-value" style="font-size:22px;">${payrollLocked ? '—' : totalMonthlyPayroll}</div>
          <div class="stat-sub">${payrollLocked ? (isEn ? 'Payroll is disabled for your role — ask a Super Admin to enable it.' : 'عرض الرواتب معطّل لدورك — اطلب من المسؤول العام تفعيله.') : t('basicAndFixedAllowances')}</div>
        </div>
        <div class="stat-icon-wrapper">
          ${payrollLocked ? Icons.lock(24) : Icons.dollar(24)}
        </div>
      </div>

      <div class="card stat-card stat-info">
        <div>
          <div class="stat-label">${t('onLeaveCurrently')}</div>
          <div class="stat-value">${onLeaveEmployees.length}</div>
          <div class="stat-sub">${t('approvedLeaveRequests')}</div>
        </div>
        <div class="stat-icon-wrapper">
          ${Icons.calendar(24)}
        </div>
      </div>

      <div class="card stat-card stat-warning">
        <div>
          <div class="stat-label">${t('pendingApprovals')}</div>
          <div class="stat-value">${pendingLeaves.length + pendingOvertime.length}</div>
          <div class="stat-sub">${pendingLeaves.length} ${t('leavesPending')} • ${pendingOvertime.length} ${t('overtimePending')}</div>
        </div>
        <div class="stat-icon-wrapper">
          ${Icons.clock(24)}
        </div>
      </div>
    </div>

    <!-- Quick Actions Banner -->
    <div class="card" style="margin-bottom: 24px; background: linear-gradient(135deg, rgba(79, 70, 229, 0.05) 0%, rgba(124, 58, 237, 0.05) 100%); border-color: rgba(99, 102, 241, 0.2);">
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px;">
        <div>
          <h3 style="font-size:16px; font-weight:800; color:var(--primary); display:flex; align-items:center; gap:8px;">
            ${Icons.sparkles(20)} ${t('quickActions')}
          </h3>
          <p style="font-size:13px; color:var(--text-muted);">${t('quickActionsSub')}</p>
        </div>
        <div class="quick-action-bar">
          <button type="button" class="btn btn-primary" id="btn-quick-new-emp">
            ${Icons.userPlus(16)} ${t('addNewEmployee')}
          </button>
          <button type="button" class="btn btn-danger" id="btn-quick-absence">
            ${Icons.clock(16)} ${t('att.recordAbsenceDelay')}
          </button>
          <button type="button" class="btn btn-success" id="btn-quick-payroll">
            ${Icons.dollar(16)} ${t('monthlyPayroll')}
          </button>
          <button type="button" class="btn btn-outline" id="btn-quick-leave">
            ${Icons.calendar(16)} ${t('requestLeave')}
          </button>
          <button type="button" class="btn btn-outline" id="btn-quick-rollover">
            ${Icons.refresh(16)} ${t('rolloverYearBalance')}
          </button>
          <button type="button" class="btn btn-outline" id="btn-quick-eosb">
            ${Icons.award(16)} ${t('eosbCalculator')}
          </button>
        </div>
      </div>
    </div>

    <!-- Main Content Split -->
    <div class="grid grid-cols-3" style="margin-bottom: 24px;">
      <!-- Department Distribution (2 cols) -->
      <div class="card" style="grid-column: span 2;">
        <div class="card-header">
          <div class="card-title">${Icons.briefcase(20)} ${t('deptDistribution')}</div>
          <button class="btn btn-sm btn-outline" id="btn-view-all-employees">${t('viewAll')}</button>
        </div>
        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:14px;">
          ${Object.entries(deptCounts)
            .map(
              ([dept, count]) => `
              <div style="background:var(--bg-card-hover); padding:14px 16px; border-radius:var(--radius-md); border:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between;">
                <div>
                  <div style="font-weight:700; font-size:14px; color:var(--text-main);">${dept}</div>
                  <div style="font-size:12px; color:var(--text-muted);">${count} ${t('employees')}</div>
                </div>
                <span class="badge badge-primary">${Math.round((count / (employees.length || 1)) * 100)}%</span>
              </div>
            `
            )
            .join('')}
        </div>
      </div>

      <!-- Smart Document Alerts (1 col) -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span style="color:var(--warning);">${Icons.alertCircle(20)}</span> ${t('documentAlerts')}
          </div>
          <span class="badge badge-warning">${expiringDocs.length} ${t('expiringSoonDocs')}</span>
        </div>

        ${
          expiringDocs.length === 0
            ? `<div style="text-align:center; padding:24px; color:var(--text-muted); font-size:13px;">${t('noExpiringDocs')}</div>`
            : `
          <div style="display:flex; flex-direction:column; gap:10px;">
            ${expiringDocs
              .map(
                (d) => `
              <div style="padding:10px 12px; background:var(--warning-light); border:1px solid rgba(245, 158, 11, 0.2); border-radius:var(--radius-md);">
                <div style="display:flex; align-items:center; justify-content:space-between;">
                  <strong style="font-size:13px; color:#92400e;">${d.employeeName}</strong>
                  <span class="badge badge-warning" style="font-size:11px;">${t('daysRemaining')} ${d.daysLeft} ${t('days')}</span>
                </div>
                <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${d.docName} (${t('expiresOn')}: ${d.expiryDate})</div>
              </div>
            `
              )
              .join('')}
          </div>
        `
        }
      </div>
    </div>

    <!-- Recent Pending Requests Table -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">${Icons.clock(20)} ${t('recentLeaveRequests')}</div>
        <button class="btn btn-sm btn-outline" id="btn-view-all-leaves">${t('manageLeaves')}</button>
      </div>

      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              <th>${t('employeeCol')}</th>
              <th>${t('leaveType')}</th>
              <th>${t('period')}</th>
              <th>${t('duration')}</th>
              <th>${t('reason')}</th>
              <th>${t('statusCol')}</th>
            </tr>
          </thead>
          <tbody>
            ${
              leaves.length === 0
                ? `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">${t('noLeavesRecorded')}</td></tr>`
                : leaves
                    .slice(0, 5)
                    .map((l) => {
                      const emp = employees.find((e) => e.id === l.employeeId);
                      return `
                  <tr>
                    <td><strong>${emp ? emp.fullName : (isEn ? 'Employee' : 'موظف')}</strong></td>
                    <td>${l.leaveType === 'annual' ? (isEn ? 'Annual leave' : 'إجازة سنوية') : l.leaveType}</td>
                    <td>${formatDate(l.startDate)} - ${formatDate(l.endDate)}</td>
                    <td><strong>${l.daysCount} ${t('days')}</strong></td>
                    <td style="max-width:200px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${l.reason || '-'}</td>
                    <td>
                      <span class="badge ${l.status === 'approved' ? 'badge-success' : l.status === 'rejected' ? 'badge-danger' : l.status === 'cancelled' ? 'badge-gray' : 'badge-warning'}">
                        ${l.status === 'approved' ? t('statusApproved') : l.status === 'rejected' ? t('statusRejected') : l.status === 'cancelled' ? t('statusCancelled') : t('statusPending')}
                      </span>
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

    <!-- Birthday Alerts Widget (Requirement 8) -->
    ${upcomingBirthdays.length > 0 ? `
    <div class="card" style="padding:20px; border:1px solid rgba(251, 191, 36, 0.4); background:linear-gradient(135deg, rgba(251, 191, 36, 0.04) 0%, rgba(239, 68, 68, 0.03) 100%);">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
        <div style="font-size:16px; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:10px;">
          🎂 ${isEn ? 'Upcoming Birthdays (30 days)' : 'أعياد الميلاد القادمة (30 يوم)'}
          <span class="badge badge-warning">${upcomingBirthdays.length} ${isEn ? 'employee(s)' : 'موظف'}</span>
        </div>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:12px;">
        ${upcomingBirthdays.map(b => `
          <div style="background:var(--bg-card-hover); border-radius:var(--radius-lg); padding:14px 16px; min-width:200px; border:1px solid rgba(251,191,36,0.2); display:flex; align-items:center; gap:12px;">
            <div class="user-avatar" style="width:40px; height:40px; font-size:16px; background:linear-gradient(135deg, #f59e0b, #ef4444);">
              ${b.employee.fullName.charAt(0)}
            </div>
            <div>
              <div style="font-weight:700; color:var(--text-main); font-size:13.5px;">${b.employee.fullName}</div>
              <div style="font-size:12px; color:var(--text-muted);">${b.employee.department}</div>
              <div style="font-size:12px; margin-top:3px;">
                ${b.daysLeft === 0
                  ? `<span class="badge badge-warning">🎉 ${isEn ? 'Birthday today!' : 'عيد ميلاد اليوم!'} (${b.age} ${isEn ? 'yrs' : 'سنة'})</span>`
                  : `<span style="color:#d97706; font-weight:700;">${isEn ? 'In' : 'بعد'} ${b.daysLeft} ${isEn ? 'day(s)' : 'يوم'} • ${b.age} ${isEn ? 'yrs' : 'سنة'}</span>`}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <!-- Document Expiry Alerts Widget (Requirement 7) -->
    ${expiringDocs.length > 0 ? `
    <div class="card" style="padding:20px; border:1px solid rgba(239, 68, 68, 0.35); background:linear-gradient(135deg, rgba(239, 68, 68, 0.04) 0%, rgba(251, 191, 36, 0.03) 100%);">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
        <div style="font-size:16px; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:10px;">
          ⚠️ ${isEn ? 'Documents Expiring Within 60 Days' : 'وثائق تنتهي خلال 60 يوماً'}
          <span class="badge badge-danger">${expiringDocs.length} ${isEn ? 'document(s)' : 'وثيقة'}</span>
        </div>
      </div>
      <div class="table-container" style="border:none;">
        <table class="table" style="font-size:12.5px;">
          <thead>
            <tr>
              <th>${t('att.employee')}</th>
              <th>${isEn ? 'Document Type' : 'نوع الوثيقة'}</th>
              <th>${isEn ? 'Document Number' : 'رقم الوثيقة'}</th>
              <th>${isEn ? 'Expiry Date' : 'تاريخ الانتهاء'}</th>
              <th>${isEn ? 'Remaining' : 'المتبقي'}</th>
            </tr>
          </thead>
          <tbody>
            ${expiringDocs.map(d => `
              <tr>
                <td><strong>${d.employeeName}</strong></td>
                <td>${d.docName}</td>
                <td>${d.docNumber}</td>
                <td><strong style="color:var(--danger);">${d.expiryDate}</strong></td>
                <td>
                  <span class="badge ${d.daysLeft <= 14 ? 'badge-danger' : d.daysLeft <= 30 ? 'badge-warning' : 'badge-info'}">
                    ${d.daysLeft} ${isEn ? 'days' : 'يوم'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}
  `;

  // Attach event handlers
  container.querySelector('#btn-quick-new-emp')?.addEventListener('click', () => {
    navigateTo('employees', { openNewModal: true });
  });

  container.querySelector('#btn-quick-absence')?.addEventListener('click', () => {
    openAbsenceModal(null, () => renderDashboardView(container, navigateTo));
  });

  container.querySelector('#btn-quick-payroll')?.addEventListener('click', () => {
    navigateTo('payroll');
  });

  container.querySelector('#btn-quick-leave')?.addEventListener('click', () => {
    navigateTo('leaves', { openLeaveModal: true });
  });

  container.querySelector('#btn-quick-rollover')?.addEventListener('click', () => {
    navigateTo('leaves', { openRolloverModal: true });
  });

  container.querySelector('#btn-quick-eosb')?.addEventListener('click', () => {
    navigateTo('eosb', { openEOSBModal: true });
  });

  container.querySelector('#btn-view-all-employees')?.addEventListener('click', () => {
    navigateTo('employees');
  });

  container.querySelector('#btn-view-all-leaves')?.addEventListener('click', () => {
    navigateTo('leaves');
  });
}
