// ==========================================
// HRMS Wage Engine (SSOT) — Daily / Hourly / Minute rate
// ==========================================
// Single source of truth for every time-based wage calculation in the system.
// Every module that needs a daily/hourly/minute wage MUST call this engine so
// one formula drives payroll, leave cash-outs, overtime, EOSB settlements,
// absence deductions and payslips.
//
// Rate method resolution:
//   settings.dailyRateMethod  — global override chosen by the admin in
//                               Settings → Wages. When set, EVERY caller uses
//                               the same method (the unification goal).
//   options.defaultMethod      — the caller's historical default, used only
//                               when no global override exists. This preserves
//                               today's financial behavior until an admin
//                               explicitly picks a unified method.
//
// Supported methods:
//   workingDays   (basic+housing+transport) / workingDaysPerMonth  → payroll default
//   fixed30       (basic+housing+transport) / 30                   → leave default
//   calendarDays  gross / actual calendar days of the month        → eosb default
//   basicOnly     basic / workingDaysPerMonth
//   basicCalendar basic / actual calendar days of the month        → eosb bond default
//   basicMonthly  hourly only: basic / (workingDaysPerMonth * workingHoursPerDay)
//                                                                  → overtime default
//
// NOTE: all getters return UNROUNDED values so each caller keeps its own
// historical rounding exactly as before the refactor.

const METHOD_ALIASES = {
  workingDays: 'workingDays',
  fixed30: 'fixed30',
  calendarDays: 'calendarDays',
  basicOnly: 'basicOnly',
  basicCalendar: 'basicCalendar',
  basicMonthly: 'basicMonthly',
};

export function resolveRateMethod(settings = {}, options = {}) {
  const method = options.method || settings.dailyRateMethod || options.defaultMethod || 'workingDays';
  return METHOD_ALIASES[method] || 'workingDays';
}

function computeBase(employee, method) {
  const basic = Number(employee.basicSalary) || 0;
  const housing = Number(employee.housingAllowance) || 0;
  const transport = Number(employee.transportAllowance) || 0;
  const other = Number(employee.otherAllowances) || 0;
  switch (method) {
    case 'basicOnly':
    case 'basicCalendar':
    case 'basicMonthly':
      return basic;
    case 'calendarDays':
      return basic + housing + transport + other;
    default: // workingDays, fixed30
      return basic + housing + transport;
  }
}

function resolveCalendarDays(options = {}) {
  const ref = options.terminationDate || options.date || options.month || '';
  const dayMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(ref);
  if (dayMatch) {
    return new Date(Number(dayMatch[1]), Number(dayMatch[2]), 0).getDate();
  }
  const monthMatch = /^(\d{4})-(\d{1,2})$/.exec(ref);
  if (monthMatch) {
    return new Date(Number(monthMatch[1]), Number(monthMatch[2]), 0).getDate();
  }
  return 30; // no month context — neutral fallback
}

export function getDailyRate(employee, settings = {}, options = {}) {
  const method = resolveRateMethod(settings, options);
  const base = computeBase(employee, method);
  if (method === 'calendarDays' || method === 'basicCalendar') {
    const divisor = resolveCalendarDays(options);
    return divisor > 0 ? base / divisor : 0;
  }
  const divisor = method === 'fixed30' ? 30 : (Number(settings.workingDaysPerMonth) || 30);
  return divisor > 0 ? base / divisor : 0;
}

export function getHourlyRate(employee, settings = {}, options = {}) {
  const method = resolveRateMethod(settings, options);
  const workingHours = Number(settings.workingHoursPerDay) || 8;
  const workingDays = Number(settings.workingDaysPerMonth) || 30;
  if (method === 'basicMonthly') {
    const totalMonthlyHours = workingDays * workingHours;
    return totalMonthlyHours > 0 ? (Number(employee.basicSalary) || 0) / totalMonthlyHours : 0;
  }
  const daily = getDailyRate(employee, settings, options);
  return workingHours > 0 ? daily / workingHours : 0;
}

export function getMinuteRate(employee, settings = {}, options = {}) {
  const hourly = getHourlyRate(employee, settings, options);
  return hourly / 60;
}