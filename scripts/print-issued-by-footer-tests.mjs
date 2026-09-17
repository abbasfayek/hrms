// =========================================================
// Print Issued-By Footer — regression for commit 747866f
// ("fix(print): standardize issued-by-program footer").
// Guards two things:
//   (a) The global print stylesheet (public/css/app.css) keeps the
//       issued-by-program footer: @media print { @page bottom margin +
//       body::after "صادر من برنامج بينو سوفت لإدارة الموارد البشرية"
//       with the English "Issued from HRMS Enterprise" override }.
//   (b) The REAL production rendering path (printIsolatedBatchPayslips)
//       still emits the per-slip print-only footer block with the
//       document reference, print date and page info on every slip.
// This asserts the actual served CSS + the live renderer output — not a
// duplicated string of the footer in this test.
// Usage: node scripts/print-issued-by-footer-tests.mjs
// =========================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
if (!globalThis.CustomEvent) globalThis.CustomEvent = class CustomEvent { constructor(t, o = {}) { this.type = t; this.detail = o && o.detail; } };

let capturedHtml = '';
globalThis.window = globalThis;
globalThis.open = undefined;
// printIsolatedBatchPayslips calls window.open('', '_blank', ...) then
// win.document.write(...). A write() hook captures exactly the document the
// browser would print.
globalThis.window.open = () => ({
  document: {
    write(html) { capturedHtml += html; },
    close() {},
  },
});
globalThis.alert = () => {};

const { printIsolatedBatchPayslips } = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'components', 'BatchPayslipsPrintModal.js')).href);

let passed = 0;
let failed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
}

console.log('\n=== Print Issued-By Footer (regression for 747866f) ===');

// ---- (a) Global stylesheet keeps the issued-by-program print footer ----
const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'app.css'), 'utf8');
ok('app.css contains a @media print ruleset', css.includes('@media print'));
ok('Print footer reserves bottom space (@page margin-bottom: 20mm)', css.includes('margin-bottom: 20mm'));
ok('Print footer body::after shows Arabic program line', css.includes('صادر من برنامج بينو سوفت لإدارة الموارد البشرية'));
ok('Print footer body::after is fixed at the bottom (position: fixed)', /body::after\s*\{[^}]*position:[^;]*fixed[^}]*\}/s.test(css));
ok('English override exists: html[lang="en"] body::after', css.includes('html[lang="en"] body::after'));
ok('English override content: Issued from HRMS Enterprise', css.includes('"Issued from HRMS Enterprise"'));

// ---- (b) Live renderer: every printed slip keeps the print-only footer ----
const batch = {
  id: 'PAYROLL-2026-09-ABC123',
  month: '2026-09',
  status: 'paid',
  companyId: 'comp-1',
  branchId: 'br-1',
  items: [
    { employeeNumber: 'E001', employeeName: 'أحمد محمد', department: 'المالية', jobTitle: 'محاسب', basicSalary: 4500, currency: 'USD' },
    { employeeNumber: 'E002', employeeName: 'سارة علي', department: 'الموارد البشرية', jobTitle: 'منسقة', basicSalary: 3800, currency: 'USD' },
  ],
};
printIsolatedBatchPayslips(batch, { companyName: 'بينو سوفت', companyNameEn: 'HRMS Enterprise', currency: 'USD' }, null, []);

const footerLabel = capturedHtml.includes('Document Ref:') ? 'Document Ref:' : 'رقم المستند:';
const dateLabel = capturedHtml.includes('Print Date:') ? 'Print Date:' : 'تاريخ الطباعة:';
ok('printIsolatedBatchPayslips produced a printable document', capturedHtml.includes('<html') && capturedHtml.includes('</html>'));
ok('Every slip keeps the print-only footer block', capturedHtml.includes('class="print-only-footer"'));
ok('Footer carries the document reference', capturedHtml.includes(footerLabel));
ok('Footer carries the print date', capturedHtml.includes(dateLabel));
ok('Footer carries the page info', capturedHtml.includes('1 ') && (capturedHtml.includes('1 of 2') || capturedHtml.includes('1 من 2')));
ok('All slips are emitted (2 receipt-slip-page blocks)', (capturedHtml.match(/class="receipt-slip-page"/g) || []).length === 2);
const mediaIdx = capturedHtml.indexOf('@media print');
const styleEnd = capturedHtml.indexOf('</style>', mediaIdx);
const printMedia = mediaIdx !== -1 && styleEnd !== -1 ? capturedHtml.slice(mediaIdx, styleEnd) : '';
ok('Print media rules keep the footer visible in @media print', /\.print-only-footer\s*\{\s*display:\s*block\s*!important/s.test(printMedia));

console.log(`\nPrint Issued-By Footer: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}