// ==========================================
// Phase 2 (Spec v1.0) — Payroll Roles / Permissions / Scope enforcement layer
// ==========================================
// Every payroll action — generate, edit, submit to audit, approve, reject,
// disburse, export, archive — must pass THREE stacked guards before it can
// reach the Phase 1 state machine:
//   1. permission  — the acting user holds the required permission for the action
//   2. scope       — the batch belongs entirely to the user's assigned scope
//   3. state       — the user's role may only call the exact transition the
//                    state machine allows from the batch's current status
// This makes it impossible to bypass the state machine with permissions (or
// bypass permissions with a direct engine call): transitions only run through
// transitionPayrollGuarded, which delegates to the unchanged Phase 1
// transitionPayroll once all three guards pass.

import { can, getEffectivePermissions } from '../types.js';
import { transitionPayroll, recordPayrollCorrection, archivePayrollBatch } from './payrollEngine.js';

// Phase 5: security-denial hook. Storage registers itself here (acyclic —
// payrollAccess has no storage dependency) so a forbidden payroll operation is
// recorded as a `denied` audit event — it can never become a success event.
let auditDeniedHook = null;
export function setAuditDeniedHook(fn) {
  auditDeniedHook = typeof fn === 'function' ? fn : null;
}

function reportDenied(action, batch, gate) {
  try {
    if (auditDeniedHook) {
      const batchItems = (batch && Array.isArray(batch.items)) ? batch.items : [];
      const employeeIds = [...new Set(batchItems.map((it) => it && it.employeeId).filter(Boolean))];
      auditDeniedHook({
        action,
        recordId: batch && (batch.month || batch.id),
        fromStatus: batch ? (batch.status || 'draft') : 'draft',
        payrollId: batch ? String(batch.id || '') : '',
        companyId: batch ? String(batch.companyId || (batchItems[0] && batchItems[0].companyId) || '') : '',
        branchId: batch ? String(batch.branchId || (batchItems[0] && batchItems[0].branchId) || '') : '',
        employeeIds,
        employeeId: employeeIds.length ? employeeIds[0] : null,
        error: gate.error,
        layer: gate.layer,
        reason: gate.error,
      });
    }
  } catch (e) { /* a failed audit attempt must never mask the denial itself */ }
}

/** The permission required to perform each payroll action. */
export const PAYROLL_ACTION_PERMISSIONS = {
  generate: 'payroll.generate',
  edit: 'payroll.edit',
  submit: 'payroll.submit',
  approve: 'payroll.approve',
  reject: 'payroll.reject',
  disburse: 'payroll.disburse',
  export: 'payroll.export',
  archive: 'payroll.archive',
  cancelPayment: 'payroll.cancelPayment',
};

/** Map a state-machine destination to the action that performs that transition. */
export const PAYROLL_TRANSITION_ACTION = {
  under_audit: 'submit',   // draft → under_audit (submit) OR rejected → under_audit (resubmit)
  approved: 'approve',     // under_audit → approved
  rejected: 'reject',      // under_audit → rejected (Returned / Needs Correction)
  paid: 'disburse',        // approved → paid (payment queue point)
};

const COMPANY_SCOPED_ROLES = ['company_hr', 'branch_hr', 'payroll_admin', 'audit_reviewer', 'payments_officer'];

/**
 * True when the user is restricted to their assigned company/branch scope.
 * Used by storage (data visibility) and by this guard (action enforcement).
 */
export function userScope(user) {
  if (!user || user.role === 'super_admin') return { companyId: 'all', branchId: 'all' };
  const companyId = user.assignedCompanyId && user.assignedCompanyId !== 'all' ? user.assignedCompanyId : 'all';
  const branchId = (COMPANY_SCOPED_ROLES.includes(user.role) || companyId !== 'all')
    && user.assignedBranchId && user.assignedBranchId !== 'all'
    ? user.assignedBranchId
    : 'all';
  return { companyId, branchId };
}

export function userScopeIsGlobal(user) {
  const s = userScope(user);
  return s.companyId === 'all' && s.branchId === 'all';
}

/**
 * A batch is inside the user's scope when every item belongs to their assigned
 * company (and branch, when branch-scoped). Items without a company/branch are
 * treated as permissible (they carry no scope claim), matching storage.
 */
export function payrollBatchInScope(user, batch) {
  if (!user) return false;
  const s = userScope(user);
  if (s.companyId === 'all' && s.branchId === 'all') return true;
  const items = (batch && Array.isArray(batch.items) && batch.items) || [];
  if (!items.length) return true;
  return items.every((it) => {
    if (s.companyId !== 'all' && it.companyId && it.companyId !== s.companyId && it.companyId !== 'all') return false;
    if (s.branchId !== 'all' && it.branchId && it.branchId !== s.branchId && it.branchId !== 'all') return false;
    return true;
  });
}

/**
 * Validate that the branch context is set and valid for sensitive payroll
 * operations. Returns { ok: true } or { ok: false, error, layer }.
 *
 * Enforced at engine level, never UI-only:
 *   1. A branch-scoped role without an assigned branch can never legitimately act.
 *   2. A sensitive operation on a batch that carries NO branch identity (batch
 *      level NOR any item level) is ambiguous and refused outright.
 *   3. The acting user's assigned scope must contain the batch (branch/company).
 *   4. When the caller supplies the CURRENT branch context at execution time
 *      (`context`), the batch must belong to it — a sensitive operation cannot
 *      run against a payroll of another branch while the user works in another.
 *      (super_admin remains the global authority and is exempt by design.)
 */
export function requirePayrollBranchContext(user, batch, action, context) {
  if (!user) return { ok: false, error: 'no_user', layer: 'context' };
  // Super admin is the global authority and bypasses branch-context checks.
  if (user.role === 'super_admin') return { ok: true };
  const sensitiveActions = ['generate', 'edit', 'submit', 'approve', 'reject', 'disburse', 'archive', 'cancelPayment'];
  if (!sensitiveActions.includes(action)) return { ok: true };
  const scope = userScope(user);

  // A branch_hr with no branch assigned has no branch context at all.
  if (scope.branchId === 'all' && user.role === 'branch_hr') {
    return { ok: false, error: 'branch_context_required', layer: 'context', message: 'العملية غير صحيحة: يرجى اختيار الفرع أولاً.' };
  }

  // Resolve the batch's REAL company/branch identity: explicit batch fields
  // first, then the first item's scope (generated and legacy batches both carry
  // per-employee company/branch). A sensitive operation on an identity-less
  // batch is refused outright — it must never be interpreted ambiguously.
  const firstItem = batch && Array.isArray(batch.items) && batch.items.length ? batch.items[0] : null;
  const batchCompany = batch ? String(batch.companyId || (firstItem && firstItem.companyId) || '') : '';
  const batchBranch = batch ? String(batch.branchId || (firstItem && firstItem.branchId) || '') : '';
  if (batch && (!batchCompany || !batchBranch)) {
    return { ok: false, error: 'branch_context_required', layer: 'context', message: 'العملية غير صحيحة: يرجى اختيار الفرع أولاً.' };
  }

  // The acting user's assigned scope must contain the batch.
  if (scope.companyId !== 'all' && batchCompany && batchCompany !== scope.companyId) {
    return { ok: false, error: 'company_mismatch', layer: 'scope', message: 'لا يمكن تنفيذ العملية: المسير ينتمي لشركة أخرى.' };
  }
  if (scope.branchId !== 'all' && batchBranch && batchBranch !== scope.branchId) {
    return { ok: false, error: 'branch_mismatch', layer: 'scope', message: 'لا يمكن تنفيذ العملية: المسير ينتمي لفرع آخر.' };
  }

  // The caller's CURRENT branch context at execution time (e.g. the branch
  // selected in the UI) must match the batch the operation is executed against.
  if (context) {
    if (context.companyId && context.companyId !== 'all' && batchCompany && batchCompany !== context.companyId) {
      return { ok: false, error: 'company_mismatch', layer: 'context', message: 'لا يمكن تنفيذ العملية: المسير ينتمي لشركة أخرى.' };
    }
    if (context.branchId && context.branchId !== 'all' && batchBranch && batchBranch !== context.branchId) {
      return { ok: false, error: 'branch_mismatch', layer: 'context', message: 'لا يمكن تنفيذ العملية: المسير ينتمي لفرع آخر.' };
    }
  }
  return { ok: true };
}

/**
 * Fuse the three guards for a single payroll action. Returns
 * { ok:true } or { ok:false, error, layer: 'permission'|'scope'|'state'|'context' }.
 * `context` (optional) is the CURRENT company/branch the user is operating in at
 * execution time — a sensitive action is bound to it by the branch-context guard.
 */
export function requirePayrollAction(user, action, batch, context) {
  const perm = PAYROLL_ACTION_PERMISSIONS[action];
  if (!perm) return { ok: false, error: `unknown_action:${action}`, layer: 'permission' };
  if (!can(user, perm)) return { ok: false, error: `forbidden_action:${action}`, layer: 'permission' };
  if (!payrollBatchInScope(user, batch)) return { ok: false, error: 'scope_violation', layer: 'scope' };

  // Validate branch context for sensitive operations
  const ctxCheck = requirePayrollBranchContext(user, batch, action, context);
  if (!ctxCheck.ok) return ctxCheck;

  const st = batch ? batch.status || 'draft' : 'draft';
  if (action === 'submit' || action === 'generate' || action === 'edit') {
    if (action === 'submit' && st !== 'draft' && st !== 'rejected') {
      return { ok: false, error: `submit_requires_draft_or_returned:${st}`, layer: 'state' };
    }
    if (action === 'generate' && st !== 'draft' && st !== 'rejected') {
      return { ok: false, error: `generate_requires_draft_or_returned:${st}`, layer: 'state' };
    }
    if (action === 'edit' && st !== 'draft' && st !== 'rejected') {
      return { ok: false, error: `edit_requires_draft_or_returned:${st}`, layer: 'state' };
    }
  } else if ((action === 'approve' || action === 'reject') && st !== 'under_audit') {
    return { ok: false, error: `review_requires_under_audit:${st}`, layer: 'state' };
  } else if (action === 'disburse' && st !== 'approved') {
    return { ok: false, error: `disburse_requires_approved:${st}`, layer: 'state' };
  } else if (action === 'archive' && st !== 'paid') {
    return { ok: false, error: `archive_requires_paid:${st}`, layer: 'state' };
  } else if (action === 'cancelPayment' && st !== 'paid') {
    return { ok: false, error: `cancelPayment_requires_paid:${st}`, layer: 'state' };
  }
  return { ok: true };
}

/**
 * Run a state-machine transition through the full guard stack. This is the ONLY
 * sanctioned path from UI actions to Phase 1 transitions.
 */
export function transitionPayrollGuarded(user, batch, to, opts = {}) {
  const action = PAYROLL_TRANSITION_ACTION[to];
  if (!action) {
    return { ok: false, error: `no_action_for_transition:${to}`, layer: 'permission' };
  }
  const gate = requirePayrollAction(user, action, batch, opts.context);
  if (!gate.ok) {
    reportDenied(action, batch, gate);
    return { ok: false, error: gate.error, layer: gate.layer, batch };
  }
  const actor = opts.by || (user && (user.name || user.username || user.role)) || '';
  return transitionPayroll(batch, to, { ...opts, by: opts.by || actor });
}

/**
 * Record an HR correction on a Returned batch through the guard stack
 * (edit + scope guards, then the Phase 1 correction recorder).
 */
export function recordPayrollCorrectionGuarded(user, prev, next, opts = {}) {
  const gate = requirePayrollAction(user, 'edit', prev, opts.context);
  if (!gate.ok) {
    reportDenied('edit', prev, gate);
    return { ok: false, error: gate.error, layer: gate.layer, batch: next };
  }
  const actor = opts.by || (user && (user.name || user.username || user.role)) || '';
  return recordPayrollCorrection(prev, next, { ...opts, by: opts.by || actor });
}

/**
 * Archive a paid batch through the guard stack (archive + scope, then the
 * Phase 1 archive recorder). Guarded to Super Admin via payroll.archive.
 */
export function archivePayrollBatchGuarded(user, batch, opts = {}) {
  const gate = requirePayrollAction(user, 'archive', batch, opts.context);
  if (!gate.ok) {
    reportDenied('archive', batch, gate);
    return { ok: false, error: gate.error, layer: gate.layer, batch };
  }
  const actor = opts.by || (user && (user.name || user.username || user.role)) || '';
  return archivePayrollBatch(batch, { ...opts, by: opts.by || actor });
}

/** Exposure for tests/tooling: what can a user effectively do end-to-end? */
export { getEffectivePermissions };