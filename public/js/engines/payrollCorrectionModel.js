// =========================================================
// HRMS Payroll Correction Data Model — Phase 9 (Spec v2.1)
// =========================================================
//
// Additive, pure data-model layer for post-payment corrections on archived
// payrolls. It adds NO behaviour to existing payroll flow: it only provides
// the canonical shape of a Correction record, the mandatory component
// catalog (§11.10), the per-payroll display numbering (Decision 7) and a
// sealed, currency-preserving financial view used by the audit trail and the
// Net/Effective reports (Decision 8). Nothing here mutates an input.
//
// Identity (§11.11) is always inherited from the archived original — the
// fields companyId/branchId/payrollPeriodId/originalTransactionId are stamped
// by the guard layer, never typed.
//
// Circular-import safe: this module never imports the engine or storage.

export const CORRECTION_SCHEMA = 'p9';

export const CORRECTION_IDENTITY_FIELDS = [
  'companyId', 'branchId', 'payrollPeriodId', 'originalTransactionId',
];

export const CORRECTION_LINE_FIELDS = [
  'employeeId', 'employeeName', 'componentCode', 'quantity', 'unit',
  'rateOrRuleRef', 'ruleSnapshot', 'calculatedAmount', 'currency', 'symbol',
  'exchangeRate', 'exchangeRateDate', 'baseCurrency', 'baseAmount', 'reason',
  'sourceRef', 'direction', 'manualEntry',
];

// ---------------------------------------------------------------------------
// §11.10 MANDATORY COMPONENT CATALOG.
// The 12 locked codes plus the OTHER_* controlled prefix. `kind` classifies
// the financial direction so reports can present Earnings/Deductions/Adjust.
// Every line carries the full §11.10 identity regardless of the category.
// ---------------------------------------------------------------------------
export const COMPONENT_CATALOG = {
  OVERTIME:        { kind: 'earnings',  category: 'attendance', defaultUnit: 'hours',   calc: 'hours × resolved rule rate (snapshotted)' },
  ABSENCE:         { kind: 'deduction', category: 'attendance', defaultUnit: 'days',    calc: 'days × resolved rule rate (snapshotted)' },
  LATE:            { kind: 'deduction', category: 'attendance', defaultUnit: 'minutes', calc: 'minutes × resolved rule rate (snapshotted)' },
  DEDUCTION:       { kind: 'deduction', category: 'deduction',  defaultUnit: 'units',   calc: 'units × resolved rule rate (snapshotted)' },
  SALARY_CUT:      { kind: 'deduction', category: 'salary',     defaultUnit: 'fixed',   calc: 'fixed reference / formula → amount' },
  ALLOWANCE:       { kind: 'earnings',  category: 'allowance',  defaultUnit: 'fixed',   calc: 'fixed reference / formula → amount' },
  BONUS:           { kind: 'earnings',  category: 'bonus',      defaultUnit: 'fixed',   calc: 'fixed reference / formula → amount' },
  COMMISSION:      { kind: 'earnings',  category: 'commission', defaultUnit: 'units',   calc: 'formula → amount' },
  LOAN_DEDUCTION:  { kind: 'deduction', category: 'loan',       defaultUnit: 'fixed',   calc: 'system reference (loan record) → amount' },
  EOSB_ADJUSTMENT: { kind: 'adjustment', category: 'eosb',      defaultUnit: 'fixed',   calc: 'system reference (EOSB settlement) → amount' },
  TAX_ADJUSTMENT:  { kind: 'adjustment', category: 'tax',       defaultUnit: 'fixed',   calc: 'system reference (tax file) → amount' },
  GOSI_ADJUSTMENT: { kind: 'adjustment', category: 'gosi',      defaultUnit: 'fixed',   calc: 'system reference (GOSI file) → amount' },
};

export function isOtherComponent(code) {
  return typeof code === 'string' && /^OTHER_[A-Z0-9_]+$/.test(code);
}

export function isCatalogComponent(code) {
  return Boolean(COMPONENT_CATALOG[code]) || isOtherComponent(code);
}

export function resolveComponent(code) {
  const known = COMPONENT_CATALOG[code];
  if (known) return { code, ...known, other: false };
  if (isOtherComponent(code)) {
    return { code, kind: 'other', category: 'other', defaultUnit: 'fixed', calc: 'pre-approved OTHER_* (reason + source/approval mandatory)', other: true };
  }
  return null;
}

export function componentLabel(code) {
  const resolved = resolveComponent(code);
  if (!resolved) return String(code || '');
  return resolved.other ? code : code;
}

// ---------------------------------------------------------------------------
// Decision 7 numbering: `{originalTransactionId}-CORR-{n}` sequential per
// original payroll. Sequence = count of existing corrections on that original,
// so rejected/recreated requests still consume a number and numbers are never
// reused (gaps are preserved by design, §11.8).
// ---------------------------------------------------------------------------
export function correctionDisplayNumber(originalTransactionId, sequence) {
  const seq = Math.max(1, Math.floor(Number(sequence) || 1));
  return `${originalTransactionId}-CORR-${String(seq).padStart(3, '0')}`;
}

export function nextCorrectionSequence(existing = [], originalTransactionId) {
  const onOriginal = (existing || [])
    .filter((c) => c && c.originalTransactionId === originalTransactionId);
  return onOriginal.length + 1;
}

// ---------------------------------------------------------------------------
// Sealed financial view of a correction. Pure: never mutates the correction.
// Signed amounts apply the correction direction per line (credit = +1,
// debit = -1) so a single view feeds both the Net/Effective formula and the
// audit-trail financial + component summaries (Rule 5 / Decision 8).
// ---------------------------------------------------------------------------
export function correctionFinancialView(correction, opts = {}) {
  if (!correction || typeof correction !== 'object') return null;
  const lines = Array.isArray(correction.components) ? correction.components : [];
  const viewLines = [];
  const currencyMap = new Map();

  lines.forEach((line) => {
    if (!line || typeof line !== 'object') return;
    const direction = line.direction || correction.direction || 'credit';
    const sign = direction === 'debit' ? -1 : 1;
    const amount = Number(line.calculatedAmount) || 0;
    const baseAmount = Number(line.baseAmount) || 0;
    const currency = line.currency || null;
    const key = currency || null;
    const signed = sign * amount;
    const signedBase = sign * baseAmount;

    viewLines.push({
      employeeId: line.employeeId || null,
      employeeName: line.employeeName || null,
      componentCode: line.componentCode || null,
      quantity: Number(line.quantity) || 0,
      unit: line.unit || null,
      calculatedAmount: amount,
      signedAmount: signed,
      currency,
      symbol: line.symbol || line.currencySymbol || null,
      exchangeRate: line.exchangeRate !== undefined && line.exchangeRate !== null ? Number(line.exchangeRate) : null,
      exchangeRateDate: line.exchangeRateDate || null,
      baseCurrency: line.baseCurrency || null,
      baseAmount,
      signedBaseAmount: signedBase,
      reason: line.reason || '',
      sourceRef: line.sourceRef || null,
      ruleSnapshot: line.ruleSnapshot ? JSON.parse(JSON.stringify(line.ruleSnapshot)) : null,
      manualEntry: Boolean(line.manualEntry),
    });

    if (key) {
      if (!currencyMap.has(key)) {
        currencyMap.set(key, {
          code: key,
          symbol: line.symbol || line.currencySymbol || null,
          amount: 0,
          baseAmount: 0,
        });
      }
      const group = currencyMap.get(key);
      group.amount += signed;
      group.baseAmount += signedBase;
    }
  });

  const currencies = [...currencyMap.values()].map((g) => ({
    code: g.code,
    symbol: g.symbol,
    amount: Number(Number(g.amount).toFixed(4)),
    baseAmount: Number(Number(g.baseAmount).toFixed(4)),
  }));

  return {
    schema: CORRECTION_SCHEMA,
    correctionId: correction.correctionId,
    displayNumber: correction.displayNumber || null,
    originalTransactionId: correction.originalTransactionId || null,
    status: correction.status || 'draft',
    direction: correction.direction || 'credit',
    ratePolicy: correction.ratePolicy ? JSON.parse(JSON.stringify(correction.ratePolicy)) : null,
    recovery: correction.recovery ? JSON.parse(JSON.stringify(correction.recovery)) : null,
    manualEntry: Boolean(correction.manualEntry),
    ...CORRECTION_IDENTITY_FIELDS.reduce((acc, f) => {
      if (correction[f] !== undefined && correction[f] !== null) acc[f] = correction[f];
      return acc;
    }, {}),
    currencies,
    totalNet: currencies.reduce((sum, g) => sum + g.baseAmount, 0),
    components: viewLines,
  };
}

export function seal(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}