// =========================================================
// EOSB Access Layer — Phase 7
// =========================================================
// Permission → Scope → State for every EOSB action, mirroring
// payrollAccess.js. Documented (unchanged) EOSB role model:
//   company_hr owns the full lifecycle
//   branch_hr only views / calculates
// Action gates:
//   calculate/edit → eosb.calculate
//   submit/approve/reject/cancelPayment → eosb.approve
//   disburse → eosb.pay
//   delete → eosb.delete
// Denied attempts are reported through the audit deny hook so storage
// can log them as tamper-evident trail events.

import { can } from '../types.js';
import { transitionEosb, recordEosbCorrection } from './eosbWorkflow.js';
import { userScope } from './payrollAccess.js';

let auditDeniedHook = null;
export function setEosbDeniedHook(fn) {
  auditDeniedHook = typeof fn === 'function' ? fn : null;
}

function reportDeniedEosb(action, record, gate) {
  try {
    if (auditDeniedHook) {
      auditDeniedHook({
        action,
        recordId: record && (record.id || record.employeeId),
        fromStatus: record ? (record.status || 'draft') : 'draft',
        error: gate.error,
        layer: gate.layer,
      });
    }
  } catch (e) { /* a denied-event failure must never break the UI flow */ }
}

export const EOSB_ACTION_PERMISSIONS = {
  calculate: 'eosb.calculate',
  edit: 'eosb.calculate',
  submit: 'eosb.approve',
  approve: 'eosb.approve',
  reject: 'eosb.approve',
  cancelPayment: 'eosb.approve',
  disburse: 'eosb.pay',
  delete: 'eosb.delete',
};

export function eosbRecordInScope(user, record) {
  if (!user) return false;
  const s = userScope(user);
  if (s.companyId === 'all' && s.branchId === 'all') return true;
  if (s.companyId !== 'all' && record && record.companyId && record.companyId !== s.companyId && record.companyId !== 'all') return false;
  if (s.branchId !== 'all' && record && record.branchId && record.branchId !== s.branchId && record.branchId !== 'all') return false;
  return true;
}

/**
 * Gate a single EOSB action. Returns { ok:true } or
 * { ok:false, error, layer: 'permission' | 'scope' | 'state' }.
 */
export function requireEosbAction(user, action, record) {
  const perm = EOSB_ACTION_PERMISSIONS[action];
  if (!perm) return { ok: false, error: `unknown_action:${action}`, layer: 'permission' };
  if (!can(user, perm)) return { ok: false, error: `forbidden_action:${action}`, layer: 'permission' };
  if (!eosbRecordInScope(user, record)) return { ok: false, error: 'scope_violation', layer: 'scope' };
  const st = record ? (record.status || 'draft') : 'draft';
  const returned = !!(record && record.rejectedBy);

  if (action === 'calculate') return { ok: true };
  if (action === 'edit') {
    if (st !== 'draft' && st !== 'rejected') return { ok: false, error: `edit_requires_returned:${st}`, layer: 'state' };
    if (!returned) return { ok: false, error: 'edit_requires_returned_draft', layer: 'state' };
    return { ok: true };
  }
  if (action === 'submit') {
    if (st !== 'draft') return { ok: false, error: `submit_requires_draft_or_returned:${st}`, layer: 'state' };
    return { ok: true };
  }
  if (action === 'approve' || action === 'reject') {
    if (st !== 'under_audit') return { ok: false, error: `review_requires_under_audit:${st}`, layer: 'state' };
    return { ok: true };
  }
  if (action === 'disburse') {
    if (st !== 'approved') return { ok: false, error: `disburse_requires_approved:${st}`, layer: 'state' };
    return { ok: true };
  }
  if (action === 'cancelPayment') {
    if (st !== 'paid') return { ok: false, error: `cancelPayment_requires_paid:${st}`, layer: 'state' };
    return { ok: true };
  }
  if (action === 'delete') {
    if (st === 'paid') return { ok: false, error: `delete_requires_not_paid:${st}`, layer: 'state' };
    return { ok: true };
  }
  return { ok: true };
}

const EOSB_TRANSITION_ACTION = {
  under_audit: 'submit',
  draft: 'reject',
  paid: 'disburse',
};

/** Resolve the guarding action for a raw transition (cancel payment is
 *  the paid→approved case, otherwise under_audit→approved is "approve"). */
export function eosbTransitionAction(record, to) {
  if (to === 'approved') return (record && record.status === 'paid') ? 'cancelPayment' : 'approve';
  return EOSB_TRANSITION_ACTION[to] || null;
}

export function transitionEosbGuarded(user, record, to, opts = {}) {
  const action = eosbTransitionAction(record, to);
  if (!action) return { ok: false, error: `no_action_for_transition:${to}`, layer: 'permission', batch: record };
  const gate = requireEosbAction(user, action, record);
  if (!gate.ok) {
    reportDeniedEosb(action, record, gate);
    return { ok: false, error: gate.error, layer: gate.layer, batch: record };
  }
  const actor = opts.by || (user && (user.name || user.username || user.role)) || '';
  return transitionEosb(record, to, { ...opts, by: opts.by || actor });
}

export function recordEosbCorrectionGuarded(user, prev, next, opts = {}) {
  const gate = requireEosbAction(user, 'edit', prev);
  if (!gate.ok) {
    reportDeniedEosb('edit', prev, gate);
    return { ok: false, error: gate.error, layer: gate.layer, batch: next };
  }
  const actor = opts.by || (user && (user.name || user.username || user.role)) || '';
  return recordEosbCorrection(prev, next, { ...opts, by: opts.by || actor });
}

export function deleteEosbGuarded(user, record, opts = {}) {
  const gate = requireEosbAction(user, 'delete', record);
  if (!gate.ok) {
    reportDeniedEosb('delete', record, gate);
    return { ok: false, error: gate.error, layer: gate.layer };
  }
  return { ok: true };
}