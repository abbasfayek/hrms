// =========================================================
// Phase 9 — Post-payment Correction Request Modal
// ---------------------------------------------------------
// Creates a correction request on an ARCHIVED + PAID payroll
// (Decision 8 three-column preview, §11.10 component lines,
// L1/L4/L5 enforcement via createPayrollCorrectionGuarded).
// The number is assigned by storage at insert (Decision 7).
// =========================================================

import { storage } from '../storage.js';
import { createModal } from './Modal.js';
import { formatAmountWithCode, escapeHtml, can, formatDate } from '../types.js';
import { t, i18n } from '../i18n.js';
import { toast } from './Toast.js';
import { COMPONENT_CATALOG, correctionDisplayNumber } from '../engines/payrollCorrectionModel.js';
import { createCorrection, computeNetEffective } from '../engines/payrollCorrectionEngine.js';
import { createPayrollCorrectionGuarded } from '../engines/payrollCorrectionAccess.js';

export function openPayrollCorrectionModal({ original, onSaved, existingCorrection = null }) {
  const state = storage.getState();
  const { settings } = state;
  const isEn = i18n.getLang() === 'en';
  const isResubmit = Boolean(existingCorrection);

  if (!original || original.archived !== true || original.status !== 'paid') {
    toast.error(isEn ? 'Corrections can only be created on an archived, paid payroll.' : 'يمكن إنشاء التصحيحات على مسيرات مؤرشفة ومصروفة فقط.');
    return;
  }
  const items = Array.isArray(original.items) ? original.items : [];
  if (!items.length) {
    toast.error(isEn ? 'This archived payroll is a summary-only record (no employee lines) — corrections are unavailable.' : 'مسير الرواتب المؤرشف هذا هو سجل ملخص فقط (بدون بنود موظفين) — التصحيحات غير متاحة.');
    return;
  }

  let overlayEl = null;
  const rows = [];
  const pushRow = () => {
    rows.push({ employeeId: items[0].employeeId, componentCode: 'OVERTIME', quantity: 1, rate: '', reason: '', sourceRef: '', sourceOther: '', manual: false });
  };

  const componentOptions = () => {
    let html = '';
    Object.keys(COMPONENT_CATALOG).forEach((code) => {
      const c = COMPONENT_CATALOG[code];
      html += `<option value="${code}">${code} — ${isEn ? 'rate-based' : 'قائم على المعدل'} ${isEn ? '(' + c.calc + ')' : ''}</option>`;
    });
    html += `<option value="__OTHER__">OTHER_... ${isEn ? '(custom, needs source)' : '(مخصص، يتطلب مصدراً)'}</option>`;
    return html;
  };

  const nextNumber = isResubmit
    ? (existingCorrection.displayNumber || existingCorrection.correctionId)
    : correctionDisplayNumber(original.id, storage.getCorrections(original.id).length + 1);

  const bodyHtml = `
    <form id="pc-form">
      ${isResubmit ? `
      <div class="alert-box" style="margin-bottom:14px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.3); padding:12px 16px; border-radius:8px;">
        <div style="font-weight:700; color:#dc2626; font-size:13.5px;">⚠️ ${isEn ? 'Rejection Reason / Auditor Note:' : 'سبب الرفض / ملاحظة التدقيق:'}</div>
        <div style="font-size:13px; color:var(--text-main); margin-top:4px; font-weight:600;">${escapeHtml(existingCorrection.rejectionReason || (isEn ? 'Returned for revision' : 'أُعيد للمراجعة والتصحيح'))}</div>
        ${existingCorrection.rejectedBy ? `<div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">${isEn ? 'Returned by' : 'أعاده'}: <strong>${escapeHtml(existingCorrection.rejectedBy)}</strong> • ${formatDate(existingCorrection.rejectedAt)}</div>` : ''}
      </div>
      ` : ''}

      <div class="card" style="padding:12px 14px; background:var(--bg-card-hover); border:1px solid var(--border-color); margin-bottom:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <div style="font-weight:800; font-size:14px; color:var(--text-main);">${isEn ? 'Original (archived, paid)' : 'المسير الأصلي (مؤرشف ومصروف)'}</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:3px;">
              ${original.month} — ${formatAmountWithCode(Number(original.totalNet) || 0, (original.totalsByCurrency && original.totalsByCurrency.length === 1 && original.totalsByCurrency[0].code) || '')}
            </div>
          </div>
          <span class="badge badge-purple">${isResubmit ? (isEn ? 'Correction number' : 'رقم التصحيح') : (isEn ? 'Next number' : 'الرقم التالي')}: <strong style="direction:ltr; unicode-bidi:embed;">${escapeHtml(nextNumber)}</strong></span>
        </div>
      </div>

      <div class="grid grid-cols-3">
        <div class="form-group">
          <label class="form-label">${isEn ? 'Direction' : 'الاتجاه'} *</label>
          <select class="form-select" id="pc-direction" required>
            <option value="credit">${isEn ? 'Credit (add positive amount)' : 'إضافة (مبلغ موجب)'}</option>
            <option value="debit">${isEn ? 'Debit (recover from employee)' : 'خصم (استرداد من الموظف)'}</option>
          </select>
        </div>
        <div class="form-group" id="pc-recovery-wrap" style="display:none;">
          <label class="form-label">${isEn ? 'Recovery method' : 'طريقة الاسترداد'} *</label>
          <select class="form-select" id="pc-recovery">
            <option value="next_payroll">${isEn ? 'Next payroll (deduct on next run)' : 'الراتب التالي (خصم من المسير القادم)'}</option>
            <option value="separate_recovery">${isEn ? 'Separate recovery settlement' : 'تسوية استرداد منفصلة'}</option>
            <option value="write_off">${isEn ? 'Write-off (elevated authority)' : 'شطب (سلطة معززة)'}</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${isEn ? 'Rate source' : 'مصدر سعر الصرف'}</label>
          <select class="form-select" id="pc-rate-policy">
            <option value="original">${isEn ? 'Original snapshot (default, Decision 1)' : 'السعر المختوم الأصلي (الافتراضي)'}</option>
            <option value="current">${isEn ? 'Current live rate (explicit override)' : 'السعر الحالي (تجاوز صريح)'}</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${isEn ? 'Overall reason (mandatory)' : 'السبب العام (إلزامي)'} *</label>
        <textarea class="form-input" id="pc-reason" rows="2" required placeholder="${isEn ? 'Why is this correction needed?' : 'لماذا هذا التصحيح مطلوب؟'}"></textarea>
      </div>

      <div class="form-group">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <label class="form-label" style="margin:0;">${isEn ? 'Component lines (min 1, §11.10)' : 'بنود المكونات (حد أدنى بند واحد)'}</label>
          <button type="button" class="btn btn-outline btn-sm" id="pc-add-row">+ ${isEn ? 'Add line' : 'إضافة بند'}</button>
        </div>
        <div class="table-container" style="border:1px solid var(--border-color); border-radius:8px;">
          <table class="table" style="min-width:860px;">
            <thead>
              <tr>
                <th style="min-width:140px;">${isEn ? 'Employee' : 'الموظف'}</th>
                <th style="min-width:130px;">${isEn ? 'Component' : 'المكون'}</th>
                <th style="min-width:70px;">${isEn ? 'Qty' : 'الكمية'}</th>
                <th style="min-width:80px;">${isEn ? 'Rate' : 'المعدل'}</th>
                <th style="min-width:130px;">${isEn ? 'Reason' : 'السبب'}</th>
                <th style="min-width:120px;">${isEn ? 'Source ref' : 'مرجع المصدر'}</th>
                <th style="min-width:60px;">${isEn ? 'Manual' : 'يدوي'}</th>
                <th style="min-width:110px;">${isEn ? 'Amount' : 'المبلغ'}</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="pc-rows"></tbody>
          </table>
        </div>
      </div>

      <div class="card" style="padding:12px 14px; background:var(--bg-card-hover); border:1px solid var(--border-color);">
        <div style="font-weight:700; font-size:13px; color:var(--text-main); margin-bottom:8px;">📊 ${isEn ? 'Net / Effective preview (Decision 8)' : 'معاينة صافي/فعال (القرار 8)'}</div>
        <div style="display:flex; gap:18px; flex-wrap:wrap; font-size:12.5px;">
          <div>${isEn ? 'Original' : 'الأصلي'}: <strong id="pc-prev-original">${formatAmountWithCode(Number(original.totalNet) || 0, '')}</strong></div>
          <div>${isEn ? 'Corrections' : 'التصحيحات'}: <strong id="pc-prev-corr">0.00</strong></div>
          <div>${isEn ? 'Net / Effective' : 'صافي / فعال'}: <strong id="pc-prev-net" style="color:var(--primary);">0.00</strong></div>
        </div>
        <div id="pc-prev-lines" style="margin-top:6px; color:var(--text-muted);"></div>
      </div>
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn ${isResubmit ? 'btn-success' : 'btn-primary'} submit-pc-btn">${isResubmit ? (isEn ? 'Resubmit' : 'إعادة إرسال') : (isEn ? 'Create Correction Request' : 'إنشاء طلب تصحيح')}</button>
  `;

  function rowHtml(row, i) {
    const empOptions = items
      .map((it) => `<option value="${escapeHtml(it.employeeId)}" ${it.employeeId === row.employeeId ? 'selected' : ''}>${escapeHtml(it.employeeName || it.employeeId)}</option>`)
      .join('');
    return `
      <tr data-pc-row="${i}">
        <td><select class="form-select" id="pc-emp-${i}" style="min-width:130px;">${empOptions}</select></td>
        <td>
          <select class="form-select" id="pc-comp-${i}">${componentOptions()}</select>
          <input type="text" class="form-input" id="pc-other-${i}" placeholder="OTHER_XXX" style="display:none; margin-top:4px; direction:ltr; unicode-bidi:embed;" value="${escapeHtml(row.sourceOther || '')}">
        </td>
        <td><input type="number" class="form-input" id="pc-qty-${i}" value="${row.quantity}" min="0" step="any" style="width:70px;"></td>
        <td><input type="number" class="form-input" id="pc-rate-${i}" value="${row.rate}" min="0" step="any" style="width:80px;"></td>
        <td><input type="text" class="form-input" id="pc-lreason-${i}" value="${escapeHtml(row.reason)}" style="min-width:120px;"></td>
        <td><input type="text" class="form-input" id="pc-src-${i}" value="${escapeHtml(row.sourceRef)}" placeholder="REC-…" style="min-width:100px;"></td>
        <td style="text-align:center;"><input type="checkbox" id="pc-manual-${i}" ${row.manual ? 'checked' : ''}></td>
        <td id="pc-line-total-${i}" style="direction:ltr; unicode-bidi:embed; text-align:right; color:var(--text-main); font-weight:700;">—</td>
        <td><button type="button" class="btn btn-sm btn-outline pc-remove-row" style="color:var(--danger);">✕</button></td>
      </tr>
    `;
  }

  function buildInput() {
    const components = rows.map((r, i) => {
      const compSelect = overlayEl.querySelector(`#pc-comp-${i}`);
      const selected = compSelect ? compSelect.value : r.componentCode;
      const code = selected === '__OTHER__' ? (r.sourceOther || '').trim() : selected;
      return {
        employeeId: r.employeeId,
        employeeName: ((original.items || []).find((it) => it.employeeId === r.employeeId) || {}).employeeName || null,
        componentCode: code,
        quantity: Number(r.quantity) || 1,
        rateOrRuleRef: Number(r.rate) || 0,
        reason: (r.reason || '').trim(),
        sourceRef: (r.sourceRef || '').trim() || null,
        manualEntry: Boolean(r.manual),
      };
    }).filter((c) => c.componentCode);
    const direction = overlayEl.querySelector('#pc-direction').value;
    return {
      originalBatch: original,
      originalTransactionId: original.id,
      direction,
      recovery: direction === 'debit' ? { method: overlayEl.querySelector('#pc-recovery').value } : undefined,
      ratePolicy: { mode: overlayEl.querySelector('#pc-rate-policy').value },
      reason: overlayEl.querySelector('#pc-reason').value.trim(),
      description: '',
      components,
      manualEntry: rows.some((r) => r.manual),
    };
  }

  function updatePreview() {
    const input = buildInput();
    const built = createCorrection(input, { original, settings, user: state.currentUser });
    if (built.ok) {
      const net = computeNetEffective(original, [built.correction]);
      overlayEl.querySelector('#pc-prev-original').innerHTML = (original.totalsByCurrency && original.totalsByCurrency.length
        ? original.totalsByCurrency.map((g) => formatAmountWithCode(g.net, g.code)).join(' + ')
        : formatAmountWithCode(Number(original.totalNet) || 0, ''));
      overlayEl.querySelector('#pc-prev-corr').innerHTML = net && net.currencies ? net.currencies.map((g) => formatAmountWithCode(g.correctionsNet, g.code)).join(' + ') : '0.00';
      overlayEl.querySelector('#pc-prev-net').innerHTML = net && net.currencies ? net.currencies.map((g) => formatAmountWithCode(g.net, g.code)).join(' + ') : '0.00';
      overlayEl.querySelector('#pc-prev-lines').innerHTML = built.correction.components.map((l) => {
        const sign = (l.direction || input.direction) === 'debit' ? '−' : '+';
        return `<div style="direction:ltr; unicode-bidi:embed;">${sign} ${formatAmountWithCode(Number(l.calculatedAmount) || 0, l.currency)} — ${escapeHtml(l.componentCode)} · ${escapeHtml(l.employeeName || l.employeeId)}</div>`;
      }).join('') || '—';
      built.correction.components.forEach((l, idx) => {
        const cell = overlayEl.querySelector(`#pc-line-total-${idx}`);
        if (cell) cell.innerHTML = formatAmountWithCode(Number(l.calculatedAmount) || 0, l.currency);
      });
    } else {
      overlayEl.querySelector('#pc-prev-corr').innerHTML = built.error ? `⚠ ${escapeHtml(built.error)}` : '0.00';
      overlayEl.querySelector('#pc-prev-lines').innerHTML = '';
    }
  }

  function wireRow(i) {
    const row = rows[i];
    const refresh = updatePreview;
    overlayEl.querySelector(`#pc-emp-${i}`).addEventListener('change', (e) => { row.employeeId = e.target.value; refresh(); });
    overlayEl.querySelector(`#pc-comp-${i}`).addEventListener('change', (e) => {
      row.componentCode = e.target.value;
      const other = overlayEl.querySelector(`#pc-other-${i}`);
      if (other) other.style.display = e.target.value === '__OTHER__' ? 'block' : 'none';
      refresh();
    });
    overlayEl.querySelector(`#pc-other-${i}`).addEventListener('input', (e) => { row.sourceOther = e.target.value; refresh(); });
    overlayEl.querySelector(`#pc-qty-${i}`).addEventListener('input', (e) => { row.quantity = e.target.value; refresh(); });
    overlayEl.querySelector(`#pc-rate-${i}`).addEventListener('input', (e) => { row.rate = e.target.value; refresh(); });
    overlayEl.querySelector(`#pc-lreason-${i}`).addEventListener('input', (e) => { row.reason = e.target.value; });
    overlayEl.querySelector(`#pc-src-${i}`).addEventListener('input', (e) => { row.sourceRef = e.target.value; refresh(); });
    overlayEl.querySelector(`#pc-manual-${i}`).addEventListener('change', (e) => { row.manual = e.target.checked; refresh(); });
    overlayEl.querySelector(`.pc-remove-row`).addEventListener('click', () => {
      if (rows.length === 1) {
        toast.info(isEn ? 'A correction needs at least one line.' : 'يتطلب التصحيح بنداً واحداً على الأقل.');
        return;
      }
      rows.splice(i, 1);
      renderRows();
      rows.forEach((_, x) => wireRow(x));
      updatePreview();
    });
  }

  function renderRows() {
    overlayEl.querySelector('#pc-rows').innerHTML = rows.map(rowHtml).join('');
  }

  createModal({
    title: isResubmit
      ? `${isEn ? 'Correct & Resubmit Request' : 'تصحيح وإعادة إرسال طلب التصحيح'} — ${escapeHtml(nextNumber)}`
      : `${isEn ? 'New Correction Request' : 'طلب تصحيح جديد'} — ${original.month}`,
    size: 'lg',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      overlayEl = overlay;
      overlay.querySelector('.close-modal-btn').addEventListener('click', close);

      if (isResubmit && Array.isArray(existingCorrection.components) && existingCorrection.components.length > 0) {
        existingCorrection.components.forEach((c) => {
          rows.push({
            employeeId: c.employeeId,
            componentCode: c.componentCode && c.componentCode.startsWith('OTHER_') ? '__OTHER__' : c.componentCode,
            quantity: c.quantity != null ? c.quantity : 1,
            rate: c.rateOrRuleRef != null ? c.rateOrRuleRef : '',
            reason: c.reason || '',
            sourceRef: c.sourceRef || '',
            sourceOther: c.componentCode && c.componentCode.startsWith('OTHER_') ? c.componentCode : '',
            manual: Boolean(c.manualEntry),
          });
        });
      } else {
        pushRow();
      }

      renderRows();
      rows.forEach((_, i) => wireRow(i));

      if (isResubmit) {
        if (existingCorrection.direction) overlay.querySelector('#pc-direction').value = existingCorrection.direction;
        const wrap = overlay.querySelector('#pc-recovery-wrap');
        if (wrap) wrap.style.display = existingCorrection.direction === 'debit' ? 'block' : 'none';
        if (existingCorrection.recovery?.method && overlay.querySelector('#pc-recovery')) {
          overlay.querySelector('#pc-recovery').value = existingCorrection.recovery.method;
        }
        if (existingCorrection.ratePolicy?.mode && overlay.querySelector('#pc-rate-policy')) {
          overlay.querySelector('#pc-rate-policy').value = existingCorrection.ratePolicy.mode;
        }
        if (existingCorrection.reason && overlay.querySelector('#pc-reason')) {
          overlay.querySelector('#pc-reason').value = existingCorrection.reason;
        }
      }

      updatePreview();

      overlay.querySelector('#pc-direction').addEventListener('change', (e) => {
        const wrap = overlay.querySelector('#pc-recovery-wrap');
        wrap.style.display = e.target.value === 'debit' ? 'block' : 'none';
        updatePreview();
      });
      overlay.querySelector('#pc-rate-policy').addEventListener('change', updatePreview);
      overlay.querySelector('#pc-reason').addEventListener('input', updatePreview);
      overlay.querySelector('#pc-add-row').addEventListener('click', () => {
        pushRow();
        renderRows();
        wireRow(rows.length - 1);
        updatePreview();
      });

      overlay.querySelector('.submit-pc-btn').addEventListener('click', () => {
        const form = overlay.querySelector('#pc-form');
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }
        const input = buildInput();
        const hasManual = input.manualEntry;

        if (isResubmit) {
          const built = createCorrection(input, { original, settings, user: state.currentUser });
          if (!built.ok) {
            toast.error(built.error || (isEn ? 'Correction refused.' : 'رُفض التصحيح.'));
            return;
          }
          const now = new Date().toISOString();
          const actor = storage.getActiveUser()?.name || (isEn ? 'HR Officer' : 'مسؤول الموارد البشرية');
          const newRevision = (Number(existingCorrection.revision) || 1) + 1;

          // Snapshot of rejected state
          const prevSnapshot = {
            revision: existingCorrection.revision || 1,
            rejectedAt: existingCorrection.rejectedAt || now,
            rejectedBy: existingCorrection.rejectedBy || '',
            rejectionReason: existingCorrection.rejectionReason || '',
            direction: existingCorrection.direction,
            reason: existingCorrection.reason,
            components: existingCorrection.components,
          };

          // Track deltas (differences)
          const changes = [];
          const oldComps = existingCorrection.components || [];
          const newComps = built.correction.components || [];
          newComps.forEach((nc, idx) => {
            const oc = oldComps[idx];
            if (!oc || oc.calculatedAmount !== nc.calculatedAmount || oc.componentCode !== nc.componentCode) {
              changes.push({
                employeeId: nc.employeeId,
                componentCode: nc.componentCode,
                oldAmount: oc ? oc.calculatedAmount : 0,
                newAmount: nc.calculatedAmount,
              });
            }
          });

          const updatedCorrection = {
            ...existingCorrection,
            direction: input.direction,
            recovery: input.recovery,
            ratePolicy: input.ratePolicy,
            reason: input.reason,
            components: built.correction.components,
            manualEntry: input.manualEntry,
            revision: newRevision,
            status: 'under_audit',
            returnState: 'resubmitted',
            resubmittedBy: actor,
            resubmittedAt: now,
            correctedBy: actor,
            correctedAt: now,
            rejectionHistory: [
              ...(Array.isArray(existingCorrection.rejectionHistory) ? existingCorrection.rejectionHistory : []),
              prevSnapshot,
            ],
            resubmissionDeltas: [
              ...(Array.isArray(existingCorrection.resubmissionDeltas) ? existingCorrection.resubmissionDeltas : []),
              {
                fromRevision: existingCorrection.revision || 1,
                toRevision: newRevision,
                correctedAt: now,
                correctedBy: actor,
                changes,
              },
            ],
          };

          storage.addPayrollCorrection(updatedCorrection);
          storage.addAudit('resubmit', 'payroll', `${updatedCorrection.displayNumber || updatedCorrection.correctionId} → ${isEn ? 'resubmitted after correction' : 'أُعيد إرساله بعد التصحيح'}`, updatedCorrection.correctionId);
          toast.success(isEn ? 'Correction request corrected and resubmitted to Financial Audit.' : 'تم تصحيح طلب التصحيح وإعادة إرساله للتدقيق المالي.');
          close();
          if (onSaved) onSaved(updatedCorrection);
          return;
        }

        if (!can(state.currentUser, 'payroll.correction.create')) {
          toast.error(isEn ? 'You need the create-correction permission.' : 'تحتاج صلاحية إنشاء التصحيح.');
          return;
        }
        const res = createPayrollCorrectionGuarded(state.currentUser, input, {
          settings,
          context: { companyId: storage.getSelectedCompanyId(), branchId: storage.getSelectedBranchId() },
          existingCorrections: storage.getCorrections(original.id),
        });
        if (!res.ok) {
          toast.error(res.error || (isEn ? 'Correction refused.' : 'رُفض التصحيح.'));
          return;
        }
        storage.addPayrollCorrection(res.correction);
        storage.addAudit('correction', 'payroll', isEn ? `Correction request ${res.correction.displayNumber || ''} created on ${original.month}` : `طلب تصحيح ${res.correction.displayNumber || ''} على ${original.month}`, res.correction.correctionId);
        toast.success(`${isEn ? 'Correction request created' : 'تم إنشاء طلب التصحيح'}: ${res.correction.displayNumber || ''}${hasManual ? (isEn ? ' (manual line)' : ' (بند يدوي)') : ''}`);
        close();
        if (onSaved) onSaved(res.correction);
      });
    },
  });
}