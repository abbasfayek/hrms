// =========================================================
// P12 — v1.3.0 Phase 2: Server-authoritative authorization
// & payroll/EOSB state-transition enforcement
// =========================================================
// Closes three workflow-breaking gaps on the SERVER (the final
// authority — client UI success must never become server
// persistence by itself):
//
//   HR01 — audit_reviewer (approve/reject/cancelPayment) and
//          payments_officer (disburse) could never persist ANY
//          payroll write: the server's blanket payrolls gate
//          demanded payroll.edit, which those roles do not have.
//          → the server now authorizes PER TRANSITION: draft →
//            under_audit (payroll.submit), under_audit → approved
//            (payroll.approve), under_audit → rejected
//            (payroll.reject), approved → paid (payroll.disburse).
//   HR02 — branch_hr could never persist a salary increment: the
//          server's increments gate demanded increments.edit even
//          though branch_hr is designed to CREATE with
//          increments.add.
//          → creates require increments.add; only modifying an
//            EXISTING record requires increments.edit (and
//            branch_hr is explicitly NOT granted increments.edit).
//   HR07 — the server only partially validated payroll state and
//          EOSB had none; illegal status jumps (under_audit→paid,
//          approved→draft, rejected→draft, draft→approved, …)
//          were accepted by a direct crafted POST.
//          → full official state machine (payroll + EOSB) enforced
//            server-side with the exact transition permission; paid
//            records stay immutable; rejected history stays intact.
//
// Two layers prove it:
//   Layer A — direct unit tests on server-authz.mjs (the exact
//             functions the POST handler runs) + agreement with
//             the guarded client engines (transitionPayrollGuarded
//             y transitionEosbGuarded produce payloads the server
//             ACCEPTS; crafted illegal variants are REJECTED).
//   Layer B — a REAL live HTTP server on a temp data dir whose
//             POST /api/data/:collection wire format matches how
//             storage.persistToServer() speaks (full-collection
//             arrays, X-Branch-Id header), with persistence
//             re-verified by a fresh session ("refresh").
//
// Usage: node scripts/p12-server-authz-workflow-tests.mjs
// =========================================================

import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
}
const assertEq = (got, want, msg) => JSON.stringify(got) === JSON.stringify(want);
const clone = (o) => JSON.parse(JSON.stringify(o));

// localStorage shim so the client engines import cleanly (same approach as
// final-branch-isolation-gate.mjs).
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
if (!globalThis.CustomEvent) globalThis.CustomEvent = class CustomEvent { constructor(t, o = {}) { this.type = t; this.detail = o.detail; } };
if (!globalThis.window) globalThis.window = globalThis;

const SERVER = await import('../server-authz.mjs');
const { checkWritePerm, scopeValidateWrite, getEffectivePerms, getScope, WRITE_GATES, PAYROLL_TRANSITIONS, EOSB_TRANSITIONS } = SERVER;

const payrollEngine = await import('../public/js/engines/payrollEngine.js');
const payrollAccess = await import('../public/js/engines/payrollAccess.js');
const eosbWorkflow = await import('../public/js/engines/eosbWorkflow.js');
const eosbAccess = await import('../public/js/engines/eosbAccess.js');

// ---------------------------------------------------------------------------
// FIXTURES
// ---------------------------------------------------------------------------
const EMPLOYEES = [
  { id: 'emp-1', fullName: 'Emp One', companyId: 'comp-1', branchId: 'br-1' },
  { id: 'emp-2', fullName: 'Emp Two', companyId: 'comp-1', branchId: 'br-1' },
  { id: 'emp-3', fullName: 'Emp Three', companyId: 'comp-1', branchId: 'br-2' },
  { id: 'emp-4', fullName: 'Emp Four', companyId: 'comp-2', branchId: 'br-3' },
];
const getAllEmployees = () => EMPLOYEES;

const mkUser = (id, role, comp, br, perms) => {
  const u = { id, role };
  if (comp) u.assignedCompanyId = comp;
  if (br) u.assignedBranchId = br;
  if (perms) u.permissions = perms;
  return u;
};
const ctxOf = (u) => ({ user: u, perms: getEffectivePerms(u), scope: getScope(u) });

const PAYROLL_ALL_PERMS = [
  'payroll.generate', 'payroll.edit', 'payroll.approve', 'payroll.reject',
  'payroll.submit', 'payroll.disburse', 'payroll.cancelPayment', 'payroll.archive', 'payroll.export',
];
const EOSB_ALL_PERMS = ['eosb.calculate', 'eosb.approve', 'eosb.pay', 'eosb.delete', 'eosb.view'];

const batchFrom = (status, id = `P-${status}`) => ({
  id, companyId: 'comp-1', branchId: 'br-1', status, month: '2026-09',
  updatedAt: '2026-09-10T00:00:00Z',
  items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1' }],
});
const batchPaid = () => ({
  ...batchFrom('paid'),
  ratesSnapshot: { USD: 1300 },
  items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', netSalary: 5000, exchangeRate: 1300, baseAmount: 6500000 }],
});
const toStatus = (base, status) => ({ ...clone(base), status, updatedAt: '2026-09-16T00:00:00Z' });

const eosbFrom = (status, id = `E-${status}`) => ({
  id, companyId: 'comp-1', branchId: 'br-1', employeeId: 'emp-1', status,
  netSettlementAmount: 12000, updatedAt: '2026-09-10T00:00:00Z',
});
const eosbTo = (base, status) => ({ ...clone(base), status, updatedAt: '2026-09-16T00:00:00Z' });

// ---------------------------------------------------------------------------
// LAYER A — direct authorization-unit tests
// ---------------------------------------------------------------------------
console.log('\n=== P12 Layer A: server-authz authorization units ===');

// A0. blanket gate sanity
{
  const reviewer = ctxOf(mkUser('u', 'audit_reviewer', 'comp-1', 'br-1'));
  const officer = ctxOf(mkUser('u', 'payments_officer', 'comp-1', 'br-1'));
  const bhr = ctxOf(mkUser('u', 'branch_hr', 'comp-1', 'br-1'));
  ok('A0.1 audit_reviewer passes payrolls write gate (HR01)', checkWritePerm(reviewer, 'payrolls').ok === true);
  ok('A0.2 payments_officer passes payrolls write gate (HR01)', checkWritePerm(officer, 'payrolls').ok === true);
  ok('A0.3 branch_hr passes increments write gate (HR02)', checkWritePerm(bhr, 'increments').ok === true);
  const viewer = ctxOf(mkUser('u', 'payroll_admin', 'comp-1', 'br-1', ['payroll.view', 'reports.view']));
  ok('A0.4 view-only user still denied payrolls write gate', checkWritePerm(viewer, 'payrolls').ok === false);
}

// A1. payroll official matrix — exhaustive, isolated from permissions
{
  const u = mkUser('m', 'branch_hr', 'comp-1', 'br-1', PAYROLL_ALL_PERMS);
  const ctx = ctxOf(u);
  const edges = { draft: ['under_audit'], under_audit: ['approved', 'rejected'], rejected: ['under_audit'], approved: ['paid'], paid: [] };
  const statuses = ['draft', 'under_audit', 'approved', 'rejected', 'paid'];
  let arcCount = 0, okCount = 0;
  for (const from of statuses) {
    const stored = [batchFrom(from)];
    for (const to of statuses) {
      arcCount++;
      const inc = [toStatus(batchFrom(from), to)];
      const r = scopeValidateWrite('payrolls', inc, ctx, getAllEmployees, stored);
      // A self-arc is an EDIT of the existing batch (payroll.edit on the
      // fixture); a changed arc must be a legal matrix transition.
      const expect = (from === to) || (edges[from] || []).includes(to);
      if (expect === r.ok) okCount++;
      ok(`A1 payroll arc ${from}->${to}${expect ? ' OK' : ' rejected'}`, r.ok === expect, r.reason || '');
    }
  }
  ok(`A1 payroll full matrix ${okCount}/${arcCount} arcs correct`, okCount === arcCount);
  ok('A1.3 create as draft allowed (payroll.generate)', scopeValidateWrite('payrolls', [batchFrom('draft', 'NEW')], ctx, getAllEmployees, []).ok === true);
  const createBad = scopeValidateWrite('payrolls', [batchFrom('approved', 'NEW')], ctx, getAllEmployees, []);
  ok('A1.4 create straight-to-approved rejected (HR07)', !createBad.ok && createBad.reason === 'illegal_workflow_transition', createBad.reason);
  const createBad2 = scopeValidateWrite('payrolls', [batchFrom('paid', 'NEW')], ctx, getAllEmployees, []);
  ok('A1.5 create straight-to-paid rejected (HR07)', !createBad2.ok && createBad2.reason === 'illegal_workflow_transition', createBad2.reason);
}

// A2. payroll transition PERMISSION mapping (roles must be denied for the
// transitions that belong to another role)
{
  const reviewer = ctxOf(mkUser('r', 'audit_reviewer', 'comp-1', 'br-1'));
  const officer = ctxOf(mkUser('o', 'payments_officer', 'comp-1', 'br-1'));
  const admin = ctxOf(mkUser('p', 'payroll_admin', 'comp-1', 'br-1'));
  const cohr = ctxOf(mkUser('c', 'company_hr', 'comp-1', 'br-1'));

  ok('A2.1 audit_reviewer approve allowed',
    scopeValidateWrite('payrolls', [toStatus(batchFrom('under_audit'), 'approved')], reviewer, getAllEmployees, [batchFrom('under_audit')]).ok === true);
  ok('A2.2 audit_reviewer reject allowed',
    scopeValidateWrite('payrolls', [toStatus(batchFrom('under_audit'), 'rejected')], reviewer, getAllEmployees, [batchFrom('under_audit')]).ok === true);
  const rDisb = scopeValidateWrite('payrolls', [toStatus(batchFrom('approved'), 'paid')], reviewer, getAllEmployees, [batchFrom('approved')]);
  ok('A2.3 audit_reviewer cannot disburse (no payroll.disburse)', !rDisb.ok && rDisb.reason === 'permission_denied', rDisb.reason);
  const rSubmit = scopeValidateWrite('payrolls', [toStatus(batchFrom('draft'), 'under_audit')], reviewer, getAllEmployees, [batchFrom('draft')]);
  ok('A2.4 audit_reviewer cannot submit (no payroll.submit)', !rSubmit.ok && rSubmit.reason === 'permission_denied', rSubmit.reason);

  ok('A2.5 payments_officer disburse allowed',
    scopeValidateWrite('payrolls', [toStatus(batchFrom('approved'), 'paid')], officer, getAllEmployees, [batchFrom('approved')]).ok === true);
  const oApprove = scopeValidateWrite('payrolls', [toStatus(batchFrom('under_audit'), 'approved')], officer, getAllEmployees, [batchFrom('under_audit')]);
  ok('A2.6 payments_officer cannot approve', !oApprove.ok && oApprove.reason === 'permission_denied', oApprove.reason);
  const oSubmit = scopeValidateWrite('payrolls', [toStatus(batchFrom('draft'), 'under_audit')], officer, getAllEmployees, [batchFrom('draft')]);
  ok('A2.7 payments_officer cannot submit', !oSubmit.ok && oSubmit.reason === 'permission_denied', oSubmit.reason);

  ok('A2.8 payroll_admin submit allowed',
    scopeValidateWrite('payrolls', [toStatus(batchFrom('draft'), 'under_audit')], admin, getAllEmployees, [batchFrom('draft')]).ok === true);
  const aApprove = scopeValidateWrite('payrolls', [toStatus(batchFrom('under_audit'), 'approved')], admin, getAllEmployees, [batchFrom('under_audit')]);
  ok('A2.9 payroll_admin cannot approve (no payroll.approve)', !aApprove.ok && aApprove.reason === 'permission_denied', aApprove.reason);

  ok('A2.10 company_hr same-status edit of draft allowed (payroll.edit)',
    scopeValidateWrite('payrolls', [toStatus(batchFrom('draft'), 'draft')], cohr, getAllEmployees, [batchFrom('draft')]).ok === true);
  const bhr = ctxOf(mkUser('b', 'branch_hr', 'comp-1', 'br-1'));
  const bhrEdit = scopeValidateWrite('payrolls', [toStatus(batchFrom('draft'), 'draft')], bhr, getAllEmployees, [batchFrom('draft')]);
  ok('A2.11 branch_hr cannot same-status edit (no payroll.edit)', !bhrEdit.ok && bhrEdit.reason === 'permission_denied', bhrEdit.reason);
  ok('A2.12 branch_hr can CREATE a draft (payroll.generate)',
    scopeValidateWrite('payrolls', [batchFrom('draft', 'NEW')], bhr, getAllEmployees, []).ok === true);
}

// A3. paid-batch protections + history preservation
{
  const reviewer = ctxOf(mkUser('r', 'audit_reviewer', 'comp-1', 'br-1'));
  const storedPaid = [batchPaid()];
  const rollback = scopeValidateWrite('payrolls', [toStatus(batchPaid(), 'approved')], reviewer, getAllEmployees, storedPaid);
  ok('A3.1 paid -> approved rolled back (paid_batch_immutable)', !rollback.ok && rollback.reason === 'paid_batch_immutable', rollback.reason);
  const tamper = clone(batchPaid());
  tamper.updatedAt = '2026-09-16T00:00:00Z';
  tamper.ratesSnapshot = { USD: 999 };
  const t = scopeValidateWrite('payrolls', [tamper], reviewer, getAllEmployees, storedPaid);
  ok('A3.2 paid ratesSnapshot tamper rejected', !t.ok && t.reason === 'paid_batch_snapshot_immutable', t.reason);
  const echoPaid = scopeValidateWrite('payrolls', storedPaid, reviewer, getAllEmployees, storedPaid);
  ok('A3.3 unchanged paid echo accepted', echoPaid.ok === true);

  const all = ctxOf(mkUser('m', 'branch_hr', 'comp-1', 'br-1', PAYROLL_ALL_PERMS));
  const storedRej = [{ ...batchFrom('rejected'), rejectionHistory: [{ revision: 1 }] }];
  const trunc = toStatus(storedRej[0], 'rejected');
  trunc.rejectionHistory = [];
  const h = scopeValidateWrite('payrolls', [trunc], all, getAllEmployees, storedRej);
  ok('A3.4 rejection-history truncation rejected', !h.ok && h.reason === 'history_tampering_detected', h.reason);
}

// A4. whole-collection semantics: echoes and stale copies never deny
{
  const bhr = ctxOf(mkUser('b', 'branch_hr', 'comp-1', 'br-1'));
  const existing = [{ id: 'INC-1', employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', type: 'increment', amount: 100, updatedAt: '2026-09-10T00:00:00Z' }];
  const newInc = { id: 'INC-2', employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', type: 'increment', amount: 150, createdAt: '2026-09-16T00:00:00Z' };
  // Exactly what storage.persistToServer sends: the FULL array (echo + new).
  const full = scopeValidateWrite('increments', [...existing, newInc], bhr, getAllEmployees, existing);
  ok('A4.1 branch_hr full-array save (echo + create) accepted — HR02', full.ok === true, full.reason || '');
  // An older stamp of a record somebody else edited server-side must be a no-op.
  const stale = [{ ...existing[0], amount: 50, updatedAt: '2026-09-09T00:00:00Z' }];
  const rStale = scopeValidateWrite('increments', stale, bhr, getAllEmployees, existing);
  ok('A4.2 stale-copy echo accepted (no change applied)', rStale.ok === true, rStale.reason || '');
  // A real edit of an existing record requires increments.edit.
  const edit = { ...existing[0], amount: 250, updatedAt: '2026-09-16T00:00:00Z' };
  const rEdit = scopeValidateWrite('increments', [edit], bhr, getAllEmployees, existing);
  ok('A4.3 branch_hr editing existing denied (needs increments.edit)', !rEdit.ok && rEdit.reason === 'permission_denied', rEdit.reason);
  const cohr = ctxOf(mkUser('c', 'company_hr', 'comp-1', 'br-1'));
  ok('A4.4 company_hr editing existing allowed', scopeValidateWrite('increments', [edit], cohr, getAllEmployees, existing).ok === true);
  // Cross-company scope.
  const cross = { id: 'INC-3', employeeId: 'emp-4', companyId: 'comp-2', branchId: 'br-3', createdAt: '2026-09-16T00:00:00Z' };
  const rX = scopeValidateWrite('increments', [cross], bhr, getAllEmployees, []);
  ok('A4.5 branch_hr cross-company create denied', !rX.ok && rX.reason === 'scope_violation', rX.reason);
}

// A5. EOSB official matrix + permissions
{
  const company = ctxOf(mkUser('c', 'company_hr', 'comp-1', 'br-1'));
  const edges = { draft: ['under_audit'], under_audit: ['approved', 'draft'], approved: ['paid'], paid: ['approved'] };
  const statuses = ['draft', 'under_audit', 'approved', 'paid'];
  let okCount = 0, total = 0;
  for (const from of statuses) {
    const stored = [eosbFrom(from)];
    for (const to of statuses) {
      total++;
      const r = scopeValidateWrite('eosb', [eosbTo(eosbFrom(from), to)], company, getAllEmployees, stored);
      // EOSB same-status writes are calculations on a draft (eosb.calculate),
      // EXCEPT a sealed paid settlement rejects even a same-status restamp.
      const expect = (from === to && from !== 'paid') || (edges[from] || []).includes(to);
      if (r.ok === expect) okCount++;
      ok(`A5 eosb arc ${from}->${to}${expect ? ' OK' : ' rejected'}`, r.ok === expect, r.reason || '');
    }
  }
  ok(`A5 eosb full matrix ${okCount}/${total} arcs correct`, okCount === total);
  const cohr = ctxOf(mkUser('c', 'company_hr', 'comp-1', 'br-1'));
  ok('A5.2 eosb create committed to under_audit (calculator) allowed',
    scopeValidateWrite('eosb', [eosbFrom('under_audit', 'NEW')], cohr, getAllEmployees, []).ok === true);
  ok('A5.3 eosb create as draft allowed',
    scopeValidateWrite('eosb', [eosbFrom('draft', 'NEW')], cohr, getAllEmployees, []).ok === true);
  const bhr = ctxOf(mkUser('b', 'branch_hr', 'comp-1', 'br-1'));
  const bhrCreate = scopeValidateWrite('eosb', [eosbFrom('draft', 'NEW')], bhr, getAllEmployees, []);
  ok('A5.4 branch_hr can calculate (create draft)', bhrCreate.ok === true, bhrCreate.reason || '');
  const bhrSubmit = scopeValidateWrite('eosb', [eosbTo(eosbFrom('draft'), 'under_audit')], bhr, getAllEmployees, [eosbFrom('draft')]);
  ok('A5.5 branch_hr cannot submit (no eosb.approve)', !bhrSubmit.ok && bhrSubmit.reason === 'permission_denied', bhrSubmit.reason);
  const paidImm = scopeValidateWrite('eosb', [eosbTo(eosbFrom('paid'), 'draft')], cohr, getAllEmployees, [eosbFrom('paid')]);
  ok('A5.6 paid settlement cannot go to draft', !paidImm.ok && paidImm.reason === 'paid_batch_immutable', paidImm.reason);
  ok('A5.7 paid -> approved cancel accepted (eosb.approve)',
    scopeValidateWrite('eosb', [eosbTo(eosbFrom('paid'), 'approved')], cohr, getAllEmployees, [eosbFrom('paid')]).ok === true);
}

// A6. guarded-client agreement: the exact payload the real guarded engines
// emit is ACCEPTED by the server; crafted illegal equivalents are REJECTED.
{
  const reviewerCtx = ctxOf(mkUser('r', 'audit_reviewer', 'comp-1', 'br-1'));
  const reviewer = reviewerCtx.user;
  const storedBatch = batchFrom('under_audit');
  const guarded = payrollAccess.transitionPayrollGuarded(reviewer, storedBatch, 'approved', { by: 'A. Reviewer' });
  ok('A6.1 client guard approves fine', guarded.ok === true, guarded.error || guarded.layer || '');
  const accept = scopeValidateWrite('payrolls', [guarded.batch], reviewerCtx, getAllEmployees, [storedBatch]);
  ok('A6.2 server accepts the guarded clients approve payload (HR01)', accept.ok === true, accept.reason || '');

  const officerCtx = ctxOf(mkUser('o', 'payments_officer', 'comp-1', 'br-1'));
  const disb = payrollAccess.transitionPayrollGuarded(officerCtx.user, batchFrom('approved'), 'paid', { by: 'P. Officer' });
  ok('A6.3 client guard disburses fine', disb.ok === true, disb.error || disb.layer || '');
  ok('A6.4 server accepts payments_officer guarded disburse (HR01)',
    scopeValidateWrite('payrolls', [disb.batch], officerCtx, getAllEmployees, [batchFrom('approved')]).ok === true);

  const crafted = toStatus(batchFrom('under_audit'), 'paid');
  const rCrafted = scopeValidateWrite('payrolls', [crafted], officerCtx, getAllEmployees, [batchFrom('under_audit')]);
  ok('A6.5 crafted under_audit->paid REJECTED server-side (HR07)', !rCrafted.ok && rCrafted.reason === 'illegal_workflow_transition', rCrafted.reason);

  const companyCtx = ctxOf(mkUser('c', 'company_hr', 'comp-1', 'br-1'));
  const eosbSubmit = eosbAccess.transitionEosbGuarded(companyCtx.user, eosbFrom('draft'), 'under_audit', { by: 'C. HR' });
  ok('A6.6 eosb client guard submits fine', eosbSubmit.ok === true, eosbSubmit.error || eosbSubmit.layer || '');
  ok('A6.7 server accepts guarded eosb submit',
    scopeValidateWrite('eosb', [eosbSubmit.batch], companyCtx, getAllEmployees, [eosbFrom('draft')]).ok === true);
}

// A7. explicit-lockdown users (permissions:[] + permissionsExplicit) get nothing
{
  const lockedUser = mkUser('l', 'payroll_admin', 'comp-1', 'br-1', []);
  lockedUser.permissionsExplicit = true;
  const locked = ctxOf(lockedUser);
  ok('A7.1 explicit empty permissions fails payrolls write gate', checkWritePerm(locked, 'payrolls').ok === false);
  ok('A7.2 explicit empty permissions fails increments write gate', checkWritePerm(locked, 'increments').ok === false);
  const r = scopeValidateWrite('increments', [{ id: 'X', employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1' }], locked, getAllEmployees, []);
  ok('A7.3 explicit empty permissions denied at record level', !r.ok, r.reason);
}

// ---------------------------------------------------------------------------
// LAYER B — live HTTP server E2E
// ---------------------------------------------------------------------------
console.log('\n=== P12 Layer B: live-server E2E (crafted POST + refresh persistence) ===');

const PORT = 5488;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-p12-'));
for (const f of ['server.js', 'server-authz.mjs', 'index.html']) {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmpDir, f));
}
fs.cpSync(path.join(ROOT, 'public'), path.join(tmpDir, 'public'), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });

const writeData = (name, data) => fs.writeFileSync(path.join(tmpDir, 'data', `${name}.json`), JSON.stringify(data, null, 2));

const U = {
  admin: { id: 'usr-admin', role: 'super_admin', password: 'password123' },
  cohr: { id: 'usr-cohr', role: 'company_hr', company: 'comp-1', password: 'password123' },
  cohr2: { id: 'usr-cohr2', role: 'company_hr', company: 'comp-2', password: 'password123' },
  padmin: { id: 'usr-padmin', role: 'payroll_admin', company: 'comp-1', password: 'password123' },
  audit: { id: 'usr-audit', role: 'audit_reviewer', company: 'comp-1', password: 'password123' },
  pay: { id: 'usr-pay', role: 'payments_officer', company: 'comp-1', password: 'password123' },
  bhr1: { id: 'usr-bhr1', role: 'branch_hr', company: 'comp-1', branch: 'br-1', password: 'password123' },
  bhr2: { id: 'usr-bhr2', role: 'branch_hr', company: 'comp-1', branch: 'br-2', password: 'password123' },
  bhr3: { id: 'usr-bhr3', role: 'branch_hr', company: 'comp-2', branch: 'br-3', password: 'password123' },
};
const usersJson = Object.entries(U).map(([key, u]) => {
  const rec = { id: u.id, username: `p12-${key}`, password: u.password, role: u.role };
  if (u.company) rec.assignedCompanyId = u.company;
  if (u.branch) rec.assignedBranchId = u.branch;
  return rec;
});
writeData('users', usersJson);
writeData('companies', [
  { id: 'comp-1', name: 'Company One', branches: [{ id: 'br-1', name: 'Branch 1' }, { id: 'br-2', name: 'Branch 2' }] },
  { id: 'comp-2', name: 'Company Two', branches: [{ id: 'br-3', name: 'Branch 3' }] },
]);
writeData('employees', EMPLOYEES);
writeData('payrolls', []);
writeData('increments', []);
writeData('eosb', []);
writeData('settings', { baseCurrency: 'USD', currencySymbol: '$' });
writeData('audit', []);
writeData('deleted_records', []);
writeData('audit_trail', { events: [] });

function httpReq(port, urlPath, opts = {}, body = null) {
  return new Promise((resolve, reject) => {
    const reqOpts = { hostname: 'localhost', port, path: urlPath, method: opts.method || 'GET', headers: opts.headers || {} };
    const req = http.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: data, data: parsed });
      });
    });
    req.on('error', reject);
    if (body) {
      if (typeof body === 'object' && !Buffer.isBuffer(body)) {
        req.setHeader('Content-Type', 'application/json');
        req.write(JSON.stringify(body));
      } else req.write(body);
    }
    req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let serverChild = null;
try {
  serverChild = spawn(process.execPath, ['server.js'], {
    cwd: tmpDir,
    env: { ...process.env, PORT: String(PORT), CORS_ALLOWLIST: `http://localhost:${PORT}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverChild.stdout?.on('data', () => {});
  serverChild.stderr?.on('data', () => {});

  const deadline = Date.now() + 15000;
  let booted = false;
  while (Date.now() < deadline) {
    try { const r = await httpReq(PORT, '/api/status'); if (r.status === 200) { booted = true; break; } } catch {}
    await sleep(200);
  }
  ok('B0.1 temp server booted', booted === true);

  const sessions = {};
  for (const key of Object.keys(U)) {
    const r = await httpReq(PORT, '/api/auth/login', { method: 'POST' }, { username: `p12-${key}`, password: U[key].password });
    sessions[key] = r.data?.session || null;
  }
  ok('B0.2 all role logins succeeded', Object.values(sessions).every(Boolean));

  const H = (key, branch) => ({ 'x-session-token': sessions[key], ...(branch ? { 'x-branch-id': branch } : {}) });
  const getData = async (key, col, branch) => {
    const r = await httpReq(PORT, `/api/data/${col}`, { headers: H(key, branch) });
    return r;
  };
  const postData = async (key, col, payload, branch) => {
    const r = await httpReq(PORT, `/api/data/${col}`, { method: 'POST', headers: H(key, branch) }, payload);
    return r;
  };
  const lastReason = (res) => (res.data && res.data.reason) || 'n/a';

  // ---- HR02: branch_hr increments ----
  {
    const incNew = { id: 'INC-A1', employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', type: 'increment', amount: 500, createdAt: new Date().toISOString() };
    const r1 = await postData('bhr1', 'increments', [incNew], 'br-1');
    ok('B HR02.1 branch_hr CREATE increment persists (200)', r1.status === 200, lastReason(r1));
    const fresh = await getData('bhr1', 'increments', 'br-1');
    ok('B HR02.2 increment persisted after refresh (GET as same role)',
      Array.isArray(fresh.data) && fresh.data.some((i) => i.id === 'INC-A1'));
    const sec = await httpReq(PORT, '/api/auth/login', { method: 'POST' }, { username: 'p12-bhr1', password: U.bhr1.password });
    const secGet = await httpReq(PORT, '/api/data/increments', { headers: { 'x-session-token': sec.data.session, 'x-branch-id': 'br-1' } });
    ok('B HR02.3 increment persists after a FRESH session (refresh)',
      Array.isArray(secGet.data) && secGet.data.some((i) => i.id === 'INC-A1'));

    // Full-collection echo must be a no-op (never denies the save).
    const full = (await getData('bhr1', 'increments', 'br-1')).data || [];
    const rEcho = await postData('bhr1', 'increments', full, 'br-1');
    ok('B HR02.4 full-array echo save accepted', rEcho.status === 200, lastReason(rEcho));

    const incDed = { id: 'ded-bon-100', employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', type: 'deduction', amount: -200, payrollPeriod: '2026-09', date: '2026-09-16', createdAt: new Date().toISOString() };
    const rDed = await postData('bhr1', 'increments', [incDed, incNew], 'br-1');
    ok('B HR02.5 branch_hr CREATE deduction/bonus record accepted', rDed.status === 200, lastReason(rDed));

    const incEdit = { ...incNew, amount: 700, updatedAt: new Date().toISOString() };
    const rEdit = await postData('bhr1', 'increments', [incEdit], 'br-1');
    ok('B HR02.6 branch_hr EDIT existing increment denied (403)', rEdit.status === 403 && lastReason(rEdit) === 'permission_denied', lastReason(rEdit));

    const cross = { id: 'INC-X1', employeeId: 'emp-4', companyId: 'comp-2', branchId: 'br-3', createdAt: new Date().toISOString() };
    const rCross = await postData('bhr1', 'increments', [cross], 'br-1');
    ok('B HR02.7 branch_hr cross-company create denied (scope_violation)', rCross.status === 403 && lastReason(rCross) === 'scope_violation', lastReason(rCross));

    const crossBr = { id: 'INC-X2', employeeId: 'emp-3', companyId: 'comp-1', branchId: 'br-2', createdAt: new Date().toISOString() };
    const rCrossBr = await postData('bhr1', 'increments', [crossBr], 'br-1');
    ok('B HR02.8 branch_hr cross-branch create denied (scope_violation)', rCrossBr.status === 403 && lastReason(rCrossBr) === 'scope_violation', lastReason(rCrossBr));

    // company_hr edits the same record fine.
    const rCohrEdit = await postData('cohr', 'increments', [incEdit], 'br-1');
    ok('B HR02.9 company_hr edit existing increment accepted', rCohrEdit.status === 200, lastReason(rCohrEdit));
  }

  // ---- HR01 + HR07: payroll full lifecycle over HTTP ----
  {
    // ---- HR01 positive chain: create → submit → approve → disburse ----
    const dr = { id: 'PAYROLL-2026-09', companyId: 'comp-1', branchId: 'br-1', status: 'draft', month: '2026-09', updatedAt: new Date().toISOString(), items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', netSalary: 5000 }] };
    const rCreate = await postData('cohr', 'payrolls', [dr], 'br-1');
    ok('B HR07.1 company_hr CREATE draft accepted', rCreate.status === 200, lastReason(rCreate));

    // submit: draft → under_audit (requires payroll.submit; cohr has it)
    const rSubmit = await postData('cohr', 'payrolls', [{ ...dr, status: 'under_audit', submittedBy: 'Company HR', submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], 'br-1');
    ok('B HR01.0 company_hr SUBMIT persists (200)', rSubmit.status === 200, lastReason(rSubmit));

    // approve: under_audit → approved (requires payroll.approve; audit has it — HR01)
    const rApprove = await postData('audit', 'payrolls', [{ ...dr, status: 'approved', auditedBy: 'Audit Reviewer', auditedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], 'br-1');
    ok('B HR01.1 audit_reviewer APPROVE persists (200)', rApprove.status === 200, lastReason(rApprove));
    const afterApprove = await getData('audit', 'payrolls', 'br-1');
    ok('B HR01.2 approve persisted & stamped (status=approved, auditedBy)',
      Array.isArray(afterApprove.data) && afterApprove.data.some((b) => b.id === dr.id && b.status === 'approved' && b.auditedBy === 'Audit Reviewer'));

    // disburse: approved → paid (requires payroll.disburse; pay has it — HR01)
    const rPay = await postData('pay', 'payrolls', [{ ...dr, status: 'paid', paidBy: 'Payments Officer', paidAt: new Date().toISOString(), releaseStatus: 'released', updatedAt: new Date().toISOString() }], 'br-1');
    ok('B HR01.3 payments_officer DISBURSE persists (200)', rPay.status === 200, lastReason(rPay));
    const afterPay = await getData('pay', 'payrolls', 'br-1');
    ok('B HR01.4 disburse persisted (status=paid)',
      Array.isArray(afterPay.data) && afterPay.data.some((b) => b.id === dr.id && b.status === 'paid'));

    // ---- wrong-action permission denials (each uses a dedicated chain) ----
    // Chain helper: create draft → submit → target status
    const chainTo = async (id, target) => {
      const d = { id, companyId: 'comp-1', branchId: 'br-1', status: 'draft', month: '2026-09', updatedAt: new Date().toISOString(), items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1' }] };
      await postData('cohr', 'payrolls', [d], 'br-1');
      await postData('cohr', 'payrolls', [{ ...d, status: 'under_audit', updatedAt: new Date().toISOString() }], 'br-1');
      if (target === 'approved') await postData('audit', 'payrolls', [{ ...d, status: 'approved', auditedBy: 'Audit', auditedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], 'br-1');
      if (target === 'rejected') await postData('audit', 'payrolls', [{ ...d, status: 'rejected', rejectedBy: 'Audit', rejectedAt: new Date().toISOString(), rejectionHistory: [{ revision: 1 }], updatedAt: new Date().toISOString() }], 'br-1');
    };

    // pay trying approve (no payroll.approve)
    await chainTo('PAYROLL-P1', 'under_audit');
    const latestUa = (await getData('cohr', 'payrolls', 'br-1')).data.find((b) => b.id === 'PAYROLL-P1');
    const rPayApprove = await postData('pay', 'payrolls', [{ ...latestUa, status: 'approved', updatedAt: new Date().toISOString() }], 'br-1');
    ok('B P.1 payments_officer cannot push under_audit->approved (permission_denied)', rPayApprove.status === 403 && lastReason(rPayApprove) === 'permission_denied', lastReason(rPayApprove));

    // audit trying disburse (no payroll.disburse)
    await chainTo('PAYROLL-P2', 'approved');
    const latestAp = (await getData('cohr', 'payrolls', 'br-1')).data.find((b) => b.id === 'PAYROLL-P2');
    const rAudDisb = await postData('audit', 'payrolls', [{ ...latestAp, status: 'paid', updatedAt: new Date().toISOString() }], 'br-1');
    ok('B P.2 audit_reviewer cannot push approved->paid (permission_denied)', rAudDisb.status === 403 && lastReason(rAudDisb) === 'permission_denied', lastReason(rAudDisb));

    // ---- HR07 illegal transitions (requires stored records) ----
    // under_audit → paid (pay needs stored under_audit)
    await chainTo('PAYROLL-U2P', 'under_audit');
    const latestU2p = (await getData('cohr', 'payrolls', 'br-1')).data.find((b) => b.id === 'PAYROLL-U2P');
    const rU2Paid = await postData('pay', 'payrolls', [{ ...latestU2p, status: 'paid', updatedAt: new Date().toISOString() }], 'br-1');
    ok('B HR07.2 under_audit->paid REJECTED (illegal_workflow_transition)', rU2Paid.status === 403 && lastReason(rU2Paid) === 'illegal_workflow_transition', lastReason(rU2Paid));

    // create straight-to-paid (new id, not in stored → create path)
    const rD2Paid = await postData('pay', 'payrolls', [{ id: 'PAYROLL-D2P', companyId: 'comp-1', branchId: 'br-1', status: 'paid', month: '2026-09', updatedAt: new Date().toISOString(), items: [] }], 'br-1');
    ok('B HR07.3 create straight-to-paid REJECTED (illegal_workflow_transition)', rD2Paid.status === 403 && lastReason(rD2Paid) === 'illegal_workflow_transition', lastReason(rD2Paid));

    // rejected → approved (needs stored rejected via chain)
    await chainTo('PAYROLL-RET', 'rejected');
    const latestRet = (await getData('cohr', 'payrolls', 'br-1')).data.find((b) => b.id === 'PAYROLL-RET');
    const rRetApprove = await postData('audit', 'payrolls', [{ ...latestRet, status: 'approved', updatedAt: new Date().toISOString() }], 'br-1');
    ok('B HR07.5 rejected->approved REJECTED (illegal_workflow_transition)', rRetApprove.status === 403 && lastReason(rRetApprove) === 'illegal_workflow_transition', lastReason(rRetApprove));

    // paid → draft (PAYROLL-2026-09 is now paid)
    const paid = (await getData('cohr', 'payrolls', 'br-1')).data.find((b) => b.id === dr.id);
    const rPaidRollback = await postData('audit', 'payrolls', [{ ...paid, status: 'draft', updatedAt: new Date().toISOString() }], 'br-1');
    ok('B HR07.6 paid->draft REJECTED (paid_batch_immutable)', rPaidRollback.status === 403 && lastReason(rPaidRollback) === 'paid_batch_immutable', lastReason(rPaidRollback));

    // cross-company: cohr2 creates a comp-2 draft (legal — within their own scope)
    const rComp2 = await postData('cohr2', 'payrolls', [{ id: 'PAYROLL-C2', companyId: 'comp-2', branchId: 'br-3', status: 'draft', month: '2026-09', updatedAt: new Date().toISOString(), items: [{ employeeId: 'emp-4', companyId: 'comp-2', branchId: 'br-3' }] }], 'br-3');
    ok('B HR07.7 company_hr comp-2 CREATE draft for own company accepted', rComp2.status === 200, lastReason(rComp2));

    // cross-branch: bhr1 (br-1) tries to create a draft for br-2 → scope_violation
    const rCrossT = await postData('bhr1', 'payrolls', [{ id: 'PAYROLL-X2', companyId: 'comp-1', branchId: 'br-2', status: 'draft', month: '2026-09', updatedAt: new Date().toISOString(), items: [{ employeeId: 'emp-3', companyId: 'comp-1', branchId: 'br-2' }] }], 'br-2');
    ok('B HR07.8 branch_hr cannot create draft for another branch (scope_violation)', rCrossT.status === 403 && lastReason(rCrossT) === 'scope_violation', lastReason(rCrossT));

    // super_admin is branch-scoped: PASSES with a concrete branch, create
    // straight-to-paid allowed (by design).
    const rSuper = await postData('admin', 'payrolls', [{ id: 'PAYROLL-SUPER', companyId: 'comp-1', branchId: 'br-1', status: 'paid', month: '2026-09', updatedAt: new Date().toISOString(), items: [] }], 'br-1');
    ok('B HR07.9 super_admin branch-scoped write accepted (by design)', rSuper.status === 200, lastReason(rSuper));

    // super_admin without a concrete branch on a branch-scoped collection → 403.
    const rSuperNoBranch = await postData('admin', 'payrolls', [{ id: 'PAYROLL-SUPER-NB', companyId: 'comp-1', branchId: 'br-1', status: 'draft', month: '2026-10', updatedAt: new Date().toISOString(), items: [] }], 'all');
    ok('B HR07.10 super_admin write WITHOUT a branch is rejected (branch_required)', rSuperNoBranch.status === 403 && rSuperNoBranch.data && rSuperNoBranch.data.code === 'branch_required', `status=${rSuperNoBranch.status} code=${rSuperNoBranch.data && rSuperNoBranch.data.code}`);
  }

  // ---- EOSB over HTTP (HR07 / EOSB) ----
  {
    const mkE = (id, status, extra = {}) => ({ id, employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', status, netSettlementAmount: 12000, updatedAt: new Date().toISOString(), ...extra });
    const rCreate = await postData('cohr', 'eosb', [mkE('EOSB-1', 'under_audit')], 'br-1');
    ok('B E.1 company_hr calculator-commit (create under_audit) accepted', rCreate.status === 200, lastReason(rCreate));
    const rApprove = await postData('cohr', 'eosb', [mkE('EOSB-1', 'approved', { approvedBy: 'C. HR' })], 'br-1');
    ok('B E.2 eosb approve accepted', rApprove.status === 200, lastReason(rApprove));
    const rPaid = await postData('cohr', 'eosb', [mkE('EOSB-1', 'paid', { paidBy: 'C. HR', paymentReference: { referenceId: 'R1' } })], 'br-1');
    ok('B E.3 eosb disburse accepted', rPaid.status === 200, lastReason(rPaid));
    const rCancel = await postData('cohr', 'eosb', [mkE('EOSB-1', 'approved', { cancelPaymentBy: 'C. HR' })], 'br-1');
    ok('B E.4 eosb cancel payment (paid->approved) accepted', rCancel.status === 200, lastReason(rCancel));

    const rJump = await postData('cohr', 'eosb', [mkE('EOSB-BAD1', 'approved')], 'br-1');
    ok('B E.5 eosb create-direct-approved REJECTED (illegal_workflow_transition)', rJump.status === 403 && lastReason(rJump) === 'illegal_workflow_transition', lastReason(rJump));
    const rPaidImm = await postData('cohr', 'eosb', [mkE('EOSB-BAD2', 'draft')], 'br-1');
    ok('B E.6 eosb create-direct-draft is a legit calculate (accepted)', rPaidImm.status === 200, lastReason(rPaidImm));

    const rBhrCalc = await postData('bhr1', 'eosb', [mkE('EOSB-BHR2', 'draft', { employeeId: 'emp-1' })], 'br-1');
    ok('B E.8 branch_hr calculate draft accepted (eosb.calculate)', rBhrCalc.status === 200, lastReason(rBhrCalc));

    // branch_hr cannot SUBMIT a draft eosb (requires eosb.approve, not eosb.calculate)
    const rBhrSubmit = await postData('bhr1', 'eosb', [{ ...mkE('EOSB-BHR2', 'under_audit') }], 'br-1');
    ok('B E.7 branch_hr cannot push draft->under_audit on eosb (permission_denied, needs eosb.approve)',
      rBhrSubmit.status === 403 && lastReason(rBhrSubmit) === 'permission_denied', lastReason(rBhrSubmit));
  }

  // ---- persistence re-verified for a payroll after a full refresh ----
  {
    const sec = await httpReq(PORT, '/api/auth/login', { method: 'POST' }, { username: 'p12-cohr', password: U.cohr.password });
    const secGet = await httpReq(PORT, '/api/data/payrolls', { headers: { 'x-session-token': sec.data.session, 'x-branch-id': 'br-1' } });
    ok('B P.3 payrolls persisted across a fresh session (refresh)',
      Array.isArray(secGet.data) && secGet.data.some((b) => b.id === 'PAYROLL-2026-09' && b.status === 'paid'));
  }
} finally {
  if (serverChild) { try { serverChild.kill(); } catch {} }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

// ---------------------------------------------------------------------------
console.log('\n==============================================');
console.log(`P12 Phase 2 result: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('ALL PHASE 2 SERVER-AUTHORIZATION & TRANSITION TESTS PASSED');