// =========================================================
// P2.1 UI Automation — Attendance / Absence / Leave modals
// Exercises the real modal components inside a DOM (jsdom):
// create → duplicate→edit flow → guards → saved correctly.
// Usage: node scripts/p2-1-ui-tests.mjs  (npm run p21:uitest)
// =========================================================

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html lang="ar"><head><meta charset="utf-8"></head><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
dom.virtualConsole.on('jsdomError', (err) => { failures.push(`jsdom-error: ${err.message}`); console.error('  JSDOM ERROR:', err.stack || err.message); });
const { window } = dom;
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLSelectElement',
  'HTMLInputElement', 'HTMLFormElement', 'HTMLTextAreaElement', 'Element', 'Node',
  'CustomEvent', 'Event', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame'];
for (const g of globals) if (globalThis[g] === undefined) globalThis[g] = window[g];
globalThis.FormData = window.FormData;
globalThis.localStorage = window.localStorage;

const JS = 'file:///C:/Users/Pc%20Zone/Desktop/hr/public/js/';
const { storage } = await import(`${JS}storage.js`);
const { defaultCompanies, defaultSettings } = await import(`${JS}seedData.js`);
const { openAttendanceModal } = await import(`${JS}components/AttendanceModal.js`);
const { openAbsenceModal } = await import(`${JS}components/AbsenceModal.js`);
const { openLeaveRequestModal } = await import(`${JS}components/LeaveRequestModal.js`);
const { calculateLeaveBalance } = await import(`${JS}engines/leaveEngine.js`);
const { openPayrollCorrectionModal } = await import(`${JS}components/PayrollCorrectionModal.js`);
const { renderReportsView } = await import(`${JS}components/ReportsView.js`);
const { i18n } = await import(`${JS}i18n.js`);

let passed = 0;
let failed = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}`); }
};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => (root || document).querySelectorAll(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setVal(el, value, type = 'change') {
  el.value = value;
  el.dispatchEvent(new window.Event(type, { bubbles: true }));
}
function click(el) {
  el.dispatchEvent(new window.Event('click', { bubbles: true }));
}
async function closeOverlay() {
  const ov = $('.modal-overlay');
  if (ov) {
    const btn = ov.querySelector('.close-btn');
    if (btn) btn.click();
  }
  await sleep(250);
}

storage.seedIfMissing();
storage.saveCompanies(defaultCompanies);
storage.saveSettings({ ...defaultSettings, currencySymbol: 'ر.س' });
storage.setSelectedCompanyId('all');
storage.setSelectedBranchId('all');
storage.setSelectedCompanyId('comp-1');
storage.setSelectedBranchId('br-1');

const empA = {
  id: 'emp-ui-1',
  fullName: 'موظف الاختبار',
  fullNameEn: 'UI Tester',
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
  employeeNumber: 'EMP-UI-1',
  gender: 'male',
};
storage.saveEmployees([empA]);

console.log('  [AttendanceModal: create → duplicate→edit → guards]');
storage.saveAttendance([]);
let savedCount = 0;
openAttendanceModal(() => savedCount++);
let ov = $('.modal-overlay');
ok('overlay rendered', !!ov);
ok('edit banner hidden on fresh record', $('#att-edit-banner', ov).style.display === 'none');
setVal($('#att-date-input', ov), '2026-09-01');
ok('banner still hidden for empty day', $('#att-edit-banner', ov).style.display === 'none');
setVal($('#att-status-select', ov), 'absent');
setVal($('#att-working-hours', ov), '0');
setVal($('#att-notes', ov), 'automated UI test');
click($('.submit-att-btn', ov));
await sleep(300);
let atts = storage.getState().attendance;
ok('record saved through modal', atts.length === 1 && atts[0].status === 'absent');
ok('explicit zero working hours preserved', Number(atts[0].workingHours) === 0);
ok('notes stored', atts[0].notes === 'automated UI test');
ok('onSaved fired', savedCount === 1);

openAttendanceModal(() => savedCount++);
ov = $('.modal-overlay');
setVal($('#att-date-input', ov), '2026-09-01');
ok('duplicate date → edit banner shown', $('#att-edit-banner', ov).style.display === 'block');
ok('existing record prefilled into the form', $('#att-status-select', ov).value === 'absent' && $('#att-working-hours', ov).value === '0');
setVal($('#att-status-select', ov), 'present');
setVal($('#att-working-hours', ov), '8');
click($('.submit-att-btn', ov));
await sleep(300);
atts = storage.getState().attendance;
ok('duplicate submit UPDATED the existing record (no second record)', atts.length === 1 && atts[0].status === 'present');

openAttendanceModal(() => savedCount++);
ov = $('.modal-overlay');
setVal($('#att-date-input', ov), '2026-09-01');
setVal($('#att-check-in', ov), '18:00');
setVal($('#att-check-out', ov), '09:00');
click($('.submit-att-btn', ov));
await sleep(120);
atts = storage.getState().attendance;
ok('checkOut before checkIn blocked at modal level (no write)', atts.length === 1 && atts[0].status === 'present');
ok('danger toast shown for guard error', !!$('.toast-danger'));
await closeOverlay();

console.log('  [AbsenceModal: prefill → edit → factor stored]');
storage.saveAttendance([]);
let stored = storage.addAttendance({ id: 'att-ui-late', employeeId: 'emp-ui-1', companyId: 'comp-1', branchId: 'br-1', date: '2026-09-02', status: 'late', lateMinutes: 45, checkIn: '09:30', checkOut: '17:00' });
ok('seed late record via storage', stored.ok === true);
let absentSaved = 0;
openAbsenceModal(null, () => absentSaved++);
ov = $('.modal-overlay');
setVal($('#absence-date-input', ov), '2026-09-02');
ok('existing late record → edit banner + prefilled type', $('#absence-edit-banner', ov).style.display === 'block' && $('#absence-type-select', ov).value === 'late');
ok('late minutes prefilled', $('#late-minutes-input', ov).value === '45');
setVal($('#late-minutes-input', ov), '30');
click($('.submit-absence-btn', ov));
await sleep(300);
atts = storage.getState().attendance;
ok('absence edit saved (still one record)', atts.length === 1 && atts[0].status === 'late');
ok('edited minutes applied', Number(atts[0].lateMinutes) === 30);
ok('absence onSaved fired', absentSaved === 1);

openAbsenceModal(null, () => absentSaved++);
ov = $('.modal-overlay');
setVal($('#absence-date-input', ov), '2026-09-03');
setVal($('#absence-type-select', ov), 'absent');
setVal($('#deductible-days-select', ov), '2');
click($('.submit-absence-btn', ov));
await sleep(300);
atts = storage.getState().attendance;
const newAbs = atts.find((a) => a.date === '2026-09-03');
ok('new absence saved with stored deduction factor', !!newAbs && Number(newAbs.deductibleDays) === 2);
ok('present records are not silently converted (new record only)', atts.length === 2);

console.log('  [LeaveRequestModal: new → overlap → half-day → cancelled edit]');
storage.saveLeaves([]);
let leaveSaved = 0;
openLeaveRequestModal('emp-ui-1', () => leaveSaved++, null);
ov = $('.modal-overlay');
setVal($('#leave-start-date', ov), '2026-09-07');
setVal($('#leave-end-date', ov), '2026-09-07');
click($('.submit-leave-btn', ov));
await sleep(300);
let leaves = storage.getState().leaves;
ok('new annual leave saved', leaves.length === 1 && leaves[0].daysCount === 1);

openLeaveRequestModal('emp-ui-1', () => leaveSaved++, null);
ov = $('.modal-overlay');
setVal($('#leave-start-date', ov), '2026-09-07');
setVal($('#leave-end-date', ov), '2026-09-07');
click($('.submit-leave-btn', ov));
await sleep(120);
leaves = storage.getState().leaves;
ok('overlapping leave rejected (no second record)', leaves.length === 1);
ok('overlap error toast shown', !!$('.toast-danger'));
await closeOverlay();

openLeaveRequestModal('emp-ui-1', () => leaveSaved++, null);
ov = $('.modal-overlay');
setVal($('#leave-start-date', ov), '2026-09-08');
setVal($('#leave-end-date', ov), '2026-09-08');
const halfBox = $('#leave-half-day', ov);
ok('half-day box visible for single-day leave', getComputedStyle(halfBox.closest('#leave-half-day-block')).display !== 'none');
halfBox.click();
click($('.submit-leave-btn', ov));
await sleep(300);
leaves = storage.getState().leaves;
ok('half-day leave saved as 0.5 days', leaves.find((l) => l.startDate === '2026-09-08')?.daysCount === 0.5);

let lvCancelled = storage.addLeave({ id: 'lv-ui-c', employeeId: 'emp-ui-1', leaveType: 'annual', startDate: '2026-09-09', endDate: '2026-09-10', daysCount: 2, status: 'approved' });
ok('seed cancellable approved leave', lvCancelled.ok === true);
const theLeave = storage.get('hrms_leaves_v3', []).find((l) => l.id === 'lv-ui-c');

openLeaveRequestModal('emp-ui-1', () => leaveSaved++, theLeave);
ov = $('.modal-overlay');
ok('edit mode opens with approved status selected', $('#leave-status-select', ov).value === 'approved');
setVal($('#leave-status-select', ov), 'cancelled');
click($('.submit-leave-btn', ov));
await sleep(300);
leaves = storage.getState().leaves;
ok('cancelled leave persisted through edit modal', leaves.find((l) => l.id === 'lv-ui-c')?.status === 'cancelled');
ok('non-live leaves count unchanged', leaves.filter((l) => l.status !== 'cancelled').length === 2);

const cancelledLeave = storage.get('hrms_leaves_v3', []).find((l) => l.id === 'lv-ui-c');
openLeaveRequestModal('emp-ui-1', () => leaveSaved++, cancelledLeave);
ov = $('.modal-overlay');
ok('cancelled edit does NOT silently flip to approved', $('#leave-status-select', ov).value === 'cancelled');
await closeOverlay();

const bal = calculateLeaveBalance(empA, storage.getState().leaves, new Date(), storage.getState().settings);
ok('balance counts only live approved days (1 + 0.5 = 1.5)', Math.abs(bal.usedAnnualDays - 1.5) < 0.001);

// =========================================================
// P9: Payroll Correction Modal + Reports corrections tab
// =========================================================
console.log('  [PayrollCorrectionModal → Reports corrections tab]');
i18n.setLang('en');
// super_admin default active user (usr-admin); no explicit login needed.
let savedSel = { c: storage.getSelectedCompanyId(), b: storage.getSelectedBranchId() };
storage.setSelectedCompanyId('comp-1');
storage.setSelectedBranchId('br-1');

const p9Batch = {
  id: 'PAYROLL-2026-09-comp-1-br-1',
  month: '2026-09',
  companyId: 'comp-1',
  branchId: 'br-1',
  status: 'paid',
  paidAt: '2026-09-10T08:00:00.000Z',
  archived: true,
  archivedAt: '2026-09-10T10:00:00.000Z',
  totalGross: 6000,
  totalNet: 6000,
  totalsByCurrency: [{ code: 'SAR', symbol: 'ر.س', net: 6000, gross: 6000 }],
  items: [
    { id: 'it-p9-1', employeeId: 'emp-ui-1', employeeName: empA.fullName, currency: 'SAR', currencySymbol: 'ر.س', basicSalary: 6000, grossSalary: 6000, netSalary: 6000 },
  ],
};
storage.addPayrollBatch(p9Batch);
const storedP9 = storage.getState().payrolls.find((b) => b.id === p9Batch.id);
ok('p9 archived paid batch stored', !!storedP9 && storedP9.status === 'paid' && storedP9.archived === true);

let p9Saved = 0;
openPayrollCorrectionModal({ original: storedP9, onSaved: () => p9Saved++ });
let ovP9 = $('.modal-overlay');
ok('p9 correction modal opens', !!ovP9);
ok('p9 next-number preview stamped', !!$('#pc-form', ovP9) && $('#pc-form', ovP9).innerHTML.includes('CORR-001'));
ok('p9 employee name resolved onto the line', $('#pc-emp-0', ovP9).selectedOptions[0]?.text === empA.fullName);
setVal($('#pc-comp-0', ovP9), 'BONUS');
setVal($('#pc-rate-0', ovP9), '300', 'input');
setVal($('#pc-qty-0', ovP9), '1', 'input');
setVal($('#pc-lreason-0', ovP9), 'UI smoke line reason', 'input');
setVal($('#pc-reason', ovP9), 'UI smoke credit correction', 'input');
await sleep(80);
ok('p9 Net/Effective preview shows +300 credit (no guard error)', /300/.test($('#pc-prev-corr', ovP9).innerHTML) && !$('#pc-prev-corr', ovP9).innerHTML.includes('⚠'));
click($('.submit-pc-btn', ovP9));
await sleep(300);
const p9Corrs = storage.getCorrections(p9Batch.id);
ok('p9 correction saved as draft with stamped number', p9Corrs.length === 1 && p9Corrs[0].status === 'draft' && String(p9Corrs[0].displayNumber || '').endsWith('-CORR-001'));
ok('p9 correction onSaved fired', p9Saved === 1);
ok('p9 modal closed after save', !document.querySelector('.modal-overlay'));

const repHost = document.createElement('div');
document.body.appendChild(repHost);
renderReportsView(repHost, {});
await sleep(50);
ok('p9 reports default audit tab renders', !!repHost.querySelector('#report-details-container'));
click(repHost.querySelector('#rep-tab-corrections'));
await sleep(50);
ok('p9 reports corrections tab renders table', !!repHost.querySelector('#report-details-container table'));
const repText = repHost.textContent;
ok('p9 three-column Net/Effective summary visible', repText.includes('Net / Effective'));
ok('p9 net effective = original + correction (6,300)', repText.includes('6,300') && repText.includes('300'));
ok('p9 correction number + rate source listed', repText.includes('CORR-001') && repText.includes('original'));
repHost.remove();
storage.setSelectedCompanyId(savedSel.c);
storage.setSelectedBranchId(savedSel.b);

console.log('\n============================================');
console.log(`P2.1 UI AUTOMATION: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failed:', failures.join(' | ')); }
console.log('============================================');
process.exit(failed ? 1 : 0);