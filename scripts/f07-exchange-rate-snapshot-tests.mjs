// ============================================================
// F-07 Regression Test Suite: Historical Exchange Rate Snapshot
// Covers:
// 1. Creation and stamping of payroll items with exchange rate snapshot
// 2. Transition to Paid locks and seals item-level exchange rate snapshot
// 3. Changing live settings exchange rates does NOT alter paid batch or items
// 4. Historical reports continue to present the frozen historical snapshot
// 5. API-level immutability: attempts to tamper with snapshot on paid batch rejected
// ============================================================

// Mock browser globals for Node.js test environment
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

const {
  stampPayrollBatch,
  setExchangeRate,
} = await import('../public/js/engines/currencyGovernance.js');

const {
  transitionPayroll,
} = await import('../public/js/engines/payrollEngine.js');

const {
  scopeValidateWrite,
} = await import('../server-authz.mjs');

function ok(name, cond, msg = '') {
  if (!cond) {
    console.error(`FAIL: ${name} ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${name}`);
}

console.log('--- Running F-07 Regression Test Suite ---');

// 1. Initial settings: Base currency IQD, 1 USD = 1300 IQD
let settings = {
  currency: 'IQD',
  baseCurrency: 'IQD',
  currencySymbol: 'د.ع',
  exchangeRates: [
    { currency: 'USD', baseCurrency: 'IQD', rate: 1300, rateDate: '2026-08-01', locked: false },
  ],
};

// 2. Create mock payroll batch in USD
const batchDraft = {
  id: 'batch-2026-08-usd',
  month: '2026-08',
  companyId: 'comp-1',
  branchId: 'br-1',
  status: 'draft',
  currency: 'USD',
  totalGross: 2000,
  totalDeductions: 0,
  totalNet: 2000,
  items: [
    {
      employeeId: 'emp-usd-1',
      employeeName: 'John Doe',
      currency: 'USD',
      basicSalary: 2000,
      housingAllowance: 0,
      transportAllowance: 0,
      otherAllowances: 0,
      grossSalary: 2000,
      totalDeductions: 0,
      netSalary: 2000,
    },
  ],
};

// 2.1 Stamp batch in draft
const stampDraftRes = stampPayrollBatch(batchDraft, settings, { at: '2026-08-01T10:00:00Z' });
const stampedDraft = stampDraftRes.batch;

ok('1.1 Draft item receives exchangeRate and baseAmount',
  stampedDraft.items[0].exchangeRate === 1300 &&
  stampedDraft.items[0].baseCurrency === 'IQD' &&
  stampedDraft.items[0].baseAmount === 2600000 // 2000 USD * 1300 IQD
);

ok('1.2 Draft batch receives ratesSnapshot',
  stampedDraft.ratesSnapshot &&
  stampedDraft.ratesSnapshot.USD === 1300
);

// 3. Move batch through workflow to Paid
const auditRes = transitionPayroll(stampedDraft, 'under_audit', { by: 'HR' });
ok('2.1 Transition to under_audit succeeds', auditRes.ok);

const approvedRes = transitionPayroll(auditRes.batch, 'approved', { by: 'Auditor' });
ok('2.2 Transition to approved succeeds', approvedRes.ok);

const paidRes = transitionPayroll(approvedRes.batch, 'paid', { by: 'Finance' });
ok('2.3 Transition to paid succeeds', paidRes.ok);
const paidBatch = paidRes.batch;

// Stamp committed paid batch
const stampPaidRes = stampPayrollBatch(paidBatch, settings, { at: '2026-08-31T12:00:00Z' });
const sealedPaidBatch = stampPaidRes.batch;

ok('2.4 Paid batch has sealed exchangeRate and baseAmount',
  sealedPaidBatch.status === 'paid' &&
  sealedPaidBatch.items[0].exchangeRate === 1300 &&
  sealedPaidBatch.items[0].baseAmount === 2600000 &&
  sealedPaidBatch.ratesSnapshot.USD === 1300
);

// 4. Change current settings exchange rate: USD jumps to 1500 IQD!
const updatedRates = setExchangeRate(settings, {
  currency: 'USD',
  rate: 1500,
  rateDate: '2026-09-12',
  note: 'September devaluation',
  user: { name: 'Admin' },
});
const newSettings = { ...settings, exchangeRates: updatedRates.rates };

// 5. Re-run stamp on already paid batch with new settings
const reStampRes = stampPayrollBatch(sealedPaidBatch, newSettings, { at: '2026-09-12T15:00:00Z' });
const afterSettingsChangeBatch = reStampRes.batch;

ok('3.1 Re-stamping paid batch NEVER alters exchangeRate (still 1300, not 1500)',
  afterSettingsChangeBatch.items[0].exchangeRate === 1300
);

ok('3.2 Re-stamping paid batch NEVER alters baseAmount (still 2,600,000 IQD, not 3,000,000 IQD)',
  afterSettingsChangeBatch.items[0].baseAmount === 2600000
);

ok('3.3 Batch ratesSnapshot remains frozen at 1300',
  afterSettingsChangeBatch.ratesSnapshot.USD === 1300
);

// 6. Historical report export row verification
const item = afterSettingsChangeBatch.items[0];
const reportRowExport = {
  currency: item.currency,
  exchangeRate: item.exchangeRate !== undefined ? Number(item.exchangeRate).toFixed(6) : '',
  exchangeRateDate: item.exchangeRateDate || afterSettingsChangeBatch.ratesSnapshotDate || '',
  baseCurrency: item.baseCurrency,
  baseAmount: item.baseAmount !== undefined ? Number(item.baseAmount).toFixed(2) : '',
};

ok('4.1 Report export reflects frozen exchangeRate snapshot (1300.000000)',
  reportRowExport.exchangeRate === '1300.000000' &&
  reportRowExport.baseAmount === '2600000.00' &&
  reportRowExport.baseCurrency === 'IQD'
);

// 7. API-level immutability tests
const mockCtx = {
  user: { id: 'u-hr', role: 'company_hr', companyId: 'comp-1', branchId: 'br-1' },
  scope: { companyId: 'comp-1', branchId: 'br-1', compScoped: true, branchScoped: true, allowedBranchIds: new Set(['br-1']) },
};
const mockEmployees = () => [
  { id: 'emp-usd-1', companyId: 'comp-1', branchId: 'br-1' },
];
const storedDb = [afterSettingsChangeBatch];

// 7.1 Attempt to tamper with ratesSnapshot on paid batch via API
const tamperSnapshotRes = scopeValidateWrite(
  'payrolls',
  [{ ...afterSettingsChangeBatch, ratesSnapshot: { USD: 1500 } }],
  mockCtx,
  mockEmployees,
  storedDb
);
ok('5.1 API rejects tampering with ratesSnapshot on paid batch (403)',
  tamperSnapshotRes.ok === false && tamperSnapshotRes.reason === 'paid_batch_snapshot_immutable'
);

// 7.2 Attempt to tamper with item-level exchangeRate or baseAmount on paid batch via API
const tamperedItems = afterSettingsChangeBatch.items.map(it => ({
  ...it,
  exchangeRate: 1500,
  baseAmount: 3000000,
}));
const tamperItemRes = scopeValidateWrite(
  'payrolls',
  [{ ...afterSettingsChangeBatch, items: tamperedItems }],
  mockCtx,
  mockEmployees,
  storedDb
);
ok('5.2 API rejects tampering with item-level exchangeRate/baseAmount on paid batch (403)',
  tamperItemRes.ok === false && tamperItemRes.reason === 'paid_batch_snapshot_immutable'
);

// 7.3 Attempt to unwind paid status to approved via API
const unwindRes = scopeValidateWrite(
  'payrolls',
  [{ ...afterSettingsChangeBatch, status: 'approved' }],
  mockCtx,
  mockEmployees,
  storedDb
);
ok('5.3 API rejects unwinding paid batch status (403)',
  unwindRes.ok === false && unwindRes.reason === 'paid_batch_immutable'
);

// 7.4 Legitimate write of untouched paid batch
const validPaidRes = scopeValidateWrite(
  'payrolls',
  [afterSettingsChangeBatch],
  mockCtx,
  mockEmployees,
  storedDb
);
ok('5.4 API allows legitimate write of untouched paid batch',
  validPaidRes.ok === true
);

console.log('--- ALL F-07 REGRESSION TESTS PASSED (12/12) ---');
