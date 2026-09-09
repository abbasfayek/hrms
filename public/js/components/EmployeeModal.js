// ==========================================
// Employee Add / Edit Modal (Multi-Company & GOSI/Social Security Support)
// ==========================================

import { storage } from '../storage.js';
import { toast } from './Toast.js';
import { createModal } from './Modal.js';
import { DEPARTMENTS_LIST, formatCurrency, getAllCurrencies, resolveEmployeeCurrency, escapeHtml } from '../types.js';
import { i18n, t, tf } from '../i18n.js';

export function openEmployeeModal(employee = null, onSaved) {
  const isEdit = !!employee;
  const state = storage.getState();
  const { companies, settings } = state;
  const isEn = i18n.getLang() === 'en';
  const allCurrencies = getAllCurrencies(settings);

  const defaultEmp = {
    id: `emp-${Date.now()}`,
    companyId: (companies[0] || {}).id || '',
    branchId: (companies[0] && companies[0].branches && companies[0].branches.length > 0) ? companies[0].branches[0].id : '',
    employeeNumber: `EMP-${1000 + (state.rawEmployees ? state.rawEmployees.length : 0) + 1}`,
    fullName: '',
    email: '',
    phone: '',
    nationalId: '',
    gender: 'male',
    maritalStatus: 'single',
    dateOfBirth: '1995-01-01',
    nationality: '',
    address: '',
    department: 'تقنية المعلومات',
    jobTitle: '',
    hireDate: new Date().toISOString().split('T')[0],
    status: 'active',
    contractType: 'full_time',
    basicSalary: 6000,
    housingAllowance: 1500,
    transportAllowance: 600,
    otherAllowances: 0,
    bankName: '',
    bankAccountNumber: '',
    iban: '',
    // Social Security / Insurance fields
    isSubjectToGosi: true,
    gosiRegisteredWage: 0,
    gosiEmployeePercent: settings.socialInsuranceEmployeePercent !== undefined ? settings.socialInsuranceEmployeePercent : (settings.gosiEmployeePercent || 0),
    gosiCompanyPercent: settings.socialInsuranceCompanyPercent !== undefined ? settings.socialInsuranceCompanyPercent : (settings.gosiCompanyPercent || 0),
    // Leaves fields
    annualLeaveEntitlement: settings.defaultAnnualLeaveDays || 30,
    carriedOverLeaveBalance: 0,
    currentYearAccruedLeave: 0,
    manualLeaveAdjustment: 0,
    documents: [],
    notes: '',
  };

  const data = isEdit ? { ...employee } : defaultEmp;
  const empCurr = resolveEmployeeCurrency(data, settings, companies);
  const empCurSym = empCurr.symbol;

  // Safe (escaped) versions of user-controlled fields for template interpolation
  const safe = {
    fullName: escapeHtml(data.fullName || ''),
    employeeNumber: escapeHtml(data.employeeNumber || ''),
    email: escapeHtml(data.email || ''),
    phone: escapeHtml(data.phone || ''),
    nationalId: escapeHtml(data.nationalId || ''),
    idIssueDate: escapeHtml(data.idIssueDate || ''),
    idExpiryDate: escapeHtml(data.idExpiryDate || data.iqamaExpiryDate || ''),
    passportNumber: escapeHtml(data.passportNumber || ''),
    passportIssueDate: escapeHtml(data.passportIssueDate || ''),
    passportExpiryDate: escapeHtml(data.passportExpiryDate || ''),
    nationality: escapeHtml(data.nationality || ''),
    dateOfBirth: escapeHtml(data.dateOfBirth || ''),
    address: escapeHtml(data.address || ''),
    department: escapeHtml(data.department || ''),
    jobTitle: escapeHtml(data.jobTitle || ''),
    hireDate: escapeHtml(data.hireDate || ''),
    bankName: escapeHtml(data.bankName || ''),
    iban: escapeHtml(data.iban || ''),
    gosiRegisteredWage: escapeHtml(String(data.gosiRegisteredWage || 0)),
    gosiEmployeePercent: escapeHtml(String(data.gosiEmployeePercent || 0)),
    gosiCompanyPercent: escapeHtml(String(data.gosiCompanyPercent || 0)),
    annualLeaveEntitlement: escapeHtml(String(data.annualLeaveEntitlement || 30)),
    carriedOverLeaveBalance: escapeHtml(String(data.carriedOverLeaveBalance || 0)),
    manualLeaveAdjustment: escapeHtml(String(data.manualLeaveAdjustment || 0)),
    workPermitIssueDate: escapeHtml(data.workPermitIssueDate || ''),
    workPermitExpiryDate: escapeHtml(data.workPermitExpiryDate || ''),
    contractEndDate: escapeHtml(data.contractEndDate || ''),
    basicSalary: escapeHtml(String(data.basicSalary || 0)),
    housingAllowance: escapeHtml(String(data.housingAllowance || 0)),
    transportAllowance: escapeHtml(String(data.transportAllowance || 0)),
    otherAllowances: escapeHtml(String(data.otherAllowances || 0)),
    gender: data.gender || 'male',
    status: data.status || 'active',
    contractType: data.contractType || 'full_time',
    currency: data.currency || empCurr.code,
  };
  if (data.isSubjectToGosi === undefined) data.isSubjectToGosi = true;
  if (data.gosiRegisteredWage === undefined) {
    data.gosiRegisteredWage = (Number(data.basicSalary) || 0) + (Number(data.housingAllowance) || 0);
  }
  if (data.gosiEmployeePercent === undefined) data.gosiEmployeePercent = settings.socialInsuranceEmployeePercent !== undefined ? settings.socialInsuranceEmployeePercent : (settings.gosiEmployeePercent || 0);
  if (data.gosiCompanyPercent === undefined) data.gosiCompanyPercent = settings.socialInsuranceCompanyPercent !== undefined ? settings.socialInsuranceCompanyPercent : (settings.gosiCompanyPercent || 0);

  const bodyHtml = `
    <form id="employee-form">
      <div style="display:flex; gap:16px; margin-bottom:20px; border-bottom:1px solid var(--border-color); padding-bottom:12px; overflow-x:auto;">
        <button type="button" class="tab-btn active" data-tab="tab-personal">${t('personalInfoTab')}</button>
        <button type="button" class="tab-btn" data-tab="tab-job">${t('jobContractTab')}</button>
        <button type="button" class="tab-btn" data-tab="tab-salary">${t('salaryBankTab')}</button>
        <button type="button" class="tab-btn" data-tab="tab-gosi">${t('socialSecurity')}</button>
        <button type="button" class="tab-btn" data-tab="tab-leaves">${t('leaveBalanceTab')}</button>
      </div>

      <!-- Personal Tab -->
      <div class="tab-content" id="tab-personal">
        <div class="grid grid-cols-2">
          <div class="form-group">
          <label class="form-label">${t('employeeModal.fullName')} *</label>
          <input type="text" class="form-input" name="fullName" value="${safe.fullName}" required placeholder="${t('employeeModal.fullNamePlaceholder')}">
          </div>
          <div class="form-group">
          <label class="form-label">${t('employeeModal.employeeNumber')} *</label>
            <input type="text" class="form-input" name="employeeNumber" value="${safe.employeeNumber}" required>
          </div>
          <div class="form-group">
          <label class="form-label">${t('employeeModal.email')}</label>
            <input type="email" class="form-input" name="email" value="${safe.email}" placeholder="name@company.com">
          </div>
          <div class="form-group">
          <label class="form-label">${t('employeeModal.mobileNumber')} *</label>
            <input type="tel" class="form-input" name="phone" value="${safe.phone}" required placeholder="+966500000000">
          </div>
          <div class="form-group">
          <label class="form-label">${t('employeeModal.nationalIdResidence')} *</label>
            <input type="text" class="form-input" name="nationalId" value="${safe.nationalId}" required placeholder="National ID / Passport No.">
          </div>
          <div class="form-group">
          <label class="form-label">${t('employeeModal.idResidenceIssueDate')}</label>
            <input type="date" class="form-input" name="idIssueDate" value="${safe.idIssueDate || ''}">
          </div>
          <div class="form-group">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <label class="form-label">${t('employeeModal.idResidenceExpiryDate')} ⚠️</label>
              <label style="font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer; color:var(--primary); font-weight:600;">
                <input type="checkbox" name="alertIdExpiry" ${data.alertIdExpiry !== false ? 'checked' : ''}>
                <span>${isEn ? 'Enable alert' : 'تفعيل التنبيه'}</span>
              </label>
            </div>
            <input type="date" class="form-input" name="idExpiryDate" value="${safe.idExpiryDate || ''}" title="${t('employeeModal.expiryAlertTooltip')}">
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.passportNumber')}</label>
            <input type="text" class="form-input" name="passportNumber" value="${safe.passportNumber}" placeholder="Axxxxxxxx">
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.passportIssueDate')}</label>
            <input type="date" class="form-input" name="passportIssueDate" value="${safe.passportIssueDate || ''}">
          </div>
          <div class="form-group">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <label class="form-label">${t('employeeModal.passportExpiryDate')} ⚠️</label>
              <label style="font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer; color:var(--primary); font-weight:600;">
                <input type="checkbox" name="alertPassportExpiry" ${data.alertPassportExpiry !== false ? 'checked' : ''}>
                <span>${isEn ? 'Enable alert' : 'تفعيل التنبيه'}</span>
              </label>
            </div>
            <input type="date" class="form-input" name="passportExpiryDate" value="${safe.passportExpiryDate || ''}" title="${t('employeeModal.expiryAlertTooltip')}">
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.nationality')}</label>
            <input type="text" class="form-input" name="nationality" value="${safe.nationality}">
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.birthDate')} 🎂</label>
            <input type="date" class="form-input" name="dateOfBirth" value="${safe.dateOfBirth || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.gender')}</label>
            <select class="form-select" name="gender">
              <option value="male" ${safe.gender === 'male' ? 'selected' : ''}>${t('employeeModal.male')}</option>
              <option value="female" ${data.gender === 'female' ? 'selected' : ''}>${t('employeeModal.female')}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.workPermitIssueDate')}</label>
            <input type="date" class="form-input" name="workPermitIssueDate" value="${safe.workPermitIssueDate || ''}">
          </div>
          <div class="form-group">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <label class="form-label">${t('employeeModal.workPermitExpiryDate')} ⚠️</label>
              <label style="font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer; color:var(--primary); font-weight:600;">
                <input type="checkbox" name="alertWorkPermitExpiry" ${data.alertWorkPermitExpiry !== false ? 'checked' : ''}>
                <span>${isEn ? 'Enable alert' : 'تفعيل التنبيه'}</span>
              </label>
            </div>
            <input type="date" class="form-input" name="workPermitExpiryDate" value="${safe.workPermitExpiryDate || ''}" title="${t('employeeModal.workPermitAlert')}">
          </div>
          <div class="form-group">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <label class="form-label">${t('employeeModal.contractExpiryDate')} ⚠️</label>
              <label style="font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer; color:var(--primary); font-weight:600;">
                <input type="checkbox" name="alertContractExpiry" ${data.alertContractExpiry !== false ? 'checked' : ''}>
                <span>${isEn ? 'Enable alert' : 'تفعيل التنبيه'}</span>
              </label>
            </div>
            <input type="date" class="form-input" name="contractEndDate" value="${safe.contractEndDate || ''}" title="${t('employeeModal.contractExpiryAlert')}">
          </div>
        </div>
      </div>

      <!-- Job Tab (Company & Branch Assignment) -->
      <div class="tab-content" id="tab-job" style="display:none;">
        <div class="grid grid-cols-2">
          
          <div class="form-group">
            <label class="form-label">${t('employeeModal.employeeCompany')} *</label>
            <select class="form-select" name="companyId" id="emp-comp-select" required>
              ${companies
                .map(
                  (c) => `
                <option value="${c.id}" ${c.id === data.companyId ? 'selected' : ''}>${c.nameAr}</option>
              `
                )
                .join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">${t('employeeModal.employeeBranch')} *</label>
            <select class="form-select" name="branchId" id="emp-branch-select" required>
              <!-- Rendered dynamically -->
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">${t('employeeModal.departmentAdministration')} *</label>
            <select class="form-select" name="department" required>
              ${DEPARTMENTS_LIST.map((d) => `<option value="${d}" ${safe.department === d ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.jobTitle')} *</label><input type="text" class="form-input" name="jobTitle" value="${safe.jobTitle}" required placeholder="${t('employeeModal.jobTitlePlaceholder')}">
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.hireDate')} *</label>
            <input type="date" class="form-input" name="hireDate" value="${safe.hireDate || ''}" required>
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.contractType')}</label>
            <select class="form-select" name="contractType">
              <option value="full_time" ${safe.contractType === 'full_time' ? 'selected' : ''}>${t('employeeModal.fullTime')}</option><option value="contract" ${safe.contractType === 'contract' ? 'selected' : ''}>${t('employeeModal.fixedTerm')}</option><option value="probation" ${safe.contractType === 'probation' ? 'selected' : ''}>${t('employeeModal.probation')}</option><option value="part_time" ${safe.contractType === 'part_time' ? 'selected' : ''}>${t('employeeModal.partTime')}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.employeeStatus')}</label>
            <select class="form-select" name="status">
              <option value="active" ${safe.status === 'active' ? 'selected' : ''}>${t('statusActive')}</option><option value="probation" ${safe.status === 'probation' ? 'selected' : ''}>${t('statusProbation')}</option><option value="on_leave" ${safe.status === 'on_leave' ? 'selected' : ''}>${t('statusOnLeave')}</option><option value="resigned" ${safe.status === 'resigned' ? 'selected' : ''}>${t('statusResigned')}</option><option value="terminated" ${safe.status === 'terminated' ? 'selected' : ''}>${t('statusTerminated')}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.address')}</label>
            <input type="text" class="form-input" name="address" value="${safe.address || ''}">
          </div>
        </div>
      </div>

      <!-- Salary Tab -->
      <div class="tab-content" id="tab-salary" style="display:none;">
        <div class="grid grid-cols-2">
          <div class="form-group" style="grid-column: span 2;">
            <label class="form-label">${t('employeeModal.currency')}</label>
            <select class="form-select" name="currency" id="emp-currency-select" required>
              ${allCurrencies
                .map((c) => `<option value="${c.code}" ${(safe.currency || empCurr.code) === c.code ? 'selected' : ''}>${isEn ? c.nameEn : c.nameAr} (${c.code} — ${c.symbol})</option>`)
                .join('')}
            </select>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:3px;">${t('employeeModal.currencyHelp')}</div>
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.basicSalary')} * (<span data-cur-sym>${empCurSym}</span>)</label>
            <input type="number" step="0.01" class="form-input" name="basicSalary" id="emp-basic-salary" value="${safe.basicSalary}" required>
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.housingAllowance')} (<span data-cur-sym>${empCurSym}</span>)</label>
            <input type="number" step="0.01" class="form-input" name="housingAllowance" id="emp-housing-allowance" value="${safe.housingAllowance}">
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.transportAllowance')} (<span data-cur-sym>${empCurSym}</span>)</label>
            <input type="number" step="0.01" class="form-input" name="transportAllowance" value="${safe.transportAllowance}">
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.otherAllowances')} (<span data-cur-sym>${empCurSym}</span>)</label>
            <input type="number" step="0.01" class="form-input" name="otherAllowances" value="${safe.otherAllowances}">
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.bankName')}</label>
            <input type="text" class="form-input" name="bankName" value="${safe.bankName || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.iban')}</label>
            <input type="text" class="form-input" name="iban" value="${safe.iban || ''}" placeholder="SAxxxxxxxxxxxxxxxxxxxxxx">
          </div>
        </div>
      </div>

      <!-- Social Security & GOSI Tab (Requested Feature) -->
      <div class="tab-content" id="tab-gosi" style="display:none;">
        <div class="card" style="padding:16px; margin-bottom:16px; background:var(--bg-card-hover);">
          <div class="form-group" style="margin-bottom:0;">
            <label style="display:flex; align-items:center; gap:10px; cursor:pointer; font-weight:700; color:var(--text-main);">
              <input type="checkbox" name="isSubjectToGosi" id="chk-subject-gosi" ${data.isSubjectToGosi ? 'checked' : ''} style="width:18px; height:18px;">
              <span>${t('isSubjectToGosi')}</span>
            </label>
            <div style="font-size:12px; color:var(--text-muted); margin-top:4px; padding-right:28px;">
              ${t('employeeModal.gosiSubscriptionInfo')}
            </div>
          </div>
        </div>

        <div id="gosi-fields-container" style="${data.isSubjectToGosi ? '' : 'display:none;'}">
          <div class="grid grid-cols-2">
            <div class="form-group" style="grid-column: span 2;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <label class="form-label">${t('gosiRegisteredWage')} (<span data-cur-sym>${empCurSym}</span>) *</label>
                <button type="button" class="btn btn-sm btn-outline" id="btn-sync-gosi-wage" style="font-size:11px; padding:2px 8px;">
                  ${t('employeeModal.importBasicHousing')}
                </button>
              </div>
              <input type="number" step="0.01" class="form-input" name="gosiRegisteredWage" id="gosi-registered-wage-input" value="${safe.gosiRegisteredWage}" required>
              <div style="font-size:11.5px; color:var(--text-muted); margin-top:3px;">${t('gosiWageHelp')}</div>
            </div>

            <div class="form-group">
              <label class="form-label">${t('gosiEmployeePercent')} *</label>
              <input type="number" step="0.01" class="form-input" name="gosiEmployeePercent" id="gosi-emp-pct-input" value="${safe.gosiEmployeePercent}" required>
            </div>

            <div class="form-group">
              <label class="form-label">${t('gosiCompanyPercent')} *</label>
              <input type="number" step="0.01" class="form-input" name="gosiCompanyPercent" id="gosi-comp-pct-input" value="${safe.gosiCompanyPercent}" required>
            </div>
          </div>

          <!-- Live Breakdown Box -->
          <div class="card" style="padding:16px; margin-top:14px; border:1px solid rgba(79, 70, 229, 0.2); background:linear-gradient(135deg, rgba(79, 70, 229, 0.04) 0%, rgba(16, 185, 129, 0.04) 100%);">
            <div style="font-weight:700; font-size:13.5px; color:var(--text-main); margin-bottom:10px;">
              📊 ${t('employeeModal.gosiMonthlyPreview')}
            </div>
            
            <div class="grid grid-cols-3" style="gap:10px;">
              <div style="background:var(--bg-card); padding:10px; border-radius:var(--radius-sm); border:1px solid var(--border-color);">
                <div style="font-size:11.5px; color:var(--danger);">${t('gosiEmployeeDeduction')}</div>
                <div style="font-weight:800; font-size:15px; color:var(--danger);" id="lbl-gosi-emp-ded">0.00 <span data-cur-sym>${empCurSym}</span></div>
                <div style="font-size:10.5px; color:var(--text-muted);">${t('employeeModal.deductedFromSalary')}</div>
              </div>

              <div style="background:var(--bg-card); padding:10px; border-radius:var(--radius-sm); border:1px solid var(--border-color);">
                <div style="font-size:11.5px; color:var(--primary);">${t('gosiCompanyContribution')}</div>
                <div style="font-weight:800; font-size:15px; color:var(--primary);" id="lbl-gosi-comp-cont">0.00 <span data-cur-sym>${empCurSym}</span></div>
                <div style="font-size:10.5px; color:var(--text-muted);">${t('employeeModal.companyPays')}</div>
              </div>

              <div style="background:var(--bg-card); padding:10px; border-radius:var(--radius-sm); border:1px solid var(--border-color);">
                <div style="font-size:11.5px; color:var(--success);">${t('totalGosiContribution')}</div>
                <div style="font-weight:800; font-size:15px; color:var(--success);" id="lbl-gosi-total-cont">0.00 <span data-cur-sym>${empCurSym}</span></div>
                <div style="font-size:10.5px; color:var(--text-muted);">${t('employeeModal.totalSocialSecurityTransfer')}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Leaves Tab -->
      <div class="tab-content" id="tab-leaves" style="display:none;">
        <div class="grid grid-cols-2">
          <div class="form-group">
            <label class="form-label">${t('employeeModal.annualLeaveEntitlement')}</label>
            <input type="number" class="form-input" name="annualLeaveEntitlement" value="${safe.annualLeaveEntitlement}" required>
          </div>
          <div class="form-group">
            <label class="form-label">${t('employeeModal.carriedLeaveBalance')}</label>
            <input type="number" step="0.5" class="form-input" name="carriedOverLeaveBalance" value="${safe.carriedOverLeaveBalance}">
          </div>
          <div class="form-group" style="grid-column: span 2;">
            <label class="form-label">${t('employeeModal.manualLeaveAdjustment')}</label>
            <input type="number" step="0.5" class="form-input" name="manualLeaveAdjustment" value="${safe.manualLeaveAdjustment}">
            <span style="font-size:12px; color:var(--text-muted);">${t('employeeModal.manualLeaveAdjustmentHelp')}</span>
          </div>
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-primary submit-emp-btn">${isEdit ? t('save') : t('addNewEmployee')}</button>
  `;

  createModal({
    title: isEdit ? `${isEn ? 'Edit Employee: ' : 'تعديل بيانات الموظف: '}${safe.fullName}` : t('addNewEmployee'),
    size: 'lg',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      // Tab switching logic
      const tabBtns = overlay.querySelectorAll('.tab-btn');
      const tabContents = overlay.querySelectorAll('.tab-content');

      tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          tabBtns.forEach((b) => b.classList.remove('active'));
          tabContents.forEach((c) => (c.style.display = 'none'));

          btn.classList.add('active');
          const targetId = btn.getAttribute('data-tab');
          overlay.querySelector(`#${targetId}`).style.display = 'block';
        });
      });

      // Branch dynamic update
      const compSelect = overlay.querySelector('#emp-comp-select');
      const branchSelect = overlay.querySelector('#emp-branch-select');

      function updateBranches() {
        const compId = compSelect?.value;
        const comp = companies.find((c) => c.id === compId) || companies[0];
        if (!branchSelect) return;
        const branches = (comp && comp.branches && comp.branches.length > 0) ? comp.branches : [{ id: 'br-1', nameAr: 'الفرع الرئيسي', city: 'الرئيسي' }];
        branchSelect.innerHTML = branches
          .map(
            (b) => `
              <option value="${b.id}" ${b.id === data.branchId ? 'selected' : ''}>${i18n.getLang()==='en' ? (b.nameEn || t('employeeModal.branch')) : (b.nameAr || t('employeeModal.branch'))} (${b.city || ''})</option>
        `
          )
          .join('');
      }

      compSelect?.addEventListener('change', updateBranches);
      updateBranches();

      // GOSI Live calculations and toggle
      const chkGosi = overlay.querySelector('#chk-subject-gosi');
      const gosiFields = overlay.querySelector('#gosi-fields-container');
      const wageInput = overlay.querySelector('#gosi-registered-wage-input');
      const empPctInput = overlay.querySelector('#gosi-emp-pct-input');
      const compPctInput = overlay.querySelector('#gosi-comp-pct-input');
      const lblEmpDed = overlay.querySelector('#lbl-gosi-emp-ded');
      const lblCompCont = overlay.querySelector('#lbl-gosi-comp-cont');
      const lblTotalCont = overlay.querySelector('#lbl-gosi-total-cont');
      const btnSyncWage = overlay.querySelector('#btn-sync-gosi-wage');

      // Currency select — live symbol updates
      const curSelect = overlay.querySelector('#emp-currency-select');
      let curSym = settings.currencySymbol;
      const symFromSelect = () => {
        const code = curSelect ? curSelect.value : '';
        const c = allCurrencies.find((x) => x.code === code);
        return (c && c.symbol) || settings.currencySymbol;
      };
      function refreshCurrency() {
        curSym = symFromSelect();
        overlay.querySelectorAll('[data-cur-sym]').forEach((el) => { el.textContent = curSym; });
        updateGosiPreview();
      }
      curSelect?.addEventListener('change', refreshCurrency);

      function updateGosiPreview() {
        const wage = Number(wageInput?.value) || 0;
        const empPct = Number(empPctInput?.value) || 0;
        const compPct = Number(compPctInput?.value) || 0;

        const empDeduction = wage * (empPct / 100);
        const compContrib = wage * (compPct / 100);
        const total = empDeduction + compContrib;

        if (lblEmpDed) lblEmpDed.textContent = formatCurrency(empDeduction, curSym);
        if (lblCompCont) lblCompCont.textContent = formatCurrency(compContrib, curSym);
        if (lblTotalCont) lblTotalCont.textContent = formatCurrency(total, curSym);
      }

      chkGosi?.addEventListener('change', (e) => {
        if (gosiFields) gosiFields.style.display = e.target.checked ? 'block' : 'none';
        updateGosiPreview();
      });

      btnSyncWage?.addEventListener('click', () => {
        const basic = Number(overlay.querySelector('#emp-basic-salary')?.value) || 0;
        const housing = Number(overlay.querySelector('#emp-housing-allowance')?.value) || 0;
        if (wageInput) {
          wageInput.value = basic + housing;
          updateGosiPreview();
        }
      });

      wageInput?.addEventListener('input', updateGosiPreview);
      empPctInput?.addEventListener('input', updateGosiPreview);
      compPctInput?.addEventListener('input', updateGosiPreview);
      refreshCurrency();

      overlay.querySelector('.close-modal-btn').addEventListener('click', close);

      // Submit Form
      overlay.querySelector('.submit-emp-btn').addEventListener('click', () => {
        const form = overlay.querySelector('#employee-form');
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }

        const formData = new FormData(form);
        const isSubjectToGosi = form.querySelector('#chk-subject-gosi')?.checked || false;

        const empObject = {
          ...data,
          companyId: formData.get('companyId'),
          branchId: formData.get('branchId'),
          fullName: formData.get('fullName'),
          employeeNumber: formData.get('employeeNumber'),
          email: formData.get('email'),
          phone: formData.get('phone'),
          nationalId: formData.get('nationalId'),
          gender: formData.get('gender'),
          dateOfBirth: formData.get('dateOfBirth'),
          nationality: formData.get('nationality'),
          department: formData.get('department'),
          jobTitle: formData.get('jobTitle'),
          hireDate: formData.get('hireDate'),
          contractType: formData.get('contractType'),
          status: formData.get('status'),
          address: formData.get('address'),
          basicSalary: Number(formData.get('basicSalary')) || 0,
          housingAllowance: Number(formData.get('housingAllowance')) || 0,
          transportAllowance: Number(formData.get('transportAllowance')) || 0,
          otherAllowances: Number(formData.get('otherAllowances')) || 0,
          currency: formData.get('currency') || empCurr.code,
          bankName: formData.get('bankName'),
          iban: formData.get('iban'),
          // Document dates & alert toggles
          idIssueDate: formData.get('idIssueDate') || '',
          idExpiryDate: formData.get('idExpiryDate') || '',
          alertIdExpiry: form.querySelector('[name="alertIdExpiry"]')?.checked || false,
          passportNumber: formData.get('passportNumber') || '',
          passportIssueDate: formData.get('passportIssueDate') || '',
          passportExpiryDate: formData.get('passportExpiryDate') || '',
          alertPassportExpiry: form.querySelector('[name="alertPassportExpiry"]')?.checked || false,
          workPermitIssueDate: formData.get('workPermitIssueDate') || '',
          workPermitExpiryDate: formData.get('workPermitExpiryDate') || '',
          alertWorkPermitExpiry: form.querySelector('[name="alertWorkPermitExpiry"]')?.checked || false,
          contractEndDate: formData.get('contractEndDate') || '',
          alertContractExpiry: form.querySelector('[name="alertContractExpiry"]')?.checked || false,
          // GOSI
          isSubjectToGosi,
          gosiRegisteredWage: isSubjectToGosi ? (Number(formData.get('gosiRegisteredWage')) || 0) : 0,
          gosiEmployeePercent: isSubjectToGosi ? (Number(formData.get('gosiEmployeePercent')) || 0) : 0,
          gosiCompanyPercent: isSubjectToGosi ? (Number(formData.get('gosiCompanyPercent')) || 0) : 0,
          // Leaves
          annualLeaveEntitlement: Number(formData.get('annualLeaveEntitlement')) || 30,
          carriedOverLeaveBalance: Number(formData.get('carriedOverLeaveBalance')) || 0,
          manualLeaveAdjustment: Number(formData.get('manualLeaveAdjustment')) || 0,
        };

        if (isEdit) {
          storage.updateEmployee(empObject);
          storage.addAudit('edit', 'employee', `${empObject.fullName}`, empObject.id || formData.get('employeeNumber'));
          toast.success(tf('employeeModal.employeeUpdated',{name:empObject.fullName}));
        } else {
          storage.addEmployee(empObject);
          storage.addAudit('add', 'employee', `${empObject.fullName}`, empObject.id);
          toast.success(tf('employeeModal.employeeAdded',{name:empObject.fullName}));
        }

        close();
        if (onSaved) onSaved(empObject);
      });
    },
  });
}
