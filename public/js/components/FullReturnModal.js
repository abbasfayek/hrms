// =========================================================
// Full Return Modal — One-Tap Simplified Reversal Workflow
// =========================================================
// Flow: Confirm → Execute → Success → Back to Payroll
// Zero typing, zero manual amounts, zero multi-step forms. The
// reason is auto-stamped ("ترجيع راتب / Salary return") like a
// normal payroll reversal. All backend validation, audit trail,
// and state-machine rules are preserved.
// =========================================================

import { storage } from '../storage.js';
import { createModal } from './Modal.js';
import { formatAmountWithCode, can, escapeHtml } from '../types.js';
import { t, i18n } from '../i18n.js';
import { toast } from './Toast.js';
import { createPayrollCorrectionGuarded, transitionCorrectionGuarded } from '../engines/payrollCorrectionAccess.js';
import { archivePayrollBatchGuarded } from '../engines/payrollAccess.js';

export function openFullReturnModal({ batch, onCompleted }) {
  const isEn = i18n.getLang() === 'en';
  const state = storage.getState();
  const { settings } = state;
  const DEFAULT_REASON = isEn ? 'Salary return' : 'ترجيع راتب';

  // Pre-validation
  if (!batch || batch.status !== 'paid') {
    toast.error(isEn ? 'Full return can only be performed on a paid payroll.' : 'يمكن إجراء الترجيع الكامل على مسير مصروف فقط.');
    return;
  }

  if (batch.fullReturn?.completed) {
    toast.info(isEn ? 'This payroll has already been fully returned.' : 'تم ترجيع هذا المسير بالكامل مسبقاً.');
    return;
  }

  if (!can(state.currentUser, 'payroll.correction.create')) {
    toast.error(isEn ? 'Permission denied: cannot create correction/return.' : 'لا تملك صلاحية إجراء ترجيع/تصحيح.');
    return;
  }

  const items = Array.isArray(batch.items) ? batch.items : [];
  if (!items.length) {
    toast.error(isEn ? 'No employee items found in this payroll batch.' : 'لا توجد بنود موظفين في هذا المسير.');
    return;
  }

  // Branch validation
  const branchValidation = storage.validateBranchContext();
  if (!branchValidation.ok) {
    toast.error(branchValidation.message || (isEn ? 'Please select a branch first.' : 'يرجى تحديد الفرع أولاً.'));
    return;
  }

  const formattedAmount = (batch.totalsByCurrency && batch.totalsByCurrency.length)
    ? batch.totalsByCurrency.map((g) => formatAmountWithCode(g.net, g.code)).join(' + ')
    : formatAmountWithCode(Number(batch.totalNet) || 0, '');

  const bodyHtml = `
    <div style="padding:4px 0;">
      <div class="card" style="padding:16px; background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.25); border-radius:8px; margin-bottom:16px;">
        <div style="font-size:12px; color:var(--text-muted); font-weight:600;">
          ${isEn ? 'Total Amount to Return (Full Reversal):' : 'المبلغ الإجمالي المسترد بالكامل:'}
        </div>
        <div style="font-size:24px; font-weight:800; color:#dc2626; margin-top:4px; direction:ltr; unicode-bidi:embed;">
          ${formattedAmount}
        </div>
        <div style="font-size:12px; color:var(--text-muted); margin-top:6px;">
          ${isEn
            ? `Full recovery for all ${items.length} employee(s) in payroll ${escapeHtml(batch.month)}`
            : `ترجيع كامل لكافة موظفي مسير شهر ${escapeHtml(batch.month)} (${items.length} موظفاً)`}
        </div>
      </div>
      <div style="font-size:13px; color:var(--text-muted); border-top:1px dashed var(--border); padding-top:12px;">
        ${isEn
          ? `<strong>Reason (auto):</strong> ${escapeHtml(DEFAULT_REASON)} — no further input is needed.`
          : `<strong>السبب (تلقائي):</strong> ${escapeHtml(DEFAULT_REASON)} — لا حاجة لأي إدخال إضافي.`}
      </div>
    </div>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary full-return-cancel-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-danger full-return-confirm-btn" style="font-weight:700;">${isEn ? 'Confirm Full Return' : 'تأكيد الترجيع الكامل'}</button>
  `;

  createModal({
    title: `${isEn ? 'Full Return' : 'ترجيع كامل'} — ${batch.month}`,
    size: 'md',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      overlay.querySelector('.full-return-cancel-btn').addEventListener('click', close);

      overlay.querySelector('.full-return-confirm-btn').addEventListener('click', async () => {
        const reason = DEFAULT_REASON;

        // Disable button during processing
        const confirmBtn = overlay.querySelector('.full-return-confirm-btn');
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = isEn ? '⏳ Executing...' : '⏳ جاري التنفيذ...';

        try {
          const state = storage.getState();
          const { settings } = state;
          let targetBatch = batch;
          const branchContext = { companyId: storage.getSelectedCompanyId(), branchId: branchValidation.branchId || storage.getSelectedBranchId() };

          // Auto-archive if needed (background, silent)
          if (!targetBatch.archived) {
            if (can(state.currentUser, 'payroll.archive')) {
              const resArchive = archivePayrollBatchGuarded(state.currentUser, targetBatch, {
                by: storage.getActiveUser()?.name || (isEn ? 'Super Admin' : 'المدير العام'),
                context: branchContext,
              });
              if (resArchive.ok) {
                targetBatch = resArchive.batch;
                storage.addPayrollBatch(targetBatch);
              }
            }
          }

          // Build component lines for every employee in the batch for their exact full net
          const components = items.map((it) => ({
            employeeId: it.employeeId,
            employeeName: it.employeeName || null,
            componentCode: 'SALARY_CUT',
            quantity: 1,
            rateOrRuleRef: Number(it.netSalary) || 0,
            reason: reason,
            sourceRef: `FULL_RETURN_${targetBatch.month}`,
            manualEntry: false,
          }));

          const input = {
            originalBatch: targetBatch,
            originalTransactionId: targetBatch.id,
            direction: 'debit',
            recovery: { method: 'separate_recovery' },
            ratePolicy: { mode: 'original' },
            reason: reason,
            description: isEn ? `Full return for ${targetBatch.month}` : `ترجيع كامل لمسير ${targetBatch.month}`,
            components,
            manualEntry: false,
          };

          const res = createPayrollCorrectionGuarded(state.currentUser, input, {
            settings,
            context: branchContext,
            existingCorrections: storage.getCorrections(targetBatch.id),
          });

          if (!res.ok) {
            const errorMap = {
              reason_required: isEn ? 'Reason for return is required.' : 'سبب الترجيع إلزامي.',
              original_not_archived: isEn ? 'This payroll batch must be archived first.' : 'يجب أرشفة مسير الرواتب أولاً قبل الترجيع.',
              correction_conflict: isEn ? 'There is already an open correction/return for this payroll.' : 'يوجد بالفعل طلب ترجيع/تصحيح مفتوح لهذا المسير.',
              correction_window_expired: isEn ? 'The correction period for this payroll has expired.' : 'انتهت الفترة الزمنية المتاحة للترجيع لهذا المسير.',
              branch_required: isEn ? 'Please select a branch first.' : 'يرجى تحديد الفرع أولاً.',
            };
            const errorMsg = errorMap[res.error] || (isEn ? `Could not process full return: ${res.error}` : `تعذر تنفيذ الترجيع الكامل: ${res.error}`);
            toast.error(errorMsg);
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = isEn ? 'Confirm Full Return' : 'تأكيد الترجيع الكامل';
            return;
          }

          // Advance to under_audit (financial audit queue) seamlessly in background
          const subRes = transitionCorrectionGuarded(state.currentUser, res.correction, 'under_audit', {
            by: storage.getActiveUser()?.name || (isEn ? 'HR Officer' : 'مسؤول الموارد البشرية'),
            context: branchContext,
          });
          const finalCorrection = subRes.ok ? subRes.correction : res.correction;

          storage.addPayrollCorrection(finalCorrection);

          // Update target batch with full return metadata
          const prevStatus = targetBatch.previousStatus || targetBatch.status || 'paid';
          const updatedBatch = {
            ...targetBatch,
            previousStatus: prevStatus,
            fullReturnState: 'fully_returned',
            fullReturn: {
              completed: true,
              status: 'fully_returned',
              previousStatus: prevStatus,
              reason: reason,
              correctionId: finalCorrection.correctionId,
              displayNumber: finalCorrection.displayNumber || null,
              at: new Date().toISOString(),
              by: storage.getActiveUser()?.name || (isEn ? 'HR Officer' : 'مسؤول الموارد البشرية'),
            },
          };
          storage.addPayrollBatch(updatedBatch);

          storage.addAudit(
            'correction',
            'payroll',
            isEn
              ? `Full return executed on ${targetBatch.month} (${formattedAmount}) — Reason: ${reason}`
              : `تم تنفيذ ترجيع كامل لمسير ${targetBatch.month} بمبلغ (${formattedAmount}) — السبب: ${reason}`,
            finalCorrection.correctionId
          );

          storage.addAudit(
            'full_return',
            'payroll',
            isEn
              ? `Full return executed on ${targetBatch.month} (${formattedAmount}) — Reason: ${reason} (Ref: ${finalCorrection.displayNumber || finalCorrection.correctionId})`
              : `تم تنفيذ ترجيع كامل لمسير ${targetBatch.month} بمبلغ (${formattedAmount}) — السبب: ${reason} (المرجع: ${finalCorrection.displayNumber || finalCorrection.correctionId})`,
            targetBatch.id
          );

          toast.success(isEn ? 'Payroll full return executed successfully.' : 'تم ترجيع المسير بالكامل بنجاح.');
          
          // Simple success flow - close modal and navigate back to payroll
          close();
          
          // Navigate back to payroll view
          if (window.hrmsApp) {
            window.hrmsApp.navigateTo('payroll');
          } else if (onCompleted) {
            onCompleted(finalCorrection, updatedBatch);
          }
        } catch (error) {
          console.error('Full return error:', error);
          toast.error(isEn ? 'An unexpected error occurred.' : 'حدث خطأ غير متوقع.');
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = isEn ? 'Confirm Full Return' : 'تأكيد الترجيع الكامل';
        }
      });
    },
  });
}
