// =========================================================
// P5 Fix #1 (X-1) — Scoped Array Overwrite Data-Integrity Tests
// =========================================================
// Core invariant: a scoped user modifying ONE record must NEVER overwrite or
// delete records that belong to other companies/branches. The mutation layer
// merges the intended change into the FULL persisted collection while getState
// keeps returning only the authorized scope.
//
// Suites must FAIL if the old full-array-overwrite behavior is restored: the
// source-grep section (Block 11) asserts no view writes a scoped subset back
// through the whole-collection setters, and Block 12 proves why that pattern
// is destructive.
//
// Usage: node scripts/p5-fix1-scoped-mutation-tests.mjs
// =========================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
if (!globalThis.CustomEvent) globalThis.CustomEvent = class CustomEvent { constructor(t, o = {}) { this.type = t; this.detail = o ? o.detail : null; } };
if (!globalThis.window) globalThis.window = globalThis;

import { storage } from '../public/js/storage.js';
import { executeYearEndRollover } from '../public/js/engines/leaveEngine.js';

// Mock the server bus: persistence POSTs must fire-and-forget without a live server.
storage.apiFetch = async () => ({ status: 200, ok: true });

let passed = 0;
let failed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
}

const deepClone = (v) => JSON.parse(JSON.stringify(v));
const json = (v) => JSON.stringify(v);

// ---------------------------------------------------------
// Fixture: Company A has Branch 1 + Branch 2; Company B has Branch 3.
// br-hr (u-br) is scoped to Company A / Branch 1 ONLY.
// ---------------------------------------------------------
const FIX = {
  companies: [
    { id: 'comp-1', nameAr: 'شركة أ', branches: [{ id: 'br-1', nameAr: 'فرع أ1' }, { id: 'br-2', nameAr: 'فرع أ2' }] },
    { id: 'comp-2', nameAr: 'شركة ب', branches: [{ id: 'br-3', nameAr: 'فرع ب1' }] },
  ],
  users: [
    { id: 'u-admin', role: 'super_admin', name: 'Admin' },
    { id: 'u-br', role: 'branch_hr', name: 'Branch HR', assignedCompanyId: 'comp-1', assignedBranchId: 'br-1' },
    { id: 'u-co', role: 'company_hr', name: 'Company HR', assignedCompanyId: 'comp-1', assignedBranches: ['br-1', 'br-2'] },
  ],
  employees: [
    { id: 'E-A1', companyId: 'comp-1', branchId: 'br-1', employeeNumber: 'A1', fullName: 'AA1', status: 'active', basicSalary: 5000, housingAllowance: 500, transportAllowance: 100, annualLeaveEntitlement: 30, department: 'Ops', jobTitle: 'Officer', hireDate: '2020-01-01' },
    { id: 'E-A2', companyId: 'comp-1', branchId: 'br-2', employeeNumber: 'A2', fullName: 'AA2', status: 'active', basicSalary: 4500, housingAllowance: 400, transportAllowance: 100, annualLeaveEntitlement: 30, department: 'Ops', jobTitle: 'Officer', hireDate: '2020-02-01' },
    { id: 'E-B1', companyId: 'comp-2', branchId: 'br-3', employeeNumber: 'B1', fullName: 'BB1', status: 'active', basicSalary: 6000, housingAllowance: 600, transportAllowance: 100, annualLeaveEntitlement: 30, department: 'Ops', jobTitle: 'Officer', hireDate: '2020-03-01' },
  ],
  hourlyLeaves: [
    { id: 'HL-A1', employeeId: 'E-A1', companyId: 'comp-1', branchId: 'br-1', status: 'pending', date: '2026-09-10', hours: 2 },
    { id: 'HL-A2', employeeId: 'E-A2', companyId: 'comp-1', branchId: 'br-2', status: 'pending', date: '2026-09-11', hours: 1 },
    { id: 'HL-B1', employeeId: 'E-B1', companyId: 'comp-2', branchId: 'br-3', status: 'pending', date: '2026-09-12', hours: 3 },
  ],
  overtime: [
    { id: 'OT-A1', employeeId: 'E-A1', companyId: 'comp-1', branchId: 'br-1', status: 'pending', date: '2026-09-10', hours: 2, hourlyRate: 40, totalAmount: 120, multiplier: 1.5 },
    { id: 'OT-A2', employeeId: 'E-A2', companyId: 'comp-1', branchId: 'br-2', status: 'pending', date: '2026-09-10', hours: 1, hourlyRate: 36, totalAmount: 54, multiplier: 1.5 },
    { id: 'OT-B1', employeeId: 'E-B1', companyId: 'comp-2', branchId: 'br-3', status: 'pending', date: '2026-09-10', hours: 3, hourlyRate: 48, totalAmount: 216, multiplier: 1.5 },
  ],
  attendance: [
    { id: 'AT-A1', employeeId: 'E-A1', companyId: 'comp-1', branchId: 'br-1', date: '2026-09-10', checkIn: '08:00', checkOut: '17:00', status: 'present', source: 'manual' },
    { id: 'AT-A2', employeeId: 'E-A2', companyId: 'comp-1', branchId: 'br-2', date: '2026-09-10', checkIn: '08:00', checkOut: '17:00', status: 'present', source: 'manual' },
    { id: 'AT-B1', employeeId: 'E-B1', companyId: 'comp-2', branchId: 'br-3', date: '2026-09-10', checkIn: '08:00', checkOut: '17:00', status: 'present', source: 'manual' },
    { id: 'AT-BIO-A1', employeeId: 'E-A1', companyId: 'comp-1', branchId: 'br-1', date: TODAY(), checkIn: '08:30', checkOut: '17:00', status: 'present', source: 'biometric_device' },
    { id: 'AT-BIO-B1', employeeId: 'E-B1', companyId: 'comp-2', branchId: 'br-3', date: TODAY(), checkIn: '08:15', checkOut: '17:00', status: 'present', source: 'biometric_device' },
  ],
  holidays: [
    { id: 'HOL-C1', companyId: 'comp-1', branchId: 'br-1', name: 'Holiday A', startDate: '2026-10-01', endDate: '2026-10-02', daysCount: 2, isPaid: true },
    { id: 'HOL-C2', companyId: 'comp-2', branchId: 'br-3', name: 'Holiday B', startDate: '2026-10-03', endDate: '2026-10-04', daysCount: 2, isPaid: true },
  ],
};

function TODAY() {
  return new Date().toISOString().split('T')[0];
}

function seed(actorId = 'u-br') {
  store.clear();
  const fx = deepClone(FIX);
  storage.set('hrms_companies_v3', fx.companies);
  storage.set('hrms_users_v3', fx.users);
  storage.set('hrms_employees_v3', fx.employees);
  storage.set('hrms_hourly_leaves_v3', fx.hourlyLeaves);
  storage.set('hrms_overtime_v3', fx.overtime);
  storage.set('hrms_attendance_v3', fx.attendance);
  storage.set('hrms_holidays_v3', fx.holidays);
  storage.set('hrms_leaves_v3', []);
  storage.set('hrms_active_user_id_v3', actorId);
  storage.setActiveUser(actorId);
  storage.set('hrms_selected_comp_id_v3', 'all');
  storage.set('hrms_selected_branch_id_v3', 'all');
}

function recordById(listKey, id) {
  return storage.get(listKey, []).find((r) => r.id === id) || null;
}

console.log('\n=== P5 Fix #1 (X-1): Scoped Mutation Data Integrity ===');

// ---- Block 1: Scope read is preserved (UI still only sees authorized scope) ----
{
  seed('u-br');
  const state = storage.getState();
  ok('1. Scoped read: employees only Comp-A/Branch-1', state.employees.length === 1 && state.employees[0].id === 'E-A1');
  ok('1b. Scoped read: hourlyLeaves only Comp-A/Branch-1', state.hourlyLeaves.length === 1 && state.hourlyLeaves[0].id === 'HL-A1');
  ok('1c. Scoped read: overtime only Comp-A/Branch-1', state.overtime.length === 1 && state.overtime[0].id === 'OT-A1');
  ok('1d. Scoped read: attendance only Comp-A/Branch-1', state.attendance.every((a) => a.id !== 'AT-A2' && a.id !== 'AT-B1') && state.attendance.length === 2);
  ok('1e. Scoped read: holidays only Comp-A/Branch-1', state.holidays.length === 1 && state.holidays[0].id === 'HOL-C1');
}

// ---- Block 2: Hourly leave APPROVE touches only the target record ----
{
  seed('u-br');
  storage.updateHourlyLeave({ ...FIX.hourlyLeaves[0], status: 'approved', approvedAt: '2026-09-15T00:00:00Z', approvedBy: 'Branch HR' });
  const full = storage.get('hrms_hourly_leaves_v3', []);
  ok('2. Approve: target record changed to approved', recordById('hrms_hourly_leaves_v3', 'HL-A1')?.status === 'approved');
  ok('2b. Approve: Branch-2 record (same company) preserved byte-for-byte', json(full.find((l) => l.id === 'HL-A2')) === json(FIX.hourlyLeaves[1]));
  ok('2c. Approve: Company-B record preserved byte-for-byte', json(full.find((l) => l.id === 'HL-B1')) === json(FIX.hourlyLeaves[2]));
  ok('2d. Approve: collection size unchanged (3 records)', full.length === 3);
}

// ---- Block 3: Hourly leave REJECT touches only the target record ----
{
  seed('u-br');
  storage.updateHourlyLeave({ ...FIX.hourlyLeaves[0], status: 'rejected', rejectedAt: '2026-09-15T00:00:00Z' });
  const full = storage.get('hrms_hourly_leaves_v3', []);
  ok('3. Reject: target record changed to rejected', recordById('hrms_hourly_leaves_v3', 'HL-A1')?.status === 'rejected');
  ok('3b. Reject: Branch-2 record preserved byte-for-byte', json(full.find((l) => l.id === 'HL-A2')) === json(FIX.hourlyLeaves[1]));
  ok('3c. Reject: Company-B record preserved byte-for-byte', json(full.find((l) => l.id === 'HL-B1')) === json(FIX.hourlyLeaves[2]));
  ok('3d. Reject: collection size unchanged', full.length === 3);
}

// ---- Block 4: Hourly leave DELETE touches only the target record ----
{
  seed('u-br');
  storage.deleteHourlyLeave('HL-A1');
  const full = storage.get('hrms_hourly_leaves_v3', []);
  ok('4. Delete: target removed', full.length === 2 && !full.some((l) => l.id === 'HL-A1'));
  ok('4b. Delete: Branch-2 record preserved byte-for-byte', json(full.find((l) => l.id === 'HL-A2')) === json(FIX.hourlyLeaves[1]));
  ok('4c. Delete: Company-B record preserved byte-for-byte', json(full.find((l) => l.id === 'HL-B1')) === json(FIX.hourlyLeaves[2]));
}

// ---- Block 5: Overtime APPROVE touches only the target record ----
{
  seed('u-br');
  const res = storage.updateOvertime({ ...FIX.overtime[0], status: 'approved' });
  ok('5. Overtime approve: mutation succeeds', !(res && res.ok === false));
  const full = storage.get('hrms_overtime_v3', []);
  ok('5b. Overtime approve: target changed', recordById('hrms_overtime_v3', 'OT-A1')?.status === 'approved');
  ok('5c. Overtime approve: Branch-2 record preserved byte-for-byte', json(full.find((o) => o.id === 'OT-A2')) === json(FIX.overtime[1]));
  ok('5d. Overtime approve: Company-B record preserved byte-for-byte', json(full.find((o) => o.id === 'OT-B1')) === json(FIX.overtime[2]));
  ok('5e. Overtime approve: collection size unchanged', full.length === 3);
}

// ---- Block 6: Biometric attendance merge preserves unrelated scope ----
{
  seed('u-br');
  const newLog = { id: 'AT-NEW-A1', employeeId: 'E-A1', companyId: 'comp-1', branchId: 'br-1', date: TODAY(), checkIn: '07:55', checkOut: '17:05', status: 'present', source: 'biometric_device', createdAt: new Date().toISOString() };
  storage.upsertBiometricAttendance([newLog]);
  const full = storage.get('hrms_attendance_v3', []);
  ok('6. Biometric merge: new synced log present', full.some((a) => a.id === 'AT-NEW-A1'));
  ok('6b. Biometric merge: same-scope today biometric replaced (AT-BIO-A1 removed)', !full.some((a) => a.id === 'AT-BIO-A1'));
  ok('6c. Biometric merge: manual Branch-1 attendance preserved', json(full.find((a) => a.id === 'AT-A1')) === json(FIX.attendance[0]));
  ok('6d. Biometric merge: Branch-2 attendance preserved byte-for-byte', json(full.find((a) => a.id === 'AT-A2')) === json(FIX.attendance[1]));
  ok('6e. Biometric merge: Company-B attendance preserved byte-for-byte', json(full.find((a) => a.id === 'AT-B1')) === json(FIX.attendance[2]));
  ok('6f. Biometric merge: Company-B today biometric preserved (out-of-scope)', json(full.find((a) => a.id === 'AT-BIO-B1')) === json(FIX.attendance[4]));
}

// ---- Block 7: Year-end rollover (engine + merge) never touches out-of-scope employees ----
{
  seed('u-br');
  const state = storage.getState();
  const { updatedEmployees, rolloverResults } = executeYearEndRollover(
    state.employees,
    state.leaves || [],
    { targetYear: 2027, maxCarryOverDays: 15, cashOutUnused: false, renewAnnualEntitlement: true },
    state.settings
  );
  ok('7. Rollover: scoped input produced exactly the in-scope employee', updatedEmployees.length === 1 && rolloverResults.length === 1 && updatedEmployees[0].id === 'E-A1');
  storage.mergeEmployeeUpdatesById(updatedEmployees);
  const full = storage.get('hrms_employees_v3', []);
  ok('7b. Rollover: out-of-scope Branch-2 employee preserved byte-for-byte', json(full.find((e) => e.id === 'E-A2')) === json(FIX.employees[1]));
  ok('7c. Rollover: out-of-scope Company-B employee preserved byte-for-byte', json(full.find((e) => e.id === 'E-B1')) === json(FIX.employees[2]));
  ok('7d. Rollover: target employee updated', full.find((e) => e.id === 'E-A1')?.carriedOverLeaveBalance === 15 && full.find((e) => e.id === 'E-A1')?.lastYearBalanceRenewedDate === '2027-01-01');
  ok('7e. Rollover: collection size unchanged (3 employees, none dropped)', full.length === 3);
}

// ---- Block 8: Holiday EDIT merges into the full collection ----
{
  seed('u-br');
  const res = storage.updateHoliday({ ...FIX.holidays[0], name: 'Updated Holiday A' });
  ok('8. Holiday edit: mutation succeeds', !(res && res.ok === false));
  const full = storage.get('hrms_holidays_v3', []);
  ok('8b. Holiday edit: target changed', recordById('hrms_holidays_v3', 'HOL-C1')?.name === 'Updated Holiday A');
  ok('8c. Holiday edit: Company-B holiday preserved byte-for-byte', json(full.find((h) => h.id === 'HOL-C2')) === json(FIX.holidays[1]));
  ok('8d. Holiday edit: collection size unchanged', full.length === 2);
}

// ---- Block 9: Unknown target IDs fail safely (no corruption, no crash) ----
{
  seed('u-br');
  const beforeHl = json(FIX.hourlyLeaves);
  storage.updateHourlyLeave({ ...FIX.hourlyLeaves[0], id: 'HL-NOPE', status: 'approved' });
  ok('9. Unknown hourly-leave ID: safe no-op (collection unchanged)', json(storage.get('hrms_hourly_leaves_v3', [])) === beforeHl);

  const beforeOt = json(FIX.overtime);
  const resOt = storage.updateOvertime({ ...FIX.overtime[0], id: 'OT-NOPE', status: 'approved' });
  ok('9b. Unknown overtime ID: returns not_found', resOt && resOt.ok === false && resOt.error === 'not_found');
  ok('9c. Unknown overtime ID: collection unchanged', json(storage.get('hrms_overtime_v3', [])) === beforeOt);

  const beforeHol = json(FIX.holidays);
  const resHol = storage.updateHoliday({ ...FIX.holidays[0], id: 'HOL-NOPE', name: 'X' });
  ok('9d. Unknown holiday ID: returns not_found', resHol && resHol.ok === false && resHol.error === 'not_found');
  ok('9e. Unknown holiday ID: collection unchanged', json(storage.get('hrms_holidays_v3', [])) === beforeHol);

  storage.upsertBiometricAttendance([]);
  ok('9f. Biometric merge with no logs: attendance collection unchanged', json(storage.get('hrms_attendance_v3', [])) === json(FIX.attendance));

  const beforeEmp = json(FIX.employees);
  const mergedRes = storage.mergeEmployeeUpdatesById([{ ...FIX.employees[0], id: 'EMP-NOPE', carriedOverLeaveBalance: 99 }]);
  ok('9g. Unknown employee ID in merge: ignored (no append, no change)', mergedRes.length === 3 && json(storage.get('hrms_employees_v3', [])) === beforeEmp);
}

// ---- Block 10: RBAC / branch enforcement remains intact ----
{
  seed('u-co'); // company_hr with TWO assigned branches, no branch selected
  const res = storage.updateHourlyLeave({ ...FIX.hourlyLeaves[0], status: 'approved' });
  const full = storage.get('hrms_hourly_leaves_v3', []);
  ok('10. Multi-branch company_hr without branch selection: write denied (branch_required)', res && res.ok === false && res.error === 'branch_required');
  ok('10b. Guard denial left the whole collection untouched', json(full) === json(FIX.hourlyLeaves));

  seed('u-admin'); // super_admin is exempt from branch context
  const resAdmin = storage.updateHourlyLeave({ ...FIX.hourlyLeaves[0], status: 'approved', approvedBy: 'Admin' });
  ok('10c. super_admin: approve succeeds', !(resAdmin && resAdmin.ok === false));
  ok('10d. super_admin: target changed but all scopes intact', recordById('hrms_hourly_leaves_v3', 'HL-A1')?.status === 'approved' && json(storage.get('hrms_hourly_leaves_v3', []).find((l) => l.id === 'HL-A2')) === json(FIX.hourlyLeaves[1]) && json(storage.get('hrms_hourly_leaves_v3', []).find((l) => l.id === 'HL-B1')) === json(FIX.hourlyLeaves[2]));
}

// ---- Block 11: Source-level regression guards ----
// If a future change reintroduces the old full-array-overwrite call sites,
// these assertions fail and the suite protects the X-1 invariant.
{
  const read = (p) => readFileSync(fileURLToPath(new URL(`../public/js/${p}`, import.meta.url)), 'utf8');
  const VH = read('components/HourlyLeaveView.js');
  const AOV = read('components/AttendanceOvertimeView.js');
  const BIO = read('engines/biometricEngine.js');
  const YER = read('components/YearEndRolloverModal.js');
  const HOL = read('components/HolidaysModal.js');
  const STORAGE = read('storage.js');

  ok('11. HourlyLeaveView no longer writes scoped arrays via saveHourlyLeaves', !VH.includes('saveHourlyLeaves('));
  ok('11b. AttendanceOvertimeView uses id-based save: no saveOvertime call, updateOvertime used', !AOV.includes('saveOvertime(') && AOV.includes('storage.updateOvertime(ot)'));
  ok('11c. biometricEngine merges via upsertBiometricAttendance (no saveAttendance)', !BIO.includes('saveAttendance(') && BIO.includes('storage.upsertBiometricAttendance(newLogs)'));
  ok('11d. YearEndRolloverModal merges via mergeEmployeeUpdatesById (no scoped saveEmployees)', !YER.includes('storage.saveEmployees(updatedEmployees)') && YER.includes('storage.mergeEmployeeUpdatesById(updatedEmployees)'));
  ok('11e. HolidaysModal uses id-based updateHoliday (no scoped saveHolidays)', !HOL.includes('saveHolidays(updated)') && HOL.includes('storage.updateHoliday(newHol)'));
  ok('11f. storage exposes all three X-1 safe mutators', STORAGE.includes('mergeEmployeeUpdatesById(updatedList)') && STORAGE.includes('upsertBiometricAttendance(newLogs)') && STORAGE.includes('updateHoliday(hol)'));
}

// ---- Block 12: Guard proof — old scoped-overwrite pattern is destructive ----
{
  seed('u-br');
  const scopedHl = storage.getState().hourlyLeaves; // only [HL-A1] under branch scope
  storage.saveHourlyLeaves(deepClone(scopedHl)); // the OLD buggy call pattern
  const after = storage.get('hrms_hourly_leaves_v3', []);
  ok('12. GUARD PROOF: old saveHourlyLeaves(scoped) drops out-of-scope rows (why the fix is required)', after.length === 1 && after[0].id === 'HL-A1');
}

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}