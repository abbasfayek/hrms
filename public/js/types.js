// ==========================================
// HRMS Constants, Multi-Company, Users & Types
// ==========================================

import { i18n, t } from './i18n.js';
import { defaultCurrencies } from './seedData.js';

// Centralized HTML escaping (XSS hardening - C-3)
/**
 * Escape a value for safe interpolation inside innerHTML/render templates.
 * textContent and attribute-context interpolation of user-entered data must go
 * through this function so stored values (names, notes, reasons) can never
 * inject markup or script into the running application.
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

/**
 * Same as escapeHtml, optimized for HTML attribute values (double-quoted).
 */
export function escapeAttr(value) {
  return escapeHtml(value);
}

export const USER_ROLES = {
  super_admin: {
    id: 'super_admin',
    nameAr: 'صلاحية عامة (مدير عام)',
    nameEn: 'Global Super Admin',
    descAr: 'الوصول الكامل لكافة الشركات والفروع والإعدادات',
    descEn: 'Full access to all companies, branches and global settings',
    badgeClass: 'badge-primary',
  },
  company_hr: {
    id: 'company_hr',
    nameAr: 'مسؤول شركة (كافة فروع الشركة)',
    nameEn: 'Company HR Manager',
    descAr: 'الوصول لكافة فروع شركة محددة فقط',
    descEn: 'Access to all branches of a specific assigned company',
    badgeClass: 'badge-info',
  },
  branch_hr: {
    id: 'branch_hr',
    nameAr: 'مسؤول فرع محدد',
    nameEn: 'Branch HR Specialist',
    descAr: 'الوصول لموظفي وعمليات فرع محدد فقط',
    descEn: 'Restricted access to a specific branch only',
    badgeClass: 'badge-warning',
  },
  payroll_admin: {
    id: 'payroll_admin',
    nameAr: 'مسؤول الرواتب (تدوير الرواتب)',
    nameEn: 'Payroll Admin',
    descAr: 'إنشاء وتعديل مسيرات الرواتب وترحيلها للتدقيق المالي',
    descEn: 'Creates, edits and submits payroll batches to financial audit',
    badgeClass: 'badge-purple',
  },
  audit_reviewer: {
    id: 'audit_reviewer',
    nameAr: 'مدقق مالي (مراجع التدقيق)',
    nameEn: 'Audit Reviewer',
    descAr: 'مراجعة المسيرات، وقبولها أو ردّها للتصحيح',
    descEn: 'Reviews payroll batches and approves or rejects/returns them',
    badgeClass: 'badge-cyan',
  },
  payments_officer: {
    id: 'payments_officer',
    nameAr: 'موظف الصرف المالي',
    nameEn: 'Payments Officer',
    descAr: 'تنفيذ عمليات الصرف للرواتب المعتمدة فقط',
    descEn: 'Executes disbursement of approved payrolls only',
    badgeClass: 'badge-gold',
  },
};

// =========================================================
// Granular Permissions (RBAC) - global permission catalog
// =========================================================
// Modules group permissions for the UI. Permission ids follow
// "<module>.<action>" so they stay readable and reusable.
export const PERMISSION_MODULES = [
  { id: 'general', nameAr: 'عام', nameEn: 'General', color: '#6366f1' },
  { id: 'employees', nameAr: 'الموظفون', nameEn: 'Employees', color: '#4f46e5' },
  { id: 'leaves', nameAr: 'الإجازات', nameEn: 'Leaves', color: '#8b5cf6' },
  { id: 'hourlyLeaves', nameAr: 'الإجازات الزمنية', nameEn: 'Hourly Leaves', color: '#a855f7' },
  { id: 'attendance', nameAr: 'الحضور والإضافي', nameEn: 'Attendance & Overtime', color: '#06b6d4' },
  { id: 'loans', nameAr: 'السلف', nameEn: 'Advances', color: '#f59e0b' },
  { id: 'increments', nameAr: 'الزيادات', nameEn: 'Increments', color: '#10b981' },
  { id: 'deductions', nameAr: 'الخصومات والمكافآت', nameEn: 'Deductions & Bonuses', color: '#ef4444' },
  { id: 'payroll', nameAr: 'الرواتب', nameEn: 'Payroll', color: '#ec4899' },
  { id: 'eosb', nameAr: 'نهاية الخدمة', nameEn: 'End of Service', color: '#0ea5e9' },
  { id: 'companies', nameAr: 'الشركات والفروع', nameEn: 'Companies & Branches', color: '#f97316' },
  { id: 'reports', nameAr: 'التقارير', nameEn: 'Reports', color: '#14b8a6' },
  { id: 'audit', nameAr: 'سجل التدقيق', nameEn: 'Audit Log', color: '#64748b' },
  { id: 'users', nameAr: 'المستخدمون', nameEn: 'Users', color: '#7c3aed' },
  { id: 'settings', nameAr: 'الإعدادات', nameEn: 'Settings', color: '#334155' },
];

export const ALL_PERMISSIONS = [
  'dashboard.view',
  'employees.view', 'employees.add', 'employees.edit', 'employees.delete',
  'leaves.view', 'leaves.add', 'leaves.edit', 'leaves.delete', 'leaves.approve',
  'hourlyLeaves.view', 'hourlyLeaves.add', 'hourlyLeaves.edit', 'hourlyLeaves.delete', 'hourlyLeaves.approve',
  'attendance.view', 'attendance.add', 'attendance.edit', 'attendance.delete',
  'overtime.add', 'overtime.edit', 'overtime.delete', 'overtime.approve',
  'loans.view', 'loans.add', 'loans.edit', 'loans.pay', 'loans.delete',
  'increments.view', 'increments.add', 'increments.edit', 'increments.delete',
  'deductions.view', 'deductions.add', 'deductions.edit', 'deductions.delete',
  'payroll.view', 'payroll.generate', 'payroll.edit', 'payroll.approve', 'payroll.reject', 'payroll.submit', 'payroll.cancelPayment', 'payroll.archive', 'payroll.export', 'payroll.disburse',
  'eosb.view', 'eosb.calculate', 'eosb.approve', 'eosb.pay', 'eosb.delete',
  'companies.view', 'companies.manage',
  'reports.view', 'reports.export',
  'audit.view',
  'users.view', 'users.manage',
  'settings.view', 'settings.manage',
];

// Human readable labels (AR / EN) for every permission
export const PERMISSIONS = {
  'dashboard.view': { module: 'general', ar: 'عرض لوحة التحكم', en: 'View dashboard' },
  'employees.view': { module: 'employees', ar: 'عرض الموظفين', en: 'View employees' },
  'employees.add': { module: 'employees', ar: 'إضافة موظف', en: 'Add employee' },
  'employees.edit': { module: 'employees', ar: 'تعديل موظف', en: 'Edit employee' },
  'employees.delete': { module: 'employees', ar: 'حذف موظف نهائياً', en: 'Delete employee' },
  'leaves.view': { module: 'leaves', ar: 'عرض الإجازات والأرصدة', en: 'View leaves & balances' },
  'leaves.add': { module: 'leaves', ar: 'تسجيل إجازة', en: 'Request leave' },
  'leaves.edit': { module: 'leaves', ar: 'تعديل طلب إجازة', en: 'Edit leave request' },
  'leaves.delete': { module: 'leaves', ar: 'حذف طلب إجازة', en: 'Delete leave request' },
  'leaves.approve': { module: 'leaves', ar: 'اعتماد / رفض الإجازات', en: 'Approve / reject leaves' },
  'hourlyLeaves.view': { module: 'hourlyLeaves', ar: 'عرض الإجازات الزمنية', en: 'View hourly leaves' },
  'hourlyLeaves.add': { module: 'hourlyLeaves', ar: 'تسجيل إجازة زمنية', en: 'Request hourly leave' },
  'hourlyLeaves.edit': { module: 'hourlyLeaves', ar: 'تعديل إجازة زمنية', en: 'Edit hourly leave' },
  'hourlyLeaves.delete': { module: 'hourlyLeaves', ar: 'حذف إجازة زمنية', en: 'Delete hourly leave' },
  'hourlyLeaves.approve': { module: 'hourlyLeaves', ar: 'اعتماد إجازة زمنية', en: 'Approve hourly leave' },
  'attendance.view': { module: 'attendance', ar: 'عرض الحضور والغياب', en: 'View attendance' },
  'attendance.add': { module: 'attendance', ar: 'تسجيل حضور / غياب', en: 'Record attendance' },
  'attendance.edit': { module: 'attendance', ar: 'تعديل سجل حضور', en: 'Edit attendance record' },
  'attendance.delete': { module: 'attendance', ar: 'حذف سجل حضور', en: 'Delete attendance record' },
  'overtime.add': { module: 'attendance', ar: 'تسجيل عمل إضافي', en: 'Record overtime' },
  'overtime.edit': { module: 'attendance', ar: 'تعديل عمل إضافي', en: 'Edit overtime' },
  'overtime.delete': { module: 'attendance', ar: 'حذف عمل إضافي', en: 'Delete overtime' },
  'overtime.approve': { module: 'attendance', ar: 'اعتماد عمل إضافي', en: 'Approve overtime' },
  'loans.view': { module: 'loans', ar: 'عرض السلف', en: 'View advances' },
  'loans.add': { module: 'loans', ar: 'إضافة / منح سلفة', en: 'Grant advance' },
  'loans.edit': { module: 'loans', ar: 'تعديل سلفة', en: 'Edit advance' },
  'loans.pay': { module: 'loans', ar: 'تسديد قسط سلفة', en: 'Settle advance installment' },
  'loans.delete': { module: 'loans', ar: 'حذف سلفة', en: 'Delete advance' },
  'increments.view': { module: 'increments', ar: 'عرض سجل الزيادات', en: 'View increments' },
  'increments.add': { module: 'increments', ar: 'تطبيق زيادة راتب', en: 'Apply salary increment' },
  'increments.edit': { module: 'increments', ar: 'تعديل زيادة', en: 'Edit increment' },
  'increments.delete': { module: 'increments', ar: 'حذف زيادة', en: 'Delete increment' },
  'deductions.view': { module: 'deductions', ar: 'عرض الخصومات والمكافآت', en: 'View deductions & bonuses' },
  'deductions.add': { module: 'deductions', ar: 'إضافة خصم / مكافأة', en: 'Add deduction / bonus' },
  'deductions.edit': { module: 'deductions', ar: 'تعديل خصم / مكافأة', en: 'Edit deduction / bonus' },
  'deductions.delete': { module: 'deductions', ar: 'حذف خصم / مكافأة', en: 'Delete deduction / bonus' },
  'payroll.view': { module: 'payroll', ar: 'عرض مسيرات الرواتب', en: 'View payroll' },
  'payroll.generate': { module: 'payroll', ar: 'إنشاء / إعادة احتساب المسير', en: 'Generate payroll' },
  'payroll.edit': { module: 'payroll', ar: 'تعديل مسير قبل الاعتماد', en: 'Edit draft payroll' },
  'payroll.approve': { module: 'payroll', ar: 'تدقيق المسير واعتماده', en: 'Audit & approve payroll' },
  'payroll.reject': { module: 'payroll', ar: 'رد المسير للتصحيح (Returned)', en: 'Reject / return payroll for correction' },
  'payroll.submit': { module: 'payroll', ar: 'ترحيل المسير للتدقيق المالي', en: 'Submit payroll to financial audit' },
  'payroll.cancelPayment': { module: 'payroll', ar: 'إلغاء الصرف لحالة مدفوعة', en: 'Cancel payment on a paid batch' },
  'payroll.archive': { module: 'payroll', ar: 'أرشفة مسير مصروف', en: 'Archive a paid payroll batch' },
  'payroll.export': { module: 'payroll', ar: 'تصدير ملف الرواتب البنكي', en: 'Export bank payroll file' },
  'payroll.disburse': { module: 'payroll', ar: 'صرف الرواتب مالياً', en: 'Disburse salaries' },
  'eosb.view': { module: 'eosb', ar: 'عرض نهاية الخدمة', en: 'View end of service' },
  'eosb.calculate': { module: 'eosb', ar: 'احتساب وتصفية مكافأة', en: 'Calculate & process benefit' },
  'eosb.approve': { module: 'eosb', ar: 'اعتماد تسوية نهاية الخدمة', en: 'Approve settlement' },
  'eosb.pay': { module: 'eosb', ar: 'صرف تسوية نهاية الخدمة مالياً', en: 'Disburse settlement payment' },
  'eosb.delete': { module: 'eosb', ar: 'حذف سجل تسوية', en: 'Delete settlement record' },
  'companies.view': { module: 'companies', ar: 'عرض الشركات والفروع', en: 'View companies & branches' },
  'companies.manage': { module: 'companies', ar: 'إدارة الشركات والفروع', en: 'Manage companies & branches' },
  'reports.view': { module: 'reports', ar: 'عرض التقارير', en: 'View reports' },
  'reports.export': { module: 'reports', ar: 'تصدير التقارير', en: 'Export reports' },
  'audit.view': { module: 'audit', ar: 'مشاهدة سجل التدقيق', en: 'View audit log' },
  'users.view': { module: 'users', ar: 'عرض المستخدمين', en: 'View users' },
  'users.manage': { module: 'users', ar: 'إدارة المستخدمين والصلاحيات', en: 'Manage users & permissions' },
  'settings.view': { module: 'settings', ar: 'عرض الإعدادات', en: 'View settings' },
  'settings.manage': { module: 'settings', ar: 'تعديل إعدادات النظام', en: 'Manage system settings' },
};

// Default permission set applied automatically when a role is chosen.
// An admin can later override any permission for a specific user.
export const DEFAULT_ROLE_PERMISSIONS = {
  super_admin: ALL_PERMISSIONS,
  company_hr: [
    'dashboard.view',
    'employees.view', 'employees.add', 'employees.edit', 'employees.delete',
    'leaves.view', 'leaves.add', 'leaves.edit', 'leaves.delete', 'leaves.approve',
    'hourlyLeaves.view', 'hourlyLeaves.add', 'hourlyLeaves.edit', 'hourlyLeaves.delete', 'hourlyLeaves.approve',
    'attendance.view', 'attendance.add', 'attendance.edit', 'attendance.delete',
    'overtime.add', 'overtime.edit', 'overtime.delete', 'overtime.approve',
    'loans.view', 'loans.add', 'loans.edit', 'loans.pay', 'loans.delete',
    'increments.view', 'increments.add', 'increments.edit', 'increments.delete',
    'deductions.view', 'deductions.add', 'deductions.edit', 'deductions.delete',
'payroll.view', 'payroll.generate', 'payroll.edit', 'payroll.submit', 'payroll.export',
    'eosb.view', 'eosb.calculate', 'eosb.approve', 'eosb.pay', 'eosb.delete',
    'companies.view', 'companies.manage',
    'reports.view', 'reports.export',
    'audit.view',
    'settings.view',
  ],
  branch_hr: [
    'dashboard.view',
    'employees.view', 'employees.add', 'employees.edit',
    'leaves.view', 'leaves.add', 'leaves.edit', 'leaves.approve',
    'hourlyLeaves.view', 'hourlyLeaves.add', 'hourlyLeaves.edit', 'hourlyLeaves.approve',
    'attendance.view', 'attendance.add', 'attendance.edit',
    'overtime.add', 'overtime.edit', 'overtime.approve',
    'loans.view', 'loans.add', 'loans.edit', 'loans.pay',
    'increments.view', 'increments.add',
    'deductions.view', 'deductions.add', 'deductions.edit',
    'payroll.view', 'payroll.generate',
    'eosb.view', 'eosb.calculate',
    'companies.view',
    'reports.view',
  ],
  // Phase 2 (Spec v1.0): Payroll Admin creates/edits batches and submits them
  // to financial audit. It may NOT approve, reject, disburse or archive.
  payroll_admin: [
    'dashboard.view',
    'payroll.view', 'payroll.generate', 'payroll.edit', 'payroll.submit', 'payroll.export',
    'reports.view',
  ],
  // Phase 2 (Spec v1.0): Audit Reviewer approves or rejects/returns submitted
  // payrolls. It may NOT generate, edit, submit, pay or archive.
  // payroll.cancelPayment is reserved for the phase that extends the state
  // machine (paid is terminal in Phase 1) — declared here, currently inert.
  audit_reviewer: [
    'dashboard.view',
    'payroll.view',
    'payroll.approve', 'payroll.reject', 'payroll.cancelPayment',
    'audit.view',
    'reports.view',
  ],
  // Phase 2 (Spec v1.0): Payments Officer only executes disbursement of
  // approved payrolls (the payment queue point). It may NOT generate, edit,
  // submit, approve or reject.
  payments_officer: [
    'dashboard.view',
    'payroll.view', 'payroll.disburse',
    'reports.view',
  ],
};

/**
 * Check whether a user has a permission.
 * Legacy users without an explicit permissions array fall back to their
 * role's default set, so nothing breaks for existing stored accounts.
 */
export function getEffectivePermissions(user) {
  if (!user) return [];
  if (Array.isArray(user.permissions)) return user.permissions;
  return DEFAULT_ROLE_PERMISSIONS[user.role] || [];
}

export function can(user, permission) {
  if (!user) return false;
  const perms = getEffectivePermissions(user);
  return perms.includes(permission);
}

/**
 * Module label helper - keeps permission grouping labels in sync.
 */
export function getPermissionModuleNames(user) {
  const perms = getEffectivePermissions(user);
  return PERMISSION_MODULES.filter((m) => perms.some((p) => (PERMISSIONS[p] || {}).module === m.id)).map((m) => m.id);
}

export const STATUS_LABELS = {
  active: { get text() { return t('statusActive'); }, class: 'badge-success' },
  probation: { get text() { return t('statusProbation'); }, class: 'badge-warning' },
  on_leave: { get text() { return t('statusOnLeave'); }, class: 'badge-info' },
  resigned: { get text() { return t('statusResigned'); }, class: 'badge-gray' },
  terminated: { get text() { return t('statusTerminated'); }, class: 'badge-danger' },
  pending: { get text() { return t('statusPending'); }, class: 'badge-warning' },
  approved: { get text() { return t('statusApproved'); }, class: 'badge-success' },
  rejected: { get text() { return t('statusRejected'); }, class: 'badge-danger' },
  cancelled: { get text() { return t('statusCancelled'); }, class: 'badge-gray' },
};

export const CONTRACT_TYPE_LABELS = {
  full_time: { ar: 'دوام كامل', en: 'Full-Time' },
  part_time: { ar: 'دوام جزئي', en: 'Part-Time' },
  contract: { ar: 'عقد محدد المدة', en: 'Fixed-Term Contract' },
  probation: { ar: 'فترة تجربة', en: 'Probationary' },
};

export const LEAVE_TYPE_LABELS = {
  annual: { ar: 'إجازة سنوية اعتيادية', en: 'Annual Leave', color: '#4f46e5' },
  sick: { ar: 'إجازة مرضية', en: 'Sick Leave', color: '#ef4444' },
  unpaid: { ar: 'إجازة بدون راتب', en: 'Unpaid Leave', color: '#64748b' },
  emergency: { ar: 'إجازة اضطرارية', en: 'Emergency Leave', color: '#f59e0b' },
  maternity: { ar: 'إجازة أمومة / وضع', en: 'Maternity Leave', color: '#ec4899' },
  paternity: { ar: 'إجازة رعاية مولود / أبوة', en: 'Paternity Leave', color: '#06b6d4' },
  hajj: { ar: 'إجازة مناسك (حج/عمرة)', en: 'Religious Leave (Hajj / Umrah)', color: '#10b981' },
  bereavement: { ar: 'إجازة وفاة', en: 'Bereavement Leave', color: '#334155' },
  marriage: { ar: 'إجازة زواج', en: 'Marriage Leave', color: '#8b5cf6' },
};

export const TERMINATION_REASONS = {
  resignation: { ar: 'استقالة الموظف (بناءً على طلبه)', en: 'Employee Resignation' },
  company_termination: { ar: 'إنهاء خدمات من طرف الشركة', en: 'Termination by Company' },
  contract_expiration: { ar: 'انتهاء مدة العقد وعدم الرغبة بالتجديد', en: 'Contract Expiration' },
  mutual_agreement: { ar: 'إنهاء العقد بالتراضي بين الطرفين', en: 'Mutual Agreement' },
  probation_failure: { ar: 'عدم اجتياز فترة التجربة بنجاح', en: 'Probation Failure' },
  summary_dismissal: { ar: 'الفصل التأديبي (إنهاء فوري دون مكافأة)', en: 'Summary Dismissal (Disciplinary)' },
  force_majeure: { ar: 'قوة قاهرة / ظروف صحية قهرية', en: 'Force Majeure' },
  non_renewal_by_employee: { ar: 'عدم تجديد العقد بطلب الموظف', en: 'Non-renewal by Employee' },
  retirement: { ar: 'التقاعد', en: 'Retirement' },
  // Legacy alias — kept so previously archived records still resolve their label.
  article_80_violation: { ar: 'الفصل التأديبي (إنهاء فوري دون مكافأة)', en: 'Summary Dismissal (Disciplinary)' },
};

export const DEPARTMENTS_LIST = [
  'تقنية المعلومات',
  'الموارد البشرية',
  'المالية والمحاسبة',
  'العمليات والتشغيل',
  'المبيعات والتسويق',
  'خدمة العملاء',
  'الشؤون القانونية',
  'الإدارة العامة',
];

/**
 * Format currency - always uses Western numerals (0-9), symbol after amount
 */
export function formatCurrency(amount, currencySymbol = '$') {
  const val = Number(amount) || 0;
  // Always use en-US locale so we get 500.00 not ٥٠٠٫٠٠
  const formatted = val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted} ${currencySymbol}`.trim();
}

/**
 * All currencies available in the system: built-in presets + custom ones
 * configured in Settings. Custom entries with an existing code override nothing
 * (built-in presets win); they are deduped by code.
 */
export function getAllCurrencies(settings = {}) {
  const custom = Array.isArray(settings.customCurrencies) ? settings.customCurrencies : [];
  const merged = defaultCurrencies.concat(custom);
  const seen = new Set();
  return merged.filter((c) => c && c.code && !seen.has(c.code) && seen.add(c.code));
}

/**
 * Resolve the currency that applies to a given employee:
 * employee.currency (if set) > employee's company currency > global settings.
 * Returns a { code, symbol, nameAr, nameEn } record.
 */
export function resolveEmployeeCurrency(emp, settings = {}, companies = []) {
  const all = getAllCurrencies(settings);
  let code = emp && emp.currency;
  if (!code) {
    const comp = (emp && emp.companyId) ? companies.find((c) => c.id === emp.companyId) : null;
    code = (comp && comp.currency) || settings.currency || (emp && emp.currencySymbol) || 'USD';
  }
  return all.find((c) => c.code === code) || all.find((c) => c.code === 'USD') || { code: 'USD', symbol: '$', nameAr: 'دولار أمريكي', nameEn: 'US Dollar' };
}

/**
 * Format an amount with the explicit three-letter currency CODE (not just a
 * symbol), e.g. "1,500.00 USD". Used wherever a report shows money so the
 * reader always sees which currency an amount belongs to.
 */
export function formatAmountWithCode(amount, currencyCode = '') {
  const val = Number(amount) || 0;
  const formatted = val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const code = String(currencyCode || '').trim();
  return code ? `${formatted} ${code}` : formatted;
}

/**
 * P2.2 multi-currency rule: NEVER merge amounts of different currencies into
 * a single total. This helper takes a list of { code, amount } entries and
 * returns the aggregated textual total grouped per currency, e.g.
 * "1,500.00 USD + 750,000.00 IQD". If only one currency is present the code
 * still appears next to the amount. Returns "0.00" when empty.
 */
export function summarizeCurrencySegments(segments = []) {
  const totals = {};
  (segments || []).forEach((s) => {
    if (!s) return;
    const code = String(s.code || '').trim();
    if (!code) return;
    totals[code] = (totals[code] || 0) + (Number(s.amount) || 0);
  });
  const codes = Object.keys(totals);
  if (!codes.length) return '0.00';
  return codes.map((code) => {
    const v = Number(totals[code]) || 0;
    const formatted = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${formatted} ${code}`;
  }).join(' + ');
}

// Stable visual color per currency code so mixed-currency boxes are readable.
const CURRENCY_CODE_COLORS = {
  USD: '#0ea5e9', IQD: '#f59e0b', EUR: '#8b5cf6', SAR: '#10b981',
  AED: '#14b8a6', KWD: '#ec4899', EGP: '#f97316', GBP: '#6366f1',
  TRY: '#ef4444', JOD: '#0d9488', QAR: '#3b82f6',
};

function currencyCodeColor(code) {
  if (CURRENCY_CODE_COLORS[code]) return CURRENCY_CODE_COLORS[code];
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 70%, 45%)`;
}

/**
 * P2.2 multi-currency display rule (UI): like summarizeCurrencySegments but
 * returns safe HTML where every currency sits on its OWN line inside the same
 * cell/box — never "1,500.00 USD + 750,000.00 IQD" packed into one run of text
 * (that overflows/overlaps in mixed RTL+LTR layouts). Amounts always use en-US
 * decimals (750,000.00) and the currency code is tinted with a stable per-code
 * color so IQD/USD are visually distinguishable. Pass { sign: '-' } to prefix
 * each line (deduction-style totals). Renders "0.00" when empty.
 */
export function summarizeCurrencySegmentsHtml(segments = [], opts = {}) {
  const totals = {};
  (segments || []).forEach((s) => {
    if (!s) return;
    const code = String(s.code || '').trim();
    if (!code) return;
    totals[code] = (totals[code] || 0) + (Number(s.amount) || 0);
  });
  const prefix = opts.sign === '-' ? '- ' : '';
  const codes = Object.keys(totals);
  if (!codes.length) return `<span style="direction:ltr; unicode-bidi:embed; white-space:nowrap;">${prefix}0.00</span>`;
  return codes.map((code) => {
    const v = Number(totals[code]) || 0;
    const formatted = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const color = currencyCodeColor(code);
    return `<div style="direction:ltr; unicode-bidi:embed; white-space:nowrap;">${prefix}${formatted} <span style="color:${color}; font-weight:700;">${escapeHtml(code)}</span></div>`;
  }).join('');
}

/**
 * P2.2 absence-day factor rule: an attendance record with status "absent"
 * counts as the number of deductible days stored on it (deductibleDays).
 * Undefined/legacy records default to a full day (1), and the half-day option
 * (0.5) must be preserved exactly so payroll, payslips and reports never round
 * a half-day up to a full day. Returns a fractional non-negative number.
 * e.g. countAbsenceDays([{status:'absent',deductibleDays:0.5},{status:'absent'}]) === 1.5
 */
export function countAbsenceDays(attendanceRecords = []) {
  return (attendanceRecords || []).reduce((sum, att) => {
    if (!att || att.status !== 'absent') return sum;
    const raw = att.deductibleDays;
    const factor = raw === undefined || raw === null || raw === '' ? 1 : Number(raw);
    return sum + (Number.isFinite(factor) ? Math.max(0, factor) : 1);
  }, 0);
}

/**
 * P2.2 Super-Admin payroll lock: the payroll engine/display is enabled unless
 * the database setting was explicitly turned off. Read freshly from the
 * settings object at every display/calculation (never from a time constant).
 */
export function isPayrollViewEnabled(settings = {}) {
  return settings.payrollViewEnabled !== false;
}

/**
 * Format date in localized format
 */
export function formatDate(dateString) {
  if (!dateString) return '-';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    // Use en-US for consistent display (no Arabic-Indic digits in dates)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateString;
  }
}

/**
 * Calculate difference in calendar days (includes Fridays and weekends)
 * Used only for raw date math - use countWorkingDays for leave calculations
 */
export function dateDiffDays(startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return 0;
  const d1 = new Date(startDateStr);
  const d2 = new Date(endDateStr);
  const diffTime = d2.getTime() - d1.getTime();
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1);
}

/**
 * Count working days between two dates, excluding configured weekly off days
 * and, optionally, a list of excluded calendar dates (official holidays).
 * Day numbers follow JS convention: 0=Sunday, 1=Monday, ... 5=Friday, 6=Saturday.
 * Pass an empty weekend array to count every calendar day.
 * Accepts both an explicit weekend array (preferred) and the legacy boolean flag.
 */
export function countWorkingDays(startDateStr, endDateStr, weekendDaysOrFlag = [5, 6], excludeDates = []) {
  if (!startDateStr || !endDateStr) return 0;
  // Legacy callers passed a single boolean meaning "exclude Friday only".
  if (typeof weekendDaysOrFlag === 'boolean') {
    weekendDaysOrFlag = weekendDaysOrFlag ? [5] : [];
  }
  const weekendDays = Array.isArray(weekendDaysOrFlag) ? weekendDaysOrFlag.map(Number) : [5, 6];
  // Parse date-only inputs as calendar dates.  Using new Date('YYYY-MM-DD')
  // makes the result dependent on the browser time zone near midnight.
  const parseDateOnly = (value) => {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? date : null;
  };
  const start = parseDateOnly(startDateStr);
  const end = parseDateOnly(endDateStr);
  if (!start || !end || end < start) return 0;

  const toStr = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const excluded = new Set(Array.isArray(excludeDates) ? excludeDates.map(String) : []);

  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const day = current.getUTCDay(); // 0=Sun, ... 6=Sat
    if (!weekendDays.includes(day) && !excluded.has(toStr(current))) {
      count++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count;
}

/**
 * List every calendar date string (YYYY-MM-DD, UTC) inside a date range.
 */
export function listDateStringsInRange(startDateStr, endDateStr) {
  const out = [];
  if (!startDateStr || !endDateStr) return out;
  const parseDateOnly = (value) => {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? date : null;
  };
  const start = parseDateOnly(startDateStr);
  const end = parseDateOnly(endDateStr);
  if (!start || !end || end < start) return out;
  const toStr = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const current = new Date(start);
  while (current <= end) {
    out.push(toStr(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return out;
}

/**
 * Does an official holiday apply to a specific employee (by company & branch)?
 * A holiday with companyId 'all' / branchId 'all' (or missing) applies everywhere.
 */
export function isHolidayApplicable(holiday, employee) {
  if (!holiday || !holiday.startDate) return false;
  const companyOk = !holiday.companyId || holiday.companyId === 'all'
    || (employee && employee.companyId && holiday.companyId === employee.companyId);
  const branchOk = !holiday.branchId || holiday.branchId === 'all'
    || (employee && employee.branchId && holiday.branchId === employee.branchId);
  return companyOk && branchOk;
}

/**
 * Official holiday calendar dates that apply to an employee within a range.
 * Returns an array of YYYY-MM-DD strings that should be excluded from leave counting.
 */
export function listCompanyHolidayDatesInRange(holidays, employee, startDateStr, endDateStr) {
  const out = new Set();
  (holidays || []).forEach((h) => {
    if (!isHolidayApplicable(h, employee)) return;
    const s = h.startDate > startDateStr ? h.startDate : startDateStr;
    const e = h.endDate < endDateStr ? h.endDate : endDateStr;
    listDateStringsInRange(s, e).forEach((d) => out.add(d));
  });
  return [...out];
}

/**
 * Format a YYYY-MM payroll month as a friendly label like "9-2026".
 */
export function formatPayMonth(month) {
  if (!month || !String(month).includes('-')) return month || '';
  const [y, m] = String(month).split('-');
  return `${Number(m)}-${y}`;
}

/**
 * Get current year and month in YYYY-MM format
 */
export function getCurrentMonth() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
