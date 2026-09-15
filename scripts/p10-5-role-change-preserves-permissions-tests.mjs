// =========================================================
// P10.5 Role-change permission-preservation tests — Problem #4
// Verifies, on the ACTUAL stored data (localStorage + server
// POST payload), that a ROLE CHANGE alone never implicitly
// resets/wipe user permission customizations:
//   A. legacy non-empty set  → kept verbatim, NO marker key
//   B. explicit partial set  → kept verbatim, marker stays true
//   C. explicit empty lockdown → kept exactly (NOT role defaults)
//   D. legacy empty []       → stays [], no marker
//   E. role A→B→A (net-zero) → original permissions kept
//   F. intentional Reset button → still resets to role defaults
//   G. role change + manual toggle → saved as explicit (Patch B)
//   H. _rawPermissions never reaches storage / server
//   I. saving one user never alters any other user's record
//   J. brand-new user creation still saves clean role-defaults
// Exercises the REAL modal flow (openUserModal) via jsdom.
// Usage: node scripts/p10-5-role-change-preserves-permissions-tests.mjs
// =========================================================

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html lang="ar"><head><meta charset="utf-8"></head><body></body></html>', {
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

const usersPosts = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = String((opts && opts.method) || 'GET');
  if (u.includes('/api/data/users') && method === 'POST') {
    usersPosts.push(opts.body);
    return { ok: true, status: 200, json: async () => ({ success: true }), clone: () => ({ json: async () => ({}) }) };
  }
  return { ok: false, status: 404, json: async () => ({}), clone: () => ({ json: async () => ({}) }) };
};

const JS = 'file:///C:/Users/Pc%20Zone/Desktop/hr/public/js/';
const { storage } = await import(`${JS}storage.js`);
const { defaultCompanies, defaultSettings, defaultUsers } = await import(`${JS}seedData.js`);
const { openUserModal } = await import(`${JS}components/UserModal.js`);
const { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, getEffectivePermissions } = await import(`${JS}types.js`);

let passed = 0;
let failed = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
};

const $ = (sel, root) => (root || document).querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setVal(el, value) {
  el.value = value;
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}
function toggleCb(el) {
  el.checked = !el.checked;
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}
function click(el) {
  el.dispatchEvent(new window.Event('click', { bubbles: true }));
}
const sortJoin = (arr) => [...(arr || [])].sort().join(',');

storage.seedIfMissing();
storage.saveCompanies(defaultCompanies);
storage.saveSettings({ ...defaultSettings, currencySymbol: '$' });
storage.setSelectedCompanyId('all');
storage.setSelectedBranchId('all');

await new Promise((r) => setTimeout(r, 150));
usersPosts.length = 0;

const payrollDefaults = [...(DEFAULT_ROLE_PERMISSIONS.payroll_admin || [])];

const rawUsers = () => {
  const raw = localStorage.getItem('hrms_users_v3');
  return raw ? JSON.parse(raw) : [];
};
const rawUser = (id) => rawUsers().find((u) => u && u.id === id);
const userRecord = (id) => storage.getState().users.find((u) => u.id === id);

const mkUser = (id, over) => ({
  id,
  username: id,
  password: 'pbkdf2$x$1$x',
  name: `User ${id}`,
  nameEn: `User ${id}`,
  email: `${id}@test.local`,
  role: 'company_hr',
  assignedCompanyId: 'comp-1',
  assignedBranchId: 'all',
  jobTitle: '',
  avatar: 'U',
  ...over,
});

// Fixture users — one per State of Problem #4.
const usrLegacyA  = mkUser('usr-legacy-a',  { permissions: ['employees.view', 'employees.add'] }); // State A (legacy non-empty, no marker)
const usrPartial  = mkUser('usr-partial',   { permissions: ['employees.view'], permissionsExplicit: true }); // State B
const usrLockdown = mkUser('usr-lockdown',  { permissions: [], permissionsExplicit: true }); // State C
const usrLegacyE  = mkUser('usr-legacy-e',  { permissions: [] }); // State D (legacy empty)
const usrRevert   = mkUser('usr-revert',    { permissions: ['employees.view', 'employees.add'] }); // Net-zero A→B→A
const usrReset    = mkUser('usr-reset',     { permissions: ['employees.view'], permissionsExplicit: true }); // Intentional Reset
const usrEdit     = mkUser('usr-edit',      { permissions: ['employees.view'], permissionsExplicit: true }); // role change + manual edit
const usrGuard    = mkUser('usr-guard',     { role: 'payroll_admin', permissions: [], permissionsExplicit: true }); // untouched guard

storage.saveUsers(JSON.parse(JSON.stringify([...defaultUsers,
  usrLegacyA, usrPartial, usrLockdown, usrLegacyE, usrRevert, usrReset, usrEdit, usrGuard])));
storage.setActiveUser('usr-admin');
usersPosts.length = 0;

async function openAndSave(userId, opts = {}) {
  let saved = false;
  openUserModal(userRecord(userId), () => { saved = true; });
  const ov = $('.modal-overlay');
  ok(`modal renders for ${userId}`, !!ov);
  if (opts.role) setVal($('#user-role-select', ov), opts.role);
  if (opts.togglePerm) toggleCb($(`input[name="perm"][value="${opts.togglePerm}"]`, ov));
  if (opts.clickReset) click($('#btn-reset-role-defaults', ov));
  click($('.submit-user-btn', ov));
  await sleep(250);
  await Promise.resolve(storage._postChain);
  return { saved, ov };
}

// ---------------------------------------------------------------------------
console.log('[A] Legacy non-empty — permissions:[employees.view, employees.add], no marker → role change → save');
{
  const { ov } = await openAndSave('usr-legacy-a', { role: 'payroll_admin' });
  const checkedA = Array.from(ov.querySelectorAll('input[name="perm"]:checked')).map((cb) => cb.value).map(String);
  ok('A: grid PREVIEW shows the new role defaults after role change', sortJoin(checkedA) === sortJoin(payrollDefaults), `got ${sortJoin(checkedA).slice(0, 80)}`);
  const u = rawUser('usr-legacy-a');
  ok('A: role updated to payroll_admin', u.role === 'payroll_admin');
  ok('A: permissions preserved verbatim', sortJoin(u.permissions) === sortJoin(['employees.view', 'employees.add']), `got ${sortJoin(u.permissions)}`);
  ok('A: permissionsExplicit key ABSENT (legacy preserved, no marker at all)', Object.prototype.hasOwnProperty.call(u, 'permissionsExplicit') === false, `hasKey=${Object.prototype.hasOwnProperty.call(u, 'permissionsExplicit')}`);
  ok('A: effective perms stay the stored legacy set (NOT payroll defaults)', sortJoin(getEffectivePermissions(u)) === sortJoin(['employees.view', 'employees.add']), `got ${sortJoin(getEffectivePermissions(u)).slice(0, 80)}`);
}

console.log('\n[B] Explicit partial — permissions:[employees.view] + permissionsExplicit:true → role change → save');
{
  await openAndSave('usr-partial', { role: 'payroll_admin' });
  const u = rawUser('usr-partial');
  ok('B: permissions preserved verbatim', JSON.stringify(u.permissions) === JSON.stringify(['employees.view']), `got ${JSON.stringify(u.permissions)}`);
  ok('B: permissionsExplicit preserved as true', u.permissionsExplicit === true, `got ${u.permissionsExplicit}`);
  ok('B: effective perms stay partial (explicit, NOT payroll defaults)', sortJoin(getEffectivePermissions(u)) === 'employees.view', `got ${sortJoin(getEffectivePermissions(u)).slice(0, 80)}`);
}

console.log('\n[C] Explicit empty lockdown — permissions:[] + permissionsExplicit:true → role change → save');
{
  await openAndSave('usr-lockdown', { role: 'payroll_admin' });
  const u = rawUser('usr-lockdown');
  ok('C: permissions stays [] (lockdown kept)', JSON.stringify(u.permissions) === '[]', `got ${JSON.stringify(u.permissions)}`);
  ok('C: permissionsExplicit stays true (NOT converted to role defaults)', u.permissionsExplicit === true, `got ${u.permissionsExplicit}`);
  ok('C: effective perms still grant NOTHING', getEffectivePermissions(u).length === 0, `got ${getEffectivePermissions(u).length}`);
}

console.log('\n[D] Legacy empty — permissions:[] no marker → role change → save');
{
  await openAndSave('usr-legacy-e', { role: 'payroll_admin' });
  const u = rawUser('usr-legacy-e');
  ok('D: permissions stays []', JSON.stringify(u.permissions) === '[]', `got ${JSON.stringify(u.permissions)}`);
  ok('D: permissionsExplicit key ABSENT', Object.prototype.hasOwnProperty.call(u, 'permissionsExplicit') === false, `hasKey=${Object.prototype.hasOwnProperty.call(u, 'permissionsExplicit')}`);
  ok('D: effective perms still resolve to (payroll) role defaults', sortJoin(getEffectivePermissions(u)) === sortJoin(payrollDefaults), `got ${sortJoin(getEffectivePermissions(u)).slice(0, 80)}`);
}

console.log('\n[E] Net-zero role change — company_hr → payroll_admin → company_hr → save untouched');
{
  let saves = 0;
  let ov;
  openUserModal(userRecord('usr-revert'), () => { saves++; });
  ov = $('.modal-overlay');
  setVal($('#user-role-select', ov), 'payroll_admin');
  setVal($('#user-role-select', ov), 'company_hr');
  click($('.submit-user-btn', ov));
  await sleep(250);
  await Promise.resolve(storage._postChain);
  const u = rawUser('usr-revert');
  ok('E: role is back to company_hr', u.role === 'company_hr');
  ok('E: original permissions preserved (nothing wiped)', sortJoin(u.permissions) === 'employees.add,employees.view', `got ${sortJoin(u.permissions)}`);
  ok('E: no permissionsExplicit key introduced', Object.prototype.hasOwnProperty.call(u, 'permissionsExplicit') === false, `hasKey=${Object.prototype.hasOwnProperty.call(u, 'permissionsExplicit')}`);
}

console.log('\n[F] Intentional Reset button → save → resets to role defaults (unchanged behavior)');
{
  await openAndSave('usr-reset', { clickReset: true });
  const u = rawUser('usr-reset');
  ok('F: permissions reset to []', JSON.stringify(u.permissions) === '[]', `got ${JSON.stringify(u.permissions)}`);
  ok('F: permissionsExplicit stored as false', u.permissionsExplicit === false, `got ${u.permissionsExplicit}`);
  ok('F: effective perms now = role defaults (company_hr)', sortJoin(getEffectivePermissions(u)) === sortJoin(DEFAULT_ROLE_PERMISSIONS.company_hr), `got ${sortJoin(getEffectivePermissions(u)).slice(0, 80)}`);
}

console.log('\n[G] Role change + manual checkbox toggle → saved as explicit (Patch B), no lost change');
{
  const expected = sortJoin([...payrollDefaults, 'payroll.disburse']);
  const othersBefore = rawUsers()
    .filter((u) => u && u.id !== 'usr-edit')
    .map((u) => `${u.id}=${JSON.stringify(u)}`);
  await openAndSave('usr-edit', { role: 'payroll_admin', togglePerm: 'payroll.disburse' });
  const u = rawUser('usr-edit');
  ok('G: permissionsExplicit === true (manual edit honored)', u.permissionsExplicit === true, `got ${u.permissionsExplicit}`);
  ok('G: stored set = previewed payroll defaults + the toggled permission', sortJoin(u.permissions) === expected, `got ${sortJoin(u.permissions).slice(0, 100)}`);
  const othersAfter = rawUsers()
    .filter((u) => u && u.id !== 'usr-edit')
    .map((u) => `${u.id}=${JSON.stringify(u)}`);
  const unchanged = othersBefore.length === othersAfter.length && othersBefore.every((r, i) => r === othersAfter[i]);
  ok('G/I: every OTHER user record unchanged after role-change save', unchanged);
}

console.log('\n[H] _rawPermissions never reaches storage or the server payload');
{
  ok('H: no stored user carries _rawPermissions', rawUsers().every((u) => !('_rawPermissions' in u)));
  ok('H: server POST payloads never contain _rawPermissions', usersPosts.every((b) => !b.includes('_rawPermissions')), `posts=${usersPosts.length}`);
  ok('H: at least one users POST captured', usersPosts.length >= 1);
  const lastPost = JSON.parse(usersPosts[usersPosts.length - 1]);
  ok('H: final server payload === raw localStorage users', JSON.stringify(lastPost) === JSON.stringify(rawUsers()), `post=${lastPost.length} raw=${rawUsers().length}`);
}

console.log('\n[J] Brand-new user creation still saves a clean role-defaults row (no marker)');
{
  let saved = false;
  openUserModal(null, () => { saved = true; });
  const ov = $('.modal-overlay');
  const known = new Set(rawUsers().map((u) => u.id));
  setVal($('input[name="name"]', ov), 'Newuser');
  setVal($('input[name="email"]', ov), 'new@test.local');
  setVal($('input[name="username"]', ov), 'newuser');
  setVal($('input[name="password"]', ov), 'pbkdf2$x$1$x');
  click($('.submit-user-btn', ov));
  await sleep(250);
  await Promise.resolve(storage._postChain);
  const created = rawUsers().find((u) => u && !known.has(u.id));
  ok('J: a new user row was created', !!created, `found=${created ? created.id : 'none'}`);
  ok('J: new user permission shape = clean role-defaults row ([] + permissionsExplicit:false)', created && JSON.stringify(created.permissions) === '[]' && created.permissionsExplicit === false, `perms=${JSON.stringify(created && created.permissions)} explicit=${created && created.permissionsExplicit}`);
  ok('J: no _rawPermissions on the new user', created && !('_rawPermissions' in created));
  ok('J: effective perms of the new user = company_hr defaults', created && sortJoin(getEffectivePermissions(created)) === sortJoin(DEFAULT_ROLE_PERMISSIONS.company_hr));
}

console.log(`\n=== P10.5 RESULT: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}