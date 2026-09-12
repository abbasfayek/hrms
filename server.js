import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import os from 'os';
import {
  resolveAuthContext,
  checkReadPerm,
  checkWritePerm,
  filterCollectionRead,
  scopeValidateWrite,
  maskPasswords,
  mergeUsersPreservePassword,
  isSuper,
  READ_GATES,
  WRITE_GATES,
} from './server-authz.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5173;
const HOST = '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');

// CORS Allowlist (C-4 / Release Gate) — an explicit Origin allowlist.
// Production safety: an empty or wildcard allowlist is a hard startup error,
// so the server can never be launched externally with `Access-Control-Allow-
// Origin: *` or with unmanaged origins. In development the environment list is
// merged with the local defaults for convenience (and a warning is printed).
const RAW_CORS_ALLOWLIST = (process.env.CORS_ALLOWLIST || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (IS_PRODUCTION) {
  if (RAW_CORS_ALLOWLIST.length === 0) {
    console.error('\n' + '='.repeat(72));
    console.error('❌ Production security: CORS_ALLOWLIST is not set.');
    console.error('   Refusing to start — an explicit Origin allowlist is required in production.');
    console.error('   Example:  CORS_ALLOWLIST=https://benosoft.tail074f40.ts.net NODE_ENV=production node server.js');
    console.error('='.repeat(72) + '\n');
    process.exit(1);
  }
  if (RAW_CORS_ALLOWLIST.some((e) => e.includes('*'))) {
    console.error('\n' + '='.repeat(72));
    console.error('❌ Production security: CORS_ALLOWLIST contains a wildcard entry (*).');
    console.error('   Refusing to start — production requires an explicit, non-wildcard allowlist.');
    console.error('='.repeat(72) + '\n');
    process.exit(1);
  }
}

const CORS_ALLOWLIST = IS_PRODUCTION
  ? RAW_CORS_ALLOWLIST
  : RAW_CORS_ALLOWLIST.concat([
      'http://localhost:5173',
      'http://192.168.1.7:5173',
      'https://benosoft.tail074f40.ts.net',
    ]);

if (!IS_PRODUCTION && RAW_CORS_ALLOWLIST.length === 0) {
  console.warn('⚠ Dev mode: CORS_ALLOWLIST env not set — using local defaults (localhost, LAN, tailscale).');
}

function isOriginAllowed(origin) {
  if (!origin) return false;
  return CORS_ALLOWLIST.some((allowed) => {
    if (allowed.endsWith('*')) {
      return origin.startsWith(allowed.slice(0, -1));
    }
    return origin === allowed;
  });
}

// Password hashing utilities (C-4) — PBKDF2-SHA256 with a per-user salt.
// PBKDF2 is used (not scrypt) because WebCrypto exposes PBKDF2 to browsers,
// so the offline/localStorage fallback in auth.js can verify the same hash.
const HASH_ALGO = 'pbkdf2';
const HASH_ITERATIONS = 100000;
const SALT_LEN = 16;
const KEY_LEN = 32;

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_LEN);
    crypto.pbkdf2(password, salt, HASH_ITERATIONS, KEY_LEN, 'sha256', (err, derivedKey) => {
      if (err) return reject(err);
      const saltB64 = salt.toString('base64');
      const hashB64 = derivedKey.toString('base64');
      resolve(`${HASH_ALGO}$${saltB64}$${HASH_ITERATIONS}$${hashB64}`);
    });
  });
}

function verifyPassword(password, storedHash) {
  return new Promise((resolve, reject) => {
    if (!storedHash || typeof storedHash !== 'string') return resolve(false);
    // Legacy plaintext (or unsalted hash with no scheme marker) — direct
    // comparison. These records are migrated to a PBKDF2 hash on successful login.
    if (!storedHash.startsWith(`${HASH_ALGO}$`)) {
      resolve(storedHash === password);
      return;
    }
    const parts = storedHash.split('$');
    if (parts.length !== 4) return resolve(false);
    const [, saltB64, iterationsStr, hashB64] = parts;
    const iterations = parseInt(iterationsStr, 10);
    if (!iterations || iterations <= 0) return resolve(false);
    let salt;
    let expectedHash;
    try {
      salt = Buffer.from(saltB64, 'base64');
      expectedHash = Buffer.from(hashB64, 'base64');
    } catch {
      return resolve(false);
    }
    crypto.pbkdf2(password, salt, iterations, expectedHash.length, 'sha256', (err, derivedKey) => {
      if (err) return reject(err);
      // Constant-time comparison
      if (derivedKey.length !== expectedHash.length) return resolve(false);
      resolve(crypto.timingSafeEqual(derivedKey, expectedHash));
    });
  });
}

function isHashedPassword(storedHash) {
  return typeof storedHash === 'string' && storedHash.startsWith(`${HASH_ALGO}$`);
}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// Allowed data collections (whitelist for security)
const ALLOWED_COLLECTIONS = [
  'companies', 'users', 'settings', 'employees', 'leaves',
  'overtime', 'loans', 'increments', 'attendance', 'holidays',
  'payrolls', 'eosb', 'hourly_leaves', 'hourly_leave_settings',
  'audit', 'deleted_records', 'audit_trail'
];

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function readBodyRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getCollectionFile(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

// Write through a temporary file so closing the application or a power loss
// cannot leave a collection as a partially-written JSON file.
function writeCollection(name, data) {
  const target = getCollectionFile(name);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(temporary, target);
}

// ==========================================
// HTTP Access Token (server-side gate)
// ==========================================
const ACCESS_TOKEN_FILE = path.join(DATA_DIR, 'access_token.json');

function getAccessToken() {
  try {
    if (!fs.existsSync(ACCESS_TOKEN_FILE)) return '';
    const raw = JSON.parse(fs.readFileSync(ACCESS_TOKEN_FILE, 'utf-8'));
    return (raw && typeof raw.token === 'string') ? raw.token : '';
  } catch (e) {
    return '';
  }
}

function setAccessToken(token) {
  writeCollection('access_token', { token: token || '' });
}

function getSuppliedMaster(req) {
  const q = req.url.split('?')[1];
  const params = q ? new URLSearchParams(q) : null;
  return req.headers['x-access-token'] || (params ? params.get('access_token') : null);
}

function hasValidAccessToken(req) {
  const expected = getAccessToken();
  if (!expected) return true; // protection disabled → allow
  const supplied = getSuppliedMaster(req);
  if (!supplied) return false;
  const a = Buffer.from(String(supplied));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ==========================================
// Browser sessions (short-lived). kind: 'user' = logged-in employee account,
// 'gate' = anonymous unlocked-app shell (only meaningful when master
// protection is enabled). Survive only for the life of the server process.
// ==========================================
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours, slid on every use
const sessions = new Map(); // sessionToken -> { ip, kind, userId, expiresAt }

// Persist sessions to disk so a server restart (or machine reboot) does not
// silently invalidate logged-in browsers and break the data save path.
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');
let sessionSaveTimer = null;

function persistSessions() {
  const payload = {};
  for (const [token, s] of sessions) payload[token] = s;
  try {
    const temporary = `${SESSION_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(payload), 'utf-8');
    fs.renameSync(temporary, SESSION_FILE);
  } catch (e) {}
}

function scheduleSessionSave() {
  if (sessionSaveTimer) return;
  sessionSaveTimer = setTimeout(() => {
    sessionSaveTimer = null;
    persistSessions();
  }, 500);
}

function loadSessions() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    const now = Date.now();
    for (const [token, s] of Object.entries(raw)) {
      if (s && typeof s.expiresAt === 'number' && s.expiresAt > now) {
        sessions.set(token, { ip: s.ip, kind: s.kind, userId: s.userId, expiresAt: s.expiresAt });
      }
    }
  } catch (e) {}
}

function createSession(ip, kind = 'gate', userId = null) {
  if (sessions.size > 800) {
    const now = Date.now();
    for (const [k, v] of sessions) if (v.expiresAt <= now) sessions.delete(k);
    if (sessions.size > 800) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt).slice(0, sessions.size - 800);
      oldest.forEach(([k]) => sessions.delete(k));
    }
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { ip, kind, userId, expiresAt: Date.now() + SESSION_TTL_MS });
  scheduleSessionSave();
  return token;
}

function hasValidSessionKind(req, kind) {
  const token = req.headers['x-session-token'] || '';
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (Date.now() > s.expiresAt) {
    sessions.delete(token);
    scheduleSessionSave();
    return false;
  }
  if (s.kind !== kind) return false;
  s.expiresAt = Date.now() + SESSION_TTL_MS; // sliding renewal
  return true;
}

const hasValidUserSession = (req) => hasValidSessionKind(req, 'user');
const hasValidGateSession = (req) => hasValidSessionKind(req, 'gate');

// ==========================================
// Brute-force protection (per source IP, in-memory)
// ==========================================
const RATE_MAX = 8;                 // failures before lockout
const RATE_WINDOW = 10 * 60 * 1000; // count window
const RATE_LOCK = 15 * 60 * 1000;   // lockout duration
const rate = new Map(); // ip -> { count, windowStart, lockedUntil }

function clientIP(req) {
  return (req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown').replace('::ffff:', '');
}

function pruneRate() {
  if (rate.size > 5000) {
    const now = Date.now();
    for (const [ip, r] of rate) if (now - r.windowStart > RATE_WINDOW && now > r.lockedUntil) rate.delete(ip);
  }
}

function checkLocked(ip) {
  pruneRate();
  const r = rate.get(ip);
  return !!(r && r.lockedUntil && Date.now() < r.lockedUntil);
}

function recordFailure(ip) {
  pruneRate();
  const now = Date.now();
  let r = rate.get(ip);
  if (!r || now - r.windowStart > RATE_WINDOW) r = { count: 0, windowStart: now, lockedUntil: 0 };
  r.count++;
  if (r.count >= RATE_MAX) {
    r.lockedUntil = now + RATE_LOCK;
    r.count = 0;
  }
  rate.set(ip, r);
}

function recordSuccess(ip) { rate.delete(ip); }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helpers for authz scope validation
function getAllUsers() {
  const fp = getCollectionFile('users');
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')) || []; } catch { return []; }
}

function getAllEmployees() {
  const fp = getCollectionFile('employees');
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')) || []; } catch { return []; }
}

// Resolve auth context from session (replaces old authorize)
async function getAuthContext(req) {
  return resolveAuthContext(req, sessions, getAllUsers);
}

const MERGE_COLLECTIONS = new Set(
  ['companies', 'employees', 'leaves', 'hourly_leaves', 'overtime', 'loans',
    'increments', 'attendance', 'holidays', 'payrolls', 'eosb', 'audit']
);

async function handleAPI(req, res, urlParts, method) {
  const segment = urlParts[2]; // /api/<segment>/...

  // Resolve auth context for all protected endpoints
  const authCtx = await getAuthContext(req);
  if (!authCtx.ok) {
    // Map internal reasons to public error codes for backward compatibility
    const codeMap = {
      no_session: 'login_required',
      invalid_session: 'login_required',
      expired: 'login_required',
      user_not_found: 'login_required',
      super_required: 'super_required',
      permission_denied: 'permission_denied',
      scope_violation: 'scope_violation',
    };
    const publicCode = codeMap[authCtx.reason] || authCtx.reason;
    const message = authCtx.reason === 'super_required' ? 'Super admin required' : 'Forbidden';
    return jsonResponse(res, { error: message, code: publicCode }, authCtx.status);
  }
  const { user, scope, perms } = authCtx;

  // Helper to read collection data
  async function readCollectionData(collection) {
    const filePath = getCollectionFile(collection);
    if (!fs.existsSync(filePath)) return null;
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
  }

  // POST /api/access-token — manage master token (super_admin only now)
  if (method === 'POST' && segment === 'access-token') {
    const writeCheck = checkWritePerm(authCtx, 'access-token');
    if (!writeCheck.ok) return jsonResponse(res, { error: 'Super admin required', code: 'super_required' }, 403);
    try {
      const body = await readBody(req);
      const newToken = typeof body.token === 'string' ? body.token.trim() : '';
      if (newToken !== '' && newToken.length < 8) {
        return jsonResponse(res, { error: 'Token must be at least 8 characters' }, 400);
      }
      setAccessToken(newToken);
      sessions.clear();
      scheduleSessionSave();
      return jsonResponse(res, { success: true, enabled: newToken !== '' });
    } catch (e) {
      return jsonResponse(res, { error: e.message }, 500);
    }
  }

  // POST /api/auth/session — exchange the master token for a short-lived session.
  if (method === 'POST' && segment === 'auth' && urlParts[3] === 'session') {
    if (checkLocked(clientIP(req))) {
      return jsonResponse(res, { error: 'Too many attempts. Try again later.', code: 'rate_limited' }, 429);
    }
    if (!hasValidAccessToken(req)) {
      recordFailure(clientIP(req));
      await sleep(400);
      return jsonResponse(res, { error: 'Invalid access token', code: 'invalid_token' }, 401);
    }
    recordSuccess(clientIP(req));
    return jsonResponse(res, { session: createSession(clientIP(req), 'gate'), expiresIn: SESSION_TTL_MS });
  }

  // POST /api/auth/login — handled as a public endpoint (see request handler),
  // never reachable through the gate. Kept here only for documentation.
  if (method === 'POST' && segment === 'auth' && urlParts[3] === 'login') {
    return jsonResponse(res, { error: 'Use /api/auth/login without credentials' }, 405);
  }

  // GET /api/data/:collection — Read data file with permission & scope
  if (method === 'GET' && segment === 'data') {
    const collection = urlParts[3];
    if (!collection || !ALLOWED_COLLECTIONS.includes(collection)) {
      return jsonResponse(res, { error: 'Invalid collection' }, 400);
    }
    // Check read permission
    const readCheck = checkReadPerm(authCtx, collection);
    if (!readCheck.ok) {
      return jsonResponse(res, { error: readCheck.reason === 'super_required' ? 'Super admin required' : 'Permission denied', code: readCheck.reason }, readCheck.status);
    }
    try {
      const data = await readCollectionData(collection);
      if (data === null) return jsonResponse(res, null, 200);
      // Apply scope filtering with query parameters
      const qsIndex = req.url.indexOf('?');
      const queryParams = qsIndex >= 0 ? Object.fromEntries(new URLSearchParams(req.url.slice(qsIndex))) : {};
      const filtered = filterCollectionRead(collection, data, authCtx, getAllEmployees, queryParams);
      // Mask passwords on users collection
      const output = collection === 'users' ? maskPasswords(filtered) : filtered;
      return jsonResponse(res, output);
    } catch (e) {
      return jsonResponse(res, { error: 'Read error' }, 500);
    }
  }

  // POST /api/data/:collection — Write data file with permission & scope validation
  if (method === 'POST' && segment === 'data') {
    const collection = urlParts[3];
    if (!collection || !ALLOWED_COLLECTIONS.includes(collection)) {
      return jsonResponse(res, { error: 'Invalid collection' }, 400);
    }
    // Check write permission
    const writeCheck = checkWritePerm(authCtx, collection);
    if (!writeCheck.ok) {
      return jsonResponse(res, { error: writeCheck.reason === 'super_required' ? 'Super admin required' : 'Permission denied', code: writeCheck.reason }, writeCheck.status);
    }
    try {
      const body = await readBody(req);
      // For merge collections, payload must be an array; for non-merge (settings, etc.) objects are allowed
      const isMergeCollection = MERGE_COLLECTIONS.has(collection);
      if (isMergeCollection && !Array.isArray(body)) {
        return jsonResponse(res, { error: 'Payload must be an array' }, 400);
      }
      const incomingArray = Array.isArray(body) ? body : [body];

      // Scope validation for write (atomic: reject entire payload if any record out of scope)
      if (WRITE_GATES[collection]?.scopeValidate) {
        const storedForValidation = isMergeCollection ? (await readCollectionData(collection) || []) : null;
        const scopeCheck = scopeValidateWrite(collection, incomingArray, authCtx, getAllEmployees, storedForValidation);
        if (!scopeCheck.ok) {
          return jsonResponse(res, { error: 'Scope violation', code: 'scope_violation', reason: scopeCheck.reason, recordId: scopeCheck.recordId }, scopeCheck.status || 403);
        }
      }

      // Special handling for users: preserve passwords & protected accounts
      if (collection === 'users') {
        const stored = await readCollectionData('users') || [];
        // Preserve protected accounts
        const protectedAccounts = stored.filter((u) => u && u.protected);
        const protectedIds = new Set(protectedAccounts.map((u) => u.id));
        const nonProtectedIncoming = incomingArray.filter((u) => u && !protectedIds.has(u.id));
        // Merge incoming with stored, preserving passwords where missing
        const merged = mergeUsersPreservePassword(stored, nonProtectedIncoming);
        // Ensure protected accounts are present
        for (const pa of protectedAccounts) {
          if (!merged.find(u => u.id === pa.id)) merged.push(pa);
        }
        writeCollection(collection, merged);
        return jsonResponse(res, { success: true });
      }

      // For merge collections, apply merge logic with scope-validated incoming
      if (MERGE_COLLECTIONS.has(collection)) {
        const stored = await readCollectionData(collection) || [];
        const merged = mergeCollection(stored, incomingArray, collection);
        writeCollection(collection, merged);
      } else {
        // Full-replace collections (settings, etc.) - only super_admin reaches here
        // For non-array payloads, write the object directly
        const toWrite = Array.isArray(body) ? incomingArray : body;
        writeCollection(collection, toWrite);
      }
      return jsonResponse(res, { success: true });
    } catch (e) {
      return jsonResponse(res, { error: 'Write error: ' + e.message }, 500);
    }
  }

  // Cross-device merge helpers (unchanged)
  function readCollection(collection) {
    try {
      const fp = getCollectionFile(collection);
      if (!fs.existsSync(fp)) return null;
      return JSON.parse(fs.readFileSync(fp, 'utf-8'));
    } catch (e) {
      return null;
    }
  }

  function stampValue(rec) {
    const v = rec && (rec.updatedAt || rec.createdAt);
    if (!v) return -Infinity;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : -Infinity;
  }

  function deletedRegistry(collection) {
    const set = new Set();
    try {
      const fp = getCollectionFile('deleted_records');
      if (fs.existsSync(fp)) {
        const list = JSON.parse(fs.readFileSync(fp, 'utf-8')) || [];
        for (const rec of list) {
          if (rec && rec.collection === collection && rec.data && rec.data.id) set.add(rec.data.id);
        }
      }
    } catch (e) { /* registry is advisory; ignore */ }
    return set;
  }

  function mergeCollection(stored, incoming, collection) {
    if (!Array.isArray(stored)) stored = [];
    if (!Array.isArray(incoming)) incoming = incoming || [];
    if (!MERGE_COLLECTIONS.has(collection)) {
      // Single-object / admin-only collections (settings) and users keep their
      // original full-replace semantics.
      return incoming;
    }
    const deleted = deletedRegistry(collection);
    const merged = [];
    const seen = new Set();
    for (const rec of incoming) {
      if (!rec || !rec.id || seen.has(rec.id) || deleted.has(rec.id)) continue;
      seen.add(rec.id);
      const prev = stored.find((s) => s && s.id === rec.id);
      merged.push(prev && stampValue(prev) > stampValue(rec) ? prev : rec);
    }
    for (const rec of stored) {
      if (!rec || !rec.id || seen.has(rec.id) || deleted.has(rec.id)) continue;
      seen.add(rec.id);
      merged.push(rec); // a sender that hasn't seen this record yet must not lose it
    }
    return merged;
  }

  // GET /api/backup — Full backup (super_admin only, masks passwords)
  if (method === 'GET' && segment === 'backup') {
    const backupCheck = checkReadPerm(authCtx, 'backup');
    if (!backupCheck.ok) {
      return jsonResponse(res, { error: 'Super admin required', code: 'super_required' }, 403);
    }
    try {
      const backup = {};
      for (const col of ALLOWED_COLLECTIONS) {
        const fp = getCollectionFile(col);
        if (fs.existsSync(fp)) {
          const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
          // Mask passwords in users collection
          backup[col] = col === 'users' ? maskPasswords(data) : data;
        }
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="benosoft_backup_${new Date().toISOString().split('T')[0]}.json"`
      });
      res.end(JSON.stringify(backup, null, 2));
    } catch (e) {
      return jsonResponse(res, { error: e.message }, 500);
    }
    return;
  }

  // POST /api/restore — Restore backup from JSON (super_admin only)
  if (method === 'POST' && segment === 'restore') {
    const restoreCheck = checkWritePerm(authCtx, 'restore');
    if (!restoreCheck.ok) {
      return jsonResponse(res, { error: 'Super admin required', code: 'super_required' }, 403);
    }
    try {
      const body = await readBody(req);
      for (const [col, data] of Object.entries(body)) {
        if (ALLOWED_COLLECTIONS.includes(col)) {
          if (col === 'users') {
            const stored = (await readCollectionData('users')) || [];
            writeCollection(col, mergeUsersPreservePassword(stored, data));
          } else {
            writeCollection(col, data);
          }
        }
      }
      return jsonResponse(res, { success: true, collections: Object.keys(body) });
    } catch (e) {
      return jsonResponse(res, { error: e.message }, 500);
    }
  }

  // POST /api/import-employees — Import employees (employees.add + scope)
  if (method === 'POST' && segment === 'import-employees') {
    const impCheck = checkWritePerm(authCtx, 'import-employees');
    if (!impCheck.ok) {
      return jsonResponse(res, { error: impCheck.reason === 'super_required' ? 'Super admin required' : 'Permission denied', code: impCheck.reason }, impCheck.status);
    }
    try {
      const body = await readBody(req);
      const { employees: newEmps = [], mode = 'append' } = body;
      if (!Array.isArray(newEmps)) {
        return jsonResponse(res, { error: 'employees must be an array' }, 400);
      }

      // Atomic scope validation for incoming employees
      const scopeCheck = scopeValidateWrite('employees', newEmps, authCtx, getAllEmployees);
      if (!scopeCheck.ok) {
        return jsonResponse(res, { error: 'Scope violation in imported data', code: 'scope_violation', recordId: scopeCheck.recordId }, 403);
      }

      const filePath = getCollectionFile('employees');
      let existing = [];
      if (fs.existsSync(filePath)) {
        existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) || [];
      }
      let result;
      if (mode === 'replace') {
        // replace mode: super_admin only
        if (!isSuper(authCtx.user)) {
          return jsonResponse(res, { error: 'Replace mode requires super admin', code: 'super_required' }, 403);
        }
        result = newEmps;
      } else {
        // Append mode: merge safely by companyId + employeeNumber so tenants cannot overwrite each other
        const callerScope = authCtx.scope;
        const map = new Map();
        for (const e of existing) {
          if (!e) continue;
          const key = `${e.companyId || ''}::${e.employeeNumber || e.id}`;
          map.set(key, e);
        }
        for (const ne of newEmps) {
          if (!ne) continue;
          const key = `${ne.companyId || callerScope.companyId || ''}::${ne.employeeNumber || ne.id}`;
          const prev = map.get(key);
          map.set(key, prev ? { ...prev, ...ne } : ne);
        }
        result = Array.from(map.values());
      }
      writeCollection('employees', result);
      return jsonResponse(res, { success: true, imported: newEmps.length, total: result.length });
    } catch (e) {
      return jsonResponse(res, { error: e.message }, 500);
    }
  }

  // GET /api/download-template — Download comprehensive Excel template (public)
  if (method === 'GET' && segment === 'download-template') {
    const rawUrl = req.url;
    const qsIndex = rawUrl.indexOf('?');
    const qs = qsIndex >= 0 ? rawUrl.slice(qsIndex + 1) : '';
    const params = Object.fromEntries(qs.split('&').filter(Boolean).map(p => p.split('=')));
    const lang = (params.lang || 'ar').toLowerCase();
    const isEn = lang === 'en';
    const excelContent = generateExcelTemplate(lang);

    res.writeHead(200, {
      'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
      'Content-Disposition': `attachment; filename="${isEn ? 'Employee_Import_Template.xls' : 'Employee_Template_AR.xls'}"`
    });
    res.end(Buffer.from('\uFEFF' + excelContent, 'utf-8'));
    return;
  }

  // GET /api/status — handled as a public endpoint (see request handler).

  return jsonResponse(res, { error: 'Not found' }, 404);
}

function generateExcelTemplate(lang = 'ar') {
  const isEn = lang === 'en';
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<!--[if gte mso 9]>
<xml>
 <x:ExcelWorkbook>
  <x:ExcelWorksheets>
   <x:ExcelWorksheet>
    <x:Name>${isEn ? 'Employees_Template' : 'بيانات الموظفين'}</x:Name>
    <x:WorksheetOptions>
     <x:DisplayGridlines/>
     ${isEn ? '' : '<x:DisplayRightToLeft/>'}
    </x:WorksheetOptions>
   </x:ExcelWorksheet>
  </x:ExcelWorksheets>
 </x:ExcelWorkbook>
</xml>
<![endif]-->
<style>
  th { background-color: #1e3a8a; color: #ffffff; font-weight: bold; border: 1px solid #0f172a; padding: 10px; text-align: center; }
  td { border: 1px solid #cbd5e1; padding: 8px; }
  .num { mso-number-format:"0"; text-align: right; }
  .curr { mso-number-format:"\#\,\#\#0\.00"; text-align: right; }
  .txt { mso-number-format:"\@"; text-align: left; }
</style>
</head>
<body>
<table>
  <thead>
    <tr>
      <th>${isEn ? 'Company Code' : 'كود الشركة'}</th>
      <th>${isEn ? 'Branch Name' : 'اسم الفرع'}</th>
      <th>${isEn ? 'Employee ID' : 'الرقم الوظيفي'}</th>
      <th>${isEn ? 'Full Name (AR)' : 'الاسم الكامل'}</th>
      <th>${isEn ? 'Full Name (EN)' : 'الاسم بالإنجليزية'}</th>
      <th>${isEn ? 'Department' : 'القسم'}</th>
      <th>${isEn ? 'Job Title' : 'المسمى الوظيفي'}</th>
      <th>${isEn ? 'Hire Date' : 'تاريخ التعيين'}</th>
      <th>${isEn ? 'Contract Type' : 'نوع العقد'}</th>
      <th>${isEn ? 'Status' : 'الحالة'}</th>
      <th>${isEn ? 'Basic Salary' : 'الراتب الأساسي'}</th>
      <th>${isEn ? 'Housing Allowance' : 'بدل السكن'}</th>
      <th>${isEn ? 'Transport Allowance' : 'بدل النقل'}</th>
      <th>${isEn ? 'Other Allowances' : 'بدلات أخرى'}</th>
      <th>${isEn ? 'Social Security Covered' : 'خاضع للتأمينات'}</th>
      <th>${isEn ? 'Social Security Registered Wage' : 'الأجر المسجل للتأمينات'}</th>
      <th>${isEn ? 'Social Security Emp %' : 'نسبة استقطاع الموظف %'}</th>
      <th>${isEn ? 'Social Security Comp %' : 'نسبة مساهمة الشركة %'}</th>
      <th>${isEn ? 'Bank Name' : 'اسم البنك'}</th>
      <th>${isEn ? 'Bank Account' : 'رقم الحساب'}</th>
      <th>${isEn ? 'IBAN' : 'الآيبان'}</th>
      <th>${isEn ? 'National ID' : 'رقم الهوية'}</th>
      <th>${isEn ? 'Phone' : 'الجوال'}</th>
      <th>${isEn ? 'Email' : 'البريد الإلكتروني'}</th>
      <th>${isEn ? 'Annual Leave Balance' : 'رصيد الإجازات السنوي'}</th>
      <th>${isEn ? 'Hourly Leave Quota' : 'رصيد الساعات الشهري'}</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>MAIN</td>
      <td>الفرع الرئيسي</td>
      <td class="txt">EMP-101</td>
      <td>محمد بن صالح القحطاني</td>
      <td>Mohammed Al-Qahtani</td>
      <td>تقنية المعلومات</td>
      <td>مهندس نظم أول</td>
      <td>2023-01-15</td>
      <td>full_time</td>
      <td>active</td>
      <td class="curr">12000.00</td>
      <td class="curr">3000.00</td>
      <td class="curr">1000.00</td>
      <td class="curr">500.00</td>
      <td>نعم</td>
      <td class="curr">15000.00</td>
      <td class="num">5</td>
      <td class="num">8</td>
      <td>البنك الأهلي</td>
      <td class="txt">SA1280000123456789012345</td>
      <td class="txt">SA1280000123456789012345</td>
      <td class="txt">1088992211</td>
      <td class="txt">0551234567</td>
      <td>mohammed@company.com</td>
      <td class="num">30</td>
      <td class="num">4</td>
    </tr>
    <tr>
      <td>MAIN</td>
      <td>فرع العليا</td>
      <td class="txt">EMP-102</td>
      <td>نورة بنت فهد السبيعي</td>
      <td>Noura Al-Subaie</td>
      <td>الموارد البشرية</td>
      <td>أخصائي موارد بشرية ورواتب</td>
      <td>2023-06-01</td>
      <td>full_time</td>
      <td>active</td>
      <td class="curr">9000.00</td>
      <td class="curr">2250.00</td>
      <td class="curr">800.00</td>
      <td class="curr">0.00</td>
      <td>نعم</td>
      <td class="curr">11250.00</td>
      <td class="num">5</td>
      <td class="num">8</td>
      <td>البنك الأهلي</td>
      <td class="txt">SA4410000098765432109876</td>
      <td class="txt">SA4410000098765432109876</td>
      <td class="txt">1099887766</td>
      <td class="txt">0559876543</td>
      <td>noura@company.com</td>
      <td class="num">25</td>
      <td class="num">4</td>
    </tr>
  </tbody>
</table>
</body>
</html>`;
}

function serveFile(res, filePath, urlForExt) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(urlForExt || filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error');
      } else {
        // The application is updated locally; never let an old JavaScript
        // bundle keep showing a previous language implementation.
        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
        res.end(data);
      }
    });
  });
}

// Reload persisted sessions so existing logins survive server restarts.
loadSessions();

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Access-Token, X-Session-Token');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlParts = req.url.split('?')[0].split('/');
  const method = req.method;

  // Route API requests
  if (urlParts[1] === 'api') {
    const ip = clientIP(req);

    // Public endpoint: boot / health / protection state.
    // Returns 401 only when master protection is enabled and the caller has no
    // gate session or master token yet (so the unlock screen shows on load).
    if (method === 'GET' && urlParts[2] === 'status') {
      const expected = getAccessToken();
      if (expected && !hasValidGateSession(req) && !hasValidAccessToken(req)) {
        return jsonResponse(res, { error: 'Access token required', code: 'access_token_required' }, 401);
      }
      return jsonResponse(res, { status: 'ok', protected: !!expected });
    }

    // Public endpoint: real user login (rate limited). Valid credentials return
    // a USER session which unlocks data access for this browser.
    if (method === 'POST' && urlParts[2] === 'auth' && urlParts[3] === 'login') {
      if (checkLocked(ip)) {
        return jsonResponse(res, { error: 'Too many attempts. Try again later.', code: 'rate_limited' }, 429);
      }
      try {
        const body = await readBody(req);
        const uname = String(body.username || '').trim().toLowerCase();
        const pass = String(body.password || '');
        let users = [];
        const fp = getCollectionFile('users');
        if (fs.existsSync(fp)) {
          try { users = JSON.parse(fs.readFileSync(fp, 'utf-8')) || []; } catch (e) { users = []; }
        }
        const user = users.find((u) => u && (
          (u.username || '').toLowerCase() === uname ||
          (u.email || '').toLowerCase() === uname
        ));
        const ok = !!user && typeof user.password === 'string' && await verifyPassword(pass, user.password);
        if (!ok) {
          recordFailure(ip);
          await sleep(400);
          return jsonResponse(res, { error: 'Invalid username or password', code: 'invalid_login' }, 401);
        }
        // Migration: if password was plaintext, upgrade to hash
        if (user.password && !isHashedPassword(user.password)) {
          user.password = await hashPassword(pass);
          writeCollection('users', users);
        }
        recordSuccess(ip);
        const session = createSession(ip, 'user', (user && user.id) || '');
        // Return user data without password
        const { password: _pw, ...safeUser } = user;
        return jsonResponse(res, { session, expiresIn: SESSION_TTL_MS, user: safeUser });
      } catch (e) {
        return jsonResponse(res, { error: e.message }, 500);
      }
    }

    // Public endpoint: exchange the master access token for a short-lived gate session
    if (method === 'POST' && urlParts[2] === 'auth' && urlParts[3] === 'session') {
      if (checkLocked(ip)) {
        return jsonResponse(res, { error: 'Too many attempts. Try again later.', code: 'rate_limited' }, 429);
      }
      if (!hasValidAccessToken(req)) {
        recordFailure(ip);
        await sleep(400);
        return jsonResponse(res, { error: 'Invalid access token', code: 'invalid_token' }, 401);
      }
      recordSuccess(ip);
      return jsonResponse(res, { session: createSession(ip, 'gate'), expiresIn: SESSION_TTL_MS });
    }

    // Public endpoint: download comprehensive Excel template
    if (method === 'GET' && urlParts[2] === 'download-template') {
      const rawUrl = req.url;
      const qsIndex = rawUrl.indexOf('?');
      const qs = qsIndex >= 0 ? rawUrl.slice(qsIndex + 1) : '';
      const params = Object.fromEntries(qs.split('&').filter(Boolean).map(p => p.split('=')));
      const lang = (params.lang || 'ar').toLowerCase();
      const isEn = lang === 'en';
      const excelContent = generateExcelTemplate(lang);

      res.writeHead(200, {
        'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
        'Content-Disposition': `attachment; filename="${isEn ? 'Employee_Import_Template.xls' : 'Employee_Template_AR.xls'}"`
      });
      res.end(Buffer.from('\uFEFF' + excelContent, 'utf-8'));
      return;
    }

    // Public-ish endpoint: manage the optional master protection. Now handled in handleAPI.
    if (method === 'POST' && urlParts[2] === 'access-token') {
      try {
        await handleAPI(req, res, urlParts, method);
      } catch (e) {
        jsonResponse(res, { error: 'Server error: ' + e.message }, 500);
      }
      return;
    }

    // Everything else goes through handleAPI which resolves auth context internally
    try {
      await handleAPI(req, res, urlParts, method);
    } catch (e) {
      jsonResponse(res, { error: 'Server error: ' + e.message }, 500);
    }
    return;
  }

  // Static file serving — ONLY the public directory plus the root index.html.
  // Everything else (data/, src/, server.js, .git, ...) is blocked.
  const PUBLIC_DIR = path.join(__dirname, 'public');
  let reqUrl = req.url.split('?')[0];

  if (reqUrl === '/' || reqUrl === '/index.html') {
    return serveFile(res, path.join(__dirname, 'index.html'), '/index.html');
  }
  if (reqUrl === '/favicon.ico') {
    return serveFile(res, path.join(PUBLIC_DIR, 'favicon.ico'), '/favicon.ico');
  }

  let filePath = path.join(PUBLIC_DIR, reqUrl.replace(/^\/public\//, ''));
  const resolvedPath = path.resolve(filePath);

  if (!resolvedPath.startsWith(path.resolve(PUBLIC_DIR) + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  if (!path.extname(reqUrl)) {
    // SPA fallback → root index.html
    const indexPath = path.join(__dirname, 'index.html');
    return serveFile(res, indexPath, '/index.html');
  }

  serveFile(res, resolvedPath, reqUrl);
});

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

server.listen(PORT, HOST, () => {
  const localIP = getLocalIP();
  const token = getAccessToken();
  console.log(`\n====================================================`);
  console.log(`🚀 BenoSoft Server started successfully!`);
  console.log(`====================================================`);
  console.log(`📡 Local:         http://localhost:${PORT}`);
  console.log(`🌐 Network (LAN): http://${localIP}:${PORT}`);
  console.log(`📁 Data files:    ${DATA_DIR}`);
  console.log(`🔗 CORS:          ${IS_PRODUCTION ? 'PRODUCTION allowlist (' + CORS_ALLOWLIST.length + ' origin(s))' : 'dev defaults + env allowlist (' + CORS_ALLOWLIST.length + ' origin(s))'}`);
  console.log(`====================================================`);
  console.log(`🔒 User authentication: REQUIRE LOGIN for all data`);
  console.log(`🔐 Master access token: ${token ? 'ENABLED (unlock screen on top of login)' : 'DISABLED — employees see only their login, the app protects itself via server-authenticated sessions'}`);
  if (token) {
    console.log(`   Token file: ${ACCESS_TOKEN_FILE}  (keep this file secret)`);
    console.log(`   The token is NOT printed to the terminal for security.`);
  }
  console.log(`   Re-enable/rotate it later from Settings → Access Token.`);
  console.log(`====================================================`);
  console.log(`🌍 To access globally:`);
  console.log(`   npx -y cloudflared tunnel --url http://localhost:${PORT}`);
  console.log(`====================================================\n`);
});
