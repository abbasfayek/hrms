// =========================================================
// P10.3 Permission-persistence tests — Problem #2 regression
// Verifies, on the ACTUAL stored data (localStorage + the
// POST payload sent to the server), that:
//   A. legacy default-role rows (permissions: [], no marker)
//      stay [] after a no-touch open→save (NOT baked),
//   B. explicit zero ([], permissionsExplicit: true) is kept,
//   C. explicit partial sets are preserved verbatim,
//   D. toggling one checkbox on a default-role row converts it
//      to an explicit set per Patch B exactly,
//   E. saving ONE user never alters any other user's raw
//      permissions / permissionsExplicit (global preservation),
//   F. _rawPermissions (UI-only metadata) never reaches storage.
// Exercises the REAL modal flow (openUserModal) via jsdom.
// Usage: node scripts/p10-3-permissions-persistence-tests.mjs
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

// --- Capture the server-bound payload for the users collection ----------
// Stub fetches BEFORE imports so the storage singleton's background
// init()/syncFromServer() can never reach (or be clobbered by) a real
// server. The capture buffer is cleared after seeding.
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

storage.seedIfMissing();
storage.saveCompanies(defaultCompanies);
storage.saveSettings({ ...defaultSettings, currencySymbol: '$' });
storage.setSelectedCompanyId('all');
storage.setSelectedBranchId('all');

// Let the storage singleton's background init() settle, then drop any
// seed-phase captures so only modal-save payloads are asserted against.
await new Promise((r) => setTimeout(r, 150));
usersPosts.length = 0;

const companyHrDefaults = [...(DEFAULT_ROLE_PERMISSIONS.company_hr || [])];

// Helpers to read the RAW stored records (exactly as persisted, key-for-key)
const rawUsers = () => {
  const raw = localStorage.getItem('hrms_users_v3');
  return raw ? JSON.parse(raw) : [];
};
const rawUser = (id) => rawUsers().find((u) => u && u.id === id);
const userRecord = (id) => storage.getState().users.find((u) => u.id === id);

async function openAndSave(userId, opts = {}) {
  let saved = false;
  openUserModal(userRecord(userId), () => { saved = true; });
  const ov = $('.modal-overlay');
  ok(`modal renders for ${userId}`, !!ov);
  if (opts.togglePerm) toggleCb($(`input[name="perm"][value="${opts.togglePerm}"]`, ov));
  if (opts.setName) setVal($('input[name="name"]', ov), opts.setName);
  click($('.submit-user-btn', ov));
  await sleep(250);
  await Promise.resolve(storage._postChain);
  return saved;
}

const isExpect = (u, permArr, explicit, label) => {
  const gotPerms = JSON.stringify(u.permissions);
  const wantPerms = JSON.stringify(permArr);
  ok(`${label}: permissions stored as expected`, gotPerms === wantPerms, `got ${gotPerms}, want ${wantPerms}`);
  ok(`${label}: permissionsExplicit key ABSENT (legacy preserved, no marker at all)`, Object.prototype.hasOwnProperty.call(u, 'permissionsExplicit') === false, `hasOwnProperty=${Object.prototype.hasOwnProperty.call(u, 'permissionsExplicit')}`);
  ok(`${label}: no _rawPermissions leaked`, !('_rawPermissions' in u));
};

// ---------------------------------------------------------------------------
// Seed fixture users covering every permission-shape of Problem #2.
// ---------------------------------------------------------------------------
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

const usrLegacy   = mkUser('usr-legacy',   { permissions: [] });                                        // Case A
const usrExplicit = mkUser('usr-explicit', { permissions: [], permissionsExplicit: true });            // Case B
const usrPartial  = mkUser('usr-partial',  { permissions: ['employees.view'], permissionsExplicit: true }); // Case C
const usrToggle   = mkUser('usr-toggle',   { permissions: [] });                                        // Case D
const usrEdit     = mkUser('usr-edit',     { permissions: ['employees.view'], permissionsExplicit: true }); // Case E (the one being saved)
const usrFull     = mkUser('usr-full',     { permissions: [...companyHrDefaults], permissionsExplicit: false }); // pre-marker legacy-explicit guard
const usrBaked    = mkUser('usr-baked',    { permissions: [...companyHrDefaults], permissionsExplicit: false }); // global-preservation guard

storage.saveUsers(JSON.parse(JSON.stringify([...defaultUsers, usrLegacy, usrExplicit, usrPartial, usrToggle, usrEdit, usrFull, usrBaked])));
storage.setActiveUser('usr-admin');
usersPosts.length = 0;

console.log('\n[Case A] legacy default role  — permissions: [] (no marker) → open → save untouched');
{
  await openAndSave('usr-legacy');
  const u = rawUser('usr-legacy');
  isExpect(u, [], false, 'A');
  ok('A: effective perms still resolve to role defaults', JSON.stringify(getEffectivePermissions(u)) === JSON.stringify(companyHrDefaults), `got ${JSON.stringify(getEffectivePermissions(u)).slice(0, 60)}`);
}

console.log('\n[Case B] explicit zero  — permissions: [] + permissionsExplicit: true → open → save');
{
  await openAndSave('usr-explicit');
  const u = rawUser('usr-explicit');
  ok('B: permissions stored as []', JSON.stringify(u.permissions) === '[]', `got ${JSON.stringify(u.permissions)}`);
  ok('B: permissionsExplicit preserved as true', u.permissionsExplicit === true, `got ${u.permissionsExplicit}`);
  ok('B: no _rawPermissions leaked', !('_rawPermissions' in u));
}

console.log('\n[Case C] explicit partial  — permissions: ["employees.view"] + explicit: true → open → save');
{
  await openAndSave('usr-partial');
  const u = rawUser('usr-partial');
  ok('C: permissions stored verbatim', JSON.stringify(u.permissions) === JSON.stringify(['employees.view']), `got ${JSON.stringify(u.permissions)}`);
  ok('C: permissionsExplicit preserved as true', u.permissionsExplicit === true, `got ${u.permissionsExplicit}`);
  ok('C: no _rawPermissions leaked', !('_rawPermissions' in u));
}

console.log('\n[Case D] default role → toggle ONE checkbox → must become explicit per Patch B');
{
  const cbValue = Object.keys(PERMISSIONS).find((p) => !companyHrDefaults.includes(p));
  ok('D: a non-default permission exists to toggle', !!cbValue);
  await openAndSave('usr-toggle', { togglePerm: cbValue });
  const u = rawUser('usr-toggle');
  const expected = [...companyHrDefaults, cbValue];
  ok('D: stored as explicit Patch-B set', u.permissionsExplicit === true && [...u.permissions].sort().join(',') === [...expected].sort().join(','), `got ${JSON.stringify(u.permissions)}`);
  ok('D: no _rawPermissions leaked', !('_rawPermissions' in u));
}

console.log('\n[Case E] global preservation — save one user, all others byte-identical (permissions/permissionsExplicit)');
{
  const ids = ['usr-legacy', 'usr-explicit', 'usr-partial', 'usr-full', 'usr-baked'];
  const before = Object.fromEntries(ids.map((id) => [id, JSON.stringify(rawUser(id))]));
  await openAndSave('usr-edit', { setName: 'Edited Name' });
  const after = Object.fromEntries(ids.map((id) => [id, JSON.stringify(rawUser(id))]));
  for (const id of ids) {
    ok(`E: ${id} raw record unchanged`, before[id] === after[id], `before=${before[id].slice(0, 80)} after=${after[id].slice(0, 80)}`);
  }
  ok('E: edited user name updated', rawUser('usr-edit').name === 'Edited Name');
}

console.log('\n[Case F] _rawPermissions never reaches storage (localStorage + server payload)');
{
  ok('F: no stored user carries _rawPermissions', rawUsers().every((u) => !('_rawPermissions' in u)));
  ok('F: server POST payloads never contain _rawPermissions', usersPosts.every((b) => !b.includes('_rawPermissions')), `posts=${usersPosts.length}`);
  ok('F: at least one users POST was captured', usersPosts.length >= 1);
  const lastPost = JSON.parse(usersPosts[usersPosts.length - 1]);
  ok('F: final server payload === raw localStorage users', JSON.stringify(lastPost) === JSON.stringify(rawUsers()), `post=${lastPost.length} raw=${rawUsers().length}`);
}

console.log('\n[regression] protected super_admin preserved + effective perms intact');
{
  const admin = rawUser('usr-admin');
  ok('R: super_admin record untouched (no baked perms)', !admin.permissions || admin.permissions.length === 0, `got ${JSON.stringify(admin.permissions)}`);
  ok('R: effective perms of legacy row use role defaults', getEffectivePermissions(rawUser('usr-legacy')).length === companyHrDefaults.length);
}

console.log(`\n=== P10.3 RESULT: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}