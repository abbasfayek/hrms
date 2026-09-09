// ==========================================
// Clean Slate Initial HRMS Seed Dataset
// ==========================================

export const defaultCurrencies = [
  { code: 'IQD', symbol: 'د.ع', nameAr: 'دينار عراقي', nameEn: 'Iraqi Dinar' },
  { code: 'USD', symbol: '$', nameAr: 'دولار أمريكي', nameEn: 'US Dollar' },
  { code: 'AED', symbol: 'د.إ', nameAr: 'درهم إماراتي', nameEn: 'UAE Dirham' },
  { code: 'SAR', symbol: 'ر.س', nameAr: 'ريال سعودي', nameEn: 'Saudi Riyal' },
  { code: 'EUR', symbol: '€', nameAr: 'يورو', nameEn: 'Euro' },
  { code: 'KWD', symbol: 'د.ك', nameAr: 'دينار كويتي', nameEn: 'Kuwaiti Dinar' },
  { code: 'QAR', symbol: 'ر.ق', nameAr: 'ريال قطري', nameEn: 'Qatari Riyal' },
  { code: 'OMR', symbol: 'ر.ع', nameAr: 'ريال عماني', nameEn: 'Omani Rial' },
  { code: 'JOD', symbol: 'د.أ', nameAr: 'دينار أردني', nameEn: 'Jordanian Dinar' },
  { code: 'EGP', symbol: 'ج.م', nameAr: 'جنيه مصري', nameEn: 'Egyptian Pound' },
  { code: 'TRY', symbol: '₺', nameAr: 'ليرة تركية', nameEn: 'Turkish Lira' },
  { code: 'CUSTOM', symbol: 'نقد', nameAr: 'عملة مخصصة', nameEn: 'Custom Currency' },
];

export const defaultCompanies = [
  {
    id: 'comp-1',
    nameAr: 'الشركة الرئيسية',
    nameEn: 'Main Enterprise Co.',
    code: 'HQ',
    commercialRegistration: '',
    taxNumber: '',
    currency: 'USD',
    currencySymbol: '$',
    branches: [
      { id: 'br-1', companyId: 'comp-1', nameAr: 'الفرع الرئيسي', nameEn: 'Main Branch', city: 'المركز الرئيسي', payDay: 25, branchType: 'main', parentBranchId: null },
      { id: 'br-2', companyId: 'comp-1', nameAr: 'فرع بغداد الفرعي', nameEn: 'Baghdad Sub-Branch', city: 'بغداد - الكرادة', payDay: 25, branchType: 'sub', parentBranchId: 'br-1' },
    ],
  },
];

export const defaultUsers = [
  {
    id: 'usr-admin',
    username: 'admin',
    password: 'admin123',
    name: 'المدير العام',
    email: 'admin@company.com',
    role: 'super_admin',
    assignedCompanyId: 'all',
    assignedBranchId: 'all',
    jobTitle: 'مدير النظام والموارد البشرية',
    avatar: 'م',
  },
  {
    id: 'usr-dev',
    username: 'developer',
    password: 'DEV@2026',
    name: 'المبرمج',
    email: 'dev@benosoft.com',
    role: 'super_admin',
    assignedCompanyId: 'all',
    assignedBranchId: 'all',
    jobTitle: 'مبرمج النظام',
    avatar: 'د',
    protected: true,
  },
];

export const defaultSettings = {
  companyName: 'بينو سوفت',
  companyNameEn: 'BenoSoft',
  companyPhone: '+964 770 701 1131',
  companyWhatsApp: '+9647707011131',
  companyEmail: 'abbafayek@gmail.com',
  commercialRegistration: '',
  taxNumber: '',
  logoUrl: '',
  currency: 'USD',
  currencySymbol: '$',
  customCurrencies: [],
  workingDaysPerMonth: 30,
  workingHoursPerDay: 8,
  // Unified daily-rate method for the whole system (wageEngine SSOT):
  // workingDays | fixed30 | calendarDays | basicOnly. Leave empty/unset to keep
  // each module's historical default until an admin picks a unified method.
  dailyRateMethod: '',
  defaultAnnualLeaveDays: 30,
  maxCarryOverDays: 15,
  // Weekly days off: 0=Sunday ... 6=Saturday. Default: Saturday & Sunday (global convention).
  weekendDays: [6, 0],
  socialInsuranceEmployeePercent: 0,
  socialInsuranceCompanyPercent: 0,
  overtimeRegularRate: 1.5,
  overtimeHolidayRate: 2.0,
  // End-of-service benefit (gratuity) formula parameters, fully configurable.
  // Years of service below eosbTier1Years are accrued at eosbTier1RateMonths of
  // monthly wage per year; years at or above use eosbTier2RateMonths.
  eosbTier1RateMonths: 0.5,
  eosbTier1Years: 5,
  eosbTier2RateMonths: 1,
  eosbMinYearsForResignation: 2,
  eosbResignationTier1Pct: 33.33,
  eosbResignationTier2Pct: 66.66,
  eosbResignationTier3Pct: 100,
  eosbCompanyTerminationPct: 100,
  // P2.2 Super-Admin payroll lock. Default ON. When set to false, payroll views
  // are only visible to super_admins until explicitly re-enabled.
  payrollViewEnabled: true,
};

// All operational data initialized to empty clean slate
export const defaultEmployees = [];
export const defaultLeaves = [];
export const defaultOvertime = [];
export const defaultLoans = [];
export const defaultSalaryIncrements = [];
export const defaultAttendance = [];
export const defaultPayrollBatches = [];
export const defaultEOSBCalculations = [];
