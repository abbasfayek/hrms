// ==========================================
// Smart EOSB Calculator & Settlement Modal (Bilingual)
// ==========================================

import { storage } from '../storage.js';
import { toast } from './Toast.js';
import { createModal } from './Modal.js';
import { Icons } from '../icons.js';
import { formatDate, TERMINATION_REASONS, can, formatAmountWithCode, resolveEmployeeCurrency } from '../types.js';
import { calculateEOSB } from '../engines/eosbEngine.js';
import { t, i18n } from '../i18n.js';

export function openEOSBCalculatorModal(defaultEmployee = null, onSaved, opts = {}) {
  const state = storage.getState();
  const { employees, leaves, loans, settings, companies } = state;
  const activeEmployees = employees.filter((e) => e.status === 'active' || e.status === 'probation');
  const canApprove = can(storage.getActiveUser(), 'eosb.approve');
  const previewOnly = !!opts.previewOnly;
  const selectedEmpId = defaultEmployee ? defaultEmployee.id : (activeEmployees[0]?.id || '');
  const todayStr = new Date().toISOString().split('T')[0];
  const isEn = i18n.getLang() === 'en';
  const csym = settings.currencySymbol || '$';

  // Declared BEFORE bodyHtml: bodyHtml embeds this note, and const bindings are
  // in the temporal dead zone until their declaration line runs — referencing
  // it later used to throw "Cannot access 'workflowNoteHtml' before
  // initialization", which made the whole EOSB calculator/settlement flow
  // appear dead in the interface.
  const workflowNoteHtml = `
    <div style="padding:10px 14px; border-radius:10px; margin:12px 0 2px; border:1px solid rgba(245,158,11,0.35); background:rgba(245,158,11,0.07); font-size:12.5px; color:var(--text-main); line-height:1.7;">
      ${canApprove
        ? (isEn
            ? '💡 This settlement is saved in <strong>Under Financial Audit</strong> status. Approve it from the End of Service screen to finalize it, mark it <strong>Paid</strong>, then issue the clearance certificate.'
            : '💡 يتم حفظ التسوية بحالة <strong>قيد التدقيق المالي</strong>. اعتمدها من شاشة نهاية الخدمة لتتم تصفيتها، ثم أصرفها مالياً وأصدر المخالصة.')
        : (isEn
            ? '💡 This settlement is saved in <strong>Under Financial Audit</strong> status. An approver will review it on the End of Service screen — the certificate is issued only after approval & payment.'
            : '💡 يتم حفظ التسوية بحالة <strong>قيد التدقيق المالي</strong>. سيقوم المسؤول بالمراجعة من شاشة نهاية الخدمة — تُصدر المخالصة فقط بعد الاعتماد والصرف.')}
    </div>
  `;

  const bodyHtml = `
    <form id="eosb-form">
      <div class="grid grid-cols-2">
        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${isEn ? 'Employee to Settle *' : 'الموظف المراد تصفية مستحقاته *'}</label>
          <select class="form-select" name="employeeId" id="eosb-emp-select" required>
            ${activeEmployees
              .map(
                (emp) => `
              <option value="${emp.id}" ${emp.id === selectedEmpId ? 'selected' : ''}>
                ${emp.fullName} (${emp.jobTitle} - ${isEn ? 'Hired: ' : 'تعيين: '}${formatDate(emp.hireDate)})
              </option>
            `
              )
              .join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Last Working Day *' : 'آخر يوم دوام *'}</label>
          <input type="date" class="form-input" name="lastWorkingDay" id="eosb-last-working-day" value="${todayStr}" required>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Termination Date (Official) *' : 'تاريخ إنهاء الخدمة (رسمي) *'}</label>
          <input type="date" class="form-input" name="terminationDate" id="eosb-term-date" value="${todayStr}" required>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Termination Reason *' : 'سبب انتهاء العلاقة التعاقدية *'}</label>
          <select class="form-select" name="reason" id="eosb-reason-select" required>
            ${Object.entries(TERMINATION_REASONS)
              .map(([key, label]) => {
                const text = typeof label === 'object' ? (isEn ? label.en : label.ar) : label;
                return `<option value="${key}">${text}</option>`;
              })
              .join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Worked Days in Final Month' : 'أيام العمل المنجزة في الشهر الأخير'}</label>
          <input type="number" min="0" class="form-input" name="workedDaysInFinalMonth" id="eosb-worked-days" value="0" placeholder="${isEn ? 'Auto-calculated up to termination date' : 'يُحتسب تلقائياً حتى تاريخ الانتهاء'}">
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Additional Bonuses / Compensation' : 'مكافآت أو تعويضات إضافية'} (<span id="eosb-cur-code">${csym}</span>)</label>
          <input type="number" step="0.01" class="form-input" name="bonusCompensation" id="eosb-bonus" value="0">
        </div>

        <!-- Probation-failure settlement type (سند راتب) - shown only for probation_failure -->
        <div class="form-group" id="eosb-probation-group" style="grid-column: span 2; display:none;">
          <label class="form-label">${isEn ? 'Probation Payout Type' : 'نوع صرف سند الراتب (فترة التجربة)'}</label>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <label class="radio-check" style="display:flex; align-items:flex-start; gap:8px; cursor:pointer;">
              <input type="radio" name="probationPayout" value="salary_bond" checked style="margin-top:2px;">
              <span>
                <strong>${isEn ? 'Salary Bond – nominal salary only' : 'سند راتب – الراتب الاسمي فقط'}</strong>
                <div style="font-size:12px; color:var(--text-muted);">${isEn ? 'Only nominal (basic) wage for worked days. No leave cashout, no service gratuity, no service years.' : 'الراتب الأساسي (الاسمي) فقط عن أيام العمل. بدون بدل إجازات، بدون مكافأة نهاية الخدمة، بدون سنوات خدمة.'}</div>
              </span>
            </label>
            <label class="radio-check" style="display:flex; align-items:flex-start; gap:8px; cursor:pointer;">
              <input type="radio" name="probationPayout" value="normal" style="margin-top:2px;">
              <span>
                <strong>${isEn ? 'Normal benefits (leave cashout allowed)' : 'المستحقات النظامية (مع بدل الإجازات)'}</strong>
                <div style="font-size:12px; color:var(--text-muted);">${isEn ? 'Keep the unused leave cashout and final-month wage. Gratuity stays zero for probation failure.' : 'يُحتفظ ببدل رصيد الإجازات وأجر الشهر الأخير. تبقى مكافأة نهاية الخدمة صفراً لعدم اجتياز التجربة.'}</div>
              </span>
            </label>
          </div>
        </div>

        <!-- Live Comprehensive Settlement Breakdown Card -->
        <div class="form-group" style="grid-column: span 2;">
          <div class="card" style="padding:16px; background:var(--bg-card-hover); border-color:var(--border-color);">
            <div style="font-weight:800; font-size:14px; margin-bottom:12px; color:var(--text-main); display:flex; align-items:center; justify-content:space-between;">
              <span>${Icons.landmark(16)} ${isEn ? 'End of Service Settlement Breakdown:' : 'تفاصيل احتساب مكافأة نهاية الخدمة والبدلات:'}</span>
              <span class="badge badge-primary" id="eosb-service-period-badge">0 ${isEn ? 'Yr' : 'سنة'}</span>
            </div>

            <!-- Service Details -->
            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; margin-bottom:12px; font-size:12.5px; text-align:center;">
              <div style="background:var(--bg-card); padding:8px; border-radius:var(--radius-md);">
                <div style="color:var(--text-muted);">${isEn ? 'Total Service' : 'مدة الخدمة الفعلية'}</div>
                <strong style="color:var(--text-main);" id="eosb-duration-label">-</strong>
              </div>
              <div style="background:var(--bg-card); padding:8px; border-radius:var(--radius-md);">
                <div style="color:var(--text-muted);">${isEn ? 'Base Wage' : 'الأجر المعتمد للحساب'}</div>
                <strong style="color:var(--text-main);" id="eosb-base-wage-label">0.00 ${csym}</strong>
              </div>
              <div style="background:var(--bg-card); padding:8px; border-radius:var(--radius-md);">
                <div style="color:var(--text-muted);">${isEn ? 'Entitlement Ratio' : 'نسبة الاستحقاق النظامية'}</div>
                <strong style="color:var(--primary);" id="eosb-ratio-label">100%</strong>
              </div>
            </div>

            <!-- Financial Breakdown Table -->
            <div style="display:flex; flex-direction:column; gap:6px; font-size:13px; border-top:1px solid var(--border-color); padding-top:10px;">
              <div style="display:flex; justify-content:space-between;">
                <span>${isEn ? 'End of Service Benefit:' : 'مكافأة نهاية الخدمة النظامية:'}</span>
                <strong style="color:var(--text-main);" id="eosb-amount-label">0.00 ${csym}</strong>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span>${isEn ? 'Unused Leave Cashout:' : 'بدل رصيد الإجازات غير المستهلكة نقداً:'}</span>
                <strong style="color:var(--primary);" id="eosb-leave-cashout-label">0.00 ${csym}</strong>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span>${isEn ? 'Final Month Worked Salary:' : 'أجر أيام العمل للشهر الأخير:'}</span>
                <strong style="color:var(--text-main);" id="eosb-final-salary-label">0.00 ${csym}</strong>
              </div>
              <div style="display:flex; justify-content:space-between; color:var(--danger);">
                <span>${isEn ? 'Outstanding Advances / Loans:' : 'استقطاع السلف والقروض المعلقة:'}</span>
                <strong id="eosb-loans-deduct-label">- 0.00 ${csym}</strong>
              </div>
              
              <!-- Grand Net Total -->
              <div style="border-top:2px solid var(--border-color); padding-top:8px; margin-top:4px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:15px; font-weight:800; color:var(--text-main);">${isEn ? 'Net Final Settlement:' : 'صافي مستحقات التصفية النهائية:'}</span>
                <span style="font-size:20px; font-weight:900; color:var(--success);" id="eosb-net-total-label">0.00 ${csym}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="form-group" style="grid-column: span 2;">
          <label class="form-label">${isEn ? 'Notes & Decisions' : 'ملاحظات وقرارات إضافية'}</label>
          <textarea class="form-textarea" name="notes" placeholder="${isEn ? 'Settlement notes...' : 'ملاحظات التسوية النهائية...'}"></textarea>
        </div>
      </div>
      ${workflowNoteHtml}
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-success submit-eosb-btn">
      ${Icons.check(16)} ${previewOnly ? (isEn ? 'Record Correction' : 'تسجيل التصحيح') : (isEn ? 'Save & Submit for Financial Audit' : 'حفظ التسوية وإرسالها للمراجعة المالية')}
    </button>
  `;

  createModal({
    title: `${isEn ? 'EOSB Calculator & Settlement' : 'حاسبة ومخالصة مكافأة نهاية الخدمة'}`,
    size: 'lg',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      const empSelect = overlay.querySelector('#eosb-emp-select');
      const lastWorkingDayInput = overlay.querySelector('#eosb-last-working-day');
      const termDateInput = overlay.querySelector('#eosb-term-date');
      const reasonSelect = overlay.querySelector('#eosb-reason-select');
      const workedDaysInput = overlay.querySelector('#eosb-worked-days');
      const bonusInput = overlay.querySelector('#eosb-bonus');
      const probationGroup = overlay.querySelector('#eosb-probation-group');

      const serviceBadge = overlay.querySelector('#eosb-service-period-badge');
      const durationLabel = overlay.querySelector('#eosb-duration-label');
      const baseWageLabel = overlay.querySelector('#eosb-base-wage-label');
      const ratioLabel = overlay.querySelector('#eosb-ratio-label');
      const amountLabel = overlay.querySelector('#eosb-amount-label');
      const leaveCashoutLabel = overlay.querySelector('#eosb-leave-cashout-label');
      const finalSalaryLabel = overlay.querySelector('#eosb-final-salary-label');
      const loansDeductLabel = overlay.querySelector('#eosb-loans-deduct-label');
      const netTotalLabel = overlay.querySelector('#eosb-net-total-label');

      let currentResult = null;

      function updateCalculations() {
        const empId = empSelect.value;
        const emp = employees.find((e) => e.id === empId);
        if (!emp) return;

        // P2.2 multi-currency: every figure shown in this breakdown is formatted
        // with the EMPLOYEE's resolved currency CODE (e.g. "750,000.00 IQD") —
        // never the global default symbol — so IQD amounts cannot be misread as USD.
        const curRec = resolveEmployeeCurrency(emp, settings, companies);
        const curCode = curRec.code || settings.currency || 'USD';
        const curSym = curRec.symbol || csym;
        const curCodeLabel = overlay.querySelector('#eosb-cur-code');
        if (curCodeLabel) curCodeLabel.textContent = `${curCode} (${curSym})`;

        const terminationDate = termDateInput.value;
        const lastWorkingDay = lastWorkingDayInput.value || terminationDate;
        const reason = reasonSelect.value;
        const workedDaysInFinalMonth = Number(workedDaysInput.value) || 0;
        const termObj = new Date(`${terminationDate}T00:00:00`);
        if (!isNaN(termObj.getTime())) {
          workedDaysInput.max = String(new Date(termObj.getFullYear(), termObj.getMonth() + 1, 0).getDate());
        }
        const bonusCompensation = Number(bonusInput.value) || 0;
        const probationPayout = overlay.querySelector('input[name="probationPayout"]:checked')?.value === 'normal' ? 'salary_bond_plus_leave' : 'salary_bond';

        currentResult = calculateEOSB({
          employee: emp,
          terminationDate,
          lastWorkingDay,
          reason,
          leaveRequests: leaves,
          loans,
          workedDaysInFinalMonth,
          bonusCompensation,
          probationPayout,
          settings,
          companies,
        });

        serviceBadge.textContent = `${currentResult.serviceYears} ${isEn ? 'Y' : 'سنة'} و ${currentResult.serviceMonths} ${isEn ? 'M' : 'شهر'}`;
        durationLabel.textContent = currentResult.settlementType === 'salary_bond'
          ? (isEn ? 'Salary bond (no service years)' : 'سند راتب (بدون سنوات خدمة)')
          : `${currentResult.serviceYears} ${isEn ? 'yrs' : 'سنة'}، ${currentResult.serviceMonths} ${isEn ? 'mo' : 'شهر'}، ${currentResult.serviceDays} ${isEn ? 'day(s)' : 'يوم'}`;
        baseWageLabel.textContent = formatAmountWithCode(currentResult.settlementType === 'salary_bond' ? currentResult.lastBasicSalary : currentResult.lastGrossSalary, curCode);
        const reasonLabel = TERMINATION_REASONS[currentResult.reason];
        const reasonText = typeof reasonLabel === 'object' ? (isEn ? reasonLabel.en : reasonLabel.ar) : (reasonLabel || currentResult.reason);
        ratioLabel.textContent = currentResult.settlementType === 'salary_bond'
          ? (isEn ? '100% (Salary Bond)' : '100% (سند راتب)')
          : `${Math.round(currentResult.entitlementRatio * 100)}% (${reasonText})`;

        amountLabel.textContent = formatAmountWithCode(currentResult.finalEOSBAmount, curCode);
        leaveCashoutLabel.textContent = `${formatAmountWithCode(currentResult.leaveCompensationAmount, curCode)} (${currentResult.unusedLeaveDays} ${isEn ? 'days' : 'يوم'})`;
        finalSalaryLabel.textContent = formatAmountWithCode(currentResult.finalMonthSalary, curCode);
        loansDeductLabel.textContent = `- ${formatAmountWithCode(currentResult.remainingLoanDeductions, curCode)}`;
        netTotalLabel.textContent = formatAmountWithCode(currentResult.netSettlementAmount, curCode);
      }

      empSelect.addEventListener('change', updateCalculations);
      termDateInput.addEventListener('change', () => {
        if (!lastWorkingDayInput.value) lastWorkingDayInput.value = termDateInput.value;
        updateCalculations();
      });
      reasonSelect.addEventListener('change', () => {
        const isProbation = reasonSelect.value === 'probation_failure';
        probationGroup.style.display = isProbation ? 'flex' : 'none';
        updateCalculations();
      });
      overlay.querySelectorAll('input[name="probationPayout"]').forEach((r) => r.addEventListener('change', updateCalculations));
      workedDaysInput.addEventListener('input', updateCalculations);
      bonusInput.addEventListener('input', updateCalculations);
      updateCalculations();

      overlay.querySelector('.close-modal-btn').addEventListener('click', close);

      overlay.querySelector('.submit-eosb-btn').addEventListener('click', () => {
        if (!currentResult) return;

        const emp = employees.find((e) => e.id === currentResult.employeeId);
        if (storage.employeeScopeError(emp)) {
          toast.error(isEn ? 'This employee has no Company/Branch assigned — assign both in their profile before saving this record.' : 'هذا الموظف غير مربوط بشركة وفرع — قم بتعيينهما في ملفه قبل حفظ هذا السجل.');
          return;
        }

        // P2.2: stamp the employee's resolved currency on the record so the
        // EOSB register can always display the correct currency code.
        const curRec = resolveEmployeeCurrency(emp, settings, companies);
        currentResult.currency = curRec.code;
        currentResult.currencySymbol = curRec.symbol;

        const form = overlay.querySelector('#eosb-form');
        const formData = new FormData(form);
        currentResult.companyId = emp.companyId;
        currentResult.branchId = emp.branchId;
        currentResult.notes = formData.get('notes') || '';
        currentResult.status = 'under_audit';
        currentResult.createdBy = storage.getActiveUser()?.name || (isEn ? 'HR' : 'الموارد البشرية');
        currentResult.createdAt = currentResult.createdAt || new Date().toISOString();

        if (previewOnly) {
          // Correction path: hand the computed result to the caller (the EOSB
          // view records it through the guarded engine); do NOT persist here.
          close();
          if (typeof opts.onResult === 'function') opts.onResult(currentResult);
          return;
        }

        storage.addEOSB(currentResult);
        storage.addAudit('generate', 'eosb', `${currentResult.employeeName} — ${formatAmountWithCode(currentResult.netSettlementAmount, currentResult.currency)} (${isEn ? 'submitted for financial audit' : 'أُرسل للمراجعة المالية'})`, currentResult.id);
        toast.success(isEn
          ? `EOSB settlement saved for ${currentResult.employeeName} and submitted for financial audit.`
          : `تم حفظ تصفية نهاية الخدمة للموظف ${currentResult.employeeName} وإرسالها للمراجعة المالية.`);
        close();
        if (onSaved) onSaved(currentResult);
      });
    },
  });
}