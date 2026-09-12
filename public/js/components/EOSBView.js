// ==========================================
// End of Service & Resignations View
// ==========================================

import { storage } from '../storage.js';
import { Icons } from '../icons.js';
import { formatDate, TERMINATION_REASONS, can, resolveEmployeeCurrency, formatAmountWithCode, summarizeCurrencySegmentsHtml } from '../types.js';
import { openEOSBCalculatorModal } from './EOSBCalculatorModal.js';
import { openClearanceCertificateModal } from './ClearanceCertificateModal.js';
import { showConfirmDialog } from './Modal.js';
import { toast } from './Toast.js';
import { t, i18n } from '../i18n.js';
// Phase 7: every EOSB workflow action goes through the guarded layer
// (permission → scope → state) so invalid or unauthorized transitions are
// impossible and denied attempts are recorded in the central audit trail.
import { transitionEosbGuarded, recordEosbCorrectionGuarded, deleteEosbGuarded } from '../engines/eosbAccess.js';
import { disburseEosbAtomic, cancelEosbPaymentAtomic } from '../engines/eosbDisbursement.js';

const EOSB_STATUS_META = {
  draft: { badge: 'badge-warning', ar: 'مسودة / أعيد للتدقيق', en: 'Draft / Returned' },
  under_audit: { badge: 'badge-info', ar: 'قيد المراجعة المالية', en: 'Under Financial Audit' },
  approved: { badge: 'badge-primary', ar: 'معتمد — جاهز للصرف', en: 'Approved — Ready to pay' },
  paid: { badge: 'badge-success', ar: 'مصروف ومُخلّى', en: 'Paid & Cleared' },
};

export function renderEOSBView(container, options = {}) {
  const state = storage.getState();
  const { eosb, settings, employees, companies } = state;
  const isEn = i18n.getLang() === 'en';
  const canProcess = can(storage.getActiveUser(), 'eosb.calculate');
  const canApproveEosb = can(storage.getActiveUser(), 'eosb.approve');
  const canPayEosb = can(storage.getActiveUser(), 'eosb.pay');
  const canDeleteEosb = can(storage.getActiveUser(), 'eosb.delete');
  // Phase 7: surface a guarded-layer denial (permission/scope/state).
  const guardFailed = (res) => {
    if (res && res.ok === false) {
      toast.error(isEn ? `Action denied: ${res.error}.` : `تم رفض الإجراء: ${res.error}.`);
      renderEOSBView(container);
      return true;
    }
    return false;
  };
  const reasonLabel = (reason) => {
    const label = TERMINATION_REASONS[reason];
    if (!label) return reason;
    return typeof label === 'object' ? (isEn ? label.en : label.ar) : label;
  };

  // Legacy records saved before the approval workflow have no status field;
  // they were completed settlements and are treated as already paid.
  const recordStatus = (item) => item.status || 'paid';
  const statusMeta = (item) => EOSB_STATUS_META[recordStatus(item)] || EOSB_STATUS_META.draft;
  const empOf = (item) => employees.find((e) => e.id === item.employeeId);
  const curOf = (item) => {
    const e = empOf(item);
    if (e) return resolveEmployeeCurrency(e, settings, companies);
    return { code: settings.currency || 'USD', symbol: settings.currencySymbol || '$' };
  };
  const fmtAmt = (item, amt) => formatAmountWithCode(amt, item.currency || curOf(item).code);

  // Financial KPI only counts fully disbursed settlements (paid or legacy).
  // P2.2: totals stay segmented per currency, never merged — each currency on
  // its own line with an explicit code so mixed-currency totals never overlap.
  const totalEOSBPaid = summarizeCurrencySegmentsHtml(
    eosb
      .filter((item) => recordStatus(item) === 'paid')
      .map((item) => ({ code: item.currency || curOf(item).code, amount: Number(item.netSettlementAmount) || 0 }))
  );
  const settledCount = eosb.filter((item) => recordStatus(item) === 'paid').length;

  container.innerHTML = `
    <!-- Header -->
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:20px;">
      <div>
        <h2 style="font-size:20px; font-weight:800; color:var(--text-main);">${t('eosbTitle')}</h2>
        <p style="font-size:13px; color:var(--text-muted);">${t('eosbSub')}</p>
      </div>

      <div style="display:flex; align-items:center; gap:10px;">
        ${canProcess ? `
          <button type="button" class="btn btn-primary" id="btn-open-eosb-calc">
            ${Icons.plus(16)} ${isEn ? 'Calculate & Process New EOSB' : 'احتساب وتصفية نهاية خدمة جديدة'}
          </button>
        ` : ''}
      </div>
    </div>

    <!-- Summary KPI -->
    <div class="grid grid-cols-3" style="margin-bottom:20px;">
      <div class="card stat-card stat-success">
        <div>
          <div class="stat-label">${t('totalEosbSettled')}</div>
          <div class="stat-value" style="font-size:22px;">${totalEOSBPaid}</div>
          <div class="stat-sub">${isEn ? 'Only disbursed settlements (status: Paid)' : 'التسويات المصروفة فعلياً فقط (الحالة: مصروف)'}</div>
        </div>
        <div class="stat-icon-wrapper">${Icons.dollar(24)}</div>
      </div>

      <div class="card stat-card stat-primary">
        <div>
          <div class="stat-label">${t('totalSettledCases')}</div>
          <div class="stat-value">${settledCount}</div>
          <div class="stat-sub">${isEn ? 'Disbursed resignations & contract endings' : 'استقالات وإنهاء عقود تم صرفها'}</div>
        </div>
        <div class="stat-icon-wrapper">${Icons.users(24)}</div>
      </div>

      <div class="card stat-card stat-info">
        <div>
          <div class="stat-label">${isEn ? 'Pending Financial Audit' : 'بانتظار المراجعة المالية'}</div>
          <div class="stat-value" style="font-size:22px;">${eosb.filter((item) => recordStatus(item) === 'under_audit').length}</div>
          <div class="stat-sub">${isEn ? 'Awaiting approval, then payment' : 'بانتظار الاعتماد ثم الصرف'}</div>
        </div>
        <div class="stat-icon-wrapper">${Icons.shieldCheck(24)}</div>
      </div>
    </div>

    <!-- Settled Records Table -->
    <div class="card" style="padding:0; overflow:hidden;">
      <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between;">
        <div style="font-weight:700; font-size:15px; color:var(--text-main);">
          ${isEn ? 'End of Service Settlements & Clearances Record' : 'سجل تصفيات نهاية الخدمة والمخالصات الصادرة'}
        </div>
        <span class="badge badge-primary">${eosb.length} ${isEn ? 'settlements' : 'تسوية'}</span>
      </div>

      <div class="table-container" style="border:none;">
        <table class="table">
          <thead>
            <tr>
              <th>${t('att.employee')}</th>
              <th>${t('terminationReason')}</th>
              <th>${t('hireDateCol')}</th>
              <th>${t('reports.terminationDate')} / ${isEn ? 'Last Day' : 'آخر يوم دوام'}</th>
              <th>${t('servicePeriod')}</th>
              <th>${t('eosbAwardAmount')}</th>
              <th>${t('leaveCashoutAmount')}</th>
              <th>${t('netFinalSettlement')}</th>
              <th>${t('statusCol')}</th>
              <th>${isEn ? 'Actions' : 'الإجراءات'}</th>
              <th style="text-align:left;">${isEn ? 'Clearance & Print' : 'المخالصة والطباعة'}</th>
            </tr>
          </thead>
          <tbody id="eosb-table-body">
            ${
              eosb.length === 0
                ? `<tr><td colspan="11" style="text-align:center; padding:32px; color:var(--text-muted);">${isEn ? 'No EOSB settlements recorded yet. Click "Calculate & Process New EOSB" to start.' : 'لا توجد تصفيات نهاية خدمة مسجلة حالياً. اضغط "احتساب وتصفية نهاية خدمة جديدة" للبدء.'}</td></tr>`
                : eosb
                    .map((item) => {
                      const st = recordStatus(item);
                      const meta = statusMeta(item);
                      const clearanceLocked = st !== 'paid';
                      return `
                <tr data-eosb-id="${item.id}">
                  <td>
                    <strong>${item.employeeName}</strong>
                    <div style="font-size:11.5px; color:var(--text-muted);">${item.department}</div>
                  </td>
                  <td>
                    <span class="badge ${item.reason === 'resignation' ? 'badge-warning' : 'badge-primary'}" style="font-size:11.5px;">
                      ${reasonLabel(item.reason)}
                    </span>
                  </td>
                  <td>${formatDate(item.hireDate)}</td>
                  <td>${formatDate(item.lastWorkingDay || item.terminationDate)}</td>
                  <td>
                    ${item.settlementType === 'salary_bond' ? `<span class="badge badge-warning" style="font-size:11.5px;">${isEn ? 'Salary Bond' : 'سند راتب'}</span> ` : item.settlementType === 'salary_bond_plus_leave' ? `<span class="badge badge-info" style="font-size:11.5px;">${isEn ? 'Bond + Leave' : 'سند + إجازة'}</span> ` : ''}<strong style="color:var(--text-main);">${item.serviceYears} ${isEn ? 'yr' : 'سنة'} و ${item.serviceMonths} ${isEn ? 'mo' : 'شهر'}</strong></td>
                  <td>${fmtAmt(item, item.finalEOSBAmount)}</td>
                  <td><strong style="color:var(--primary);">${fmtAmt(item, item.leaveCompensationAmount)}</strong></td>
                  <td>
                    <strong style="color:var(--success); font-size:15px;">${fmtAmt(item, item.netSettlementAmount)}</strong>
                    ${Number(item.currencyMismatchLoanCount) > 0 ? `<div style="font-size:10.5px; color:var(--warning); margin-top:2px; line-height:1.5;">⚠️ ${Number(item.currencyMismatchLoanCount)} ${isEn ? 'advance(s) in a different currency not deducted' : 'سلفة بعملة مختلفة لم تُخصم'} (${item.salaryCurrency || ''})</div>` : ''}
                  </td>
                  <td>
                    <span class="badge ${meta.badge}">${isEn ? meta.en : meta.ar}</span>
                    ${item.approvedBy ? `<div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">${isEn ? 'Approved:' : 'اعتمد:'} ${item.approvedBy} ${item.approvedAt ? '· ' + formatDate(item.approvedAt) : ''}</div>` : ''}
                    ${item.paidBy ? `<div style="font-size:10.5px; color:var(--text-muted);">${isEn ? 'Paid:' : 'صرف:'} ${item.paidBy} ${item.paidAt ? '· ' + formatDate(item.paidAt) : ''}</div>` : ''}
                  </td>
<td>
                     <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                       ${st === 'under_audit' && canApproveEosb ? `
                         <button type="button" class="btn btn-sm btn-success btn-eosb-approve" title="${isEn ? 'Approve & finalize settlement' : 'اعتماد التسوية نهائياً'}">
                           ${Icons.check(14)} ${isEn ? 'Approve' : 'اعتماد'}
                         </button>
                         <button type="button" class="btn btn-sm btn-outline btn-eosb-reject" style="color:var(--danger);" title="${isEn ? 'Return to draft for revision' : 'إعادة للمراجعة (مسودة)'}">
                           ${Icons.x(14)} ${isEn ? 'Reject' : 'إرجاع'}
                         </button>
                       ` : ''}
                       ${st === 'approved' && canPayEosb ? `
                         <button type="button" class="btn btn-sm btn-success btn-eosb-pay" title="${isEn ? 'Disburse settlement payment' : 'صرف قيمة التصفية مالياً'}">
                           ${Icons.dollar(14)} ${isEn ? 'Disburse' : 'صرف'}
                         </button>
                       ` : ''}
                       ${st === 'paid' && canApproveEosb ? `
                         <button type="button" class="btn btn-sm btn-outline btn-eosb-cancel-payment" style="color:var(--danger); border-color:rgba(239,68,68,0.4);" title="${isEn ? 'Cancel payment, return to approved' : 'إلغاء الصرف، إعادة للمعتمد'}">
                           ${Icons.x(14)} ${isEn ? 'Cancel Payment' : 'إلغاء الصرف'}
                         </button>
                       ` : ''}
                       ${st === 'draft' && canApproveEosb ? `
                         <button type="button" class="btn btn-sm btn-outline btn-eosb-resubmit" title="${isEn ? 'Submit for financial audit' : 'إرسال للمراجعة المالية'}">
                           ${Icons.upload(14)} ${isEn ? 'Submit for Audit' : 'إرسال للمراجعة'}
                         </button>
                       ` : ''}
                       ${st === 'draft' && item.rejectedBy && canProcess ? `
                         <button type="button" class="btn btn-sm btn-outline btn-eosb-correct" style="color:var(--primary); border-color:rgba(59,130,246,0.4);" title="${isEn ? 'Recalculate after audit return and record a correction' : 'إعادة الاحتساب بعد إعادة التسوية للمراجعة وتسجيل التصحيح'}">
                           ${Icons.refresh(14)} ${isEn ? 'Recalc & Correct' : 'إعادة الاحتساب وتسجيل التصحيح'}
                         </button>
                       ` : ''}
                       ${(st === 'draft' || st === 'under_audit') && canApproveEosb ? `
<span style="font-size:11px; color:var(--text-muted);">
                             ${isEn ? (item.rejectedBy ? 'Rejected by: ' : '') : (item.rejectedBy ? 'أعادها: ' : '')}${item.rejectedBy || ''}${item.rejectedAt ? ' · ' + formatDate(item.rejectedAt) : ''}
                           </span>
                           ${item.rejectedBy && item.rejectionReason ? `<div style="font-size:10.5px; color:var(--warning); margin-top:2px;">${isEn ? 'Reason: ' : 'السبب: '}${item.rejectionReason}</div>` : ''}
                       ` : ''}
                     </div>
                   </td>
                  <td>
                    <div style="display:flex; align-items:center; gap:6px; justify-content:flex-end;" title="${clearanceLocked ? (isEn ? 'Clearance is issued only after approval & payment' : 'تُصدر المخالصة فقط بعد الاعتماد والصرف') : ''}">
                      <button type="button" class="btn btn-sm btn-outline btn-view-clearance" ${clearanceLocked ? 'disabled' : ''}>
                        ${Icons.printer(14)} ${isEn ? 'Clearance' : 'إخلاء الطرف'}
                      </button>
                      ${canDeleteEosb && st !== 'paid' ? `
                        <button type="button" class="btn btn-icon btn-sm btn-outline btn-delete-eosb" style="color:var(--danger);" title="${t('delete')}">
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

  // Attach Table actions
  container.querySelectorAll('#eosb-table-body tr').forEach((row) => {
    const eosbId = row.getAttribute('data-eosb-id');
    const record = eosb.find((r) => r.id === eosbId);

    row.querySelector('.btn-view-clearance')?.addEventListener('click', () => {
      if (!record) return;
      if (recordStatus(record) !== 'paid') {
        toast.warning(isEn ? 'Clearance is issued only after the settlement is approved and paid (status: Paid).' : 'تُصدر المخالصة فقط بعد اعتماد التصفية وصرفها مالياً (الحالة: مصروف).');
        return;
      }
      openClearanceCertificateModal(record, settings);
    });

    row.querySelector('.btn-eosb-approve')?.addEventListener('click', () => {
      if (!canApproveEosb) return;
      showConfirmDialog({
        title: isEn ? 'Approve Settlement' : 'اعتماد التسوية',
        message: isEn
          ? `Finalize the settlement for ${record.employeeName}? The employee will be marked ${record.reason === 'resignation' ? 'Resigned' : 'Terminated'} and the settlement becomes ready for payment.`
          : `هل تريد اعتماد تصفية ${record.employeeName} نهائياً؟ سيتم تحديث حالة الموظف إلى ${record.reason === 'resignation' ? 'استقال' : 'منهي خدمته'} وتصبح التسوية جاهزة للصرف.`,
        confirmText: isEn ? 'Yes, Approve' : 'نعم، اعتمد',
        onConfirm: () => {
          const res = transitionEosbGuarded(storage.getActiveUser(), record, 'approved', { reason: 'approved' });
          if (guardFailed(res)) return;
          storage.persistEosb(res.batch);
          // Mark the employee resigned/terminated at approval time (workflow step).
          const emp = storage.getState().employees.find((e) => e.id === record.employeeId);
          if (emp) {
            const newStatus = ['resignation', 'non_renewal_by_employee', 'retirement'].includes(record.reason) ? 'resigned' : 'terminated';
            storage.updateEmployee({ ...emp, status: newStatus });
          }
          storage.addAudit('approve', 'eosb', `${record.employeeName} — ${fmtAmt(record, res.batch.netSettlementAmount)}`, record.id);
          toast.success(isEn ? `Settlement approved for ${record.employeeName}. It is now ready for payment.` : `تم اعتماد تصفية ${record.employeeName}، وهي الآن جاهزة للصرف.`);
          renderEOSBView(container);
        },
      });
    });

    row.querySelector('.btn-eosb-reject')?.addEventListener('click', () => {
      if (!canApproveEosb) return;
      showConfirmDialog({
        title: isEn ? 'Reject Settlement' : 'إرجاع التسوية',
        message: isEn
          ? `Return the settlement for ${record.employeeName} to draft? It must be reviewed and corrected before re-submission.`
          : `هل تريد إرجاع التصفية الخاصة بـ ${record.employeeName} إلى المسودة للمراجعة والتصحيح؟`,
        confirmText: isEn ? 'Yes, Return' : 'نعم، أعد للمراجعة',
        onConfirm: () => {
          const res = transitionEosbGuarded(storage.getActiveUser(), record, 'draft', { rejectionReason: isEn ? 'returned for review and correction' : 'أُعيدت للمراجعة والتصحيح' });
          if (guardFailed(res)) return;
          storage.persistEosb(res.batch);
          storage.addAudit('reject', 'eosb', `${record.employeeName} — ${isEn ? 'returned to draft' : 'أُعيد للمراجعة'}`, record.id);
          toast.warning(isEn ? `Settlement returned to draft for ${record.employeeName}.` : `تم إرجاع تصفية ${record.employeeName} للمراجعة.`);
          renderEOSBView(container);
        },
      });
    });

    row.querySelector('.btn-eosb-pay')?.addEventListener('click', () => {
      if (!canPayEosb) return;
      showConfirmDialog({
        title: isEn ? 'Disburse Settlement' : 'صرف التسوية',
        message: isEn
          ? `Disburse ${fmtAmt(record, record.netSettlementAmount)} to ${record.employeeName}? After payment the settlement is marked as Paid and the clearance certificate can be issued.`
          : `هل تريد صرف مبلغ ${fmtAmt(record, record.netSettlementAmount)} إلى ${record.employeeName}؟ بعد الصرف تُحال التسوية إلى "مصروف" ويمكن إصدار المخالصة.`,
        confirmText: isEn ? 'Yes, Disburse' : 'نعم، اصرف',
        onConfirm: () => {
          const res = disburseEosbAtomic({
            user: storage.getActiveUser(),
            record,
            storage,
            by: storage.getActiveUser()?.name,
          });
          if (guardFailed(res)) return;
          const settledCount = (res.settledLoans || []).length;
          const loanMsg = settledCount > 0
            ? (isEn ? ` (${settledCount} outstanding loans settled and closed)` : ` (تمت تسوية وإغلاق ${settledCount} سلفة/قرض)`)
            : '';
          toast.success(isEn ? `Settlement of ${fmtAmt(record, res.batch.netSettlementAmount)} disbursed to ${record.employeeName}.${loanMsg}` : `تم صرف ${fmtAmt(record, res.batch.netSettlementAmount)} إلى ${record.employeeName}.${loanMsg}`);
          renderEOSBView(container);
        },
      });
    });

    row.querySelector('.btn-eosb-resubmit')?.addEventListener('click', () => {
      if (!canApproveEosb) return;
      const res = transitionEosbGuarded(storage.getActiveUser(), record, 'under_audit', { reason: 'resubmitted for audit' });
      if (guardFailed(res)) return;
      storage.persistEosb(res.batch);
      storage.addAudit('generate', 'eosb', `${record.employeeName} — ${isEn ? 're-submitted for audit' : 'أُعيد إرساله للمراجعة'}`, record.id);
      toast.success(isEn ? `Settlement re-submitted for financial audit.` : 'أُعيد إرسال التصفية للمراجعة المالية.');
      renderEOSBView(container);
    });

    row.querySelector('.btn-eosb-correct')?.addEventListener('click', () => {
      if (!canProcess) return;
      const emp = employees.find((e) => e.id === record.employeeId);
      openEOSBCalculatorModal(emp, () => renderEOSBView(container), {
        previewOnly: true,
        onResult: (fresh) => {
          // The calculator returns a FRESH, history-less object — re-bind it
          // to the returned settlement and record the correction through the
          // guarded layer so no sealed history can ever be lost.
          const res = recordEosbCorrectionGuarded(storage.getActiveUser(), record, fresh, { reason: isEn ? 'recalculation after audit return' : 'إعادة احتساب بعد إعادة التسوية للمراجعة' });
          if (guardFailed(res)) return;
          storage.persistEosb(res.batch);
          storage.addAudit('correct', 'eosb', `${record.employeeName} — ${isEn ? 'correction recorded after audit return' : 'تم تسجيل التصحيح بعد إعادة التسوية للمراجعة'}`, record.id);
          toast.success(isEn ? 'Correction recorded. The settlement stays returned until re-submitted.' : 'تم تسجيل التصحيح. تبقى التسوية معادة للمراجعة حتى إعادة الإرسال.');
          renderEOSBView(container);
        },
      });
    });

    row.querySelector('.btn-eosb-cancel-payment')?.addEventListener('click', () => {
      if (!canApproveEosb) return;
      showConfirmDialog({
        title: isEn ? 'Cancel Payment' : 'إلغاء عملية الصرف',
        message: isEn
          ? `Cancel the payment for ${record.employeeName}? This will return the settlement to 'Approved' status (unpaid) and clear the payment record.`
          : `هل تريد إلغاء صرف ${record.employeeName}؟ سيتم إعادة التصفية إلى حالة "معتمد" (غير مصروف) ومسح سجل الصرف.`,
        confirmText: isEn ? 'Yes, Cancel Payment' : 'نعم، ألغِ الصرف',
        onConfirm: () => {
          const res = cancelEosbPaymentAtomic({
            user: storage.getActiveUser(),
            record,
            storage,
            by: storage.getActiveUser()?.name,
          });
          if (guardFailed(res)) return;
          toast.warning(isEn ? 'Payment cancelled. Settlement returned to Approved status.' : 'تم إلغاء الصرف. أُعيدت التصفية لحالة معتمد.');
          renderEOSBView(container);
        },
      });
    });

    row.querySelector('.btn-delete-eosb')?.addEventListener('click', () => {
      if (!canDeleteEosb) return;
      if (deleteEosbGuarded(storage.getActiveUser(), record).ok === false) {
        toast.error(isEn ? 'Paid settlements cannot be deleted for audit integrity.' : 'لا يمكن حذف تسوية تم صرفها حفاظاً على سلامة السجلات المالية.');
        return;
      }
      showConfirmDialog({
        title: isEn ? 'Delete Settlement Record' : 'حذف سجل التصفية',
        message: isEn ? 'Are you sure you want to delete this EOSB settlement record?' : 'هل أنت متأكد من حذف سجل تصفية نهاية الخدمة هذا؟',
        confirmText: isEn ? 'Yes, Delete' : 'نعم، حذف',
        onConfirm: () => {
          storage.deleteEOSB(eosbId);
          storage.addAudit('delete', 'eosb', `${record.employeeName} — EOSB`, eosbId);
          toast.success(isEn ? 'Settlement record deleted' : 'تم حذف سجل التصفية');
          renderEOSBView(container);
        },
      });
    });
  });

  // Action Button
  container.querySelector('#btn-open-eosb-calc')?.addEventListener('click', () => {
    if (!canProcess) return;
    openEOSBCalculatorModal(null, () => renderEOSBView(container));
  });

  if (options.openEOSBModal && canProcess) {
    openEOSBCalculatorModal(null, () => renderEOSBView(container));
  }
}
