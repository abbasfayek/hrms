// =========================================================
// P2.1 Test Matrix — Employee + Attendance→Payroll + Leave
// Data-integrity guards, scope isolation & regression anchors.
// Usage: node scripts/p2-1-tests.mjs   (npm run p21:test)
//
// Deliberately does NOT modify financial formulas. It only
// verifies the guards added under Approved P2.1 (3أ).
// =========================================================

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
  };
}
if (!globalThis.window) globalThis.window = globalThis;

const JS = 'file:///C:/Users/Pc%20Zone/Desktop/hr/public/js/';

let passed = 0;
let failed = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}`); }
};

const { storage } = await import(`${JS}storage.js`);
const { defaultCompanies, defaultSettings } = await import(`${JS}seedData.js`);
const { calculateLeaveBalance } = await import(`${JS}engines/leaveEngine.js`);
const { getDailyRate, getMinuteRate } = await import(`${JS}engines/wageEngine.js`);
const { getEmployeeHourlyQuota, validateHourlyLeaveRequest, calculateHourlyBalance } = await import(`${JS}engines/hourlyLeaveEngine.js`);
const { generateMonthlyPayroll } = await import(`${JS}engines/payrollEngine.js`);

store.clear();
storage.seedIfMissing();
storage.saveCompanies(defaultCompanies);
storage.saveSettings({ ...defaultSettings, currencySymbol: '$', dailyRateMethod: 'workingDays' });

const mkEmp = (id, extra = {}) => ({
  id,
  fullName: `Emp ${id}`,
  fullNameEn: `Emp ${id} En`,
  companyId: 'comp-1',
  branchId: 'br-1',
  department: 'IT',
  jobTitle: 'Engineer',
  hireDate: '2018-01-01',
  status: 'active',
  contractType: 'full_time',
  basicSalary: 6000,
  housingAllowance: 1500,
  transportAllowance: 600,
  otherAllowances: 0,
  gender: 'male',
  ...extra,
});

const empA = mkEmp('emp-p21-a');
const empB = mkEmp('emp-p21-b', { branchId: 'br-2' });
const empNoScope = mkEmp('emp-p21-ns', { companyId: '', branchId: '' });
const empInactive = mkEmp('emp-p21-resigned', { status: 'resigned' });
storage.saveEmployees([empA, empB, empNoScope, empInactive]);

console.log('  [Attendance integrity guards]');
const attVals = {
  employeeId: empA.id, companyId: empA.companyId, branchId: empA.branchId,
  date: '2026-08-03', status: 'present', checkIn: '08:00', checkOut: '17:00',
  workingHours: 8, lateMinutes: 0, notes: '',
};
let res = storage.addAttendance({ id: 'att-p21-1', ...attVals });
ok('valid attendance saved', res.ok === true && storage.findAttendanceByDay(empA.id, '2026-08-03')?.id === 'att-p21-1');

res = storage.addAttendance({ id: 'att-p21-dup', ...attVals, lateMinutes: 30 });
ok('duplicate employeeId+date rejected', res.ok === false && res.error === 'duplicate_attendance');
ok('no second record persisted', storage.getState().attendance.filter((a) => a.employeeId === empA.id && a.date === '2026-08-03').length === 1);

res = storage.updateAttendance({ id: 'att-p21-1', ...attVals, status: 'late', lateMinutes: 15 });
ok('updateAttendance edits existing record (edit flow)', res.ok === true && storage.findAttendanceByDay(empA.id, '2026-08-03')?.status === 'late');

res = storage.updateAttendance({ id: 'att-p21-1', ...attVals, checkIn: '18:00', checkOut: '09:00' });
ok('checkOut before checkIn rejected', res.ok === false && res.error === 'checkout_before_checkin');

res = storage.addAttendance({ id: 'att-neg', employeeId: empA.id, date: '2026-08-04', workingHours: -2 });
ok('negative workingHours rejected', res.ok === false && res.error === 'negative_value');
res = storage.addAttendance({ id: 'att-neg2', employeeId: empA.id, date: '2026-08-04', lateMinutes: -5 });
ok('negative lateMinutes rejected', res.ok === false && res.error === 'negative_value');

res = storage.addAttendance({ id: 'att-ghost', employeeId: 'emp-does-not-exist', date: '2026-08-05' });
ok('attendance for unknown employee rejected', res.ok === false && res.error === 'employee_not_found');
res = storage.addAttendance({ id: 'att-noscope', employeeId: empNoScope.id, date: '2026-08-05' });
ok('attendance for no-scope employee rejected', res.ok === false && res.error === 'no_scope');

console.log('  [Leave integrity guards]');
storage.saveLeaves([]);
res = storage.addLeave({ id: 'lv-p21-1', employeeId: empA.id, leaveType: 'annual', startDate: '2026-08-10', endDate: '2026-08-11', daysCount: 2, status: 'approved' });
ok('valid leave saved', res.ok === true);

res = storage.addLeave({ id: 'lv-p21-overlap', employeeId: empA.id, leaveType: 'annual', startDate: '2026-08-11', endDate: '2026-08-14', daysCount: 3, status: 'pending' });
ok('overlapping pending leave rejected', res.ok === false && res.error === 'leave_overlap');

res = storage.addLeave({ id: 'lv-p21-overlap2', employeeId: empA.id, leaveType: 'annual', startDate: '2026-08-09', endDate: '2026-08-10', daysCount: 2, status: 'approved' });
ok('overlapping approved leave rejected', res.ok === false && res.error === 'leave_overlap');

res = storage.addLeave({ id: 'lv-p21-ok', employeeId: empA.id, leaveType: 'annual', startDate: '2026-08-20', endDate: '2026-08-21', daysCount: 2, status: 'approved' });
ok('non-overlapping leave accepted', res.ok === true);

res = storage.addLeave({ id: 'lv-p21-ghost', employeeId: 'nope', leaveType: 'annual', startDate: '2026-08-01', endDate: '2026-08-02', daysCount: 2, status: 'approved' });
ok('leave for unknown employee rejected', res.ok === false && res.error === 'employee_not_found');
res = storage.addLeave({ id: 'lv-p21-noscope', employeeId: empNoScope.id, leaveType: 'annual', startDate: '2026-08-01', endDate: '2026-08-02', daysCount: 2, status: 'approved' });
ok('leave for no-scope employee rejected', res.ok === false && res.error === 'no_scope');
res = storage.addLeave({ id: 'lv-p21-inactive', employeeId: empInactive.id, leaveType: 'annual', startDate: '2026-08-01', endDate: '2026-08-02', daysCount: 2, status: 'approved' });
ok('leave for inactive employee rejected', res.ok === false && res.error === 'inactive_employee');
res = storage.addLeave({ id: 'lv-p21-bad1', employeeId: empA.id, leaveType: 'annual', startDate: '2026-08-20', endDate: '2026-08-10', daysCount: 2, status: 'approved' });
ok('invalid range (end before start) rejected', res.ok === false && res.error === 'invalid_range');
res = storage.addLeave({ id: 'lv-p21-bad2', employeeId: empA.id, leaveType: 'annual', startDate: '2026-08-30', endDate: '2026-08-30', daysCount: 0, status: 'approved' });
ok('zero day-count rejected', res.ok === false && res.error === 'invalid_range');

res = storage.addLeave({ id: 'lv-p21-rej-overlap', employeeId: empA.id, leaveType: 'sick', startDate: '2026-08-11', endDate: '2026-08-11', daysCount: 1, status: 'rejected' });
ok('rejected overlapping leave is allowed (does not consume)', res.ok === true);

res = storage.updateLeave({ id: 'lv-p21-ok', employeeId: empA.id, leaveType: 'annual', startDate: '2026-08-19', endDate: '2026-08-21', daysCount: 3, status: 'approved' });
ok('updateLeave excludes itself from the overlap check', res.ok === true);

res = storage.updateLeave({ id: 'lv-p21-ok', employeeId: empA.id, leaveType: 'annual', startDate: '2026-08-09', endDate: '2026-08-11', daysCount: 3, status: 'approved' });
ok('updateLeave into another resident leave rejected', res.ok === false && res.error === 'leave_overlap');

res = storage.updateLeave({ id: 'lv-p21-1', employeeId: empA.id, leaveType: 'annual', startDate: '2026-08-10', endDate: '2026-08-11', daysCount: 2, status: 'cancelled' });
ok('cancelled status persisted (balance-restoring cancel)', res.ok === true);
res = storage.addLeave({ id: 'lv-p21-after-cancel', employeeId: empA.id, leaveType: 'annual', startDate: '2026-08-10', endDate: '2026-08-11', daysCount: 2, status: 'approved' });
ok('new request allowed after the overlapping leave was cancelled', res.ok === true);

console.log('  [Hourly leave integrity guards]');
storage.saveHourlyLeaves([]);
res = storage.addHourlyLeave({ id: 'hl-p21-1', employeeId: empA.id, date: '2026-08-06', hours: 1, startTime: '09:00', endTime: '10:00', status: 'approved' });
ok('valid hourly leave saved', res.ok === true);
res = storage.addHourlyLeave({ id: 'hl-p21-ghost', employeeId: 'nope', date: '2026-08-06', hours: 1, status: 'approved' });
ok('hourly leave for unknown employee rejected', res.ok === false && res.error === 'employee_not_found');
res = storage.addHourlyLeave({ id: 'hl-p21-noscope', employeeId: empNoScope.id, date: '2026-08-06', hours: 1, status: 'approved' });
ok('hourly leave for no-scope employee rejected', res.ok === false && res.error === 'no_scope');

const quota = getEmployeeHourlyQuota(empA, defaultCompanies[0], storage.getState().settings);
ok('hourly quota resolved (4 default)', quota === 4);
let v = validateHourlyLeaveRequest(empA.id, 2, '2026-08-07', storage.get('hrms_hourly_leaves_v3', []), quota);
ok('in-quota hourly request accepted', v.valid === true);
storage.addHourlyLeave({ id: 'hl-p21-reserve', employeeId: empA.id, date: '2026-08-08', hours: 1, status: 'approved' });
v = validateHourlyLeaveRequest(empA.id, 2, '2026-08-09', storage.get('hrms_hourly_leaves_v3', []), quota);
ok('request at exactly remaining quota accepted', v.valid === true);
v = validateHourlyLeaveRequest(empA.id, 3, '2026-08-09', storage.get('hrms_hourly_leaves_v3', []), quota);
ok('request beyond remaining quota rejected', v.valid === false);
const bal = calculateHourlyBalance(empA.id, storage.get('hrms_hourly_leaves_v3', []), '2026-08', quota);
ok('hourly balance usedHours = 2', bal.usedHours === 2);
storage.addHourlyLeave({ id: 'hl-p21-pending', employeeId: empA.id, date: '2026-08-10', hours: 1, status: 'pending' });
const balPending = calculateHourlyBalance(empA.id, storage.get('hrms_hourly_leaves_v3', []), '2026-08', quota);
ok('pending hours are reserved in remaining', balPending.remainingHours === 1);
v = validateHourlyLeaveRequest(empA.id, 2, '2026-08-11', storage.get('hrms_hourly_leaves_v3', []), quota);
ok('new request blocked when approved+pending fill quota', v.valid === false);

console.log('  [Multi-company/branch scope isolation]');
storage.saveEmployees([empA, empB, empNoScope, empInactive]);
storage.saveAttendance([]);
storage.saveLeaves([]);
storage.saveHourlyLeaves([]);
storage.addAttendance({ id: 'att-scope-a', employeeId: empA.id, date: '2026-08-12', status: 'present' });
storage.addAttendance({ id: 'att-scope-b', employeeId: empB.id, date: '2026-08-12', status: 'present' });
storage.addLeave({ id: 'lv-scope-a', employeeId: empA.id, leaveType: 'annual', startDate: '2026-09-01', endDate: '2026-09-02', daysCount: 2, status: 'approved' });
storage.addLeave({ id: 'lv-scope-b', employeeId: empB.id, leaveType: 'annual', startDate: '2026-09-01', endDate: '2026-09-02', daysCount: 2, status: 'approved' });
storage.addHourlyLeave({ id: 'hl-scope-a', employeeId: empA.id, date: '2026-09-01', hours: 1, status: 'approved' });
storage.addHourlyLeave({ id: 'hl-scope-b', employeeId: empB.id, date: '2026-09-01', hours: 1, status: 'approved' });

storage.addUser({ id: 'usr-branch-hr', username: 'branchhr', password: 'x', name: 'Branch HR', role: 'branch_hr', assignedCompanyId: 'comp-1', assignedBranchId: 'br-1', permissions: null });
storage.setActiveUser('usr-branch-hr');
let scopedState = storage.getState();
ok('branch HR sees only its branch employees', scopedState.employees.some((e) => e.id === 'emp-p21-a') && !scopedState.employees.some((e) => e.id === 'emp-p21-b'));
ok('branch HR sees only its branch attendance', scopedState.attendance.some((a) => a.id === 'att-scope-a') && !scopedState.attendance.some((a) => a.id === 'att-scope-b'));
ok('branch HR sees only its branch leaves', scopedState.leaves.some((l) => l.id === 'lv-scope-a') && !scopedState.leaves.some((l) => l.id === 'lv-scope-b'));
ok('branch HR sees only its branch hourly leaves', scopedState.hourlyLeaves.some((h) => h.id === 'hl-scope-a') && !scopedState.hourlyLeaves.some((h) => h.id === 'hl-scope-b'));

storage.setActiveUser('usr-admin');
scopedState = storage.getState();
ok('super admin sees all attendance after scope switch back', scopedState.attendance.length === 2);
ok('super admin sees all leaves after scope switch back', scopedState.leaves.length === 2);
ok('super admin sees all hourly leaves after scope switch back', scopedState.hourlyLeaves.length === 2);

console.log('  [Half-day (0.5) leave balance]');
storage.saveLeaves([{ id: 'lv-half', employeeId: empA.id, leaveType: 'annual', startDate: '2026-10-01', endDate: '2026-10-01', daysCount: 0.5, status: 'approved' }]);
const halfBal = calculateLeaveBalance(empA, storage.get('hrms_leaves_v3', []), new Date('2026-10-15T00:00:00'), storage.getState().settings);
ok('half-day counts as 0.5 used annual days', halfBal.usedAnnualDays === 0.5);
ok('half-day reduces remaining balance by 0.5', Math.abs((halfBal.totalAvailable - halfBal.remainingAnnualBalance) - 0.5) < 0.001);

console.log('  [Regression anchor: attendance deduction unchanged by guards]');
storage.saveAttendance([]);
storage.addAttendance({ id: 'att-reg-abs', employeeId: empA.id, date: '2026-11-03', status: 'absent' });
storage.addAttendance({ id: 'att-reg-late', employeeId: empA.id, date: '2026-11-04', status: 'late', lateMinutes: 15 });
storage.addAttendance({ id: 'att-reg-pres', employeeId: empA.id, date: '2026-11-05', status: 'present' });
const stateNow = storage.getState();
const batch = generateMonthlyPayroll(
  [empA],
  stateNow.overtime,
  stateNow.loans,
  stateNow.attendance,
  { month: '2026-11', issueDate: '2026-11-30', title: 'P2.1 anchor' },
  stateNow.settings
);
const item = batch.items.find((it) => it.employeeId === empA.id);
const dailyWage = getDailyRate(empA, stateNow.settings, { month: '2026-11', defaultMethod: 'workingDays' });
const minuteWage = getMinuteRate(empA, stateNow.settings, { month: '2026-11', defaultMethod: 'workingDays' });
ok('payroll still generates with guards active', Array.isArray(batch.items) && batch.items.length === 1);
ok('absenceDeduction = 1 × dailyWage (unchanged)', item.absenceDeduction === parseFloat((1 * dailyWage).toFixed(2)));
ok('lateDeduction = 15 × minuteWage (unchanged)', item.lateDeduction === parseFloat((15 * minuteWage).toFixed(2)));

console.log('  [Error text helper]');
ok('recordErrorText returns Arabic fallback', storage.recordErrorText('leave_overlap', false).includes('تتداخل'));
ok('recordErrorText returns English fallback', storage.recordErrorText('checkout_before_checkin', true).includes('Check-out'));

console.log(`\n============================================`);
console.log(`P2.1 TEST MATRIX: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failed:', failures.join(' | ')); }
console.log(`============================================`);
process.exit(failed ? 1 : 0);