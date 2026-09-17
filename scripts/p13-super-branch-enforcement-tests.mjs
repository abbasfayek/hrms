// P13 — Super-Admin Branch Enforcement (B/C phase, net-new anchors only).
//
// Layer B (server-side): super_admin is branch-scoped. Writes without a
// declared branch are refused (branch_required); writes that reach across the
// declared branch/company are refused (scope_violation); global-admin
// collections stay exempt; a paid payroll may ONLY leave 'paid' through a
// genuine structured full-return payload (paid_batch_immutable /
// paid_batch_snapshot_immutable otherwise).
//
// Client (storage): super auto-scopes to the sole company/branch when the
// tenant has exactly one; otherwise starts at 'all' and validateBranchContext
// refuses operational actions until a concrete branch is selected. A real
// disburse → full-return round trip stamps loanId/loanDeductedAmount (exact
// partial amounts) and reverses precisely, clearing every disbursement/archive
// trace en route back to 'approved'.

if (!globalThis.window) globalThis.window = globalThis;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
  };
}

const JS = 'file:///C:/Users/Pc%20Zone/Desktop/hr/public/js/';

let passed = 0;
let failed = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
};
const json = (v) => JSON.stringify(v);

const { storage } = await import(`${JS}storage.js`);
const { defaultCompanies, defaultSettings, defaultUsers } = await import(`${JS}seedData.js`);
const { disbursePayrollAtomic, reversePayrollDisbursementAtomic } = await import(`${JS}engines/payrollDisbursement.js`);
const { scopeValidateWrite } = await import('../server-authz.mjs');

const clone = (v) => JSON.parse(json(v));

storage.seedIfMissing();
storage.saveSettings({ ...defaultSettings, currency: 'USD', currencySymbol: '$', dailyRateMethod: 'fixed30' });

const SUP = { id: 'usr-admin', username: 'usr-admin', name: 'Super', role: 'super_admin', assignedCompanyId: 'all', assignedBranchId: 'all', permissions: null };

const mkEmp = (id, branchId = 'br-1', extra = {}) => ({
  id, fullName: `Emp ${id}`, fullNameEn: `Emp ${id} En`,
  companyId: 'comp-1', branchId, department: 'IT', jobTitle: 'Engineer',
  basicSalary: 6000, status: 'active', contractType: 'full_time', ...extra,
});

// ---------------------------------------------------------------------------
console.log('\n[1] setActiveUser auto-scoping for super_admin');
storage.saveCompanies(clone(defaultCompanies)); // comp-1 => br-1 + br-2 (two branches)
storage.saveUsers(clone(defaultUsers));

// Multi-branch tenant: super must start at 'all'/'all'.
storage.setActiveUser('usr-admin');
ok('A1. super on a multi-branch tenant starts at company=all', storage.getSelectedCompanyId() === 'all', `sel=${storage.getSelectedCompanyId()}`);
ok('A2. super on a multi-branch tenant starts at branch=all', storage.getSelectedBranchId() === 'all', `sel=${storage.getSelectedBranchId()}`);

// Single-company single-branch tenant: super auto-scopes to it.
storage.saveCompanies([{ id: 'comp-x', companyId: 'comp-x', nameAr: 'X', nameEn: 'X', branches: [{ id: 'br-x', companyId: 'comp-x', nameAr: 'X', nameEn: 'X', payDay: 25 }] }]);
storage.setActiveUser('usr-admin');
ok('A3. super auto-scopes to sole company on a single-tenant install', storage.getSelectedCompanyId() === 'comp-x', `sel=${storage.getSelectedCompanyId()}`);
ok('A4. super auto-scopes to sole branch on a single-tenant install', storage.getSelectedBranchId() === 'br-x', `sel=${storage.getSelectedBranchId()}`);
storage.saveCompanies(clone(defaultCompanies));
storage.setActiveUser('usr-admin');

// ---------------------------------------------------------------------------
console.log('\n[2] validateBranchContext / branchWriteGuard for super_admin');
storage.setSelectedCompanyId('all');
storage.setSelectedBranchId('all');
const vAll = storage.validateBranchContext();
ok('B1. super at all/all: validateBranchContext refused (branch_required)', vAll && vAll.ok === false && vAll.message === 'branch_required', json(vAll));

let threwMsg = '';
try { storage.getValidatedBranchId(); } catch (e) { threwMsg = String(e.message || e); }
ok('B2. getValidatedBranchId throws the canonical branch-selection message', threwMsg.length > 5 && (threwMsg.includes('يرجى اختيار الفرع أولاً للمتابعة.') || threwMsg.toLowerCase().includes('select a branch first')), threwMsg);

const rEmpDenied = storage.addEmployee(mkEmp('emp-s1'));
ok('B3. super addEmployee without a branch refused (branch_required)', rEmpDenied && rEmpDenied.ok === false && rEmpDenied.error === 'branch_required', json(rEmpDenied));
ok('B3b. denied result carries a user-facing message', rEmpDenied && typeof rEmpDenied.message === 'string' && rEmpDenied.message.length > 5, '');

storage.setSelectedCompanyId('comp-1');
storage.setSelectedBranchId('br-1');
const vBr1 = storage.validateBranchContext();
ok('B4. super at comp-1/br-1: validateBranchContext ok + branchId', vBr1 && vBr1.ok === true && vBr1.branchId === 'br-1' && vBr1.companyId === 'comp-1', json(vBr1));
const rEmpOk = storage.addEmployee(mkEmp('emp-s2'));
ok('B5. super addEmployee with a branch selected is NOT refused', !rEmpOk || rEmpOk.ok !== false, json(rEmpOk));
ok('B5b. the employee was actually persisted', !!storage.getState().employees.find((e) => e.id === 'emp-s2'));

// ---------------------------------------------------------------------------
console.log('\n[3] disburse → full-return round trip (precise stamping + reversal)');
storage.saveCompanies(clone(defaultCompanies));
storage.setActiveUser('usr-admin');
storage.setSelectedCompanyId('comp-1');
storage.setSelectedBranchId('br-1');
storage.saveEmployees([mkEmp('emp-1', 'br-1'), mkEmp('emp-2', 'br-1')]);

const T0 = '2026-09-10T10:00:00Z';
const loans = [
  {
    id: 'LOAN-A', employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1',
    totalAmount: 2000, paidAmount: 1750, remainingAmount: 250, status: 'active',
    installments: [
      { month: '2026-08', amount: 500, isPaid: true, paidAt: T0 },
      { month: '2026-09', amount: 500, isPaid: false },
      { month: '2026-10', amount: 500, isPaid: false },
    ],
  },
  {
    id: 'LOAN-B', employeeId: 'emp-2', companyId: 'comp-1', branchId: 'br-1',
    totalAmount: 1000, paidAmount: 0, remainingAmount: 1000, status: 'active',
    installments: [
      { month: '2026-09', amount: 500, isPaid: false },
      { month: '2026-10', amount: 500, isPaid: false },
    ],
  },
  {
    id: 'LOAN-C', employeeId: 'emp-2', companyId: 'comp-1', branchId: 'br-1',
    totalAmount: 600, paidAmount: 0, remainingAmount: 600, status: 'active',
    installments: [{ month: '2026-10', amount: 600, isPaid: false }],
  },
];
storage.saveLoans(clone(loans));

const approvedBatch = {
  id: 'p-fr-1', status: 'approved', month: '2026-09', revision: 3,
  companyId: 'comp-1', branchId: 'br-1',
  totalSalary: 9000, totalDeductions: 1000, totalNetPay: 8000,
  items: [
    { employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 4500, totalDeductions: 500, totalEarnings: 0, netSalary: 4000, loanInstallment: 500 },
    { employeeId: 'emp-2', companyId: 'comp-1', branchId: 'br-1', basicSalary: 4500, totalDeductions: 500, totalEarnings: 0, netSalary: 4000, loanInstallment: 500 },
  ],
  auditHistory: [], versions: [],
};
storage.set('hrms_payrolls_v3', [clone(approvedBatch)]);

const disRes = disbursePayrollAtomic({ user: SUP, batch: clone(approvedBatch), storage, by: 'Super' });
ok('D1. disbursePayrollAtomic succeeds as super', disRes && disRes.ok === true, json(disRes && disRes.error));
const paidItems = (disRes && disRes.batch && disRes.batch.items) || [];
const stamped1 = paidItems.find((it) => it.employeeId === 'emp-1');
const stamped2 = paidItems.find((it) => it.employeeId === 'emp-2');
ok('D2. items stamped with loanId (partial loan)', stamped1 && stamped1.loanId === 'LOAN-A' && stamped2 && stamped2.loanId === 'LOAN-B', json({ stamped1, stamped2 }));
ok('D3. partial installment stamped with the EXACT deducted amount (250 not 500)', stamped1 && stamped1.loanDeductedAmount === 250, json(stamped1 && stamped1.loanDeductedAmount));
ok('D4. full installment stamped with the exact deducted amount (500)', stamped2 && stamped2.loanDeductedAmount === 500, json(stamped2 && stamped2.loanDeductedAmount));

const loanAfterPay = storage.getState().loans;
const loanA = loanAfterPay.find((l) => l.id === 'LOAN-A');
const loanB = loanAfterPay.find((l) => l.id === 'LOAN-B');
ok('D5. partial loan A totaled to its ceiling then settled', loanA.paidAmount === 2000 && loanA.remainingAmount === 0 && loanA.status === 'settled', json(loanA));
ok('D6. loan B reduced by the full deduction', loanB.paidAmount === 500 && loanB.remainingAmount === 500, json(loanB));

// Now the structured full return (real engine path, super holds cancelPayment).
const paidBatch = storage.getState().payrolls.find((p) => p.id === 'p-fr-1');
const frRes = reversePayrollDisbursementAtomic({ user: SUP, batch: clone(paidBatch), reason: 'Customer requested reversal', storage, by: 'Super' });
ok('D7. reversePayrollDisbursementAtomic succeeds as super', frRes && frRes.ok === true, json(frRes && frRes.error));
const frBatch = (frRes && frRes.batch) || {};
ok('D8. status is back to approved (not paid)', frBatch.status === 'approved', frBatch.status);
ok('D9. fullReturn marker completed with previousStatus=paid', frBatch.fullReturn && frBatch.fullReturn.completed === true && frBatch.fullReturn.previousStatus === 'paid', json(frBatch.fullReturn));
ok('D10. fullReturn carries the reason byte-for-byte', frBatch.fullReturn && String(frBatch.fullReturn.reason).includes('Customer requested reversal'), json(frBatch.fullReturn && frBatch.fullReturn.reason));
ok('D11. auditHistory gains a full_return paid→approved entry', Array.isArray(frBatch.auditHistory) && frBatch.auditHistory.some((a) => a && a.action === 'full_return' && a.from === 'paid' && a.to === 'approved'), json(frBatch.auditHistory && frBatch.auditHistory[frBatch.auditHistory.length - 1]));
ok('D12. disbursement stamps cleared (releasedAt/releasedBy/paidAt/paidBy gone)', !frBatch.releasedAt && !frBatch.releasedBy && !frBatch.paidAt && !frBatch.paidBy && !frBatch.releaseStamp, json({ releasedAt: frBatch.releasedAt, paidAt: frBatch.paidAt }));
ok('D13. archive traces cleared (archivedAt gone)', !frBatch.archivedAt && !frBatch.archiveStamp, json({ archivedAt: frBatch.archivedAt }));
ok('D14. every item un-paid again', (frBatch.items || []).length === 2 && frBatch.items.every((it) => it.isPaid !== true), json(frBatch.items));

const loanAfterFr = storage.getState().loans;
const loanAFr = loanAfterFr.find((l) => l.id === 'LOAN-A');
const loanBFr = loanAfterFr.find((l) => l.id === 'LOAN-B');
const loanCFr = loanAfterFr.find((l) => l.id === 'LOAN-C');
ok('D15. loan A restored exactly (paid 1750 / remaining 250, active again)', loanAFr.paidAmount === 1750 && loanAFr.remainingAmount === 250 && loanAFr.status === 'active', json(loanAFr));
ok('D16. loan A 2026-09 schedule un-paid again', loanAFr.installments.find((x) => x.month === '2026-09').isPaid === false, json(loanAFr.installments));
ok('D17. loan A earlier paid installment untouched', loanAFr.installments.find((x) => x.month === '2026-08').isPaid === true, '');
ok('D18. loan B restored exactly (paid 0 / remaining 1000)', loanBFr.paidAmount === 0 && loanBFr.remainingAmount === 1000, json(loanBFr));
ok('D19. unrelated month loan C untouched', loanCFr.paidAmount === 0 && loanCFr.remainingAmount === 600 && loanCFr.installments.every((x) => !x.isPaid), json(loanCFr));

// ---------------------------------------------------------------------------
console.log('\n[4] server-side scopeValidateWrite for super_admin (unit)');
const stubPayrolls = [
  {
    id: 'p-paid-1', status: 'paid', month: '2026-09', revision: 2,
    companyId: 'comp-1', branchId: 'br-1', updatedAt: '2026-09-15T00:00:00Z',
    ratesSnapshot: { base: 1 },
    items: [
      { employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 4500, totalDeductions: 500, totalEarnings: 0, netSalary: 4000 },
    ],
  },
];
const superCtx = (declaredBranchId, declaredCompanyId = 'comp-1') => ({
  user: SUP, declaredBranchId, declaredCompanyId, scope: { compScoped: false, branchScoped: false },
});

const e1 = scopeValidateWrite('employees', [{ id: 'e-x', branchId: 'br-1', companyId: 'comp-1' }], superCtx(null), () => []);
ok('E1. super write without a declared branch → branch_required', e1 && e1.ok === false && e1.reason === 'branch_required' && e1.status === 403, json(e1));

const e2 = scopeValidateWrite('employees', [{ id: 'e-x', branchId: 'br-2', companyId: 'comp-1' }], superCtx('br-1'), () => []);
ok('E2. super write crossing the declared branch → scope_violation', e2 && e2.reason === 'scope_violation' && e2.status === 403, json(e2));

const e3 = scopeValidateWrite('payrolls', [{ id: 'p-x', branchId: 'br-1', companyId: 'comp-2', items: [] }], superCtx('br-1', 'comp-1'), () => []);
ok('E3. super write crossing the declared company → scope_violation', e3 && e3.reason === 'scope_violation' && e3.status === 403, json(e3));

const e4 = scopeValidateWrite('users', [{ id: 'u-1', username: 'x', role: 'branch_hr' }], superCtx(null), () => []);
ok('E4. global admin collections stay exempt (users/no branch ok)', e4 && e4.ok === true, json(e4));
const e4b = scopeValidateWrite('settings', [{ key: 'currency', value: 'USD' }], superCtx(null), () => []);
ok('E4b. settings write exempt', e4b && e4b.ok === true, json(e4b));

// paid → approved WITHOUT a full-return marker stays sealed.
const noMarker = scopeValidateWrite('payrolls', [{
  id: 'p-paid-1', status: 'approved', branchId: 'br-1', companyId: 'comp-1',
  updatedAt: '2026-09-16T00:00:00Z', items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 4500, totalDeductions: 500, totalEarnings: 0, netSalary: 4000 }],
}], superCtx('br-1'), () => [], stubPayrolls);
ok('E5. super paid→approved without full-return marker → paid_batch_immutable', noMarker && noMarker.reason === 'paid_batch_immutable' && noMarker.status === 403, json(noMarker));

// The genuine structured full-return payload IS the sanctioned exit.
const withMarker = {
  id: 'p-paid-1', status: 'approved', branchId: 'br-1', companyId: 'comp-1',
  fullReturn: { completed: true, previousStatus: 'paid', reason: 'Customer requested reversal', at: '2026-09-16T00:00:00Z' },
  auditHistory: [{ action: 'full_return', from: 'paid', to: 'approved', at: '2026-09-16T00:00:00Z' }],
  updatedAt: '2026-09-16T00:00:00Z', ratesSnapshot: { base: 1 },
  items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', basicSalary: 4500, totalDeductions: 500, totalEarnings: 0, netSalary: 4000 }],
};
const okFr = scopeValidateWrite('payrolls', [withMarker], superCtx('br-1'), () => [], stubPayrolls);
ok('E6. super structured full-return payload is accepted', okFr && okFr.ok === true, json(okFr));

// Financial tampering inside a full return is still refused.
const tampered = JSON.parse(JSON.stringify(withMarker));
tampered.items[0].netSalary = 9999;
const tamperFr = scopeValidateWrite('payrolls', [tampered], superCtx('br-1'), () => [], stubPayrolls);
ok('E7. financial tampering inside a full return → paid_batch_snapshot_immutable', tamperFr && tamperFr.reason === 'paid_batch_snapshot_immutable' && tamperFr.status === 403, json(tamperFr));

console.log('\n==========================================================');
console.log(`P13 SUPER BRANCH ENFORCEMENT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log('  ❌ ' + f));
  process.exit(1);
} else {
  console.log('🎉 Super-admin branch enforcement verified.');
}