// ==========================================
// Payroll & Financial Management View (Workflow, Audit, Disbursed, Deductions & Loans)
// ==========================================

import { storage } from '../storage.js';
import { Icons } from '../icons.js';
import { formatCurrency, formatDate, getCurrentMonth, formatPayMonth, formatAmountWithCode, summarizeCurrencySegmentsHtml, isPayrollViewEnabled, resolveEmployeeCurrency, escapeHtml } from '../types.js';
import { generateMonthlyPayroll, generateBankPayrollFile, computePayrollReleaseSchedule, transitionPayroll, recordPayrollCorrection } from '../engines/payrollEngine.js';
import { transitionPayrollGuarded, recordPayrollCorrectionGuarded, archivePayrollBatchGuarded } from '../engines/payrollAccess.js';
import { transitionCorrectionGuarded, coApproveCorrectionGuarded, archiveCorrectionGuarded } from '../engines/payrollCorrectionAccess.js';
import { correctionFinancialView } from '../engines/payrollCorrectionModel.js';
import { openPayslipModal } from './PayslipModal.js';
import { openBatchPayslipsPrintModal, printIsolatedBatchPayslips } from './BatchPayslipsPrintModal.js';
import { openReleasePayrollModal } from './ReleasePayrollModal.js';
import { openSalaryIncrementModal } from './SalaryIncrementModal.js';
import { openLoanModal } from './LoanModal.js';
import { openLoanReceiptModal } from './LoanReceiptModal.js';
import { openDeductionBonusModal, openDeductionsBonusesListModal } from './DeductionBonusModal.js';
import { openArchivePayrollModal } from './ArchivePayrollModal.js';
import { openPayrollCorrectionModal } from './PayrollCorrectionModal.js';
import { toast } from './Toast.js';
import { showConfirmDialog, createModal } from './Modal.js';
import { t, tf, i18n } from '../i18n.js';
import { can } from '../types.js';

// Persist the active payroll tab across auto-sync re-renders so a background
// data refresh never resets the user back to the first tab.
let persistedTab = null;

export function renderPayrollView(container, options = {}) {
  const state = storage.getState();
  const { employees, overtime, loans, attendance, increments, settings, companies } = state;

  // P2.2 Super-Admin payroll display lock: when a super-admin turns the payroll
  // visibility OFF in Settings, every non-super-admin sees a lock notice and no
  // payroll data renders anywhere. Read dynamically from the live settings each
  // render — never from a time constant.
  if (!isPayrollViewEnabled(settings) && state.currentUser?.role !== 'super_admin') {
    const isEn = i18n.getLang() === 'en';
    container.innerHTML = `
      <div style="max-width:560px; margin:60px auto; text-align:center;">
        <div style="font-size:46px; margin-bottom:12px;">🔒</div>
        <h2 style="font-size:20px; font-weight:800; color:var(--text-main);">${isEn ? 'Payroll Display is Locked' : 'عرض مسيرات الرواتب مقفل'}</h2>
        <p style="font-size:13.5px; color:var(--text-muted); margin-top:8px; line-height:1.8;">
          ${isEn
            ? 'The system administrator has temporarily disabled payroll display. You can continue managing attendance, leaves and daily HR operations; the payroll module will re-open once the administrator enables it from Settings.'
            : 'قام مدير النظام بتعطيل عرض مسيرات الرواتب مؤقتاً. يمكنك الاستمرار في إدارة الحضور والإجازات والعمليات اليومية؛ وسيُعاد فتح ملف الرواتب فور تفعيل المدير له من إعدادات النظام.'}
        </p>
      </div>
    `;
    return;
  }
  // Read the freshest payrolls array at mount time. Month pickers inside
  // renderTabContent re-read it per render so batches created/archived during
  // this session are found immediately instead of hitting a stale snapshot.
  const getLivePayrolls = () => storage.getState().payrolls;
  const sym = settings.currencySymbol || '$';
  const isEn = i18n.getLang() === 'en';
  // Phase 2 (Spec v1.0): every payroll action is permission-gated per role.
  // Payroll Admin (generate/edit/submit) | Audit Reviewer (approve/reject) |
  // Payments Officer (disburse) | Super Admin (everything incl. archive).
  const canManagePayroll = can(state.currentUser, 'payroll.generate');
  const canEditDraft = can(state.currentUser, 'payroll.edit');
  const canSubmitAudit = can(state.currentUser, 'payroll.submit');
  const canApprove = can(state.currentUser, 'payroll.approve');
  const canRejectAudit = can(state.currentUser, 'payroll.reject');
  const canExportPayroll = can(state.currentUser, 'payroll.export');
  const canDisburse = can(state.currentUser, 'payroll.disburse');
  const canArchive = can(state.currentUser, 'payroll.archive');
  const canReviewAudit = canApprove || canRejectAudit || can(state.currentUser, 'audit.view');
  const canGrantLoan = can(state.currentUser, 'loans.add');
  const canPayLoan = can(state.currentUser, 'loans.pay');
  const canEditLoan = can(state.currentUser, 'loans.edit');
  const canDeleteLoan = can(state.currentUser, 'loans.delete');
  const canDeductions = can(state.currentUser, 'deductions.add');
  const canAddIncrement = can(state.currentUser, 'increments.add');
  // Phase 9 — correction permissions (guards still enforce all business/SoD rules).
  const canCreateCorrection = can(state.currentUser, 'payroll.correction.create');
  const canCoApproveCorrection = can(state.currentUser, 'payroll.correction.coApprove');

  let activeTab = options.tab || persistedTab || 'payroll'; // 'payroll' | 'audit' | 'disbursed' | 'loans' | 'increments'

  // Standard payday = day 25 of each month (or the branch payDay configured in
  // Companies/Branches). The calcuation is scoped to the selected company/branch
  // so editing a branch's payDay in settings is immediately reflected here.
  function defaultPayDay() {
    const sc = storage.getState();
    const scopeComp = sc.selectedCompanyId;
    const scopeBr = sc.selectedBranchId;
    let max = 25;
    (companies || []).forEach((c) => {
      if (scopeComp && scopeComp !== 'all' && c.id !== scopeComp) return;
      (c.branches || []).forEach((b) => {
        if (scopeBr && scopeBr !== 'all' && b.id !== scopeBr) return;
        const pd = Number(b.payDay);
        if (pd >= 1 && pd <= 31 && pd > max) max = pd;
      });
    });
    return max;
  }

  const localTodayStr = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  };

  // A payroll month may only be generated / reviewed once its payday arrived.
  function isMonthAvailable(month) {
    const batch = getLivePayrolls().find((b) => b.month === month);
    let payDay = defaultPayDay();
    if (batch) {
      // Released batches keep their historical data; pending draft/audit/approved
      // batches are re-scheduled from the (possibly edited) branch payDay each time.
      if (batch.releaseStatus === 'released') {
        payDay = Number(batch.releasePayDay) || payDay;
      } else {
        const scheduled = computePayrollReleaseSchedule(batch, companies);
        payDay = Number(scheduled.releasePayDay) || payDay;
      }
    }
    return localTodayStr() >= `${month}-${String(payDay).padStart(2, '0')}`;
  }

  // Get the current branch context for payroll operations
  function getPayrollBranchContext() {
    const sc = storage.getState();
    return {
      companyId: storage.getSelectedCompanyId(),
      branchId: storage.getSelectedBranchId(),
    };
  }

  // Get live payrolls filtered by current branch context
  function getBranchPayrolls() {
    const { companyId, branchId } = getPayrollBranchContext();
    return getLivePayrolls().filter((b) => 
      b.companyId === companyId && b.branchId === branchId
    );
  }

  // A payroll month may only be generated / reviewed once its payday arrived.
  function isMonthAvailable(month) {
    const { companyId, branchId } = getPayrollBranchContext();
    const batch = getLivePayrolls().find((b) => b.month === month && b.companyId === companyId && b.branchId === branchId);
    let payDay = defaultPayDay();
    if (batch) {
      // Released batches keep their historical data; pending draft/audit/approved
      // batches are re-scheduled from the (possibly edited) branch payDay each time.
      if (batch.releaseStatus === 'released') {
        payDay = Number(batch.releasePayDay) || payDay;
      } else {
        const scheduled = computePayrollReleaseSchedule(batch, companies);
        payDay = Number(scheduled.releasePayDay) || payDay;
      }
    }
    return localTodayStr() >= `${month}-${String(payDay).padStart(2, '0')}`;
  }

  // Default month: the latest month whose payroll is due and still open (not
  // paid/archived). Existing open batches (draft/under_audit/approved) have
  // priority; a due in-year month with no batch yet is also a valid target.
  // Once every due month is already paid (e.g. after archiving Jan→Aug), we
  // return the current (upcoming) month so the app shows the "not available
  // until payday" notice instead of a stale paid batch, and we never jump back
  // across the year boundary to auto-generate an old draft.
  function defaultPayMonth() {
    const cur = getCurrentMonth();
    const curYear = cur.slice(0, 4);
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const batch = getLivePayrolls().find((b) => b.month === m && b.companyId === getPayrollBranchContext().companyId && b.branchId === getPayrollBranchContext().branchId);
      if (batch) {
        if (batch.status !== 'paid') return m;
        continue;
      }
      if (m.slice(0, 4) === curYear && isMonthAvailable(m)) return m;
    }
    return cur;
  }

  // Get the current branch context for payroll operations
  const { companyId: currentCompanyId, branchId: currentBranchId } = getPayrollBranchContext();

  let currentMonth = options.month || defaultPayMonth();

  // Get current month batch from storage or generate dynamically (only when
  // that month's payroll is actually due — never before its payday).
  let currentBatch = getLivePayrolls().find((b) => b.month === currentMonth && b.companyId === currentCompanyId && b.branchId === currentBranchId);
  if (currentBatch && currentBatch.releaseStatus !== 'released') {
    computePayrollReleaseSchedule(currentBatch, companies);
  }
  if (!currentBatch && isMonthAvailable(currentMonth)) {
    currentBatch = generateMonthlyPayroll(employees, overtime, loans, attendance, { month: currentMonth, adjustments: increments, companies }, settings);
    // Tag the generated batch with current branch context
    currentBatch.companyId = currentCompanyId;
    currentBatch.branchId = currentBranchId;
    computePayrollReleaseSchedule(currentBatch, companies);
  }

  // Select a month: clear the stale batch first so a not-yet-due month (e.g.
  // September before the 25th) cannot keep showing the previous paid month.
  // When the selected month has no batch and isn't due, no draft is generated.
  const selectMonth = (newMonth) => {
    currentMonth = newMonth;
    const ctx = getPayrollBranchContext();
    currentBatch = getLivePayrolls().find((b) => b.month === newMonth && b.companyId === ctx.companyId && b.branchId === ctx.branchId);
    if (currentBatch && currentBatch.releaseStatus !== 'released') {
      computePayrollReleaseSchedule(currentBatch, companies);
    }
    if (!currentBatch && isMonthAvailable(newMonth)) {
      currentBatch = generateMonthlyPayroll(employees, overtime, loans, attendance, { month: newMonth, adjustments: increments, companies }, settings);
      currentBatch.companyId = ctx.companyId;
      currentBatch.branchId = ctx.branchId;
      computePayrollReleaseSchedule(currentBatch, companies);
    }
    renderTabContent();
  };

  // Ensure audit item properties exist on all items
  if (currentBatch && currentBatch.items) {
    currentBatch.items.forEach((it) => {
      if (!it.auditStatus) it.auditStatus = 'pending'; // 'pending' | 'verified' | 'has_note' | 'rejected'
      if (it.auditNotes === undefined) it.auditNotes = '';
    });
  }

  // Ensure the payroll release schedule (per-branch payday) exists on the batch
  if (currentBatch) computePayrollReleaseSchedule(currentBatch, companies);

  // Filter disbursed payrolls - read live state so batches paid during this
  // view session (release / disburse) appear immediately, not a stale mount snapshot.
  const getPaidBatches = () => storage.getState().payrolls.filter((b) => b.status === 'paid');

  // Phase 9 — corrections inherited into the CURRENT branch context (L4).
  const getContextCorrections = () => {
    const ctx = getPayrollBranchContext();
    return storage.getCorrections().filter((c) => c
      && String(c.companyId) === String(ctx.companyId)
      && String(c.branchId) === String(ctx.branchId));
  };
  const correctionCount = () => getContextCorrections().length;

  function renderTabContent() {
    const contentArea = container.querySelector('#payroll-tab-content');
    if (!contentArea) return;

    // Read the freshest payrolls array from storage on every render so a batch
    // created/archived during this session (and any background sync) is found
    // immediately instead of falling back to the mount-time snapshot.
    const livePayrolls = storage.getState().payrolls;

    // Filter disbursed payrolls - read live state so batches paid during this
    // view session (release / disburse) appear immediately, not a stale mount snapshot.
    const paidBatches = livePayrolls.filter((b) => b.status === 'paid');

    // P2.2 multi-currency: never sum different currencies into one figure.
    // Each currency renders on its own line, with its own decimals and a tinted
    // code, so mixed-currency totals stay readable (no overflow/overlap).
    const seg = (k, sign) => summarizeCurrencySegmentsHtml((currentBatch?.totalsByCurrency || []).map((g) => ({ code: g.code, amount: g[k] || 0 })), { sign });
    const itCur = (it) => it.currency || settings.currency || 'USD';
    const segCol = (fn, sign) => summarizeCurrencySegmentsHtml((currentBatch?.items || []).map((it) => ({ code: itCur(it), amount: Number(fn(it)) || 0 })), { sign });

    // A month without a batch (not due yet / no employees) must never crash the
    // audit, loans, increments or disbursed tabs. Only the batches-dependant
    // tabs (payroll + audit) show the "no batch" notice; the rest render fine.
    if (!currentBatch && (activeTab === 'payroll' || activeTab === 'audit')) {
      contentArea.innerHTML = `
          <div class="alert-box alert-warning" style="margin-bottom:20px; padding:16px 20px; border-radius:8px;">
            <strong>📅 ${isEn ? `No payroll batch for ${currentMonth} yet` : `لا يوجد مسير رواتب لشهر ${currentMonth} بعد`}</strong>
            <div style="font-size:12.5px; color:var(--text-muted); margin-top:4px;">
              ${isEn
                ? `Month ${currentMonth} has no payroll batch (it is not due yet or has no employees). Pick a due month.`
                : `شهر ${currentMonth} لا يحتوي على مسير رواتب (إما أنه غير مستحق بعد أو لا يوجد فيه موظفون). اختر شهراً مستحق الصرف.`}
            </div>
            <div style="margin-top:10px; display:inline-flex; align-items:center; gap:8px;">
              <input type="month" class="form-input" id="payroll-month-selector-empty" value="${currentMonth}" style="width:160px; padding:6px 10px;">
            </div>
          </div>
        `;
      contentArea.querySelector('#payroll-month-selector-empty')?.addEventListener('change', (e) => {
        currentMonth = e.target.value;
        const ctx = getPayrollBranchContext();
        currentBatch = getLivePayrolls().find((b) => b.month === currentMonth && b.companyId === ctx.companyId && b.branchId === ctx.branchId);
        if (!currentBatch && isMonthAvailable(currentMonth)) {
          currentBatch = generateMonthlyPayroll(employees, overtime, loans, attendance, { month: currentMonth, adjustments: increments, companies }, settings);
          currentBatch.companyId = ctx.companyId;
          currentBatch.branchId = ctx.branchId;
          computePayrollReleaseSchedule(currentBatch, companies);
        }
        renderTabContent();
      });
      return;
    }

    const isPaid = currentBatch ? currentBatch.status === 'paid' : false;
    const isUnderAudit = currentBatch ? currentBatch.status === 'under_audit' : false;
    const isApproved = currentBatch ? currentBatch.status === 'approved' : false;
    const isReturned = currentBatch ? currentBatch.status === 'rejected' : false;
    const isDraft = currentBatch ? (currentBatch.status === 'draft' || !currentBatch.status) : false;
    // Logical home per Financial Workflow & Currency Specification v1.0:
    //   draft        → payroll tab (prep / edit)
    //   under_audit  → audit tab
    //   approved     → payment queue point (payroll tab, pay button)
    //   paid         → archive (disbursed history)
    //   rejected     → Returned/Needs Correction (payroll tab, edit + resubmit)
    const isEditable = isDraft || isReturned;

    // Payroll release schedule: batches become eligible on the branch payday
    const todayStr = new Date().toISOString().slice(0, 10);
    const isReleased = currentBatch ? currentBatch.releaseStatus === 'released' : false;
    const releaseDue = currentBatch ? (!!currentBatch.releaseDate && !isPaid && todayStr >= currentBatch.releaseDate) : false;

    // Disburse & Pay Salaries (Dual Release: final review preview + manager confirmation).
    // Shared so both the approved batch (payroll tab) and the approved batch
    // (audit tab) trigger the exact same release & settlement flow.
    const disburseBatch = (batch) => {
      if (!canDisburse) { // RBAC gate (C-5)
        toast.error(isEn ? 'Insufficient permissions to disburse payroll' : 'لا تملك صلاحية صرف الرواتب');
        return;
      }
      const targetMonth = batch.month;
      openReleasePayrollModal({
        batch,
        companies,
        settings,
        onConfirm: () => {
          // Settle the loan/advance installments withheld in this payroll run
          // so advances are never deducted forever and close when fully paid.
          try {
            const allLoans = storage.getState().loans;
            let changed = false;
            batch.items.forEach((it) => {
              const installment = Number(it.loanInstallment) || 0;
              if (installment <= 0) return;
              const loan = allLoans.find((l) => l.employeeId === it.employeeId && l.status !== 'settled' && Number(l.remainingAmount) > 0);
              if (!loan) return;
              const paidAmount = Math.min(installment, Number(loan.remainingAmount) || 0);
              if (paidAmount <= 0) return;
              loan.installments = loan.installments || [];
              const scheduleEntry = loan.installments.find((x) => x.month === targetMonth && !x.isPaid);
              if (scheduleEntry) {
                scheduleEntry.isPaid = true;
                scheduleEntry.paidAt = new Date().toISOString();
              } else {
                loan.installments.push({ month: targetMonth, amount: paidAmount, isPaid: true, paidAt: new Date().toISOString() });
              }
              loan.remainingAmount = Number((Number(loan.remainingAmount) - paidAmount).toFixed(2));
              if (loan.remainingAmount <= 0) {
                loan.remainingAmount = 0;
                loan.status = 'settled';
                loan.settledAt = new Date().toISOString();
              }
              changed = true;
            });
            if (changed) storage.saveLoans(allLoans);
          } catch (e) {
            console.error('Loan settlement on payroll release failed:', e);
          }
          // Phase 2 (Spec v1.0): payment runs ONLY through the guard stack —
          // Payments Officer (payroll.disburse) + approved state + scope.
          const payerName = storage.getActiveUser()?.name || (isEn ? 'Payments Officer' : 'موظف الصرف المالي');
          const payRes = transitionPayrollGuarded(storage.getActiveUser(), batch, 'paid', { by: payerName, context: getPayrollBranchContext() });
          if (!payRes.ok) {
            toast.error(isEn ? `Cannot execute payment: ${payRes.error}` : `تعذر تنفيذ الصرف: ${payRes.error}`);
            return;
          }
          const paid = payRes.batch;
          paid.releasedAt = new Date().toISOString();
          paid.releasedBy = payerName;
          paid.items.forEach((it) => { it.isPaid = true; });
          storage.addPayrollBatch(paid);
          storage.addAudit('settle', 'payroll', `${targetMonth} → ${isEn ? 'released & paid' : 'تحرير وصرف'}`, paid.id);
          toast.success(tf('payroll.paymentRecordedSuccess', { month: targetMonth }));
          activeTab = 'disbursed';
          updateHeaderTabs();
          renderTabContent();
        },
      });
    };

    // =========================================================
    // 1. ACTIVE & DUE PAYROLLS TAB
    // =========================================================
    if (activeTab === 'payroll') {
      // No batch for this month (not due yet / no employees) — show a notice
      // with a month picker instead of crashing on undefined.status below.
      if (!currentBatch) {
        contentArea.innerHTML = `
          <div class="card" style="margin-bottom:20px; padding:18px 24px; background:var(--bg-card-hover);">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
              <div>
                <h3 style="font-size:18px; font-weight:800; color:var(--text-main);">${t('payroll.monthlyPayroll')}</h3>
                <p style="font-size:12.5px; color:var(--text-muted); margin-top:2px;">${t('payroll.monthlyPayrollSubtitle')}</p>
              </div>
              <div style="display:flex; align-items:center; gap:6px;">
                <label style="font-size:13px; font-weight:700; color:var(--text-muted);">${t('payroll.month')}</label>
                <input type="month" class="form-input" id="payroll-month-selector-empty" value="${currentMonth}" style="width:160px; padding:6px 10px;">
              </div>
            </div>
          </div>

          <div class="alert-box alert-warning" style="margin-bottom:20px; padding:16px 20px; border-radius:8px;">
            <strong>📅 ${isEn ? `No payroll batch for ${currentMonth} yet` : `لا يوجد مسير رواتب لشهر ${currentMonth} بعد`}</strong>
            <div style="font-size:12.5px; color:var(--text-muted); margin-top:4px;">
              ${isEn
                ? `Month ${currentMonth} has no payroll batch (it is not due yet or has no employees). Pick a due month.`
                : `شهر ${currentMonth} لا يحتوي على مسير رواتب (إما أنه غير مستحق بعد أو لا يوجد فيه موظفون). اختر شهراً مستحق الصرف.`}
            </div>
          </div>
        `;
        contentArea.querySelector('#payroll-month-selector-empty')?.addEventListener('change', (e) => {
          currentMonth = e.target.value;
          currentBatch = getLivePayrolls().find((b) => b.month === currentMonth);
          if (!currentBatch && isMonthAvailable(currentMonth)) {
            currentBatch = generateMonthlyPayroll(employees, overtime, loans, attendance, { month: currentMonth, adjustments: increments, companies }, settings);
            computePayrollReleaseSchedule(currentBatch, companies);
          }
          renderTabContent();
        });
        return;
      }

      // Payroll for this month is not due yet (before payday) — show notice
      // instead of generating/editing it.
      if (!isMonthAvailable(currentMonth)) {
        contentArea.innerHTML = `
          <div class="card" style="margin-bottom:20px; padding:18px 24px; background:var(--bg-card-hover);">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
              <div>
                <h3 style="font-size:18px; font-weight:800; color:var(--text-main);">${t('payroll.monthlyPayroll')}</h3>
                <p style="font-size:12.5px; color:var(--text-muted); margin-top:2px;">${t('payroll.monthlyPayrollSubtitle')}</p>
              </div>
              <div style="display:flex; align-items:center; gap:6px;">
                <label style="font-size:13px; font-weight:700; color:var(--text-muted);">${t('payroll.month')}</label>
                <input type="month" class="form-input" id="payroll-month-selector-notdue" value="${currentMonth}" style="width:160px; padding:6px 10px;">
              </div>
            </div>
          </div>

          <div class="alert-box alert-warning" style="margin-bottom:20px; padding:20px 24px; border-radius:8px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.35);">
            <div style="display:flex; align-items:flex-start; gap:12px;">
              <div style="font-size:26px; line-height:1;">📅</div>
              <div style="flex:1;">
                <strong style="font-size:14.5px; color:var(--text-main);">${isEn ? 'This months payroll is not available yet' : 'مسير رواتب هذا الشهر غير متاح بعد'}</strong>
                <div style="font-size:12.5px; color:var(--text-muted); margin-top:6px; line-height:1.7;">
                  ${isEn
                    ? `The payroll for <strong>${currentMonth}</strong> will open automatically on the payday (<strong>day ${defaultPayDay()}</strong>) as set in the branch settings. It cannot be prepared, recalculated or forwarded to the financial audit before its release date.`
                    : `مسير رواتب <strong>${currentMonth}</strong> سيظهر تلقائياً في يوم الصرف (<strong>يوم ${defaultPayDay()}</strong>) حسب إعداد الفرع. لا يمكن إعداده أو إعادة حسابه أو ترحيله إلى التدقيق المالي قبل موعد الاستحقاق.`}
                </div>
                <div style="margin-top:12px;">
                  <button type="button" class="btn btn-outline btn-sm" id="btn-go-last-due-month">
                    ⏪ ${isEn ? 'Open the latest due month' : 'فتح أحدث شهر مستحق'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;

        contentArea.querySelector('#payroll-month-selector-notdue')?.addEventListener('change', (e) => {
          currentMonth = e.target.value;
          const ctx = getPayrollBranchContext();
          currentBatch = livePayrolls.find((b) => b.month === currentMonth && b.companyId === ctx.companyId && b.branchId === ctx.branchId);
          if (!currentBatch && isMonthAvailable(currentMonth)) {
            currentBatch = generateMonthlyPayroll(employees, overtime, loans, attendance, { month: currentMonth, adjustments: increments, companies }, settings);
            currentBatch.companyId = ctx.companyId;
            currentBatch.branchId = ctx.branchId;
            computePayrollReleaseSchedule(currentBatch, companies);
          }
          renderTabContent();
        });

        contentArea.querySelector('#btn-go-last-due-month')?.addEventListener('click', () => {
          currentMonth = defaultPayMonth();
          const ctx = getPayrollBranchContext();
          currentBatch = livePayrolls.find((b) => b.month === currentMonth && b.companyId === ctx.companyId && b.branchId === ctx.branchId);
          if (!currentBatch && isMonthAvailable(currentMonth)) {
            currentBatch = generateMonthlyPayroll(employees, overtime, loans, attendance, { month: currentMonth, adjustments: increments, companies }, settings);
            currentBatch.companyId = ctx.companyId;
            currentBatch.branchId = ctx.branchId;
            computePayrollReleaseSchedule(currentBatch, companies);
          }
          renderTabContent();
        });
        return;
      }

      // Payroll transferred to audit or already approved is NOT part of the
      // active prep list anymore — it lives in the Financial Audit tab. Show a
      // compact shortcut instead of the full editable screen so a reviewed
      // payroll stops appearing in the active payroll records.
      if (isUnderAudit || isApproved) {
        contentArea.innerHTML = `
          <div class="card" style="margin-bottom:20px; padding:18px 24px; background:var(--bg-card-hover);">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
              <div>
                <h3 style="font-size:18px; font-weight:800; color:var(--text-main);">${currentBatch.title}</h3>
                <span class="badge ${isApproved ? 'badge-success' : 'badge-info'}">
                  ${isApproved ? (isEn ? '✅ Audit Approved' : '✅ معتمد من التدقيق') : (isEn ? '⏳ Under Financial Audit' : '⏳ قيد التدقيق المالي')}
                </span>
                <p style="font-size:12.5px; color:var(--text-muted); margin-top:6px; line-height:1.7;">
                  ${isApproved
                    ? (isEn ? `Approved on ${formatDate(currentBatch.auditedAt)} by ${currentBatch.auditedBy || 'Auditor'}. It was removed from the active payroll list and can only be revised through the Financial Audit tab.` : `تم اعتماد المسير بتاريخ ${formatDate(currentBatch.auditedAt)} بواسطة ${currentBatch.auditedBy || 'المدقق المالي'} وقد أُزيل من قائمة الرواتب النشطة. لا يمكن مراجعته إلا من تبويب التدقيق المالي.`)
                    : (isEn ? `Transferred to Financial Audit on ${formatDate(currentBatch.transferredToAuditAt)}. Editing is locked; it was removed from the active payroll list.` : `تم ترحيل المسير إلى التدقيق المالي بتاريخ ${formatDate(currentBatch.transferredToAuditAt)}. التعديل مغلق وأُزيل من قائمة الرواتب النشطة.`)}
                </p>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                ${isApproved && canDisburse ? `
                <button type="button" class="btn btn-success btn-sm" id="btn-pay-salary-shortcut">
                  💰 ${isEn ? 'Pay Salary' : 'صرف الراتب'}
                </button>
                ` : ''}
                <input type="month" class="form-input" id="payroll-month-selector" value="${currentMonth}" style="width:160px; padding:6px 10px;">
                <button type="button" class="btn btn-info btn-sm" id="btn-go-to-audit">
                  🛡️ ${isEn ? 'Open Financial Audit' : 'فتح شاشة التدقيق المالي'}
                </button>
              </div>
            </div>
          </div>
        `;

        contentArea.querySelector('#payroll-month-selector')?.addEventListener('change', (e) => {
          currentMonth = e.target.value;
          const ctx = getPayrollBranchContext();
          currentBatch = livePayrolls.find((b) => b.month === currentMonth && b.companyId === ctx.companyId && b.branchId === ctx.branchId);
          if (!currentBatch && isMonthAvailable(currentMonth)) {
            currentBatch = generateMonthlyPayroll(employees, overtime, loans, attendance, { month: currentMonth, adjustments: increments, companies }, settings);
            currentBatch.companyId = ctx.companyId;
            currentBatch.branchId = ctx.branchId;
            computePayrollReleaseSchedule(currentBatch, companies);
          }
          renderTabContent();
        });
        contentArea.querySelector('#btn-go-to-audit')?.addEventListener('click', () => {
          activeTab = 'audit';
          updateHeaderTabs();
          renderTabContent();
        });
        contentArea.querySelector('#btn-pay-salary-shortcut')?.addEventListener('click', () => {
          disburseBatch(currentBatch);
        });
        return;
      }

      contentArea.innerHTML = `
        <!-- Payroll Month & Batch Header Card -->
        <div class="card" style="margin-bottom:20px; padding:18px 24px; background:linear-gradient(135deg, rgba(79, 70, 229, 0.06) 0%, rgba(16, 185, 129, 0.06) 100%); border-color:rgba(99, 102, 241, 0.2);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
              <div style="display:flex; align-items:center; gap:10px;">
                <h3 style="font-size:18px; font-weight:800; color:var(--text-main);">${currentBatch.title}</h3>
                <span class="badge ${isPaid ? 'badge-success' : isApproved ? 'badge-success' : isUnderAudit ? 'badge-info' : 'badge-warning'}">
                  ${isPaid ? (isEn ? 'Paid & Disbursed' : 'تم الصرف بنجاح') : isApproved ? (isEn ? 'Audit Approved 🔒' : 'معتمد من التدقيق 🔒') : isUnderAudit ? (isEn ? 'Under Financial Audit 🔒' : 'قيد التدقيق المالي 🔒') : (isEn ? 'Draft (Editable)' : 'مسودة قابلة للتعديل')}
                </span>
              </div>
              <p style="font-size:12.5px; color:var(--text-muted); margin-top:2px;">
                ${tf('payroll.batchSummary', { count: currentBatch.employeesCount, date: formatDate(currentBatch.issueDate) })}
              </p>
              ${
                isReleased || isPaid
                  ? `<div style="display:inline-flex; align-items:center; gap:6px; margin-top:6px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.35); padding:5px 12px; border-radius:8px; font-size:12px; font-weight:800; color:var(--success);">
                      ✅ ${isEn ? 'Released on' : 'تم التحرير رسمياً بتاريخ'}: ${formatDate(currentBatch.releasedAt || currentBatch.paidAt)} ${isEn ? 'by' : 'بواسطة'} ${currentBatch.releasedBy || currentBatch.paidBy || (isEn ? 'Finance Manager' : 'المدير المالي')}
                    </div>`
                  : currentBatch.releaseDate
                    ? `<div style="display:inline-flex; align-items:center; gap:6px; margin-top:6px; background:rgba(79,70,229,0.08); border:1px solid rgba(79,70,229,0.25); padding:5px 12px; border-radius:8px; font-size:12px; font-weight:800; color:var(--primary);">
                        📅 ${isEn ? 'Scheduled release (payday)' : 'موعد تحرير الرواتب (يوم الصرف)'}: <span style="direction:ltr; unicode-bidi:embed;">${currentBatch.releaseDate}</span> • ${isEn ? 'day' : 'يوم'} ${currentBatch.releasePayDay || 25} ${isEn ? 'of each month (branch setting)' : 'من كل شهر (حسب إعداد الفرع)'}
                      </div>`
                    : ''
              }
            </div>

            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <div style="display:flex; align-items:center; gap:6px;">
                <label style="font-size:13px; font-weight:700; color:var(--text-muted);">${t('payroll.month')}</label>
                <input type="month" class="form-input" id="payroll-month-selector" value="${currentMonth}" style="width:160px; padding:6px 10px;">
              </div>

              ${isDraft && canManagePayroll ? `
              <button type="button" class="btn btn-outline btn-sm" id="btn-recalc-payroll">
                ${Icons.refresh(14)} ${t('payroll.recalculate')}
              </button>
              ` : ''}

              <button type="button" class="btn btn-primary btn-sm" id="btn-print-all-payslips">
                ${Icons.printer(14)} ${t('payroll.printAllPayslips')}
              </button>
              ${canExportPayroll ? `
                <button type="button" class="btn btn-outline btn-sm" id="btn-export-wps">
                  ${Icons.download(14)} ${t('payroll.wpsFile')}
                </button>
              ` : ''}
            </div>
          </div>
        </div>

        ${currentBatch.isAmountsCleared && isDraft ? `
        <div class="alert-box" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.35); padding:14px 18px; border-radius:8px;">
          <div>
            <strong style="color:#dc2626; font-size:14px;">🧹 ${isEn ? 'Amounts Cleared (legacy) — this payroll was rejected by an earlier version.' : 'تم تفريغ المبالغ (قديم) — رفضت نسخة سابقة هذا المسير.'}</strong>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px; line-height:1.6;">
              ${isEn
                ? `Legacy rejection data from before Spec v1.0: amounts were reset to zero. Press <strong>Recalculate</strong> to regenerate the figures, then transfer the batch back to Financial Audit.`
                : `بيانات رفض قديمة من قبل مواصفة v1.0: صُفّرت المبالغ. اضغط <strong>إعادة الاحتساب</strong> لتوليد الأرقام، ثم أعد ترحيل المسير إلى التدقيق.`}
            </div>
            ${currentBatch.rejectedBy ? `<div style="font-size:11.5px; margin-top:4px; color:var(--text-muted);">${isEn ? 'Rejected by' : 'رفضه'}: <strong>${currentBatch.rejectedBy}</strong> • ${formatDate(currentBatch.rejectedAt)}</div>` : ''}
          </div>
          ${canManagePayroll ? `
          <button type="button" class="btn btn-sm btn-danger" id="btn-recalc-cleared">
            ${Icons.refresh(14)} ${t('payroll.recalculate')}
          </button>
          ` : ''}
        </div>
        ` : ''}

        ${isReturned ? `
        <div class="alert-box" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.35); padding:14px 18px; border-radius:8px;">
          <div>
            <strong style="color:#dc2626; font-size:14px;">🔁 ${isEn ? 'Returned / Needs Correction — Financial Audit returned this payroll.' : 'عودة / بحاجة تصحيح — أُعيد هذا المسير من التدقيق المالي.'}</strong>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px; line-height:1.6;">
              ${isEn
                ? `All amounts are PRESERVED (nothing was zeroed). Review the rejection reason below, correct the payroll, then press <strong>Resubmit</strong> to send it back to Financial Audit.`
                : `جميع المبالغ محفوظة (لم يُصفَّر شيء). راجع سبب الرفض أدناه، صحّح المسير، ثم اضغط <strong>إعادة الإرسال</strong> لإعادته إلى التدقيق المالي.`}
            </div>
            ${currentBatch.rejectionReason ? `<div style="font-size:12px; margin-top:4px; background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.2); padding:6px 10px; border-radius:6px; color:var(--text-main);">${isEn ? 'Rejection reason' : 'سبب الرفض'}: <strong>${currentBatch.rejectionReason}</strong></div>` : ''}
            ${currentBatch.rejectedBy ? `<div style="font-size:11.5px; margin-top:4px; color:var(--text-muted);">${isEn ? 'Returned by' : 'أعاده'}: <strong>${currentBatch.rejectedBy}</strong> • ${formatDate(currentBatch.rejectedAt)}</div>` : ''}
            ${currentBatch.corrections && currentBatch.corrections.length ? `<div style="font-size:11.5px; margin-top:4px; color:var(--text-muted);">✏️ ${isEn ? 'Corrections recorded' : 'تصحيحات مسجلة'}: <strong>${currentBatch.corrections.length}</strong> (${formatDate(currentBatch.corrections[currentBatch.corrections.length - 1].at)})</div>` : ''}
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            ${canManagePayroll ? `
            <button type="button" class="btn btn-sm btn-warning" id="btn-recalc-returned">
              ${Icons.refresh(14)} ${isEn ? 'Recalculate & Record Correction' : 'إعادة الاحتساب وتسجيل التصحيح'}
            </button>
            ` : ''}
            ${canSubmitAudit ? `
            <button type="button" class="btn btn-sm btn-success" id="btn-resubmit-payroll">
              ${Icons.upload(14)} ${isEn ? 'Resubmit to Financial Audit' : 'إعادة الإرسال للتدقيق المالي'}
            </button>
            ` : ''}
          </div>
        </div>
        ` : ''}

        <!-- Status Alerts / Audit Banner -->
        ${isUnderAudit ? `
        <div class="alert-box alert-info" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; background:rgba(6,182,212,0.1); border:1px solid rgba(6,182,212,0.3); padding:14px 18px; border-radius:8px;">
          <div>
            <strong style="color:#0284c7; font-size:14px;">🛡️ ${isEn ? 'This payroll is currently undergoing Financial Audit.' : 'هذا المسير محال حالياً إلى قسم التدقيق والمراجعة المالية.'}</strong>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
              ${isEn ? 'Editing is locked during audit. Auditor reviews per-employee notes and approves or returns for amendments.' : 'التعديل مغلق ومحمي أثناء مرحلة التدقيق. يتم فحص بنود كل موظف واعتماد المسير أو إرجاعه بملاحظات للتعديل.'}
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-info" id="btn-go-to-audit">
            ${isEn ? 'Open Audit Screen' : 'فتح شاشة التدقيق المالي'}
          </button>
        </div>
        ` : ''}

        ${isApproved && !isPaid ? `
        <div class="alert-box alert-success" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); padding:14px 18px; border-radius:8px;">
          <div>
            <strong style="color:#059669; font-size:14px;">✅ ${isEn ? 'Audit Approved! Payroll is locked and authorized for payment.' : 'تم اعتماد المسير بنجاح من التدقيق المالي وهو مؤمن وجاهز للصرف البنكي الآن.'}</strong>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
              ${isEn ? 'Audited by' : 'تم التدقيق بواسطة'}: <strong>${currentBatch.auditedBy || 'Auditor'}</strong> • ${formatDate(currentBatch.auditedAt)}
            </div>
          </div>
          ${canDisburse ? `
          <button type="button" class="btn btn-sm btn-success" id="btn-disburse-payroll-banner">
            💰 ${isEn ? 'Disburse Salaries Now' : 'صرف الرواتب الآن'}
          </button>
          ` : ''}
        </div>
        ` : ''}

        ${currentBatch.auditNotes && isEditable ? `
        <div class="alert-box alert-warning" style="margin-bottom:20px; padding:12px 16px; border-radius:8px;">
          <strong>⚠️ ${isEn ? 'Auditor Remarks / Return Notes:' : 'توجيهات وملاحظات قسم التدقيق المالي عند الإعادة:'}</strong>
          <div style="font-size:12.5px; margin-top:4px; color:var(--text-main);">${currentBatch.auditNotes}</div>
        </div>
        ` : ''}

        ${isPaid ? `
        <div class="alert-box alert-success" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
          <div>
            <strong>✅ ${isEn ? 'Salaries for this month have been disbursed.' : 'تم صرف رواتب هذا الشهر بنجاح ونقلها إلى سجل الرواتب المصروفة.'}</strong>
            <div style="font-size:12px; margin-top:2px;">${isEn ? 'Paid on' : 'تاريخ الصرف'}: ${formatDate(currentBatch.paidAt)} • ${isEn ? 'By' : 'بواسطة'}: ${currentBatch.paidBy || 'HR'}</div>
          </div>
          <button type="button" class="btn btn-sm btn-outline" id="btn-go-to-disbursed">
            ${isEn ? 'View in Disbursed List' : 'عرض في قائمة المصروفات'}
          </button>
        </div>
        ` : ''}

        ${isApproved && !isPaid && canDisburse && releaseDue ? `
        <div class="alert-box alert-success" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.4); padding:14px 18px; border-radius:8px;">
          <div>
            <strong style="color:#059669; font-size:14px;">💰 ${isEn ? `Payday ${currentBatch.releaseDate} — Salaries are ready for final release.` : `يوم الصرف ${currentBatch.releaseDate} — رواتب هذا الشهر جاهزة للتحرير النهائي.`}</strong>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
              ${isEn ? 'Review the net amounts below, then confirm the final release for everyone on the system.' : 'أجرِ المراجعة النهائية للمبالغ الصافية ثم أكّد التحرير النهائي ليصبح الرواتب متاحة للجميع.'}
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-success" id="btn-disburse-payroll-banner">
            💵 ${isEn ? 'Final Review & Release' : 'مراجعة نهائية وتحرير الرواتب'}
          </button>
        </div>
        ` : ''}

        <!-- Payroll Metrics Grid -->
        <div class="grid grid-cols-4" style="margin-bottom:20px;">
          <div class="card stat-card stat-primary">
            <div>
              <div class="stat-label">${t('payroll.totalGross')}</div>
              <div class="stat-value" style="font-size:15px; line-height:1.6;">${seg('gross')}</div>
              <div class="stat-sub">${t('payroll.basicAllowancesOvertime')}</div>
            </div>
            <div class="stat-icon-wrapper">${Icons.dollar(22)}</div>
          </div>

          <div class="card stat-card stat-danger">
            <div>
              <div class="stat-label">${t('payroll.totalDeductions')}</div>
              <div class="stat-value" style="font-size:15px; line-height:1.6; color:var(--danger);">${seg('deductions', '-')}</div>
              <div class="stat-sub">${isEn ? 'Advances, Insurance & Absences' : 'السلف، التأمينات والخصومات'}</div>
            </div>
            <div class="stat-icon-wrapper">${Icons.trendingUp(22)}</div>
          </div>

          <div class="card stat-card stat-success">
            <div>
              <div class="stat-label">${t('netPayrollTransferred')}</div>
              <div class="stat-value" style="font-size:15px; line-height:1.6; color:var(--success);">${seg('net')}</div>
              <div class="stat-sub">${t('payroll.netAmountBanks')}</div>
            </div>
            <div class="stat-icon-wrapper">${Icons.award(22)}</div>
          </div>

          <div class="card stat-card stat-info">
            <div>
              <div class="stat-label">${t('payroll.companyInsuranceContribution')}</div>
              <div class="stat-value" style="font-size:15px; line-height:1.6;">${seg('companyGosi')}</div>
              <div class="stat-sub">${t('payroll.gosiShare')}</div>
            </div>
            <div class="stat-icon-wrapper">${Icons.shieldCheck(22)}</div>
          </div>
        </div>

        <!-- Detailed Payroll Items Table — shown only for draft (prep) and paid (archive) batches.
             Audited/approved batches live in the Financial Audit tab and are excluded here. -->
        ${isEditable || isPaid ? `
        <div class="card" style="padding:0; overflow:hidden;">
          <div style="padding:14px 20px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
            <div style="font-weight:700; font-size:14px; color:var(--text-main);">
              ${tf('payroll.detailTitle', { month: currentMonth })}
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              ${isDraft && canSubmitAudit ? `
              <button type="button" class="btn btn-sm btn-info" id="btn-transfer-to-audit">
                🛡️ ${isEn ? 'Send to Financial Audit' : 'ترحيل إلى قسم التدقيق المالي'}
              </button>
              ` : ''}

              ${isApproved && !isPaid && canDisburse ? `
              <button type="button" class="btn btn-sm btn-success" id="btn-disburse-payroll">
                💰 ${isEn ? 'Disburse & Pay Salaries' : 'صرف الرواتب الآن'}
              </button>
              ` : ''}
            </div>
          </div>

          <div class="table-container" style="border:none; overflow-x:auto;">
            <table class="table" style="font-size:12.5px; white-space:nowrap;">
              <thead>
                <tr>
                  <th>${t('payroll.employee')}</th>
                  <th>${t('payroll.basicSalary')}</th>
                  <th>${t('payroll.housing')}</th>
                  <th>${t('payroll.transport')}</th>
                  <th>${t('payroll.overtime')}</th>
                  <th>${t('payroll.bonuses')}</th>
                  <th>${t('payroll.totalEarnings')}</th>
                  <th>${isEn ? 'Social Security & Insurance' : 'التأمينات الاجتماعية'}</th>
                  <th style="color:var(--warning);">${isEn ? 'Loan Advance' : 'قسط السلفة'}</th>
                  <th style="color:var(--danger);">${isEn ? 'Absences & Penalties' : 'الخصم والغياب'}</th>
                  <th>${t('payroll.netSalaryTransferred')}</th>
                  <th style="text-align:left;">${t('payroll.payslip')}</th>
                </tr>
              </thead>
              <tbody>
                ${
                  currentBatch.items.length === 0 && !isPaid
                    ? `<tr><td colspan="12" style="text-align:center; padding:30px; color:var(--text-muted);">${t('payroll.noActiveEmployees')}</td></tr>`
                    : currentBatch.items.length === 0 && isPaid
                      ? `<tr><td colspan="12" style="text-align:center; padding:30px; color:var(--text-muted);">
                          <div style="font-size:26px; margin-bottom:8px;">🗄️</div>
                          <strong>${isEn ? 'Archived Payroll (Summary Only)' : 'مسير مؤرشف (ملخص إجمالي)'}</strong>
                          <div style="font-size:12.5px; margin-top:6px; line-height:1.8;">
                            ${isEn
                              ? `This month was archived as a monthly summary (${currentBatch.employeesCount || 0} employee(s), total gross ${formatCurrency(currentBatch.totalGross, sym)}). Per-employee breakdown is not stored for pre-app archived months.`
                              : `تمت أرشفة هذا الشهر كملخص إجمالي (${currentBatch.employeesCount || 0} موظفاً، إجمالي الاستحقاق ${formatCurrency(currentBatch.totalGross, sym)}). لا توجد تفاصيل فردية مخزنة للأشهر المؤرشفة السابقة.`}
                          </div>
                          ${currentBatch.archiveNote ? `<div style="font-size:12px; margin-top:8px; color:var(--text-muted);">📝 ${currentBatch.archiveNote}</div>` : ''}
                        </td></tr>`
                      : currentBatch.items
                        .map((it) => {
                          const deductions = (it.absenceDeduction || 0) + (it.lateDeduction || 0) + (it.otherDeductions || 0) + (it.penaltiesDeduction || 0);
                          const cur = itCur(it);
                          const v = (amt) => formatAmountWithCode(amt, cur);
                          return `
                      <tr data-emp-id="${it.employeeId}">
                        <td>
                          <strong>${it.employeeName}</strong>
                          <div style="font-size:11px; color:var(--text-muted);">${it.employeeNumber} • ${it.department}</div>
                          <div style="font-size:11px; font-weight:700; color:var(--primary); margin-top:2px;">${isEn ? 'Salary' : 'راتب'} ${formatPayMonth(it.month || currentMonth)}</div>
                        </td>
                        <td>${v(it.basicSalary)}</td>
                        <td>${v(it.housingAllowance)}</td>
                        <td>${v(it.transportAllowance)}</td>
                        <td>
                          ${
                            it.overtimeAmount > 0
                              ? `<strong style="color:var(--primary);">+ ${v(it.overtimeAmount)}</strong>`
                              : `<span style="color:var(--text-muted);">-</span>`
                          }
                        </td>
                        <td>
                          ${
                            it.bonuses > 0
                              ? `<strong style="color:var(--success);">+ ${v(it.bonuses)}</strong>`
                              : `<span style="color:var(--text-muted);">-</span>`
                          }
                        </td>
                        <td><strong style="color:var(--text-main);">${v(it.grossSalary)}</strong></td>
                        <td><span style="color:var(--danger);">- ${v(it.gosiEmployeeDeduction)}</span></td>
                        <td>
                          ${
                            it.loanInstallment > 0
                              ? `<strong style="color:var(--warning);">- ${v(it.loanInstallment)}</strong>`
                              : `<span style="color:var(--text-muted);">-</span>`
                          }
                        </td>
                        <td>
                          ${
                            deductions > 0
                              ? `<strong style="color:var(--danger);">- ${v(deductions)}</strong>`
                              : `<span style="color:var(--text-muted);">-</span>`
                          }
                        </td>
                        <td>
                          <strong style="color:var(--success); font-size:14px;">${v(it.netSalary)}</strong>
                        </td>
                        <td>
                          <button type="button" class="btn btn-sm btn-outline btn-view-payslip">
                            ${Icons.printer(14)} ${t('payroll.payslip')}
                          </button>
                        </td>
                      </tr>
                    `;
                        })
                        .join('')
                }
              </tbody>
              <tfoot>
                <tr style="background:var(--bg-card-hover); font-weight:800;">
                  <td colspan="6">${isEn ? 'Total' : 'المجموع الإجمالي'}</td>
                  <td>${seg('gross')}</td>
                  <td style="color:var(--danger);">${segCol((x) => x.gosiEmployeeDeduction, '-')}</td>
                  <td style="color:var(--warning);">${segCol((x) => x.loanInstallment, '-')}</td>
                  <td style="color:var(--danger);">${segCol((x) => (x.absenceDeduction || 0) + (x.lateDeduction || 0) + (x.otherDeductions || 0) + (x.penaltiesDeduction || 0), '-')}</td>
                  <td style="color:var(--success); font-size:15px;">${seg('net')}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        ` : `
        <!-- Audited / approved batches are locked and managed from the Financial Audit tab only. -->
        <div class="card" style="margin-bottom:20px; padding:22px 24px; text-align:center; background:var(--bg-card-hover);">
          <div style="font-size:28px;">${isUnderAudit ? '🛡️' : '✅'}</div>
          <div style="font-weight:800; font-size:15px; color:var(--text-main); margin-top:8px;">
            ${isUnderAudit
              ? (isEn ? 'Payroll transferred to Financial Audit' : 'تم ترحيل المسير إلى التدقيق المالي')
              : (isEn ? 'Payroll approved by Financial Audit' : 'تم اعتماد المسير من التدقيق المالي')}
          </div>
          <div style="font-size:12.5px; color:var(--text-muted); margin-top:6px; max-width:560px; margin-left:auto; margin-right:auto; line-height:1.8;">
            ${isUnderAudit
              ? (isEn ? 'Editing is locked while the payroll is under audit. Review per-employee notes and approve or return it from the Financial Audit tab.'
                     : 'المسير محال للتدقيق المالي والتعديل مغلق عليه. يتم فحص بنود الموظفين واعتماده أو إعادته للتعديل من تبويب التدقيق والمراجعة المالية.')
              : (isEn ? 'The approved payroll is locked and was removed from the active list. It can only be cancelled, revised or re-audited through the Financial Audit tab.'
                     : 'المسير معتمد من التدقيق ومقفل وقد أُزيل من القائمة النشطة. لا يمكن إلغاؤه أو تعديله إلا من خلال تبويب التدقيق والمراجعة المالية.')}
          </div>
          <div style="margin-top:14px;">
            <button type="button" class="btn btn-outline btn-sm" id="btn-open-audit-from-locked">
              🛡️ ${isEn ? 'Open Financial Audit' : 'فتح شاشة التدقيق المالي'}
            </button>
          </div>
        </div>
        `}
      `;

      // Event handlers
      contentArea.querySelector('#payroll-month-selector')?.addEventListener('change', (e) => {
        currentMonth = e.target.value;
        const ctx = getPayrollBranchContext();
        currentBatch = livePayrolls.find((b) => b.month === currentMonth && b.companyId === ctx.companyId && b.branchId === ctx.branchId);
        if (!currentBatch && isMonthAvailable(currentMonth)) {
          currentBatch = generateMonthlyPayroll(employees, overtime, loans, attendance, { month: currentMonth, adjustments: increments, companies }, settings);
          currentBatch.companyId = ctx.companyId;
          currentBatch.branchId = ctx.branchId;
          computePayrollReleaseSchedule(currentBatch, companies);
        } else if (!currentBatch && !isMonthAvailable(currentMonth)) {
          toast.warning(isEn ? `Payroll for ${currentMonth} is not due yet (payday day ${defaultPayDay()}).` : `مسير رواتب ${currentMonth} غير مستحق بعد (يوم الصرف ${defaultPayDay()}).`);
          renderTabContent();
          return;
        }
        renderTabContent();
      });

      contentArea.querySelectorAll('#btn-recalc-payroll, #btn-recalc-cleared, #btn-recalc-returned').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!canManagePayroll) return;
          if (!isMonthAvailable(currentMonth)) {
            toast.warning(isEn ? `Payroll for ${currentMonth} is not due yet (payday day ${defaultPayDay()}).` : `مسير رواتب ${currentMonth} غير مستحق بعد (يوم الصرف ${defaultPayDay()}).`);
            return;
          }
          const prev = currentBatch;
          const regenerated = generateMonthlyPayroll(employees, overtime, loans, attendance, { month: currentMonth, adjustments: increments, companies }, settings);
          computePayrollReleaseSchedule(regenerated, companies);
          if (prev && prev.status === 'rejected') {
            // Preserve the Returned state + rejection metadata + record a correction on recalc.
            const actor = storage.getActiveUser()?.name || (isEn ? 'Payroll Admin' : 'مسؤول الرواتب');
            const corr = recordPayrollCorrectionGuarded(state.currentUser, prev, regenerated, {
              by: actor,
              context: getPayrollBranchContext(),
              reason: isEn ? 'Recalculated after audit return' : 'إعادة احتساب بعد إعادة التدقيق',
            });
            // A denial must NEVER fall back to a plain draft save: that would
            // overwrite the Returned record, destroy its rejection history and
            // bypass the permission/scope guard. Abort and alert instead.
            if (!corr.ok) {
              toast.error(isEn ? `Cannot record correction: ${corr.error}` : `تعذر تسجيل التصحيح: ${corr.error}`);
              renderTabContent();
              return;
            }
            currentBatch = corr.batch;
          } else {
            currentBatch = regenerated;
          }
          storage.addPayrollBatch(currentBatch);
          toast.success(tf('payroll.recalculatedSuccess', { month: currentMonth }));
          renderTabContent();
        });
      });

      contentArea.querySelector('#btn-print-all-payslips')?.addEventListener('click', () => {
        if (!currentBatch.items || currentBatch.items.length === 0) {
          toast.error(t('payroll.noEmployeesToPrint'));
          return;
        }
        openBatchPayslipsPrintModal(currentBatch, settings, null, companies);
      });

      contentArea.querySelector('#btn-export-wps')?.addEventListener('click', () => {
        if (!canExportPayroll) return;
        const wpsContent = generateBankPayrollFile(currentBatch, settings);
        const blob = new Blob(['\uFEFF' + wpsContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Bank_Payroll_${currentMonth}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        storage.addAudit('export', 'payroll', `${currentMonth} — ${t('payroll.wpsFile')}`, currentBatch.id);
        toast.success(t('payroll.wpsExported'));
      });

      // Transfer to Audit (draft → under_audit) or Resubmit (rejected → under_audit)
      const submitToAudit = (rejectionNote) => {
        if (!canSubmitAudit) {
          toast.error(isEn ? 'Insufficient permissions to submit payroll to Financial Audit.' : 'لا تملك صلاحية ترحيل المسير إلى التدقيق المالي.');
          return;
        }
        const res = transitionPayrollGuarded(state.currentUser, currentBatch, 'under_audit', {
          by: storage.getActiveUser()?.name || (isEn ? 'Payroll Admin' : 'مسؤول الرواتب'),
          context: getPayrollBranchContext(),
          rejectionReason: rejectionNote,
        });
        if (!res.ok) {
          toast.error(isEn ? `Cannot transfer: ${res.error}` : `تعذر الترحيل: ${res.error}`);
          return;
        }
        currentBatch = res.batch;
        storage.addPayrollBatch(currentBatch);
        const isReturnedNow = res.batch.returnState === 'resubmitted';
        storage.addAudit(isReturnedNow ? 'resubmit' : 'generate', 'payroll', `${currentMonth} → ${isEn ? (isReturnedNow ? 'Re-submitted to Financial Audit' : 'Financial Audit') : (isReturnedNow ? 'أُعيد إرساله للتدقيق المالي' : 'التدقيق المالي')}`, currentBatch.id);
        toast.success(isEn ? (isReturnedNow ? `Payroll for ${currentMonth} re-submitted to Financial Audit.` : `Payroll for ${currentMonth} transferred to Financial Audit.`) : (isReturnedNow ? `أُعيد إرسال مسير رواتب ${currentMonth} للتدقيق المالي.` : `تم ترحيل مسير رواتب ${currentMonth} إلى قسم التدقيق المالي بنجاح`));
        // The submitter only goes to the audit stage when they may review it;
        // otherwise they return to the locked batch on the payroll tab.
        activeTab = canReviewAudit ? 'audit' : 'payroll';
        updateHeaderTabs();
        renderTabContent();
      };
      contentArea.querySelector('#btn-transfer-to-audit')?.addEventListener('click', () => submitToAudit());
      contentArea.querySelector('#btn-resubmit-payroll')?.addEventListener('click', () => submitToAudit(isEn ? 'Re-submitted after correction' : 'أُعيد إرساله بعد التصحيح'));

      // Go to audit shortcut
      contentArea.querySelector('#btn-go-to-audit')?.addEventListener('click', () => {
        activeTab = 'audit';
        updateHeaderTabs();
        renderTabContent();
      });

      // Open audit from the locked (transferred/approved) payroll card
      contentArea.querySelector('#btn-open-audit-from-locked')?.addEventListener('click', () => {
        activeTab = 'audit';
        updateHeaderTabs();
        renderTabContent();
      });

      // Go to disbursed shortcut
      contentArea.querySelector('#btn-go-to-disbursed')?.addEventListener('click', () => {
        activeTab = 'disbursed';
        updateHeaderTabs();
        renderTabContent();
      });

      const triggerDisburse = () => disburseBatch(currentBatch);

      contentArea.querySelector('#btn-disburse-payroll')?.addEventListener('click', triggerDisburse);
      contentArea.querySelector('#btn-disburse-payroll-banner')?.addEventListener('click', triggerDisburse);

      // Payslip Buttons
      contentArea.querySelectorAll('tr').forEach((row) => {
        const empId = row.getAttribute('data-emp-id');
        const emp = employees.find((e) => e.id === empId);
        row.querySelector('.btn-view-payslip')?.addEventListener('click', () => {
          if (emp) openPayslipModal(emp, currentMonth);
        });
      });

    // =========================================================
    // 2. AUDIT & FINANCIAL REVIEW STAGE TAB (Requirement 2 & 3)
    // =========================================================
    } else if (activeTab === 'audit') {
      if (!currentBatch) {
        contentArea.innerHTML = `
          <div class="alert-box alert-warning" style="margin-bottom:20px; padding:16px 20px; border-radius:8px;">
            <strong>📅 ${isEn ? 'No payroll batch for this month yet' : 'لا يوجد مسير رواتب لهذا الشهر بعد'}</strong>
            <div style="font-size:12.5px; color:var(--text-muted); margin-top:4px;">
              ${isEn ? `Month ${currentMonth} has no payroll to audit (it is either not due yet or was not generated). Pick a due month.` : `شهر ${currentMonth} لا يحتوي على مسير للتدقيق (إما أنه غير مستحق بعد أو لم يُنشأ). اختر شهراً مستحق الصرف.`}
            </div>
            <div style="margin-top:10px; display:inline-flex; align-items:center; gap:8px;">
              <input type="month" class="form-input" id="audit-month-selector" value="${currentMonth}" style="width:160px; padding:6px 10px;">
            </div>
          </div>
        `;
        contentArea.querySelector('#audit-month-selector')?.addEventListener('change', (e) => {
          currentMonth = e.target.value;
          const ctx = getPayrollBranchContext();
          currentBatch = livePayrolls.find((b) => b.month === currentMonth && b.companyId === ctx.companyId && b.branchId === ctx.branchId);
          if (!currentBatch && isMonthAvailable(currentMonth)) {
            currentBatch = generateMonthlyPayroll(employees, overtime, loans, attendance, { month: currentMonth, adjustments: increments, companies }, settings);
            currentBatch.companyId = ctx.companyId;
            currentBatch.branchId = ctx.branchId;
            computePayrollReleaseSchedule(currentBatch, companies);
          }
          renderTabContent();
        });
        return;
      }
      const selectedAuditBatch = currentBatch;

      contentArea.innerHTML = `
        <div class="card" style="margin-bottom:20px; padding:20px; background:linear-gradient(135deg, rgba(6,182,212,0.06) 0%, rgba(79,70,229,0.06) 100%); border:1px solid var(--border-color);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="badge badge-info" style="font-size:12px;">🛡️ ${isEn ? 'Financial Audit & Quality Assurance' : 'قسم التدقيق والمراجعة المالية'}</span>
                <h3 style="font-size:18px; font-weight:800; color:var(--text-main);">${isEn ? 'Payroll Audit Stage' : 'مراجعة وتدقيق مسير الرواتب'} (${selectedAuditBatch.month})</h3>
              </div>
              <p style="font-size:12.5px; color:var(--text-muted); margin-top:4px;">
                ${isEn ? 'Auditor inspects allowances, overtime, advances, and absences for each employee, records remarks, and issues approval.' : 'يقوم المدقق المالي بفحص كافة بنود الرواتب، السلف، والخصومات، وكتابة ملاحظات التدقيق لكل موظف قبل منح الاعتماد النهائي للصرف.'}
              </p>
            </div>

            <div style="display:flex; align-items:center; gap:10px;">
              <input type="month" class="form-input" id="audit-month-selector" value="${currentMonth}" style="width:150px; padding:6px 10px;">
              <span class="badge ${selectedAuditBatch.status === 'approved' ? 'badge-success' : selectedAuditBatch.status === 'rejected' ? 'badge-warning' : selectedAuditBatch.status === 'paid' ? 'badge-success' : 'badge-info'}" style="font-size:13px; padding:6px 12px;">
                ${selectedAuditBatch.status === 'approved' ? (isEn ? '✅ Audit Approved' : '✅ معتمد من التدقيق') : selectedAuditBatch.status === 'rejected' ? (isEn ? '🔁 Returned / Needs Correction' : '🔁 عودة / بحاجة تصحيح') : selectedAuditBatch.status === 'paid' ? (isEn ? '✅ Paid & Archived' : '✅ مصروف ومؤرشف') : (isEn ? '⏳ Under Review' : '⏳ قيد مراجعة التدقيق')}
              </span>
            </div>
          </div>
        </div>

        <!-- Audit Action Controls -->
        <div class="card" style="margin-bottom:20px; padding:20px;">
          <div style="font-weight:700; font-size:15px; margin-bottom:12px; color:var(--text-main); display:flex; justify-content:space-between; align-items:center;">
            <span>📝 ${isEn ? 'Audit Review Decision & General Remarks' : 'تقرير وملاحظات المدقق المالي العام:'}</span>
            <button type="button" class="btn btn-sm btn-outline" id="btn-save-audit-notes">
              ${Icons.check(14)} ${isEn ? 'Save Notes' : 'حفظ الملاحظات'}
            </button>
          </div>

          <div class="form-group">
            <label class="form-label">${isEn ? 'General Audit Report & Observations' : 'تقرير وتوجيهات التدقيق المالي العامة'}</label>
            <textarea class="form-textarea" id="audit-notes-input" placeholder="${isEn ? 'Enter audit findings, notes on discrepancies, or approval confirmation...' : 'اكتب ملاحظات وتقرير التدقيق المالي هنا، مثل: تم فحص ومطابقة كشف السلف وبصمات الغياب...'}" rows="2">${selectedAuditBatch.auditNotes || ''}</textarea>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:14px; flex-wrap:wrap;">
            ${selectedAuditBatch.status === 'under_audit' && canRejectAudit ? `
              <button type="button" class="btn btn-outline" id="btn-reject-audit" style="color:var(--danger); border-color:rgba(239,68,68,0.4);">
                ${Icons.x(16)} ${isEn ? 'Reject & Return for Correction' : 'رفض وإعادة للتصحيح'}
              </button>
            ` : ''}
            ${selectedAuditBatch.status === 'under_audit' && canApprove ? `
              <button type="button" class="btn btn-success" id="btn-approve-audit">
                ${Icons.check(16)} ${isEn ? 'Approve Audit (returns to HR for payment)' : 'موافقة التدقيق (يعود لمسؤول الرواتب للصرف)'}
              </button>
            ` : ''}
            ${selectedAuditBatch.status === 'rejected' ? `
              <span style="font-size:12px; color:var(--text-muted); max-width:420px; line-height:1.6;">
                ${isEn ? '📎 This payroll was returned to HR (Returned / Needs Correction). It must be corrected and re-submitted from the Payroll tab.' : '📎 أُعيد هذا المسير إلى مسؤول الرواتب (حالة عودة / بحاجة تصحيح). يجب تصحيحه وإعادة إرساله من تبويب الرواتب.'}
              </span>
            ` : selectedAuditBatch.status === 'paid' ? `
              <span style="font-size:12px; color:var(--text-muted);">
                ${isEn ? '✅ Paid & archived — read-only financial history.' : '✅ تم الصرف والأرشفة — سجل مالي للقراءة فقط.'}
              </span>
            ` : selectedAuditBatch.status === 'approved' ? `
              <span style="font-size:12px; color:var(--text-muted); max-width:420px; line-height:1.6;">
                ${isEn ? '🔒 Audit approved — awaiting disbursement by the Payments Officer (payment queue). No pay button here: payment is executed from the Payroll tab only.' : '🔒 اعتمد التدقيق المسير — بانتظار صرف موظف الصرف المالي (قائمة الصرف). لا يوجد زر صرف هنا: يتم الصرف حصرياً من تبويب الرواتب.'}
              </span>
            ` : ''}
          </div>
        </div>

        <!-- Detailed Audit Items Table with Per-Employee Audit Decision & Notes (Requirement 2) -->
        <div class="card" style="padding:0; overflow:hidden;">
          <div style="padding:14px 20px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:700; font-size:14px;">${isEn ? 'Per-Employee Audit Verification Table' : 'كشف التدقيق المالي وتدوين الملاحظات لكل موظف'}</span>
            <span style="font-size:12px; color:var(--text-muted);">${isEn ? 'Auditor determines verification status manually' : 'المدقق هو صاحب القرار في تحديد سلامة بيانات كل موظف'}</span>
          </div>

          <div class="table-container" style="border:none; overflow-x:auto;">
            <table class="table" style="font-size:12px; white-space:nowrap;">
              <thead>
                <tr>
                  <th>${t('payroll.employee')}</th>
                  <th>${t('payroll.basicSalary')}</th>
                  <th>${isEn ? 'Allowances' : 'البدلات'}</th>
                  <th>${t('payroll.overtime')}</th>
                  <th>${isEn ? 'Bonuses' : 'المكافآت'}</th>
                  <th>${isEn ? 'Insurance' : 'تأمينات'}</th>
                  <th style="color:var(--warning);">${isEn ? 'Loan Advance' : 'قسط السلفة'}</th>
                  <th style="color:var(--danger);">${isEn ? 'Absences/Penalties' : 'الخصم والجزاءات'}</th>
                  <th>${t('payroll.netSalaryTransferred')}</th>
                  <th style="min-width:140px;">${isEn ? 'Auditor Decision' : 'قرار التدقيق'}</th>
                  <th style="min-width:200px;">${isEn ? 'Auditor Notes for Employee' : 'ملاحظات التدقيق الخاصة بالموظف'}</th>
                </tr>
              </thead>
              <tbody>
                ${selectedAuditBatch.items.map((it, idx) => {
                  const cur = itCur(it);
                  const v = (amt) => formatAmountWithCode(amt, cur);
                  const abs = (it.absenceDeduction || 0) + (it.lateDeduction || 0) + (it.penaltiesDeduction || 0) + (it.otherDeductions || 0);
                  return `
                  <tr data-emp-index="${idx}">
                    <td>
                      <strong>${it.employeeName}</strong>
                      <div style="font-size:10.5px; color:var(--text-muted);">${it.employeeNumber}</div>
                    </td>
                    <td>${v(it.basicSalary)}</td>
                    <td>${v(it.housingAllowance + it.transportAllowance + it.otherAllowances)}</td>
                    <td>${it.overtimeAmount > 0 ? '+' + v(it.overtimeAmount) : '-'}</td>
                    <td>${it.bonuses > 0 ? '+' + v(it.bonuses) : '-'}</td>
                    <td style="color:var(--danger);">- ${v(it.gosiEmployeeDeduction)}</td>
                    <td style="color:var(--warning);">${it.loanInstallment > 0 ? '- ' + v(it.loanInstallment) : '-'}</td>
                    <td style="color:var(--danger);">${abs > 0 ? '- ' + v(abs) : '-'}</td>
                    <td><strong style="color:var(--success); font-size:13.5px;">${v(it.netSalary)}</strong></td>
                    <td>
                      <select class="form-select emp-audit-status" style="padding:4px 8px; font-size:11.5px; font-weight:700;">
                        <option value="pending" ${it.auditStatus === 'pending' ? 'selected' : ''}>⏳ ${isEn ? 'Pending Audit' : 'قيد الفحص'}</option>
                        <option value="verified" ${it.auditStatus === 'verified' ? 'selected' : ''}>✅ ${isEn ? 'Verified & Sound' : 'سليم ومعتمد'}</option>
                        <option value="has_note" ${it.auditStatus === 'has_note' ? 'selected' : ''}>⚠️ ${isEn ? 'Has Remarks' : 'به ملاحظة'}</option>
                        <option value="rejected" ${it.auditStatus === 'rejected' ? 'selected' : ''}>❌ ${isEn ? 'Rejected' : 'مرفوض للتعديل'}</option>
                      </select>
                    </td>
                    <td>
                      <input type="text" class="form-input emp-audit-note" value="${it.auditNotes || ''}" placeholder="${isEn ? 'Type remark...' : 'اكتب ملاحظة إن وجدت...'}" style="padding:4px 8px; font-size:11.5px; width:100%;">
                    </td>
                  </tr>
                `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      contentArea.querySelector('#audit-month-selector')?.addEventListener('change', (e) => {
        currentMonth = e.target.value;
        const ctx = getPayrollBranchContext();
        currentBatch = livePayrolls.find((b) => b.month === currentMonth && b.companyId === ctx.companyId && b.branchId === ctx.branchId);
        if (!currentBatch && isMonthAvailable(currentMonth)) {
          currentBatch = generateMonthlyPayroll(employees, overtime, loans, attendance, { month: currentMonth, adjustments: increments, companies }, settings);
          currentBatch.companyId = ctx.companyId;
          currentBatch.branchId = ctx.branchId;
          computePayrollReleaseSchedule(currentBatch, companies);
        } else if (!currentBatch && !isMonthAvailable(currentMonth)) {
          toast.warning(isEn ? `Payroll for ${currentMonth} is not due yet (payday day ${defaultPayDay()}).` : `مسير رواتب ${currentMonth} غير مستحق بعد (يوم الصرف ${defaultPayDay()}).`);
          renderTabContent();
          return;
        }
        renderTabContent();
      });

      // Function to save per-employee audit inputs
      const saveEmployeeAuditInputs = () => {
        const rows = contentArea.querySelectorAll('tbody tr');
        rows.forEach((row) => {
          const idx = Number(row.getAttribute('data-emp-index'));
          if (selectedAuditBatch.items[idx]) {
            const statusSelect = row.querySelector('.emp-audit-status');
            const noteInput = row.querySelector('.emp-audit-note');
            if (statusSelect) selectedAuditBatch.items[idx].auditStatus = statusSelect.value;
            if (noteInput) selectedAuditBatch.items[idx].auditNotes = noteInput.value;
          }
        });
        const notes = contentArea.querySelector('#audit-notes-input')?.value || '';
        selectedAuditBatch.auditNotes = notes;
        storage.addPayrollBatch(selectedAuditBatch);
      };

      contentArea.querySelector('#btn-save-audit-notes')?.addEventListener('click', () => {
        saveEmployeeAuditInputs();
        toast.success(isEn ? 'Audit notes saved successfully.' : 'تم حفظ ملاحظات التدقيق بنجاح');
      });

      contentArea.querySelector('#btn-approve-audit')?.addEventListener('click', () => {
        if (!canApprove) return;
        saveEmployeeAuditInputs();
        if (selectedAuditBatch.status !== 'under_audit') {
          toast.error(isEn ? 'Only batches under audit can be approved.' : 'لا يمكن اعتماد إلا المسيرات قيد التدقيق.');
          return;
        }
        const auditNote = contentArea.querySelector('#audit-notes-input')?.value || '';
        const res = transitionPayrollGuarded(state.currentUser, selectedAuditBatch, 'approved', { by: storage.getActiveUser()?.name || (isEn ? 'Audit Reviewer' : 'المدقق المالي'), context: getPayrollBranchContext(), rejectionReason: auditNote || (isEn ? 'approved for payment' : 'اعتماد للصرف') });
        if (!res.ok) {
          toast.error(isEn ? `Cannot approve: ${res.error}` : `تعذر الاعتماد: ${res.error}`);
          return;
        }
        storage.addPayrollBatch(res.batch);
        storage.addAudit('approve', 'payroll', `${selectedAuditBatch.month} → ${isEn ? 'audit approved (returns to HR for payment)' : 'اعتماد التدقيق (يعود لمسؤول الرواتب للصرف)'}`, selectedAuditBatch.id);
        toast.success(isEn ? 'Audit approved. Payroll returned to HR — press Pay Salary when ready.' : 'تم اعتماد التدقيق. أُعيد المسير لمسؤول الرواتب — اضغط صرف الراتب عند الجاهزية.');
        activeTab = 'payroll';
        updateHeaderTabs();
        renderTabContent();
      });

      contentArea.querySelector('#btn-reject-audit')?.addEventListener('click', () => {
        if (!canRejectAudit) return;
        if (selectedAuditBatch.status !== 'under_audit') {
          toast.error(isEn ? 'Only batches under audit can be rejected.' : 'لا يمكن رفض إلا المسيرات قيد التدقيق.');
          return;
        }
        showConfirmDialog({
          title: isEn ? 'Reject Audit Approval' : 'رفض اعتماد التدقيق',
          message: isEn
            ? `<strong>${selectedAuditBatch.month}</strong> — the payroll will be returned to HR as <strong>Returned / Needs Correction</strong>. All financial amounts are PRESERVED (never zeroed); only the rejection reason, auditor and history are attached. HR corrects the report and re-submits it.`
            : `<strong>${selectedAuditBatch.month}</strong> — سيُعاد المسير إلى مسؤول الرواتب بحالة <strong>عودة / بحاجة تصحيح</strong>. جميع المبالغ المالية محفوظة (لا تُصفّر أبداً)؛ يُرفق سبب الرفض والمدقق وسجل التدقيق فقط. يصحّح مسؤول الرواتب التقرير ثم يعيد إرساله.`,
          confirmText: isEn ? 'Yes, Return for Correction' : 'نعم، إعادة للتصحيح',
          onConfirm: () => {
            saveEmployeeAuditInputs();
            const auditor = storage.getActiveUser()?.name || (isEn ? 'Audit Reviewer' : 'المدقق المالي');
            const notes = contentArea.querySelector('#audit-notes-input')?.value || '';
            const res = transitionPayrollGuarded(state.currentUser, selectedAuditBatch, 'rejected', {
              by: auditor,
              context: getPayrollBranchContext(),
              rejectionReason: notes || (isEn ? 'Audit returned the payroll for correction' : 'أعاد التدقيق المسير للتصحيح'),
              auditNotes: notes,
            });
            if (!res.ok) {
              toast.error(isEn ? `Cannot reject: ${res.error}` : `تعذر الرفض: ${res.error}`);
              return;
            }
            storage.addPayrollBatch(res.batch);
            storage.addAudit('reject', 'payroll', `${selectedAuditBatch.month} → ${isEn ? 'audit returned for correction (amounts preserved)' : 'إعادة التدقيق للتصحيح (المبالغ محفوظة)'}`, selectedAuditBatch.id);
            toast.warning(isEn
              ? 'Payroll returned to HR (Returned / Needs Correction). Amounts are preserved; correct and re-submit.'
              : 'أُعيد المسير إلى مسؤول الرواتب (عودة / بحاجة تصحيح). المبالغ محفوظة؛ يصحّح ثم يعيد الإرسال.');
            activeTab = 'payroll';
            updateHeaderTabs();
            renderTabContent();
          },
        });
      });

      // =========================================================
    // 3. DISBURSED & PAID PAYROLLS TAB
    // =========================================================
    } else if (activeTab === 'disbursed') {
      contentArea.innerHTML = `
        <div class="card" style="padding:0; overflow:hidden;">
          <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
            <div>
              <div style="font-weight:700; font-size:15px; color:var(--text-main);">${isEn ? 'Disbursed & Paid Payrolls History' : 'سجل الرواتب المصروفة والمؤرشفة'}</div>
              <div style="font-size:12px; color:var(--text-muted);">${isEn ? 'All archived payrolls that have been disbursed to employees' : 'كافة مسيرات الرواتب التي تم صرفها وتحويلها للبنوك'}</div>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span class="badge badge-success">${paidBatches.length} ${isEn ? 'Batches Disbursed' : 'مسير تم صرفه'}</span>
              ${canManagePayroll ? `
              <button type="button" class="btn btn-outline btn-sm" id="btn-archive-pre-app">
                ${Icons.clock(14)} ${isEn ? 'Archive Pre-App Months' : 'أرشفة الأشهر السابقة'}
              </button>
              ` : ''}
            </div>
          </div>

          <div class="table-container" style="border:none;">
            <table class="table">
              <thead>
                <tr>
                  <th>${isEn ? 'Month' : 'شهر المسير'}</th>
                  <th>${isEn ? 'Employees Count' : 'عدد الموظفين'}</th>
                  <th>${isEn ? 'Total Gross' : 'إجمالي الاستحقاق'}</th>
                  <th>${isEn ? 'Total Deductions' : 'إجمالي الاستقطاع'}</th>
                  <th>${isEn ? 'Net Disbursed' : 'صافي المبلغ المصروف'}</th>
                  <th>${isEn ? 'Disbursed Date' : 'تاريخ الصرف'}</th>
                  <th>${isEn ? 'Disbursed By' : 'المسؤول عن الصرف'}</th>
                  <th style="text-align:left;">${isEn ? 'Actions' : 'إجراءات'}</th>
                </tr>
              </thead>
              <tbody>
                ${
                  paidBatches.length === 0
                    ? `<tr><td colspan="8" style="text-align:center; padding:32px; color:var(--text-muted);">${isEn ? 'No disbursed payrolls yet.' : 'لا توجد مسيرات رواتب تم صرفها بعد.'}</td></tr>`
                    : paidBatches
                        .map((b) => {
                          const segB = (k, sign) => summarizeCurrencySegmentsHtml((b.totalsByCurrency || []).map((g) => ({ code: g.code, amount: g[k] || 0 })), { sign });
                          return `
                      <tr data-batch-month="${b.month}">
                        <td><strong>${b.month}</strong></td>
                        <td>${b.employeesCount} ${isEn ? 'employees' : 'موظف'}</td>
                        <td>${segB('gross')}</td>
                        <td style="color:var(--danger);">${segB('deductions', '-')}</td>
                        <td><strong style="color:var(--success); font-size:15px;">${segB('net')}</strong></td>
                        <td>${formatDate(b.releasedAt || b.paidAt || b.issueDate)}</td>
                        <td><span class="badge badge-gray">${b.paidBy || 'HR'}</span></td>
                        <td>
                          <div style="display:flex; align-items:center; gap:6px; justify-content:flex-end;">
                            ${(b.isArchivedLegacy || (b.items && b.items.length === 0)) ? `
                            <span class="badge badge-warning">${isEn ? 'Archived (Summary)' : 'مؤرشف (ملخص)'}</span>
                            ` : `<button type="button" class="btn btn-sm btn-outline btn-print-disbursed-all">
                              ${Icons.printer(14)} ${isEn ? 'Print All Payslips' : 'طباعة كافة الوصولات'}
                            </button>`}
                            ${canArchive && !b.archived ? `
                            <button type="button" class="btn btn-sm btn-outline btn-archive-paid-batch" style="color:var(--danger); border-color:rgba(239,68,68,0.4);">
                              ${isEn ? 'Archive' : 'أرشفة'}
                            </button>
                            ` : ''}
                            ${b.archived ? `
                            <span class="badge badge-purple">${isEn ? 'Archived' : 'مؤرشف'}</span>
                            ` : ''}
                            ${b.archived && canCreateCorrection ? `
                            <button type="button" class="btn btn-sm btn-outline btn-correct-batch">
                              ${Icons.refresh(14)} ${isEn ? 'Correction' : 'تصحيح'}
                            </button>
                            ` : ''}
                            <button type="button" class="btn btn-sm btn-primary btn-view-disbursed-batch">
                              ${Icons.fileText(14)} ${isEn ? 'View Batch' : 'عرض التفاصيل'}
                            </button>
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

      contentArea.querySelector('#btn-archive-pre-app')?.addEventListener('click', () => {
        openArchivePayrollModal({ onDone: () => renderTabContent() });
      });

      contentArea.querySelectorAll('tr').forEach((row) => {
        const month = row.getAttribute('data-batch-month');
        const b = paidBatches.find((x) => x.month === month);

        row.querySelector('.btn-print-disbursed-all')?.addEventListener('click', () => {
          if (b) openBatchPayslipsPrintModal(b, settings, null, companies);
        });

        row.querySelector('.btn-view-disbursed-batch')?.addEventListener('click', () => {
          if (b) {
            currentMonth = b.month;
            currentBatch = b;
            activeTab = 'payroll';
            updateHeaderTabs();
            renderTabContent();
          }
        });

        row.querySelector('.btn-correct-batch')?.addEventListener('click', () => {
          if (!b || !b.archived || !canCreateCorrection) return;
          openPayrollCorrectionModal({ original: b, onSaved: () => { activeTab = 'corrections'; updateHeaderTabs(); renderTabContent(); } });
        });

        row.querySelector('.btn-archive-paid-batch')?.addEventListener('click', () => {
          if (!canArchive || !b) return;
          showConfirmDialog({
            title: isEn ? 'Archive Payroll' : 'أرشفة مسير الرواتب',
            message: isEn
              ? `<strong>${b.month}</strong> — this paid payroll will be permanently archived (financial read-only). Employees' payslips remain available in the disbursed history.`
              : `<strong>${b.month}</strong> — سيُؤرشف مسير الرواتب المصروف بشكل نهائي (قراءة مالية فقط). تبقى وصولات الموظفين متاحة في سجل المصروفات.`,
            confirmText: isEn ? 'Yes, Archive Payroll' : 'نعم، أرشفة المسير',
            onConfirm: () => {
              const res = archivePayrollBatchGuarded(state.currentUser, b, { by: storage.getActiveUser()?.name || (isEn ? 'Super Admin' : 'المدير العام'), context: getPayrollBranchContext() });
              if (!res.ok) {
                toast.error(isEn ? `Cannot archive: ${res.error}` : `تعذر الأرشفة: ${res.error}`);
                return;
              }
              storage.addPayrollBatch(res.batch);
              storage.addAudit('archive', 'payroll', `${b.month} → ${isEn ? 'archived' : 'مؤرشف'}`, b.id);
              toast.success(isEn ? 'Payroll archived successfully.' : 'تمت أرشفة المسير بنجاح.');
              renderTabContent();
            },
          });
        });
      });

    // =========================================================
    // 4. LOANS & SETTLEMENTS TAB
    // =========================================================
    } else if (activeTab === 'loans') {
      const allLoans = loans || [];
      const activeLoansCount = allLoans.filter((l) => Number(l.remainingAmount) > 0 && l.status !== 'settled').length;
      const settledLoansCount = allLoans.filter((l) => Number(l.remainingAmount) <= 0 || l.status === 'settled').length;

      contentArea.innerHTML = `
        <div class="card" style="margin-bottom:20px; padding:18px 24px; background:var(--bg-card-hover);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
              <h3 style="font-size:17px; font-weight:800; color:var(--text-main);">${isEn ? 'Loans & Advances Statement' : 'كشف السلف والقروض وتصفية الحسابات'}</h3>
              <p style="font-size:12.5px; color:var(--text-muted); margin-top:2px;">
                ${isEn ? 'Track active advances, repayment installments, and auto-settled loans' : 'متابعة السلف القائمة والمسددة تلقائياً مع سندات الاستقطاع والتسديد'}
              </p>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="badge badge-warning">${activeLoansCount} ${isEn ? 'Active' : 'سارية'}</span>
              <span class="badge badge-success">${settledLoansCount} ${isEn ? 'Settled' : 'تم تصفيتها'}</span>
              <button type="button" class="btn btn-outline btn-sm" id="btn-loan-receipt-tab">
                ${Icons.receipt(14)} ${isEn ? 'Repayment Receipt' : 'سند تسديد دفعة'}
              </button>
              ${canGrantLoan ? `
                <button type="button" class="btn btn-primary btn-sm" id="btn-grant-loan-tab">
                  ${Icons.plus(14)} ${isEn ? 'Grant New Loan' : 'منح سلفة جديدة'}
                </button>
              ` : ''}
            </div>
          </div>
        </div>

        <div class="card" style="padding:0; overflow:hidden;">
          <div class="table-container" style="border:none;">
            <table class="table" style="font-size:12.5px;">
              <thead>
                <tr>
                  <th>${t('payroll.employee')}</th>
                  <th>${isEn ? 'Currency' : 'العملة'}</th>
                  <th>${t('payroll.loanAmount')}</th>
                  <th>${t('payroll.paidAmount')}</th>
                  <th>${t('payroll.remainingAmount')}</th>
                  <th>${t('payroll.monthlyInstallment')}</th>
                  <th>${t('payroll.startMonth')}</th>
                  <th>${isEn ? 'Status' : 'حالة السلفة'}</th>
                  <th style="text-align:left;">${isEn ? 'Actions' : 'إجراءات'}</th>
                </tr>
              </thead>
              <tbody>
                ${
                  allLoans.length === 0
                    ? `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--text-muted);">${isEn ? 'No loans recorded' : 'لا توجد سلف مسجلة'}</td></tr>`
                    : allLoans
                        .map((ln) => {
                          const emp = employees.find((e) => e.id === ln.employeeId);
                          const isSettled = Number(ln.remainingAmount) <= 0 || ln.status === 'settled';
                          const paid = Number(ln.totalAmount || ln.amount) - (Number(ln.remainingAmount) || 0);
                          // P2.2: every loan prints with ITS OWN currency code
                          // (never the global settings symbol) so a USD advance
                          // and an IQD advance can never be read as the same money.
                          const curCode = String(ln.currency || (emp && resolveEmployeeCurrency(emp, settings, companies).code) || settings.currency || 'USD').trim().toUpperCase();
                          const fa = (amt) => formatAmountWithCode(amt, curCode);
                          const salaryCur = emp ? resolveEmployeeCurrency(emp, settings, companies).code : curCode;
                          return `
                      <tr data-loan-id="${ln.id}">
                        <td>
                          <strong>${emp ? emp.fullName : (isEn ? 'Unknown' : 'غير معروف')}</strong>
                          <div style="font-size:11px; color:var(--text-muted);">${emp ? emp.employeeNumber : ''}</div>
                        </td>
                        <td>
                          <span class="badge ${curCode === salaryCur ? 'badge-info' : 'badge-warning'}" style="direction:ltr; unicode-bidi:embed;">${curCode}</span>
                          ${curCode !== salaryCur ? `<div style="font-size:10.5px; color:var(--warning); margin-top:2px;">${isEn ? '≠ salary' : '≠ عملة الراتب'}</div>` : ''}
                        </td>
                        <td>${fa(ln.totalAmount || ln.amount)}</td>
                        <td><strong style="color:var(--success);">${fa(paid)}</strong></td>
                        <td><strong style="color:${isSettled ? 'var(--text-muted)' : 'var(--danger)'};">${fa(ln.remainingAmount)}</strong></td>
                        <td>${fa(ln.installmentAmount || ln.monthlyInstallment)}</td>
                        <td>${ln.startMonth || '-'}</td>
                        <td>
                          <span class="badge ${isSettled ? 'badge-success' : 'badge-warning'}">
                            ${isSettled ? (isEn ? '✅ Loan Settled' : '✅ تم تصفية السلفة') : (isEn ? '⏳ Active (Repaying)' : '⏳ سارية (قيد السداد)')}
                          </span>
                        </td>
<td>
  <div style="display:flex; align-items:center; gap:6px; justify-content:flex-end; flex-wrap:wrap;">
    ${canEditLoan ? `
    <button type="button" class="btn btn-sm btn-outline btn-edit-loan">
      ${Icons.edit(14)} ${isEn ? 'Edit' : 'تعديل'}
    </button>
    ` : ''}
    <button type="button" class="btn btn-sm btn-outline btn-pay-loan" ${isSettled || !canPayLoan ? 'disabled style="opacity:0.5;"' : ''}>
      ${Icons.receipt(14)} ${ isEn ? 'Pay' : 'تسديد'}
    </button>
    ${canDeleteLoan ? `
    <button type="button" class="btn btn-sm btn-outline btn-delete-loan" style="color:var(--danger); border-color:rgba(239,68,68,0.35);">
      ${Icons.trash(14)} ${isEn ? 'Delete' : 'حذف'}
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

      contentArea.querySelector('#btn-loan-receipt-tab')?.addEventListener('click', () => {
        openLoanReceiptModal(null, () => renderTabContent());
      });

      contentArea.querySelector('#btn-grant-loan-tab')?.addEventListener('click', () => {
        if (!canGrantLoan) return;
        openLoanModal(null, () => renderTabContent());
      });

      contentArea.querySelectorAll('.btn-pay-loan').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (!canPayLoan) return;
          const row = e.target.closest('tr');
          const loanId = row?.getAttribute('data-loan-id');
          const loan = allLoans.find((l) => l.id === loanId);
          if (loan) openLoanReceiptModal(loan.employeeId, () => renderTabContent());
        });
      });

      contentArea.querySelectorAll('.btn-edit-loan').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (!canEditLoan) return;
          const row = e.target.closest('tr');
          const loanId = row?.getAttribute('data-loan-id');
          const loan = allLoans.find((l) => l.id === loanId);
          if (loan) openLoanModal(loan.employeeId, () => renderTabContent(), loan);
        });
      });

      contentArea.querySelectorAll('.btn-delete-loan').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (!canDeleteLoan) return;
          const row = e.target.closest('tr');
          const loanId = row?.getAttribute('data-loan-id');
          const loan = allLoans.find((l) => l.id === loanId);
          if (!loan) return;
          const emp = employees.find((x) => x.id === loan.employeeId);
          const curCode = String(loan.currency || (emp && resolveEmployeeCurrency(emp, settings, companies).code) || settings.currency || 'USD').trim().toUpperCase();
          const label = `${emp ? emp.fullName : (isEn ? 'Unknown employee' : 'موظف غير معروف')} — ${formatAmountWithCode(loan.totalAmount || loan.amount, curCode)}`;
          showConfirmDialog({
            title: isEn ? 'Delete Advance Record' : 'حذف سجل السلفة',
            message: isEn
              ? `Are you sure you want to delete this advance record?<br><strong>${label}</strong><br>It will be archived permanently and removed from the loans statement.`
              : `هل أنت متأكد من حذف سجل السلفة؟<br><strong>${label}</strong><br>سيتم أرشفة السجل نهائياً وإزالته من كشف السلف.`,
            confirmText: isEn ? 'Yes, Delete' : 'نعم، حذف',
            onConfirm: () => {
              storage.deleteLoan(loan.id);
              storage.addAudit('delete', 'loan', label.replace(/<[^>]*>/g, ''), loan.id);
              toast.success(isEn ? 'Advance record deleted and archived.' : 'تم حذف سجل السلفة وأرشفته.');
              renderTabContent();
            },
          });
        });
      });

    // =========================================================
    // 5. SALARY INCREMENTS TAB
    // =========================================================
    } else if (activeTab === 'increments') {
      contentArea.innerHTML = `
        <div class="card" style="padding:0; overflow:hidden;">
          <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
            <div>
              <div style="font-weight:700; font-size:15px; color:var(--text-main);">${t('payroll.incrementsLog')}</div>
              <div style="font-size:12px; color:var(--text-muted);">${t('payroll.incrementsSubtitle')}</div>
            </div>
            ${canAddIncrement ? `
            <button type="button" class="btn btn-primary btn-sm" id="btn-add-increment-tab">
              ${Icons.trendingUp(14)} ${t('payroll.applyNewIncrement')}
            </button>
          ` : ''}
          </div>

          <div class="table-container" style="border:none;">
            <table class="table">
              <thead>
                <tr>
                  <th>${t('payroll.employee')}</th>
                  <th>${t('payroll.incrementType')}</th>
                  <th>${t('payroll.incrementValue')}</th>
                  <th>${t('payroll.salaryBeforeIncrement')}</th>
                  <th>${t('payroll.approvedNewSalary')}</th>
                  <th>${t('payroll.effectiveDate')}</th>
                  <th>${t('payroll.reasonJustification')}</th>
                  <th>${t('payroll.approvedBy')}</th>
                </tr>
              </thead>
              <tbody>
                ${
                  increments.length === 0
                    ? `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">${t('payroll.noIncrements')}</td></tr>`
                    : increments
                        .map((inc) => {
                          const emp = employees.find((e) => e.id === inc.employeeId);
                          return `
                      <tr>
                        <td><strong>${emp ? emp.fullName : t('payroll.unknownEmployee')}</strong></td>
                        <td><span class="badge badge-primary">${inc.type === 'percentage' ? t('payroll.percentage') : t('payroll.fixedAmount')}</span></td>
                        <td><strong style="color:var(--success); font-size:14px;">${inc.type === 'percentage' ? `${inc.value}%` : formatCurrency(inc.value, sym)}</strong></td>
                        <td>${formatCurrency(inc.previousTotalSalary, sym)}</td>
                        <td><strong style="color:var(--primary); font-size:14px;">${formatCurrency(inc.newTotalSalary, sym)}</strong></td>
                        <td>${formatDate(inc.effectiveDate)}</td>
                        <td style="max-width:200px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${inc.reason}</td>
                        <td><span class="badge badge-gray">${inc.approvedBy}</span></td>
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

      contentArea.querySelector('#btn-add-increment-tab')?.addEventListener('click', () => {
        if (!canAddIncrement) return;
        openSalaryIncrementModal(null, () => renderPayrollView(container, { tab: 'increments' }));
      });
    } else if (activeTab === 'corrections') {
      // =========================================================
      // Phase 9 — POST-PAYMENT CORRECTIONS TAB (L1–L6, Decision 8)
      // =========================================================
      const ctx = getPayrollBranchContext();
      const corrections = getContextCorrections();
      const archivedBatches = getLivePayrolls().filter((b) => b && b.archived === true && b.status === 'paid'
        && String(b.companyId) === String(ctx.companyId) && String(b.branchId) === String(ctx.branchId));

      const statusMeta = (c) => {
        if (c.archived === true) return { cls: 'badge-purple', text: isEn ? 'Archived (immutable)' : 'مؤرشف (غير قابل للتعديل)' };
        if (c.status === 'paid') return { cls: 'badge-success', text: isEn ? 'Paid' : 'مصروف' };
        if (c.status === 'approved') return { cls: 'badge-info', text: isEn ? 'Approved' : 'معتمد' };
        if (c.status === 'under_audit') return c.coApprovePending ? { cls: 'badge-warning', text: isEn ? 'Pending 2nd approval' : 'بانتظار الموافقة الثانية' } : { cls: 'badge-warning', text: isEn ? 'Under Audit' : 'قيد التدقيق' };
        if (c.status === 'rejected') return { cls: 'badge-danger', text: isEn ? 'Returned' : 'مُعاد للتصحيح' };
        return { cls: 'badge-gray', text: isEn ? 'Draft' : 'مسودة' };
      };

      const money = (c) => {
        const view = correctionFinancialView(c);
        if (!view || !view.currencies || !view.currencies.length) return '0.00';
        return view.currencies.map((g) => formatAmountWithCode(g.amount, g.code)).join(' + ');
      };

      contentArea.innerHTML = `
        <div class="card" style="padding:0; overflow:hidden;">
          <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
            <div>
              <div style="font-weight:700; font-size:15px; color:var(--text-main);">${isEn ? 'Post-Payment Corrections' : 'التصحيحات اللاحقة للصرف'}</div>
              <div style="font-size:12px; color:var(--text-muted);">${isEn ? 'Original + Σ corrections = Net/Effective — the archived original is never modified (L1/L6).' : 'الأصلي + مجموع التصحيحات = الصافي/الفعال — لا يُعدّل المسير المؤرشف أبداً.'}</div>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              ${archivedBatches.length && canCreateCorrection ? `
              <select class="form-select" id="pc-new-batch" style="width:180px; padding:6px 10px;">
                ${archivedBatches.map((b) => `<option value="${b.id}">${b.month}</option>`).join('')}
              </select>
              <button type="button" class="btn btn-primary btn-sm" id="btn-new-correction">
                ${Icons.refresh(14)} ${isEn ? 'New Correction' : 'تصحيح جديد'}
              </button>` : `<span class="badge badge-gray">${isEn ? 'No archived payrolls in this branch' : 'لا مسيرات مؤرشفة في هذا الفرع'}</span>`}
            </div>
          </div>
          <div class="table-container" style="border:none;">
            <table class="table">
              <thead>
                <tr>
                  <th>${isEn ? 'Number' : 'الرقم'}</th>
                  <th>${isEn ? 'Original' : 'المسير الأصلي'}</th>
                  <th>${isEn ? 'Direction' : 'الاتجاه'}</th>
                  <th>${isEn ? 'Amount (signed)' : 'المبلغ (مُوقّع)'}</th>
                  <th>${isEn ? 'Recovery' : 'الاسترداد'}</th>
                  <th>${isEn ? 'Status' : 'الحالة'}</th>
                  <th style="text-align:left;">${isEn ? 'Actions' : 'إجراءات'}</th>
                </tr>
              </thead>
              <tbody>
                ${corrections.length === 0
                  ? `<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--text-muted);">${isEn ? 'No corrections in this branch context yet.' : 'لا توجد تصحيحات في سياق هذا الفرع بعد.'}</td></tr>`
                  : corrections.map((c) => {
                    const sm = statusMeta(c);
                    return `
                    <tr data-cid="${c.correctionId}">
                      <td><strong style="direction:ltr; unicode-bidi:embed;">${escapeHtml(c.displayNumber || c.correctionId)}</strong></td>
                      <td>${escapeHtml(c.payrollPeriodId || '-')}</td>
                      <td><span class="badge ${c.direction === 'debit' ? 'badge-danger' : 'badge-success'}">${c.direction === 'debit' ? (isEn ? 'Debit' : 'خصم') : (isEn ? 'Credit' : 'إضافة')}</span></td>
                      <td style="direction:ltr; unicode-bidi:embed; font-weight:700;">${money(c)}</td>
                      <td>${c.recovery && c.recovery.method ? escapeHtml(c.recovery.method) : '—'}</td>
                      <td><span class="badge ${sm.cls}">${sm.text}</span></td>
                      <td>
                        <div style="display:flex; align-items:center; gap:6px; justify-content:flex-end; flex-wrap:wrap;">
                          ${c.status === 'draft' && canCreateCorrection ? `<button type="button" class="btn btn-sm btn-outline" data-pc-act="submit">${isEn ? 'Submit' : 'إرسال'}</button>` : ''}
                          ${c.status === 'under_audit' && c.coApprovePending && canCoApproveCorrection ? `<button type="button" class="btn btn-sm btn-outline" data-pc-act="coApprove">${isEn ? 'Co-Approve' : 'الموافقة الثانية'}</button>` : ''}
                          ${c.status === 'under_audit' && !c.coApprovePending && canApprove ? `<button type="button" class="btn btn-sm btn-primary" data-pc-act="approve">${isEn ? 'Approve' : 'اعتماد'}</button>` : ''}
                          ${c.status === 'under_audit' && !c.coApprovePending && canRejectAudit ? `<button type="button" class="btn btn-sm btn-outline" data-pc-act="reject" style="color:var(--danger);">${isEn ? 'Return' : 'إعادة'}</button>` : ''}
                          ${(c.status === 'under_audit' || c.status === 'approved') && canDisburse ? `<button type="button" class="btn btn-sm btn-outline" data-pc-act="disburse">${isEn ? 'Disburse' : 'صرف'}</button>` : ''}
                          ${c.status === 'paid' && c.archived !== true && canArchive ? `<button type="button" class="btn btn-sm btn-outline" data-pc-act="archive">${isEn ? 'Archive' : 'أرشفة'}</button>` : ''}
                          ${c.archived === true ? `<span style="font-size:11px; color:var(--text-muted);">${isEn ? 'read-only' : 'قراءة فقط'}</span>` : ''}
                        </div>
                      </td>
                    </tr>`;
                  }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      contentArea.querySelector('#btn-new-correction')?.addEventListener('click', () => {
        const sel = contentArea.querySelector('#pc-new-batch');
        const batch = archivedBatches.find((b) => b.id === (sel ? sel.value : ''));
        if (!batch) return;
        openPayrollCorrectionModal({ original: batch, onSaved: () => renderTabContent() });
      });

      const byName = () => storage.getActiveUser()?.name || '';

      const runCorrectionAction = (correction, act) => {
        if (act === 'coApprove') {
          const res = coApproveCorrectionGuarded(state.currentUser, correction, { by: byName(), context: getPayrollBranchContext() });
          if (!res.ok) { toast.error(isEn ? `Cannot co-approve: ${res.error}` : `تعذر الاعتماد الثاني: ${res.error}`); return; }
          storage.addPayrollCorrection(res.correction);
          storage.addAudit('approve', 'payroll', `${res.correction.displayNumber} → dual approved`, res.correction.correctionId);
          toast.success(isEn ? 'Dual approval completed.' : 'تمت الموافقة الثانية.');
          renderTabContent();
          return;
        }
        if (act === 'reject') {
          createModal({
            title: isEn ? 'Return correction' : 'إعادة التصحيح للتصحيح',
            size: 'sm',
            bodyHtml: `<div class="form-group"><label class="form-label">${isEn ? 'Rejection reason (mandatory)' : 'سبب الرفض (إلزامي)'} *</label><textarea class="form-input" id="pc-reject-reason" rows="3" required></textarea></div>`,
            footerHtml: `<button type="button" class="btn btn-secondary pc-reject-cancel">${t('cancel')}</button><button type="button" class="btn btn-danger pc-reject-confirm">${isEn ? 'Return' : 'إعادة'}</button>`,
            onOpen: (overlay, close) => {
              overlay.querySelector('.pc-reject-cancel').addEventListener('click', close);
              overlay.querySelector('.pc-reject-confirm').addEventListener('click', () => {
                const reason = overlay.querySelector('#pc-reject-reason').value.trim();
                if (!reason) { toast.error(isEn ? 'A rejection reason is required.' : 'سبب الرفض إلزامي.'); return; }
                const res = transitionCorrectionGuarded(state.currentUser, correction, 'rejected', { by: byName(), context: getPayrollBranchContext(), rejectionReason: reason });
                if (!res.ok) { toast.error(isEn ? `Cannot return: ${res.error}` : `تعذر الإعادة: ${res.error}`); return; }
                storage.addPayrollCorrection(res.correction);
                storage.addAudit('reject', 'payroll', `${res.correction.displayNumber} → returned`, res.correction.correctionId);
                toast.success(isEn ? 'Correction returned for revision.' : 'تمت إعادة التصحيح للمراجعة.');
                close();
                renderTabContent();
              });
            },
          });
          return;
        }
        const to = act === 'submit' ? 'under_audit' : act === 'approve' ? 'approved' : act === 'disburse' ? 'paid' : null;
        if (act === 'archive') {
          const res = archiveCorrectionGuarded(state.currentUser, correction, { by: byName(), context: getPayrollBranchContext() });
          if (!res.ok) { toast.error(isEn ? `Cannot archive: ${res.error}` : `تعذر الأرشفة: ${res.error}`); return; }
          storage.addPayrollCorrection(res.correction);
          storage.addAudit('archive', 'payroll', `${res.correction.displayNumber} → archived`, res.correction.correctionId);
          toast.success(isEn ? 'Correction archived (now immutable).' : 'تمت أرشفة التصحيح (غير قابل للتعديل الآن).');
          renderTabContent();
          return;
        }
        if (!to) return;
        const res = transitionCorrectionGuarded(state.currentUser, correction, to, { by: byName(), context: getPayrollBranchContext() });
        if (!res.ok) { toast.error(isEn ? `Cannot ${act}: ${res.error}` : `تعذر ${act}: ${res.error}`); return; }
        storage.addPayrollCorrection(res.correction);
        storage.addAudit(act, 'payroll', `${res.correction.displayNumber} → ${res.correction.status}`, res.correction.correctionId);
        toast.success(isEn ? `Correction ${res.correction.status}.` : `حالة التصحيح: ${res.correction.status}.`);
        renderTabContent();
      };

      contentArea.querySelectorAll('[data-pc-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cid = btn.closest('tr')?.getAttribute('data-cid');
          const correction = storage.getCorrections().find((c) => c && c.correctionId === cid);
          if (!correction) return;
          runCorrectionAction(correction, btn.getAttribute('data-pc-act'));
        });
      });
    }
  }

  function updateHeaderTabs() {
    persistedTab = activeTab;
    const tabBtns = container.querySelectorAll('.tab-btn');
    tabBtns.forEach((btn) => {
      if (btn.getAttribute('data-tab') === activeTab) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }

  container.innerHTML = `
    <!-- Top Action Bar -->
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:20px;">
      <div>
        <h2 style="font-size:20px; font-weight:800; color:var(--text-main);">${t('payroll.monthlyPayroll')}</h2>
        <p style="font-size:13px; color:var(--text-muted);">${t('payroll.monthlyPayrollSubtitle')}</p>
        <div style="margin-top:8px; padding:6px 12px; background:var(--bg-card-hover); border-radius:6px; font-size:12px; font-weight:700; color:var(--primary); display:inline-flex; align-items:center; gap:6px;">
          🏢 ${isEn ? 'Current Branch Context:' : 'سياق الفرع الحالي:'}
          <span id="payroll-branch-context" style="font-family:monospace; background:var(--bg-input); padding:2px 8px; border-radius:4px;">
            ${(() => {
              const ctx = getPayrollBranchContext();
              const state = storage.getState();
              const comp = state.companies?.find(c => c.id === ctx.companyId);
              const br = comp?.branches?.find(b => b.id === ctx.branchId);
              return (comp ? (isEn ? comp.nameEn : comp.nameAr) : ctx.companyId) + ' / ' + (br ? (isEn ? br.nameEn : br.nameAr) : ctx.branchId);
            })()}
          </span>
        </div>
      </div>

      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        ${canDeductions ? `
          <button type="button" class="btn btn-outline" id="btn-open-deductions-log">
            ${Icons.fileText(16)} ${isEn ? 'Deductions & Bonuses Log' : 'سجل الخصومات والمكافآت'}
          </button>
          <button type="button" class="btn btn-outline" id="btn-deduction-bonus">
            ${Icons.trendingUp(16)} ${t('payroll.deductionOrBonus')}
          </button>
        ` : ''}
        ${canGrantLoan ? `
          <button type="button" class="btn btn-outline" id="btn-loan-receipt">
            ${Icons.receipt(16)} ${t('payroll.advancePaymentReceipt')}
          </button>
          <button type="button" class="btn btn-outline" id="btn-open-loan-modal">
            ${Icons.dollar(16)} ${t('payroll.grantAdvance')}
          </button>
        ` : ''}
      </div>
    </div>

    <!-- Navigation Tabs Header -->
    <div class="tabs-header" style="flex-wrap:wrap; gap:6px;">
      <button type="button" class="tab-btn ${activeTab === 'payroll' ? 'active' : ''}" data-tab="payroll" id="tab-payroll-active">
        ${Icons.dollar(16)} ${isEn ? 'Due & Active Payrolls' : 'الرواتب المستحقة والمسيرات'}
      </button>
      ${canReviewAudit ? `
      <button type="button" class="tab-btn ${activeTab === 'audit' ? 'active' : ''}" data-tab="audit" id="tab-payroll-audit">
        ${Icons.shieldCheck(16)} ${isEn ? 'Financial Audit Stage' : 'قسم التدقيق والمراجعة'}
      </button>
    ` : ''}
      <button type="button" class="tab-btn ${activeTab === 'disbursed' ? 'active' : ''}" data-tab="disbursed" id="tab-payroll-disbursed">
        ${Icons.award(16)} ${isEn ? 'Disbursed Payrolls' : 'الرواتب المصروفة والمؤرشفة'} (${getPaidBatches().length})
      </button>
      <button type="button" class="tab-btn ${activeTab === 'corrections' ? 'active' : ''}" data-tab="corrections" id="tab-payroll-corrections">
        ${Icons.refresh(16)} ${isEn ? 'Post-Payment Corrections' : 'التصحيحات اللاحقة للصرف'} (${correctionCount()})
      </button>
      <button type="button" class="tab-btn ${activeTab === 'loans' ? 'active' : ''}" data-tab="loans" id="tab-payroll-loans">
        ${Icons.receipt(16)} ${isEn ? 'Loans & Settlements' : 'كشف السلف وتصفيتها'}
      </button>
      <button type="button" class="tab-btn ${activeTab === 'increments' ? 'active' : ''}" data-tab="increments" id="tab-payroll-increments">
        ${Icons.trendingUp(16)} ${isEn ? 'Salary Increments' : 'سجل زيادات الرواتب'}
      </button>
    </div>

    <div id="payroll-tab-content"></div>
  `;

  // Attach Top Action Buttons
  container.querySelector('#btn-open-deductions-log')?.addEventListener('click', () => {
    if (!canDeductions) return;
    openDeductionsBonusesListModal(currentMonth, () => renderPayrollView(container, { tab: activeTab }));
  });

  container.querySelector('#btn-deduction-bonus')?.addEventListener('click', () => {
    if (!canDeductions) return;
    openDeductionBonusModal(null, () => renderPayrollView(container, { tab: activeTab }));
  });

  container.querySelector('#btn-loan-receipt')?.addEventListener('click', () => {
    if (!canGrantLoan) return;
    openLoanReceiptModal(null, () => renderPayrollView(container, { tab: activeTab }));
  });

  container.querySelector('#btn-open-loan-modal')?.addEventListener('click', () => {
    if (!canGrantLoan) return;
    openLoanModal(null, () => renderPayrollView(container, { tab: activeTab }));
  });

  // Attach Tab switcher
  container.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.getAttribute('data-tab');
      updateHeaderTabs();
      renderTabContent();
    });
  });

  renderTabContent();
}
