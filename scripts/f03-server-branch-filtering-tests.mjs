// ==========================================
// F-03 Regression Tests: Server-side branchId Filtering on Paid Payrolls
// ==========================================

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { filterCollectionRead, getScope, isItemPermitted } = await import('../server-authz.mjs');

let passed = 0;
let total = 0;
function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('\n--- Running F-03 Server-Side BranchId Filtering Tests ---');

// Fixture Users
const uBranch1HR = {
  id: 'u-br1-hr',
  name: 'Branch 1 HR',
  role: 'branch_hr',
  assignedCompanyId: 'comp-1',
  assignedBranchId: 'br-1',
};

const uMultiBranchUser = {
  id: 'u-multi-br',
  name: 'Multi-Branch Reviewer',
  role: 'payroll_admin',
  assignedCompanyId: 'comp-1',
  assignedBranches: ['br-1', 'br-2'],
};

const uSuperAdmin = {
  id: 'u-super',
  name: 'Super Admin',
  role: 'super_admin',
};

// Fixture Employees
const employees = [
  { id: 'emp-b1-1', name: 'B1 Emp 1', companyId: 'comp-1', branchId: 'br-1' },
  { id: 'emp-b2-1', name: 'B2 Emp 1', companyId: 'comp-1', branchId: 'br-2' },
  { id: 'emp-b3-1', name: 'B3 Emp 1', companyId: 'comp-1', branchId: 'br-3' },
];
const getAllEmployees = () => employees;

// Fixture Payroll Batches
const payrollBatches = [
  {
    id: 'PAYROLL-2026-08-BR1',
    month: '2026-08',
    companyId: 'comp-1',
    branchId: 'br-1',
    status: 'paid',
    items: [
      { employeeId: 'emp-b1-1', companyId: 'comp-1', branchId: 'br-1', netSalary: 5000, isPaid: true }
    ],
  },
  {
    id: 'PAYROLL-2026-08-BR2',
    month: '2026-08',
    companyId: 'comp-1',
    branchId: 'br-2',
    status: 'paid',
    items: [
      { employeeId: 'emp-b2-1', companyId: 'comp-1', branchId: 'br-2', netSalary: 5500, isPaid: true }
    ],
  },
  {
    id: 'PAYROLL-2026-08-BR3',
    month: '2026-08',
    companyId: 'comp-1',
    branchId: 'br-3',
    status: 'paid',
    items: [
      { employeeId: 'emp-b3-1', companyId: 'comp-1', branchId: 'br-3', netSalary: 6000, isPaid: true }
    ],
  },
  {
    id: 'PAYROLL-2026-09-BR1-DRAFT',
    month: '2026-09',
    companyId: 'comp-1',
    branchId: 'br-1',
    status: 'draft',
    items: [
      { employeeId: 'emp-b1-1', companyId: 'comp-1', branchId: 'br-1', netSalary: 5000, isPaid: false }
    ],
  },
  {
    id: 'PAYROLL-EMPTY-BR2',
    month: '2026-07',
    companyId: 'comp-1',
    branchId: 'br-2',
    status: 'paid',
    items: [],
  }
];

// TEST 1: Same Company / Same Branch
test('Same company / same branch: user receives only payrolls for their assigned branch', () => {
  const scope = getScope(uBranch1HR);
  const ctx = { user: uBranch1HR, scope };

  const res = filterCollectionRead('payrolls', payrollBatches, ctx, getAllEmployees);

  assert.equal(Array.isArray(res), true);
  assert.equal(res.length, 2, 'Should include only BR1 batches (1 paid + 1 draft)');
  assert.ok(res.every(b => b.branchId === 'br-1'), 'All returned batches must strictly belong to br-1');
  assert.ok(!res.some(b => b.branchId === 'br-2'), 'br-2 batch must be excluded');
  assert.ok(!res.some(b => b.branchId === 'br-3'), 'br-3 batch must be excluded');
});

// TEST 2: Same Company / Another Branch is Filtered Out
test('Same company / another branch: out-of-scope branch payrolls are completely hidden', () => {
  const scope = getScope(uBranch1HR);
  const ctx = { user: uBranch1HR, scope };

  const res = filterCollectionRead('payrolls', payrollBatches, ctx, getAllEmployees);

  const foundBr2 = res.find(b => b.id === 'PAYROLL-2026-08-BR2');
  const foundBr3 = res.find(b => b.id === 'PAYROLL-2026-08-BR3');
  assert.equal(foundBr2, undefined, 'Branch 2 payroll must never be returned');
  assert.equal(foundBr3, undefined, 'Branch 3 payroll must never be returned');
});

// TEST 3: Multi-Branch User Support
test('Multi-branch user: receives payrolls for all assigned branches, but not unassigned branches', () => {
  const scope = getScope(uMultiBranchUser);
  assert.equal(scope.branchScoped, true, 'Multi-branch user must be marked branchScoped');
  assert.equal(scope.allowedBranchIds.has('br-1'), true);
  assert.equal(scope.allowedBranchIds.has('br-2'), true);
  assert.equal(scope.allowedBranchIds.has('br-3'), false);

  const ctx = { user: uMultiBranchUser, scope };
  const res = filterCollectionRead('payrolls', payrollBatches, ctx, getAllEmployees);

  assert.ok(res.some(b => b.id === 'PAYROLL-2026-08-BR1'), 'Must include BR1 batch');
  assert.ok(res.some(b => b.id === 'PAYROLL-2026-08-BR2'), 'Must include BR2 batch');
  assert.ok(!res.some(b => b.id === 'PAYROLL-2026-08-BR3'), 'Must NOT include BR3 batch');
});

// TEST 4: Multi-Branch User filtering with explicit query param
test('Multi-branch user: query parameter ?branchId=br-1 narrows results to that branch', () => {
  const scope = getScope(uMultiBranchUser);
  const ctx = { user: uMultiBranchUser, scope };

  const res = filterCollectionRead('payrolls', payrollBatches, ctx, getAllEmployees, { branchId: 'br-1' });

  assert.ok(res.every(b => b.branchId === 'br-1'), 'Must only return br-1 batches when requested');
  assert.ok(!res.some(b => b.branchId === 'br-2'), 'br-2 must be excluded when br-1 requested');
});

// TEST 5: Branch Spoofing Prevention
test('Spoofing prevention: user assigned to br-1 requesting ?branchId=br-2 gets empty array (blocked)', () => {
  const scope = getScope(uBranch1HR);
  const ctx = { user: uBranch1HR, scope };

  // User attempts to spoof ?branchId=br-2
  const res = filterCollectionRead('payrolls', payrollBatches, ctx, getAllEmployees, { branchId: 'br-2' });

  assert.equal(Array.isArray(res), true);
  assert.equal(res.length, 0, 'Spoofed branchId request must return empty list');
});

// TEST 6: Status Filtering (?status=paid)
test('Status filtering: server honors ?status=paid on filtered payrolls', () => {
  const scope = getScope(uBranch1HR);
  const ctx = { user: uBranch1HR, scope };

  const res = filterCollectionRead('payrolls', payrollBatches, ctx, getAllEmployees, { status: 'paid' });

  assert.equal(res.length, 1, 'Only 1 paid batch for br-1');
  assert.equal(res[0].id, 'PAYROLL-2026-08-BR1');
  assert.equal(res[0].status, 'paid');
});

// TEST 7: Zero Leakage on Direct API for Empty/Orphan Batches
test('Direct API leakage protection: empty batch belonging to another branch is NOT leaked', () => {
  const scope = getScope(uBranch1HR);
  const ctx = { user: uBranch1HR, scope };

  const res = filterCollectionRead('payrolls', payrollBatches, ctx, getAllEmployees);

  const foundEmptyBr2 = res.find(b => b.id === 'PAYROLL-EMPTY-BR2');
  assert.equal(foundEmptyBr2, undefined, 'Empty batch for br-2 must NOT leak to br-1 user');
});

// TEST 8: Super Admin sees all branches
test('Super admin bypass: super admin can view all branches or filter cleanly', () => {
  const scope = getScope(uSuperAdmin);
  const ctx = { user: uSuperAdmin, scope };

  const resAll = filterCollectionRead('payrolls', payrollBatches, ctx, getAllEmployees);
  assert.equal(resAll.length, payrollBatches.length, 'Super admin sees all batches');

  const resBr2 = filterCollectionRead('payrolls', payrollBatches, ctx, getAllEmployees, { branchId: 'br-2' });
  assert.ok(resBr2.every(b => b.branchId === 'br-2'), 'Super admin filter to br-2 works cleanly');
});

console.log(`\nF-03 Test Summary: ${passed}/${total} passed`);
if (passed !== total) process.exit(1);
