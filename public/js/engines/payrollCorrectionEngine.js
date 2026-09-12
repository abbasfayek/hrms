// =========================================================
// HRMS Payroll Correction Engine — Phase 9 (Spec v2.1)
// =========================================================
//
// Pure state machine + financial chain for post-payment corrections on
// ARCHIVED payrolls (Rules 4/9/10, Decisions 1-5/7/8). It never touches the
// original batch — every correction is a NEW record linked by
// originalTransactionId, and every component line is recomputed from its
// inputs (hours/days/units + rule) and sealed with the currency snapshot that
// governed the ORIGINAL transactional line (Decision 1 default).
//
// Statuses: draft → under_audit → approved → paid → archived (terminal), with
// the Returned loop under_audit → rejected → under_audit. Debit corrections
// require DUAL approval (Decision 3): the primary approver marks
// coApprovePending=true (record stays under_audit) until a SECOND distinct
// approver completes it via coApprove.
//
// Circular-import safe: engine only imports currencyGovernance (rate
// resolution) and the correction model (catalog + sealed financial views).

import {
  getActiveRate,
  resolveBaseCurrency,
  SAME_CURRENCY_RATE,
} from './currencyGovernance.js';
import {
  resolveComponent,
  isCatalogComponent,
  correctionFinancialView,
  seal,
} from './payrollCorrectionModel.js';

export const CORRECTION_SCHEMA = 'p9';

export const CORRECTION_STATUSES = ['draft', 'under_audit', 'approved', 'paid', 'archived', 'rejected'];

export const CORRECTION_DIRECTIONS = ['credit', 'debit'];

export const RECOVERY_METHODS = ['next_payroll', 'separate_recovery', 'write_off'];

const ACTIVE_STATUSES = ['draft', 'under_audit'];

function ensureUuid() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch (e) { /* fall through */ }
  let out = '';
  const bytes = typeof crypto !== 'undefined' && crypto && crypto.getRandomValues
    ? crypto.getRandomValues(new Uint8Array(16))
    : null;
  for (let i = 0; i < 16; i++) {
    const b = bytes ? bytes[i] : Math.floor(Math.random() * 256);
    if (i === 6) out += '4';
    else if (i === 8) out += String('89ab'[b & 3]);
    else out += b.toString(16).padStart(2, '0');
    if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
  }
  return out;
}

export function isCorrectionOpen(correction) {
  if (!correction) return false;
  if (correction.archived === true) return false;
  if (correction.status === 'rejected') return false;
  return ACTIVE_STATUSES.includes(correction.status) || (correction.status === 'approved' && correction.coApprovePending === true);
}

export function canTransitionCorrection(correction, to) {
  if (!correction) return { ok: false, error: 'correction_required', layer: 'state' };
  const from = correction.status || 'draft';
  if (correction.archived === true) {
    return { ok: false, error: `archived_is_terminal:${from}`, layer: 'state' };
  }
  const allowed = {
    draft: ['under_audit'],
    under_audit: ['approved', 'rejected'],
    rejected: ['under_audit'],
    approved: ['paid'],
    paid: [],
    archived: [],
  };
  const targets = allowed[from] || [];
  if (!targets.includes(to)) {
    return { ok: false, error: `invalid_transition:${from}->${to}`, layer: 'state' };
  }
  return { ok: true, from, to };
}

// ---------------------------------------------------------------------------
// Decision 4 window: the correction is only valid within the ORIGINAL period's
// window. Default = the financial year of the original transaction; a company
// may configure a `months` window (applied prospectively only).
// ---------------------------------------------------------------------------
export function resolveCorrectionWindow(payrollPeriodId, settings = {}, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const period = String(payrollPeriodId || '').trim();
  const m = period.match(/(\d{4})-(\d{2})/);
  if (!m) return { ok: false, mode: 'financial_year', start: null, end: null, error: 'invalid_period' };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const policy = (settings && settings.correctionWindow) || { mode: 'financial_year' };
  const mode = (policy && policy.mode) || 'financial_year';

  if (mode === 'months') {
    const months = Math.max(1, Number((policy && policy.months) || 12) || 12);
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10);
    const day = String(now).slice(0, 10);
    return { mode, ok: day >= start && day < end, start, end };
  }

  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const day = String(now).slice(0, 10);
  return { mode: 'financial_year', ok: day >= start && day <= end, start, end };
}

// ---------------------------------------------------------------------------
// Component-line calculation chain (§11.10). Each line is recomputed from
// inputs and sealed with a rule snapshot + the ORIGINAL currency snapshot
// (Decision 1 default mode 'original'); mode 'current' uses the live rate.
// ---------------------------------------------------------------------------
export function computeComponentLine(line, opts = {}) {
  const {
    original,
    settings = {},
    direction = 'credit',
    ratePolicy = { mode: 'original' },
  } = opts;
  if (!line || typeof line !== 'object') {
    return { ok: false, error: 'component_required' };
  }
  const code = String(line.componentCode || '');
  const resolved = resolveComponent(code);
  if (!resolved) return { ok: false, error: 'unknown_component' };
  const reason = String(line.reason || '').trim();
  if (!reason) return { ok: false, error: 'reason_required' };
  if (resolved.other && !line.sourceRef) return { ok: false, error: 'source_required' };

  const quantity = Number(line.quantity);
  const unit = line.unit || resolved.defaultUnit;
  const rate = Number(line.rateOrRuleRef);
  if (!(quantity > 0) || Number.isNaN(rate)) {
    return { ok: false, error: 'invalid_component_input', quantity, rate };
  }

  let ruleSnapshot;
  let calculatedAmount;
  if (code === 'OVERTIME') {
    ruleSnapshot = { kind: 'hourly_rate', hourlyRate: rate };
    calculatedAmount = quantity * rate;
  } else if (code === 'ABSENCE') {
    ruleSnapshot = { kind: 'unit_rate', unitRate: rate };
    calculatedAmount = quantity * rate;
  } else if (code === 'LATE') {
    ruleSnapshot = { kind: 'minute_rate', minuteRate: rate };
    calculatedAmount = quantity * rate;
  } else if (resolved.kind === 'adjustment' || code === 'LOAN_DEDUCTION') {
    ruleSnapshot = { kind: 'system_ref', reference: line.sourceRef || null };
    calculatedAmount = quantity * rate;
  } else {
    ruleSnapshot = { kind: 'fixed', fixedAmount: rate };
    calculatedAmount = quantity * rate;
  }

  const item = (original && Array.isArray(original.items))
    ? original.items.find((it) => it && it.employeeId === line.employeeId)
    : null;
  const itemCurrency = item && item.currency ? String(item.currency) : null;
  const currency = String(line.currency || itemCurrency || (settings && settings.currency) || 'USD');

  let exchangeRate = line.exchangeRate;
  let exchangeRateDate = line.exchangeRateDate;
  let baseCurrency = line.baseCurrency || (item && item.baseCurrency) || resolveBaseCurrency(settings) || 'USD';
  const itemRate = item && item.exchangeRate !== undefined && item.exchangeRate !== null
    ? Number(item.exchangeRate)
    : null;

  if (ratePolicy && ratePolicy.mode === 'current') {
    const live = getActiveRate(settings, currency);
    exchangeRate = line.exchangeRate !== undefined && line.exchangeRate !== null ? Number(line.exchangeRate) : (live && live.rate !== undefined ? Number(live.rate) : null);
    exchangeRateDate = line.exchangeRateDate || (live && live.rateDate) || null;
    if (exchangeRate === null || exchangeRate === undefined) exchangeRate = SAME_CURRENCY_RATE;
  } else {
    exchangeRate = line.exchangeRate !== undefined && line.exchangeRate !== null
      ? Number(line.exchangeRate)
      : (itemRate !== null && itemRate !== undefined && itemRate > 0 ? itemRate : SAME_CURRENCY_RATE);
    exchangeRateDate = line.exchangeRateDate || (item && item.exchangeRateDate) || null;
  }
  if (!(exchangeRate > 0)) exchangeRate = SAME_CURRENCY_RATE;

  const baseAmount = calculatedAmount * exchangeRate;

  return {
    ok: true,
    line: {
      employeeId: line.employeeId || null,
      employeeName: line.employeeName || null,
      componentCode: line.componentCode,
      componentLabel: resolved.other ? line.componentCode : line.componentCode,
      quantity,
      unit,
      rateOrRuleRef: rate,
      ruleSnapshot,
      calculatedAmount,
      currency,
      symbol: line.symbol || (settings && settings.currencySymbol) || null,
      exchangeRate,
      exchangeRateDate,
      baseCurrency,
      baseAmount,
      reason,
      sourceRef: line.sourceRef || null,
      direction: line.direction || direction,
      manualEntry: Boolean(line.manualEntry),
    },
  };
}

export function computeCorrectionComponents(input = {}, opts = {}) {
  const rawComponents = Array.isArray(input.components) ? input.components : [];
  if (!rawComponents.length) return { ok: false, error: 'components_required' };
  const computed = [];
  for (const raw of rawComponents) {
    const r = computeComponentLine(raw, {
      original: opts.original,
      settings: opts.settings,
      direction: input.direction || 'credit',
      ratePolicy: input.ratePolicy || { mode: 'original' },
    });
    if (!r.ok) return r;
    computed.push(r.line);
  }
  return { ok: true, components: computed };
}

// ---------------------------------------------------------------------------
// Create the correction record (pure). Identity is INHERITED from the original;
// the guard validates permission/scope/context/state BEFORE this runs.
// ---------------------------------------------------------------------------
export function createCorrection(input = {}, opts = {}) {
  const original = opts.original;
  const correctionId = ensureUuid();
  const now = opts.now || new Date().toISOString();
  const createdBy = opts.user || {};
  const originalId = input.originalTransactionId || (original && original.id) || null;

  const definiteOriginalId = originalId || (original && original.id) || null;
  const direction = input.direction === 'debit' ? 'debit' : 'credit';
  const recovery = { method: input.recovery && input.recovery.method ? String(input.recovery.method) : null, ...(input.recovery || {}) };
  const ratePolicy = { mode: input.ratePolicy && input.ratePolicy.mode === 'current' ? 'current' : 'original' };

  const computed = computeCorrectionComponents(input, {
    original,
    settings: opts.settings,
  });
  if (!computed.ok) return computed;

  const correction = {
    schema: CORRECTION_SCHEMA,
    correctionId,
    displayNumber: input.displayNumber || null,
    originalTransactionId: definiteOriginalId,
    parentCorrectionId: input.parentCorrectionId || null,
    companyId: original ? (original.companyId || null) : (input.companyId || null),
    branchId: original ? (original.branchId || null) : (input.branchId || null),
    payrollPeriodId: original ? (original.month || null) : (input.payrollPeriodId || null),
    direction,
    reason: String(input.reason || '').trim(),
    description: String(input.description || ''),
    components: computed.components,
    recovery,
    ratePolicy,
    manualEntry: Boolean(input.manualEntry),
    status: 'draft',
    archived: false,
    revision: 1,
    createdBy: String(createdBy.id || createdBy.username || ''),
    createdByName: String(createdBy.name || createdBy.username || ''),
    createdAt: now,
    notification: { status: 'pending', notifiedVersion: null, notifiedAt: null, retries: 0, failure: null },
    originalBatchSnapshot: original ? seal(original) : null,
  };
  return { ok: true, correction };
}

export function transitionCorrection(correction, to, opts = {}) {
  if (!correction) return { ok: false, error: 'correction_required', layer: 'state' };
  const gate = canTransitionCorrection(correction, to);
  if (!gate.ok) return gate;
  const by = opts.by || '';
  const at = opts.at || new Date().toISOString();
  const next = seal(correction);
  next.revision = (Number(next.revision) || 0) + 1;
  next.updatedAt = at;

  if (to === 'under_audit') {
    if (next.status === 'rejected') {
      next.resubmittedBy = by;
      next.resubmittedAt = at;
    } else {
      next.submittedBy = by;
      next.submittedAt = at;
    }
    next.status = 'under_audit';
    return { ok: true, correction: next };
  }

  if (to === 'rejected') {
    next.status = 'rejected';
    next.rejectedBy = by;
    next.rejectedAt = at;
    next.rejectionReason = opts.rejectionReason || '';
    return { ok: true, correction: next };
  }

  if (to === 'approved') {
    if (next.direction === 'debit') {
      next.approvedBy = by;
      next.approvedAt = at;
      next.approval = { kind: 'dual', approvedBy: by, approvedAt: at };
      next.coApprovePending = true;
      return { ok: true, correction: next };
    }
    next.status = 'approved';
    next.approvedBy = by;
    next.approvedAt = at;
    next.approval = { kind: 'single', approvedBy: by, approvedAt: at };
    next.coApprovePending = false;
    next.notification = applyNotification(next, by, at, opts);
    return { ok: true, correction: next };
  }

  if (to === 'paid') {
    next.status = 'paid';
    next.paidBy = by;
    next.paidAt = at;
    if (opts.recovery && typeof opts.recovery === 'object') {
      next.recovery = { ...(next.recovery || {}), ...opts.recovery };
    }
    if (next.recovery && next.recovery.method === 'write_off') {
      next.recovery.authority = by;
      next.recovery.authorizedAt = at;
      next.paymentReference = null;
    } else if (opts.paymentReference || opts.reason) {
      next.paymentReference = opts.paymentReference || null;
    }
    return { ok: true, correction: next };
  }

  return { ok: false, error: `unhandled_transition:${to}`, layer: 'state' };
}

export function coApproveCorrection(correction, opts = {}) {
  const next = seal(correction);
  if (next.archived === true) return { ok: false, error: 'archived_is_terminal', layer: 'state' };
  if (next.status !== 'under_audit' || next.coApprovePending !== true) {
    return { ok: false, error: 'dual_approval_not_pending', layer: 'business' };
  }
  const by = opts.by || '';
  const at = opts.at || new Date().toISOString();
  next.revision = (Number(next.revision) || 0) + 1;
  next.updatedAt = at;
  next.status = 'approved';
  next.coApprovedBy = by;
  next.coApprovedAt = at;
  next.coApprovePending = false;
  next.approval = { kind: 'dual', approvedBy: next.approvedBy || next.approval.approvedBy || null, coApprovedBy: by, approvedAt: next.approvedAt || next.approval.approvedAt || null, coApprovedAt: at };
  next.notification = applyNotification(next, by, at, opts);
  return { ok: true, correction: next };
}

export function archiveCorrection(correction, opts = {}) {
  if (!correction) return { ok: false, error: 'correction_required', layer: 'state' };
  const next = seal(correction);
  if (next.archived === true) return { ok: false, error: 'already_archived', layer: 'state' };
  if (next.status !== 'paid') return { ok: false, error: 'archive_requires_paid', layer: 'state' };
  next.archived = true;
  next.archivedBy = opts.by || '';
  next.archivedAt = opts.at || new Date().toISOString();
  next.updatedAt = next.archivedAt;
  next.revision = (Number(next.revision) || 0) + 1;
  return { ok: true, correction: next };
}

export function applyNotification(correction, by, at, opts = {}) {
  let status = 'sent';
  let failure = null;
  let retries = 0;
  if (opts.notifyFailed) {
    status = 'delivery_failed';
    failure = { attemptAt: at, error: 'delivery_failed', by };
    retries = 1;
  }
  return {
    status,
    notifiedVersion: Number(correction.revision) || 1,
    notifiedAt: at,
    retries,
    failure,
  };
}

export function recordCorrectionChange(prev, next, opts = {}) {
  if (!prev || !next) return { ok: false, error: 'correction_required' };
  const at = opts.at || new Date().toISOString();
  const by = opts.by || '';
  const track = [
    ...(Array.isArray(prev.correctionChanges) ? prev.correctionChanges : []),
    {
      at,
      by,
      reason: opts.reason || '',
      fromStatus: prev.status || 'draft',
      toStatus: next.status || prev.status || 'draft',
    },
  ];
  const merged = seal(next);
  merged.correctionChanges = track;
  merged.updatedAt = at;
  merged.revision = (Number(prev.revision) || 0) + 1;
  return { ok: true, correction: merged };
}

// ---------------------------------------------------------------------------
// Decision 8 reporting basis (pure, never mutates the original):
//   Net/Effective = Original ± Σ(direction × amount) per currency segment,
// computed ONLY from SEALED snapshots — the original is never re-rated.
// ---------------------------------------------------------------------------
export function computeNetEffective(original, corrections = []) {
  if (!original) return null;
  const list = Array.isArray(corrections) ? corrections : [];
  const originalNet = Number(original.totalNet) || 0;
  const currencyMap = new Map();
  const seedSymbols = new Map();
  (Array.isArray(original.totalsByCurrency) ? original.totalsByCurrency : []).forEach((g) => {
    if (!g || !g.code) return;
    seedSymbols.set(String(g.code), g.symbol || null);
    currencyMap.set(String(g.code), { code: String(g.code), symbol: g.symbol || null, originalNet: Number(g.net) || 0, correctionsNet: 0, net: Number(g.net) || 0 });
  });

  list.forEach((correction) => {
    if (!correction) return;
    const view = correctionFinancialView(correction);
    if (!view || !Array.isArray(view.currencies)) return;
    view.currencies.forEach((g) => {
      if (!g || !g.code) return;
      const key = String(g.code);
      if (!currencyMap.has(key)) {
        currencyMap.set(key, { code: key, symbol: g.symbol || seedSymbols.get(key) || null, originalNet: 0, correctionsNet: 0, net: 0 });
      }
      const group = currencyMap.get(key);
      group.correctionsNet += Number(g.amount) || 0;
      group.net = group.originalNet + group.correctionsNet;
    });
  });

  const currencies = [...currencyMap.values()].map((g) => ({
    code: g.code,
    symbol: g.symbol,
    originalNet: Number(g.originalNet),
    correctionsNet: Number(g.correctionsNet),
    net: Number(g.net),
  }));

  let correctionsNet = 0;
  list.forEach((correction) => {
    if (!correction) return;
    const view = correctionFinancialView(correction);
    if (view) correctionsNet += Number(view.totalNet) || 0;
  });

  return {
    originalId: original.id || null,
    totalOriginalNet: originalNet,
    originalFrozen: true,
    correctionsNet,
    totalNet: Number(originalNet + correctionsNet),
    currencies,
  };
}

export { correctionFinancialView } from './payrollCorrectionModel.js';
export { resolveComponent } from './payrollCorrectionModel.js';
export { isCatalogComponent, isOtherComponent } from './payrollCorrectionModel.js';