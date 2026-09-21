// ============================================================
// P-24.2 — Unified Test Gate
// Executes the approved regression suites SEQUENTIALLY, one
// child process per suite (no shell string, no parallelism).
// It only owns: execution, ordering, exit code, timing, gate
// summary. Each suite is responsible for its own assertions.
//
// Usage:
//   node scripts/run-test-gate.mjs            # full gate (A -> B -> C)
//   node scripts/run-test-gate.mjs --group A  # A, B, or C only
// ============================================================
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXEC = process.execPath;
const PER_SUITE_TIMEOUT_MS = 30 * 60 * 1000;

const GROUPS = {
  A: [
    'f04-report-wage-unification-tests.mjs',
    'f01-disburse-atomicity-tests.mjs',
    'f02-eosb-loan-settlement-tests.mjs',
    'f03-server-branch-filtering-tests.mjs',
    'f06-resubmit-audit-tests.mjs',
    'f07-exchange-rate-snapshot-tests.mjs',
    'k1-critk-durability-core-tests.mjs',
    'p4-fix1-full-return-tests.mjs',
    'p4-fix4-archived-branch-tests.mjs',
    'p4-fix5-first-login-hydration-tests.mjs',
    'p4-fix6-full-return-legacy-alignment-tests.mjs',
    'p5-fix1-scoped-mutation-tests.mjs',
    'p13-super-branch-enforcement-tests.mjs',
    'p15-legacy-loan-reversal-hardening-tests.mjs',
    'p16-d2-post-return-financial-immutability-tests.mjs',
    'p17-d2b-reactivation-suite.mjs',
    'p18-d4-disbursement-attribute-integrity-tests.mjs',
    'p19-critk-rollback-integrity-tests.mjs',
    'p20-unified-payroll-cycle-tests.mjs',
    'p9-tests.mjs',
    'p10-1-nav-parity-tests.mjs',
    'p10-3-permissions-persistence-tests.mjs',
    'p10-4-financial-session-scope-tests.mjs',
    'p10-5-role-change-preserves-permissions-tests.mjs',
    'role-matrix-parity-tests.mjs',
    'print-issued-by-footer-tests.mjs',
    'test-full-return-ux.mjs',
  ],
  B: [
    'release-gate-test.mjs',
    'branch-gate-client-tests.mjs',
    'final-branch-isolation-gate.mjs',
  ],
  C: [
    'release-gate-test-part-b.mjs',
    'p5-fix2-excel-id-preservation-tests.mjs',
    'p12-server-authz-workflow-tests.mjs',
    'p14-deleted-records-super-write-regression-tests.mjs',
    'p21-scope-immutability-tests.mjs',
    'p10-1-tests.mjs',
    'p10-2-tests.mjs',
    'e2e-backup-restore-verification.mjs',
    'clear-all-tests.mjs',
  ],
};

const ORDER = ['A', 'B', 'C'];

function err(line) {
  console.error(`run-test-gate: ${line}`);
}

function fmt(ms) {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function parseArgs(argv) {
  const rest = argv;
  let group = null;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--group') {
      const value = rest[i + 1];
      if (value === undefined) {
        err(`--group requires a value (one of: ${ORDER.join(', ')})`);
        process.exit(1);
      }
      group = value.toUpperCase();
      i++;
    } else {
      err(`unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  if (group !== null && !Object.prototype.hasOwnProperty.call(GROUPS, group)) {
    err(`unknown group: ${group} (valid: ${ORDER.join(', ')})`);
    process.exit(1);
  }
  return group;
}

function buildRoster(group) {
  const roster = [];
  for (const key of ORDER) {
    if (group && key !== group) continue;
    for (const file of GROUPS[key]) roster.push({ file, group: key });
  }
  return roster;
}

function checkExist(roster) {
  const missing = [];
  for (const entry of roster) {
    if (!fs.existsSync(path.join(SCRIPTS_DIR, entry.file))) missing.push(entry.file);
  }
  if (missing.length) {
    err('missing test script(s):');
    for (const file of missing) err(`  - ${file}`);
    return false;
  }
  return true;
}

function runSuite(entry) {
  const abs = path.join(SCRIPTS_DIR, entry.file);
  const label = `[${entry.group}] ${entry.file}`;
  const startedAt = Date.now();
  console.log(`\n=== ${label} ===`);
  let res;
  try {
    res = spawnSync(EXEC, [abs], { stdio: 'inherit', timeout: PER_SUITE_TIMEOUT_MS });
  } catch (e) {
    err(`FAIL ${label} (spawn threw)`);
    err(`  reason: ${(e && e.message) || e}`);
    err(`  elapsed: ${fmt(Date.now() - startedAt)}`);
    process.exit(1);
  }
  const elapsed = fmt(Date.now() - startedAt);
  if (res.error) {
    err(`FAIL ${label}`);
    err(`  reason: ${res.error.message}`);
    if (res.signal) err(`  signal: ${res.signal}`);
    err(`  elapsed: ${elapsed}`);
    process.exit(1);
  }
  if (res.status === 0) {
    console.log(`PASS ${label} (${elapsed})`);
    return;
  }
  err(`FAIL ${label}`);
  if (res.status !== null) err(`  exit code: ${res.status}`);
  else err(`  terminated; signal: ${res.signal || 'none'}`);
  err(`  elapsed: ${elapsed}`);
  process.exit(1);
}

function main() {
  const group = parseArgs(process.argv.slice(2));
  const roster = buildRoster(group);
  if (!checkExist(roster)) process.exit(1);
  console.log(
    `run-test-gate: ${roster.length} suite(s)${group ? ` (group ${group})` : ''} — sequential execution`,
  );
  const t0 = Date.now();
  for (const entry of roster) runSuite(entry);
  const total = fmt(Date.now() - t0);
  console.log('\n=== GATE SUMMARY ===');
  console.log(`  suites executed : ${roster.length}`);
  console.log(`  suites failed   : 0`);
  console.log(`  total elapsed   : ${total}`);
  console.log(`\nrun-test-gate: all ${roster.length} suite(s) passed.`);
  process.exit(0);
}

main();