// =========================================================
// P14 — R-1 regression: deleted_records super_admin write
// =========================================================
// Proves the exact regression introduced by b6553ae and guards the fix:
//   BEFORE (b6553ae): POST /api/data/deleted_records (+X-Branch-Id) -> 403
//                     scope_violation/branch_required, record NOT persisted.
//   AFTER : super_admin write succeeds WITHOUT a branch and IS persisted,
//           while branch enforcement for branch-scoped collections is intact.
//
// Usage: node scripts/p14-deleted-records-super-write-regression-tests.mjs
// =========================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
}

const readJSON = (tmp, f) => JSON.parse(fs.readFileSync(path.join(tmp, 'data', f), 'utf-8'));
const writeJSON = (tmp, f, d) => fs.writeFileSync(path.join(tmp, 'data', f), JSON.stringify(d, null, 2), 'utf-8');

function makeTmpApp() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-p14-'));
  for (const f of ['server.js', 'index.html', 'server-authz.mjs']) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  fs.cpSync(path.join(ROOT, 'public'), path.join(tmp, 'public'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'data'), path.join(tmp, 'data'), { recursive: true });
  return tmp;
}

function seedFixture(tmp) {
  writeJSON(tmp, 'users.json', [
    { id: 'u-su', username: 'su', name: 'Super Admin', role: 'super_admin', email: 'su@test.local', password: 'SuperPass-123!' },
    { id: 'u-hr', username: 'hr1', name: 'Company HR', role: 'company_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'all', email: 'hr1@test.local', password: 'HrPass-123!' },
  ]);
  writeJSON(tmp, 'sessions.json', {});
  writeJSON(tmp, 'companies.json', [
    { id: 'comp-1', nameAr: 'شركة', nameEn: 'Co', code: 'C1', currency: 'USD', branches: [
      { id: 'br-1', companyId: 'comp-1', nameAr: 'فرع', nameEn: 'B1', payDay: 1, branchType: 'main', parentBranchId: null },
    ] },
  ]);
  writeJSON(tmp, 'employees.json', [
    { id: 'emp-1', companyId: 'comp-1', branchId: 'br-1', employeeNumber: 'EMP-1', fullName: 'Emp One', status: 'active', contractType: 'full_time', basicSalary: 5000, updatedAt: '2026-09-01T00:00:00Z' },
  ]);
  writeJSON(tmp, 'payrolls.json', []);
  writeJSON(tmp, 'deleted_records.json', []);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}

function bootServer(tmp, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: tmp,
      env: { ...process.env, PORT: String(port) },
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

async function main() {
  const tmp = makeTmpApp();
  seedFixture(tmp);
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const server = await bootServer(tmp, port);
  try {
    const su = await login(BASE, 'su', 'SuperPass-123!');
    ok('0. super_admin login', Boolean(su), 'login failed');
    const hr = await login(BASE, 'hr1', 'HrPass-123!');
    ok('0b. non-super login', Boolean(hr), 'login failed');

    const tomb = (id) => ({ id, collection: 'employees', data: { id: 'emp-1', companyId: 'comp-1', branchId: 'br-1' }, deletedAt: new Date().toISOString(), deletedBy: 'su', reason: 'deleted' });

    // R-1: the regression — super write WITHOUT a branch must succeed and persist.
    const noBranch = await request(BASE, '/api/data/deleted_records', { method: 'POST', session: su, body: [tomb('del-1')] });
    ok('R-1a. super_admin + NO branch -> deleted_records write allowed (200)', noBranch.status === 200 && noBranch.data && noBranch.data.success === true, `status=${noBranch.status} body=${JSON.stringify(noBranch.data)}`);
    const disk1 = readJSON(tmp, 'deleted_records.json');
    ok('R-1b. tombstone ACTUALLY persisted to disk', Array.isArray(disk1) && disk1.length === 1 && disk1[0].id === 'del-1', `count=${Array.isArray(disk1) ? disk1.length : 'n/a'}`);

    // super + valid branch also allowed (preserve current sanctioned path)
    const withBranch = await request(BASE, '/api/data/deleted_records', { method: 'POST', session: su, headers: { 'X-Branch-Id': 'br-1' }, body: [tomb('del-1'), tomb('del-2'), tomb('del-3')] });
    ok('R-1c. super_admin + valid branch -> allowed (200)', withBranch.status === 200 && withBranch.data && withBranch.data.success === true, `status=${withBranch.status} body=${JSON.stringify(withBranch.data)}`);
    const disk2 = readJSON(tmp, 'deleted_records.json');
    ok('R-1d. full registry persisted to disk (client-style full post)', Array.isArray(disk2) && disk2.length === 3, `count=${Array.isArray(disk2) ? disk2.length : 'n/a'}`);

    // Non-super must remain forbidden (superOnly gate; no authorization weakening).
    const hrWrite = await request(BASE, '/api/data/deleted_records', { method: 'POST', session: hr, headers: { 'X-Branch-Id': 'br-1' }, body: [tomb('del-hr')] });
    ok('R-1e. non-super write to deleted_records remains forbidden', hrWrite.status === 403 && hrWrite.data && hrWrite.data.code === 'super_required', `status=${hrWrite.status} body=${JSON.stringify(hrWrite.data)}`);

    // ----- Branch enforcement must NOT be weakened for branch-scoped collections -----
    const empNoBranch = await request(BASE, '/api/data/employees', { method: 'POST', session: su, body: [{ id: 'emp-1', companyId: 'comp-1', branchId: 'br-1', fullName: 'Changed', status: 'active', updatedAt: '2026-09-02T00:00:00Z' }] });
    ok('E-1. employees write WITHOUT branch -> 403 branch_required', empNoBranch.status === 403 && empNoBranch.data && empNoBranch.data.code === 'branch_required', `status=${empNoBranch.status} body=${JSON.stringify(empNoBranch.data)}`);

    const empAll = await request(BASE, '/api/data/employees', { method: 'POST', session: su, headers: { 'X-Branch-Id': 'all' }, body: [{ id: 'emp-1', companyId: 'comp-1', branchId: 'br-1', fullName: 'Changed', status: 'active', updatedAt: '2026-09-02T00:00:00Z' }] });
    ok('E-2. employees write with X-Branch-Id=all -> 403 (all is not a real branch)', empAll.status === 403 && empAll.data && empAll.data.code === 'branch_required', `status=${empAll.status} body=${JSON.stringify(empAll.data)}`);

    const empOk = await request(BASE, '/api/data/employees', { method: 'POST', session: su, headers: { 'X-Branch-Id': 'br-1' }, body: [{ id: 'emp-1', companyId: 'comp-1', branchId: 'br-1', fullName: 'Changed', status: 'active', updatedAt: '2026-09-02T00:00:00Z' }] });
    ok('E-3. employees write WITH valid branch -> 200 (control)', empOk.status === 200, `status=${empOk.status} body=${JSON.stringify(empOk.data)}`);

    const prNoBranch = await request(BASE, '/api/data/payrolls', { method: 'POST', session: su, body: [{ id: 'pb-1', companyId: 'comp-1', branchId: 'br-1', status: 'draft', month: '2026-09', items: [] }] });
    ok('P-1. payroll write WITHOUT branch -> 403 branch_required', prNoBranch.status === 403 && prNoBranch.data && prNoBranch.data.code === 'branch_required', `status=${prNoBranch.status} body=${JSON.stringify(prNoBranch.data)}`);

    const prAll = await request(BASE, '/api/data/payrolls', { method: 'POST', session: su, headers: { 'X-Branch-Id': 'all' }, body: [{ id: 'pb-1', companyId: 'comp-1', branchId: 'br-1', status: 'draft', month: '2026-09', items: [] }] });
    ok('P-2. payroll write with X-Branch-Id=all -> 403', prAll.status === 403 && prAll.data && prAll.data.code === 'branch_required', `status=${prAll.status} body=${JSON.stringify(prAll.data)}`);

    const prOk = await request(BASE, '/api/data/payrolls', { method: 'POST', session: su, headers: { 'X-Branch-Id': 'br-1' }, body: [{ id: 'pb-1', companyId: 'comp-1', branchId: 'br-1', status: 'draft', month: '2026-09', items: [] }] });
    ok('P-3. payroll write WITH valid branch -> 200 (control)', prOk.status === 200, `status=${prOk.status} body=${JSON.stringify(prOk.data)}`);
  } finally {
    await stopServer(server);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }

  console.log(`\n=== P14 deleted_records super-write regression: ${passed} passed, ${failed} failed ===`);
  if (failed) { console.log('FAILURES:'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
