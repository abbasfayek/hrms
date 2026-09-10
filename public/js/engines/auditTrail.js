// =========================================================
// HRMS Audit Trail Engine — Phase 5 (Spec v1.0)
// =========================================================
//
// Central, append-only, tamper-evident audit trail for the important
// FINANCIAL operations (payroll, EOSB, loans, exchange-rate governance)
// plus security-denial attempts. This is HISTORY, not an interface log:
// the existing bounded UI log (storage.addAudit) is left untouched.
//
// Design:
//   - A single envelope { schema, seq, chainHead, events[] } is stored under
//     one localStorage key (atomic single write). `events` is unbounded —
//     append-only means historical events are never pruned, edited or
//     re-ordered.
//   - Every event carries prevHash + its own hash = SHA-256 over the
//     canonical (sorted-key) JSON of the event minus the hash field, so any
//     edit, deletion or reordering breaks every subsequent hash.
//   - Appends return a NEW envelope; the input is never mutated (pure,
//     mirroring the currency-governance module).
//   - Currency preservation: financial events freeze the Phase 4 fields
//     (amount/currency/exchangeRate/exchangeRateDate/baseAmount/baseCurrency)
//     that were ALREADY stamped on the record; they are copied, never
//     recomputed with a later rate.
//   - Linkage: each event references the record's version chain (versionId),
//     the rejection record (rejectedBy/At/reason), the correction changes and
//     the audit-attempt counter — never replacing the closed Phase 1/3 data.
//
// Integrity ceiling: a full cryptographic server is outside this offline
// app; the chain makes ANY historical change detectable (verifyAuditTrail
// reports the first broken link) and prevents accidental overwrite/edits.

export const AUDIT_SCHEMA = 'p5';

// Canonical event actions (mandated workflow events + explicitly-denied
// attempts + non-workflow financial records that still matter).
export const AUDIT_ACTIONS = {
  CREATED: 'created',          // financial record enters the system
  SUBMITTED: 'submitted',      // draft -> under_audit (first submission)
  RESUBMITTED: 'resubmitted',  // rejected -> under_audit
  REJECTED: 'rejected',        // under_audit -> rejected (Returned/Needs Correction)
  CORRECTED: 'corrected',      // correction recorded on a returned record
  APPROVED: 'approved',
  PAID: 'paid',                // disbursement / payment
  ARCHIVE: 'archive',          // archival stamp (paid -> archived view)
  UPDATED: 'updated',          // loan / non-workflow record edit
  CANCEL_PAYMENT: 'cancel_payment', // paid -> approved (payment cancelled)
  EXCHANGE_RATE_SET: 'exchange_rate_set',
  EXCHANGE_RATE_UPDATED: 'exchange_rate_updated',
  EXCHANGE_RATE_LOCKED: 'exchange_rate_locked',
  DENIED: 'denied',            // security-denied attempt (never a success event)
  RECORDS_CLEARED: 'records_cleared',
  DATA_RESET: 'data_reset',
  BACKUP_RESTORED: 'backup_restored',
};

export const AUDIT_RECORD_TYPES = {
  PAYROLL: 'payroll',
  EOSB: 'eosb',
  LOAN: 'loan',
  EXCHANGE_RATE: 'exchange_rate',
  SYSTEM: 'system',
};

// ---------------------------------------------------------------------------
// Compact synchronous SHA-256 (FIPS 180-4) so the chain can be computed and
// verified offline (Node or browser) without async crypto. Tested against the
// NIST vectors ('' and 'abc').
// ---------------------------------------------------------------------------
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function toBytes(str) {
  // UTF-8 encode (TextEncoder is available in every modern Node/browser).
  if (typeof str !== 'string') str = String(str);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  // Fallback UTF-8 encoder for exotic environments.
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) { out.push(c); }
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      i++;
      c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

function rotr(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

export function sha256hex(message) {
  const bytes = toBytes(message);
  const bitLen = bytes.length * 8;
  const paddedLength = ((bytes.length + 8) >> 6 << 6) + 64;
  const words = new Uint32Array(paddedLength >> 2);
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] |= bytes[i] << (24 - ((i & 3) * 8));
  }
  words[bytes.length >> 2] |= 0x80 << (24 - ((bytes.length & 3) * 8));
  words[words.length - 2] = Math.floor(bitLen / 0x100000000);
  words[words.length - 1] = bitLen % 0x100000000;

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let block = 0; block < words.length; block += 16) {
    for (let t = 0; t < 16; t++) w[t] = words[block + t];
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const hx = (n) => n.toString(16).padStart(8, '0');
  return (hx(h0) + hx(h1) + hx(h2) + hx(h3) + hx(h4) + hx(h5) + hx(h6) + hx(h7)).toLowerCase();
}

// ---------------------------------------------------------------------------
// Canonical payload serialization (sorted object keys) so hashing is stable
// regardless of insertion order. The `hash` field itself is excluded.
// ---------------------------------------------------------------------------
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out = {};
    Object.keys(value).sort().forEach((k) => { out[k] = sortKeys(value[k]); });
    return out;
  }
  return value;
}

export function canonicalize(entry) {
  const clone = { ...entry };
  delete clone.hash;
  delete clone.prevHashLabel; // never included in content
  return JSON.stringify(sortKeys(clone));
}

export function hashEntry(entry) {
  return sha256hex(canonicalize(entry));
}

export function newEnvelope() {
  return { schema: AUDIT_SCHEMA, seq: 0, chainHead: null, events: [] };
}

export function newEventId(prefix = 'EV') {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/**
 * Append one event. Returns { envelope, event } — a NEW envelope (the input
 * is never mutated). The event is sealed into the chain (prevHash + hash).
 */
export function appendAuditEvent(envelope, payload) {
  const events = (envelope && Array.isArray(envelope.events)) ? envelope.events : [];
  const prev = events[events.length - 1] || null;
  const event = {
    ...payload,
    eventId: payload.eventId || newEventId('EV'),
    seq: events.length + 1,
    schema: AUDIT_SCHEMA,
    at: payload.at || new Date().toISOString(),
    prevHash: prev && prev.hash ? prev.hash : null,
  };
  event.hash = hashEntry(event);
  const nextEvents = events.concat([event]);
  return {
    envelope: { schema: AUDIT_SCHEMA, seq: nextEvents.length, chainHead: event.hash, events: nextEvents },
    event,
  };
}

/**
 * Recompute the whole chain and report the first broken link. Never throws on
 * corrupt/missing data — returns a descriptive result instead.
 */
export function verifyAuditTrail(envelope) {
  const events = (envelope && Array.isArray(envelope.events)) ? envelope.events : [];
  if (!events.length) {
    return { ok: true, valid: true, count: 0, brokenAt: null, head: null, chainHead: (envelope && envelope.chainHead) || null, chainOk: true };
  }
  let expectPrev = null;
  let firstBreak = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    let bad = false;
    if (e.prevHash !== expectPrev) bad = true;
    if (hashEntry(e) !== e.hash) bad = true;
    if (bad && firstBreak === null) firstBreak = i;
    expectPrev = e.hash;
  }
  const head = events[events.length - 1].hash;
  const chainOk = head === (envelope && envelope.chainHead ? envelope.chainHead : null);
  return {
    ok: true,
    valid: firstBreak === null && chainOk,
    count: events.length,
    brokenAt: firstBreak,
    head,
    chainHead: (envelope && envelope.chainHead) || null,
    chainOk,
  };
}

/** Ordered chronological trace of one record's events (the full timeline). */
export function traceRecord(events, { recordType, recordId }) {
  return (events || [])
    .filter((e) => e.recordType === recordType && String(e.recordId) === String(recordId))
    .sort((a, b) => a.seq - b.seq);
}

/** Grouped trace by record (map recordId -> ordered events). */
export function groupByRecord(events, recordType) {
  const map = {};
  (events || []).forEach((e) => {
    if (e.recordType !== recordType) return;
    const key = String(e.recordId);
    if (!map[key]) map[key] = [];
    map[key].push(e);
  });
  Object.values(map).forEach((arr) => arr.sort((a, b) => a.seq - b.seq));
  return map;
}

// ---------------------------------------------------------------------------
// Currency-preserving financial snapshots (Phase 4 fields are COPIED from the
// already-stamped record — never recomputed against today's rates).
// ---------------------------------------------------------------------------
const CURRENCY_FIELDS = ['amount', 'currency', 'exchangeRate', 'exchangeRateDate', 'baseAmount', 'baseCurrency', 'exchangeRateStatus'];

export function financialFieldsOf(record, opts = {}) {
  const out = {};
  CURRENCY_FIELDS.forEach((k) => {
    if (record && record[k] !== undefined && record[k] !== null) out[k] = record[k];
  });
  // Fall-backs that never fabricate a baseAmount:
  if (!out.currency) {
    const c = (record && (record.salaryCurrency || record.currencySymbol)) || opts.defaultCurrency || null;
    if (c) out.currency = c;
  }
  if (record) {
    if (record.currencyModel !== undefined) out.currencyModel = record.currencyModel;
    if (record.governance !== undefined) out.governance = record.governance;
  }
  return out;
}

export function payrollFinancialView(batch) {
  if (!batch) return null;
  const totals = {};
  ['totalGross', 'totalDeductions', 'totalNet', 'totalCompanyGosi'].forEach((f) => {
    if (batch[f] !== undefined) totals[f] = Number(batch[f]) || 0;
  });
  return {
    status: batch.status || 'draft',
    ...totals,
    totalsByCurrency: (batch.totalsByCurrency || []).map((g) => ({
      code: g.code,
      symbol: g.symbol,
      gross: Number(g.gross) || 0,
      deductions: Number(g.deductions) || 0,
      net: Number(g.net) || 0,
      companyGosi: Number(g.companyGosi) || 0,
      count: g.count,
      // Phase 4 frozen fields ALREADY stamped on the stored row (copied).
      exchangeRate: g.exchangeRate !== undefined && g.exchangeRate !== null ? g.exchangeRate : null,
      exchangeRateDate: g.exchangeRateDate !== undefined && g.exchangeRateDate !== null ? g.exchangeRateDate : null,
      baseCurrency: g.baseCurrency !== undefined && g.baseCurrency !== null ? g.baseCurrency : null,
      baseAmount: g.baseAmount !== undefined && g.baseAmount !== null ? g.baseAmount : null,
      exchangeRateStatus: g.exchangeRateStatus || null,
    })),
    governance: batch.governance || null,
    currencyModel: batch.currencyModel || null,
  };
}

export function sealForEvent(value) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (e) {
    return String(value);
  }
}

/** Reference to the latest auditAttempts entry (linked, never duplicated). */
export function latestAuditAttempt(batch, action) {
  const attempts = (batch && Array.isArray(batch.auditAttempts)) ? batch.auditAttempts : [];
  if (!attempts.length) return null;
  const last = attempts[attempts.length - 1];
  return {
    attempt: last.attempt,
    result: last.result,
    fromVersion: last.fromVersion,
    toVersion: last.toVersion,
    by: last.by || null,
    at: last.at || null,
    action: action || null,
  };
}

/** Rejection linkage from the closed Phase 1 fields (referenced, not replaced). */
export function rejectionReference(batch) {
  if (!batch) return null;
  const ref = {};
  if (batch.rejectedBy !== undefined && batch.rejectedBy !== null) ref.rejectedBy = batch.rejectedBy;
  if (batch.rejectedAt !== undefined && batch.rejectedAt !== null) ref.rejectedAt = batch.rejectedAt;
  if (batch.rejectionReason !== undefined && batch.rejectionReason !== null) ref.rejectionReason = batch.rejectionReason;
  if (batch.returnState !== undefined && batch.returnState !== null) ref.returnState = batch.returnState;
  if (batch.rejectedSnapshot && typeof batch.rejectedSnapshot === 'object') ref.rejectedSnapshot = {
    version: batch.rejectedSnapshot.version !== undefined ? batch.rejectedSnapshot.version : null,
    capturedStatus: batch.rejectedSnapshot.capturedStatus || batch.rejectedSnapshot.status || null,
    capturedAt: batch.rejectedSnapshot.capturedAt || null,
  };
  return (ref.rejectedBy || ref.rejectedAt || ref.rejectionReason || ref.returnState) ? ref : null;
}

export function versionIdOfBatch(batch) {
  if (!batch) return null;
  if (batch.revision === undefined || batch.revision === null) return null;
  return `V${batch.revision}`;
}