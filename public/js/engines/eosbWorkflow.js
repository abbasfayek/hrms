// =========================================================
// EOSB Workflow Engine — Phase 7 (Spec v1.0)
// =========================================================
// Pure state machine + audit data model for End-of-Service
// settlements. Mirrors the payroll pattern, but matches EOSB's
// OWN documented workflow:
//   draft  → under_audit      (submit / resubmit of a returned draft)
//   under_audit → approved    (approve)
//   under_audit → draft       (reject/return — status stays draft;
//                              "Returned/Needs Correction" is a MARKED
//                              draft, never a fresh one)
//   approved → paid           (disburse)
//   paid → approved           (cancel payment — documented EOSB behavior)
// Financial values are NEVER zeroed on reject; every transition stamps a
// sealed snapshot, a version and an audit attempt; corrections record
// Old->New diffs and can never erase sealed history (the engine is the only
// sanctioned writer — a fresh UI object may only EXTEND it).

export const EOSB_SCHEMA = 'p7';

export const EOSB_STATE_TRANSITIONS = {
  draft: ['under_audit'],
  under_audit: ['approved', 'draft'],
  approved: ['paid'],
  paid: ['approved'],
};

export const EOSB_MONETARY_FIELDS = [
  'finalEOSBAmount', 'leaveCompensationAmount', 'finalMonthSalary',
  'remainingLoanDeductions', 'netSettlementAmount',
];

export function canTransitionEosb(record, to) {
  if (!record) return { ok: false, error: 'no_record' };
  const from = record.status || 'draft';
  if (!to) return { ok: false, error: 'missing_destination' };
  const allowed = EOSB_STATE_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) return { ok: false, error: `eosb_transition_${from}_to_${to}_forbidden` };
  return { ok: true };
}

function cloneEosb(record) {
  const next = { ...record };
  ['versions', 'corrections', 'auditAttempts', 'auditHistory'].forEach((k) => {
    if (Array.isArray(record[k])) next[k] = record[k].map((v) => ({ ...v }));
  });
  ['baselineSnapshot', 'rejectedSnapshot', 'currencyModel', 'governance'].forEach((k) => {
    if (record[k] && typeof record[k] === 'object') next[k] = { ...record[k] };
  });
  return next;
}

/** Sealed financial snapshot of an EOSB settlement (Phase 4 fields copied). */
export function eosbFinancialSnapshot(record, opts = {}) {
  const snap = {
    version: record.revision || 0,
    capturedStatus: record.status || 'draft',
    capturedAt: opts.at || new Date().toISOString(),
  };
  EOSB_MONETARY_FIELDS.forEach((f) => {
    if (record[f] !== undefined && record[f] !== null) snap[f] = record[f];
  });
  ['currency', 'salaryCurrency', 'exchangeRate', 'exchangeRateDate', 'baseCurrency', 'baseAmount', 'exchangeRateStatus'].forEach((f) => {
    if (record[f] !== undefined && record[f] !== null) snap[f] = record[f];
  });
  if (record.governance && typeof record.governance === 'object') snap.governance = { ...record.governance };
  if (record.currencyModel !== undefined && record.currencyModel !== null) snap.currencyModel = { ...record.currencyModel };
  return snap;
}

/**
 * Seal the ORIGINAL financial values on the first committed point
 * (first submission to under_audit). Idempotent — never re-seals once
 * a baseline exists, so later rate changes can never reprice history.
 */
export function ensureEosbBaseline(record, opts = {}) {
  if (!record || typeof record !== 'object') return record;
  if (record.baselineSnapshot && record.baselineSnapshot.netSettlementAmount !== undefined) return record;
  const snap = eosbFinancialSnapshot(record, { by: opts.by, at: opts.at });
  snap.baselineSource = 'first_submit';
  record.baselineSnapshot = snap;
  return record;
}

export function versionIdOfEosb(v) {
  return v && v.versionId ? v.versionId : null;
}

/** Append a version entry onto a NEW versions array (inputs never mutated). */
export function pushEosbVersion(batch, entry) {
  const versions = Array.isArray(batch.versions) ? batch.versions.map((v) => ({ ...v })) : [];
  const prev = versions[versions.length - 1] || null;
  const versionId = `V${entry.version}`;
  const ver = {
    type: entry.type,
    version: entry.version,
    status: entry.status || batch.status || null,
    by: entry.by,
    at: entry.at,
    reason: entry.reason || '',
    versionId,
    prevVersionId: prev ? versionIdOfEosb(prev) : null,
    nextVersionId: null,
    financialSnapshot: entry.snapshot || eosbFinancialSnapshot(batch, { by: entry.by, at: entry.at }),
  };
  if (prev) prev.nextVersionId = versionId;
  versions.push(ver);
  return versions;
}

/**
 * Original (first committed) financial values — read from the sealed
 * baselineSnapshot, or the rejected snapshot for legacy records. NEVER
 * rebuilt from the record's current values.
 */
export function originalEosbFinancialValues(record) {
  if (!record) return null;
  if (record.baselineSnapshot && record.baselineSnapshot.netSettlementAmount !== undefined) {
    return JSON.parse(JSON.stringify(record.baselineSnapshot));
  }
  const snaps = Array.isArray(record.versions)
    ? record.versions.filter((v) => v.type === 'returned' && v.financialSnapshot && v.financialSnapshot.netSettlementAmount !== undefined)
    : [];
  if (snaps.length) return JSON.parse(JSON.stringify(snaps[snaps.length - 1].financialSnapshot));
  if (record.rejectedSnapshot) return JSON.parse(JSON.stringify(record.rejectedSnapshot));
  return null;
}

function attemptResultOf(to, from) {
  if (to === 'under_audit') return 'under_audit';
  if (to === 'draft' && from === 'under_audit') return 'returned';
  if (to === 'approved') return 'approved';
  if (to === 'paid') return 'paid';
  return to;
}

/**
 * Apply a REAL transition. Pure — returns a new batch; the input record
 * is never mutated. Stores rejectedSnapshot/versions/auditAttempts +
 * auditHistory and NEVER zeroes financials on reject.
 */
export function transitionEosb(record, to, opts = {}) {
  const guard = canTransitionEosb(record, to);
  if (!guard.ok) return { ok: false, error: guard.error, batch: record };
  const now = opts.at || new Date().toISOString();
  const actor = opts.by || '';
  const next = cloneEosb(record);
  const from = next.status || 'draft';
  const revision = (Number(next.revision) || 0) + 1;
  const reason = opts.rejectionReason || opts.reason || '';
  let type = to;

  if (to === 'under_audit') {
    if (next.rejectedBy) {
      next.resubmittedBy = actor;
      next.resubmittedAt = now;
      next.returnState = 'resubmitted';
      type = 'resubmitted';
    } else {
      next.submittedBy = actor;
      next.submittedAt = now;
      type = 'under_audit';
    }
    ensureEosbBaseline(next, { by: actor, at: now });
  } else if (to === 'draft') {
    // Reject / return — financials are NEVER zeroed here.
    next.rejectedBy = actor;
    next.rejectedAt = now;
    next.rejectionReason = reason;
    next.returnState = 'needs_correction';
    next.rejectedSnapshot = eosbFinancialSnapshot(next, { by: actor, at: now });
    type = 'returned';
  } else if (to === 'approved') {
    if (from === 'paid') {
      // Cancel payment — documented EOSB behavior: return to Approved.
      next.cancelPaymentBy = actor;
      next.cancelPaymentAt = now;
      next.returnState = undefined;
      next.paidBy = undefined;
      next.paidAt = undefined;
      next.paymentReference = undefined;
      type = 'cancel_payment';
    } else {
      next.approvedBy = actor;
      next.approvedAt = now;
      next.returnState = undefined;
      next.auditDecisionAt = now;
      type = 'approved';
    }
  } else if (to === 'paid') {
    next.paidBy = actor;
    next.paidAt = now;
    next.paymentReference = {
      referenceId: `EOSB-PAY-${Date.now().toString(36).toUpperCase()}`,
      executedBy: actor,
      executedAt: now,
      netSettlementAmount: Number(next.netSettlementAmount) || 0,
      currency: next.currency || next.salaryCurrency || null,
      baseAmount: next.baseAmount != null ? next.baseAmount : null,
    };
    type = 'paid';
  }

  next.status = to;
  next.revision = revision;
  next.updatedAt = now;
  next.eosbSchema = EOSB_SCHEMA;
  next.versions = pushEosbVersion(next, { type, version: revision, status: to, by: actor, at: now, reason });
  next.auditHistory = Array.isArray(record.auditHistory) ? record.auditHistory.slice() : [];
  next.auditHistory.push({
    action: type,
    from,
    to,
    by: actor,
    at: now,
    reason,
    revision,
  });
  next.auditAttempts = Array.isArray(record.auditAttempts) ? record.auditAttempts.slice() : [];
  next.auditAttempts.push({
    attempt: (record.auditAttempts ? record.auditAttempts.length : 0) + 1,
    result: attemptResultOf(to, from),
    by: actor,
    at: now,
    reason,
    fromVersion: Number(record.revision) || 0,
    toVersion: revision,
  });
  return { ok: true, batch: next };
}

/**
 * Record an EOSB correction. The UI hands a FRESH calculateEOSB() object
 * (no sealed history) — existing history ALWAYS wins (will never be lost):
 *   - same record id (the fresh object is re-bound to the returned record)
 *   - baselineSnapshot / rejectedSnapshot carried over when missing
 *   - existing versions re-seeded (dedup by versionId) then extended
 *   - revision counts forwards from the previous value, never restarts
 *   - Old->New changes captured per monetary field with who/when/why
 * Returns { ok, batch }; the fresh object is returned intact on error.
 */
export function recordEosbCorrection(prev, next, opts = {}) {
  if (!prev || !next) return { ok: false, error: 'no_record', batch: next };
  if (!prev.rejectedBy) return { ok: false, error: 'correction_requires_returned', batch: next };
  const now = opts.at || new Date().toISOString();
  const actor = opts.by || '';
  const reason = opts.reason || 'correction after audit return';
  const base = prev.rejectedSnapshot || eosbFinancialSnapshot(prev, { by: actor, at: now });

  next.id = prev.id || next.id;
  next.employeeId = prev.employeeId || next.employeeId;
  ['baselineSnapshot', 'rejectedSnapshot'].forEach((f) => {
    if (next[f] === undefined || next[f] === null) next[f] = prev[f];
  });

  const prevVersions = Array.isArray(prev.versions) ? prev.versions : [];
  const nextVersions = Array.isArray(next.versions) ? next.versions : [];
  if (prevVersions.length) {
    const known = new Set(prevVersions.map((v) => versionIdOfEosb(v)).filter(Boolean));
    next.versions = prevVersions.concat(nextVersions.filter((v) => !known.has(versionIdOfEosb(v))));
  } else if (!Array.isArray(next.versions)) {
    next.versions = [];
  }

  next.revision = Math.max(Number(next.revision) || 0, Number(prev.revision) || 0);
  const revision = next.revision + 1;
  next.status = 'draft';
  next.returnState = 'corrected';
  next.revision = revision;
  next.updatedAt = now;
  next.eosbSchema = EOSB_SCHEMA;
  ['rejectedBy', 'rejectedAt', 'rejectionReason'].forEach((f) => {
    if (prev[f] !== undefined) next[f] = prev[f];
  });

  const changes = [];
  EOSB_MONETARY_FIELDS.forEach((f) => {
    if (base[f] === undefined || next[f] === undefined) return;
    const oldV = Number(base[f]) || 0;
    const newV = Number(next[f]) || 0;
    if (Math.abs(oldV - newV) > 0.0001) changes.push({ field: f, oldValue: oldV, newValue: newV });
  });

  next.corrections = Array.isArray(prev.corrections) ? prev.corrections.slice() : [];
  next.corrections.push({
    by: actor,
    at: now,
    reason,
    changes,
    fromVersion: prev.revision || 0,
    toVersion: revision,
  });

  next.versions = pushEosbVersion(next, { type: 'corrected', version: revision, status: 'draft', by: actor, at: now, reason });
  next.auditHistory = Array.isArray(prev.auditHistory) ? prev.auditHistory.slice() : [];
  next.auditHistory.push({ action: 'corrected', from: 'draft', to: 'draft', by: actor, at: now, reason, revision });
  next.auditAttempts = Array.isArray(prev.auditAttempts) ? prev.auditAttempts.slice() : [];
  next.auditAttempts.push({
    attempt: (prev.auditAttempts ? prev.auditAttempts.length : 0) + 1,
    result: 'corrected',
    by: actor,
    at: now,
    reason,
    fromVersion: prev.revision || 0,
    toVersion: revision,
  });
  return { ok: true, batch: next };
}