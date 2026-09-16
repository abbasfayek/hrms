// =========================================================
// P2.1 — Scope & Immutability Hardening Tests
// =========================================================
// Tests scope fail-closed (wildcard/omission/unknown employee),
// paid payroll financial immutability, and append-only rejectionHistory.
//
// Usage: node scripts/p21-scope-immutability-tests.mjs
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

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
if (!globalThis.CustomEvent) globalThis.CustomEvent = class CustomEvent { constructor(t, o = {}) { this.type = t; this.detail = o.detail; } };
if (!globalThis.window) globalThis.window = globalThis;

const SERVER = await import('../server-authz.mjs');
const { checkWritePerm, scopeValidateWrite, getEffectivePerms, getScope } = SERVER;

const EMPLOYEES = [
  { id: 'emp-1', fullName: 'Emp One', companyId: 'comp-1', branchId: 'br-1' },
  { id: 'emp-2', fullName: 'Emp Two', companyId: 'comp-1', branchId: 'br-1' },
  { id: 'emp-3', fullName: 'Emp Three', companyId: 'comp-1', branchId: 'br-2' },
  { id: 'emp-4', fullName: 'Emp Four', companyId: 'comp-2', branchId: 'br-3' },
];
const getAllEmployees = () => EMPLOYEES;

const mkUser = (id, role, comp, br) => {
  const u = { id, role };
  if (comp) u.assignedCompanyId = comp;
  if (br) u.assignedBranchId = br;
  return u;
};
const ctxOf = (u) => ({ user: u, perms: getEffectivePerms(u), scope: getScope(u) });

console.log('\n=== P2.1 Test Suite: Scope Fail-Closed & Immutability ===');

// 1. Scope Negative Tests
const bhr1 = mkUser('u-bhr1', 'branch_hr', 'comp-1', 'br-1');
const cohr = mkUser('u-cohr', 'company_hr', 'comp-1');
const ctxBhr = ctxOf(bhr1);
const ctxCohr = ctxOf(cohr);

const baseBatch = (overrides = {}) => ({
  id: 'P-TEST', companyId: 'comp-1', branchId: 'br-1', status: 'draft', month: '2026-09',
  updatedAt: '2026-09-16T00:00:00Z',
  items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', netSalary: 5000, grossSalary: 6000 }],
  ...overrides,
});

// 1.1 branch_hr + companyId:"all"
{
  const r = scopeValidateWrite('payrolls', [baseBatch({ companyId: 'all' })], ctxBhr, getAllEmployees, []);
  ok('S1 branch_hr + companyId:"all" rejected', !r.ok, r.reason);
}
// 1.2 branch_hr + missing companyId
{
  const r = scopeValidateWrite('payrolls', [baseBatch({ companyId: undefined })], ctxBhr, getAllEmployees, []);
  ok('S2 branch_hr + missing companyId rejected', !r.ok, r.reason);
}
// 1.3 branch_hr + branchId:"all"
{
  const r = scopeValidateWrite('payrolls', [baseBatch({ branchId: 'all' })], ctxBhr, getAllEmployees, []);
  ok('S3 branch_hr + branchId:"all" rejected', !r.ok, r.reason);
}
// 1.4 branch_hr + missing branchId
{
  const r = scopeValidateWrite('payrolls', [baseBatch({ branchId: undefined })], ctxBhr, getAllEmployees, []);
  ok('S4 branch_hr + missing branchId rejected', !r.ok, r.reason);
}
// 1.5 company_hr + companyId:"all"
{
  const r = scopeValidateWrite('payrolls', [baseBatch({ companyId: 'all' })], ctxCohr, getAllEmployees, []);
  ok('S5 company_hr + companyId:"all" rejected', !r.ok, r.reason);
}
// 1.6 company_hr + missing companyId
{
  const r = scopeValidateWrite('payrolls', [baseBatch({ companyId: undefined })], ctxCohr, getAllEmployees, []);
  ok('S6 company_hr + missing companyId rejected', !r.ok, r.reason);
}
// 1.7 foreign company
{
  const r = scopeValidateWrite('payrolls', [baseBatch({ companyId: 'comp-2', branchId: 'br-3' })], ctxBhr, getAllEmployees, []);
  ok('S7 foreign company rejected', !r.ok, r.reason);
}
// 1.8 foreign branch
{
  const r = scopeValidateWrite('payrolls', [baseBatch({ companyId: 'comp-1', branchId: 'br-2' })], ctxBhr, getAllEmployees, []);
  ok('S8 foreign branch rejected', !r.ok, r.reason);
}
// 1.9 unknown employeeId in items (without explicit item companyId/branchId so it relies on employee indirection)
{
  const r = scopeValidateWrite('payrolls', [baseBatch({ items: [{ employeeId: 'emp-unknown' }] })], ctxBhr, getAllEmployees, []);
  ok('S9 unknown employeeId rejected (fail closed)', !r.ok, r.reason);
}
// 1.10 foreign employeeId in items
{
  const r = scopeValidateWrite('payrolls', [baseBatch({ items: [{ employeeId: 'emp-4', companyId: 'comp-2', branchId: 'br-3' }] })], ctxBhr, getAllEmployees, []);
  ok('S10 foreign employeeId rejected', !r.ok, r.reason);
}

// 2. Paid Immutability Tests
{
  const paidBatch = {
    id: 'P-PAID', companyId: 'comp-1', branchId: 'br-1', status: 'paid', month: '2026-09',
    updatedAt: '2026-09-10T00:00:00Z',
    ratesSnapshot: { USD: 1300 },
    items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', netSalary: 5000, grossSalary: 6000, basicSalary: 4000, exchangeRate: 1300, baseAmount: 6500000 }],
  };
  const cohrUser = mkUser('u-cohr2', 'company_hr', 'comp-1'); // has payroll.edit
  const ctxCo = ctxOf(cohrUser);

  // Attempt to modify netSalary on paid batch
  const editedNet = { ...paidBatch, updatedAt: '2026-09-16T00:00:00Z', items: [{ ...paidBatch.items[0], netSalary: 7000 }] };
  const r1 = scopeValidateWrite('payrolls', [editedNet], ctxCo, getAllEmployees, [paidBatch]);
  ok('P1 paid batch netSalary edit rejected', !r1.ok, r1.reason);

  // Attempt to modify grossSalary on paid batch
  const editedGross = { ...paidBatch, updatedAt: '2026-09-16T00:00:00Z', items: [{ ...paidBatch.items[0], grossSalary: 8000 }] };
  const r2 = scopeValidateWrite('payrolls', [editedGross], ctxCo, getAllEmployees, [paidBatch]);
  ok('P2 paid batch grossSalary edit rejected', !r2.ok, r2.reason);

  // Attempt to modify basicSalary on paid batch
  const editedBasic = { ...paidBatch, updatedAt: '2026-09-16T00:00:00Z', items: [{ ...paidBatch.items[0], basicSalary: 5000 }] };
  const r3 = scopeValidateWrite('payrolls', [editedBasic], ctxCo, getAllEmployees, [paidBatch]);
  ok('P3 paid batch basicSalary edit rejected', !r3.ok, r3.reason);
}

// 3. Rejection History Append-Only Exact-Prefix Tests
{
  const rejBatch = {
    id: 'P-REJ', companyId: 'comp-1', branchId: 'br-1', status: 'rejected', month: '2026-09',
    updatedAt: '2026-09-10T00:00:00Z',
    rejectionHistory: [
      { act: 'reject', by: 'audit', at: '2026-09-11T00:00:00Z', reason: 'bad' },
      { act: 'reject', by: 'audit', at: '2026-09-12T00:00:00Z', reason: 'worse' }
    ],
    items: [{ employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1' }],
  };
  const cohrUser = mkUser('u-cohr3', 'company_hr', 'comp-1');
  const ctxCo = ctxOf(cohrUser);

  // Same-length replacement (tampering with first history item)
  const tampered = {
    ...rejBatch, updatedAt: '2026-09-16T00:00:00Z',
    rejectionHistory: [
      { act: 'reject', by: 'audit', at: '2026-09-11T00:00:00Z', reason: 'forged' },
      { act: 'reject', by: 'audit', at: '2026-09-12T00:00:00Z', reason: 'worse' }
    ]
  };
  const r1 = scopeValidateWrite('payrolls', [tampered], ctxCo, getAllEmployees, [rejBatch]);
  ok('H1 rejectionHistory same-length reason replacement rejected', !r1.ok, r1.reason);

  // Appending valid new history entry
  const appended = {
    ...rejBatch, updatedAt: '2026-09-16T00:00:00Z',
    rejectionHistory: [
      ...rejBatch.rejectionHistory,
      { act: 'submit', by: 'cohr', at: '2026-09-16T10:00:00Z', reason: 'fixed' }
    ]
  };
  const r2 = scopeValidateWrite('payrolls', [appended], ctxCo, getAllEmployees, [rejBatch]);
  ok('H2 rejectionHistory valid append accepted', r2.ok, r2.reason ? r2.reason : '');
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('Failures:\n' + failures.join('\n'));
  process.exit(1);
}
process.exit(0);
