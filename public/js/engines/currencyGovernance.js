// =========================================================
// HRMS Currency Governance & Exchange-Rate Model — Phase 4
// (Financial Workflow & Currency Specification v1.0)
// =========================================================
//
// DOCUMENTED POLICY (approved decisions, recorded in
// docs/P4-Currency-Governance-Release-Report.txt):
//   - Source ......... manual entry, documented (effective date + optional note)
//   - Authority ...... super_admin only (no role changes)
//   - Pin point ...... price resolved at financial-record creation
//                      (Transaction-level snapshot stamped on the record)
//   - Immutability ... a rate referenced by a committed record is LOCKED —
//                      silent/historical change is impossible; a new rate is a
//                      NEW snapshot for future records (no retroactive recalc)
//   - Pre-pin edit ... allowed only for the latest, still-unused rate; every
//                      edit is recorded as append-only history (from/to/by/at/why)
//   - Revaluation .... NONE (no retroactive revaluation entity)
//   - Base currency .. settings.baseCurrency (default USD); only future records
//                      are affected when it changes; historical baseAmount is
//                      never rewritten
//   - Precision ...... amounts/baseAmount: 2 decimals (Half-Up);
//                      exchange rates: 6 decimals
//   - Scope .......... payroll items + totalsByCurrency, EOSB, loans
//
// This module is the single source of truth for currency mixing guards, rate
// snapshots and explicit base-currency conversion. It NEVER sums different
// currencies into one number, and it NEVER re-rates a historical transaction.
//
// Circular-import safe: imports only ../types.js (getAllCurrencies).

import { getAllCurrencies } from '../types.js';

export const GOVERNANCE_SCHEMA = 'p4';
export const DEFAULT_BASE_CURRENCY = 'USD';
export const RATE_PRECISION = 6;
export const AMOUNT_PRECISION = 2;
export const SAME_CURRENCY_RATE = 1;

// ---------------------------------------------------------------------------
// Precision / rounding — the ONLY rounding policy in the system
// ---------------------------------------------------------------------------

// Monetary amounts: rounded to AMOUNT_PRECISION decimals, Half-Up.
export function roundAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return parseFloat(r.toFixed(AMOUNT_PRECISION));
}

// Exchange rates: rounded to RATE_PRECISION decimals, Half-Up.
export function roundRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const r = Math.round((n + Number.EPSILON) * 1e6) / 1e6;
  return r;
}

// ---------------------------------------------------------------------------
// Base currency resolution
// ---------------------------------------------------------------------------
export function resolveBaseCurrency(settings = {}) {
  return String(settings.baseCurrency || settings.currency || DEFAULT_BASE_CURRENCY).trim().toUpperCase() || DEFAULT_BASE_CURRENCY;
}

// ---------------------------------------------------------------------------
// Rate master (settings.exchangeRates) — append-only + locked entries
// ---------------------------------------------------------------------------

export function getRates(settings = {}) {
  return Array.isArray(settings.exchangeRates)
    ? settings.exchangeRates.map((r) => ({ ...r, history: Array.isArray(r.history) ? r.history.map((h) => ({ ...h })) : [] }))
    : [];
}

export function knownCurrencyCodes(settings = {}) {
  return getAllCurrencies(settings).map((c) => String(c.code).trim().toUpperCase());
}

// The active rate for a currency: the LATEST entry among those bound to the
// current base currency. Locked entries are still the authoritative snapshot
// for the operation date they covered; a newer unlocked entry supersedes it.
export function getActiveRate(settings = {}, currency) {
  const base = resolveBaseCurrency(settings);
  const code = currency ? String(currency).trim().toUpperCase() : '';
  if (!code) return null;
  const suited = getRates(settings).filter((r) => r.currency === code && r.baseCurrency === base);
  if (!suited.length) return null;
  return suited.sort((a, b) => String(b.rateDate || b.createdAt || '').localeCompare(String(a.rateDate || a.createdAt || '')))[0];
}

// Authority: exchange-rate governance is super_admin only (documented).
export function canGovern(user) {
  return !!user && user.role === 'super_admin';
}

/**
 * Create a new rate, or edit the latest still-unused rate for a currency.
 * Pre-pin edits are recorded as append-only history. Locked entries can never
 * be edited — that would change historical results. Returns { ok, ... }.
 */
export function setExchangeRate(settings = {}, opts = {}) {
  if (!canGovern(opts.user)) return { ok: false, error: 'permission_denied', message: 'Only the Super Admin (general permission) can manage exchange rates' };
  const base = resolveBaseCurrency(settings);
  const code = opts.currency ? String(opts.currency).trim().toUpperCase() : '';
  if (!code) return { ok: false, error: 'missing_currency_code' };
  if (code === base) return { ok: false, error: 'base_currency_implicit', message: `${code} is the base currency — its rate is implicitly 1` };
  const catalog = knownCurrencyCodes(settings);
  if (!catalog.includes(code)) return { ok: false, error: `unknown_currency:${code}` };

  const rateNum = Number(opts.rate);
  if (!Number.isFinite(rateNum) || rateNum <= 0) return { ok: false, error: 'invalid_exchange_rate', message: 'Exchange rate must be a positive finite number' };
  const rate = roundRate(rateNum);
  if (rate <= 0) return { ok: false, error: 'invalid_exchange_rate' };

  const rateDate = String(opts.rateDate || new Date().toISOString().split('T')[0]);
  const now = new Date().toISOString();
  const actor = opts.by || opts.user?.name || '';

  const rates = getRates(settings);
  const active = getActiveRate(settings, code);

  if (active) {
    // A locked rate is IMMUTABLE: editing it in place would silently change
    // historical results. The caller must APPEND a new rate (newRate: true) —
    // a new snapshot that only affects records created going forward.
    if (active.locked && !opts.newRate) {
      return { ok: false, error: 'rate_locked', message: `The rate for ${code} is locked by a committed financial record — create a new rate instead` };
    }
    if (active.locked) {
      const entry = makeRateEntry(code, base, rate, rateDate, now, actor, opts.note || '');
      return { ok: true, action: 'created', saved: entry, rates: [...rates, entry] };
    }
    const histories = rates.map((r) => (r.id === active.id ? {
      ...r,
      rate,
      rateDate: opts.rateDate !== undefined ? String(opts.rateDate) : r.rateDate,
      note: opts.note !== undefined ? opts.note : r.note,
      updatedAt: now,
      history: [...(r.history || []), { from: r.rate, to: rate, by: actor, at: now, reason: opts.reason || '' }],
    } : r));
    const saved = histories.find((r) => r.id === active.id);
    return { ok: true, action: 'updated', saved, rates: histories };
  }

  const entry = makeRateEntry(code, base, rate, rateDate, now, actor, opts.note || '');
  return { ok: true, action: 'created', saved: entry, rates: [...rates, entry] };
}

function makeRateEntry(currency, baseCurrency, rate, rateDate, now, by, note) {
  return {
    id: `RATE-${currency}-${Date.now().toString(36).toUpperCase()}`,
    currency,
    baseCurrency,
    rate,
    rateDate,
    createdAt: now,
    createdBy: by,
    note: note || '',
    locked: false,
    history: [],
  };
}

// Mark the active rate for a currency as locked (referenced by a committed
// financial record). Never unlocks; a new rate can still be ADDED afterward.
export function lockExchangeRate(settings = {}, currency) {
  const code = currency ? String(currency).trim().toUpperCase() : '';
  if (!code) return getRates(settings);
  const lockedAt = new Date().toISOString();
  return getRates(settings).map((r) => (r.currency === code && !r.locked ? { ...r, locked: true, lockedAt } : r));
}

// ---------------------------------------------------------------------------
// Transaction-level rate snapshot
// ---------------------------------------------------------------------------

/**
 * Resolve the rate snapshot that governs a financial operation `at` a given
 * moment for a currency. The SAME-currency case is implicit (rate = 1). Any
 * other currency without a documented rate fails loudly — no silent fallback.
 */
export function resolveRecordSnapshot(settings = {}, opts = {}) {
  const base = resolveBaseCurrency(settings);
  const code = opts.currency ? String(opts.currency).trim().toUpperCase() : '';
  if (!code) return { ok: false, error: 'missing_currency_code' };
  if (code === base) {
    return {
      ok: true,
      implicit: true,
      snapshot: { exchangeRate: SAME_CURRENCY_RATE, exchangeRateDate: opts.at || null, baseCurrency: base, source: 'same_currency' },
    };
  }
  const active = getActiveRate(settings, code);
  if (!active) return { ok: false, error: `missing_exchange_rate:${code}` };
  return {
    ok: true,
    implicit: false,
    snapshot: { exchangeRate: active.rate, exchangeRateDate: active.rateDate || active.createdAt || null, baseCurrency: base, source: active.note || active.createdBy || 'manual' },
  };
}

// Pure conversion against a GIVEN snapshot — historical-safe by construction:
// it never consults current settings, so a historical baseAmount can never be
// recomputed with today's rate.
export function convertWithSnapshot(amount, snapshot) {
  if (!snapshot || !(Number(snapshot.exchangeRate) > 0)) return { ok: false, error: 'missing_exchange_rate' };
  return { ok: true, baseAmount: roundAmount(Number(amount || 0) * Number(snapshot.exchangeRate)), snapshot };
}

// Live conversion for NEW records: resolves the current snapshot then converts.
export function toBaseAmount(settings = {}, { amount, currency, at } = {}) {
  const res = resolveRecordSnapshot(settings, { currency, at });
  if (!res.ok) return res;
  const conv = convertWithSnapshot(amount, res.snapshot);
  return conv;
}

// ---------------------------------------------------------------------------
// Currency-mixing guards (the hard "USD + IQD is forbidden" rules)
// ---------------------------------------------------------------------------

/**
 * Aggregate amounts grouped BY ORIGINAL currency — different currencies are
 * NEVER merged into one number. Returns per-currency segments.
 */
export function sumSameCurrency(entries = []) {
  const groups = new Map();
  entries.forEach((e) => {
    const code = e && e.currency ? String(e.currency).trim().toUpperCase() : '';
    const key = code || 'NO_CURRENCY';
    groups.set(key, (groups.get(key) || 0) + (Number(e.amount) || 0));
  });
  return Array.from(groups.entries()).map(([currency, amount]) => ({ currency, amount: roundAmount(amount) }));
}

// Explicit guard: refuses a single merged number for mixed currencies.
export function assertSameCurrency(entries = []) {
  const seg = sumSameCurrency(entries);
  if (seg.length <= 1) return { ok: true, segments: seg, baseAmount: seg.length ? seg[0].amount : 0 };
  const codes = seg.map((s) => s.currency);
  return { ok: false, error: `currency_mix:${codes.join('+')}`, segments: seg };
}

/**
 * Explicit conversion to the base currency, using EACH entry's OWN rate
 * snapshot (transaction-level). This is the ONLY permitted cross-currency
 * aggregation — silent mixing is forbidden. Entries whose currency is the base
 * require no snapshot (rate is implicitly 1).
 */
export function sumInBase(entries = [], settings = {}) {
  const base = resolveBaseCurrency(settings);
  let total = 0;
  for (const e of entries) {
    const code = e.currency ? String(e.currency).trim().toUpperCase() : '';
    if (code === base) {
      total += Number(e.amount) || 0;
      continue;
    }
    const snapshot = e.snapshot;
    if (!snapshot || !Number.isFinite(Number(snapshot.exchangeRate))) {
      return { ok: false, error: `missing_exchange_rate:${code}` };
    }
    const conv = convertWithSnapshot(e.amount, snapshot);
    if (!conv.ok) return conv;
    total += conv.baseAmount;
  }
  return { ok: true, baseAmount: roundAmount(total), baseCurrency: base };
}

// ---------------------------------------------------------------------------
// Governance stampers — attach the mandatory fields to financial records.
// All are PURELY ADDITIVE and never overwrite an already-sealed snapshot.
// ---------------------------------------------------------------------------

function todayISO() {
  return new Date().toISOString();
}

function stamped(record) {
  return record && (record.baseAmount !== undefined || record.exchangeRateStatus !== undefined);
}

// Stamp the 6 mandatory fields on a single money-bearing object
// (payroll item, totalsByCurrency row, eosb record, loan record).
// force=true re-resolves even an already-stamped row (used by WORKING payroll
// copies, so a pre-pin rate edit genuinely affects the pending draft).
export function stampAmountRecord(record, settings, { amount, currency, at, force } = {}) {
  if (!record || typeof record !== 'object') return record;
  if (!force && stamped(record)) return record;
  const base = resolveBaseCurrency(settings);
  const code = (currency || record.currency || base);
  const resolved = resolveRecordSnapshot(settings, { currency: code, at });
  const resolveAmount = () => Number(amount !== undefined
    ? amount
    : (record.amount !== undefined ? record.amount
      : (record.netSalary !== undefined ? record.netSalary
        : (record.net !== undefined ? record.net
          : (record.total !== undefined ? record.total : 0))))) || 0;
  if (resolved.ok) {
    const conv = convertWithSnapshot(resolveAmount(), resolved.snapshot);
    record.amount = resolveAmount();
    record.currency = code;
    record.exchangeRate = resolved.snapshot.exchangeRate;
    record.exchangeRateDate = resolved.snapshot.exchangeRateDate;
    record.baseCurrency = resolved.snapshot.baseCurrency;
    record.baseAmount = conv.ok ? conv.baseAmount : null;
    record.exchangeRateStatus = 'ok';
  } else {
    record.amount = resolveAmount();
    record.currency = code;
    record.exchangeRate = null;
    record.exchangeRateDate = null;
    record.baseCurrency = base;
    record.baseAmount = null;
    record.exchangeRateStatus = 'missing';
  }
  return record;
}

/**
 * Stamp a payroll batch (items + totalsByCurrency + governance summary).
 * Purely additive and snapshot-safe:
 *   - WORKING copies (draft, or first commit) re-resolve every row, so pre-pin
 *     rate edits apply to the pending record; these rows carry a provisional
 *     marker and become sealed snapshots only at the commit save.
 *   - COMMITTED re-saves never touch already-sealed rows; fresh rows (e.g.
 *     corrected items) receive their own transaction-level snapshot.
 *   - missing-rate rows are sealed as 'missing' and never backfilled later.
 * Returns { batch, freshlyResolvedCurrencies } (only commit-time resolutions).
 */
export function stampPayrollBatch(batch, settings = {}, opts = {}) {
  if (!batch || typeof batch !== 'object') return { batch, freshlyResolvedCurrencies: [] };
  const base = resolveBaseCurrency(settings);
  const at = opts.at || todayISO();
  const isWorkingCopy = !batch.status || batch.status === 'draft';
  const freshLockTargets = new Set();
  let anyChange = false;

  const visit = (row, amountField, codeField) => {
    if (!row) return;
    const needsRefresh = isWorkingCopy || row.snapshotDraft === true;
    const neverStamped = !stamped(row);
    if (needsRefresh) {
      stampAmountRecord(row, settings, { amount: row[amountField], currency: row[codeField], at, force: true });
      anyChange = true;
      delete row.snapshotDraft;
      if (row.exchangeRateStatus === 'ok') {
        if (isWorkingCopy) row.snapshotDraft = true; // still provisional — refresh on next save
        else if (String(row.currency) !== base) freshLockTargets.add(String(row.currency));
      }
    } else if (neverStamped) {
      // committed batch gains a brand-new money row (correction) — seal it now.
      stampAmountRecord(row, settings, { amount: row[amountField], currency: row[codeField], at });
      anyChange = true;
      if (row.exchangeRateStatus === 'ok' && String(row.currency) !== base) freshLockTargets.add(String(row.currency));
    }
  };

  (batch.items || []).forEach((it) => visit(it, 'netSalary', 'currency'));
  (batch.totalsByCurrency || []).forEach((g) => visit(g, 'net', 'code'));

  if (!anyChange && batch.governance !== undefined) {
    return { batch, freshlyResolvedCurrencies: [] };
  }

  let baseAmountTotal = 0;
  let resolved = true;
  (batch.items || []).forEach((it) => {
    if (it.exchangeRateStatus === 'missing') { resolved = false; return; }
    baseAmountTotal += Number(it.baseAmount) || 0;
  });

  const distinctCurrencies = new Set((batch.items || []).map((it) => String(it.currency || base)));
  const nonBase = [...distinctCurrencies].filter((c) => c !== base);

  batch.governance = {
    schema: GOVERNANCE_SCHEMA,
    baseCurrency: base,
    baseAmountTotal: resolved ? roundAmount(baseAmountTotal) : null,
    // A single record whose original amounts span 2+ currencies may NEVER be
    // merged into one currency-blind number — it is flagged as mixed.
    mixedCurrencies: distinctCurrencies.size > 1,
    currencies: [...distinctCurrencies],
    resolvedAt: at,
  };
  batch.currencyModel = GOVERNANCE_SCHEMA;
  return { batch, freshlyResolvedCurrencies: [...freshLockTargets] };
}

// EOSB settlements are committed financial records at creation.
export function stampEosbRecord(record, settings = {}, opts = {}) {
  if (!record || typeof record !== 'object') return { record, followCurrencies: [] };
  const base = resolveBaseCurrency(settings);
  const currency = record.currency || record.salaryCurrency || base;
  const amount = Number(record.netSettlementAmount ?? record.total ?? 0);
  const follow = [];
  stampAmountRecord(record, settings, { amount, currency });
  if (record.baseAmount !== undefined && record.exchangeRateStatus === 'ok' && String(currency).toUpperCase() !== base) follow.push(String(currency).toUpperCase());
  record.governance = { schema: GOVERNANCE_SCHEMA, baseCurrency: base, baseAmount: record.baseAmount, resolvedAt: opts.at || todayISO() };
  record.currencyModel = GOVERNANCE_SCHEMA;
  return { record, followCurrencies: follow };
}

// Loans are committed financial records at creation / update.
export function stampLoanRecord(record, settings = {}, opts = {}) {
  if (!record || typeof record !== 'object') return { record, followCurrencies: [] };
  if (record.baseAmount !== undefined) return { record, followCurrencies: [] };
  const base = resolveBaseCurrency(settings);
  const currency = record.currency || base;
  const amount = Number(record.amount ?? record.installmentAmount ?? 0);
  const follow = [];
  stampAmountRecord(record, settings, { amount, currency });
  if (record.baseAmount !== undefined && record.exchangeRateStatus === 'ok' && String(currency).toUpperCase() !== base) follow.push(String(currency).toUpperCase());
  record.governance = { schema: GOVERNANCE_SCHEMA, baseCurrency: base, baseAmount: record.baseAmount, resolvedAt: opts.at || todayISO() };
  record.currencyModel = GOVERNANCE_SCHEMA;
  return { record, followCurrencies: follow };
}