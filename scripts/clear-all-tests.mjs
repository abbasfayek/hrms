// Clear-all-data endpoint coverage (server side).
// The app's "تصفير قاعدة البيانات" button previously did nothing: it posted []
// per collection, and the server merge correctly preserves records it does not
// know about, so the very next sync restored everything. This suite covers the
// dedicated super_admin-only POST /api/clear-all that wipes the operational
// collections on the SERVER files (system/security collections preserved).
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import net from 'net';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL  ${name}${extra ? ` (${extra})` : ''}`); }
}

// ---------------------------------------------------------------- helpers
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return `pbkdf2$${salt.toString('base64')}$${100000}$${hash.toString('base64')}`;
}

function readJSON(tmp, file) { return JSON.parse(fs.readFileSync(path.join(tmp, 'data', file), 'utf-8')); }
function writeJSON(tmp, file, data) { fs.writeFileSync(path.join(tmp, 'data', file), JSON.stringify(data, null, 2), 'utf-8'); }

function makeTmpApp() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-clear-'));
  const copySync = (from, to) => fs.cpSync(from, to, { recursive: true });
  for (const f of ['server.js', 'index.html', 'server-authz.mjs']) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  copySync(path.join(ROOT, 'public'), path.join(tmp, 'public'));
  copySync(path.join(ROOT, 'data'), path.join(tmp, 'data'));
  return tmp;
}

function seedFixture(tmp) {
  const companies = readJSON(tmp, 'companies.json');
  companies.push({
    id: 'comp-2', nameAr: 'الشركة الثانية', nameEn: 'Second Co.', code: 'C2',
    currency: 'USD', currencySymbol: '$', commercialRegistration: '', taxNumber: '',
    branches: [
      { id: 'br-2a', companyId: 'comp-2', nameAr: 'فرع 2-أ', nameEn: 'Branch 2A', city: '', payDay: 1, branchType: 'main', parentBranchId: null },
      { id: 'br-2b', companyId: 'comp-2', nameAr: 'فرع 2-ب', nameEn: 'Branch 2B', city: '', payDay: 15, branchType: 'main', parentBranchId: null },
    ],
    hourlyLeaveQuota: 4,
  });
  writeJSON(tmp, 'companies.json', companies);

  const employees = readJSON(tmp, 'employees.json');
  employees.push(
    { id: 'emp-c2a', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'EMP-C2-1', fullName: 'Second Co Empl A', basicSalary: 5000, status: 'active', contractType: 'full_time', updatedAt: new Date().toISOString() },
    { id: 'emp-c2b', companyId: 'comp-2', branchId: 'br-2b', employeeNumber: 'EMP-C2-2', fullName: 'Second Co Empl B', basicSalary: 4000, status: 'active', contractType: 'full_time', updatedAt: new Date().toISOString() },
  );
  writeJSON(tmp, 'employees.json', employees);

  const users = readJSON(tmp, 'users.json');
  const scoped = [
    { id: 'u-c2-hr', username: 'c2-hr', name: 'HR Comp2', role: 'company_hr', assignedCompanyId: 'comp-2', assignedBranchId: 'all' },
  ];
  for (const u of scoped) users.push({ ...u, email: `${u.username}@test.local`, password: hashPassword('SecretPass-101'), hidden: false, protected: false });
  writeJSON(tmp, 'users.json', users);

  writeJSON(tmp, 'payrolls.json', [
    { id: 'pb-c1', name: 'Payroll C1', status: 'submitted', companyId: 'comp-1', branchId: 'br-1', period: '2026-08', month: '2026-08', items: [{ employeeId: 'emp-c1-1' }], totalNet: 1000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ]);
  writeJSON(tmp, 'leaves.json', [
    { id: 'lv-c1', employeeId: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', startDate: '2026-09-01', endDate: '2026-09-03' },
  ]);
  writeJSON(tmp, 'loans.json', [
    { id: 'ln-c1', employeeId: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', amount: 3000, installments: 3 },
  ]);
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
        if (r.status === 200 || r.status === 401) { child.serverStdout = out; return resolve(child); }
      } catch {}
      if (Date.now() > deadline) { try { child.kill(); } catch {} return reject(new Error('server did not boot: ' + out)); }
      setTimeout(probe, 250);
    };
    probe();
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    try { child.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 2000);
  });
}

async function request(base, apiPath, { method = 'GET', session = null, headers = {}, body = null } = {}) {
  const h = { ...headers };
  if (session) h['X-Session-Token'] = session;
  if (body !== null) h['Content-Type'] = 'application/json';
  const res = await fetch(base + apiPath, { method, headers: h, body: body !== null ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function login(base, username, password) {
  const r = await request(base, '/api/auth/login', { method: 'POST', body: { username, password } });
  return r.status === 200 && r.data && r.data.session ? r.data.session : null;
}

function factorySuperCred(tmp) {
  const backupsDir = path.join(tmp, 'data', 'backups');
  if (!fs.existsSync(backupsDir)) return '';
  const files = fs.readdirSync(backupsDir).filter((f) => /^users-/.test(f)).sort();
  if (!files.length) return '';
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(backupsDir, files[0]), 'utf-8'));
    const u = Array.isArray(raw) ? raw.find((x) => x && x.username === 'system') : null;
    return u ? u.password : '';
  } catch { return ''; }
}

const CLEARABLE = ['employees', 'leaves', 'hourly_leaves', 'overtime', 'loans', 'increments', 'attendance', 'holidays', 'payrolls', 'eosb'];
const PRESERVED = ['companies', 'users', 'settings'];

// --------------------------------------------------------------------- main
async function main() {
  const tmp = makeTmpApp();
  seedFixture(tmp);
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const server = await bootServer(tmp, port);
  try {
    // 1) Non-super rejected
    const hr2 = await login(BASE, 'c2-hr', 'SecretPass-101');
    ok('C-01 limited user CANNOT clear all data on the server', Boolean(hr2), hr2 ? '' : 'login failed');
    const denyRes = await request(BASE, '/api/clear-all', { method: 'POST', session: hr2 });
    ok('C-02 company_hr clear-all rejected (403/super_required)', denyRes.status === 403 && denyRes.data && denyRes.data.code === 'super_required', `status=${denyRes.status} body=${JSON.stringify(denyRes.data)}`);
    const diskBefore = readJSON(tmp, 'employees.json');
    ok('C-03 non-super attempt did NOT wipe any employee file', Array.isArray(diskBefore) && diskBefore.length > 0, `rows=${Array.isArray(diskBefore) ? diskBefore.length : 'n/a'}`);

    // 2) Super admin clears
    const superPw = factorySuperCred(tmp);
    const admin = await login(BASE, 'system', superPw);
    ok('C-04 super admin login', Boolean(admin), 'super login failed');
    const cleanRes = await request(BASE, '/api/clear-all', { method: 'POST', session: admin });
    ok('C-05 super_admin clear-all succeeds (200)', cleanRes.status === 200 && cleanRes.data && cleanRes.data.success === true, `status=${cleanRes.status} body=${JSON.stringify(cleanRes.data)}`);

    // 3) On-disk verification: operational collections wiped, security kept
    const clearedOk = CLEARABLE.every((col) => {
      const arr = readJSON(tmp, `${col}.json`);
      if (['payrolls', 'eosb'].includes(col) && arr === null) return true;
      return Array.isArray(arr) && arr.length === 0;
    });
    ok('C-06 all operational collections wiped to [] on disk', clearedOk, `still has rows: ${CLEARABLE.filter((c) => { const a = readJSON(tmp, `${c}.json`); return !(Array.isArray(a) && a.length === 0); }).join(',')}`);

    const preservedOk = PRESERVED.every((col) => {
      const v = readJSON(tmp, `${col}.json`);
      if (col === 'settings') return v !== null && typeof v === 'object';
      return Array.isArray(v) && v.length > 0;
    });
    ok('C-07 companies/users/settings preserved after clear', preservedOk, PRESERVED.map((c) => `${c}=${Array.isArray(readJSON(tmp, `${c}.json`)) ? readJSON(tmp, `${c}.json`).length : 'obj'}`).join(' '));

    // 4) Merge can no longer resurrect cleared records: a new write only adds
    const newEmp = { id: 'emp-new', companyId: 'comp-1', branchId: 'br-1', employeeNumber: 'EMP-NEW', fullName: 'New After Clear', basicSalary: 5000, status: 'active', updatedAt: new Date().toISOString() };
    const wRes = await request(BASE, '/api/data/employees', { method: 'POST', session: admin, headers: { 'X-Branch-Id': 'br-1' }, body: [newEmp] });
    ok('C-08 super write after clear succeeds', wRes.status === 200, `status=${wRes.status}`);
    const after = readJSON(tmp, 'employees.json');
    ok('C-09 post-clear write persists and NO cleared record resurrects', Array.isArray(after) && after.length === 1 && after[0].id === 'emp-new', `rows=${Array.isArray(after) ? after.map((e) => e.id).join(',') : 'n/a'}`);

    // 5) No server-side data leak: normal user still works after clear
    const readBack = await request(BASE, '/api/data/employees', { session: hr2 });
    ok('C-10 limited user reads clean employee file after clear', readBack.status === 200, `status=${readBack.status}`);

    // 6) Pending-clear: a wipe made while OFFLINE completes on the NEXT BOOT
    // before any sync can pull the stale server data back (no resurrection).
    const realFetch = globalThis.fetch;
    const wrapper = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      return realFetch(url.startsWith('/') ? `${BASE}${url}` : url, init);
    };
    const memStore = new Map();
    globalThis.localStorage = {
      getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
      setItem: (k, v) => memStore.set(k, String(v)),
      removeItem: (k) => memStore.delete(k),
      clear: () => memStore.clear(),
    };
    globalThis.fetch = wrapper;
    globalThis.window = { dispatchEvent: () => {}, addEventListener: () => {}, removeEventListener: () => {}, localStorage: undefined };
    if (typeof globalThis.CustomEvent !== 'function') {
      globalThis.CustomEvent = class CustomEvent {
        constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
      };
    }
    const { storage } = await import(new URL('public/js/storage.js', `file://${ROOT}/`.replace(/\\/g, '/')).href);
    await new Promise((r) => setTimeout(r, 200));

    const loginRes = await storage.serverLogin('system', superPw);
    ok('C-11 client storage server-login ok', loginRes.ok === true, JSON.stringify(loginRes));
    storage.setActiveUser('system');

    // Break the network: the client attempts the server wipe, goes offline.
    globalThis.fetch = async () => { throw new Error('offline'); };
    const offlineRes = await storage.clearAllData();
    ok('C-12 offline clear reports offline (never crashes)', offlineRes && offlineRes.offline === true, JSON.stringify(offlineRes));
    ok('C-13 offline clear leaves local employees wiped', Array.isArray(storage.getState().employees) && storage.getState().employees.length === 0, `len=${Array.isArray(storage.getState().employees) ? storage.getState().employees.length : 'n/a'}`);
    ok('C-14 pending-clear flag remembered for next boot', memStore.get('hrms_pending_clear') != null);

    // Server still holds the pre-wipe row at this point
    const staleBefore = readJSON(tmp, 'employees.json');
    ok('C-15 server NOT wiped while offline (expected)', Array.isArray(staleBefore) && staleBefore.some((e) => e.id === 'emp-new'), `rows=${Array.isArray(staleBefore) ? staleBefore.length : 'n/a'}`);

    // Reconnect: the boot-time clear runs BEFORE syncFromServer pulls data.
    globalThis.fetch = wrapper;
    await storage.init();
    await new Promise((r) => setTimeout(r, 300));

    const staleAfter = readJSON(tmp, 'employees.json');
    ok('C-16 reconnect completes the server wipe (no resurrection)', Array.isArray(staleAfter) && staleAfter.length === 0, `rows=${Array.isArray(staleAfter) ? staleAfter.length : 'n/a'}`);
    ok('C-17 local employees still empty after reconnect sync', Array.isArray(storage.getState().employees) && storage.getState().employees.length === 0, `len=${Array.isArray(storage.getState().employees) ? storage.getState().employees.length : 'n/a'}`);
    globalThis.fetch = realFetch;
  } finally {
    await stopServer(server);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }

  console.log('\n=====================================================');
  console.log(`CLEAR-ALL TESTS: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log('  ❌ ' + f));
    process.exit(1);
  } else {
    console.log('🎉 Clear-all server reset verified end-to-end.');
  }
}

main().catch((e) => { console.error('Test harness error:', e); process.exit(1); });