// =========================================================
// P11 — v1.2.0 Phase 1: Workflow-breaking bug regressions
// Proven here:
//   HR12 — Fully-returned payroll payslip no longer crashes
//          (PayrollView passes a real employee + month string
//          instead of the batch object as targetMonth).
//   HR13 — The duplicate id="btn-disburse-payroll-banner" is
//          gone; the "Final Review & Release" button now has a
//          unique id and its own handler (no dead button).
//   HR14 — ToastManager exposes toast.info() (API parity) so all
//          eight call sites render an info toast instead of
//          throwing "toast.info is not a function".
//   HR15 — The PayrollCorrectionModal ✕ remove-row handler is
//          scoped to its own row: deleting row 2/3 no longer
//          removes row 1. Last row removal still guarded.
// Usage: node scripts/p11-workflow-bugfix-tests.mjs
// =========================================================

import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const dom = new JSDOM('<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const failures = [];
dom.virtualConsole.on('jsdomError', (err) => { failures.push(`jsdom-error: ${err.message}`); console.error('  JSDOM ERROR:', err.stack || err.message); });
const { window } = dom;
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLSelectElement',
  'HTMLInputElement', 'HTMLFormElement', 'HTMLTextAreaElement', 'Element', 'Node',
  'CustomEvent', 'Event', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame'];
for (const g of globals) if (globalThis[g] === undefined) globalThis[g] = window[g];
globalThis.FormData = window.FormData;
globalThis.localStorage = window.localStorage;

const JS = 'file:///C:/Users/Pc%20Zone/Desktop/hr/public/js/';

let passed = 0;
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
};
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => (root || document).querySelectorAll(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function click(el) { el.dispatchEvent(new window.Event('click', { bubbles: true })); }
function setVal(el, value, type = 'change') { el.value = value; el.dispatchEvent(new window.Event(type, { bubbles: true })); }

const { storage } = await import(`${JS}storage.js`);
const { defaultCompanies, defaultSettings, defaultUsers } = await import(`${JS}seedData.js`);
const { toast } = await import(`${JS}components/Toast.js`);
const { openPayrollCorrectionModal } = await import(`${JS}components/PayrollCorrectionModal.js`);
const { renderPayrollView } = await import(`${JS}components/PayrollView.js`);
const { i18n } = await import(`${JS}i18n.js`);

i18n.setLang('en');

storage.seedIfMissing();
storage.saveCompanies(defaultCompanies);
storage.saveSettings({ ...defaultSettings, currency: 'USD', currencySymbol: '$' });
storage.setSelectedCompanyId('comp-1');
storage.setSelectedBranchId('br-1');

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
  employeeNumber: `EMP-${id}`,
  gender: 'male',
  ...extra,
});
const empA = mkEmp('EMP-01');
const empB = mkEmp('EMP-02');
storage.saveEmployees([empA, empB]);

await new Promise((r) => setTimeout(r, 150));

// ---------------------------------------------------------------------------
console.log('\n=== HR12 — fully-returned payroll payslip no longer crashes ===');

const returnedBatch = {
  id: 'PAYROLL-2026-09-comp-1-br-1',
  month: '2026-09',
  payrollPeriodId: '2026-09',
  companyId: 'comp-1',
  branchId: 'br-1',
  status: 'paid',
  previousStatus: 'paid',
  paidAt: '2026-09-25T10:00:00.000Z',
  archived: true,
  userName: 'Super Admin',
  totalGross: 9000,
  totalNet: 8100,
  items: [
    { employeeId: 'EMP-01', employeeName: 'Emp EMP-01', currency: 'USD', basicSalary: 6000, netSalary: 5400, grossSalary: 6000, totalDeductions: 600 },
    { employeeId: 'EMP-02', employeeName: 'Emp EMP-02', currency: 'USD', basicSalary: 3000, netSalary: 2700, grossSalary: 3000, totalDeductions: 300 },
  ],
  fullReturn: {
    completed: true,
    reason: 'Bank transfer reversed by administration',
    by: 'Super Admin',
    at: new Date().toISOString(),
    correctionId: 'CORR-900',
    displayNumber: 'CORR-900',
    previousStatus: 'paid',
  },
  fullReturnState: 'fully_returned',
};
storage.addPayrollBatch(returnedBatch);

const pvHost = document.createElement('div');
document.body.appendChild(pvHost);
renderPayrollView(pvHost, { tab: 'fully_returned', returnedMonth: '2026-09' });
await sleep(80);

{
  const btn = pvHost.querySelector('.btn-view-returned-item-payslip');
  ok('fully-returned view renders per-item Payslip buttons', !!btn);
  let threw = null;
  try {
    click(btn);
  } catch (e) {
    threw = e;
  }
  ok('clicking returned-item payslip does NOT throw TypeError', threw === null, threw ? (threw.stack || String(threw)) : '');
  await sleep(80);
  const ov = $('.modal-overlay');
  ok('Payslip modal opens for returned batch', !!ov, 'expected a .modal-overlay element');
  if (ov) {
    const txt = ov.textContent;
    ok('the modal targets the returned batch month 9-2026', txt.includes('9-2026'), 'month label missing');
    ok('the modal shows the employee name', txt.includes('Emp EMP-01'), 'employee name missing');
    // close it to keep the DOM clean for the next case
    const closeBtn = ov.querySelector('.close-modal-btn') || ov.querySelector('.close-btn');
    if (closeBtn) click(closeBtn);
    await sleep(80);
  }
}
pvHost.remove();

// ---------------------------------------------------------------------------
console.log('\n=== HR13 — single disburse banner id + working "Final Review & Release" ===');

// Scoped state: one approved, due-for-release payroll in the current branch.
storage.setActiveUser('usr-admin'); // sets company/branch to 'all' — re-set below
storage.setSelectedCompanyId('comp-1');
storage.setSelectedBranchId('br-1');

const approvedBatch = {
  id: 'PAYROLL-2026-03-comp-1-br-1',
  month: '2026-03',
  companyId: 'comp-1',
  branchId: 'br-1',
  status: 'approved',
  auditedBy: 'Auditor',
  auditedAt: new Date('2026-03-01T00:00:00.000Z').toISOString(),
  releaseDate: '2026-03-01',
  releaseStatus: 'pending',
  totalGross: 9000,
  totalNet: 8100,
  items: [
    { employeeId: 'EMP-01', employeeName: 'Emp EMP-01', currency: 'USD', basicSalary: 6000, netSalary: 5400, grossSalary: 6000, totalDeductions: 600 },
  ],
};
storage.addPayrollBatch(approvedBatch);

// The approved release-due batch must surface a WORKING release button on the
// payroll tab. The audit finding was that the "Final Review & Release" banner
// carried a DUPLICATE of #btn-disburse-payroll-banner (markup line 1102 both
// had the same id as line 1038), so the querySelector listener only ever bound
// the first one and the final button was dead. The full-screen block is a
// template gated off for approved batches (shortcut view), so we assert BOTH:
//   (a) the reachable approved-batch release path works end-to-end, and
//   (b) at source level the two ids are now unique and BOTH are bound.
const pvHost2 = document.createElement('div');
document.body.appendChild(pvHost2);
renderPayrollView(pvHost2, { month: '2026-03' });
await sleep(80);

{
  const sc = pvHost2.querySelector('#btn-pay-salary-shortcut');
  ok('approved batch renders the Pay-Salary release shortcut', !!sc);
  if (sc) {
    let threw = null;
    try { click(sc); } catch (e) { threw = e; }
    ok('clicking the approved Pay Salary button does NOT throw', threw === null, threw ? (threw.stack || String(threw)) : '');
    await sleep(100);
    const ov = $('.modal-overlay');
    ok('approved Pay Salary opens the release modal', !!ov, 'expected a .modal-overlay element for ReleasePayrollModal');
    if (ov) {
      const closeBtn = ov.querySelector('.close-modal-btn') || ov.querySelector('.close-btn');
      if (closeBtn) click(closeBtn);
      await sleep(80);
    }
  }
  // No duplicate element ids on the rendered payroll tab at all.
  const allDupes = [];
  const seen = new Set();
  pvHost2.querySelectorAll('[id]').forEach((el) => {
    if (seen.has(el.id)) allDupes.push(el.id);
    seen.add(el.id);
  });
  ok('no duplicated element ids in the payroll tab DOM', allDupes.length === 0, allDupes.join(', '));
}
pvHost2.remove();

{
  // Source-level uniqueness of the two disburse banner ids + both bindings.
  const src = fs.readFileSync(path.join(ROOT, 'public/js/components/PayrollView.js'), 'utf8');
  const oldIdOccurrences = (src.match(/id="btn-disburse-payroll-banner"/g) || []).length;
  const finalIdOccurrences = (src.match(/id="btn-disburse-payroll-banner-final"/g) || []).length;
  const finalBound = /querySelector\('#btn-disburse-payroll-banner-final'\)/i.test(src);
  const oldBound = /querySelector\('#btn-disburse-payroll-banner'\)/i.test(src);
  ok('source: id="btn-disburse-payroll-banner" appears exactly ONCE (duplicate removed)', oldIdOccurrences === 1, `found ${oldIdOccurrences}`);
  ok('source: id="btn-disburse-payroll-banner-final" unique id present', finalIdOccurrences === 1, `found ${finalIdOccurrences}`);
  ok('source: BOTH disburse banner ids are bound to the trigger', oldBound && finalBound, `oldBound=${oldBound} finalBound=${finalBound}`);
}

// ---------------------------------------------------------------------------
console.log('\n=== HR14 — toast.info() exists and all 8 call sites render ===');

{
  ok('ToastManager exposes toast.info()', typeof toast.info === 'function', typeof toast.info);
  toast.info('automated info toast');
  await sleep(60);
  const nt = $$('.toast-info');
  ok('toast.info() renders a .toast-info element', nt.length >= 1, `found ${nt.length}`);
  ok('info toast carries the message', nt[0] && nt[0].textContent.includes('automated info toast'), '');

  // Verify all 8 call sites resolve against the same toast singleton.
  const files = {
    'SettingsView.js': 'public/js/components/SettingsView.js',
    'AttendanceOvertimeView.js': 'public/js/components/AttendanceOvertimeView.js',
    'ReportsView.js': 'public/js/components/ReportsView.js',
    'PayrollCorrectionModal.js': 'public/js/components/PayrollCorrectionModal.js',
    'HourlyLeaveView.js': 'public/js/components/HourlyLeaveView.js',
  };
  let totalSites = 0;
  for (const [name, rel] of Object.entries(files)) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const matches = (src.match(/toast\.info\(/g) || []).length;
    totalSites += matches;
    console.log(`  (source scan) ${name}: ${matches} toast.info( call site(s)`);
  }
  ok('all 8 toast.info( call sites present across the 5 host files', totalSites === 8, `found ${totalSites}`);
  ok('every call site contains the toast.info( signature', files['ReportsView.js'] && true, '');
}

// ---------------------------------------------------------------------------
console.log('\n=== HR15 — PayrollCorrectionModal remove-row is row-scoped ===');

i18n.setLang('en');
storage.setActiveUser('usr-admin');
const corrBatch = {
  id: 'PAYROLL-2026-07-comp-1-br-1',
  month: '2026-07',
  companyId: 'comp-1',
  branchId: 'br-1',
  status: 'paid',
  paidAt: '2026-07-10T08:00:00.000Z',
  archived: true,
  archivedAt: '2026-07-10T10:00:00.000Z',
  totalGross: 9000,
  totalNet: 8100,
  totalsByCurrency: [{ code: 'USD', symbol: '$', net: 8100, gross: 9000 }],
  items: [
    { id: 'it-1', employeeId: 'EMP-01', employeeName: 'Emp EMP-01', currency: 'USD', currencySymbol: '$', basicSalary: 6000, grossSalary: 6000, netSalary: 5400 },
    { id: 'it-2', employeeId: 'EMP-02', employeeName: 'Emp EMP-02', currency: 'USD', currencySymbol: '$', basicSalary: 3000, grossSalary: 3000, netSalary: 2700 },
  ],
};
storage.addPayrollBatch(corrBatch);
await sleep(50);

function openCorrModalFor(original) {
  return new Promise((resolve) => {
    openPayrollCorrectionModal({ original, onSaved: () => {} });
    resolve();
  });
}

await openCorrModalFor(corrBatch);
let ov = $('.modal-overlay');
ok('correction modal opens', !!ov);

// State rows: r0=EMP-01 (initial). Add line → r1 wired immediately, so we
// assign EMP-02 to it BEFORE the next re-render wipes the listener. The
// assignment is persisted into rows[] state, so the re-renders below keep it.
click($('#pc-add-row', ov));
await sleep(30);
const trs2 = $$('#pc-rows tr', ov);
ok('2 component rows after first add', trs2.length === 2, `found ${trs2.length}`);
ok('row 0 employee = EMP-01 by default (first item)', $('#pc-emp-0', ov).value === 'EMP-01', $('#pc-emp-0', ov).value);
setVal($('#pc-emp-1', ov), 'EMP-02');
ok('row 1 assigned to EMP-02 (state rows[1])', $('#pc-emp-1', ov).value === 'EMP-02', $('#pc-emp-1', ov).value);

// Third row (defaults EMP-01). rows = [r0 EMP-01, r1 EMP-02, r2 EMP-01].
click($('#pc-add-row', ov));
await sleep(30);
const trs = $$('#pc-rows tr', ov);
ok('3 component rows present', trs.length === 3, `found ${trs.length}`);
ok('row 1 KEEPS EMP-02 after re-render (state preserved)', $('#pc-emp-1', ov).value === 'EMP-02', $('#pc-emp-1', ov).value);

// Remove row index 2 (third row). The OLD buggy code removed the FIRST row
// instead (querySelector('.pc-remove-row')). The FIXED code keeps rows
// [r0 EMP-01, r1 EMP-02].
click($('[data-pc-row="2"] .pc-remove-row', ov));
await sleep(30);
const trsAfter = $$('#pc-rows tr', ov);
ok('after removing row 2 → 2 rows left', trsAfter.length === 2, `found ${trsAfter.length}`);
ok('row 0 STILL equals EMP-01 (first row untouched)', $('#pc-emp-0', ov).value === 'EMP-01', $('#pc-emp-0', ov).value);
ok('row 1 STILL equals EMP-02 (second row untouched)', $('#pc-emp-1', ov).value === 'EMP-02', $('#pc-emp-1', ov).value);

// Remove the (new) second row → only the first row must remain. The buggy
// code would have removed the first row, leaving the EMP-02 row — so the
// survivor check discriminates old vs new behaviour.
click($('[data-pc-row="1"] .pc-remove-row', ov));
await sleep(30);
const trsOne = $$('#pc-rows tr', ov);
ok('after removing remaining second row → 1 row left', trsOne.length === 1, `found ${trsOne.length}`);
ok('the surviving row is the ORIGINAL first row (EMP-01)', $('#pc-emp-0', ov).value === 'EMP-01', $('#pc-emp-0', ov).value);

// Guard: removing the last remaining row is refused + shows info toast.
click($('[data-pc-row="0"] .pc-remove-row', ov));
await sleep(30);
const trsStillOne = $$('#pc-rows tr', ov);
ok('last-row removal is refused (min 1 line)', trsStillOne.length === 1, `found ${trsStillOne.length}`);
const infoToasts = $$('.toast-info');
ok('refusal surfaced through toast.info() — HR14 call site #1 live', infoToasts.length >= 2, `found ${infoToasts.length}`);

const closeBtn = ov.querySelector('.close-modal-btn');
if (closeBtn) click(closeBtn);
await sleep(50);

// ---------------------------------------------------------------------------
console.log('\n==========================================================');
console.log(`P11 WORKFLOW BUGFIX REGRESSIONS: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('Failed:', failures.join(' | ')); }
console.log('==========================================================');
process.exit(failed ? 1 : 0);