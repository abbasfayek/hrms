// P10-2 — Security & Integrity Deep Audit Test Suite.
// Comprehensive automated security tests covering:
//   1. IDOR/BOLA (Cross-company & Cross-branch isolation)
//   2. Header, Query, and Body Spoofing
//   3. Privilege Escalation & Admin Gating
//   4. Password & Hash Lifecycle (masking, preservation, upgrade)
//   5. Audit Trail Integrity & Fail-Closed Scoping
//   6. Backup, Restore, Import & Export
//   7. Atomicity & Partial Write Prevention
//   8. Concurrency & Race Conditions
//   9. Error Information Leakage
//  10. Legacy, Bypass & Static Surface Scan
//
// Harness: boots REAL server.js on throwaway TEMP COPIES of the application.
// Never modifies real data/ directory.
// Each phase runs in a fresh isolated temporary environment.
//
// Run: node scripts/p10-2-tests.mjs

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import net from 'net';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    console.log(`  FAIL  ${name}${extra ? ` (${extra})` : ''}`);
  }
}

const SCOPED_PW = 'SecretPass-102';
const SUPER_PW = 'SystemMasterSecret!';

// ---------------------------------------------------------------- helpers
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

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

function writeJSON(tmp, file, data) {
  fs.writeFileSync(path.join(tmp, 'data', file), JSON.stringify(data, null, 2), 'utf-8');
}

function makeTmpApp() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-p102-'));
  const copySync = (from, to) => fs.cpSync(from, to, { recursive: true });
  for (const f of ['server.js', 'index.html', 'server-authz.mjs']) {
    fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  }
  copySync(path.join(ROOT, 'public'), path.join(tmp, 'public'));
  copySync(path.join(ROOT, 'data'), path.join(tmp, 'data'));
  return tmp;
}

function seedFixture(tmp) {
  // Companies fixture: comp-1 (existing) + comp-2
  const companies = readJSON(tmp, 'companies.json') || [];
  const c1 = companies.find(c => c.id === 'comp-1') || {
    id: 'comp-1', nameAr: 'الشركة الأولى', nameEn: 'First Co.',
    branches: [
      { id: 'br-1', companyId: 'comp-1', nameAr: 'فرع رئيسي', nameEn: 'Main Branch' },
      { id: 'br-1b', companyId: 'comp-1', nameAr: 'فرع ثاني', nameEn: 'Branch 1B' },
    ],
  };
  const c2 = {
    id: 'comp-2', nameAr: 'الشركة الثانية', nameEn: 'Second Co.', code: 'C2',
    currency: 'USD', currencySymbol: '$', commercialRegistration: '123456', taxNumber: '987654',
    branches: [
      { id: 'br-2a', companyId: 'comp-2', nameAr: 'فرع 2-أ', nameEn: 'Branch 2A', payDay: 1, branchType: 'main' },
      { id: 'br-2b', companyId: 'comp-2', nameAr: 'فرع 2-ب', nameEn: 'Branch 2B', payDay: 15, branchType: 'main' },
    ],
    hourlyLeaveQuota: 4,
  };
  writeJSON(tmp, 'companies.json', [c1, c2]);

  // Employees fixture
  const employees = [
    { id: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', employeeNumber: 'EMP-C1-1', fullName: 'Emp 1 Main', basicSalary: 6000, status: 'active', updatedAt: new Date().toISOString() },
    { id: 'emp-c1-2', companyId: 'comp-1', branchId: 'br-1b', employeeNumber: 'EMP-C1-2', fullName: 'Emp 1 BranchB', basicSalary: 5500, status: 'active', updatedAt: new Date().toISOString() },
    { id: 'emp-c2-1', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'EMP-C2-1', fullName: 'Emp 2 BranchA', basicSalary: 7000, status: 'active', updatedAt: new Date().toISOString() },
    { id: 'emp-c2-2', companyId: 'comp-2', branchId: 'br-2b', employeeNumber: 'EMP-C2-2', fullName: 'Emp 2 BranchB', basicSalary: 6500, status: 'active', updatedAt: new Date().toISOString() },
  ];
  writeJSON(tmp, 'employees.json', employees);

  // Users fixture: system (super_admin) + scoped users + a legacy plaintext user
  const users = [
    { id: 'usr-system', username: 'system', name: 'مدير النظام', role: 'super_admin', assignedCompanyId: 'all', assignedBranchId: 'all', email: 'system@test.local', password: hashPassword(SUPER_PW), protected: true, hidden: true },
    { id: 'u-c1-hr', username: 'c1-hr', name: 'HR Comp1', role: 'company_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'all', email: 'c1hr@test.local', password: hashPassword(SCOPED_PW), protected: false },
    { id: 'u-c2-hr', username: 'c2-hr', name: 'HR Comp2', role: 'company_hr', assignedCompanyId: 'comp-2', assignedBranchId: 'all', email: 'c2hr@test.local', password: hashPassword(SCOPED_PW), protected: false },
    { id: 'u-c1b-hr', username: 'c1b-hr', name: 'HR C1 BranchB', role: 'branch_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'br-1b', email: 'c1bhr@test.local', password: hashPassword(SCOPED_PW), protected: false },
    { id: 'u-c2-pay', username: 'c2-pay', name: 'PayComp2', role: 'payroll_admin', assignedCompanyId: 'comp-2', assignedBranchId: 'all', email: 'c2pay@test.local', password: hashPassword(SCOPED_PW), protected: false },
    { id: 'u-c1-audit', username: 'c1-audit', name: 'AudComp1', role: 'audit_reviewer', assignedCompanyId: 'comp-1', assignedBranchId: 'br-1', email: 'c1aud@test.local', password: hashPassword(SCOPED_PW), protected: false },
    { id: 'u-legacy-plain', username: 'legacy-plain', name: 'Legacy Plain User', role: 'company_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'all', email: 'legacy@test.local', password: 'PlainPassword123!', protected: false },
  ];
  writeJSON(tmp, 'users.json', users);

  // Leaves
  writeJSON(tmp, 'leaves.json', [
    { id: 'lv-c1-1', employeeId: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', leaveType: 'annual', startDate: '2026-09-01', endDate: '2026-09-05', status: 'approved', createdAt: new Date().toISOString() },
    { id: 'lv-c2-1', employeeId: 'emp-c2-1', companyId: 'comp-2', branchId: 'br-2a', leaveType: 'annual', startDate: '2026-09-10', endDate: '2026-09-12', status: 'approved', createdAt: new Date().toISOString() },
  ]);

  // Hourly Leaves
  writeJSON(tmp, 'hourly_leaves.json', [
    { id: 'hl-c1-1', employeeId: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', date: '2026-09-02', hours: 2, status: 'approved', createdAt: new Date().toISOString() },
    { id: 'hl-c2-1', employeeId: 'emp-c2-1', companyId: 'comp-2', branchId: 'br-2a', date: '2026-09-03', hours: 3, status: 'approved', createdAt: new Date().toISOString() },
  ]);

  // Overtime
  writeJSON(tmp, 'overtime.json', [
    { id: 'ot-c1-1', employeeId: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', date: '2026-09-01', hours: 4, createdAt: new Date().toISOString() },
    { id: 'ot-c2-1', employeeId: 'emp-c2-1', companyId: 'comp-2', branchId: 'br-2a', date: '2026-09-02', hours: 2, createdAt: new Date().toISOString() },
  ]);

  // Loans
  writeJSON(tmp, 'loans.json', [
    { id: 'ln-c1-1', employeeId: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', amount: 5000, installments: 5, createdAt: new Date().toISOString() },
    { id: 'ln-c2-1', employeeId: 'emp-c2-1', companyId: 'comp-2', branchId: 'br-2a', amount: 3000, installments: 3, createdAt: new Date().toISOString() },
  ]);

  // Increments
  writeJSON(tmp, 'increments.json', [
    { id: 'inc-c1-1', employeeId: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', amount: 500, effectiveDate: '2026-01-01', createdAt: new Date().toISOString() },
    { id: 'inc-c2-1', employeeId: 'emp-c2-1', companyId: 'comp-2', branchId: 'br-2a', amount: 400, effectiveDate: '2026-01-01', createdAt: new Date().toISOString() },
  ]);

  // Attendance
  writeJSON(tmp, 'attendance.json', [
    { id: 'att-c1-1', employeeId: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', date: '2026-09-01', status: 'present', createdAt: new Date().toISOString() },
    { id: 'att-c1-2', employeeId: 'emp-c1-2', companyId: 'comp-1', branchId: 'br-1b', date: '2026-09-01', status: 'present', createdAt: new Date().toISOString() },
    { id: 'att-c2-1', employeeId: 'emp-c2-1', companyId: 'comp-2', branchId: 'br-2a', date: '2026-09-01', status: 'present', createdAt: new Date().toISOString() },
  ]);

  // Payrolls
  writeJSON(tmp, 'payrolls.json', [
    { id: 'pb-c1', name: 'Payroll C1', status: 'submitted', companyId: 'comp-1', branchId: 'br-1', period: '2026-08', month: '2026-08', items: [{ employeeId: 'emp-c1-1', netSalary: 6000 }], totalNet: 6000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'pb-c2', name: 'Payroll C2', status: 'submitted', companyId: 'comp-2', branchId: 'br-2a', period: '2026-08', month: '2026-08', items: [{ employeeId: 'emp-c2-1', netSalary: 7000 }], totalNet: 7000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ]);

  // EOSB
  writeJSON(tmp, 'eosb.json', [
    { id: 'eosb-c1-1', employeeId: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', totalReward: 15000, createdAt: new Date().toISOString() },
    { id: 'eosb-c2-1', employeeId: 'emp-c2-1', companyId: 'comp-2', branchId: 'br-2a', totalReward: 12000, createdAt: new Date().toISOString() },
  ]);

  // Legacy Audit
  writeJSON(tmp, 'audit.json', [
    { id: 'aud-1', action: 'CREATE_EMPLOYEE', companyId: 'comp-1', branchId: 'br-1', at: new Date().toISOString(), by: 'u-c1-hr' },
    { id: 'aud-2', action: 'CREATE_EMPLOYEE', companyId: 'comp-2', branchId: 'br-2a', at: new Date().toISOString(), by: 'u-c2-hr' },
  ]);

  // Audit Trail (envelope)
  writeJSON(tmp, 'audit_trail.json', {
    schema: 'audit.v1', seq: 3, chainHead: 'h3',
    events: [
      { eventId: 'EV-C1', action: 'PAYROLL_SUBMIT', seq: 1, companyId: 'comp-1', branchId: 'br-1', at: new Date().toISOString(), prevHash: null, hash: 'h1' },
      { eventId: 'EV-C2', action: 'PAYROLL_SUBMIT', seq: 2, companyId: 'comp-2', branchId: 'br-2a', at: new Date().toISOString(), prevHash: 'h1', hash: 'h2' },
      { eventId: 'EV-GL', action: 'SYSTEM_MAINTENANCE', seq: 3, at: new Date().toISOString(), prevHash: 'h2', hash: 'h3' }, // Global event (no companyId)
    ],
  });

  // Deleted Records
  writeJSON(tmp, 'deleted_records.json', [
    { collection: 'employees', data: { id: 'emp-del-c1', companyId: 'comp-1', branchId: 'br-1' } },
    { collection: 'employees', data: { id: 'emp-del-c2', companyId: 'comp-2', branchId: 'br-2a' } },
  ]);

  // Settings
  writeJSON(tmp, 'settings.json', { systemName: 'BenoSoft Global HRMS', allowRegistration: false, version: '1.0.0' });

  // Access token file
  writeJSON(tmp, 'access_token.json', { token: 'MasterTokenSecret123!' });
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
        if (r.status === 200 || r.status === 401) {
          child.serverStdout = out;
          return resolve(child);
        }
      } catch {}
      if (Date.now() > deadline) {
        try { child.kill(); } catch {}
        return reject(new Error('server did not boot: ' + out));
      }
      setTimeout(probe, 250);
    };
    probe();
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    try { child.kill('SIGTERM'); } catch {}
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve();
    }, 2000);
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
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: h,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, data: parsed, rawText: data, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(base, username, password) {
  const r = await api(base, '/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  return r.status === 200 && r.data && r.data.session ? r.data.session : null;
}

async function runPhase(label, fn) {
  console.log(`\n============================================================`);
  console.log(`=== Phase: ${label}`);
  console.log(`============================================================`);
  const tmp = makeTmpApp();
  seedFixture(tmp);
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  let server = null;
  try {
    server = await bootServer(tmp, port);
    const helpers = {
      BASE,
      tmp,
      api: (p, o) => api(BASE, p, o),
      login: (u, pw) => login(BASE, u, pw),
    };
    await fn(helpers);
  } finally {
    if (server) await stopServer(server);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- Test Runner
async function runAllTests() {
  console.log('\n############################################################');
  console.log('### P10-2 Security & Integrity Deep Audit Test Suite       ###');
  console.log('############################################################\n');

  // =========================================================================
  // Section 1: IDOR / BOLA — Cross-Company & Cross-Branch Reads & Writes
  // =========================================================================
  await runPhase('1. IDOR/BOLA - Cross-Company & Cross-Branch Read/Write', async ({ api, login, tmp }) => {
    const admin = await login('system', SUPER_PW);
    const hr1 = await login('c1-hr', SCOPED_PW);
    const hr2 = await login('c2-hr', SCOPED_PW);
    const brHr1b = await login('c1b-hr', SCOPED_PW);
    const pay2 = await login('c2-pay', SCOPED_PW);

    ok('SEC-01-Setup: Test accounts logged in successfully', !!(admin && hr1 && hr2 && brHr1b && pay2));

    // 1.1 Reads Cross-Company
    const collections = [
      { name: 'employees', token: hr2, expectCompany: 'comp-2' },
      { name: 'leaves', token: hr2, expectCompany: 'comp-2' },
      { name: 'hourly_leaves', token: hr2, expectCompany: 'comp-2' },
      { name: 'overtime', token: hr2, expectCompany: 'comp-2' },
      { name: 'loans', token: hr2, expectCompany: 'comp-2' },
      { name: 'increments', token: hr2, expectCompany: 'comp-2' },
      { name: 'attendance', token: hr2, expectCompany: 'comp-2' },
      { name: 'eosb', token: hr2, expectCompany: 'comp-2' },
    ];

    for (const c of collections) {
      const res = await api(`/api/data/${c.name}`, { session: c.token });
      const items = Array.isArray(res.data) ? res.data : [];
      const leaked = items.filter(i => i.companyId && i.companyId !== c.expectCompany);
      ok(`SEC-01-Read-${c.name}: Scoped user sees ONLY ${c.expectCompany} records`,
        res.status === 200 && items.length > 0 && leaked.length === 0,
        `leaked ${leaked.length} items from other company`);

      // Positive control with super_admin: sees all companies
      const saRes = await api(`/api/data/${c.name}`, { session: admin });
      const saItems = Array.isArray(saRes.data) ? saRes.data : [];
      const hasC1 = saItems.some(i => i.companyId === 'comp-1');
      const hasC2 = saItems.some(i => i.companyId === 'comp-2');
      ok(`SEC-01-Read-${c.name}-PositiveControl: super_admin sees records from all companies`,
        saRes.status === 200 && hasC1 && hasC2,
        `hasC1=${hasC1}, hasC2=${hasC2}`);
    }

    // Companies read isolation
    const compRes = await api('/api/data/companies', { session: hr2 });
    const compItems = Array.isArray(compRes.data) ? compRes.data : [];
    ok('SEC-01-Read-companies: company_hr(comp-2) sees ONLY comp-2 company object',
      compRes.status === 200 && compItems.length === 1 && compItems[0].id === 'comp-2',
      `saw companies: ${compItems.map(x => x.id).join(',')}`);

    // Payroll read isolation
    const payRes = await api('/api/data/payrolls', { session: pay2 });
    const payItems = Array.isArray(payRes.data) ? payRes.data : [];
    ok('SEC-01-Read-payrolls: payroll_admin(comp-2) sees ONLY comp-2 payroll batch',
      payRes.status === 200 && payItems.length === 1 && payItems[0].companyId === 'comp-2',
      `saw batches: ${payItems.map(p => p.id).join(',')}`);

    // 1.2 Reads Cross-Branch
    const brEmpRes = await api('/api/data/employees', { session: brHr1b });
    const brEmpItems = Array.isArray(brEmpRes.data) ? brEmpRes.data : [];
    ok('SEC-02-Branch-Read-employees: branch_hr(comp-1/br-1b) sees ONLY br-1b employees',
      brEmpRes.status === 200 && brEmpItems.length === 1 && brEmpItems[0].branchId === 'br-1b',
      `saw ${brEmpItems.length} items: ${brEmpItems.map(e => e.branchId).join(',')}`);

    // Positive control: company_hr(comp-1) sees both br-1 and br-1b
    const c1EmpRes = await api('/api/data/employees', { session: hr1 });
    const c1EmpItems = Array.isArray(c1EmpRes.data) ? c1EmpRes.data : [];
    ok('SEC-02-Branch-Read-PositiveControl: company_hr(comp-1) sees employees of all branches in comp-1',
      c1EmpRes.status === 200 && c1EmpItems.some(e => e.branchId === 'br-1') && c1EmpItems.some(e => e.branchId === 'br-1b'));

    // 1.3 Cross-Company Writes (Negative + Positive + Side-Effect Verification)
    const forgedEmp = {
      id: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', employeeNumber: 'HACKED-C1',
      fullName: 'Hacked Comp1 User', basicSalary: 99999, status: 'active', updatedAt: new Date().toISOString(),
    };
    const empWriteRes = await api('/api/data/employees', { method: 'POST', session: hr2, body: [forgedEmp] });
    ok('SEC-03-CrossCompany-Write-employees: Cross-company employee modification rejected (403)', empWriteRes.status === 403, `status=${empWriteRes.status}`);

    // Side effect verification on disk!
    const diskEmps = readJSON(tmp, 'employees.json') || [];
    const targetEmpOnDisk = diskEmps.find(e => e.id === 'emp-c1-1');
    ok('SEC-03-CrossCompany-Write-SideEffect: Target employee on disk remained untouched',
      targetEmpOnDisk && targetEmpOnDisk.employeeNumber === 'EMP-C1-1' && targetEmpOnDisk.fullName === 'Emp 1 Main',
      `target record on disk: ${JSON.stringify(targetEmpOnDisk)}`);

    // Positive Control: Scoped legitimate write by company_hr(comp-2)
    const legitEmp = {
      id: 'emp-c2-1', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'EMP-C2-1',
      fullName: 'Emp 2 BranchA - Updated', basicSalary: 7500, status: 'active', updatedAt: new Date().toISOString(),
    };
    const legitWriteRes = await api('/api/data/employees', { method: 'POST', session: hr2, headers: { 'X-Branch-Id': 'br-2a' }, body: [legitEmp] });
    ok('SEC-03-Scoped-Write-PositiveControl: Scoped legitimate write succeeds (200)', legitWriteRes.status === 200, `status=${legitWriteRes.status}`);

    // 1.4 Mandatory branch declaration for multi-branch company users
    const legitEmpB = {
      id: 'emp-br-probe', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'BR-PROBE',
      fullName: 'Branch Gate Probe', basicSalary: 7000, status: 'active', updatedAt: new Date().toISOString(),
    };
    const noBranchRes = await api('/api/data/employees', { method: 'POST', session: hr2, body: [legitEmpB] });
    ok('SEC-BR-1-MissingHeader: multi-branch company_hr write without X-Branch-Id rejected (403/branch_required)',
      noBranchRes.status === 403 && noBranchRes.data && noBranchRes.data.code === 'branch_required', `status=${noBranchRes.status} code=${noBranchRes.data && noBranchRes.data.code}`);

    const allBranchRes = await api('/api/data/employees', { method: 'POST', session: hr2, headers: { 'X-Branch-Id': 'all' }, body: [legitEmpB] });
    ok('SEC-BR-1-AllHeader: X-Branch-Id "all" treated as unselected (403/branch_required)',
      allBranchRes.status === 403 && allBranchRes.data && allBranchRes.data.code === 'branch_required', `status=${allBranchRes.status} code=${allBranchRes.data && allBranchRes.data.code}`);

    const foreignBranchRes = await api('/api/data/employees', { method: 'POST', session: hr2, headers: { 'X-Branch-Id': 'br-1' }, body: [legitEmpB] });
    ok('SEC-BR-2-ForeignBranch: branch of another company rejected (403/scope_violation)',
      foreignBranchRes.status === 403 && foreignBranchRes.data && foreignBranchRes.data.code === 'scope_violation', `status=${foreignBranchRes.status} code=${foreignBranchRes.data && foreignBranchRes.data.code}`);

    const ghostBranchRes = await api('/api/data/employees', { method: 'POST', session: hr2, headers: { 'X-Branch-Id': 'br-zz' }, body: [legitEmpB] });
    ok('SEC-BR-3-GhostBranch: non-existent branch rejected (403)',
      ghostBranchRes.status === 403, `status=${ghostBranchRes.status}`);

    const validBranchRes = await api('/api/data/employees', { method: 'POST', session: hr2, headers: { 'X-Branch-Id': 'br-2a' }, body: [legitEmpB] });
    ok('SEC-BR-4-ValidBranch: valid company branch accepted (200)',
      validBranchRes.status === 200, `status=${validBranchRes.status}`);

    // Single-branch users stay auto-scoped (no header needed)
    const brWriteNoHeader = await api('/api/data/employees', { method: 'POST', session: brHr1b, body: [{
      id: 'emp-c1b-x', companyId: 'comp-1', branchId: 'br-1b', employeeNumber: 'EMP-C1B-X',
      fullName: 'Branch Auto Scoped', basicSalary: 8000, status: 'active', updatedAt: new Date().toISOString(),
    }] });
    ok('SEC-BR-5-SingleBranchAuto: single-branch branch_hr write succeeds without header (200)',
      brWriteNoHeader.status === 200, `status=${brWriteNoHeader.status}`);

    const diskEmpsAfter = readJSON(tmp, 'employees.json') || [];
    const legitOnDisk = diskEmpsAfter.find(e => e.id === 'emp-c2-1');
    ok('SEC-03-Scoped-Write-SideEffect: Legitimate update persisted to disk accurately',
      legitOnDisk && legitOnDisk.fullName === 'Emp 2 BranchA - Updated' && legitOnDisk.basicSalary === 7500);

    // Cross-Company Employee Indirection (writing leave for employee of other company)
    const forgedLeave = {
      id: 'lv-forged-1', employeeId: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1',
      startDate: '2026-10-01', endDate: '2026-10-05', leaveType: 'annual', status: 'approved',
    };
    const leaveWriteRes = await api('/api/data/leaves', { method: 'POST', session: hr2, body: [forgedLeave] });
    ok('SEC-04-Indirection-Write-leaves: Leave referencing out-of-scope employee rejected (403)', leaveWriteRes.status === 403, `status=${leaveWriteRes.status}`);

    const diskLeaves = readJSON(tmp, 'leaves.json') || [];
    ok('SEC-04-Indirection-Write-SideEffect: Forged leave was NOT written to disk',
      !diskLeaves.some(l => l.id === 'lv-forged-1'));

    // Cross-Branch Write by branch_hr
    const forgedBranchEmp = {
      id: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', employeeNumber: 'FORGED-BRANCH',
      fullName: 'Forged Branch 1 Emp', basicSalary: 8000, status: 'active', updatedAt: new Date().toISOString(),
    };
    const brWriteRes = await api('/api/data/employees', { method: 'POST', session: brHr1b, body: [forgedBranchEmp] });
    ok('SEC-05-CrossBranch-Write: branch_hr writing to different branch rejected (403)', brWriteRes.status === 403, `status=${brWriteRes.status}`);

    const diskEmpsAfterBr = readJSON(tmp, 'employees.json') || [];
    const empC1_1 = diskEmpsAfterBr.find(e => e.id === 'emp-c1-1');
    ok('SEC-05-CrossBranch-Write-SideEffect: Target branch employee on disk was NOT modified',
      empC1_1 && empC1_1.employeeNumber === 'EMP-C1-1');
  });

  // =========================================================================
  // Section 2: Header, Query & Body Spoofing
  // =========================================================================
  await runPhase('2. Header, Query & Body Spoofing Resistance', async ({ api, login }) => {
    const hr2 = await login('c2-hr', SCOPED_PW);

    // 2.1 Header Spoofing (X-Role, X-Company-Id, X-Permissions, X-User-Id)
    const spoofHeaders = {
      'X-Role': 'super_admin',
      'X-Company-Id': 'all',
      'X-Branch-Id': 'all',
      'X-Permissions': 'users.view,users.manage,settings.manage,companies.manage',
      'X-User-Id': 'usr-system',
    };

    // Attempt to access super_admin endpoint with spoofed headers
    const spoofUsersRes = await api('/api/data/users', { session: hr2, headers: spoofHeaders });
    ok('SEC-06-HeaderSpoof-Users: Spoofed super_admin headers cannot access users endpoint (403)',
      spoofUsersRes.status === 403, `status=${spoofUsersRes.status}`);

    // Attempt to access cross-company data with spoofed headers
    const spoofDataRes = await api('/api/data/employees', { session: hr2, headers: spoofHeaders });
    const spoofItems = Array.isArray(spoofDataRes.data) ? spoofDataRes.data : [];
    const leakedSpoof = spoofItems.filter(e => e.companyId !== 'comp-2');
    ok('SEC-06-HeaderSpoof-Scoping: Spoofed headers cannot expand data scope beyond comp-2',
      spoofDataRes.status === 200 && spoofItems.length > 0 && leakedSpoof.length === 0,
      `saw ${leakedSpoof.length} out of scope items`);

    // 2.2 Query Parameter Spoofing
    const queryRes1 = await api('/api/data/companies?companyId=comp-1&id=comp-1', { session: hr2 });
    const qItems1 = Array.isArray(queryRes1.data) ? queryRes1.data : [];
    ok('SEC-07-QuerySpoof-companies: Query string cannot override company scoping',
      queryRes1.status === 200 && qItems1.length === 1 && qItems1[0].id === 'comp-2',
      `companies=${qItems1.map(c => c.id).join(',')}`);

    const queryRes2 = await api('/api/data/employees?companyId=comp-1&branchId=br-1', { session: hr2 });
    const qItems2 = Array.isArray(queryRes2.data) ? queryRes2.data : [];
    const leakedQuery = qItems2.filter(e => e.companyId !== 'comp-2');
    ok('SEC-07-QuerySpoof-employees: Query string cannot pull employees from another company',
      queryRes2.status === 200 && leakedQuery.length === 0,
      `leaked ${leakedQuery.length} employees`);
  });

  // =========================================================================
  // Section 3: Privilege Escalation & Admin Gating
  // =========================================================================
  await runPhase('3. Privilege Escalation & Admin Gating', async ({ api, login, tmp }) => {
    const admin = await login('system', SUPER_PW);
    const hr2 = await login('c2-hr', SCOPED_PW);

    // 3.1 Self-Promotion / User Manipulation via POST /api/data/users
    const diskUsersBefore = readJSON(tmp, 'users.json');
    const hackedUsers = diskUsersBefore.map(u => (u.id === 'u-c2-hr'
      ? { ...u, role: 'super_admin', assignedCompanyId: 'all', assignedBranchId: 'all' }
      : u));

    const escRes = await api('/api/data/users', { method: 'POST', session: hr2, body: hackedUsers });
    ok('SEC-08-PrivEsc-UsersWrite: Non-super POST /api/data/users rejected (403)', escRes.status === 403, `status=${escRes.status}`);

    const diskUsersAfterEsc = readJSON(tmp, 'users.json');
    const c2UserOnDisk = diskUsersAfterEsc.find(u => u.id === 'u-c2-hr');
    ok('SEC-08-PrivEsc-SideEffect: Target user role on disk was NOT modified',
      c2UserOnDisk && c2UserOnDisk.role === 'company_hr', `role on disk=${c2UserOnDisk?.role}`);

    // Non-super reading /api/data/users
    const readUsersRes = await api('/api/data/users', { session: hr2 });
    ok('SEC-09-AdminGate-UsersRead: Non-super GET /api/data/users rejected (403)', readUsersRes.status === 403, `status=${readUsersRes.status}`);

    // 3.2 Global Settings Protection
    const readSettingsRes = await api('/api/data/settings', { session: hr2 });
    ok('SEC-10-AdminGate-SettingsRead: Non-super GET /api/data/settings rejected (403)', readSettingsRes.status === 403, `status=${readSettingsRes.status}`);

    const writeSettingsRes = await api('/api/data/settings', { method: 'POST', session: hr2, body: { systemName: 'Hacked HRMS' } });
    ok('SEC-10-AdminGate-SettingsWrite: Non-super POST /api/data/settings rejected (403)', writeSettingsRes.status === 403, `status=${writeSettingsRes.status}`);

    const diskSettings = readJSON(tmp, 'settings.json');
    ok('SEC-10-AdminGate-Settings-SideEffect: Settings on disk were NOT modified',
      diskSettings && diskSettings.systemName === 'BenoSoft Global HRMS', `settings on disk=${JSON.stringify(diskSettings)}`);

    // Positive Control for Settings
    const saSetRes = await api('/api/data/settings', { method: 'POST', session: admin, body: { systemName: 'BenoSoft Global HRMS - Valid Update' } });
    ok('SEC-10-Settings-PositiveControl: super_admin can write settings (200)', saSetRes.status === 200, `status=${saSetRes.status}`);
    const diskSettingsUpdated = readJSON(tmp, 'settings.json');
    ok('SEC-10-Settings-PositiveSideEffect: Settings update by super_admin verified on disk',
      diskSettingsUpdated && diskSettingsUpdated.systemName === 'BenoSoft Global HRMS - Valid Update');

    // 3.3 Master Access Token Protection
    const tokenRes = await api('/api/access-token', { method: 'POST', session: hr2, body: { token: 'HackedNewToken123' } });
    ok('SEC-11-AdminGate-AccessToken: Non-super POST /api/access-token rejected (403)', tokenRes.status === 403, `status=${tokenRes.status}`);

    const diskToken = readJSON(tmp, 'access_token.json');
    ok('SEC-11-AdminGate-AccessToken-SideEffect: access_token.json on disk was NOT changed',
      diskToken && diskToken.token === 'MasterTokenSecret123!');

    // 3.4 Deleted Records & Corrections Collections
    const delRes = await api('/api/data/deleted_records', { session: hr2 });
    ok('SEC-12-AdminGate-DeletedRecords: Non-super GET /api/data/deleted_records rejected (403)', delRes.status === 403, `status=${delRes.status}`);

    const delWriteRes = await api('/api/data/deleted_records', {
      method: 'POST', session: hr2,
      body: [{ collection: 'employees', data: { id: 'emp-c1-1', companyId: 'comp-1' } }],
    });
    ok('SEC-12-AdminGate-DeletedRecordsWrite: Non-super POST /api/data/deleted_records rejected (403)', delWriteRes.status === 403, `status=${delWriteRes.status}`);

    const corrRes = await api('/api/data/corrections', { method: 'POST', session: hr2, body: [] });
    ok('SEC-13-AdminGate-Corrections: Non-super POST /api/data/corrections rejected (400 or 403)', corrRes.status === 400 || corrRes.status === 403, `status=${corrRes.status}`);

    // 3.5 Tenant Creation Protection
    const newCoRes = await api('/api/data/companies', {
      method: 'POST', session: hr2,
      body: [{ id: 'comp-evil', nameEn: 'Evil Corp', branches: [] }],
    });
    ok('SEC-14-TenantCreation: company_hr cannot create a new company/tenant (403)', newCoRes.status === 403, `status=${newCoRes.status}`);

    const diskCompanies = readJSON(tmp, 'companies.json') || [];
    ok('SEC-14-TenantCreation-SideEffect: New tenant was NOT added to companies.json',
      !diskCompanies.some(c => c.id === 'comp-evil'));
  });

  // =========================================================================
  // Section 4: Password & Hash Lifecycle
  // =========================================================================
  await runPhase('4. Password & Hash Lifecycle (Masking, Preservation, Upgrade)', async ({ api, login, tmp }) => {
    const admin = await login('system', SUPER_PW);

    // 4.1 Masking on GET /api/data/users
    const usersRes = await api('/api/data/users', { session: admin });
    const usersList = Array.isArray(usersRes.data) ? usersRes.data : [];
    const withPw = usersList.filter(u => 'password' in u);
    ok('SEC-15-PasswordMasking-Users: Password field completely absent from all users in GET /api/data/users',
      usersRes.status === 200 && usersList.length > 0 && withPw.length === 0,
      `found ${withPw.length} users exposing password`);

    // 4.2 Preservation on Write
    // super_admin writes back the masked users array with an update to a non-password field
    const updatedUsers = usersList.map(u => (u.id === 'u-c2-hr' ? { ...u, name: 'HR Comp2 - Renamed' } : u));
    const writeUsersRes = await api('/api/data/users', { method: 'POST', session: admin, body: updatedUsers });
    ok('SEC-16-PasswordPreserve-Write: super_admin write of masked users array allowed (200)', writeUsersRes.status === 200, `status=${writeUsersRes.status}`);

    // Verify on disk: password hash was preserved
    const diskUsersAfter = readJSON(tmp, 'users.json') || [];
    const c2OnDisk = diskUsersAfter.find(u => u.id === 'u-c2-hr');
    ok('SEC-16-PasswordPreserve-DiskCheck: Stored PBKDF2 hash on disk remains intact after write',
      c2OnDisk && typeof c2OnDisk.password === 'string' && c2OnDisk.password.startsWith('pbkdf2$'),
      `password in disk: ${c2OnDisk?.password}`);

    // Verify user can still log in!
    const relogin = await login('c2-hr', SCOPED_PW);
    ok('SEC-16-PasswordPreserve-LoginProof: User can still log in with original password', !!relogin);

    // 4.3 Protected System Account Deletion Prevention
    // Send a payload that intentionally omits 'usr-system'
    const withoutSystem = usersList.filter(u => u.id !== 'usr-system');
    const deleteAttemptRes = await api('/api/data/users', { method: 'POST', session: admin, body: withoutSystem });
    ok('SEC-17-ProtectedAccount-WriteResponse: Write omitting protected account processed', deleteAttemptRes.status === 200);

    const diskUsersAfterDelete = readJSON(tmp, 'users.json') || [];
    const systemOnDisk = diskUsersAfterDelete.find(u => u.id === 'usr-system');
    ok('SEC-17-ProtectedAccount-PreservedOnDisk: Protected system account was NOT deleted from disk',
      systemOnDisk && systemOnDisk.protected === true,
      `system account present=${!!systemOnDisk}`);

    // 4.4 Plaintext Password Upgrade on Login
    // 'legacy-plain' was seeded with plaintext 'PlainPassword123!'
    const diskUsersBeforeLogin = readJSON(tmp, 'users.json') || [];
    const plainBefore = diskUsersBeforeLogin.find(u => u.username === 'legacy-plain');
    ok('SEC-18-HashUpgrade-InitialState: Initial user password is raw plaintext',
      plainBefore && plainBefore.password === 'PlainPassword123!');

    const legacySession = await login('legacy-plain', 'PlainPassword123!');
    ok('SEC-18-HashUpgrade-LoginSuccess: Legacy user logged in successfully', !!legacySession);

    const diskUsersAfterLogin = readJSON(tmp, 'users.json') || [];
    const plainAfter = diskUsersAfterLogin.find(u => u.username === 'legacy-plain');
    ok('SEC-18-HashUpgrade-UpgradedToHash: Password on disk automatically upgraded to PBKDF2 hash',
      plainAfter && plainAfter.password.startsWith('pbkdf2$'),
      `stored password: ${plainAfter?.password}`);

    // Subsequent login works with upgraded hash
    const legacySession2 = await login('legacy-plain', 'PlainPassword123!');
    ok('SEC-18-HashUpgrade-SubsequentLogin: Login with upgraded hash succeeds', !!legacySession2);
  });

  // =========================================================================
  // Section 5: Audit Trail Integrity & Fail-Closed Scoping
  // =========================================================================
  await runPhase('5. Audit Trail Integrity & Fail-Closed Scoping', async ({ api, login, tmp }) => {
    const admin = await login('system', SUPER_PW);
    const aud1 = await login('c1-audit', SCOPED_PW);
    const hr2 = await login('c2-hr', SCOPED_PW);

    // 5.1 Scoped Audit Trail Read
    const trailRes = await api('/api/data/audit_trail', { session: aud1 });
    const events = (trailRes.data && Array.isArray(trailRes.data.events)) ? trailRes.data.events : [];
    const leakedComp = events.filter(e => e.companyId !== 'comp-1');
    const leakedGlobal = events.filter(e => !e.companyId);

    ok('SEC-19-AuditTrail-ScopedRead: audit_reviewer(comp-1) sees ONLY comp-1 audit events',
      trailRes.status === 200 && events.length === 1 && events[0].eventId === 'EV-C1' && leakedComp.length === 0,
      `saw events: ${events.map(e => e.eventId).join(',')}`);

    ok('SEC-19-AuditTrail-FailClosedGlobal: Global events without companyId are hidden from scoped reviewer (fail-closed)',
      leakedGlobal.length === 0,
      `leaked global events: ${leakedGlobal.map(e => e.eventId).join(',')}`);

    // Positive Control: super_admin sees all events including global
    const saTrailRes = await api('/api/data/audit_trail', { session: admin });
    const saEvents = (saTrailRes.data && Array.isArray(saTrailRes.data.events)) ? saTrailRes.data.events : [];
    ok('SEC-19-AuditTrail-PositiveControl: super_admin sees comp-1, comp-2, and global system events',
      saTrailRes.status === 200 && saEvents.length === 3 &&
      saEvents.some(e => e.eventId === 'EV-C1') &&
      saEvents.some(e => e.eventId === 'EV-C2') &&
      saEvents.some(e => e.eventId === 'EV-GL'));

    // Legacy Audit scoping
    const legRes = await api('/api/data/audit', { session: aud1 });
    const legItems = Array.isArray(legRes.data) ? legRes.data : [];
    ok('SEC-20-LegacyAudit-ScopedRead: Legacy audit returns only comp-1 items',
      legRes.status === 200 && legItems.every(i => i.companyId === 'comp-1'));

    // 5.2 Tampering / Writing Audit Trail
    const writeTrailRes = await api('/api/data/audit_trail', {
      method: 'POST', session: hr2,
      body: { events: [{ eventId: 'EV-HACK', action: 'FORGED_AUDIT', at: new Date().toISOString() }] },
    });
    ok('SEC-21-AuditTrail-WriteDenied: Non-super write to audit_trail rejected (403)', writeTrailRes.status === 403, `status=${writeTrailRes.status}`);

    const diskTrail = readJSON(tmp, 'audit_trail.json');
    ok('SEC-21-AuditTrail-SideEffect: audit_trail.json on disk was NOT modified',
      diskTrail && diskTrail.events.length === 3 && !diskTrail.events.some(e => e.eventId === 'EV-HACK'));

    const writeLegRes = await api('/api/data/audit', {
      method: 'POST', session: hr2,
      body: [{ id: 'aud-hack', action: 'FORGED_AUDIT', companyId: 'comp-1' }],
    });
    ok('SEC-22-LegacyAudit-WriteDenied: Non-super write to legacy audit rejected (403)', writeLegRes.status === 403, `status=${writeLegRes.status}`);

    const diskLeg = readJSON(tmp, 'audit.json');
    ok('SEC-22-LegacyAudit-SideEffect: audit.json on disk was NOT modified',
      Array.isArray(diskLeg) && diskLeg.length === 2 && !diskLeg.some(a => a.id === 'aud-hack'));
  });

  // =========================================================================
  // Section 6: Backup, Restore, Import & Export
  // =========================================================================
  await runPhase('6. Backup, Restore, Import & Export', async ({ api, login, tmp }) => {
    const admin = await login('system', SUPER_PW);
    const hr2 = await login('c2-hr', SCOPED_PW);

    // 6.1 Backup
    const backupDenyRes = await api('/api/backup', { session: hr2 });
    ok('SEC-23-Backup-Denied: Non-super backup request rejected (403)', backupDenyRes.status === 403, `status=${backupDenyRes.status}`);

    const backupRes = await api('/api/backup', { session: admin });
    ok('SEC-23-Backup-PositiveControl: super_admin backup request succeeds (200)', backupRes.status === 200, `status=${backupRes.status}`);

    const backupData = typeof backupRes.data === 'object' ? backupRes.data : {};
    const backupUsers = Array.isArray(backupData.users) ? backupData.users : [];
    const backupHasPw = backupUsers.some(u => 'password' in u);
    ok('SEC-23-Backup-NoPasswords: User password hashes are masked/omitted in backup JSON',
      backupUsers.length > 0 && !backupHasPw,
      `found ${backupUsers.filter(u => 'password' in u).length} users with password in backup`);

    // 6.2 Restore
    const restoreDenyRes = await api('/api/restore', {
      method: 'POST', session: hr2,
      body: { settings: { systemName: 'Wiped by Attacker' } },
    });
    ok('SEC-24-Restore-Denied: Non-super restore request rejected (403)', restoreDenyRes.status === 403, `status=${restoreDenyRes.status}`);

    const diskSettingsBeforeRestore = readJSON(tmp, 'settings.json');
    ok('SEC-24-Restore-SideEffect: Settings on disk were NOT replaced by unauthorized restore',
      diskSettingsBeforeRestore && diskSettingsBeforeRestore.systemName === 'BenoSoft Global HRMS');

    const restorePositiveRes = await api('/api/restore', {
      method: 'POST', session: admin,
      body: { settings: { systemName: 'Restored BenoSoft HRMS', version: '2.0.0' } },
    });
    ok('SEC-24-Restore-PositiveControl: super_admin restore request succeeds (200)', restorePositiveRes.status === 200, `status=${restorePositiveRes.status}`);

    const diskSettingsAfterRestore = readJSON(tmp, 'settings.json');
    ok('SEC-24-Restore-PositiveSideEffect: Restored settings successfully persisted to disk',
      diskSettingsAfterRestore && diskSettingsAfterRestore.systemName === 'Restored BenoSoft HRMS');

    // 6.3 Import Employees (Append mode - cross company vs valid)
    const badImportPayload = {
      mode: 'append',
      employees: [
        { id: 'imp-bad-1', companyId: 'comp-1', branchId: 'br-1', employeeNumber: 'IMP-C1-HACK', fullName: 'Imported Hack' },
      ],
    };
    const badImportRes = await api('/api/import-employees', { method: 'POST', session: hr2, body: badImportPayload });
    ok('SEC-25-ImportEmployees-CrossCompany: company_hr importing out-of-scope employee rejected (403)',
      badImportRes.status === 403, `status=${badImportRes.status}`);

    const diskEmpsAfterBadImp = readJSON(tmp, 'employees.json') || [];
    ok('SEC-25-ImportEmployees-SideEffect: Out-of-scope imported employee NOT written to disk',
      !diskEmpsAfterBadImp.some(e => e.employeeNumber === 'IMP-C1-HACK'));

    // Import replace mode denied for non-super
    const replaceImportRes = await api('/api/import-employees', {
      method: 'POST', session: hr2,
      body: { mode: 'replace', employees: [{ id: 'imp-c2-rep', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'IMP-REP' }] },
    });
    ok('SEC-26-ImportEmployees-ReplaceDenied: Import in replace mode rejected for non-super (403)',
      replaceImportRes.status === 403, `status=${replaceImportRes.status}`);

    // Positive Control: Scoped valid import append
    const goodImportPayload = {
      mode: 'append',
      employees: [
        { id: 'imp-c2-good', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'IMP-C2-GOOD', fullName: 'Imported Good C2', basicSalary: 8000, status: 'active' },
      ],
    };
    const goodImportRes = await api('/api/import-employees', { method: 'POST', session: hr2, headers: { 'X-Branch-Id': 'br-2a' }, body: goodImportPayload });
    ok('SEC-25-ImportEmployees-PositiveControl: Valid scoped import append succeeds (200)',
      goodImportRes.status === 200, `status=${goodImportRes.status}`);

    const diskEmpsAfterGoodImp = readJSON(tmp, 'employees.json') || [];
    ok('SEC-25-ImportEmployees-PositiveSideEffect: Valid imported employee found on disk',
      diskEmpsAfterGoodImp.some(e => e.employeeNumber === 'IMP-C2-GOOD'));

    // REG-01: Multi-tenant collision safety in append mode.
    // comp-2 HR imports an employee whose employeeNumber matches an existing comp-1 employee ('EMP-C1-1').
    // The comp-1 employee MUST NOT be overwritten or modified.
    const collisionImportPayload = {
      mode: 'append',
      employees: [
        { id: 'emp-c2-coll', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'EMP-C1-1', fullName: 'Comp2 Collision Emp', basicSalary: 4444, status: 'active' },
      ],
    };
    const collisionRes = await api('/api/import-employees', { method: 'POST', session: hr2, headers: { 'X-Branch-Id': 'br-2a' }, body: collisionImportPayload });
    ok('REG-01-ImportCollision-Allowed: Scoped import with duplicate employeeNumber in different company allowed',
      collisionRes.status === 200, `status=${collisionRes.status}`);

    const diskEmpsAfterCollision = readJSON(tmp, 'employees.json') || [];
    const comp1Target = diskEmpsAfterCollision.find(e => e.companyId === 'comp-1' && e.employeeNumber === 'EMP-C1-1');
    const comp2Target = diskEmpsAfterCollision.find(e => e.companyId === 'comp-2' && e.employeeNumber === 'EMP-C1-1');
    ok('REG-01-ImportCollision-ZeroPollution: Other company employee record untouched on disk',
      comp1Target && comp1Target.fullName === 'Emp 1 Main' && comp1Target.basicSalary === 6000,
      `comp-1 emp on disk: ${JSON.stringify(comp1Target)}`);
    ok('REG-01-ImportCollision-ScopedAdded: Caller company employee added correctly on disk',
      comp2Target && comp2Target.fullName === 'Comp2 Collision Emp' && comp2Target.basicSalary === 4444);

    // 6.4 Download Template (Public endpoint)
    const tmplRes = await api('/api/download-template?lang=ar');
    ok('SEC-27-DownloadTemplate-Public: GET /api/download-template returns 200 without authentication',
      tmplRes.status === 200 && tmplRes.rawText.includes('بيانات الموظفين'),
      `status=${tmplRes.status}`);
  });

  // =========================================================================
  // Section 7: Atomicity & Partial Write Prevention
  // =========================================================================
  await runPhase('7. Atomicity & Partial Write Prevention', async ({ api, login, tmp }) => {
    const hr2 = await login('c2-hr', SCOPED_PW);
    const pay2 = await login('c2-pay', SCOPED_PW);

    // 7.1 Mixed Employees Payload (1 valid comp-2 record + 1 forged comp-1 record)
    const mixedEmployees = [
      { id: 'emp-c2-new-valid', companyId: 'comp-2', branchId: 'br-2a', employeeNumber: 'C2-VALID-NEW', fullName: 'Valid C2 New', basicSalary: 5000, status: 'active', updatedAt: new Date().toISOString() },
      { id: 'emp-c1-forged', companyId: 'comp-1', branchId: 'br-1', employeeNumber: 'C1-FORGED', fullName: 'Forged C1 Emp', basicSalary: 9000, status: 'active', updatedAt: new Date().toISOString() },
    ];

    const mixedEmpRes = await api('/api/data/employees', { method: 'POST', session: hr2, body: mixedEmployees });
    ok('SEC-28-Atomicity-Employees-Rejected: Mixed-scope payload rejected atomically (403)',
      mixedEmpRes.status === 403, `status=${mixedEmpRes.status}`);

    // Verify side effect: NEITHER record must be written
    const diskEmps = readJSON(tmp, 'employees.json') || [];
    const validFound = diskEmps.some(e => e.id === 'emp-c2-new-valid' || e.employeeNumber === 'C2-VALID-NEW');
    const forgedFound = diskEmps.some(e => e.id === 'emp-c1-forged' || e.employeeNumber === 'C1-FORGED');
    ok('SEC-28-Atomicity-Employees-NoPartialWrite: Zero partial writes on disk (valid record was NOT saved)',
      !validFound && !forgedFound,
      `validFound=${validFound}, forgedFound=${forgedFound}`);

    // 7.2 Mixed Leaves Payload (1 valid + 1 invalid employeeId)
    const mixedLeaves = [
      { id: 'lv-valid-c2', employeeId: 'emp-c2-1', companyId: 'comp-2', branchId: 'br-2a', leaveType: 'annual', startDate: '2026-11-01', endDate: '2026-11-03' },
      { id: 'lv-forged-c1', employeeId: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1', leaveType: 'annual', startDate: '2026-11-01', endDate: '2026-11-03' },
    ];
    const mixedLeaveRes = await api('/api/data/leaves', { method: 'POST', session: hr2, body: mixedLeaves });
    ok('SEC-29-Atomicity-Leaves-Rejected: Mixed-scope leaves payload rejected (403)',
      mixedLeaveRes.status === 403, `status=${mixedLeaveRes.status}`);

    const diskLeaves = readJSON(tmp, 'leaves.json') || [];
    ok('SEC-29-Atomicity-Leaves-NoPartialWrite: Neither leave record was saved to disk',
      !diskLeaves.some(l => l.id === 'lv-valid-c2' || l.id === 'lv-forged-c1'));

    // 7.3 Mixed Payroll Items Batch
    const mixedPayrollBatch = [
      {
        id: 'pb-c2-mixed', name: 'Mixed Batch', status: 'submitted',
        companyId: 'comp-2', branchId: 'br-2a', period: '2026-09', month: '2026-09',
        items: [
          { employeeId: 'emp-c2-1', netSalary: 7000 },
          { employeeId: 'emp-c1-1', netSalary: 6000 }, // out of scope employee!
        ],
        totalNet: 13000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    ];
    const mixedPayRes = await api('/api/data/payrolls', { method: 'POST', session: pay2, body: mixedPayrollBatch });
    ok('SEC-30-Atomicity-Payroll-Rejected: Payroll batch referencing an out-of-scope employee rejected (403)',
      mixedPayRes.status === 403, `status=${mixedPayRes.status}`);

    const diskPayrolls = readJSON(tmp, 'payrolls.json') || [];
    ok('SEC-30-Atomicity-Payroll-NoPartialWrite: Invalid payroll batch was NOT saved to disk',
      !diskPayrolls.some(p => p.id === 'pb-c2-mixed'));
  });

  // =========================================================================
  // Section 8: Concurrency & Race Conditions
  // =========================================================================
  await runPhase('8. Concurrency & Race Conditions', async ({ api, login, tmp }) => {
    // 8.1 Concurrent Parallel Logins for the Same User
    const loginPromises = [];
    for (let i = 0; i < 10; i++) {
      loginPromises.push(login('c2-hr', SCOPED_PW));
    }
    const loginResults = await Promise.all(loginPromises);
    const validTokens = loginResults.filter(Boolean);
    const uniqueTokens = new Set(validTokens);
    ok('SEC-31-Concurrent-Logins: 10 parallel logins all succeed and receive distinct sessions',
      validTokens.length === 10 && uniqueTokens.size === 10,
      `valid=${validTokens.length}, unique=${uniqueTokens.size}`);

    // Verify all 10 tokens work independently
    const checkPromises = validTokens.map(tok => api('/api/data/employees', { session: tok }));
    const checkResults = await Promise.all(checkPromises);
    ok('SEC-31-Concurrent-SessionTokensActive: All parallel issued sessions are immediately usable',
      checkResults.every(r => r.status === 200));

    // 8.2 Concurrent Valid Writes to the Same Collection (Merge semantics)
    const token = validTokens[0];
    const writePromises = [];
    for (let i = 0; i < 5; i++) {
      const payload = [{
        id: `emp-c2-conc-${i}`, companyId: 'comp-2', branchId: 'br-2a',
        employeeNumber: `C2-CONC-${i}`, fullName: `Concurrent Emp ${i}`,
        basicSalary: 5000 + i * 100, status: 'active', updatedAt: new Date(Date.now() + i * 100).toISOString(),
      }];
      writePromises.push(api('/api/data/employees', { method: 'POST', session: token, headers: { 'X-Branch-Id': 'br-2a' }, body: payload }));
    }
    const writeResults = await Promise.all(writePromises);
    ok('SEC-32-Concurrent-Writes-Status: All 5 parallel writes succeed with 200',
      writeResults.every(r => r.status === 200));

    const diskEmps = readJSON(tmp, 'employees.json') || [];
    const concFound = [0, 1, 2, 3, 4].filter(i => diskEmps.some(e => e.id === `emp-c2-conc-${i}`));
    ok('SEC-32-Concurrent-Writes-Integrity: All 5 concurrently written records exist on disk without data loss',
      concFound.length === 5,
      `found ${concFound.length}/5 concurrent records`);

    // 8.3 Concurrent Cross-Company Write Attacks
    const attackPromises = [];
    for (let i = 0; i < 5; i++) {
      const badPayload = [{
        id: 'emp-c1-1', companyId: 'comp-1', branchId: 'br-1',
        employeeNumber: `HACK-CONC-${i}`, fullName: `Hacked Conc ${i}`,
      }];
      attackPromises.push(api('/api/data/employees', { method: 'POST', session: token, body: badPayload }));
    }
    const attackResults = await Promise.all(attackPromises);
    ok('SEC-33-Concurrent-Attacks-AllRejected: All 5 concurrent cross-company write attempts rejected (403)',
      attackResults.every(r => r.status === 403));

    const diskEmpsAfterAttack = readJSON(tmp, 'employees.json') || [];
    const targetComp1Emp = diskEmpsAfterAttack.find(e => e.id === 'emp-c1-1');
    ok('SEC-33-Concurrent-Attacks-ZeroSideEffects: Target record remained pristine on disk during attack wave',
      targetComp1Emp && targetComp1Emp.employeeNumber === 'EMP-C1-1');
  });

  // =========================================================================
  // Section 9: Error Information Leakage
  // =========================================================================
  await runPhase('9. Error Information Leakage', async ({ api, login }) => {
    const hr2 = await login('c2-hr', SCOPED_PW);

    // 9.1 Test 401 response
    const unauthRes = await api('/api/data/employees', { session: 'bad-or-expired-session' });
    const raw401 = unauthRes.rawText;
    ok('SEC-34-ErrorLeak-401: 401 error response does not leak stack traces or server paths',
      !raw401.includes('node_modules') && !raw401.includes('server.js:') && !raw401.includes('C:\\') && !raw401.includes('/home/'),
      `body: ${raw401}`);

    // 9.2 Test 403 Forbidden response (accessing /api/data/users)
    const forbidRes = await api('/api/data/users', { session: hr2 });
    const raw403 = forbidRes.rawText;
    ok('SEC-35-ErrorLeak-403: 403 error response does not leak user emails, hashes or file paths',
      !raw403.includes('@') && !raw403.includes('pbkdf2') && !raw403.includes('data/users.json') && !raw403.includes('C:\\'),
      `body: ${raw403}`);

    // 9.3 Test Scope Violation 403 response
    const badWriteRes = await api('/api/data/employees', {
      method: 'POST', session: hr2, headers: { 'X-Branch-Id': 'br-2a' },
      body: [{ id: 'emp-c1-1', companyId: 'comp-1', employeeNumber: 'HACK' }],
    });
    const scopeErr = typeof badWriteRes.data === 'object' ? badWriteRes.data : {};
    ok('SEC-36-ErrorLeak-ScopeViolation: Scope violation error only reveals recordId without leaking other tenant names or internals',
      scopeErr.code === 'scope_violation' && !JSON.stringify(scopeErr).includes('الشركة الأولى') && !JSON.stringify(scopeErr).includes('First Co.'),
      `error payload: ${JSON.stringify(scopeErr)}`);

    // 9.4 Test 400 Bad Request error response
    const badReqRes = await api('/api/data/not_a_real_collection', { session: hr2 });
    const raw400 = badReqRes.rawText;
    ok('SEC-37-ErrorLeak-400: 400 response for invalid collection is clean and contains no internal paths',
      !raw400.includes('C:\\') && !raw400.includes('/home/') && !raw400.includes('stack'),
      `body: ${raw400}`);
  });

  // =========================================================================
  // Section 10: Legacy, Bypass & Static Surface Scan
  // =========================================================================
  await runPhase('10. Legacy, Bypass & Static Surface Scan', async ({ api, login, BASE }) => {
    const hr2 = await login('c2-hr', SCOPED_PW);

    // 10.1 Static File Protection: Cannot read data/ directly
    const staticDataUsers = await api('/data/users.json');
    ok('SEC-38-StaticSurface-DataUsers: Direct HTTP GET /data/users.json blocked (403/404)',
      staticDataUsers.status === 403 || staticDataUsers.status === 404,
      `status=${staticDataUsers.status}`);

    const staticCompanies = await api('/data/companies.json');
    ok('SEC-38-StaticSurface-Companies: Direct HTTP GET /data/companies.json blocked (403/404)',
      staticCompanies.status === 403 || staticCompanies.status === 404,
      `status=${staticCompanies.status}`);

    const staticServerJs = await api('/server.js');
    ok('SEC-38-StaticSurface-ServerJs: Direct HTTP GET /server.js blocked (403/404)',
      staticServerJs.status === 403 || staticServerJs.status === 404,
      `status=${staticServerJs.status}`);

    // Path traversal attempt via public directory
    const traversalRes = await api('/public/../data/users.json');
    ok('SEC-39-StaticSurface-PathTraversal: Directory traversal ../data/users.json blocked (403/404)',
      traversalRes.status === 403 || traversalRes.status === 404,
      `status=${traversalRes.status}`);

    // 10.2 Unsupported HTTP Methods on Data Endpoints
    const putRes = await api('/api/data/employees', { method: 'PUT', session: hr2, body: [] });
    ok('SEC-40-HTTPMethods-PUT: PUT method on /api/data/employees rejected (404/405)',
      putRes.status === 404 || putRes.status === 405,
      `status=${putRes.status}`);

    const delMethodRes = await api('/api/data/employees', { method: 'DELETE', session: hr2 });
    ok('SEC-40-HTTPMethods-DELETE: DELETE method on /api/data/employees rejected (404/405)',
      delMethodRes.status === 404 || delMethodRes.status === 405,
      `status=${delMethodRes.status}`);

    // 10.3 URL Variations: Trailing slash, case sensitivity, null bytes
    const trailingSlashRes = await api('/api/data/companies/', { session: hr2 });
    ok('SEC-41-URL-TrailingSlash: URL with trailing slash does not bypass scoping (only comp-2 returned or clean 404/400)',
      (trailingSlashRes.status === 400 || trailingSlashRes.status === 404) ||
      (trailingSlashRes.status === 200 && Array.isArray(trailingSlashRes.data) && trailingSlashRes.data.length === 1 && trailingSlashRes.data[0].id === 'comp-2'),
      `status=${trailingSlashRes.status}`);

    const caseRes = await api('/api/Data/Employees', { session: hr2 });
    ok('SEC-41-URL-CaseSensitivity: Uppercase /api/Data/Employees rejected cleanly (400/404)',
      caseRes.status === 400 || caseRes.status === 404,
      `status=${caseRes.status}`);

    // 10.4 GET with Body
    const getWithBodyRes = await api('/api/data/employees', {
      method: 'GET', session: hr2,
      body: { companyId: 'comp-1', branchId: 'all' },
    });
    const gwBodyItems = Array.isArray(getWithBodyRes.data) ? getWithBodyRes.data : [];
    const leakedGwBody = gwBodyItems.filter(e => e.companyId !== 'comp-2');
    ok('SEC-42-GETWithBody: Body in GET request completely ignored, user remains strictly scoped to comp-2',
      getWithBodyRes.status === 200 && gwBodyItems.length > 0 && leakedGwBody.length === 0,
      `leaked ${leakedGwBody.length} records`);

    // 10.5 Gate Session Separation (gate token cannot query data)
    // Create a gate session by exchanging master access token
    // In server.js, /api/auth/session exchanges master token for gate session
    const gateExchangeRes = await api('/api/auth/session', {
      method: 'POST',
      headers: { 'X-Access-Token': 'MasterTokenSecret123!' },
    });
    const gateSessionToken = gateExchangeRes.data?.session;

    ok('REG-03-GateSession-ExchangeSuccess: Master access token exchanged for gate session without user session',
      gateExchangeRes.status === 200 && typeof gateSessionToken === 'string' && gateSessionToken.length > 0,
      `status=${gateExchangeRes.status}`);

    const gateDataAttempt = await api('/api/data/employees', { session: gateSessionToken });
    ok('SEC-43-GateSession-CannotAccessData: Gate session token cannot be used to query user data endpoints (401)',
      gateDataAttempt.status === 401,
      `status=${gateDataAttempt.status}`);
  });

  // =========================================================================
  // Final Evaluation
  // =========================================================================
  console.log(`\n${'#'.repeat(64)}`);
  console.log(`P10-2 Deep Audit Results: ${passed} passed, ${failed} failed`);
  console.log(`${'#'.repeat(64)}\n`);

  if (failed > 0) {
    console.log('FAILURES ENCOUNTERED:');
    for (const f of failures) {
      console.log(`  ❌ ${f}`);
    }
    process.exit(1);
  }

  console.log('🎉 ALL P10-2 SECURITY & INTEGRITY AUDIT TESTS PASSED SUCCESSFULLY!\n');
  process.exit(0);
}

runAllTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
