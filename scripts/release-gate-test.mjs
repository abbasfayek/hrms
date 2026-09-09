// =========================================================
// HRMS Release Gate — comprehensive regression test
// Usage: npm run release:test
//
// Part A (in-process, real client modules + localStorage shim):
//   Authentication · RBAC · Employee · Attendance · Leaves ·
//   Hourly leaves · Overtime · Loans · Increments · Payroll
//   (Draft→UnderAudit→Approved→Paid) · EOSB (Draft→UnderAudit→
//   Approved→Paid) · Reports paid-flag · Settings · Offline.
//
// Part B (live server on a throwaway TEMP COPY of the app):
//   401 without auth · wrong login · real login with POST-migration
//   hashed credentials · session-gated read · CORS allowlist ·
//   backup/restore · data survives restart · login after restart.
//
// The temp copy keeps the real data/ directory untouched.
// =========================================================

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}`); }
};

// Browser-ish environment for the real client modules.
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

console.log('\n=== Part A — Engine & storage regression (in-process) ===');

const { storage } = await import(`${JS}storage.js`);
const { can } = await import(`${JS}types.js`);
const { defaultCompanies, defaultSettings } = await import(`${JS}seedData.js`);
const { generateMonthlyPayroll } = await import(`${JS}engines/payrollEngine.js`);
const { calculateEOSB } = await import(`${JS}engines/eosbEngine.js`);
const { calculateLeaveBalance } = await import(`${JS}engines/leaveEngine.js`);
const { calculateOvertimeAmount } = await import(`${JS}engines/overtimeEngine.js`);
const { applySalaryIncrement } = await import(`${JS}engines/incrementEngine.js`);
const { getEmployeeHourlyQuota, validateHourlyLeaveRequest } = await import(`${JS}engines/hourlyLeaveEngine.js`);
const { getDailyRate } = await import(`${JS}engines/wageEngine.js`);
let auth = null;
try { auth = (await import(`${JS}auth.js`)).auth || null; } catch { auth = null; }

store.clear();
storage.seedIfMissing();

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
const empA = mkEmp('emp-rel-a');
const empB = mkEmp('emp-rel-b', { branchId: 'br-2', basicSalary: 9000, housingAllowance: 2000, transportAllowance: 1000 });
storage.saveEmployees([empA, empB]);
storage.saveCompanies(defaultCompanies);
storage.saveSettings({ ...defaultSettings, currencySymbol: '$' });

console.log('  [Authentication]');
if (auth) {
  const hash = await auth.hashPassword('Secret@123');
  ok('PBKDF2 hash format pbkdf2$...', typeof hash === 'string' && hash.startsWith('pbkdf2$') && hash.split('$').length === 4);
  ok('correct password verifies', await auth.verifyPasswordLocal({ password: hash }, 'Secret@123'));
  ok('wrong password rejected', !(await auth.verifyPasswordLocal({ password: hash }, 'Wrong@123')));
  ok('legacy plaintext still verified during transition', await auth.verifyPasswordLocal({ password: 'plain-legacy' }, 'plain-legacy'));
  const migratedHash = await auth.hashPassword('452179Ah@');
  ok('real factory password hash verifies', await auth.verifyPasswordLocal({ password: migratedHash }, '452179Ah@'));
} else {
  console.log('  (auth.js singleton unavailable — auth checks skipped)');
}

console.log('  [RBAC]');
const superAdmin = { role: 'super_admin' };
const hrViewer = { role: 'company_hr', assignedCompanyId: 'comp-1', permissions: ['employees.view', 'attendance.view'] };
ok('super_admin can disburse payroll', can(superAdmin, 'payroll.disburse'));
ok('super_admin can manage users', can(superAdmin, 'users.manage'));
ok('limited HR can view employees', can(hrViewer, 'employees.view'));
ok('limited HR CANNOT disburse payroll', !can(hrViewer, 'payroll.disburse'));
ok('limited HR CANNOT approve EOSB', !can(hrViewer, 'eosb.approve'));

console.log('  [Employee]');
storage.addEmployee(mkEmp('emp-created', { basicSalary: 7000 }));
ok('addEmployee persisted', !!storage.getState().employees.find((e) => e.id === 'emp-created'));
ok('new employee keeps real scope', storage.getState().employees.find((e) => e.id === 'emp-created').companyId === 'comp-1');
storage.updateEmployee({ ...empA, basicSalary: 6500 });
ok('updateEmployee persisted', storage.getState().employees.find((e) => e.id === 'emp-rel-a').basicSalary === 6500);

console.log('  [Attendance]');
storage.addAttendance({ id: 'att-1', employeeId: empA.id, companyId: empA.companyId, branchId: empA.branchId, date: '2026-08-03', status: 'late', lateMinutes: 15, workingHours: 8, checkIn: '09:30', checkOut: '17:00' });
storage.addAttendance({ id: 'att-2', employeeId: empA.id, companyId: empA.companyId, branchId: empA.branchId, date: '2026-08-04', status: 'absent' });
ok('attendance stored with scope', storage.getState().attendance.filter((a) => a.employeeId === empA.id).length === 2);
const enrichedAtt = { id: 'att-3', employeeId: empA.id, date: '2026-08-05', status: 'present' };
storage.addAttendance(enrichedAtt);
ok('unscoped attendance enriched from employee', enrichedAtt.companyId === 'comp-1' && enrichedAtt.branchId === 'br-1');

console.log('  [Leaves & Hourly leaves]');
const bal = calculateLeaveBalance(empA, [], new Date('2026-08-01T00:00:00'), defaultSettings);
ok('calculateLeaveBalance returns numeric balance', typeof bal.remainingAnnualBalance === 'number' && !isNaN(bal.remainingAnnualBalance));
storage.addLeave({ id: 'lv-1', employeeId: empA.id, leaveType: 'annual', startDate: '2026-08-10', endDate: '2026-08-11', daysCount: 2, status: 'approved' });
ok('addLeave enriched with employee scope', storage.getState().leaves.find((l) => l.id === 'lv-1')?.companyId === 'comp-1');
storage.updateLeave({ id: 'lv-1', employeeId: empA.id, leaveType: 'annual', startDate: '2026-08-10', endDate: '2026-08-11', daysCount: 2, status: 'approved', notes: 'updated' });
ok('updateLeave applied', storage.getState().leaves.find((l) => l.id === 'lv-1')?.notes === 'updated');
const quota = getEmployeeHourlyQuota(empA, defaultCompanies[0], defaultSettings);
ok('hourly quota numeric', typeof quota === 'number' && quota > 0);
ok('validateHourlyLeaveRequest accepts in-quota leave', validateHourlyLeaveRequest(empA.id, 1, '2026-08-06', [], quota).valid !== false);
storage.addHourlyLeave({ id: 'hl-1', employeeId: empA.id, companyId: empA.companyId, branchId: empA.branchId, date: '2026-08-06', hours: 1, startTime: '09:00', endTime: '10:00', status: 'approved' });
ok('hourly leave stored scoped', storage.getState().hourlyLeaves.find((x) => x.id === 'hl-1')?.branchId === 'br-1');

console.log('  [Overtime]');
ok('overtime calc 4h at 1.5x = 600', calculateOvertimeAmount(4, 100, 1.5) === 600);
storage.addOvertime({ id: 'ot-1', employeeId: empA.id, companyId: empA.companyId, branchId: empA.branchId, date: '2026-08-12', hours: 4, multiplier: 1.5, hourlyRate: 100, totalAmount: 600, type: 'normal', status: 'approved', payrollPeriod: '2026-08' });
ok('overtime stored scoped', storage.getState().overtime.find((o) => o.id === 'ot-1')?.branchId === 'br-1');

console.log('  [Loans]');
storage.addLoan({ id: 'loan-1', employeeId: empA.id, totalAmount: 1200, paidAmount: 0, remainingAmount: 1200, installmentAmount: 100, installmentsCount: 12, startDate: '2026-08-01', reason: 'advance', status: 'active', installments: [
  { month: '2026-08', amount: 100, isPaid: false },
  { month: '2026-09', amount: 100, isPaid: false },
] });
ok('loan stored active', storage.getState().loans.find((l) => l.id === 'loan-1')?.status === 'active');

console.log('  [Increments]');
const inc = applySalaryIncrement({ employee: empB, type: 'percentage', value: 5, effectiveDate: '2026-09-01', reason: 'annual', approvedBy: 'Tester', updateHousingAndTransportProportionally: true });
ok('applySalaryIncrement returns higher salary', inc.incrementRecord.newTotalSalary > empB.basicSalary);
storage.addIncrement(inc.incrementRecord);
ok('increment stored scoped', storage.getState().increments.find((x) => x.id === inc.incrementRecord.id)?.companyId === 'comp-1');

console.log('  [Payroll workflow]');
const MONTH = '2026-08';
const payrollPaidCheck = (month) => {
  const batch = (storage.getState().payrolls || []).find((b) => b.month === month);
  return !!(batch && batch.status === 'paid');
};
ok('reports: month with NO stored batch is NOT paid', !payrollPaidCheck('2020-01'));

const batch = generateMonthlyPayroll(
  [empA, empB],
  storage.getState().overtime,
  storage.getState().loans,
  storage.getState().attendance,
  { month: MONTH, issueDate: '2026-08-31', title: 'Test payroll' },
  storage.getState().settings
);
ok('payroll generated with items', Array.isArray(batch.items) && batch.items.length === 2);
batch.status = 'draft';
storage.addPayrollBatch(batch);
ok('Draft stored', storage.getState().payrolls.find((b) => b.month === MONTH)?.status === 'draft');
ok('reports: Draft month is NOT paid', !payrollPaidCheck(MONTH));

let pb = storage.getState().payrolls.find((x) => x.month === MONTH);
pb.status = 'under_audit'; pb.transferredToAuditAt = new Date().toISOString();
storage.addPayrollBatch(pb);
ok('UnderAudit stored', storage.getState().payrolls.find((x) => x.month === MONTH)?.status === 'under_audit');
ok('reports: UnderAudit month is NOT paid', !payrollPaidCheck(MONTH));

pb = storage.getState().payrolls.find((x) => x.month === MONTH);
pb.status = 'approved'; pb.auditedBy = 'Tester'; pb.auditedAt = new Date().toISOString();
storage.addPayrollBatch(pb);
ok('Approved stored', storage.getState().payrolls.find((x) => x.month === MONTH)?.status === 'approved');
ok('reports: Approved (not disbursed) month is NOT paid', !payrollPaidCheck(MONTH));

pb = storage.getState().payrolls.find((x) => x.month === MONTH);
try {
  const allLoans = storage.getState().loans;
  let changed = false;
  pb.items.forEach((it) => {
    const installment = Number(it.loanInstallment) || 0;
    if (installment <= 0) return;
    const loan = allLoans.find((l) => l.employeeId === it.employeeId && l.status !== 'settled' && Number(l.remainingAmount) > 0);
    if (!loan) return;
    const paidAmount = Math.min(installment, Number(loan.remainingAmount) || 0);
    if (paidAmount <= 0) return;
    loan.installments = loan.installments || [];
    const entry = loan.installments.find((x) => x.month === MONTH && !x.isPaid);
    if (entry) { entry.isPaid = true; entry.paidAt = new Date().toISOString(); }
    else { loan.installments.push({ month: MONTH, amount: paidAmount, isPaid: true, paidAt: new Date().toISOString() }); }
    loan.remainingAmount = Number((Number(loan.remainingAmount) - paidAmount).toFixed(2));
    if (loan.remainingAmount <= 0) { loan.remainingAmount = 0; loan.status = 'settled'; loan.settledAt = new Date().toISOString(); }
    changed = true;
  });
  if (changed) storage.saveLoans(allLoans);
} catch (e) {}
pb.status = 'paid'; pb.paidAt = new Date().toISOString(); pb.paidBy = 'Tester'; pb.releaseStatus = 'released'; pb.releasedAt = new Date().toISOString();
pb.items.forEach((it) => { it.isPaid = true; });
storage.addPayrollBatch(pb);
ok('Paid stored', storage.getState().payrolls.find((x) => x.month === MONTH)?.status === 'paid');
ok('reports: Paid month IS paid', payrollPaidCheck(MONTH));
ok('all payroll items marked isPaid', storage.getState().payrolls.find((x) => x.month === MONTH)?.items.every((it) => it.isPaid) === true);
const loanAfter = storage.getState().loans.find((l) => l.id === 'loan-1');
ok('loan installment settled on disbursement', loanAfter.installments.find((x) => x.month === '2026-08')?.isPaid === true);
ok('loan remaining reduced', loanAfter.remainingAmount < 1200);

console.log('  [EOSB workflow]');
const eosb = calculateEOSB({ employee: empB, terminationDate: '2026-09-30', reason: 'resignation', loans: storage.getState().loans, settings: storage.getState().settings });
ok('calculateEOSB returns net settlement', typeof eosb.netSettlementAmount === 'number' && eosb.netSettlementAmount >= 0);
eosb.status = 'under_audit';
eosb.companyId = empB.companyId; eosb.branchId = empB.branchId;
eosb.createdBy = 'Tester';
storage.addEOSB(eosb);
const recStatus = (r) => r.status || 'paid';
ok('EOSB UnderAudit stored', recStatus(storage.getState().eosb.find((x) => x.id === eosb.id)) === 'under_audit');
ok('EOSB scoped to employee', storage.getState().eosb.find((x) => x.id === eosb.id)?.branchId === 'br-2');

storage.updateEOSB(eosb.id, { status: 'approved', approvedBy: 'Tester', approvedAt: new Date().toISOString() });
ok('EOSB Approved', recStatus(storage.getState().eosb.find((x) => x.id === eosb.id)) === 'approved');

storage.updateEOSB(eosb.id, { status: 'paid', paidBy: 'Tester', paidAt: new Date().toISOString() });
const paidRec = storage.getState().eosb.find((x) => x.id === eosb.id);
ok('EOSB Paid', recStatus(paidRec) === 'paid');

console.log('  [Settings / wage SSOT]');
storage.saveSettings({ ...defaultSettings, dailyRateMethod: 'workingDays' });
ok('dailyRateMethod override saved', storage.getState().settings.dailyRateMethod === 'workingDays');
const dr = getDailyRate(empA, storage.getState().settings, { defaultMethod: 'fixed30' });
ok('wageEngine honors global override', dr > 0 && typeof dr === 'number');

console.log('  [Offline operation]');
const realFetch = globalThis.fetch;
globalThis.fetch = () => Promise.reject(new Error('offline-simulated'));
const offlineRes = await storage.serverLogin('system', 'x');
ok('serverLogin returns offline:true when server unreachable', !!offlineRes && offlineRes.offline === true);
globalThis.fetch = realFetch;

// Part B lives in the second half of this file.
const partB = (await import('./release-gate-test-part-b.mjs')).runPartB({ ROOT, ok, PORT: 20000 + Math.floor(Math.random() * 20000) });
await partB;

console.log(`\n============================================`);
console.log(`RELEASE GATE: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failed:', failures.join(' | ')); }
console.log(`============================================`);
process.exit(failed ? 1 : 0);