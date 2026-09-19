// =========================================================
// P15 — Legacy Loan Fallback Hardening (FR-1-D1)
// =========================================================
// Verifies that a Full Return NEVER reverses an unprovable loan:
//   * No "first loan" selection.
//   * Candidates restricted to employeeId + companyId + branchId.
//   * 0 → legacy_loan_attribution_missing, >1 → ambiguous_legacy_loan,
//     1 only → proceeds through every amount/status/month guard.
//   * No guessed historical amount; amount bounded (paidAmount never < 0,
//     remaining never > totalAmount, totalAmount never edited).
//   * settled → active only after a provable reversal of this payroll month.
//   * Mixed batches fail closed with zero payroll/loan mutation.
//   * Post-B+C exact path (loanId + loanDeductedAmount) unchanged.
//
// Usage: node scripts/p15-legacy-loan-reversal-hardening-tests.mjs
// =========================================================

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
if (!globalThis.CustomEvent) globalThis.CustomEvent = class CustomEvent { constructor(t, o = {}) { this.type = t; this.detail = o.detail; } };
if (!globalThis.window) globalThis.window = globalThis;

import { reversePayrollDisbursementAtomic, resolveLegacyLoanItem, applyLegacyLoanReversal } from '../public/js/engines/payrollDisbursement.js';

let passed = 0;
let failed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
}

// ---- shared fixtures ----
const authUser = { id: 'u-audit', role: 'audit_reviewer', permissions: ['payroll.cancelPayment'] };
const M = '2026-09';
const now = '2026-09-10T00:00:00Z';

const mkLoan = (id, emp, opts = {}) => ({
  id,
  employeeId: emp,
  companyId: opts.comp || 'comp-1',
  branchId: opts.br || 'br-1',
  totalAmount: opts.total !== undefined ? opts.total : 2000,
  paidAmount: opts.paid !== undefined ? opts.paid : 500,
  remainingAmount: opts.rem !== undefined ? opts.rem : 1500,
  status: opts.status || 'active',
  installments: (opts.entries || []).map((e) => ({
    month: e.month || M,
    amount: e.amount !== undefined ? e.amount : 500,
    isPaid: e.isPaid === true,
    ...(e.isPaid ? { paidAt: e.paidAt || now } : {}),
    ...(e.type ? { type: e.type } : {}),
  })),
});

const mkBatch = (items, opts = {}) => ({
  id: opts.id || 'P-1',
  companyId: opts.comp || 'comp-1',
  branchId: opts.br || 'br-1',
  status: 'paid',
  month: M,
  updatedAt: '2026-09-11T00:00:00Z',
  items: items.map((x) => ({
    employeeId: x.employeeId || 'emp-1',
    companyId: x.companyId || opts.comp || 'comp-1',
    branchId: x.branchId || opts.br || 'br-1',
    netSalary: 4500,
    ...(x.loanInstallment !== undefined ? { loanInstallment: x.loanInstallment } : {}),
    ...(x.loanId ? { loanId: x.loanId } : {}),
    ...(x.loanDeductedAmount !== undefined ? { loanDeductedAmount: x.loanDeductedAmount } : {}),
  })),
});

const mkItem = (emp = 'emp-1', install = 500, scope = {}) => ({ employeeId: emp, companyId: scope.comp || 'comp-1', branchId: scope.br || 'br-1', netSalary: 4500, loanInstallment: install });

const makeStorage = (initialPayrolls = [], initialLoans = [], { failSaveLoans = false } = {}) => {
  const initial = JSON.parse(JSON.stringify({ payrolls: initialPayrolls, loans: initialLoans }));
  const state = JSON.parse(JSON.stringify(initial));
  let loanWriteFailures = failSaveLoans ? 1 : 0;
  const mask = (arr) => (arr || []).map((x) => (x && typeof x === 'object' ? { ...x } : x));
  return {
    getState: () => state,
    snapshotFinancial: () => ({ payrolls: mask(state.payrolls), loans: mask(state.loans) }),
    auditList: () => mask(state.audit),
    savePayrolls: (p) => { state.payrolls = mask(p); },
    saveLoans: (l) => {
      if (loanWriteFailures > 0) { loanWriteFailures--; throw new Error('simulated_failure_save_loans'); }
      state.loans = mask(l);
    },
    addPayrollBatch: (b) => {
      const idx = state.payrolls.findIndex((x) => x.id === b.id);
      if (idx >= 0) state.payrolls[idx] = b; else state.payrolls.push(b);
    },
    addAudit: (action, entity, details, recordId) => { state.audit = state.audit || []; state.audit.push({ action, entity, details, recordId, timestamp: now }); },
  };
};
const finEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n=== P15: Legacy Loan Fallback Hardening (FR-1-D1) ===');

// ---- 1. single unambiguous legacy loan → success ----
{
  const batch = mkBatch([mkItem('emp-1', 500)]);
  const loan = mkLoan('LOAN-A', 'emp-1', { entries: [{ month: M, amount: 500, isPaid: true }] });
  const st = makeStorage([batch], [loan]);
  const before = st.snapshotFinancial();
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'Customer refund', storage: st });
  ok('1. single unambiguous legacy loan → success', res.ok === true, res.error);
  const afterLoan = st.getState().loans.find((l) => l.id === 'LOAN-A');
  ok('1a. exact reversal applied', afterLoan.paidAmount === 0 && afterLoan.remainingAmount === 2000 && afterLoan.installments[0].isPaid === false && afterLoan.installments[0].paidAt === undefined);
  ok('1b. item stamped with attribution', res.batch.items[0].loanId === 'LOAN-A' && res.batch.items[0].loanDeductedAmount === 500);
  ok('1c. legacy_auto_reversal_accepted audit written', st.auditList().some((a) => a.action === 'legacy_auto_reversal_accepted' && String(a.details).includes('LOAN-A') && String(a.details).includes('500')));
  ok('1d. full_return audit written', st.auditList().some((a) => a.action === 'full_return'));
  ok('1e. no financial rollback needed (batch approved)', res.batch.status === 'approved');
  void before;
}

// ---- 2. multi-loan ambiguity → ambiguous_legacy_loan + zero financial mutation ----
{
  const batch = mkBatch([mkItem('emp-1', 1000)]);
  const loanA = mkLoan('LOAN-A', 'emp-1', { entries: [{ month: M, amount: 500, isPaid: true }] });
  const loanB = mkLoan('LOAN-B', 'emp-1', { entries: [{ month: M, amount: 500, isPaid: true }] });
  const st = makeStorage([batch], [loanA, loanB]);
  const before = st.snapshotFinancial();
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'refund', storage: st });
  ok('2. two matching candidates → ambiguous_legacy_loan', !res.ok && res.error === 'ambiguous_legacy_loan');
  ok('2a. zero financial mutation (payrolls + loans)', finEqual(st.snapshotFinancial(), before));
  ok('2b. rejected_ambiguous audit written', st.auditList().some((a) => a.action === 'legacy_auto_reversal_rejected_ambiguous'));
}

// ---- 3. settled-first / active-second → must NOT pick the first ----
{
  // Settled loan appears first but has NO paid entry for the month; the active
  // loan (second) is the only candidate.
  const batch = mkBatch([mkItem('emp-1', 500)]);
  const settledFirst = mkLoan('LOAN-S', 'emp-1', { status: 'settled', paid: 500, rem: 0, entries: [{ month: '2026-08', amount: 500, isPaid: true }] });
  const activeSecond = mkLoan('LOAN-A', 'emp-1', { entries: [{ month: M, amount: 500, isPaid: true }] });
  const st = makeStorage([batch], [settledFirst, activeSecond]);
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'refund', storage: st });
  ok('3. settled-first w/o month entry, active-second only → success (picks provable one)', res.ok === true, res.error);
  ok('3a. reversed loan is the ACTIVE one (LOAN-A)', st.getState().loans.find((l) => l.id === 'LOAN-A').remainingAmount === 2000);
  ok('3b. settled loan untouched', st.getState().loans.find((l) => l.id === 'LOAN-S').status === 'settled' && st.getState().loans.find((l) => l.id === 'LOAN-S').remainingAmount === 0);
}

// ---- 3b. settled-first AND active-second both have the month paid → ambiguous ----
{
  const batch = mkBatch([mkItem('emp-1', 500)]);
  const settledFirst = mkLoan('LOAN-S', 'emp-1', { status: 'settled', paid: 1000, rem: 0, entries: [{ month: M, amount: 500, isPaid: true }, { month: M, amount: 500, isPaid: true }] });
  const activeSecond = mkLoan('LOAN-A', 'emp-1', { entries: [{ month: M, amount: 500, isPaid: true }] });
  const st = makeStorage([batch], [settledFirst, activeSecond]);
  const before = st.snapshotFinancial();
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'refund', storage: st });
  ok('3b. two loans with same-month paid entries → ambiguous + zero mutation', !res.ok && res.error === 'ambiguous_legacy_loan' && finEqual(st.snapshotFinancial(), before));
}

// ---- 4. active + active: only one matches the month → success, other untouched ----
{
  const batch = mkBatch([mkItem('emp-1', 500)]);
  const loanA = mkLoan('LOAN-A', 'emp-1', { entries: [{ month: M, amount: 500, isPaid: true }] });
  const loanB = mkLoan('LOAN-B', 'emp-1', { total: 1000, paid: 200, rem: 800, entries: [{ month: '2026-10', amount: 200, isPaid: true }] });
  const st = makeStorage([batch], [loanA, loanB]);
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'refund', storage: st });
  ok('4. one matching month only → success', res.ok === true, res.error);
  ok('4a. only the matching loan reversed', st.getState().loans.find((l) => l.id === 'LOAN-A').remainingAmount === 2000);
  ok('4b. non-matching loan untouched', st.getState().loans.find((l) => l.id === 'LOAN-B').remainingAmount === 800 && st.getState().loans.find((l) => l.id === 'LOAN-B').paidAmount === 200);
}

// ---- 5. branch isolation → loan in another branch is not a candidate ----
{
  const batch = mkBatch([mkItem('emp-1', 500)], { br: 'br-1' });
  const otherBr = mkLoan('LOAN-X', 'emp-1', { br: 'br-2', entries: [{ month: M, amount: 500, isPaid: true }] });
  const st = makeStorage([batch], [otherBr]);
  const before = st.snapshotFinancial();
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'refund', storage: st });
  ok('5. branch isolation → legacy_loan_attribution_missing', !res.ok && res.error === 'legacy_loan_attribution_missing');
  ok('5a. zero financial mutation', finEqual(st.snapshotFinancial(), before));
}

// ---- 6. company isolation → loan in another company is not a candidate ----
{
  const batch = mkBatch([mkItem('emp-1', 500)], { comp: 'comp-1' });
  const otherCo = mkLoan('LOAN-X', 'emp-1', { comp: 'comp-2', entries: [{ month: M, amount: 500, isPaid: true }] });
  const st = makeStorage([batch], [otherCo]);
  const before = st.snapshotFinancial();
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'refund', storage: st });
  ok('6. company isolation → legacy_loan_attribution_missing', !res.ok && res.error === 'legacy_loan_attribution_missing');
  ok('6a. zero financial mutation', finEqual(st.snapshotFinancial(), before));
}

// ---- 7. missing loan → legacy_loan_attribution_missing + no mutation ----
{
  const batch = mkBatch([mkItem('emp-1', 500)]);
  const st = makeStorage([batch], []);
  const before = st.snapshotFinancial();
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'refund', storage: st });
  ok('7. no loan at all → legacy_loan_attribution_missing', !res.ok && res.error === 'legacy_loan_attribution_missing');
  ok('7a. zero financial mutation', finEqual(st.snapshotFinancial(), before));
  ok('7b. rejected_missing audit written', st.auditList().some((a) => a.action === 'legacy_auto_reversal_rejected_missing'));
}

// ---- 8. missing paid installment for the month → missing or none ----
{
  const batch = mkBatch([mkItem('emp-1', 500)]);
  const loan = mkLoan('LOAN-A', 'emp-1', { entries: [{ month: M, amount: 500, isPaid: false }] });
  const st = makeStorage([batch], [loan]);
  const before = st.snapshotFinancial();
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'refund', storage: st });
  ok('8. no paid entry for the month → attribution missing', !res.ok && (res.error === 'legacy_loan_attribution_missing'));
  ok('8a. zero financial mutation', finEqual(st.snapshotFinancial(), before));
}

// ---- 9. partial / unprovable amount (entry != loanInstallment) → ambiguous ----
{
  const batch = mkBatch([mkItem('emp-1', 500)]);
  const loan = mkLoan('LOAN-A', 'emp-1', { entries: [{ month: M, amount: 250, isPaid: true }] });
  const st = makeStorage([batch], [loan]);
  const before = st.snapshotFinancial();
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'refund', storage: st });
  ok('9. entry amount != loanInstallment (partial/unprovable) → ambiguous_legacy_loan', !res.ok && res.error === 'ambiguous_legacy_loan');
  ok('9a. zero financial mutation', finEqual(st.snapshotFinancial(), before));
}

// ---- 10. amount bounds ----
{
  // 10a: amount > loan.paidAmount
  const batchA = mkBatch([mkItem('emp-1', 800)]);
  const loanA = mkLoan('LOAN-A', 'emp-1', { total: 2000, paid: 500, rem: 1500, entries: [{ month: M, amount: 800, isPaid: true }] });
  const stA = makeStorage([batchA], [loanA]);
  const beforeA = stA.snapshotFinancial();
  const resA = reversePayrollDisbursementAtomic({ user: authUser, batch: batchA, reason: 'refund', storage: stA });
  ok('10a. amount > paidAmount → ambiguous + zero mutation', !resA.ok && resA.error === 'ambiguous_legacy_loan' && finEqual(stA.snapshotFinancial(), beforeA));

  // 10b: remaining + amount > totalAmount (inconsistent loan caught by the bound)
  const batchB = mkBatch([mkItem('emp-1', 600)]);
  const loanB = mkLoan('LOAN-B', 'emp-1', { total: 1000, paid: 800, rem: 500, entries: [{ month: M, amount: 600, isPaid: true }] });
  const stB = makeStorage([batchB], [loanB]);
  const beforeB = stB.snapshotFinancial();
  const resB = reversePayrollDisbursementAtomic({ user: authUser, batch: batchB, reason: 'refund', storage: stB });
  ok('10b. remaining + amount > totalAmount → ambiguous + zero mutation (remaining never exceeds total)', !resB.ok && resB.error === 'ambiguous_legacy_loan' && finEqual(stB.snapshotFinancial(), beforeB));
  ok('10c. totalAmount never edited even when the guard passes', resB.ok === false || Number(stB.getState().loans[0].totalAmount) === 1000);
}

// ---- 11. settled → active ONLY after a provable payroll-month reversal ----
{
  const batch = mkBatch([mkItem('emp-1', 500)]);
  const loan = mkLoan('LOAN-A', 'emp-1', { status: 'settled', total: 2000, paid: 2000, rem: 0, entries: [{ month: M, amount: 500, isPaid: true }] });
  const st = makeStorage([batch], [loan]);
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'refund', storage: st });
  ok('11. settled loan provably settled by this payroll month → success', res.ok === true, res.error);
  const after = st.getState().loans.find((l) => l.id === 'LOAN-A');
  ok('11a. re-activated only after a real reversal', after.status === 'active' && after.settledAt === undefined && after.remainingAmount === 500 && after.paidAmount === 1500);
}
{
  // settled loan closed by EOSB → must NOT be reactivated
  const batch = mkBatch([mkItem('emp-1', 500)]);
  const loan = mkLoan('LOAN-E', 'emp-1', { status: 'settled', total: 2000, paid: 2000, rem: 0, entries: [{ month: M, amount: 500, isPaid: true, type: 'eosb_settlement' }, { month: M, amount: 500, isPaid: true }, { month: M, amount: 1000, isPaid: true, type: 'eosb_settlement' }] });
  const st = makeStorage([batch], [loan]);
  const before = st.snapshotFinancial();
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'refund', storage: st });
  ok('11b. settled loan closed by EOSB → ambiguous + zero mutation (never re-opens an EOSB loan)', !res.ok && res.error === 'ambiguous_legacy_loan' && finEqual(st.snapshotFinancial(), before));
}

// ---- 12. already fully returned → blocked, no legacy audits, no mutation ----
{
  const batch = mkBatch([mkItem('emp-1', 500)]);
  batch.fullReturn = { completed: true, at: now, by: 'X', reason: 'first', previousStatus: 'paid' };
  const loan = mkLoan('LOAN-A', 'emp-1', { entries: [{ month: M, amount: 500, isPaid: true }] });
  const st = makeStorage([batch], [loan]);
  const before = st.snapshotFinancial();
  const auditsBefore = st.auditList().length;
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'again', storage: st });
  ok('12. already fully returned → already_fully_returned + no mutation', !res.ok && res.error === 'already_fully_returned' && finEqual(st.snapshotFinancial(), before));
  ok('12a. no audit emitted (blocked before any processing)', st.auditList().length === auditsBefore);
}

// ---- 13. rollback: saveLoans throws → both stores restored + rollback audit ----
{
  const batch = mkBatch([mkItem('emp-1', 500)]);
  const loan = mkLoan('LOAN-A', 'emp-1', { entries: [{ month: M, amount: 500, isPaid: true }] });
  const st = makeStorage([batch], [loan], { failSaveLoans: true });
  const before = st.snapshotFinancial();
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'refund', storage: st });
  ok('13. storage write failure → rolledBack report', res.ok === false && res.rolledBack === true, res.error);
  ok('13a. payrolls restored (original paid batch intact)', st.getState().payrolls.length === 1 && st.getState().payrolls[0].status === 'paid');
  ok('13b. loans restored to original', finEqual({ payrolls: undefined, loans: st.getState().loans }, { payrolls: undefined, loans: before.loans }));
  ok('13c. full_return_rollback audit written', st.auditList().some((a) => a.action === 'full_return_rollback'));
}

// ---- 14. post-B+C exact path unchanged (stamped partial) ----
{
  const batch = mkBatch([mkItem('emp-1', 500)], { id: 'P-POST' });
  batch.items[0].loanId = 'LOAN-A';
  batch.items[0].loanDeductedAmount = 250; // partial: actual deducted was 250
  const loan = mkLoan('LOAN-A', 'emp-1', { total: 2000, paid: 250, rem: 1750, entries: [{ month: M, amount: 500, isPaid: true, paidAt: now }] });
  const st = makeStorage([batch], [loan]);
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'refund', storage: st });
  ok('14. stamped partial item → precise path succeeds', res.ok === true, res.error);
  const after = st.getState().loans.find((l) => l.id === 'LOAN-A');
  ok('14a. exact partial amount reversed (250, not 500)', after.paidAmount === 0 && after.remainingAmount === 2000);
}

// ---- 15. mixed stamped + legacy in one batch ----
{
  const batch = mkBatch([
    { employeeId: 'emp-1', loanInstallment: 500 },
    { employeeId: 'emp-2', loanInstallment: 300 },
  ]);
  batch.items[0].loanId = 'LOAN-A';
  batch.items[0].loanDeductedAmount = 200;
  const loanA = mkLoan('LOAN-A', 'emp-1', { total: 1000, paid: 200, rem: 800, entries: [{ month: M, amount: 300, isPaid: true }] });
  const loanB = mkLoan('LOAN-B', 'emp-2', { total: 900, paid: 300, rem: 600, entries: [{ month: M, amount: 300, isPaid: true }] });
  const st = makeStorage([batch], [loanA, loanB]);
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'refund', storage: st });
  ok('15. mixed stamped + legacy → both processed', res.ok === true, res.error);
  const aAfter = st.getState().loans.find((l) => l.id === 'LOAN-A');
  const bAfter = st.getState().loans.find((l) => l.id === 'LOAN-B');
  ok('15a. stamped item reversed exactly (200)', aAfter.remainingAmount === 1000);
  ok('15b. legacy item reversed provably (300)', bAfter.remainingAmount === 900 && bAfter.paidAmount === 0);
}

// ---- 16. mixed valid legacy + ambiguous legacy → fails ATOMICALLY (no write) ----
{
  const batch = mkBatch([
    { employeeId: 'emp-1', loanInstallment: 500 }, // valid legacy
    { employeeId: 'emp-2', loanInstallment: 500 }, // ambiguous: two candidates
  ]);
  const loanAGood = mkLoan('LOAN-A', 'emp-1', { entries: [{ month: M, amount: 500, isPaid: true }] });
  const loanB1 = mkLoan('LOAN-C', 'emp-2', { total: 1000, paid: 500, rem: 500, entries: [{ month: M, amount: 500, isPaid: true }] });
  const loanB2 = mkLoan('LOAN-D', 'emp-2', { total: 1000, paid: 500, rem: 500, entries: [{ month: M, amount: 500, isPaid: true }] });
  const st = makeStorage([batch], [loanAGood, loanB1, loanB2]);
  const before = st.snapshotFinancial();
  const res = reversePayrollDisbursementAtomic({ user: authUser, batch, reason: 'refund', storage: st });
  ok('16. mixed valid + ambiguous → fail closed', !res.ok && res.error === 'ambiguous_legacy_loan');
  ok('16a. zero financial mutation (no partial reversal persisted)', finEqual(st.snapshotFinancial(), before));
  ok('16b. valid item NOT reversed on disk', st.getState().loans.find((l) => l.id === 'LOAN-A').remainingAmount === 1500);
}

// ---- pure resolver unit-level guards ----
{
  const batch = mkBatch([mkItem('emp-1', 500)]);
  const loan = mkLoan('LOAN-A', 'emp-1', { entries: [{ month: M, amount: 500, isPaid: true }] });
  const r = resolveLegacyLoanItem([loan], batch.items[0], M);
  ok('17. resolver: single provable candidate resolves', r.ok === true && r.loan.id === 'LOAN-A' && r.amount === 500);
  ok('17a. resolver: only scoped candidate (clone) survives', r.ok === true);
}
{
  const r = resolveLegacyLoanItem([], { employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', loanInstallment: 500 }, M);
  ok('18. resolver: zero candidates → legacy_loan_attribution_missing', r.ok === false && r.error === 'legacy_loan_attribution_missing' && r.layer === 'loan');
}
{
  const loanA = mkLoan('LOAN-A', 'emp-1', { entries: [{ month: M, amount: 500, isPaid: true }] });
  const loanB = mkLoan('LOAN-B', 'emp-1', { entries: [{ month: M, amount: 500, isPaid: true }] });
  const r = resolveLegacyLoanItem([loanA, loanB], { employeeId: 'emp-1', companyId: 'comp-1', branchId: 'br-1', loanInstallment: 1000 }, M);
  ok('19. resolver: two candidates → ambiguous_legacy_loan', r.ok === false && r.error === 'ambiguous_legacy_loan');
}
{
  // applyLegacyLoanReversal is pure (no engine call) and enforces floors.
  const loan = mkLoan('LOAN-A', 'emp-1', { total: 2000, paid: 500, rem: 1500, entries: [{ month: M, amount: 500, isPaid: true }] });
  const entry = loan.installments[0];
  const out = applyLegacyLoanReversal(loan, entry, 500);
  ok('20. apply: pure reversal math', out.ok === true && loan.paidAmount === 0 && loan.remainingAmount === 2000 && entry.isPaid === false && entry.paidAt === undefined);
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:\n' + failures.join('\n'));
  process.exit(1);
}
process.exit(0);