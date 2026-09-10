// ==========================================
// HRMS Payroll Engine & WPS Generator
// ==========================================

import { getApprovedOvertimeSummary } from './overtimeEngine.js';
import { getDailyRate, getHourlyRate, getMinuteRate } from './wageEngine.js';
import { resolveEmployeeCurrency, countAbsenceDays } from '../types.js';
import { t } from '../i18n.js';
// Phase 3 additive audit data model (purely additive; no behavior change).
import { PAYROLL_SCHEMA, pushVersion, ensureBaseline, attachApprovalReference, attachPaymentReference, attachArchiveReference } from './payrollDataModel.js';

/**
 * Generate monthly payroll batch for all active employees.
 * P2.2 multi-currency: every item carries the employee's currency code and
 * symbol (employee > company > global settings), and the batch adds a
 * totalsByCurrency array so reports can show per-currency segmented totals
 * instead of ever merging different currencies into one blended number.
 */
export function generateMonthlyPayroll(
  employees,
  overtimeRecords,
  loans,
  attendanceRecords,
  options,
  settings
) {
  const month = options.month;
  const adjustments = Array.isArray(options.adjustments) ? options.adjustments : [];
  const companies = Array.isArray(options.companies) ? options.companies : [];
  const issueDate = options.issueDate || new Date().toISOString().split('T')[0];
  const title = options.title || `${t('payroll.monthlyPayroll')} ${month}`;

  // Filter active and probation employees, and only those already hired by the
  // end of the pay month so no future hires leak into the list.
  const [monthYear, monthNum] = String(month).split('-').map(Number);
  const monthEnd = monthNum ? new Date(Date.UTC(monthYear, monthNum, 0)) : null;
  const monthEndStr = monthEnd ? `${monthEnd.getUTCFullYear()}-${String(monthEnd.getUTCMonth() + 1).padStart(2, '0')}-${String(monthEnd.getUTCDate()).padStart(2, '0')}` : '';

  const eligibleEmployees = employees.filter((emp) => {
    if (emp.status !== 'active' && emp.status !== 'probation') return false;
    if (emp.hireDate && monthEndStr && emp.hireDate > monthEndStr) return false;
    return true;
  });

  const items = eligibleEmployees.map((emp) => {
    const basicSalary = Number(emp.basicSalary) || 0;
    const housingAllowance = Number(emp.housingAllowance) || 0;
    const transportAllowance = Number(emp.transportAllowance) || 0;
    const otherAllowances = Number(emp.otherAllowances) || 0;

    // P2.2: resolve the currency bound to this employee's salary (profile →
    // company → global settings) and stamp it on the item so every report and
    // payslip can print the employee's own currency code.
    const employeeCurrency = resolveEmployeeCurrency(emp, settings, companies);
    const currency = employeeCurrency.code || settings.currency || 'USD';
    const currencySymbol = employeeCurrency.symbol || settings.currencySymbol || '$';

    // Overtime
    const otSummary = getApprovedOvertimeSummary(emp.id, month, overtimeRecords);
    const overtimeHours = otSummary.totalHours;
    const overtimeAmount = otSummary.totalAmount;

    // Attendance deductions (Absence & Delays)
    const empAttendance = attendanceRecords.filter(
      (att) => att.employeeId === emp.id && att.date && att.date.startsWith(month)
    );

    // P2.2 half-day fix: absence days are the SUM of each absent record's
    // deductibleDays factor (0.5 = half day, 1 = full day), so a half-day
    // absence is never rounded up to a full day in payroll.
    const absentDaysCount = countAbsenceDays(empAttendance);
    const totalLateMinutes = empAttendance.reduce((sum, att) => sum + (Number(att.lateMinutes) || 0), 0);

    // Daily/Hourly/Minute wage come from the single source of truth
    // (wageEngine). Historical default: working-days divisor.
    const dailyWage = getDailyRate(emp, settings, { month, defaultMethod: 'workingDays' });
    const hourlyWage = getHourlyRate(emp, settings, { month, defaultMethod: 'workingDays' });
    const minuteWage = getMinuteRate(emp, settings, { month, defaultMethod: 'workingDays' });

    const absenceDeduction = parseFloat((absentDaysCount * dailyWage).toFixed(2));
    const lateDeduction = parseFloat((totalLateMinutes * minuteWage).toFixed(2));

    // Loans & Advances
    // P2.2 loan-currency rule: an installment may only be withheld from the
    // payroll when the advance is in the SAME currency as the employee's
    // salary. An advance in a different currency is never silently deducted —
    // it is skipped and reported on the item so no currency is ever mixed.
    const activeLoans = (loans || []).filter(
      (l) => l.employeeId === emp.id && l.status === 'active' && Number(l.remainingAmount) > 0
    );
    let loanInstallment = 0;
    const currencyMismatchLoans = [];
    const loanCurrencyOf = (loan) => String(loan.currency || resolveEmployeeCurrency(emp, settings, companies).code || 'USD').trim().toUpperCase();
    activeLoans.forEach((loan) => {
      const loanCurrency = loanCurrencyOf(loan);
      if (loanCurrency !== currency) {
        currencyMismatchLoans.push({
          loanId: loan.id,
          loanCurrency,
          salaryCurrency: currency,
          installmentAmount: Number(loan.installmentAmount) || (Number(loan.installments?.[0]?.amount) || 0),
        });
        return;
      }
      const schedule = loan.installments || [];
      const matchInst = schedule.find((inst) => inst.month === month && !inst.isPaid);
      if (matchInst) {
        loanInstallment += Number(matchInst.amount) || 0;
      } else if (schedule.length === 0 && Number(loan.installmentAmount) > 0) {
        // Loans without an explicit monthly schedule are treated as an
        // automatic installment run, capped by the remaining balance.
        loanInstallment += Math.min(Number(loan.installmentAmount), Number(loan.remainingAmount));
      }
    });
    loanInstallment = parseFloat(loanInstallment.toFixed(2));

    // Social Insurance / Employee Insurance contributions (0% default)
    let gosiBase = 0;
    let gosiEmpRate = 0;
    let gosiCompRate = 0;
    let gosiEmployeeDeduction = 0;
    let gosiCompanyContribution = 0;

    if (emp.isSubjectToGosi !== false) {
      gosiBase = emp.gosiRegisteredWage !== undefined && Number(emp.gosiRegisteredWage) > 0
        ? Number(emp.gosiRegisteredWage)
        : (basicSalary + housingAllowance);

      // Read the generalized setting first, then the legacy gosi* key, then 0.
      const empRate = emp.gosiEmployeePercent !== undefined && Number(emp.gosiEmployeePercent) >= 0
        ? Number(emp.gosiEmployeePercent)
        : (Number(settings.socialInsuranceEmployeePercent ?? settings.gosiEmployeePercent) || 0);

      const compRate = emp.gosiCompanyPercent !== undefined && Number(emp.gosiCompanyPercent) >= 0
        ? Number(emp.gosiCompanyPercent)
        : (Number(settings.socialInsuranceCompanyPercent ?? settings.gosiCompanyPercent) || 0);

      gosiEmpRate = empRate;
      gosiCompRate = compRate;
      gosiEmployeeDeduction = parseFloat(((gosiBase * gosiEmpRate) / 100).toFixed(2));
      gosiCompanyContribution = parseFloat(((gosiBase * gosiCompRate) / 100).toFixed(2));
    }

    // One-off bonuses and deductions are stored as adjustment records and
    // must be included in the selected payroll month.
    const employeeAdjustments = adjustments.filter((entry) => entry.employeeId === emp.id && entry.payrollPeriod === month);
    const bonuses = employeeAdjustments
      .filter((entry) => entry.type === 'bonus')
      .reduce((sum, entry) => sum + Math.abs(Number(entry.amount) || 0), 0);
    const otherEarnings = 0;

    const grossSalary = parseFloat(
      (basicSalary + housingAllowance + transportAllowance + otherAllowances + overtimeAmount + bonuses + otherEarnings).toFixed(2)
    );

    const penaltiesDeduction = employeeAdjustments
      .filter((entry) => entry.type === 'deduction')
      .reduce((sum, entry) => sum + Math.abs(Number(entry.amount) || 0), 0);
    const otherDeductions = 0;
    const totalDeductions = parseFloat(
      (absenceDeduction + lateDeduction + loanInstallment + gosiEmployeeDeduction + penaltiesDeduction + otherDeductions).toFixed(2)
    );

    const netSalary = parseFloat(Math.max(0, grossSalary - totalDeductions).toFixed(2));

    return {
      id: `PI-${emp.id}-${month}`,
      month,
      employeeId: emp.id,
      companyId: emp.companyId || '',
      branchId: emp.branchId || '',
      employeeNumber: emp.employeeNumber,
      employeeName: emp.fullName,
      department: emp.department,
      jobTitle: emp.jobTitle,
      bankName: emp.bankName || '',
      iban: emp.iban || '',
      basicSalary,
      housingAllowance,
      transportAllowance,
      otherAllowances,
      overtimeHours,
      overtimeAmount,
      bonuses,
      otherEarnings,
      grossSalary,
      absenceDays: absentDaysCount,
      absenceDeduction,
      lateMinutes: totalLateMinutes,
      lateDeduction,
      loanInstallment,
      currencyMismatchLoans,
      notes: currencyMismatchLoans.length
        ? `[Currency guard] ${currencyMismatchLoans.length} advance(s) in ${[...new Set(currencyMismatchLoans.map((m) => m.loanCurrency))].join(', ')} skipped from payroll (salary currency: ${currency}).`
        : '',
      isSubjectToGosi: emp.isSubjectToGosi !== false,
      gosiRegisteredWage: gosiBase,
      gosiEmployeePercent: gosiEmpRate,
      gosiCompanyPercent: gosiCompRate,
      gosiEmployeeDeduction,
      gosiCompanyContribution,
      penaltiesDeduction,
      otherDeductions,
      totalDeductions,
      netSalary,
      currency,
      currencySymbol,
      isPaid: false,
    };
  });

  // P2.2: segment the batch totals by currency. The legacy numeric
  // totalGross/totalDeductions/totalNet are kept for backward compatibility,
  // but all display code must use totalsByCurrency so different currencies are
  // never summed together.
  const currencyGroups = {};
  items.forEach((it) => {
    const code = it.currency || settings.currency || 'USD';
    if (!currencyGroups[code]) {
      currencyGroups[code] = { code, symbol: it.currencySymbol || settings.currencySymbol || '$', gross: 0, deductions: 0, net: 0, companyGosi: 0, count: 0 };
    }
    const g = currencyGroups[code];
    g.gross += it.grossSalary || 0;
    g.deductions += it.totalDeductions || 0;
    g.net += it.netSalary || 0;
    g.companyGosi += it.gosiCompanyContribution || 0;
    g.count += 1;
  });
  const totalsByCurrency = Object.values(currencyGroups).map((g) => ({
    code: g.code,
    symbol: g.symbol,
    gross: parseFloat(g.gross.toFixed(2)),
    deductions: parseFloat(g.deductions.toFixed(2)),
    net: parseFloat(g.net.toFixed(2)),
    companyGosi: parseFloat(g.companyGosi.toFixed(2)),
    count: g.count,
  }));

  const totalGross = parseFloat(items.reduce((sum, it) => sum + it.grossSalary, 0).toFixed(2));
  const totalDeductions = parseFloat(items.reduce((sum, it) => sum + it.totalDeductions, 0).toFixed(2));
  const totalNet = parseFloat(items.reduce((sum, it) => sum + it.netSalary, 0).toFixed(2));
  const totalCompanyGosi = parseFloat(items.reduce((sum, it) => sum + it.gosiCompanyContribution, 0).toFixed(2));

  return {
    id: `PAYROLL-${month}`,
    month,
    title,
    issueDate,
    status: 'draft',
    totalGross,
    totalDeductions,
    totalNet,
    totalCompanyGosi,
    employeesCount: items.length,
    items,
    totalsByCurrency,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Compute the scheduled payroll release date for a batch from each branch's
 * "payDay" setting (day of month, default 25). When a batch covers several
 * branches, the release is scheduled for the LAST branch's payday so nothing
 * is released before it is due. Released batches keep their stored data and
 * are never re-scheduled.
 */
export function computePayrollReleaseSchedule(batch, companies = []) {
  if (!batch) return batch;
  if (batch.releaseStatus === 'released') return batch;

  const payDays = new Set();
  (batch.items || []).forEach((it) => {
    const comp = companies.find((c) => c.id === it.companyId);
    const br = comp ? (comp.branches || []).find((b) => b.id === it.branchId) : null;
    const pd = Number(br && br.payDay);
    if (pd >= 1 && pd <= 31) payDays.add(pd);
  });
  const fallback = (companies || [])
    .flatMap((c) => (c.branches || []).map((b) => Number(b.payDay)).filter((pd) => pd >= 1 && pd <= 31));
  const payDay = payDays.size ? Math.max(...payDays) : (fallback.length ? Math.max(...fallback) : 25);
  // Always recompute for pending (non-released) batches so a branch payDay
  // edit in Companies/Branches settings is reflected immediately.
  batch.releasePayDay = payDay;
  batch.releaseDate = `${batch.month}-${String(payDay).padStart(2, '0')}`;
  if (!batch.releaseStatus) batch.releaseStatus = 'scheduled';
  return batch;
}

/**
 * Generate a generic bank payroll file (CSV) for salary transfer.
 * Formatted for banks/aggregators; columns are generic (no country-specific
 * wage-protection scheme).
 */
export function generateBankPayrollFile(batch, settings) {
  const header = `${t('bankFile.crNumber')},${t('bankFile.companyName')},${t('bankFile.month')},${t('bankFile.employeesCount')},${t('bankFile.totalTransferred')},${t('bankFile.currency')}`;
  // P2.2: never merge different currencies in a total. The currency cell
  // holds a single currency code, or an explicit per-currency breakdown when a
  // batch mixes currencies (rows below stay numeric per employee).
  const totalByCurrency = (batch.totalsByCurrency || []).filter((g) => g && g.count > 0);
  let currencyCell = settings.currency || '';
  if (totalByCurrency.length === 1) {
    currencyCell = totalByCurrency[0].code || currencyCell;
  } else if (totalByCurrency.length > 1) {
    currencyCell = totalByCurrency.map((g) => `${g.code} ${g.net.toFixed(2)}`).join(' + ');
  }
  const meta = `${settings.commercialRegistration || ''},${settings.companyName},${batch.month},${batch.employeesCount},${batch.totalNet},${currencyCell}`;

  const columns = `${t('bankFile.num')},${t('bankFile.employeeNumber')},${t('bankFile.employeeName')},${t('bankFile.iban')},${t('bankFile.bankName')},${t('bankFile.basicSalary')},${t('bankFile.housing')},${t('bankFile.otherAllowances')},${t('bankFile.totalDeductions')},${t('bankFile.netTransferred')}`;

  const rows = batch.items.map((it, idx) => {
    const otherAllow = it.otherAllowances + it.transportAllowance + it.overtimeAmount;
    return `${idx + 1},${it.employeeNumber},"${it.employeeName}",${it.iban},"${it.bankName}",${it.basicSalary},${it.housingAllowance},${otherAllow},${it.totalDeductions},${it.netSalary}`;
  });

  return [header, meta, '', columns, ...rows].join('\n');
}

/**
 * Legacy alias for backward compatibility with older imports.
 */
export const generateWPSFile = generateBankPayrollFile;

/**
 * Phase 1 (Financial Workflow & Currency Spec v1.0): the official state
 * machine for a payroll batch. Every batch lives in exactly one state and may
 * ONLY move along the approved transitions below. Payment Queue is a logical
 * transition point (approved → paid), not a separate entity in this phase.
 *
 *   draft        → under_audit   (HR forwards the batch to Financial Audit)
 *   under_audit  → approved      (Audit approves, back to HR for payment)
 *   under_audit  → rejected      (Audit returns it; Returned/Needs Correction)
 *   rejected     → under_audit   (HR corrects then re-submits to Audit)
 *   approved     → paid          (HR pays salaries; payment queue point)
 *   paid         → (archived view; no further transition)
 */
export const PAYROLL_STATUSES = ['draft', 'under_audit', 'approved', 'rejected', 'paid'];
export const PAYROLL_ARCHIVE_STATUS = 'paid';
export const PAYROLL_RETURN_STATE = 'rejected';

const PAYROLL_STATE_TRANSITIONS = {
  draft: ['under_audit'],
  under_audit: ['approved', 'rejected'],
  rejected: ['under_audit'],
  approved: ['paid'],
  paid: [],
};

const MONETARY_FIELDS = [
  'basicSalary', 'housingAllowance', 'transportAllowance', 'otherAllowances',
  'overtimeAmount', 'bonuses', 'totalEarnings', 'grossSalary',
  'gosiEmployeeDeduction', 'gosiCompanyContribution', 'loanInstallment',
  'absentDays', 'absenceDeduction', 'lateMinutes', 'lateDeduction',
  'otherDeductions', 'penaltiesDeduction', 'totalDeductions', 'netSalary',
];

function cloneBatch(batch) {
  return { ...batch, items: (batch.items || []).map((it) => ({ ...it })) };
}

function snapshotBatch(batch) {
  return {
    status: batch.status,
    totalGross: batch.totalGross,
    totalDeductions: batch.totalDeductions,
    totalNet: batch.totalNet,
    totalGosi: batch.totalGosi,
    totalCompanyGosi: batch.totalCompanyGosi,
    totalEOSB: batch.totalEOSB,
    totalsByCurrency: (batch.totalsByCurrency || []).map((g) => ({ ...g })),
    items: (batch.items || []).map((it) => {
      const snap = { employeeId: it.employeeId, employeeName: it.employeeName };
      MONETARY_FIELDS.forEach((f) => { snap[f] = it[f]; });
      return snap;
    }),
  };
}

/**
 * Pure guard: returns { ok: true } when `batch` may legally transition to
 * state `to` per PAYROLL_STATE_TRANSITIONS, otherwise { ok: false }.
 */
export function canTransitionPayroll(batch, to) {
  if (!batch) return { ok: false, error: 'no_batch' };
  const from = batch.status || 'draft';
  if (!PAYROLL_STATUSES.includes(from)) return { ok: false, error: `unknown_state:${from}` };
  const allowed = PAYROLL_STATE_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) return { ok: false, error: `invalid_transition:${from}->${to}` };
  return { ok: true };
}

/**
 * Apply a legal state transition. Pure: returns a NEW batch, never mutates the
 * input (same contract as clearPayrollAmounts). Rejecting records the rejected
 * version snapshot, stamps rejection meta, keeps every monetary value intact
 * and appends to auditHistory/versions. Approving/paying stamp the responsible
 * user. Resubmitting stamps resubmittedBy/At and records a corrected version.
 */
export function transitionPayroll(batch, to, opts = {}) {
  const guard = canTransitionPayroll(batch, to);
  if (!guard.ok) return { ok: false, error: guard.error, batch };
  const now = new Date().toISOString();
  const actor = opts.by || '';
  const note = opts.note || `${to} (${now})`;
  const next = cloneBatch(batch);
  const from = next.status || 'draft';
  const revision = (next.revision || 0) + 1;

  if (to === 'under_audit') {
    if (from === 'draft') {
      next.transferredToAuditAt = now;
      next.transferredToAuditBy = actor;
    } else {
      next.resubmittedAt = now;
      next.resubmittedBy = actor;
      next.returnState = 'resubmitted';
    }
  } else if (to === 'approved') {
    next.auditedBy = actor;
    next.auditedAt = now;
    next.returnState = undefined;
  } else if (to === 'rejected') {
    next.rejectedBy = actor;
    next.rejectedAt = now;
    next.rejectionReason = opts.rejectionReason || note;
    next.returnState = 'needs_correction';
    next.isAmountsCleared = false;
    if (opts.auditNotes) {
      next.auditNotes = next.auditNotes ? `${next.auditNotes}\n${opts.auditNotes}` : opts.auditNotes;
    }
    next.rejectedSnapshot = snapshotBatch(next);
  } else if (to === 'paid') {
    next.paidBy = actor;
    next.paidAt = now;
    next.releaseStatus = 'released';
  }

  next.status = to;
  next.revision = revision;
  next.updatedAt = now;

  // Phase 3 additive data-model stamps (no behavior change): schema marker,
  // sealed original values on the first submission, and approval/payment
  // references on their terminal gateways. Attached to the clone only.
  next.payrollSchema = PAYROLL_SCHEMA;
  if (from === 'draft') {
    ensureBaseline(next, { by: actor, at: now });
  }
  if (to === 'approved') {
    attachApprovalReference(next, { by: actor, at: now, versionId: `V${revision}` });
  } else if (to === 'paid') {
    attachPaymentReference(next, { by: actor, at: now, versionId: `V${revision}`, referenceId: opts.referenceId });
  }

  next.auditHistory = Array.isArray(batch.auditHistory) ? batch.auditHistory.slice() : [];
  next.auditHistory.push({ action: to, from, to, by: actor, at: now, reason: opts.rejectionReason || note, revision });
  // Audit attempt/history keeps every audit round without ever losing data.
  next.auditAttempts = Array.isArray(batch.auditAttempts) ? batch.auditAttempts.slice() : [];
  next.auditAttempts.push({
    attempt: (batch.auditAttempts ? batch.auditAttempts.length : 0) + 1,
    result: to === 'rejected' ? 'returned' : to,
    by: actor,
    at: now,
    reason: opts.rejectionReason || '',
    fromVersion: batch.revision || 0,
    toVersion: revision,
  });
  // Version chain: Rejected Version → Corrected Version → Resubmitted Version.
  // Every version carries a sealed financialSnapshot + explicit links and the
  // post-transition status (Phase 3 additive fields; type/version/by/at/reason
  // are preserved exactly as before).
  next.versions = pushVersion(next, {
    type: to === 'rejected' ? 'rejected' : to === 'under_audit' && from === 'rejected' ? 'resubmitted' : to,
    version: revision,
    status: to,
    by: actor,
    at: now,
    reason: opts.rejectionReason || note,
  });
  return { ok: true, batch: next };
}

/**
 * Record an HR correction on a Returned batch: capture values changed since
 * the rejected snapshot (old value → new value), stamped with user, timestamp
 * and reason, and append the corrected version to the chain.
 */
export function recordPayrollCorrection(prev, next, opts = {}) {
  if (!prev || !next) return { ok: false, error: 'no_batch', batch: next };
  if ((prev.status || 'draft') !== 'rejected') {
    return { ok: false, error: `correction_requires_returned:${prev.status}`, batch: next };
  }
  const now = new Date().toISOString();
  const base = prev.rejectedSnapshot || snapshotBatch(prev);
  const changes = [];
  const srcItems = (base.items || []).filter((s) => s.employeeId);
  const toItems = next.items || [];
  srcItems.forEach((snap) => {
    const cur = toItems.find((it) => it.employeeId === snap.employeeId);
    if (!cur) return;
    MONETARY_FIELDS.forEach((f) => {
      const oldV = Number(snap[f]) || 0;
      const newV = Number(cur[f]) || 0;
      if (Math.abs(oldV - newV) > 0.0001) {
        changes.push({ employeeId: snap.employeeId, employeeName: snap.employeeName, field: f, oldValue: oldV, newValue: newV });
      }
    });
  });
  const revision = (next.revision || 0) + 1;
  next.status = 'rejected';
  next.returnState = 'corrected';
  next.revision = revision;
  next.updatedAt = now;
  next.payrollSchema = PAYROLL_SCHEMA;
  next.corrections = Array.isArray(prev.corrections) ? prev.corrections.slice() : [];
  next.corrections.push({
    by: opts.by || '',
    at: now,
    reason: opts.reason || 'correction after audit return',
    changes,
    fromVersion: prev.revision || 0,
    toVersion: revision,
  });
  next.versions = pushVersion(next, { type: 'corrected', version: revision, status: 'rejected', by: opts.by || '', at: now, reason: opts.reason || 'correction after audit return' });
  next.auditHistory = Array.isArray(prev.auditHistory) ? prev.auditHistory.slice() : [];
  next.auditHistory.push({ action: 'corrected', from: prev.status, to: 'rejected', by: opts.by || '', at: now, reason: opts.reason || '', revision });
  next.auditAttempts = Array.isArray(prev.auditAttempts) ? prev.auditAttempts.slice() : [];
  next.auditAttempts.push({
    attempt: (prev.auditAttempts ? prev.auditAttempts.length : 0) + 1,
    result: 'corrected',
    by: opts.by || '',
    at: now,
    reason: opts.reason || '',
    fromVersion: prev.revision || 0,
    toVersion: revision,
  });
  ['rejectedBy', 'rejectedAt', 'rejectionReason', 'auditNotes'].forEach((f) => {
    if (prev[f] !== undefined) next[f] = prev[f];
  });
  return { ok: true, batch: next };
}

/**
 * Archive a paid payroll batch. Archiving is an orthogonal, guarded operation
 * (Phase 2: permissions), NOT a new state-machine transition: the batch stays
 * in the terminal 'paid' state and receives an archival stamp so the financial
 * record still exists but is clearly retired from the active disbursed list.
 * Works on a clone — the input is never mutated.
 */
export function archivePayrollBatch(batch, opts = {}) {
  if (!batch) return { ok: false, error: 'no_batch', batch };
  if (batch.archived) return { ok: false, error: 'already_archived', batch };
  if ((batch.status || 'draft') !== 'paid') {
    return { ok: false, error: `archive_requires_paid:${batch.status}`, batch };
  }
  const next = cloneBatch(batch);
  const now = new Date().toISOString();
  const actor = opts.by || '';
  next.archived = true;
  next.archivedAt = now;
  next.archivedBy = actor;
  next.updatedAt = now;
  next.payrollSchema = PAYROLL_SCHEMA;
  next.archiveReference = attachArchiveReference(next, { by: actor, at: now, reason: opts.reason || 'salary archive' });
  next.auditHistory = Array.isArray(batch.auditHistory) ? batch.auditHistory.slice() : [];
  next.auditHistory.push({ action: 'archive', from: 'paid', to: 'paid', by: actor, at: now, reason: opts.reason || 'salary archive', revision: batch.revision || 0 });
  return { ok: true, batch: next };
}

/**
 * Legacy P2.2 "reject-and-return" rule: when the Financial Audit rejects a
 * payroll, EVERY monetary figure in the batch is wiped to zero (statement renders as
 * empty/zeros instead of showing the previously submitted amounts) and the
 * batch is returned to HR as a draft. HR uses Recalculate to regenerate the
 * figures from the live attendance, overtime, loans and absence records
 * before re-submitting to the audit.
 *
 * DEPRECATED since Phase 1 (Spec v1.0): rejection MUST NOT zero or lose any
 * financial value and MUST use the distinct Returned/Needs Correction state
 * (status 'rejected'). Kept exported only for backward compatibility and
 * legacy test data; the active reject flow uses transitionPayroll(..., 'rejected').
 *
 * Returns a NEW batch object; the input is never mutated.
 */
export function clearPayrollAmounts(batch, opts = {}) {
  if (!batch) return batch;
  const cleared = { ...batch, items: (batch.items || []).map((it) => ({ ...it })) };
  cleared.status = 'draft';
  cleared.auditStatus = 'rejected';
  cleared.isAmountsCleared = true;
  if (opts.rejectedBy) cleared.rejectedBy = opts.rejectedBy;
  if (opts.rejectedAt) cleared.rejectedAt = opts.rejectedAt;
  if (opts.auditNotes) cleared.auditNotes = opts.auditNotes;

  cleared.items = cleared.items.map((it) => ({
    ...it,
    basicSalary: 0,
    housingAllowance: 0,
    transportAllowance: 0,
    otherAllowances: 0,
    overtimeAmount: 0,
    bonuses: 0,
    totalEarnings: 0,
    grossSalary: 0,
    gosiEmployeeDeduction: 0,
    gosiCompanyContribution: 0,
    loanInstallment: 0,
    absentDays: 0,
    absenceDeduction: 0,
    lateMinutes: 0,
    lateDeduction: 0,
    otherDeductions: 0,
    penaltiesDeduction: 0,
    totalDeductions: 0,
    netSalary: 0,
    auditStatus: 'rejected',
    isAmountsCleared: true,
  }));

  cleared.totalGross = 0;
  cleared.totalDeductions = 0;
  cleared.totalNet = 0;
  cleared.totalGosi = 0;
  cleared.totalCompanyGosi = 0;
  cleared.totalEOSB = 0;
  cleared.totalsByCurrency = (cleared.totalsByCurrency || []).map((g) => ({
    code: g.code,
    gross: 0,
    deductions: 0,
    net: 0,
    gosi: 0,
  }));
  return cleared;
}
