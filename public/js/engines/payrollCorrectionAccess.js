// =========================================================
// Phase 9 (Spec v2.1) — Archived-Payroll Correction Guard layer
// =========================================================
// Every correction action — create, submit/resubmit, approve, co-approve,
// reject, disburse, archive — passes the SAME stacked guards as payroll
// (permission → scope → context → state/business):
//   1. permission   — dedicated accuracy permissions for create/manual/write-off
//                     (payroll.correction.*); work-flow steps reuse the matching
//                     payroll transitions (payroll.submit/approve/reject/disburse/archive).
//   2. scope        — the correction (inherited from its original) must belong to
//                     the acting user's assigned company/branch scope.
//   3. context      — the LIVE branch context at execution time must match the
//                     inherited identity; identity-less corrections are refused
//                     before they ever reach the engine (§11.11).
//   4. state/business — the engine state machine + the approved business rules:
//                     archived original only, correction window, one-open-per-original
//                     conflict, segregation of duties and dual approval for debits.
// Denials are reported through a storage-registered audit hook (never a success
// event). Imports only types + engine (acyclic).

import { can } from '../types.js';
import { userScope } from './payrollAccess.js';
import {
  createCorrection,
  transitionCorrection,
  coApproveCorrection,
  archiveCorrection,
  resolveCorrectionWindow,
  isCorrectionOpen,
  canTransitionCorrection,
} from './payrollCorrectionEngine.js';

let auditCorrectionDeniedHook = null;
export function setAuditCorrectionDeniedHook(fn) {
  auditCorrectionDeniedHook = typeof fn === 'function' ? fn : null;
}

function reportDenied(action, record, gate, opts = {}) {
  try {
    if (auditCorrectionDeniedHook) {
      const scope = recordScopeOf(record);
      auditCorrectionDeniedHook({
        action,
        recordId: record && (record.correctionId || record.id || record.month || null),
        correctionId: record && record.correctionId ? String(record.correctionId) : null,
        originalTransactionId: scope.originalTransactionId,
        fromStatus: record ? (record.status || 'draft') : 'draft',
        companyId: scope.companyId,
        branchId: scope.branchId,
        payrollPeriodId: scope.payrollPeriodId,
        employeeId: opts.employeeId || null,
        error: gate.error,
        layer: gate.layer,
        reason: gate.error,
      });
    }
  } catch (e) { /* a failed audit attempt must never mask the denial itself */ }
}

function recordScopeOf(record) {
  if (!record || typeof record !== 'object') return { companyId: '', branchId: '', payrollPeriodId: null, originalTransactionId: null };
  const first = (Array.isArray(record.components) && record.components.length)
    ? record.components[0]
    : ((Array.isArray(record.items) && record.items.length) ? record.items[0] : null);
  return {
    companyId: String(record.companyId || (first && first.companyId) || ''),
    branchId: String(record.branchId || (first && first.branchId) || ''),
    payrollPeriodId: record.payrollPeriodId || record.month || null,
    originalTransactionId: record.originalTransactionId || record.id || null,
  };
}

function isCreator(user, correction, byName) {
  if (!correction) return false;
  const userId = user && (user.id || user.username);
  const userName = user && (user.name || user.username || user.role);
  return Boolean(
    (correction.createdBy && userId && String(correction.createdBy) === String(userId))
    || (correction.createdByName && byName && String(correction.createdByName) === String(byName))
    || (correction.createdByName && userName && String(correction.createdByName) === String(userName)),
  );
}

function isSameActor(user, correction, byName) {
  if (!correction || correction.approvedBy == null) return false;
  const userName = user && (user.name || user.username || user.role);
  return Boolean(
    String(correction.approvedBy) === String(byName || userName || ''),
  );
}

/** The permission required to perform each correction action. */
export const CORRECTION_ACTION_PERMISSIONS = {
  create: 'payroll.correction.create',
  manual: 'payroll.correction.manual',
  writeOff: 'payroll.correction.writeOff',
  coApprove: 'payroll.correction.coApprove',
  // Correction submission/resubmission is driven by the correction's OWN
  // permission (a correction author without payroll.submit — e.g. the
  // elevated write-off owner — still advances its request through the queue).
  submit: 'payroll.correction.create',
  approve: 'payroll.approve',
  reject: 'payroll.reject',
  disburse: 'payroll.disburse',
  archive: 'payroll.archive',
};

/** Map a state-machine destination to the correction action that performs it. */
export const CORRECTION_TRANSITION_ACTION = {
  under_audit: 'submit',
  approved: 'approve',
  rejected: 'reject',
  paid: 'disburse',
};

/**
 * The core guard: permission → scope → context. `record` is either the original
 * payroll batch (creation) or a correction record (transitions). Business/state
 * rules are layered on top by the individual guarded entry points.
 */
export function requirePayrollCorrectionAction(user, action, record, opts = {}) {
  const perm = CORRECTION_ACTION_PERMISSIONS[action];
  if (!perm) return { ok: false, error: `unknown_action:${action}`, layer: 'permission' };
  if (!can(user, perm)) return { ok: false, error: `forbidden_action:${action}`, layer: 'permission' };

  if (user && user.role === 'super_admin') return { ok: true };

  const scope = userScope(user);
  const rec = recordScopeOf(record);
  if (scope.companyId !== 'all' && rec.companyId && rec.companyId !== scope.companyId) {
    return { ok: false, error: 'scope_violation', layer: 'scope' };
  }
  if (scope.branchId !== 'all' && rec.branchId && rec.branchId !== scope.branchId) {
    return { ok: false, error: 'scope_violation', layer: 'scope' };
  }

  if (!rec.companyId || !rec.branchId) {
    return { ok: false, error: 'branch_context_required', layer: 'context' };
  }

  if (opts.context) {
    if (opts.context.companyId && opts.context.companyId !== 'all' && rec.companyId && rec.companyId !== opts.context.companyId) {
      return { ok: false, error: 'company_mismatch', layer: 'context' };
    }
    if (opts.context.branchId && opts.context.branchId !== 'all' && rec.branchId && rec.branchId !== opts.context.branchId) {
      return { ok: false, error: 'branch_mismatch', layer: 'context' };
    }
  }
  return { ok: true };
}

export function createPayrollCorrectionGuarded(user, input, opts = {}) {
  const original = input && input.originalBatch;
  const context = opts.context;
  const gate = requirePayrollCorrectionAction(user, 'create', original, { context });
  if (!gate.ok) {
    reportDenied('create', original, gate);
    return { ok: false, error: gate.error, layer: gate.layer };
  }

  if (input && input.manualEntry && !can(user, CORRECTION_ACTION_PERMISSIONS.manual)) {
    const d = { ok: false, error: 'forbidden_action:manual_entry', layer: 'permission' };
    reportDenied('manual', original, d);
    return d;
  }

  const recoveryMethod = input && input.recovery && input.recovery.method;
  if (recoveryMethod === 'write_off' && !can(user, CORRECTION_ACTION_PERMISSIONS.writeOff)) {
    const d = { ok: false, error: 'forbidden_action:writeoff', layer: 'permission' };
    reportDenied('writeOff', original, d);
    return d;
  }

  const originalId = (input && input.originalTransactionId) || (original && original.id) || null;
  if (!original || originalId === null) {
    return { ok: false, error: 'original_required', layer: 'business' };
  }
  if (!(original.archived === true) || original.status !== 'paid') {
    return { ok: false, error: 'original_not_archived', layer: 'state' };
  }

  const window = resolveCorrectionWindow(original.month, opts.settings, { now: opts.now });
  if (!window.ok) {
    return { ok: false, error: 'correction_window_expired', layer: 'business', window };
  }

  const existing = Array.isArray(opts.existingCorrections) ? opts.existingCorrections : [];
  if (existing.some((c) => isCorrectionOpen(c))) {
    return { ok: false, error: 'correction_conflict', layer: 'business' };
  }

  const built = createCorrection(input, {
    original,
    settings: opts.settings,
    user,
    now: opts.now,
  });
  if (!built.ok) {
    return { ...built, layer: 'business' };
  }
  return { ok: true, correction: built.correction };
}

export function transitionCorrectionGuarded(user, correction, to, opts = {}) {
  if (!correction) return { ok: false, error: 'correction_required', layer: 'business' };
  const action = CORRECTION_TRANSITION_ACTION[to];
  if (!action) return { ok: false, error: `no_action_for_transition:${to}`, layer: 'permission' };
  const byName = opts.by || (user && (user.name || user.username || user.role)) || '';

  if (action === 'approve' && isCreator(user, correction, byName)) {
    const d = { ok: false, error: 'creator_cannot_approve', layer: 'business' };
    reportDenied(action, correction, d, { by: byName });
    return d;
  }

  const gate = requirePayrollCorrectionAction(user, action, correction, { context: opts.context });
  if (!gate.ok) {
    reportDenied(action, correction, gate, { by: byName });
    return { ok: false, error: gate.error, layer: gate.layer, correction };
  }

  if (to === 'paid' && correction.status === 'under_audit' && correction.coApprovePending === true) {
    const d = { ok: false, error: 'dual_approval_pending', layer: 'business' };
    reportDenied(action, correction, d, { by: byName });
    return d;
  }

  const allowed = canTransitionCorrection(correction, to);
  if (!allowed.ok) {
    reportDenied(action, correction, allowed, { by: byName });
    return { ok: false, error: allowed.error, layer: allowed.layer, correction };
  }

  if (to === 'approved' && action === 'approve' && correction.direction === 'debit' && correction.approval && correction.approval.approvedBy === byName) {
    const d = { ok: false, error: 'dual_approval_same_user', layer: 'business' };
    reportDenied(action, correction, d, { by: byName });
    return d;
  }

  const result = transitionCorrection(correction, to, {
    by: byName,
    at: opts.at,
    notifyFailed: opts.notifyFailed,
    rejectionReason: opts.rejectionReason,
    recovery: opts.recovery,
  });
  return result;
}

export function coApproveCorrectionGuarded(user, correction, opts = {}) {
  if (!correction) return { ok: false, error: 'correction_required', layer: 'business' };
  const byName = opts.by || (user && (user.name || user.username || user.role)) || '';

  if (isCreator(user, correction, byName)) {
    const d = { ok: false, error: 'creator_cannot_approve', layer: 'business' };
    reportDenied('coApprove', correction, d, { by: byName });
    return d;
  }
  if (isSameActor(user, correction, byName)) {
    const d = { ok: false, error: 'dual_approval_same_user', layer: 'business' };
    reportDenied('coApprove', correction, d, { by: byName });
    return d;
  }

  const gate = requirePayrollCorrectionAction(user, 'coApprove', correction, { context: opts.context });
  if (!gate.ok) {
    reportDenied('coApprove', correction, gate, { by: byName });
    return { ok: false, error: gate.error, layer: gate.layer, correction };
  }

  return coApproveCorrection(correction, {
    by: byName,
    at: opts.at,
    notifyFailed: opts.notifyFailed,
  });
}

export function archiveCorrectionGuarded(user, correction, opts = {}) {
  if (!correction) return { ok: false, error: 'correction_required', layer: 'business' };
  const gate = requirePayrollCorrectionAction(user, 'archive', correction, { context: opts.context });
  if (!gate.ok) {
    reportDenied('archive', correction, gate);
    return { ok: false, error: gate.error, layer: gate.layer, correction };
  }
  const byName = opts.by || (user && (user.name || user.username || user.role)) || '';
  return archiveCorrection(correction, { by: byName, at: opts.at });
}

export { getEffectivePermissions } from '../types.js';