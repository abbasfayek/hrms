// =========================================================
// Password Migration Script — plaintext → PBKDF2-SHA256
//
// Usage: npm run migrate
//
// Migrates every legacy plaintext password in data/users.json to the exact
// hash format the server produces at login (pbkdf2$<saltB64>$<iter>$<hashB64>,
// SHA-256, 100k iterations, 16-byte salt, 32-byte key).
//
// Safety properties (Release Gate):
//  - Backs up data/users.json (to data/backups/) BEFORE any mutation.
//  - Never logs passwords — only usernames and counts reach stdout.
//  - Preserves every other user field (roles, permissions, companies, flags).
//  - Idempotent: already-hashed accounts (pbkdf2$...) are skipped; re-running
//    after a successful run is a no-op and creates no new backup.
//  - Writes atomically (temp file + rename) so a crash can't corrupt the file.
//  - Verifies after writing that NO plaintext password remains AND that no
//    field besides the password changed; exits non-zero otherwise.
// =========================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const pbkdf2 = promisify(crypto.pbkdf2);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// Must stay byte-for-byte compatible with server.js / auth.js.
const HASH_ALGO = 'pbkdf2';
const HASH_ITERATIONS = 100000;
const SALT_LEN = 16;
const KEY_LEN = 32;

function isHashedPassword(password) {
  return typeof password === 'string' && password.startsWith(`${HASH_ALGO}$`);
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const derivedKey = await pbkdf2(password, salt, HASH_ITERATIONS, KEY_LEN, 'sha256');
  return `${HASH_ALGO}$${salt.toString('base64')}$${HASH_ITERATIONS}$${derivedKey.toString('base64')}`;
}

// Prove that the freshly produced hash actually verifies with the original
// plaintext (constant-time) BEFORE anything is written to disk — so a wrongly
// generated hash can never lock an account out.
async function hashMatches(password, storedHash) {
  const parts = storedHash.split('$');
  if (parts.length !== 4) return false;
  const [, saltB64, iterationsStr, hashB64] = parts;
  const iterations = parseInt(iterationsStr, 10);
  if (!iterations || iterations <= 0) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await pbkdf2(password, salt, iterations, expected.length, 'sha256');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

function writeJsonAtomic(file, data) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(temporary, file);
}

function readUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    console.error('✖ data/users.json not found — nothing to migrate.');
    process.exit(1);
  }
  let users;
  try {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch (e) {
    console.error('✖ Cannot parse data/users.json:', e.message);
    process.exit(1);
  }
  if (!Array.isArray(users)) {
    console.error('✖ data/users.json must contain an array of users.');
    process.exit(1);
  }
  return users;
}

async function main() {
  const users = readUsers();
  if (users.some((u) => u && (typeof u.password !== 'string' || u.password.length === 0))) {
    console.error('✖ A user record has a missing or empty password; aborting (refusing to guess).');
    process.exit(1);
  }

  const pending = users.filter((u) => u && !isHashedPassword(u.password));
  if (pending.length === 0) {
    console.log('✔ All passwords are already PBKDF2-hashed. Nothing to migrate.');
    console.log(`   Accounts verified: ${users.length}`);
    return;
  }

  // Backup the ORIGINAL collection before any mutation.
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUP_DIR, `users-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(users, null, 2), 'utf-8');
  console.log(`✔ Backup saved: ${path.relative(ROOT, backupFile)}`);

  console.log(`   Migrating ${pending.length} of ${users.length} account(s):`);
  for (const u of pending) {
    const hash = await hashPassword(u.password);
    if (!(await hashMatches(u.password, hash))) {
      console.error(`✖ HASH VERIFICATION FAILED for user "${u.username || u.id}" — aborting before any write.`);
      process.exit(1);
    }
    u.password = hash; // ONLY the password field ever changes
    console.log(`   ✓ ${u.username || u.id}`);
  }

  writeJsonAtomic(USERS_FILE, users);

  // Verification 1: no plaintext remains on disk.
  const written = readUsers();
  const leftovers = written.filter((u) => u && !isHashedPassword(u.password));
  if (leftovers.length > 0) {
    console.error(`✖ VERIFICATION FAILED — ${leftovers.length} account(s) still have a plaintext password.`);
    console.error(`   Restore from: ${path.relative(ROOT, backupFile)}`);
    process.exit(1);
  }

  // Verification 2: deep-compare against the backup — only `password` may differ.
  const original = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
  const kind = (v) =>
    Object.prototype.toString.call(v);
  const strip = (u) => ({ ...u, password: '<REDACTED>' });
  const sameShape = (a, b) =>
    a.length === b.length &&
    a.every((u, i) => {
      const x = strip(u);
      const y = strip(b[i]);
      if (kind(x) !== kind(y)) return false;
      if (kind(x) === '[object Object]') {
        const xk = Object.keys(x).sort();
        const yk = Object.keys(y).sort();
        if (xk.join('|') !== yk.join('|')) return false;
        return xk.every((k) => JSON.stringify(x[k]) === JSON.stringify(y[k]));
      }
      return x === y;
    });
  if (!sameShape(original, written)) {
    console.error('✖ VERIFICATION FAILED — fields other than the password were altered.');
    console.error(`   Restore from: ${path.relative(ROOT, backupFile)}`);
    process.exit(1);
  }

  console.log('✔ Verification passed — data/users.json contains 0 plaintext passwords.');
  console.log(`   Accounts now PBKDF2-hashed: ${written.filter((u) => isHashedPassword(u.password)).length}/${written.length}`);
  console.log('✔ Roles, permissions and all other fields are byte-identical to the backup.');
}

main().catch((e) => {
  console.error('✖ Migration failed:', e.message);
  process.exit(1);
});