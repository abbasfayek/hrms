// =========================================================
// P10.4 Session-scope tests — financial roles are company-scoped
// Verifies, on the ACTUAL storage session keys + the topbar
// branch-selector computation, that payroll_admin,
// audit_reviewer and payments_officer operate exactly like
// company_hr: their session company is the ASSIGNED company
// (never 'all'), initial branch context is 'all' (spanning the
// company's branches), and after selecting a concrete branch
// validateBranchContext() accepts it.
// Exercises the REAL login path (storage.setActiveUser) via jsdom.
// Usage: node scripts/p10-4-financial-session-scope-tests.mjs
// =========================================================

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLSelectElement',
  'HTMLInputElement', 'HTMLFormElement', 'HTMLTextAreaElement', 'Element', 'Node',
  'CustomEvent', 'Event', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame'];
for (const g of globals) if (globalThis[g] === undefined) globalThis[g] = window[g];
globalThis.FormData = window.FormData;
globalThis.localStorage = window.localStorage;

globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), clone: () => ({ json: async () => ({}) }) });

const JS = 'file:///C:/Users/Pc%20Zone/Desktop/hr/public/js/';
const { storage } = await import(`${JS}storage.js`);
const { defaultCompanies, defaultSettings, defaultUsers, defaultEmployees } = await import(`${JS}seedData.js`);

let passed = 0;
let failed = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
};

storage.seedIfMissing();
storage.saveCompanies(defaultCompanies);
storage.saveSettings({ ...defaultSettings, currencySymbol: '$' });

const ASSIGNED_COMPANY = 'comp-1';
const BRANCH_A = 'br-1';
const BRANCH_B = 'br-2';

const mkRoleUser = (id, role) => ({
  id,
  username: id,
  password: 'pbkdf2$x$1$x',
  name: `User ${id}`,
  nameEn: `User ${id}`,
  email: `${id}@test.local`,
  role,
  assignedCompanyId: ASSIGNED_COMPANY,
  assignedBranchId: 'all',
  jobTitle: '',
  avatar: 'U',
});

const mkEmployee = (id, companyId, branchId) => ({
  id,
  employeeNumber: id,
  name: `Emp ${id}`,
  nameEn: `Emp ${id}`,
  email: `${id}@test.local`,
  companyId,
  branchId,
  position: 'Staff',
  department: 'Ops',
  status: 'active',
  assignedCompanyId: companyId,
  assignedBranchId: branchId,
  salary: 1000,
  currency: 'USD',
  joinDate: '2024-01-01',
});

const roleUsers = [
  mkRoleUser('usr-payroll', 'payroll_admin'),
  mkRoleUser('usr-audit', 'audit_reviewer'),
  mkRoleUser('usr-paymt', 'payments_officer'),
];
const chr = { id: 'usr-chr', username: 'usr-chr', password: 'pbkdf2$x$1$x', name: 'CHR', email: 'chr@t.local', role: 'company_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'all', avatar: 'C' };
const bhr = { id: 'usr-bhr', username: 'usr-bhr', password: 'pbkdf2$x$1$x', name: 'BHR', email: 'bhr@t.local', role: 'branch_hr', assignedCompanyId: 'comp-1', assignedBranchId: BRANCH_A, avatar: 'B' };
storage.saveUsers(JSON.parse(JSON.stringify([...defaultUsers, ...roleUsers, chr, bhr])));

// Seed employees for scope-visibility control: one inside the assigned
// company, one outside.
storage.saveEmployees([mkEmployee('e1', 'comp-1', BRANCH_A), mkEmployee('e2', 'comp-2', 'all')]);

const LS_COMPANY_KEY = 'hrms_selected_comp_id_v3';
const LS_BRANCH_KEY = 'hrms_selected_branch_id_v3';

// Reproduces the app.js setupTopbarControls branch-selector computation
// (public/js/app.js:333-351) against the REAL storage session state.
function topbarBranchContext() {
  const effectiveCompId = storage.getSelectedCompanyId();
  const currentComp = defaultCompanies.find((c) => c.id === effectiveCompId);
  return { effectiveCompId, currentComp };
}

for (const usr of roleUsers) {
  const { role, id } = usr;
  console.log(`\n[Role ${role}] — session scope must follow the assigned company`);
  storage.setActiveUser(id);

  ok(`${role}: getSelectedCompanyId() === assignedCompanyId`,
    storage.getSelectedCompanyId() === ASSIGNED_COMPANY, `got ${storage.getSelectedCompanyId()}`);
  ok(`${role}: assigned company is NOT 'all'`,
    usr.assignedCompanyId !== 'all' && storage.getSelectedCompanyId() !== 'all');
  ok(`${role}: SELECTED_COMPANY_ID physically stored = assigned company`,
    JSON.parse(window.localStorage.getItem(LS_COMPANY_KEY)) === ASSIGNED_COMPANY, `got ${window.localStorage.getItem(LS_COMPANY_KEY)}`);
  ok(`${role}: initial branch context stays 'all' (by design)`,
    storage.getSelectedBranchId() === 'all', `got ${storage.getSelectedBranchId()}`);
  ok(`${role}: SELECTED_BRANCH_ID physically stored = 'all' initially`,
    JSON.parse(window.localStorage.getItem(LS_BRANCH_KEY)) === 'all', `got ${window.localStorage.getItem(LS_BRANCH_KEY)}`);

  const { currentComp } = topbarBranchContext();
  ok(`${role}: topbar resolves the assigned company (not undefined 'all' lookup)`,
    !!currentComp && currentComp.id === ASSIGNED_COMPANY);
  ok(`${role}: topbar can list the assigned company's branches`,
    Array.isArray(currentComp?.branches) && currentComp.branches.length >= 2
      && JSON.stringify(currentComp.branches.map((b) => b.id)) === JSON.stringify([BRANCH_A, BRANCH_B]),
    `got ${JSON.stringify((currentComp?.branches || []).map((b) => b.id))}`);

  storage.setSelectedBranchId(BRANCH_B);
  ok(`${role}: after selection getSelectedBranchId() === selected branch`,
    storage.getSelectedBranchId() === BRANCH_B, `got ${storage.getSelectedBranchId()}`);

  const check = storage.validateBranchContext();
  ok(`${role}: validateBranchContext() ok:true with the selected branch`,
    check.ok === true && check.branchId === BRANCH_B, `got ${JSON.stringify(check)}`);
}

console.log('\n[Control] super_admin session scope stays global');
storage.setActiveUser('usr-admin');
ok('super_admin: getSelectedCompanyId() === all', storage.getSelectedCompanyId() === 'all', `got ${storage.getSelectedCompanyId()}`);
ok('super_admin: selected branch stays all', storage.getSelectedBranchId() === 'all', `got ${storage.getSelectedBranchId()}`);

console.log('\n[Control] company_hr / branch_hr behavior unchanged');
{
  storage.setActiveUser('usr-chr');
  ok('company_hr: session company = assigned company', storage.getSelectedCompanyId() === 'comp-1');
  ok('company_hr: initial branch = all', storage.getSelectedBranchId() === 'all');
  storage.setActiveUser('usr-bhr');
  ok('branch_hr: session company = assigned company', storage.getSelectedCompanyId() === 'comp-1');
  ok('branch_hr: session branch = assigned branch (locked)', storage.getSelectedBranchId() === BRANCH_A, `got ${storage.getSelectedBranchId()}`);
}

console.log('\n[Control] data visibility for financial roles stays company-scoped (getState)');
{
  storage.setActiveUser('usr-payroll');
  const state = storage.getState();
  const empIds = state.employees.map((e) => e.id || e.employeeNumber);
  ok('payroll_admin: sees ONLY assigned-company employees', empIds.length === 1 && empIds.includes('e1'), `got ${JSON.stringify(empIds)}`);
  ok('payroll_admin: does NOT see foreign-company employees', !empIds.includes('e2'));
}

console.log(`\n=== P10.4 RESULT: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}