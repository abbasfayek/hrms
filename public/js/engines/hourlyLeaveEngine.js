// =========================================================
// Hourly Leave Engine (محرك الإجازات الزمنية بالساعة)
// Non-cumulative, resets every month, per-company quota support
// =========================================================

import { getCurrentMonth } from '../types.js';

/**
 * Get the monthly hourly leave quota for a specific employee and company
 * Priority: employee.hourlyLeaveQuota > company.hourlyLeaveQuota > settings.defaultHourlyLeaveQuota > 4
 */
export function getEmployeeHourlyQuota(employee, company = null, settings = {}) {
  if (employee && employee.hourlyLeaveQuota !== undefined && employee.hourlyLeaveQuota !== null && employee.hourlyLeaveQuota !== '') {
    return Number(employee.hourlyLeaveQuota) || 0;
  }
  if (company && company.hourlyLeaveQuota !== undefined && company.hourlyLeaveQuota !== null && company.hourlyLeaveQuota !== '') {
    return Number(company.hourlyLeaveQuota) || 0;
  }
  if (settings && settings.defaultHourlyLeaveQuota !== undefined && settings.defaultHourlyLeaveQuota !== null) {
    return Number(settings.defaultHourlyLeaveQuota) || 0;
  }
  return 4; // Default 4 hours per month
}

/**
 * Calculate the hourly leave balance for an employee for a given month (YYYY-MM)
 * Note: Non-cumulative (غير قابلة للتراكم - تتجدد شهرياً)
 */
export function calculateHourlyBalance(employeeId, hourlyLeaves = [], month = getCurrentMonth(), quota = 4) {
  // Filter leaves for this employee and this month
  const monthLeaves = hourlyLeaves.filter((l) => {
    if (l.employeeId !== employeeId) return false;
    const leaveMonth = (l.date || '').slice(0, 7);
    return leaveMonth === month;
  });

  const approvedLeaves = monthLeaves.filter((l) => l.status === 'approved');
  const pendingLeaves = monthLeaves.filter((l) => l.status === 'pending');
  const rejectedLeaves = monthLeaves.filter((l) => l.status === 'rejected');

  const usedHours = approvedLeaves.reduce((sum, l) => sum + (Number(l.hours) || 0), 0);
  const pendingHours = pendingLeaves.reduce((sum, l) => sum + (Number(l.hours) || 0), 0);
  // Pending hours are reserved too, so the "remaining for NEW requests" figure
  // never lets pending approvals exhaust the monthly quota silently.
  const remainingHours = Math.max(0, quota - usedHours - pendingHours);

  return {
    month,
    quota,
    usedHours,
    pendingHours,
    remainingHours,
    approvedCount: approvedLeaves.length,
    pendingCount: pendingLeaves.length,
    rejectedCount: rejectedLeaves.length,
    leaves: monthLeaves,
  };
}

/**
 * Validate an hourly leave request
 */
export function validateHourlyLeaveRequest(employeeId, hours, date, hourlyLeaves = [], quota = 4) {
  const numHours = Number(hours) || 0;
  if (numHours <= 0) {
    return { valid: false, message: 'يرجى إدخال عدد ساعات صحيح أكبر من 0' };
  }
  if (!date) {
    return { valid: false, message: 'يرجى تحديد تاريخ الإجازة الزمنية' };
  }

  const month = date.slice(0, 7);
  const balance = calculateHourlyBalance(employeeId, hourlyLeaves, month, quota);

  if (numHours > balance.remainingHours) {
    return {
      valid: false,
      message: `رصيد الساعات المتبقي لشهر ${month} هو (${balance.remainingHours} ساعة) فقط، ولا يكفي لطلب ${numHours} ساعة.`,
    };
  }

  return { valid: true, balance };
}
