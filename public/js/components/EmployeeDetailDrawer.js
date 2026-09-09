// ==========================================
// Employee 360° Profile Drawer Component (Bilingual & Full Details)
// ==========================================

import { storage } from '../storage.js';
import { Icons } from '../icons.js';
import { formatCurrency, formatDate, STATUS_LABELS, CONTRACT_TYPE_LABELS, resolveEmployeeCurrency } from '../types.js';
import { calculateLeaveBalance } from '../engines/leaveEngine.js';
import { calculateHourlyBalance, getEmployeeHourlyQuota } from '../engines/hourlyLeaveEngine.js';
import { openEmployeeModal } from './EmployeeModal.js';
import { openSalaryIncrementModal } from './SalaryIncrementModal.js';
import { openLoanModal } from './LoanModal.js';
import { openLeaveRequestModal } from './LeaveRequestModal.js';
import { openAbsenceModal } from './AbsenceModal.js';
import { i18n, t } from '../i18n.js';

export function openEmployeeDetailDrawer(employeeOrId, onUpdate) {
  const state = storage.getState();
  const employee = typeof employeeOrId === 'object' && employeeOrId !== null
    ? employeeOrId
    : (state.rawEmployees || state.employees).find((e) => e.id === employeeOrId);

  if (!employee) {
    console.error('Employee not found for drawer:', employeeOrId);
    return;
  }

  const { leaves, hourlyLeaves, loans, increments, companies, settings } = state;
  const isEn = i18n.getLang() === 'en';
  const sym = (resolveEmployeeCurrency(employee, settings, companies).symbol) || '$';

  const comp = companies.find((c) => c.id === employee.companyId);
  const branch = comp ? (comp.branches || []).find((b) => b.id === employee.branchId) : null;

  const leaveSummary = calculateLeaveBalance(employee, leaves, new Date(), settings);
  const hourlyQuota = getEmployeeHourlyQuota(employee, comp, settings);
  const hourlyBal = calculateHourlyBalance(employee.id, hourlyLeaves, new Date().toISOString().slice(0, 7), hourlyQuota);

  const empLoans = (loans || []).filter((l) => l.employeeId === employee.id);
  const empIncrements = (increments || []).filter((i) => i.employeeId === employee.id);

  const totalGrossSalary =
    (Number(employee.basicSalary) || 0) +
    (Number(employee.housingAllowance) || 0) +
    (Number(employee.transportAllowance) || 0) +
    (Number(employee.otherAllowances) || 0);

  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';

  const drawer = document.createElement('div');
  drawer.className = 'drawer-content';

  const empName = isEn && employee.fullNameEn ? employee.fullNameEn : employee.fullName;
  const compName = comp ? (isEn && comp.nameEn ? comp.nameEn : comp.nameAr) : '';

  drawer.innerHTML = `
    <!-- Drawer Header -->
    <div style="padding:20px 24px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between;">
      <div style="display:flex; align-items:center; gap:14px;">
        <div class="user-avatar" style="width:52px; height:52px; font-size:20px; font-weight:800;">
          ${empName.charAt(0)}
        </div>
        <div>
          <h2 style="font-size:18px; font-weight:800; color:var(--text-main);">${empName}</h2>
          <div style="display:flex; align-items:center; gap:8px; margin-top:3px; flex-wrap:wrap;">
            <span style="font-size:12.5px; color:var(--text-muted);">${employee.jobTitle} • ${employee.department}</span>
            <span class="badge ${STATUS_LABELS[employee.status]?.class || 'badge-success'}">${STATUS_LABELS[employee.status]?.text || employee.status}</span>
            ${compName ? `<span class="badge badge-gray" style="font-size:11px;">${compName}</span>` : ''}
          </div>
        </div>
      </div>
      <button type="button" class="btn btn-icon btn-outline close-drawer-btn">${Icons.x(18)}</button>
    </div>

    <!-- Drawer Body -->
    <div style="padding:24px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:20px;">
      
      <!-- Quick Action Toolbar inside Drawer -->
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" class="btn btn-sm btn-primary drawer-btn-edit">
          ${Icons.edit(14)} ${isEn ? 'Edit Profile' : 'تعديل الملف'}
        </button>
        <button type="button" class="btn btn-sm btn-outline drawer-btn-absence" style="color:var(--danger); border-color:rgba(239,68,68,0.3);">
          ${Icons.clock(14)} ${isEn ? 'Record Absence' : 'تسجيل غياب / تأخير'}
        </button>
        <button type="button" class="btn btn-sm btn-outline drawer-btn-increment" style="color:var(--success); border-color:rgba(16,185,129,0.3);">
          ${Icons.trendingUp(14)} ${isEn ? 'Salary Increment' : 'زيادة راتب'}
        </button>
        <button type="button" class="btn btn-sm btn-outline drawer-btn-leave">
          ${Icons.calendar(14)} ${isEn ? 'Request Leave' : 'طلب إجازة'}
        </button>
        <button type="button" class="btn btn-sm btn-outline drawer-btn-loan">
          ${Icons.dollar(14)} ${isEn ? 'Grant Loan' : 'منح سلفة'}
        </button>
      </div>

      <!-- Financial & Salary Structure Card -->
      <div class="card" style="padding:16px;">
        <div style="font-weight:700; font-size:14px; color:var(--text-main); margin-bottom:12px; display:flex; align-items:center; justify-content:space-between;">
          <span>${Icons.dollar(16)} ${isEn ? 'Monthly Salary Structure' : 'هيكل الراتب الشهري'}</span>
          <span style="font-size:16px; font-weight:900; color:var(--primary);">${formatCurrency(totalGrossSalary, sym)}</span>
        </div>
        <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px; font-size:13px;">
          <div style="background:var(--bg-card-hover); padding:10px; border-radius:var(--radius-md);">
            <div style="color:var(--text-muted);">${t('basicSalary')}</div>
            <div style="font-weight:700; color:var(--text-main); font-size:14px;">${formatCurrency(employee.basicSalary, sym)}</div>
          </div>
          <div style="background:var(--bg-card-hover); padding:10px; border-radius:var(--radius-md);">
            <div style="color:var(--text-muted);">${t('housingAllowance')}</div>
            <div style="font-weight:700; color:var(--text-main); font-size:14px;">${formatCurrency(employee.housingAllowance || 0, sym)}</div>
          </div>
          <div style="background:var(--bg-card-hover); padding:10px; border-radius:var(--radius-md);">
            <div style="color:var(--text-muted);">${t('transportAllowance')}</div>
            <div style="font-weight:700; color:var(--text-main); font-size:14px;">${formatCurrency(employee.transportAllowance || 0, sym)}</div>
          </div>
          <div style="background:var(--bg-card-hover); padding:10px; border-radius:var(--radius-md);">
            <div style="color:var(--text-muted);">${t('otherAllowances')}</div>
            <div style="font-weight:700; color:var(--text-main); font-size:14px;">${formatCurrency(employee.otherAllowances || 0, sym)}</div>
          </div>
        </div>
      </div>

      <!-- Social Security & Insurance Card -->
      <div class="card" style="padding:16px;">
        <div style="font-weight:700; font-size:14px; color:var(--text-main); margin-bottom:12px; display:flex; align-items:center; justify-content:space-between;">
          <span>${Icons.shieldCheck(16)} ${isEn ? 'Social Security & Insurance' : 'التأمينات الاجتماعية'}</span>
          <span class="badge ${employee.isSubjectToGosi ? 'badge-success' : 'badge-gray'}">
            ${employee.isSubjectToGosi ? (isEn ? 'Covered' : 'خاضع للتأمينات') : (isEn ? 'Exempt' : 'غير خاضع')}
          </span>
        </div>
        ${
          employee.isSubjectToGosi
            ? `
          <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; font-size:12.5px; text-align:center;">
            <div style="background:var(--bg-card-hover); padding:8px; border-radius:var(--radius-md);">
              <div style="color:var(--text-muted);">${isEn ? 'Registered Wage' : 'الأجر المسجل'}</div>
              <strong style="color:var(--text-main);">${formatCurrency(employee.gosiRegisteredWage, sym)}</strong>
            </div>
            <div style="background:var(--bg-card-hover); padding:8px; border-radius:var(--radius-md);">
              <div style="color:var(--text-muted);">${isEn ? 'Emp Deduction' : 'استقطاع الموظف'} (${employee.gosiEmployeePercent || 0}%)</div>
              <strong style="color:var(--danger);">${formatCurrency((employee.gosiRegisteredWage || 0) * ((employee.gosiEmployeePercent || 0) / 100), sym)}</strong>
            </div>
            <div style="background:var(--bg-card-hover); padding:8px; border-radius:var(--radius-md);">
              <div style="color:var(--text-muted);">${isEn ? 'Company Share' : 'مساهمة الشركة'} (${employee.gosiCompanyPercent || 0}%)</div>
              <strong style="color:var(--primary);">${formatCurrency((employee.gosiRegisteredWage || 0) * ((employee.gosiCompanyPercent || 0) / 100), sym)}</strong>
            </div>
          </div>
        `
            : `<div style="color:var(--text-muted); font-size:12.5px;">${isEn ? 'Employee is not registered in social security.' : 'الموظف غير مشمول باشتراك التأمينات الاجتماعية.'}</div>`
        }
      </div>

      <!-- Real-time Leave & Hourly Balance Card -->
      <div class="card" style="padding:16px;">
        <div style="font-weight:700; font-size:14px; color:var(--text-main); margin-bottom:12px; display:flex; align-items:center; justify-content:space-between;">
          <span>${Icons.calendar(16)} ${isEn ? 'Leave & Hourly Quota Balances' : 'أرصدة الإجازات والساعات'}</span>
          <span class="badge badge-success" style="font-size:12.5px;">
            ${isEn ? 'Remaining Annual' : 'المتبقي السنوي'}: ${leaveSummary.remainingAnnualBalance} ${isEn ? 'days' : 'يوم'}
          </span>
        </div>
        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; font-size:12.5px; text-align:center; margin-bottom:12px;">
          <div style="background:var(--bg-card-hover); padding:8px; border-radius:var(--radius-md);">
            <div style="color:var(--text-muted);">${t('annualEntitlement')}</div>
            <strong style="color:var(--text-main);">${leaveSummary.annualEntitlement} ${isEn ? 'days' : 'يوم'}</strong>
          </div>
          <div style="background:var(--bg-card-hover); padding:8px; border-radius:var(--radius-md);">
            <div style="color:var(--text-muted);">${t('carriedOver')}</div>
            <strong style="color:var(--text-main);">${leaveSummary.carriedOver} ${isEn ? 'days' : 'يوم'}</strong>
          </div>
          <div style="background:var(--bg-card-hover); padding:8px; border-radius:var(--radius-md);">
            <div style="color:var(--text-muted);">${t('usedDays')}</div>
            <strong style="color:var(--danger);">${leaveSummary.usedAnnualDays} ${isEn ? 'days' : 'يوم'}</strong>
          </div>
        </div>
      </div>

      <!-- Document Dates & ID Expiry Card -->
      <div class="card" style="padding:16px; font-size:13px;">
        <div style="font-weight:700; margin-bottom:10px; color:var(--text-main); display:flex; align-items:center; gap:8px;">
          ${Icons.fileText(16)} ${isEn ? 'Official Documents & Expiration Dates' : 'الوثائق الرسمية وتواريخ الانتهاء'}
        </div>
        <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px;">
          <div style="background:var(--bg-card-hover); padding:10px; border-radius:var(--radius-md);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:var(--text-muted); font-size:11.5px;">${isEn ? 'National ID / Residence' : 'رقم الهوية / الإقامة'}</span>
              <span class="badge ${employee.alertIdExpiry !== false ? 'badge-success' : 'badge-gray'}" style="font-size:10px;">
                ${employee.alertIdExpiry !== false ? (isEn ? 'Alert ON' : 'التنبيه مفعل') : (isEn ? 'Alert OFF' : 'التنبيه معطل')}
              </span>
            </div>
            <strong style="color:var(--text-main); font-size:13px; display:block; margin-top:2px;">${employee.nationalId || '-'}</strong>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">
              ${isEn ? 'Expires' : 'تنتهي'}: <strong style="color:#d97706;">${formatDate(employee.idExpiryDate || employee.iqamaExpiryDate || '-')}</strong>
            </div>
          </div>
          <div style="background:var(--bg-card-hover); padding:10px; border-radius:var(--radius-md);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:var(--text-muted); font-size:11.5px;">${isEn ? 'Passport' : 'جواز السفر'}</span>
              <span class="badge ${employee.alertPassportExpiry !== false ? 'badge-success' : 'badge-gray'}" style="font-size:10px;">
                ${employee.alertPassportExpiry !== false ? (isEn ? 'Alert ON' : 'التنبيه مفعل') : (isEn ? 'Alert OFF' : 'التنبيه معطل')}
              </span>
            </div>
            <strong style="color:var(--text-main); font-size:13px; display:block; margin-top:2px;">${employee.passportNumber || '-'}</strong>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">
              ${isEn ? 'Expires' : 'ينتهي'}: <strong style="color:#d97706;">${formatDate(employee.passportExpiryDate || '-')}</strong>
            </div>
          </div>
        </div>
      </div>

      <!-- Contract & Personal Details -->
      <div class="card" style="padding:16px; font-size:13px;">
        <div style="font-weight:700; margin-bottom:10px; color:var(--text-main);">${Icons.briefcase(16)} ${isEn ? 'Job & Personal Details' : 'بيانات العمل والتعاقد والشخصية'}</div>
        <div style="display:flex; flex-direction:column; gap:8px; color:var(--text-muted);">
          <div>${isEn ? 'Employee ID' : 'الرقم الوظيفي'}: <strong style="color:var(--text-main);">${employee.employeeNumber}</strong></div>
          <div>${isEn ? 'Nationality' : 'الجنسية'}: <strong style="color:var(--text-main);">${employee.nationality || '—'}</strong></div>
          <div>${isEn ? 'Date of Birth' : 'تاريخ الميلاد'}: <strong style="color:var(--text-main);">${formatDate(employee.dateOfBirth)}</strong></div>
          <div>${isEn ? 'Hire Date' : 'تاريخ المباشرة'}: <strong style="color:var(--text-main);">${formatDate(employee.hireDate)}</strong></div>
          <div>${isEn ? 'Contract Type' : 'نوع العقد'}: <strong style="color:var(--text-main);">${CONTRACT_TYPE_LABELS[employee.contractType]?.ar || employee.contractType}</strong></div>
          <div>${isEn ? 'Bank Name' : 'اسم البنك'}: <strong style="color:var(--text-main);">${employee.bankName || '-'}</strong></div>
          <div>${isEn ? 'IBAN' : 'الآيبان'}: <strong style="color:var(--text-main);">${employee.iban || employee.bankAccountNumber || '-'}</strong></div>
          <div>${isEn ? 'Email' : 'البريد الإلكتروني'}: <strong style="color:var(--text-main);">${employee.email || '-'}</strong></div>
          <div>${isEn ? 'Phone' : 'رقم الجوال'}: <strong style="color:var(--text-main);">${employee.phone || '-'}</strong></div>
        </div>
      </div>

      <!-- Active Loans & Advances -->
      <div class="card" style="padding:16px;">
        <div style="font-weight:700; font-size:14px; margin-bottom:10px; color:var(--text-main);">${Icons.dollar(16)} ${isEn ? 'Active Advances & Loans' : 'السلف والقروض النشطة'}</div>
        ${
          empLoans.length === 0
            ? `<div style="color:var(--text-muted); font-size:12.5px;">${isEn ? 'No active loans for this employee' : 'لا توجد سلف نشطة على الموظف'}</div>`
            : `
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${empLoans
              .map(
                (loan) => `
              <div style="background:var(--bg-card-hover); padding:10px; border-radius:var(--radius-md); font-size:12.5px;">
                <div style="display:flex; justify-content:space-between; font-weight:700;">
                  <span>${isEn ? 'Total Loan' : 'إجمالي السلفة'}: ${formatCurrency(loan.totalAmount, sym)}</span>
                  <span style="color:var(--danger);">${isEn ? 'Remaining' : 'المتبقي'}: ${formatCurrency(loan.remainingAmount, sym)}</span>
                </div>
                <div style="color:var(--text-muted); font-size:11.5px; margin-top:3px;">
                  ${isEn ? 'Monthly Installment' : 'القسط الشهري'}: ${formatCurrency(loan.installmentAmount, sym)} • ${loan.reason || '-'}
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        `
        }
      </div>

    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  const close = () => {
    overlay.remove();
    drawer.remove();
  };

  drawer.querySelector('.close-drawer-btn')?.addEventListener('click', close);

  // Bind Actions
  drawer.querySelector('.drawer-btn-edit')?.addEventListener('click', () => {
    close();
    openEmployeeModal(employee, onUpdate);
  });

  drawer.querySelector('.drawer-btn-absence')?.addEventListener('click', () => {
    close();
    openAbsenceModal(employee.id, onUpdate);
  });

  drawer.querySelector('.drawer-btn-increment')?.addEventListener('click', () => {
    close();
    openSalaryIncrementModal(employee, onUpdate);
  });

  drawer.querySelector('.drawer-btn-leave')?.addEventListener('click', () => {
    close();
    openLeaveRequestModal(employee.id, onUpdate);
  });

  drawer.querySelector('.drawer-btn-loan')?.addEventListener('click', () => {
    close();
    openLoanModal(employee.id, onUpdate);
  });
}
