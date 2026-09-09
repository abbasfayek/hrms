// Part B helper for the HRMS release gate test.
// Boots the REAL server.js on a throwaway TEMP COPY of the app and verifies:
//   - anonymous data access is rejected (401)
//   - wrong login is rejected (401)
//   - login with POST-migration hashed credentials succeeds and returns a
//     session, an expiry, and a user WITHOUT the password field
//   - a valid session unlocks data reads
//   - the CORS allowlist is enforced (allowed origin gets ACAO, others do not)
//   - /api/backup and /api/restore work under a session
//   - data survives a server restart, and login still works after restart
//
// Factory passwords are read at RUNTIME from the migration backup and are
// never printed.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

export async function runPartB({ ROOT, ok, PORT }) {
  console.log('\n=== Part B — Live server integration (temp copy) ===');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-release-'));
  const copySync = (from, to) => fs.cpSync(from, to, { recursive: true });
  for (const f of ['server.js', 'index.html']) fs.copyFileSync(path.join(ROOT, f), path.join(tmpDir, f));
  copySync(path.join(ROOT, 'public'), path.join(tmpDir, 'public'));
  copySync(path.join(ROOT, 'data'), path.join(tmpDir, 'data'));
  const BASE = `http://localhost:${PORT}`;

  function bootServer() {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['server.js'], {
        cwd: tmpDir,
        env: { ...process.env, PORT: String(PORT), CORS_ALLOWLIST: 'http://allowed.test' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      const deadline = Date.now() + 15000;
      const probe = async () => {
        try {
          const r = await fetch(`${BASE}/api/status`);
          if (r.status === 200 || r.status === 401) {
            child.serverStdout = out;
            return resolve(child);
          }
        } catch {}
        if (Date.now() > deadline) { try { child.kill(); } catch {} return reject(new Error('server did not boot: ' + out)); }
        setTimeout(probe, 300);
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

  // Read the "system" factory password from the migration backup (runtime only).
  function readFactoryCreds() {
    const backupsDir = path.join(tmpDir, 'data', 'backups');
    if (!fs.existsSync(backupsDir)) return null;
    const files = fs.readdirSync(backupsDir).filter((f) => /^users-/.test(f)).sort();
    if (!files.length) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(backupsDir, files[0]), 'utf-8'));
      const u = Array.isArray(raw) ? raw.find((x) => x && x.username === 'system') : null;
      return u ? { username: u.username, password: u.password } : null;
    } catch { return null; }
  }

  let server;
  try {
    server = await bootServer();

    // 1) Anonymous data access is denied — protection is server-side, not a UI.
    const anon = await fetch(`${BASE}/api/data/employees`);
    ok('anonymous data read rejected (401)', anon.status === 401);
    const anonBody = await anon.json();
    ok('anonymous 401 carries an auth-required code', anonBody.code === 'login_required' || anonBody.code === 'access_token_required');

    // 2) Wrong password is rejected (single failure — avoids the rate limiter).
    const bad = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'system', password: 'definitely-wrong' }),
    });
    ok('wrong password rejected (401)', bad.status === 401);

    // 3) Real login with POST-migration (hashed) credentials.
    const creds = readFactoryCreds();
    if (!creds) {
      console.log('  (no migration backup found — live login checks skipped)');
      return;
    }
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    ok('login with migrated (hashed) password succeeds (200)', login.status === 200);
    const loginData = await login.json();
    ok('login returns a session token', typeof loginData.session === 'string' && loginData.session.length > 0);
    ok('login returns an expiry', typeof loginData.expiresIn === 'number' && loginData.expiresIn > 0);
    ok('login NEVER returns the password field', !('password' in (loginData.user || {})));
    const session = loginData.session;

    // 4) Session-gated read.
    const dataR = await fetch(`${BASE}/api/data/employees`, { headers: { 'X-Session-Token': session } });
    ok('session-gated data read succeeds (200)', dataR.status === 200);
    const employees = await dataR.json();
    ok('employees payload is an array', Array.isArray(employees));

    // 5) CORS allowlist enforcement.
    const allowedRes = await fetch(`${BASE}/api/status`, { headers: { Origin: 'http://allowed.test' } });
    const blockedRes = await fetch(`${BASE}/api/status`, { headers: { Origin: 'http://evil.example' } });
    ok('allowed origin receives Access-Control-Allow-Origin', allowedRes.headers.get('access-control-allow-origin') === 'http://allowed.test');
    ok('disallowed origin gets NO Access-Control-Allow-Origin', blockedRes.headers.get('access-control-allow-origin') === null);
    ok('server never returns ACAO *', (allowedRes.headers.get('access-control-allow-origin') || '') !== '*');

    // 6) Backup works under a session and already reflects hashed passwords.
    const backup = await fetch(`${BASE}/api/backup`, { headers: { 'X-Session-Token': session } });
    ok('backup downloadable under session (200)', backup.status === 200);
    const backupData = await backup.json();
    ok('backup contains users collection', Array.isArray(backupData.users) && backupData.users.length > 0);
    ok('backup users are PBKDF2-hashed (no plaintext)', backupData.users.every((u) => typeof u.password === 'string' && u.password.startsWith('pbkdf2$')));

    // 7) Restore works under a session and survives a restart.
    const sentinel = [{ id: 'comp-sentinel', nameAr: 'Restore-Test-Co', branches: [] }];
    const rest = await fetch(`${BASE}/api/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': session },
      body: JSON.stringify({ companies: sentinel }),
    });
    ok('restore accepted under session', rest.status === 200 && (await rest.json()).success === true);
    const companiesRes = await fetch(`${BASE}/api/data/companies`, { headers: { 'X-Session-Token': session } });
    const companies = await companiesRes.json();
    ok('restored data readable', Array.isArray(companies) && companies.some((c) => c.id === 'comp-sentinel'));

    // 8) Restart: a fresh login must work and the restored data must survive.
    await stopServer(server);
    server = await bootServer();
    const login2 = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    ok('login still works after restart (post-migration)', login2.status === 200);
    let session2 = null;
    if (login2.status === 200) session2 = (await login2.json()).session || null;
    const companiesAfter = await (async () => {
      if (!session2) return { ok: false, d: null };
      const r = await fetch(`${BASE}/api/data/companies`, { headers: { 'X-Session-Token': session2 } });
      if (r.status !== 200) return { ok: false, d: null };
      return { ok: true, d: await r.json() };
    })();
    ok('data survives server restart (companies sentinel)', companiesAfter.ok && Array.isArray(companiesAfter.d) && companiesAfter.d.some((c) => c.id === 'comp-sentinel'));

    await stopServer(server);
    server = null;
  } finally {
    if (server) await stopServer(server);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}