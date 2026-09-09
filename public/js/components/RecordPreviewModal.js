// ==========================================
// Record Read-only Preview Modal (View / معاينة)
// P2.2: uniform View button for every management screen.
// Shows a compact, read-only detail of one record without any edit controls.
// ==========================================

import { createModal } from './Modal.js';
import { Icons } from '../icons.js';
import { formatCurrency, formatDate, resolveEmployeeCurrency, escapeHtml } from '../types.js';
import { t, i18n } from '../i18n.js';

function rowsFrom(fields) {
  return fields
    .filter((f) => f && f.value !== undefined && f.value !== null && f.value !== '')
    .map(
      (f) => `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 12px; border-bottom:1px solid var(--border-color); font-size:13px;">
        <span style="color:var(--text-muted); font-weight:600;">${f.label}</span>
        <strong style="color:var(--text-main); text-align:left;">${f.value}</strong>
      </div>`
    )
    .join('');
}

export function openRecordPreview(type, record, ctx = {}) {
  const { employees = [], companies = [], settings = {} } = ctx;
  const isEn = i18n.getLang() === 'en';

  const empOf = (id) => employees.find((e) => e.id === id);
  const empLine = (id) => {
    const emp = empOf(id);
    if (!emp) return '-';
    return `${emp.fullName}${emp.employeeNumber ? ` (${emp.employeeNumber})` : ''}`;
  };
  const statusLabel = (st) => {
    if (st === 'approved') return isEn ? 'Approved' : 'معتمد';
    if (st === 'pending') return isEn ? 'Pending' : 'معلق';
    if (st === 'rejected') return isEn ? 'Rejected' : 'مرفوض';
    if (st === 'present') return isEn ? 'Present' : 'حاضر';
    if (st === 'late') return isEn ? 'Late' : 'متأخر';
    if (st === 'absent') return isEn ? 'Absent' : 'غائب';
    if (st === 'half_day') return isEn ? 'Half Day' : 'نصف يوم';
    if (st === 'excused' || st === 'excused_absence') return isEn ? 'Excused Absence' : 'غياب مبرر';
    if (st === 'early_leave') return isEn ? 'Early Departure' : 'انصراف مبكر';
    if (st === 'paid') return isEn ? 'Paid' : 'مصروف';
    return st || '-';
  };

  let title = '';
  let fields = [];

  if (type === 'attendance') {
    title = isEn ? 'Attendance Record' : 'سجل الحضور';
    const cur = empOf(record.employeeId) ? resolveEmployeeCurrency(empOf(record.employeeId), settings, companies) : null;
    const sym = cur ? cur.symbol : (settings.currencySymbol || '$');
    fields = [
      { label: isEn ? 'Employee' : 'الموظف', value: empLine(record.employeeId) },
      { label: isEn ? 'Date' : 'التاريخ', value: formatDate(record.date) },
      { label: isEn ? 'Check-in' : 'وقت الحضور', value: record.checkIn || '-' },
      { label: isEn ? 'Check-out' : 'وقت الانصراف', value: record.checkOut || '-' },
      { label: isEn ? 'Working Hours' : 'ساعات العمل', value: `${record.workingHours ?? 8}` },
      { label: isEn ? 'Delay (min)' : 'التأخير (دقيقة)', value: `${record.lateMinutes || 0}` },
      { label: isEn ? 'Status' : 'الحالة', value: statusLabel(record.status) },
      { label: isEn ? 'Source' : 'المصدر', value: record.source === 'biometric_device' ? (isEn ? 'Biometric device' : 'جهاز بصمة') : (record.source || '-') },
      { label: isEn ? 'Notes' : 'ملاحظات', value: record.notes || '-' },
    ];
  } else if (type === 'overtime') {
    title = isEn ? 'Overtime Record' : 'سجل العمل الإضافي';
    const cur = empOf(record.employeeId) ? resolveEmployeeCurrency(empOf(record.employeeId), settings, companies) : null;
    const code = cur ? cur.code : (settings.currency || 'USD');
    fields = [
      { label: isEn ? 'Employee' : 'الموظف', value: empLine(record.employeeId) },
      { label: isEn ? 'Date' : 'التاريخ', value: formatDate(record.date) },
      { label: isEn ? 'Payroll Period' : 'الفترة المالية', value: record.payrollPeriod || '-' },
      { label: isEn ? 'Hours' : 'الساعات', value: `${record.hours}` },
      { label: isEn ? 'Multiplier' : 'المعامل الاحتسابي', value: `${Number(record.multiplier ?? record.rateMultiplier ?? 1.5)}x` },
      { label: isEn ? 'Hourly Rate' : 'أجر الساعة', value: formatCurrency(record.hourlyRate, code) },
      { label: isEn ? 'Total Payable' : 'إجمالي المستحق', value: formatCurrency(record.totalAmount, code) },
      { label: isEn ? 'Status' : 'الحالة', value: statusLabel(record.status) },
      { label: isEn ? 'Reason' : 'السبب', value: record.reason || '-' },
    ];
  } else if (type === 'holiday') {
    title = isEn ? 'Official Holiday' : 'عطلة رسمية';
    fields = [
      { label: isEn ? 'Occasion' : 'المناسبة', value: escapeHtml(record.name) },
      { label: isEn ? 'From' : 'من', value: formatDate(record.startDate) },
      { label: isEn ? 'To' : 'إلى', value: formatDate(record.endDate) },
      { label: isEn ? 'Days' : 'عدد الأيام', value: `${record.daysCount}` },
      {
        label: isEn ? 'Type' : 'النوع',
        value: record.reasonCategory === 'religious_eid' ? (isEn ? 'Religious / Eid' : 'دينية / عيد')
          : record.reasonCategory === 'national_holiday' ? (isEn ? 'National Holiday' : 'عطلة وطنية')
          : record.reasonCategory === 'company_decision' ? (isEn ? 'Company Decision' : 'قرار إداري')
          : (isEn ? 'Emergency Closure' : 'إغلاق طارئ'),
      },
      { label: isEn ? 'Scope' : 'نطاق التطبيق', value: record.companyId === 'all' ? (isEn ? 'All companies' : 'جميع الشركات') : record.companyId || '-' },
      { label: isEn ? 'Paid' : 'مدفوعة', value: record.isPaid === false ? (isEn ? 'Unpaid' : 'غير مدفوعة') : (isEn ? 'Fully Paid' : 'مدفوعة بالكامل') },
      { label: isEn ? 'Notes' : 'ملاحظات', value: record.notes || '-' },
    ];
  } else if (type === 'hourlyLeave') {
    title = isEn ? 'Hourly Leave Request' : 'إجازة زمنية (بالساعة)';
    fields = [
      { label: isEn ? 'Employee' : 'الموظف', value: empLine(record.employeeId) },
      { label: isEn ? 'Date' : 'التاريخ', value: formatDate(record.date) },
      { label: isEn ? 'Time Slot' : 'فترة الخروج', value: `${record.startTime || '-'} - ${record.endTime || '-'}` },
      { label: isEn ? 'Hours' : 'الساعات', value: `${record.hours}` },
      { label: isEn ? 'Status' : 'الحالة', value: statusLabel(record.status) },
      { label: isEn ? 'Reason' : 'السبب', value: record.reason || '-' },
      { label: isEn ? 'Approved By' : 'اعتمد من', value: record.approvedBy || '-' },
    ];
  } else {
    title = isEn ? 'Record Details' : 'تفاصيل السجل';
    fields = Object.entries(record || {})
      .filter(([k]) => !['id', 'createdAt', 'updatedAt', 'companyId', 'branchId'].includes(k))
      .map(([k, v]) => ({ label: k, value: String(v) }));
  }

  const bodyHtml = `
    <div class="card" style="padding:0; overflow:hidden; border:1px solid var(--border-color);">
      ${rowsFrom(fields)}
    </div>
    <div style="font-size:12px; color:var(--text-muted); margin-top:12px;">
      ${isEn ? 'Preview only — use Edit to modify this record.' : 'معاينة للاطلاع فقط — استخدم تعديل لتغيير السجل.'}
    </div>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
  `;

  createModal({
    title: `${title} — ${isEn ? 'Preview' : 'معاينة'}`,
    size: 'md',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      overlay.querySelector('.close-modal-btn')?.addEventListener('click', close);
    },
  });
}

export { Icons };