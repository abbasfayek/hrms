// =========================================================
// Role-Matrix Parity — client (public/js/types.js) vs server
// (server-authz.mjs) DEFAULT_ROLE_PERMISSIONS drift guard.
// Purpose: the two process sides must agree on every default
// role->permission grant. A change to one side without the
// other is a divergence (UI grants with server denial, or
// server grants the UI never renders). This suite detects
// that drift structurally — it is intentionally NOT a
// re-listing of the matrix, so it keeps working as the
// matrices evolve and fails on first divergence.
// Usage: node scripts/role-matrix-parity-tests.mjs
// Exit:  0 = parity holds, 1 = divergence detected
// =========================================================

import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- Browser shims (types.js touches window/localStorage at import of deps) ----
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
if (!globalThis.CustomEvent) globalThis.CustomEvent = class CustomEvent { constructor(t, o = {}) { this.type = t; this.detail = o && o.detail; } };
if (!globalThis.window) globalThis.window = globalThis;

let passed = 0;
let failed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
}

const clientUrl = pathToFileURL(path.join(ROOT, 'public', 'js', 'types.js')).href;
const serverUrl = pathToFileURL(path.join(ROOT, 'server-authz.mjs')).href;
const { DEFAULT_ROLE_PERMISSIONS: CLIENT } = await import(clientUrl);
const { DEFAULT_ROLE_PERMISSIONS: SERVER } = await import(serverUrl);

const clientRoles = Object.keys(CLIENT);
const serverRoles = Object.keys(SERVER);

console.log('\n=== Role-Matrix Parity: client types.js vs server-authz.mjs ===');

ok('Same role key-set on both sides', clientRoles.length === serverRoles.length && clientRoles.every((r) => serverRoles.includes(r)),
  `client=${clientRoles.join(',')} server=${serverRoles.join(',')}`);

for (const role of clientRoles) {
  const c = Array.isArray(CLIENT[role]) ? CLIENT[role] : [];
  const s = Array.isArray(SERVER[role]) ? SERVER[role] : [];
  const onlyClient = c.filter((p) => !s.includes(p));
  const onlyServer = s.filter((p) => !c.includes(p));
  const dupes = c.length !== s.length;
  ok(`${role} default matrix is identical on client and server`,
    onlyClient.length === 0 && onlyServer.length === 0 && !dupes,
    `clientOnly=[${onlyClient.join(',')}] serverOnly=[${onlyServer.join(',')}] client=${c.length} server=${s.length}`);
}

console.log(`\nRole-Matrix Parity: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
console.log('Client and server default role matrices are in parity.\n');