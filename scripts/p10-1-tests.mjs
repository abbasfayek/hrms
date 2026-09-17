// P10-1 — Server-side RBAC + Company/Branch isolation (C-2).
// Negative security battery (fail-before-pass):
//   - RED:   against baseline (6981083) the negative asserts FAIL, proving the
//            vulnerability (cross-company read/write, privilege escalation).
//   - GREEN: after implementation the same file must pass assert-for-assert.
//
// Harness: boots the REAL server.js on a throwaway TEMP COPY of the app (the
// pattern proven by release-gate-test-part-b) and seeds scoped test users, a
// second company, cross-company employees/payrolls/audit/deleted tombstones.
// NEVER touches the real data/ directory.
//
// The battery is split into hermetic PHASES. Each phase is a fresh temp copy +
// fresh server, because on the vulnerable baseline some tests perform writes
// (users replace, restore, access-token rotation) that would otherwise poison
// the following assertions. This keeps every assert meaningful on RED and GREEN.
//
// Run:    node scripts/p10-1-tests.mjs
// Exit:   0 = all green, 1 = any negative assert failed (vulnerability present)

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

const SCOPED_PW = 'SecretPass-101';

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-p101-'));
  const copySync = (from, to) => fs.cpSync(from, to, { recursive: true });
  for (const f of ['server.js', 'index.html', 'server-authz.mjs']) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  copySync(path.join(ROOT, 'public'), path.join(tmp, 'public'));
  copySync(path.join(ROOT, 'data'), path.join(tmp, 'data'));
  return tmp;
}

// Seed scoped test users, a second company and cross-company fixtures into the
// temp copy. Throwaway data — never touches the real workspace.
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
    // Hermetic fixture: branch_hr 'c1b2-hr' (br-1788788794421) must have at
    // least one employee in its branch, and pb-c1's item (emp-1788944410774)
    // must resolve to a real employee — otherwise N04/N16b depend on whatever
    // exists in the developer's local data/ directory.
    { id: 'emp-brh', companyId: 'comp-1', branchId: 'br-1788788794421', employeeNumber: 'EMP-BRH-1', fullName: 'Branch HR Target', basicSalary: 3000, status: 'active', contractType: 'full_time', updatedAt: new Date().toISOString() },
    { id: 'emp-1788944410774', companyId: 'comp-1', branchId: 'br-1', employeeNumber: 'EMP-C1-1', fullName: 'C1 B1 Empl', basicSalary: 4500, status: 'active', contractType: 'full_time', updatedAt: new Date().toISOString() },
    { id: 'emp-c2a', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'EMP-C2-1', fullName: 'Second Co Empl A', basicSalary: 5000, status: 'active', contractType: 'full_time', updatedAt: new Date().toISOString() },
    { id: 'emp-c2b', companyId: 'comp-2', branchId: 'br-2b', employeeNumber: 'EMP-C2-2', fullName: 'Second Co Empl B', basicSalary: 4000, status: 'active', contractType: 'full_time', updatedAt: new Date().toISOString() },
  );
  writeJSON(tmp, 'employees.json', employees);

  const users = readJSON(tmp, 'users.json');
  const scoped = [
    { id: 'u-c2-hr', username: 'c2-hr', name: 'HR Comp2', role: 'company_hr', assignedCompanyId: 'comp-2', assignedBranchId: 'all' },
    { id: 'u-c1b2-hr', username: 'c1b2-hr', name: 'HR C1B2', role: 'branch_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'br-1788788794421' },
    { id: 'u-c2-pay', username: 'c2-pay', name: 'PayComp2', role: 'payroll_admin', assignedCompanyId: 'comp-2', assignedBranchId: 'all' },
    { id: 'u-c1-payoff', username: 'c1-payoff', name: 'PayoffC1', role: 'payments_officer', assignedCompanyId: 'comp-1', assignedBranchId: 'br-1' },
    { id: 'u-c1-audit', username: 'c1-audit', name: 'AudC1', role: 'audit_reviewer', assignedCompanyId: 'comp-1', assignedBranchId: 'br-1' },
  ];
  for (const u of scoped) users.push({ ...u, email: `${u.username}@test.local`, password: hashPassword(SCOPED_PW), hidden: false, protected: false });
  writeJSON(tmp, 'users.json', users);

  writeJSON(tmp, 'payrolls.json', [
    { id: 'pb-c1', name: 'Payroll C1', status: 'submitted', companyId: 'comp-1', branchId: 'br-1', period: '2026-08', month: '2026-08', items: [{ employeeId: 'emp-1788944410774' }], totalNet: 1000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'pb-c2', name: 'Payroll C2', status: 'submitted', companyId: 'comp-2', branchId: 'br-2a', period: '2026-08', month: '2026-08', items: [{ employeeId: 'emp-c2a' }], totalNet: 5000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ]);

  writeJSON(tmp, 'audit.json', [
    { id: 'a1', action: 'test', at: new Date().toISOString(), by: 'x', companyId: 'comp-1', branchId: 'br-1' },
    { id: 'a2', action: 'test2', at: new Date().toISOString(), by: 'y', companyId: 'comp-2' },
  ]);

  // Phase-5 audit trail envelope: comp-1 event, comp-2 event, one GLOBAL event.
  // POLICY (P10-1): fail-closed — global/no-scope events are super-only.
  writeJSON(tmp, 'audit_trail.json', {
    schema: 'audit.v1', seq: 3, chainHead: 'h3',
    events: [
      { eventId: 'EV1', action: 'PAYROLL_SUBMITTED', at: new Date().toISOString(), seq: 1, companyId: 'comp-1', branchId: 'br-1', prevHash: null, hash: 'h1' },
      { eventId: 'EV2', action: 'PAYROLL_SUBMITTED', at: new Date().toISOString(), seq: 2, companyId: 'comp-2', branchId: 'br-2a', prevHash: 'h1', hash: 'h2' },
      { eventId: 'EV3', action: 'SYSTEM_EVENT', at: new Date().toISOString(), seq: 3, prevHash: 'h2', hash: 'h3' },
    ],
  });

  writeJSON(tmp, 'deleted_records.json', [
    { collection: 'employees', data: { id: 'emp-del-c1', companyId: 'comp-1' } },
    { collection: 'employees', data: { id: 'emp-del-c2', companyId: 'comp-2' } },
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

async function api(base, apiPath, { method = 'GET', session = null, headers = {}, body = null } = {}) {
  const h = { ...headers };
  if (session) h['X-Session-Token'] = session;
  if (body !== null) h['Content-Type'] = 'application/json';
  const res = await fetch(base + apiPath, { method, headers: h, body: body !== null ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function login(base, username, password) {
  const r = await api(base, '/api/auth/login', { method: 'POST', body: { username, password } });
  return r.status === 200 && r.data && r.data.session ? r.data.session : null;
}

function runFactoryCred(tmp) {
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

// Each phase = fresh copy + fresh server, so destructive baseline behaviour
// cannot poison later asserts.
async function runPhase(label, fn) {
  console.log(`\n--- Phase: ${label} ---`);
  const tmp = makeTmpApp();
  seedFixture(tmp);
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  let server = null;
  try {
    server = await bootServer(tmp, port);
    const helpers = { BASE, tmp, api: (p, o) => api(BASE, p, o), login: (u, pw) => login(BASE, u, pw) };
    await fn(helpers);
  } finally {
    if (server) await stopServer(server);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- battery
async function main() {
  console.log('\n=== P10-1 server RBAC / company-branch isolation — negative battery ===');
  console.log('RED = vulnerability present on this server build;  GREEN = protected.\n');

  // ---- Phase 1: auth canaries + scoped reads + permission denial ----
  await runPhase('reads & permission denial', async ({ api, login, tmp }) => {
    const anon = await api('/api/data/employees');
    ok('N01 anonymous data read rejected (401)', anon.status === 401, `status=${anon.status}`);
    const bad = await api('/api/auth/login', { method: 'POST', body: { username: 'system', password: 'definitely-wrong' } });
    ok('N02 wrong password rejected (401)', bad.status === 401, `status=${bad.status}`);

    const admin = await login('system', runFactoryCred(tmp));
    ok('N31 factory super_admin login works', !!admin);
    const hr2 = await login('c2-hr', SCOPED_PW);
    const bhr = await login('c1b2-hr', SCOPED_PW);
    const pay2 = await login('c2-pay', SCOPED_PW);
    const payoff = await login('c1-payoff', SCOPED_PW);
    ok('N32 all scoped test users can log in', [hr2, bhr, pay2, payoff].every(Boolean));

    const emp2 = await api('/api/data/employees', { session: hr2 });
    const emp2Arr = Array.isArray(emp2.data) ? emp2.data : [];
    ok('N03 company_hr(comp-2) sees ONLY comp-2 employees', emp2Arr.length > 0 && emp2Arr.every((e) => e.companyId === 'comp-2'),
      `saw ${emp2Arr.filter((e) => e.companyId !== 'comp-2').length} out-of-scope rows`);

    const empB = await api('/api/data/employees', { session: bhr });
    const empBArr = Array.isArray(empB.data) ? empB.data : [];
    ok('N04 branch_hr sees ONLY its branch employees',
      empBArr.length > 0 && empBArr.every((e) => e.branchId === 'br-1788788794421'),
      `saw ${empBArr.filter((e) => e.branchId !== 'br-1788788794421').length} out-of-scope rows`);

    const payr = await api('/api/data/payrolls', { session: pay2 });
    const payArr = Array.isArray(payr.data) ? payr.data : [];
    ok('N05 payroll_admin(comp-2) sees ONLY comp-2 payroll batches',
      payArr.length === 1 && payArr[0].id === 'pb-c2', `batches=${payArr.map((b) => b.id).join(',')}`);

    const payoffPay = await api('/api/data/payrolls', { session: payoff });
    const ppArr = Array.isArray(payoffPay.data) ? payoffPay.data : [];
    ok('N16b payments_officer sees ONLY comp-1/br-1 batch',
      ppArr.length === 1 && ppArr[0].id === 'pb-c1', `batches=${ppArr.map((b) => b.id).join(',')}`);

    const comps = await api('/api/data/companies', { session: hr2 });
    const cmpArr = Array.isArray(comps.data) ? comps.data : [];
    ok('N06 company_hr(comp-2) sees ONLY its own company',
      cmpArr.length === 1 && cmpArr[0].id === 'comp-2', `companies=${cmpArr.map((c) => c.id).join(',')}`);

    const usersR = await api('/api/data/users', { session: hr2 });
    ok('N07 company_hr cannot read users collection (accounts leak)', usersR.status === 403, `status=${usersR.status}`);
    const settingsR = await api('/api/data/settings', { session: hr2 });
    ok('N08 company_hr cannot read global settings', settingsR.status === 403, `status=${settingsR.status}`);
    const delRecR = await api('/api/data/deleted_records', { session: hr2 });
    ok('N09b company_hr cannot read deleted_records', delRecR.status === 403, `status=${delRecR.status}`);
    const payoffEmp = await api('/api/data/employees', { session: payoff });
    ok('N16 payments_officer cannot read employees (no employees.view)', payoffEmp.status === 403, `status=${payoffEmp.status}`);

    const tamper = await api('/api/data/employees', {
      session: hr2,
      headers: { 'X-Role': 'super_admin', 'X-Company-Id': 'all', 'X-Permissions': 'employees.view' },
    });
    const thArr = Array.isArray(tamper.data) ? tamper.data : [];
    ok('N14 client-supplied role/scope headers are ignored (still scoped)',
      thArr.length > 0 && thArr.every((e) => e.companyId === 'comp-2'),
      `saw ${thArr.filter((e) => e.companyId !== 'comp-2').length} out-of-scope rows`);
  });

  // ---- Phase 2: cross-company / cross-branch writes + tamper persistence ----
  await runPhase('write scope & payload tampering', async ({ api, login, tmp }) => {
    const admin = await login('system', runFactoryCred(tmp));
    const hr2 = await login('c2-hr', SCOPED_PW);

    const forged = {
      id: 'emp-1788944410774', companyId: 'comp-1', branchId: 'br-1',
      employeeNumber: 'EMP-FORGED', fullName: 'FORGED_BY_ATTACK', basicSalary: 999999,
      updatedAt: new Date(Date.now() + 1000000).toISOString(), status: 'active',
    };
    const wFake = await api('/api/data/employees', { method: 'POST', session: hr2, body: [forged] });
    ok('N10 company_hr(comp-2) cross-company WRITE rejected', wFake.status === 403, `status=${wFake.status}`);

    const emp2 = await api('/api/data/employees', { session: hr2 });
    const emp2Arr = Array.isArray(emp2.data) ? emp2.data : [];
    const legit = { ...(emp2Arr[0] || { id: 'emp-c2a', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'EMP-C2-1' }), notes: 'legit edit' };
    const wLegit = await api('/api/data/employees', { method: 'POST', session: hr2, headers: { 'X-Branch-Id': 'br-2a' }, body: [legit] });
    ok('N11 company_hr(comp-2) scoped WRITE allowed', wLegit.status === 200, `status=${wLegit.status}`);

    // New enforcement (branch of a multi-branch company user must be declared):
    const wNoBranch = await api('/api/data/employees', { method: 'POST', session: hr2, body: [legit] });
    ok('N11b company_hr(comp-2) multi-branch WRITE WITHOUT X-Branch-Id rejected', wNoBranch.status === 403 && wNoBranch.data && wNoBranch.data.code === 'branch_required', `status=${wNoBranch.status} code=${wNoBranch.data && wNoBranch.data.code}`);
    const wFakeBranch = await api('/api/data/employees', { method: 'POST', session: hr2, headers: { 'X-Branch-Id': 'br-1' }, body: [legit] });
    ok('N11c company_hr(comp-2) WRITE with FOREIGN branch rejected', wFakeBranch.status === 403 && wFakeBranch.data && wFakeBranch.data.code === 'scope_violation', `status=${wFakeBranch.status} code=${wFakeBranch.data && wFakeBranch.data.code}`);
    const wGhostBranch = await api('/api/data/employees', { method: 'POST', session: hr2, headers: { 'X-Branch-Id': 'br-zz' }, body: [legit] });
    ok('N11d company_hr(comp-2) WRITE with NON-EXISTENT branch rejected', wGhostBranch.status === 403, `status=${wGhostBranch.status}`);

    const check = await api('/api/data/employees', { session: admin });
    const onDisk = (Array.isArray(check.data) ? check.data : []).find((e) => e.id === 'emp-1788944410774');
    ok('N10b forged out-of-scope employee NOT applied', !onDisk || onDisk.employeeNumber !== 'EMP-FORGED',
      onDisk ? `employeeNumber=${onDisk.employeeNumber}` : '');

    const wLeave = await api('/api/data/leaves', {
      method: 'POST', session: hr2,
      body: [{ id: 'lv-x', employeeId: 'emp-1788944410774', companyId: 'comp-1', startDate: '2026-09-01', endDate: '2026-09-02', createdAt: new Date().toISOString() }],
    });
    ok('N25 record referencing out-of-scope employeeId rejected', wLeave.status === 403, `status=${wLeave.status}`);
  });

  // ---- Phase 3: audit scoping ----
  await runPhase('audit scoping', async ({ api, login }) => {
    const aud1 = await login('c1-audit', SCOPED_PW);
    const trail = await api('/api/data/audit_trail', { session: aud1 });
    const events = (trail.data && Array.isArray(trail.data.events)) ? trail.data.events : [];
    ok('N23 audit_reviewer(comp-1) sees ONLY comp-1 events (globals fail-closed)',
      trail.status === 200 && events.length > 0 && events.every((ev) => ev.companyId === 'comp-1' && ev.branchId === 'br-1'),
      `status=${trail.status} events=${events.map((e) => e.eventId).join(',')}`);

    const legacy = await api('/api/data/audit', { session: aud1 });
    const legacyArr = Array.isArray(legacy.data) ? legacy.data : [];
    ok('N23b legacy audit contains NO comp-2 source rows', !legacyArr.some((r) => r.companyId === 'comp-2'),
      legacyArr.map((r) => r.companyId).join(','));
  });

  // ---- Phase 4: privilege escalation + destructive admin endpoints ----
  await runPhase('privilege escalation', async ({ api, login, tmp }) => {
    const admin = await login('system', runFactoryCred(tmp));
    const hr2 = await login('c2-hr', SCOPED_PW);

    const usersAll = await api('/api/data/users', { session: admin });
    const usersArr = Array.isArray(usersAll.data) ? usersAll.data : [];

    const hacked = usersArr.map((u) => (u.id === 'u-c2-hr'
      ? { ...u, role: 'super_admin', assignedCompanyId: 'all', assignedBranchId: 'all' } : u));
    const wEscalate = await api('/api/data/users', { method: 'POST', session: hr2, body: hacked });
    ok('N13 self-promotion to super_admin rejected', wEscalate.status === 403, `status=${wEscalate.status}`);

    const newAdmin = {
      id: 'u-hacker', username: 'hacker', password: hashPassword('HackPass-1'),
      name: 'Hacker', role: 'super_admin', assignedCompanyId: 'all', assignedBranchId: 'all', protected: false, hidden: false,
    };
    const wCreate = await api('/api/data/users', { method: 'POST', session: hr2, body: usersArr.concat([newAdmin]) });
    ok('N12 creating a super_admin account rejected', wCreate.status === 403, `status=${wCreate.status}`);

    const wRestore = await api('/api/restore', { method: 'POST', session: hr2, body: { companies: [{ id: 'comp-1' }] } });
    ok('N19 restore rejected for non-super', wRestore.status === 403, `status=${wRestore.status}`);
    const wBackup = await api('/api/backup', { session: hr2 });
    ok('N20 backup rejected for non-super', wBackup.status === 403, `status=${wBackup.status}`);

    const wNewCompany = await api('/api/data/companies', { method: 'POST', session: hr2, body: [{ id: 'comp-3', nameEn: 'New Tenant', branches: [] }] });
    ok('N24 creating a new company/tenant rejected for company_hr', wNewCompany.status === 403, `status=${wNewCompany.status}`);

    const impBad = await api('/api/import-employees', {
      method: 'POST', session: hr2,
      body: { employees: [{ id: 'imp-c1', companyId: 'comp-1', branchId: 'br-1', employeeNumber: 'IMP-C1' }], mode: 'append' },
    });
    ok('N18 import of comp-1 employees rejected for comp-2 HR', impBad.status === 403, `status=${impBad.status}`);
    const impReplace = await api('/api/import-employees', {
      method: 'POST', session: hr2,
      body: { employees: [{ id: 'imp-c2', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'IMP-C2' }], mode: 'replace' },
    });
    ok('N18b import replace-mode rejected for non-super', impReplace.status === 403, `status=${impReplace.status}`);
  });

  // ---- Phase 5: super-admin positives + password hygiene + password survival ----
  await runPhase('super admin positives', async ({ api, login, tmp }) => {
    const admin = await login('system', runFactoryCred(tmp));

    const saUsers = await api('/api/data/users', { session: admin });
    const saArr = Array.isArray(saUsers.data) ? saUsers.data : [];
    ok('N21 super_admin read users: password hashes masked', saArr.length > 0 && saArr.every((u) => !('password' in u)),
      `${saArr.filter((u) => 'password' in u).length} rows carry password / ${saArr.length} total`);

    const wSettings = await api('/api/data/settings', { method: 'POST', session: admin, body: { companyName: 'T' } });
    ok('N33 super_admin settings write allowed', wSettings.status === 200, `status=${wSettings.status}`);

    // Post the masked users array back (as the real client would) — stored
    // password hashes must be preserved, not wiped.
    const wUsers = await api('/api/data/users', { method: 'POST', session: admin, body: saArr });
    ok('N22 super_admin users write allowed (users.manage)', wUsers.status === 200, `status=${wUsers.status}`);
    const relogin = await login('c2-hr', SCOPED_PW);
    ok('N22b masked users write preserves stored passwords (scoped user can still log in)', !!relogin);

    const saCompanies = await api('/api/data/companies', { session: admin });
    const saCmp = Array.isArray(saCompanies.data) ? saCompanies.data : [];
    ok('N34 super_admin sees ALL companies (global)',
      saCmp.some((c) => c.id === 'comp-1') && saCmp.some((c) => c.id === 'comp-2'),
      `companies=${saCmp.map((c) => c.id).join(',')}`);

    const corr = await api('/api/data/corrections', { method: 'POST', session: admin, body: [] });
    ok('N27 corrections collection rejected (not persisted yet) — pinned', corr.status === 400, `status=${corr.status}`);
  });

  // ---- Phase 6: access-token rotation last (its success kills all sessions) ----
  await runPhase('access-token gate', async ({ api, login, tmp }) => {
    await login('system', runFactoryCred(tmp));
    const hr2 = await login('c2-hr', SCOPED_PW);
    const wToken = await api('/api/access-token', { method: 'POST', session: hr2, body: { token: 'SneakyToken123' } });
    ok('N28 access-token rotation rejected for non-super', wToken.status === 403, `status=${wToken.status}`);
  });

  console.log(`\n${'='.repeat(64)}`);
  console.log(`P10-1 negative battery: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFAILED asserts (vulnerability evidence):');
    for (const f of failures) console.log(`  x ${f}`);
    console.log('\nOn baseline this is the C-2 proof. After implementation this must be all-green.\n');
    process.exit(1);
  }
  console.log('All P10-1 negative security asserts PASS — server is scoped and gated.\n');
  process.exit(0);
}

main().catch((e) => { console.error('Test harness error:', e); process.exit(1); });