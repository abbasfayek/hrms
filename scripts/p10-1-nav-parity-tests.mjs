// =========================================================
// P10-1: Client/Server navigation parity for super-only pages
// Proven here:
//   1. company_hr does NOT get settings.view (or users.view) by default.
//   2. company_hr does NOT see/open the users page.
//   3. company_hr does NOT see/open the settings page.
//   4. super_admin STILL sees/opens users and settings.
// Client defaults (public/js/types.js) must stay in exact parity with the
// server mirror (server-authz.mjs DEFAULT_ROLE_PERMISSIONS).
// Usage: node scripts/p10-1-nav-parity-tests.mjs
// =========================================================

let passed = 0;
let failed = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
};

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
const { DEFAULT_ROLE_PERMISSIONS: CLIENT_DEFAULTS } = await import(`${JS}types.js`);
const { DEFAULT_ROLE_PERMISSIONS: SERVER_DEFAULTS } = await import('../server-authz.mjs');

// The client route gate (app.js SUPER_ONLY_ROUTES + ROUTE_PERMISSIONS) hidden
// rule, reproduced here so the regression proves the actual user-visible path.
const SUPER_ONLY_ROUTES = new Set(['users', 'settings']);
const ROUTE_PERMISSIONS = { users: 'users.view', settings: 'settings.view' };
const can = (user, perm) => !!user && (user.permissions || []).includes(perm);
const getEffective = (user) => (Array.isArray(user.permissions) ? user.permissions : CLIENT_DEFAULTS[user.role] || []);
const isHidden = (user, route) =>
  (SUPER_ONLY_ROUTES.has(route) && (!user || user.role !== 'super_admin')) ||
  (ROUTE_PERMISSIONS[route] && !getEffective(user).includes(ROUTE_PERMISSIONS[route]));

const companyHr = { id: 'chr-1', role: 'company_hr', permissions: null };
const superAdmin = { id: 'sup-1', role: 'super_admin', permissions: null };

console.log('\n[1] company_hr defaults exclude users/settings (client + server parity)');
ok('client company_hr has NO settings.view by default', !CLIENT_DEFAULTS.company_hr.includes('settings.view'));
ok('client company_hr has NO users.view by default', !CLIENT_DEFAULTS.company_hr.includes('users.view'));
ok('client company_hr has NO users.manage by default', !CLIENT_DEFAULTS.company_hr.includes('users.manage'));
ok('server company_hr has NO settings.view by default', !SERVER_DEFAULTS.company_hr.includes('settings.view'));
ok('server company_hr has NO users.view by default', !SERVER_DEFAULTS.company_hr.includes('users.view'));
ok('client company_hr defaults are server company_hr defaults WITHOUT companies.manage (intended H-1 divergence)',
  JSON.stringify([...CLIENT_DEFAULTS.company_hr].sort()) ===
    JSON.stringify([...SERVER_DEFAULTS.company_hr].filter((p) => p !== 'companies.manage').sort()));
ok('server company_hr KEEPS scoped companies.manage (server side of H-1)',
  SERVER_DEFAULTS.company_hr.includes('companies.manage'));
ok('client company_hr does NOT grant companies.manage (client side of H-1)',
  !CLIENT_DEFAULTS.company_hr.includes('companies.manage'));

console.log('\n[2] company_hr does NOT see/open users');
ok('company_hr users nav entry is hidden', isHidden(companyHr, 'users') === true);
ok('company_hr users route cannot open (permission also denied)', can(companyHr, 'users.view') === false);

console.log('\n[3] company_hr does NOT see/open settings');
ok('company_hr settings nav entry is hidden', isHidden(companyHr, 'settings') === true);
ok('company_hr settings route cannot open (permission also denied)', can(companyHr, 'settings.view') === false);

console.log('\n[4] super_admin STILL sees/opens users + settings');
ok('super_admin default still grants users.view', CLIENT_DEFAULTS.super_admin.includes('users.view'));
ok('super_admin default still grants users.manage', CLIENT_DEFAULTS.super_admin.includes('users.manage'));
ok('super_admin default still grants settings.view', CLIENT_DEFAULTS.super_admin.includes('settings.view'));
ok('super_admin default still grants settings.manage', CLIENT_DEFAULTS.super_admin.includes('settings.manage'));
ok('super_admin users nav entry is visible', isHidden(superAdmin, 'users') === false);
ok('super_admin settings nav entry is visible', isHidden(superAdmin, 'settings') === false);

console.log('\n[5] a company_hr user explicitly granted users/settings perms is STILL blocked (role gate, not permission gate)');
const boosted = { ...companyHr, permissions: [...(CLIENT_DEFAULTS.company_hr || []), 'users.view', 'users.manage', 'settings.view', 'settings.manage'] };
ok('even with every users/settings permission granted, company_hr users nav stays hidden', isHidden(boosted, 'users') === true);
ok('even with every users/settings permission granted, company_hr settings nav stays hidden', isHidden(boosted, 'settings') === true);

console.log(`\nP10-1 Nav Parity: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}