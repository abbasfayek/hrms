// =========================================================
// P5 Fix #2 (X-2) — Excel Import ID-Preservation & Scope-Safe Import Tests
// =========================================================
// Core invariants:
//   * A merged/updated EXISTING employee keeps its stored `id` byte-for-byte
//     (client AND server). Incoming `id` payload values are NEVER trusted.
//   * Child records (payroll, attendance, loans, eosb, corrections) keep
//     resolving against the unchanged employee id — no re-pointing needed.
//   * Brand-new employees get a fresh, unique id (emp-imp-...); a duplicate or
//     malformed id supplied for a new employee is replaced server-side.
//   * Matching is by composite key `${companyId}::${employeeNumber}`: duplicate
//     rows for the same key collapse into ONE result (last wins) and two
//     tenants may reuse an employee number without cross-company collision.
//   * Import is server-first: local persistence happens ONLY after the server
//     accepts the import; a 403 or failed POST leaves the local employee
//     collection untouched.
//   * The caller's write scope is enforced client-side AND server-side.
//
// Client scenarios A–K run against the real storage + the exported pure
// pipeline (normalizeImportedRows / planImport / buildWriteScopeForUser /
// runImport). Server scenarios L–N run against the REAL server.js on a
// throwaway TEMP copy with a fresh fixture, then assert what landed on disk.
//
// Usage: node scripts/p5-fix2-excel-id-preservation-tests.mjs
// =========================================================

// ---- Browser shims (shared pattern with p5-fix1) ----
// These MUST be installed before any DOM-touching module is imported. Toast.js
// instantiates its manager at module scope, so static `import` would hoist and
// run before this body — hence the dynamic imports below.
function makeEl() {
  const el = {
    className: '', innerHTML: '', style: {}, children: [],
    appendChild(c) { el.children.push(c); return c; },
    removeChild(c) { return c; },
    remove() {},
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
  return el;
}
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
if (!globalThis.CustomEvent) globalThis.CustomEvent = class CustomEvent { constructor(t, o = {}) { this.type = t; this.detail = o ? o.detail : null; } };
if (!globalThis.window) globalThis.window = globalThis;
globalThis.document = {
  createElement: () => makeEl(),
  createElementNS: () => makeEl(),
  body: makeEl(),
  head: makeEl(),
  documentElement: makeEl(),
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
  getElementById: () => null,
};

// ---- Test scope imports (dynamic so the shims above run first) ----
const { storage } = await import('../public/js/storage.js');
const {
  normalizeImportedRows,
  planImport,
  buildWriteScopeForUser,
  runImport,
  IMPORT_FIELD_WHITELIST,
} = await import('../public/js/components/ExcelImportModal.js');

let passed = 0;
let failed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
}

const deepClone = (v) => JSON.parse(JSON.stringify(v));
const json = (v) => JSON.stringify(v);

// =====================================================================
// FIXTURE (client-side storage)
// =====================================================================
const COMPANIES = [
  {
    id: 'comp-1', code: 'C1', nameAr: 'شركة أ', nameEn: 'Co A',
    branches: [
      { id: 'br-1', companyId: 'comp-1', nameAr: 'فرع 1', nameEn: 'Branch 1' },
      { id: 'br-1b', companyId: 'comp-1', nameAr: 'فرع 1ب', nameEn: 'Branch 1B' },
    ],
    hourlyLeaveQuota: 5,
  },
  {
    id: 'comp-2', code: 'C2', nameAr: 'شركة ب', nameEn: 'Co B',
    branches: [
      { id: 'br-2a', companyId: 'comp-2', nameAr: 'فرع 2أ', nameEn: 'Branch 2A' },
      { id: 'br-2b', companyId: 'comp-2', nameAr: 'فرع 2ب', nameEn: 'Branch 2B' },
    ],
  },
];

const EMPLOYEES = [
  { id: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', employeeNumber: 'EMP-C1-1', fullName: 'Emp 1 Main', basicSalary: 6000, status: 'active', bankName: 'National Bank', annualLeaveBalance: 21, annualLeaveEntitlement: 21, carriedOverLeaveBalance: 2, hourlyLeaveQuota: 5 },
  { id: 'emp-c1-2', companyId: 'comp-1', branchId: 'br-1b', employeeNumber: 'EMP-C1-2', fullName: 'Emp 1 BranchB', basicSalary: 5500, status: 'active' },
  { id: 'emp-c2-1', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'EMP-C2-1', fullName: 'Emp 2A', basicSalary: 7000, status: 'active' },
];

const USERS = [
  { id: 'u-admin', role: 'super_admin', name: 'Admin' },
  { id: 'u-br', role: 'branch_hr', name: 'BranchHR', assignedCompanyId: 'comp-1', assignedBranchId: 'br-1' },
  { id: 'u-co', role: 'company_hr', name: 'CompanyHR', assignedCompanyId: 'comp-1', assignedBranches: ['br-1', 'br-2'] },
  { id: 'u-c1-single', role: 'company_hr', name: 'SingleC1', assignedCompanyId: 'comp-1', assignedBranches: ['br-1'] },
];

const SETTINGS = { defaultAnnualLeaveDays: 21, defaultHourlyLeaveQuota: 4, currency: 'SAR', currencySymbol: 'ر.س' };

const CHILDREN = {
  payrolls: [{ id: 'pb-1', status: 'submitted', companyId: 'comp-1', branchId: 'br-1', period: '2026-08', items: [{ employeeId: 'emp-c1-1', netSalary: 6000 }] }],
  attendance: [{ id: 'at-1', employeeId: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', date: '2026-09-01', status: 'present' }],
  loans: [{ id: 'ln-1', employeeId: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', amount: 3000 }],
  eosb: [{ id: 'eosb-1', employeeId: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', totalReward: 12000 }],
  corrections: [{ id: 'corr-1', employeeId: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', netAdjustment: 100 }],
};

function seed(actorId = 'u-admin') {
  store.clear();
  storage.set('hrms_companies_v3', deepClone(COMPANIES));
  storage.set('hrms_users_v3', deepClone(USERS));
  storage.set('hrms_employees_v3', deepClone(EMPLOYEES));
  storage.set('hrms_settings_v3', deepClone(SETTINGS));
  storage.set('hrms_payrolls_v3', deepClone(CHILDREN.payrolls));
  storage.set('hrms_attendance_v3', deepClone(CHILDREN.attendance));
  storage.set('hrms_loans_v3', deepClone(CHILDREN.loans));
  storage.set('hrms_eosb_v3', deepClone(CHILDREN.eosb));
  storage.set('hrms_corrections_v3', deepClone(CHILDREN.corrections));
  storage.setActiveUser(actorId);
}

function okFetch(capture) {
  return async (url, opts) => {
    capture.push({ url, opts });
    return { status: 200, ok: true, json: async () => ({ success: true }) };
  };
}

function failFetch(status, code = 'Forbidden') {
  return async () => ({ status, ok: false, json: async () => ({ error: code, code }) });
}

const AR = {
  comp: (id) => ({ 'كود الشركة': id }),
  branch: (name) => ({ 'اسم الفرع': name }),
  num: (n) => ({ 'الرقم الوظيفي': n }),
  name: (v) => ({ 'الاسم الكامل': v }),
  salary: (v) => ({ 'الراتب الأساسي': String(v) }),
};

function rowFor(compId, branchName, empNum, rest = {}) {
  return { ...AR.comp(compId), ...AR.branch(branchName), ...AR.num(empNum), ...rest };
}

const employeesStore = () => storage.get('hrms_employees_v3', []);

// =====================================================================
// CLIENT SCENARIOS
// =====================================================================
console.log('=== Phase: X-2 client — id preservation & child-record resolution ===');

// ---- A: merge keeps the existing id + full identity; only allow-listed data moves ----
{
  seed('u-admin');
  const capture = [];
  const rows = [rowFor('comp-1', 'فرع 1', 'EMP-C1-1', { 'الاسم الكامل': '', 'الراتب الأساسي': '8888', id: 'emp-hack', 'الحالة': 'terminated', 'رصيد الإجازات السنوي': '', 'اسم البنك': '' })];
  const res = await runImport({ rows, mode: 'merge', store: storage, apiFetch: okFetch(capture) });
  ok('X2-A. Merge succeeds (super_admin)', res.ok === true && res.updated === 1 && res.created === 0, JSON.stringify(res));

  const emp = employeesStore().find((e) => e.id === 'emp-c1-1');
  ok('X2-A. Existing employee id preserved byte-for-byte', !!emp && emp.id === 'emp-c1-1');
  ok('X2-A. employeeNumber preserved', emp?.employeeNumber === 'EMP-C1-1');
  ok('X2-A. companyId/branchId preserved', emp?.companyId === 'comp-1' && emp?.branchId === 'br-1');
  ok('X2-A. basicSalary updated from file', emp?.basicSalary === 8888);
  ok('X2-A. Empty cells did NOT clobber fullName/status/bankName', emp?.fullName === 'Emp 1 Main' && emp?.status === 'active' && emp?.bankName === 'National Bank');
  ok('X2-A. Leave balance preserved (not zeroed)', emp?.annualLeaveBalance === 21 && emp?.carriedOverLeaveBalance === 2);
  ok('X2-A. Payload carries the REAL existing id, not the spoofed one', !!capture[0]?.opts?.body && JSON.parse(capture[0].opts.body).employees[0].id === 'emp-c1-1');
  ok('X2-A. No stray synthetic employee was created', employeesStore().length === 3 && !employeesStore().some((e) => e.id.startsWith('emp-imp-')));
}

// ---- B..F: child records keep referencing the preserved employee id ----
{
  seed('u-admin');
  const res = await runImport({
    rows: [rowFor('comp-1', 'فرع 1', 'EMP-C1-1', { 'الراتب الأساسي': '7777' })],
    mode: 'merge',
    store: storage,
    apiFetch: okFetch([]),
  });
  ok('X2-B. Merge succeeded (base for child checks)', res.ok === true);
  const emp = employeesStore().find((e) => e.id === 'emp-c1-1');
  const refs = {
    payroll: storage.get('hrms_payrolls_v3', [])[0]?.items[0]?.employeeId,
    attendance: storage.get('hrms_attendance_v3', [])[0]?.employeeId,
    loan: storage.get('hrms_loans_v3', [])[0]?.employeeId,
    eosb: storage.get('hrms_eosb_v3', [])[0]?.employeeId,
    correction: storage.get('hrms_corrections_v3', [])[0]?.employeeId,
  };
  ok('X2-B. Payroll item still resolves to the unchanged employee id', refs.payroll === emp?.id);
  ok('X2-C. Attendance still resolves to the unchanged employee id', refs.attendance === emp?.id);
  ok('X2-D. Loan still resolves to the unchanged employee id', refs.loan === emp?.id);
  ok('X2-E. EOSB still resolves to the unchanged employee id', refs.eosb === emp?.id);
  ok('X2-F. Payroll correction still resolves to the unchanged employee id', refs.correction === emp?.id);
}

// ---- G: brand-new employee gets a fresh unique id + curated defaults ----
{
  seed('u-admin');
  const capture = [];
  const rows = [rowFor('comp-1', 'فرع 1', 'EMP-NEW01', { ...AR.name('New Employee'), ...AR.salary('9999') })];
  const res = await runImport({ rows, mode: 'merge', store: storage, apiFetch: okFetch(capture), allocId: () => 'emp-imp-42' });
  ok('X2-G. New employee created', res.ok === true && res.created === 1);
  const stored = employeesStore();
  const emp = stored.find((e) => e.employeeNumber === 'EMP-NEW01');
  ok('X2-G. New employee id is the allocated unique id', !!emp && emp.id === 'emp-imp-42');
  ok('X2-G. New employee id does not collide with existing ids', stored.filter((e) => e.id === 'emp-imp-42').length === 1);
  ok('X2-G. New employee fields applied', emp?.fullName === 'New Employee' && emp?.basicSalary === 9999 && emp?.status === 'active');
  ok('X2-G. New employee gets curated leave defaults', emp?.annualLeaveBalance === 21 && emp?.annualLeaveEntitlement === 21 && emp?.carriedOverLeaveBalance === 0 && emp?.hourlyLeaveQuota === 5);
}

// ---- H: duplicate rows for the same composite key → ONE deterministic result (last wins) ----
{
  seed('u-admin');
  const rows = [
    rowFor('comp-1', 'فرع 1', 'EMP-DUP', { ...AR.name('Dup First'), ...AR.salary('1000') }),
    rowFor('comp-1', 'فرع 1', 'EMP-DUP', { ...AR.name('Dup Last'), ...AR.salary('2000') }),
  ];
  const res = await runImport({ rows, mode: 'merge', store: storage, apiFetch: okFetch([]) });
  ok('X2-H. Duplicate rows collapse to a single import entry', res.ok === true && res.created === 1);
  const dups = employeesStore().filter((e) => e.employeeNumber === 'EMP-DUP');
  ok('X2-H. Exactly ONE stored employee for the duplicate key', dups.length === 1, `count=${dups.length}`);
  ok('X2-H. Last row wins', dups[0]?.basicSalary === 2000 && dups[0]?.fullName === 'Dup Last');
}

// ---- I: same employeeNumber in two companies → no cross-tenant collision ----
{
  seed('u-admin');
  const rows = [
    rowFor('comp-1', 'فرع 1', 'EMP-X', { ...AR.name('X in CoA') }),
    rowFor('comp-2', 'فرع 2أ', 'EMP-X', { ...AR.name('X in CoB') }),
  ];
  const res = await runImport({ rows, mode: 'merge', store: storage, apiFetch: okFetch([]) });
  ok('X2-I. Cross-company same-number import succeeds (created=2)', res.ok === true && res.created === 2);
  const stored = employeesStore();
  const a = stored.filter((e) => e.employeeNumber === 'EMP-X' && e.companyId === 'comp-1');
  const b = stored.filter((e) => e.employeeNumber === 'EMP-X' && e.companyId === 'comp-2');
  ok('X2-I. Each tenant got exactly one employee with that number', a.length === 1 && b.length === 1);
  ok('X2-I. Distinct unique ids across tenants', a[0]?.id !== b[0]?.id && !!a[0]?.id && !!b[0]?.id);
  ok('X2-I. Neither tenant overwrote the other', a[0]?.fullName === 'X in CoA' && b[0]?.fullName === 'X in CoB');
}

// ---- J: branch-scoped user cannot touch a sibling branch (client-side reject) ----
{
  seed('u-br');
  const capture = [];
  const rows = [rowFor('comp-1', 'فرع 1ب', 'EMP-J')];
  const res = await runImport({ rows, mode: 'merge', store: storage, apiFetch: okFetch(capture) });
  ok('X2-J. Out-of-scope branch row rejected before anything is sent', !res.ok && res.step === 'scope_rows');
  ok('X2-J. No API call was made', capture.length === 0);
  ok('X2-J. Employee store untouched', employeesStore().length === 3 && !employeesStore().some((e) => e.employeeNumber === 'EMP-J'));
}

// ---- K: company-scoped user cannot import another company (client-side reject) ----
{
  seed('u-co');
  storage.setSelectedBranchId('br-1');
  const capture = [];
  const rows = [rowFor('comp-2', 'فرع 2أ', 'EMP-K')];
  const res = await runImport({ rows, mode: 'merge', store: storage, apiFetch: okFetch(capture) });
  ok('X2-K. Out-of-scope company row rejected before anything is sent', !res.ok && res.step === 'scope_rows');
  ok('X2-K. No API call was made', capture.length === 0);
  ok('X2-K. Employee store untouched', employeesStore().length === 3 && !employeesStore().some((e) => e.employeeNumber === 'EMP-K'));
}

// ---- K2: multi-branch company_hr without a concrete branch → blocked at scope level ----
{
  seed('u-co');
  storage.setSelectedBranchId('all');
  const capture = [];
  const rows = [rowFor('comp-1', 'فرع 1', 'EMP-K2')];
  const res = await runImport({ rows, mode: 'merge', store: storage, apiFetch: okFetch(capture) });
  ok('X2-K2. Multi-branch company_hr with no branch selection blocked', !res.ok && res.step === 'scope' && res.error === 'branch_required');
  ok('X2-K2. No API call was made', capture.length === 0);
}

// ---- K3: single-branch company_hr succeeds and sends its concrete X-Branch-Id ----
{
  seed('u-c1-single');
  const capture = [];
  const rows = [rowFor('comp-1', 'فرع 1', 'EMP-K3', { ...AR.name('Scoped New') })];
  const res = await runImport({ rows, mode: 'merge', store: storage, apiFetch: okFetch(capture) });
  ok('X2-K3. Single-branch company_hr import succeeds', res.ok === true && res.created === 1);
  ok('X2-K3. X-Branch-Id header equals the concrete branch', capture.length === 1 && capture[0].opts.headers['X-Branch-Id'] === 'br-1');
}

// ---- L2: server rejection leaves the LOCAL employee collection untouched ----
{
  seed('u-admin');
  const before = json(employeesStore());
  const rows = [rowFor('comp-1', 'فرع 1', 'EMP-C1-1', { ...AR.salary('9500') })];
  const res = await runImport({ rows, mode: 'merge', store: storage, apiFetch: failFetch(403, 'scope_violation') });
  ok('X2-L2. Server rejection surfaced (not swallowed)', !res.ok && res.step === 'server' && res.status === 403);
  ok('X2-L2. Local employee collection remained byte-for-byte unchanged', json(employeesStore()) === before);
  ok('X2-L2. No salary update leaked locally', employeesStore().find((e) => e.id === 'emp-c1-1')?.basicSalary === 6000);
}

// ---- K4: strict parser — unknown company/branch and missing employeeNumber are blocked ----
{
  seed('u-admin');
  const resN = normalizeImportedRows(
    [
      rowFor('comp-X', 'فرع 1', 'EMP-1'),
      rowFor('comp-1', 'فرع غير موجود', 'EMP-2'),
      { ...AR.comp('comp-1'), ...AR.branch('فرع 1') },
    ],
    { companies: COMPANIES, defaultCompanyId: 'comp-1', settings: SETTINGS },
  );
  ok('X2-K4. Unknown company is a reported error (no comp-1 fallback)', resN.errors.some((e) => e.code === 'unknown_company'));
  ok('X2-K4. Unknown branch is a reported error (no br-1 fallback)', resN.errors.some((e) => e.code === 'unknown_branch'));
  ok('X2-K4. Missing employeeNumber is a reported error (no EMP-NNNN fabrication)', resN.errors.some((e) => e.code === 'missing_employee_number'));
  ok('X2-K4. All three broken rows excluded from the result', resN.rows.length === 0);
}

// ---- K5: preserve-on-empty — a file that omits a column does not reset it ----
{
  seed('u-admin');
  const before = employeesStore().find((e) => e.id === 'emp-c2-1');
  const res = await runImport({
    rows: [{ ...AR.comp('comp-2'), ...AR.branch('فرع 2أ'), ...AR.num('EMP-C2-1') }],
    mode: 'merge',
    store: storage,
    apiFetch: okFetch([]),
  });
  ok('X2-K5. Column-omitting file still merges cleanly', res.ok === true && res.updated === 1);
  const after = employeesStore().find((e) => e.id === 'emp-c2-1');
  ok('X2-K5. Full employee retained byte-for-byte when only identity matched',
    json(after) === json(before), `${json(after)} vs ${json(before)}`);
}

// ---- L: planImport/whitelist smoke — update never writes identity/leave keys ----
{
  seed('u-admin');
  const normL = normalizeImportedRows(
    [rowFor('comp-1', 'فرع 1', 'EMP-C1-1', { 'الراتب الأساسي': '5000', 'رصيد الإجازات السنوي': '99', 'الحالة': 'terminated' })],
    { companies: COMPANIES, defaultCompanyId: 'comp-1', settings: SETTINGS },
  );
  ok('X2-L. Normalizer accepts the identity row', normL.errors.length === 0 && normL.rows.length === 1, JSON.stringify(normL));
  const planRes = planImport(
    normL.rows,
    { employees: EMPLOYEES, companies: COMPANIES, settings: SETTINGS, allocId: () => 'emp-imp-x' },
  );
  const target = planRes.plan[0]?.target;
  ok('X2-L. planImport matched the existing employee (update action)', planRes.plan.length === 1 && planRes.plan[0].action === 'update');
  ok('X2-L. Update target pinned the existing id', target?.id === 'emp-c1-1');
  ok('X2-L. Leave/status from file NOT applied to update target', target?.annualLeaveBalance === 21 && target?.status === 'active');
  ok('X2-L. Salary from file applied', target?.basicSalary === 5000);
  ok('X2-L. Whitelist excludes id/employeeNumber/companyId/branchId/leave/status',
    IMPORT_FIELD_WHITELIST.length === 23
    && !IMPORT_FIELD_WHITELIST.includes('id')
    && !IMPORT_FIELD_WHITELIST.includes('employeeNumber')
    && !IMPORT_FIELD_WHITELIST.includes('companyId')
    && !IMPORT_FIELD_WHITELIST.includes('branchId')
    && !IMPORT_FIELD_WHITELIST.includes('status')
    && !IMPORT_FIELD_WHITELIST.includes('annualLeaveBalance')
    && !IMPORT_FIELD_WHITELIST.includes('carriedOverLeaveBalance'),
    `count=${IMPORT_FIELD_WHITELIST.length}`);
}

// ---- Pure scope mirror smoke ----
{
  seed('u-admin');
  const sup = buildWriteScopeForUser({ user: { role: 'super_admin' }, employees: EMPLOYEES });
  ok('X2-SC. super_admin scope spans all companies/branches', sup.ok && sup.companyIds === 'all' && sup.branchIds === 'all' && sup.employees.length === 3);
  const br = buildWriteScopeForUser({ user: USERS[1], employees: EMPLOYEES });
  ok('X2-SC. branch_hr scope pinned to assigned branch', br.ok && br.branchIds[0] === 'br-1' && br.employees.length === 1);
  const multi = buildWriteScopeForUser({ user: USERS[2], employees: EMPLOYEES, selectedBranchId: 'all' });
  ok('X2-SC. Multi-branch company_hr without branch → branch_required', multi.ok === false && multi.error === 'branch_required');
}

// ---- UIB: REAL production boundary — acceptParsedRows() canonical output → runImport() ----
// acceptParsedRows() normalizes raw upload rows once (with the modal's default
// company) and hands the CANONICAL result to runImport(). This exercises that
// exact boundary: runImport's internal re-validation must accept canonical rows
// (companyId/branchId/employeeNumber + allow-listed fields) without destroying
// them, while still rejecting genuinely invalid identities.
{
  seed('u-admin');
  const capture = [];
  const raw = [rowFor('comp-1', 'فرع 1', 'EMP-C1-1', { 'الراتب الأساسي': '8888' })];
  const boundary = normalizeImportedRows(raw, { companies: COMPANIES, defaultCompanyId: 'comp-1', settings: SETTINGS });
  ok('X2-UIB. acceptParsedRows boundary produced canonical rows', boundary.errors.length === 0 && boundary.rows[0]?.companyId === 'comp-1' && boundary.rows[0]?.employeeNumber === 'EMP-C1-1');
  const res = await runImport({ rows: boundary.rows, mode: 'merge', store: storage, apiFetch: okFetch(capture) });
  ok('X2-UIB. Canonical rows accepted by runImport (was: parse/missing_company)', res.ok === true && res.updated === 1 && res.created === 0, JSON.stringify(res));
  ok('X2-UIB. Exactly one server POST was made', capture.length === 1, `calls=${capture.length}`);
  const sent = capture.length ? JSON.parse(capture[0].opts.body).employees[0] : {};
  ok('X2-UIB. Preserved existing id was sent to the server', sent.id === 'emp-c1-1', `id=${sent.id}`);
  ok('X2-UIB. Canonical update persisted locally with id preserved', employeesStore().find((e) => e.id === 'emp-c1-1')?.basicSalary === 8888);
}

{
  seed('u-admin');
  const capture = [];
  const raw = [rowFor('comp-1', 'فرع 1', 'EMP-UIB-NEW', { ...AR.name('Boundary New'), ...AR.salary('4321') })];
  const boundary = normalizeImportedRows(raw, { companies: COMPANIES, defaultCompanyId: 'comp-1', settings: SETTINGS });
  const res = await runImport({ rows: boundary.rows, mode: 'merge', store: storage, apiFetch: okFetch(capture), allocId: () => 'emp-imp-77' });
  ok('X2-UIB. Canonical new-employee row accepted by runImport', res.ok === true && res.created === 1, JSON.stringify(res));
  const emp = employeesStore().find((e) => e.employeeNumber === 'EMP-UIB-NEW');
  ok('X2-UIB. Canonical company/branch/number survive re-validation', emp?.companyId === 'comp-1' && emp?.branchId === 'br-1' && emp?.id === 'emp-imp-77' && emp?.basicSalary === 4321, JSON.stringify(emp));
}

{
  seed('u-admin');
  const capture = [];
  const resUnknown = await runImport({ rows: [{ employeeNumber: 'EMP-BOGUS', companyId: 'comp-NOPE', branchId: 'br-1', basicSalary: 1 }], mode: 'merge', store: storage, apiFetch: okFetch(capture) });
  ok('X2-UIB. Idempotent normalizer still rejects an unknown companyId', !resUnknown.ok && resUnknown.step === 'parse' && resUnknown.errors?.some((e) => e.code === 'unknown_company') && capture.length === 0);
  const resNoNum = await runImport({ rows: [{ companyId: 'comp-1', branchId: 'br-1', basicSalary: 1 }], mode: 'merge', store: storage, apiFetch: okFetch(capture) });
  ok('X2-UIB. Idempotent normalizer still rejects a missing employeeNumber', !resNoNum.ok && resNoNum.step === 'parse' && resNoNum.errors?.some((e) => e.code === 'missing_employee_number') && capture.length === 0);
}

await runServerPhase();

// =====================================================================
// Server scenarios L–N (real server.js on a throwaway temp copy)
// =====================================================================
async function runServerPhase() {
  console.log('\n=== Phase: X-2 server — id-pinning & append/merge scope ===');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const crypto = await import('node:crypto');
  const net = await import('node:net');
  const http = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { fileURLToPath: furl } = await import('node:url');
  const ROOT = path.resolve(path.dirname(furl(import.meta.url)), '..');

  function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    return `pbkdf2$${salt.toString('base64')}$${100000}$${hash.toString('base64')}`;
  }

  function readJSON(tmp, file) {
    const p = path.join(tmp, 'data', file);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
  const writeJSON = (tmp, file, data) => fs.writeFileSync(path.join(tmp, 'data', file), JSON.stringify(data, null, 2), 'utf-8');

  const SCOPED_PW = 'SecretPass-102';
  const SUPER_PW = 'SystemMasterSecret!';

  function makeTmpApp() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-p5x2-'));
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    for (const f of ['server.js', 'server-authz.mjs']) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
    return tmp;
  }

  function seedFixture(tmp) {
    const companies = [
      { id: 'comp-1', nameAr: 'شركة أ', branches: [{ id: 'br-1', companyId: 'comp-1', nameAr: 'فرع 1' }, { id: 'br-1b', companyId: 'comp-1', nameAr: 'فرع 1ب' }] },
      { id: 'comp-2', nameAr: 'شركة ب', branches: [{ id: 'br-2a', companyId: 'comp-2', nameAr: 'فرع 2أ' }, { id: 'br-2b', companyId: 'comp-2', nameAr: 'فرع 2ب' }] },
    ];
    writeJSON(tmp, 'companies.json', companies);
    writeJSON(tmp, 'employees.json', [
      { id: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', employeeNumber: 'EMP-C1-1', fullName: 'Emp 1 Main', basicSalary: 6000, status: 'active', bankName: 'Legacy Bank' },
      { id: 'emp-c2-1', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'EMP-C2-1', fullName: 'Emp 2A', basicSalary: 7000, status: 'active', bankName: 'Legacy Bank 2' },
    ]);
    writeJSON(tmp, 'users.json', [
      { id: 'usr-system', username: 'system', name: 'مدير النظام', role: 'super_admin', assignedCompanyId: 'all', assignedBranchId: 'all', email: 'system@test.local', password: hashPassword(SUPER_PW) },
      { id: 'u-c2-hr', username: 'c2-hr', name: 'HR Comp2', role: 'company_hr', assignedCompanyId: 'comp-2', assignedBranches: ['br-2a', 'br-2b'], email: 'c2hr@test.local', password: hashPassword(SCOPED_PW) },
      { id: 'u-c1b-hr', username: 'c1b-hr', name: 'HR C1 BranchB', role: 'branch_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'br-1b', email: 'c1bhr@test.local', password: hashPassword(SCOPED_PW) },
    ]);
    writeJSON(tmp, 'settings.json', { systemName: 'BenoSoft Global HRMS', allowRegistration: false, version: '1.0.0' });
    writeJSON(tmp, 'access_token.json', { token: 'MasterTokenSecret123!' });
  }

  function freePort() {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
      srv.on('error', reject);
    });
  }

  function bootServer(tmp, port) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['server.js'], {
        cwd: tmp,
        env: { ...process.env, PORT: String(port), CORS_ALLOWLIST: 'http://allowed.test' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      const deadline = Date.now() + 15000;
      const probe = async () => {
        try {
          const r = await fetch(`http://localhost:${port}/api/status`);
          if (r.status === 200 || r.status === 401) return resolve(child);
        } catch (e) {}
        if (Date.now() > deadline) { try { child.kill(); } catch (e) {} return reject(new Error('server did not boot: ' + out)); }
        setTimeout(probe, 250);
      };
      probe();
    });
  }

  function stopServer(child) {
    return new Promise((resolve) => {
      child.once('exit', () => resolve());
      try { child.kill('SIGTERM'); } catch (e) {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} resolve(); }, 2000);
    });
  }

  function api(base, apiPath, { method = 'GET', session = null, headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(base + apiPath);
      const h = { ...headers };
      if (session) h['X-Session-Token'] = session;
      let payload = null;
      if (body !== null) {
        h['Content-Type'] = 'application/json';
        payload = Buffer.from(JSON.stringify(body), 'utf-8');
        h['Content-Length'] = payload.length;
      }
      const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: h }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
          resolve({ status: res.statusCode, data: parsed, rawText: data });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  async function login(base, username, password) {
    const r = await api(base, '/api/auth/login', { method: 'POST', body: { username, password } });
    return r.status === 200 && r.data && r.data.session ? r.data.session : null;
  }

  const tmp = makeTmpApp();
  seedFixture(tmp);
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  let server = null;
  try {
    server = await bootServer(tmp, port);
    const sessionSystem = await login(BASE, 'system', SUPER_PW);
    const sessionC2 = await login(BASE, 'c2-hr', SCOPED_PW);
    const sessionC1B = await login(BASE, 'c1b-hr', SCOPED_PW);
    ok('X2-BOOT. System + scoped users log in against the real server', !!sessionSystem && !!sessionC2 && !!sessionC1B);

    const H = { 'X-Branch-Id': 'br-2a' };

    // S1: merge preserves the stored id; payload id never trusted; empty/leave/status untouched.
    const s1 = await api(BASE, '/api/import-employees', {
      method: 'POST', session: sessionC2, headers: H,
      body: { mode: 'append', employees: [
        { id: 'emp-hack-9', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'EMP-C2-1', basicSalary: 9999, fullName: '', bankName: '', status: 'terminated' },
      ] },
    });
    ok('X2-S1. Scoped merge request succeeds (200)', s1.status === 200, `status=${s1.status}`);
    const d1 = (readJSON(tmp, 'employees.json') || []).find((e) => e.employeeNumber === 'EMP-C2-1');
    ok('X2-S1. Stored id preserved byte-for-byte (emp-hack-9 not applied)', d1?.id === 'emp-c2-1', `id=${d1?.id}`);
    ok('X2-S1. basicSalary applied', d1?.basicSalary === 9999);
    ok('X2-S1. fullName/bankName/status preserved (empties not applied)', d1?.fullName === 'Emp 2A' && d1?.bankName === 'Legacy Bank 2' && d1?.status === 'active');

    // S2: new employee supplied with a COLLIDING id → server generates a fresh unique one.
    const s2 = await api(BASE, '/api/import-employees', {
      method: 'POST', session: sessionC2, headers: H,
      body: { mode: 'append', employees: [
        { id: 'emp-c2-1', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'EMP-C2-NEW', fullName: 'New Collider', basicSalary: 3333, status: 'active' },
      ] },
    });
    ok('X2-S2. New employee with colliding id request succeeds (200)', s2.status === 200, `status=${s2.status}`);
    const d2 = (readJSON(tmp, 'employees.json') || []).find((e) => e.employeeNumber === 'EMP-C2-NEW');
    ok('X2-S2. Server generated a fresh unique emp-imp id (did NOT hijack emp-c2-1)', !!d2 && /^emp-/.test(d2.id) && d2.id !== 'emp-c2-1', `id=${d2?.id}`);
    ok('X2-S2. Original emp-c2-1 record untouched', (readJSON(tmp, 'employees.json') || []).find((e) => e.id === 'emp-c2-1')?.fullName === 'Emp 2A');

    // S3: new employee with a MALFORMED id → server substitutes a generated id.
    const s3 = await api(BASE, '/api/import-employees', {
      method: 'POST', session: sessionC2, headers: H,
      body: { mode: 'append', employees: [
        { id: 'x9-bad-id', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'EMP-C2-M', fullName: 'Malformed Id Emp', status: 'active' },
      ] },
    });
    ok('X2-S3. Malformed-id new employee request succeeds (200)', s3.status === 200, `status=${s3.status}`);
    ok('X2-S3. Server replaced the malformed id with a well-formed emp-imp id', /^emp-imp-/.test((readJSON(tmp, 'employees.json') || []).find((e) => e.employeeNumber === 'EMP-C2-M')?.id));

    // S6: super_admin merge preserves ids across companies too.
    const s6 = await api(BASE, '/api/import-employees', {
      method: 'POST', session: sessionSystem,
      body: { mode: 'append', employees: [
        { id: 'emp-hacked', companyId: 'comp-1', branchId: 'br-1', employeeNumber: 'EMP-C1-1', basicSalary: 1234, status: 'active' },
      ] },
    });
    ok('X2-S6. Super admin merge succeeds (200)', s6.status === 200, `status=${s6.status}`);
    const d6 = (readJSON(tmp, 'employees.json') || []).find((e) => e.employeeNumber === 'EMP-C1-1');
    ok('X2-S6. super_admin merge preserved the stored id', d6?.id === 'emp-c1-1', `id=${d6?.id}`);
    ok('X2-S6. basicSalary applied by super_admin merge', d6?.basicSalary === 1234);

    // L: out-of-scope import (branch_hr of comp-1/br-1b importing comp-2) → 403, zero disk change.
    const beforeOut = readJSON(tmp, 'employees.json').length;
    const lres = await api(BASE, '/api/import-employees', {
      method: 'POST', session: sessionC1B,
      body: { mode: 'append', employees: [
        { id: 'emp-c2-hack', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'EMP-C2-OUT', fullName: 'Out of scope', status: 'active' },
      ] },
    });
    ok('X2-L. Out-of-scope import by branch_hr rejected (403)', lres.status === 403, `status=${lres.status}`);
    ok('X2-L. No out-of-scope employee written to disk', (readJSON(tmp, 'employees.json') || []).length === beforeOut && !(readJSON(tmp, 'employees.json') || []).some((e) => e.employeeNumber === 'EMP-C2-OUT'));

    // N: REPLACE mode stays super-admin-only.
    const nres = await api(BASE, '/api/import-employees', {
      method: 'POST', session: sessionC2, headers: H,
      body: { mode: 'replace', employees: [{ id: 'imp-rep', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'EMP-REP', fullName: 'Rep' }] },
    });
    ok('X2-N. Replace mode denied for non-super (403)', nres.status === 403, `status=${nres.status}`);

    // M: cross-tenant merge can never overwrite the other tenant's record.
    const importedC1 = (readJSON(tmp, 'employees.json') || []).find((e) => e.id === 'emp-c1-1');
    ok('X2-M. comp-1 employee still intact after comp-2 activity', !!importedC1 && importedC1.fullName === 'Emp 1 Main' && importedC1.basicSalary === 1234);
  } finally {
    if (server) await stopServer(server);
  }
}

// =====================================================================
// Summary
// =====================================================================
console.log(`\n============================================================`);
console.log(`X-2 suite: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}