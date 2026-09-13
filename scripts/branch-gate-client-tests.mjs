// =========================================================
// Branch-Gate client battery — storage.branchWriteGuard()
// Verifies the "لا يستطيع فعل أي شيء حتى يتم تحديد الفرع" rule
// on the CLIENT side for interactive CRUD, matching the server's
// X-Branch-Id policy: a multi-branch company user must declare a
// concrete branch; single-branch users are auto-scoped.
// Usage: node scripts/branch-gate-client-tests.mjs
// =========================================================

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
if (!globalThis.window) globalThis.window = globalThis;

const JS = 'file:///C:/Users/Pc%20Zone/Desktop/hr/public/js/';

let passed = 0;
let failed = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
};

const { storage } = await import(`${JS}storage.js`);
const { defaultCompanies, defaultSettings } = await import(`${JS}seedData.js`);
const { defaultUsers } = await import(`${JS}seedData.js`);

store.clear();
storage.seedIfMissing();
storage.saveCompanies(defaultCompanies);
storage.saveSettings({ ...defaultSettings, currency: 'USD', currencySymbol: '$', dailyRateMethod: 'fixed30' });

const mkEmp = (id, extra = {}) => ({
  id,
  fullName: `Emp ${id}`,
  fullNameEn: `Emp ${id} En`,
  companyId: 'comp-1',
  branchId: 'br-1',
  department: 'IT',
  jobTitle: 'Engineer',
  basicSalary: 6000,
  status: 'active',
  contractType: 'full_time',
  ...extra,
});

// Fixture users
const MULTI = { id: 'u-multi', username: 'u-multi', name: 'Multi Branch HR', role: 'company_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'all', permissions: null };
const SINGLE = { id: 'u-single', username: 'u-single', name: 'Single Branch HR', role: 'company_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'br-1', permissions: null };
const BRHR = { id: 'u-brhr', username: 'u-brhr', name: 'Branch HR', role: 'branch_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'br-1', permissions: null };
storage.saveUsers([...defaultUsers, MULTI, SINGLE, BRHR]);

// Let the storage singleton's background init()/syncFromServer() settle against
// the (unreachable) local server BEFORE any fetch stub is installed, so the
// stubs never capture seed-phase requests.
await new Promise((r) => setTimeout(r, 150));

// ---------------------------------------------------------------------------
console.log('\n[1] Multi-branch company_hr ("all") MUST select a branch');
storage.setActiveUser(MULTI.id);
storage.setSelectedBranchId('all');

const rAddEmp = storage.addEmployee(mkEmp('emp-g-1'));
ok('G-01 addEmployee blocked without branch selection', rAddEmp && rAddEmp.ok === false && rAddEmp.error === 'branch_required', JSON.stringify(rAddEmp));
ok('G-01b blocked result carries a user-facing message', rAddEmp && typeof rAddEmp.message === 'string' && rAddEmp.message.length > 5, '');

const rAddLeave = storage.addLeave({ id: 'lv-g-1', employeeId: 'emp-x', companyId: 'comp-1', branchId: 'br-1', startDate: '2026-09-01', endDate: '2026-09-02' });
ok('G-02 addLeave blocked without branch selection', rAddLeave && rAddLeave.ok === false && rAddLeave.error === 'branch_required', JSON.stringify(rAddLeave));

const rDelEmp = storage.deleteEmployee('emp-g-1');
ok('G-03 deleteEmployee blocked without branch selection', rDelEmp && rDelEmp.ok === false && rDelEmp.error === 'branch_required', JSON.stringify(rDelEmp));

const rAddOvertime = storage.addOvertime({ id: 'ot-g-1', employeeId: 'emp-x', companyId: 'comp-1', branchId: 'br-1' });
ok('G-04 addOvertime blocked without branch selection', rAddOvertime && rAddOvertime.ok === false, JSON.stringify(rAddOvertime));

const rAddLoan = storage.addLoan({ id: 'ln-g-1', employeeId: 'emp-x', companyId: 'comp-1', branchId: 'br-1', amount: 1000, installments: 3 });
ok('G-05 addLoan blocked without branch selection', rAddLoan && rAddLoan.ok === false, JSON.stringify(rAddLoan));

const rAddHoliday = storage.addHoliday({ id: 'hol-g-1', name: 'Test Holiday' });
ok('G-06 addHoliday blocked without branch selection', rAddHoliday && rAddHoliday.ok === false, JSON.stringify(rAddHoliday));

const rAddAttendance = storage.addAttendance({ id: 'att-g-1', employeeId: 'emp-x', date: '2026-09-01', status: 'present' });
ok('G-07 addAttendance blocked without branch selection', rAddAttendance && rAddAttendance.ok === false, JSON.stringify(rAddAttendance));

// Records must NOT have been written
ok('G-08 no records written while blocked', storage.getState().employees.length === 0 && storage.getState().leaves.length === 0 && storage.getState().loans.length === 0, '');

// ---------------------------------------------------------------------------
console.log('\n[2] Selecting a concrete branch unlocks the CRUD write');
storage.setSelectedBranchId('br-1');
const rAddEmpOk = storage.addEmployee(mkEmp('emp-g-2'));
ok('G-10 addEmployee allowed after selecting br-1', rAddEmpOk === undefined, 'expected success (void return)');
ok('G-10b employee persisted after branch selection', storage.getState().employees.some((e) => e.id === 'emp-g-2'), '');
const rAddLeaveOk = storage.addLeave({ id: 'lv-g-2', employeeId: 'emp-g-2', companyId: 'comp-1', branchId: 'br-1', daysCount: 2, daysRemaining: 10, leaveType: 'annual', startDate: '2026-09-01', endDate: '2026-09-02' });
ok('G-11 addLeave allowed after branch selection', rAddLeaveOk && rAddLeaveOk.ok === true, JSON.stringify(rAddLeaveOk));

// ---------------------------------------------------------------------------
console.log('\n[3] Single-branch company users are auto-scoped (server policy agrees)');
storage.setActiveUser(SINGLE.id);
storage.setSelectedBranchId('all');
const rSingle = storage.addEmployee(mkEmp('emp-g-3'));
ok('G-12 single-branch company_hr allowed without explicit selection', rSingle === undefined, JSON.stringify(rSingle));

// ---------------------------------------------------------------------------
console.log('\n[4] branch_hr is always auto-scoped to the assigned branch');
storage.setActiveUser(BRHR.id);
storage.setSelectedBranchId('all');
const rBr = storage.addEmployee(mkEmp('emp-g-4'));
ok('G-13 branch_hr allowed without selection (assigned branch)', rBr === undefined, JSON.stringify(rBr));

// ---------------------------------------------------------------------------
console.log('\n[5] persistToServer carries the selected branch header');
let capturedHeaders = null;
const savedFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => { capturedHeaders = opts.headers || {}; return { ok: true, status: 200, json: async () => ({ success: true }) }; };
try {
  storage.setActiveUser(MULTI.id);
  storage.setSelectedBranchId('br-1');
  storage.saveLeaves([{ id: 'lv-g-4', employeeId: 'emp-g-2', companyId: 'comp-1', branchId: 'br-1' }]);
  await storage._postChain;
  ok('G-14 persistToServer sends X-Branch-Id = selected branch', capturedHeaders && capturedHeaders['X-Branch-Id'] === 'br-1', JSON.stringify(capturedHeaders));
} finally {
  globalThis.fetch = savedFetch;
}

// ---------------------------------------------------------------------------
console.log('\n[6] clearAllData still wipes locally and degrades gracefully offline');
globalThis.fetch = async () => { throw new Error('offline'); };
try {
  storage.setActiveUser(MULTI.id);
  const before = storage.getState().employees.length;
  const clearResult = await storage.clearAllData();
  ok('G-15 local wipe still happens (offline-safe, non-blocking)', before > 0 && storage.getState().employees.length === 0, `before=${before} after=${storage.getState().employees.length}`);
  ok('G-16 server-clear attempt reports offline failure, never crashes', clearResult && clearResult.ok === false && clearResult.offline === true, JSON.stringify(clearResult));
} finally {
  globalThis.fetch = savedFetch;
}

console.log('\n==========================================================');
console.log(`BRANCH-GATE CLIENT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log('  ❌ ' + f));
  process.exit(1);
} else {
  console.log('🎉 Client-side branch gate verified.');
}