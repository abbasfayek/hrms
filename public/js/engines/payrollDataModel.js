// =========================================================
// HRMS Payroll Audit Data Model — Phase 3 (Spec v1.0)
// =========================================================
//
// Additive, backward-compatible data model layered on top of the Phase 1
// payroll engine. It does NOT change the state machine, financial formulas,
// permissions or any existing field — it only ADDS the canonical, append-only
// audit information needed to reconstruct full payroll history:
//
//   baselineSnapshot   — the original financial values (first submission),
//                        deep-copied and sealed so later edits never alter it.
//   versions[]         — every version now carries versionId, status,
//                        prevVersionId / nextVersionId links and a full
//                        financialSnapshot (point-in-time monetary values).
//   approvalReference  — approver + timestamp + linked version id.
//   paymentReference   — disbursement reference (Payment Queue is a logical
//                        point, never a separate entity), amount by currency.
//   archiveReference   — archival stamp reference on the paid terminal state.
//   payrollSchema      — 'p3' marker so readers can detect the model version.
//
// Read-side helpers (pure, non-destructive):
//   versionChain(), resubmissionRounds(), originalFinancialValues(),
//   financialChangeLog() and normalizeRecord() (read-time migration that
//   upgrades legacy records WITHOUT touching them — input is never mutated).
//
// Circular-import safe: this module never imports the engine.

export const PAYROLL_SCHEMA = 'p3';

// Kept in sync with payrollEngine.MONETARY_FIELDS. A financial snapshot is a
// deep copy of exactly these numeric fields per item, so a version can be
// replayed without ever depending on the current record.
export const MONETARY_FIELDS = [
  'basicSalary', 'housingAllowance', 'transportAllowance', 'otherAllowances',
  'overtimeAmount', 'bonuses', 'totalEarnings', 'grossSalary',
  'gosiEmployeeDeduction', 'gosiCompanyContribution', 'loanInstallment',
  'absentDays', 'absenceDeduction', 'lateMinutes', 'lateDeduction',
  'otherDeductions', 'penaltiesDeduction', 'totalDeductions', 'netSalary',
];

const TOTAL_FIELDS = ['totalGross', 'totalDeductions', 'totalNet', 'totalCompanyGosi'];

// Stable, unique reference id. Tests may inject their own via opts.referenceId.
export function uid(prefix = 'REF') {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

// Immutable depth-copy: everything out of this module leaves storage, so later
// record updates can never reach sealed historical values by reference.
export function seal(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export function versionIdOf(v) {
  if (!v) return null;
  return (v && v.versionId) || (v && v.version !== undefined ? `V${v.version}` : null);
}

/**
 * Build a canonical, sealed financial snapshot of a batch's CURRENT monetary
 * values. Every array is copied; the result has no reference to the live batch.
 */
export function financialSnapshot(batch, opts = {}) {
  if (!batch) return null;
  const items = (batch.items || []).map((it) => {
    const snap = { employeeId: it.employeeId, employeeName: it.employeeName, currency: it.currency, currencySymbol: it.currencySymbol };
    MONETARY_FIELDS.forEach((f) => { snap[f] = Number(it[f]) || 0; });
    return snap;
  });
  const totalsByCurrency = (batch.totalsByCurrency || []).map((g) => ({
    code: g.code, symbol: g.symbol,
    gross: Number(g.gross) || 0,
    deductions: Number(g.deductions) || 0,
    net: Number(g.net) || 0,
    companyGosi: Number(g.companyGosi) || 0,
    count: g.count,
  }));
  const totals = {};
  TOTAL_FIELDS.forEach((f) => { totals[f] = Number(batch[f]) || 0; });
  return {
    capturedStatus: batch.status || null,
    capturedBy: opts.by !== undefined ? opts.by : null,
    capturedAt: opts.at !== undefined ? opts.at : null,
    ...totals,
    totalsByCurrency,
    items,
  };
}

/**
 * Sealed snapshot of the batch (shorthand for "original values"). Used both for
 * baselineSnapshot and by consumers that need an immutable copy.
 */
export function sealFinancialView(batch) {
  const snap = financialSnapshot(batch);
  return snap ? seal(snap) : null;
}

/**
 * Attach the baseline (original financial values) on the FIRST submission.
 * A batch that already has a baseline is never overwritten — the original
 * values are sealed permanently. Called by the engine on draft → under_audit.
 */
export function ensureBaseline(batch, opts = {}) {
  if (!batch) return batch;
  if (Array.isArray(batch.baselineSnapshot?.items) && batch.baselineSnapshot.items.length !== undefined) return batch;
  const snap = financialSnapshot(batch, { by: opts.by, at: opts.at });
  snap.baselineSource = opts.source || 'first_submit';
  batch.baselineSnapshot = snap;
  return batch;
}

/**
 * Append a version entry to `batch.versions` (returned as a NEW array — the
 * input array is never mutated). Each entry receives:
 *   versionId (V{version}), status (the batch state AFTER this version),
 *   prevVersionId / nextVersionId explicit links and a sealed
 *   financialSnapshot. Linking a later version back-fills nextVersionId on
 *   the previous version, building the explicit Rejected → Corrected →
 *   Resubmitted chain while keeping old fields (type/version/by/at/reason).
 */
export function pushVersion(batch, entry) {
  const versions = Array.isArray(batch.versions) ? batch.versions : [];
  const nextVersions = versions.map((v) => ({ ...v }));
  const prev = nextVersions[nextVersions.length - 1] || null;
  const versionId = `V${entry.version}`;
  const snapshot = financialSnapshot(batch, { by: entry.by, at: entry.at });
  const ver = {
    type: entry.type,
    version: entry.version,
    status: entry.status || batch.status || null,
    by: entry.by,
    at: entry.at,
    reason: entry.reason || '',
    versionId,
    prevVersionId: prev ? versionIdOf(prev) : null,
    nextVersionId: null,
    financialSnapshot: snapshot,
  };
  if (prev) prev.nextVersionId = versionId;
  nextVersions.push(ver);
  return nextVersions;
}

export function attachApprovalReference(batch, opts = {}) {
  if (!batch) return null;
  batch.approvalReference = {
    referenceId: opts.referenceId || uid('APR'),
    approvedAt: opts.at,
    approvedBy: opts.by,
    status: 'approved',
    versionId: opts.versionId || null,
  };
  return batch.approvalReference;
}

export function attachPaymentReference(batch, opts = {}) {
  if (!batch) return null;
  batch.paymentReference = {
    referenceId: opts.referenceId || uid('PAY'),
    executedAt: opts.at,
    executedBy: opts.by,
    status: 'disbursed',
    versionId: opts.versionId || null,
    amounts: (batch.totalsByCurrency || []).map((g) => ({ code: g.code, symbol: g.symbol, net: Number(g.net) || 0 })),
  };
  return batch.paymentReference;
}

export function attachArchiveReference(batch, opts = {}) {
  if (!batch) return null;
  batch.archiveReference = {
    referenceId: opts.referenceId || uid('ARC'),
    archivedAt: opts.at,
    archivedBy: opts.by,
    reason: opts.reason || '',
  };
  return batch.archiveReference;
}

/**
 * Ordered version chain with explicit links (works for normalized and legacy
 * records alike). Each entry exposes a summary derived from its OWN sealed
 * financialSnapshot (never from the current record).
 */
export function versionChain(batch) {
  const versions = Array.isArray(batch.versions) ? batch.versions : [];
  return versions.map((v) => {
    const snap = v.financialSnapshot;
    return {
      versionId: versionIdOf(v),
      type: v.type,
      version: v.version,
      status: v.status || null,
      by: v.by,
      at: v.at,
      reason: v.reason,
      prevVersionId: v.prevVersionId != null ? v.prevVersionId : null,
      nextVersionId: v.nextVersionId != null ? v.nextVersionId : null,
      summary: snap
        ? { totalGross: snap.totalGross, totalDeductions: snap.totalDeductions, totalNet: snap.totalNet, totalsByCurrency: (snap.totalsByCurrency || []).map((g) => ({ code: g.code, net: g.net })) }
        : null,
    };
  });
}

/**
 * The explicit Rejected → Corrected → Resubmitted rounds. Each round links the
 * version ids that belong to the same audit-return cycle.
 */
export function resubmissionRounds(batch) {
  const versions = Array.isArray(batch.versions) ? batch.versions : [];
  const rounds = [];
  for (let i = 0; i < versions.length; i++) {
    if (versions[i].type !== 'rejected') continue;
    let corrected = null;
    let resubmitted = null;
    for (let j = i + 1; j < versions.length; j++) {
      if (!corrected && versions[j].type === 'corrected') corrected = versions[j];
      if (versions[j].type === 'resubmitted') { resubmitted = versions[j]; break; }
    }
    rounds.push({ rejected: versionIdOf(versions[i]), corrected: corrected ? versionIdOf(corrected) : null, resubmitted: resubmitted ? versionIdOf(resubmitted) : null });
  }
  return rounds;
}

/**
 * Original (first submission) financial values. For NEW records this is the
 * sealed baselineSnapshot. For legacy records (no baseline was captured) the
 * earliest authoritative financial point — the rejected snapshot, when one was
 * stored — is returned instead; otherwise null (nothing was ever recorded).
 * Never rebuilds history from the current record.
 */
export function originalFinancialValues(batch) {
  if (!batch) return null;
  if (Array.isArray(batch.baselineSnapshot?.items)) return seal(batch.baselineSnapshot);
  const snaps = Array.isArray(batch.versions) ? batch.versions.filter((v) => v.type === 'rejected' && v.financialSnapshot) : [];
  if (snaps.length) return seal(snaps[snaps.length - 1].financialSnapshot);
  if (batch.rejectedSnapshot) return seal(batch.rejectedSnapshot);
  return null;
}

/**
 * Append-only financial change log, derived deterministically from the
 * authoritative append-only fields (auditHistory + corrections). kind is the
 * audit action; the affected version is linked by revision. NEVER derived from
 * the current monetary record.
 */
export function financialChangeLog(batch) {
  const history = Array.isArray(batch.auditHistory) ? batch.auditHistory : [];
  const corrections = Array.isArray(batch.corrections) ? batch.corrections : [];
  return history.map((a, i) => {
    const evt = {
      eventId: `FE-${i + 1}`,
      kind: a.action,
      from: a.from,
      to: a.to,
      at: a.at,
      by: a.by,
      reason: a.reason || '',
      revision: a.revision,
      versionId: a.revision !== undefined ? `V${a.revision}` : null,
    };
    if (a.action === 'corrected') {
      const c = corrections.find((x) => Number(x.toVersion) === Number(a.revision));
      evt.changes = c && Array.isArray(c.changes) ? c.changes.map((ch) => ({ ...ch })) : [];
    }
    return evt;
  });
}

/**
 * Read-time upgrade projection for legacy records (migration strategy). Pure:
 * the input record is NEVER mutated. Idempotent: repeated calls produce the
 * same structure (version ids fall back to V{version}, links are recomputed
 * deterministically from order, missing tail snapshot is synthesized from the
 * current record ONLY for the last version — the honest ceiling of what legacy
 * storage can reconstruct). Middle-version gaps are left null rather than
 * fabricated.
 */
export function normalizeRecord(batch) {
  if (!batch || typeof batch !== 'object') return batch;
  try {
    const versions = Array.isArray(batch.versions) ? batch.versions : [];
    const lastIdx = versions.length - 1;
    const history = Array.isArray(batch.auditHistory) ? batch.auditHistory : [];
    const statusFor = (v, i) => {
      if (v.status) return v.status;
      const hit = history.find((a) => Number(a.revision) === Number(v.version));
      if (hit && hit.to) return hit.to;
      return i === lastIdx ? (batch.status || null) : null;
    };
    const normalizedVersions = versions.map((v, i) => {
      const id = (v && v.versionId) || `V${v.version}`;
      const prevId = v && v.prevVersionId != null ? v.prevVersionId : (i > 0 ? (versions[i - 1].versionId || `V${versions[i - 1].version}`) : null);
      const nextId = v && v.nextVersionId != null ? v.nextVersionId : (i < lastIdx ? (versions[i + 1].versionId || `V${versions[i + 1].version}`) : null);
      let snap = v && v.financialSnapshot;
      if (!snap && i === lastIdx && !v.financialSnapshot) {
        snap = financialSnapshot(batch, {});
        snap.synthesized = true;
      }
      return {
        ...v,
        versionId: id,
        prevVersionId: prevId,
        nextVersionId: nextId,
        status: statusFor(v, i),
        financialSnapshot: snap || (v ? v.financialSnapshot : null),
      };
    });
    return {
      ...batch,
      payrollSchema: batch.payrollSchema || PAYROLL_SCHEMA,
      recordModel: 'p3',
      versions: normalizedVersions,
    };
  } catch (e) {
    // A corrupt legacy record must never break reads — return it untouched.
    return batch;
  }
}