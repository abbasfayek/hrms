// ==========================================
// Comprehensive HRMS Types Definition
// ==========================================

export type EmployeeStatus = 'active' | 'on_leave' | 'probation' | 'terminated' | 'resigned';
export type ContractType = 'full_time' | 'part_time' | 'contract' | 'probation';
export type Gender = 'male' | 'female';
export type MaritalStatus = 'single' | 'married' | 'other';

export interface DocumentItem {
  id: string;
  name: string;
  type: 'national_id' | 'passport' | 'contract' | 'degree' | 'residence' | 'driving_license' | 'other';
  documentNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  notes?: string;
}

export interface Employee {
  id: string;
  employeeNumber: string; // e.g., EMP-1001
  fullName: string;
  email: string;
  phone: string;
  nationalId: string;
  gender: Gender;
  maritalStatus: MaritalStatus;
  dateOfBirth: string;
  nationality: string;
  address: string;
  avatarUrl?: string;

  // Job & Department
  department: string;
  jobTitle: string;
  directManagerId?: string;
  hireDate: string; // YYYY-MM-DD
  status: EmployeeStatus;
  contractType: ContractType;
  contractEndDate?: string;
  probationEndDate?: string;

  // Financial & Bank Details
  basicSalary: number;
  housingAllowance: number;
  transportAllowance: number;
  otherAllowances: number;
  bankName: string;
  bankAccountNumber: string;
  iban: string;
  gosiDeductionRate?: number; // e.g., 9.75% or 10%

  // Leave Balances Settings
  annualLeaveEntitlement: number; // e.g., 30 or 21 days per year
  carriedOverLeaveBalance: number; // Carryover from previous years
  currentYearAccruedLeave: number; // Auto-accrued this year
  manualLeaveAdjustment: number; // Manual balance adjustments (+ or -)
  lastYearBalanceRenewedDate?: string;

  // Documents
  documents: DocumentItem[];

  notes?: string;
  createdAt: string;
}

// ------------------------------------------
// Leave Types & Records
// ------------------------------------------
export type LeaveType = 
  | 'annual'          // سنوية اعتيادية
  | 'sick'            // مرضية
  | 'unpaid'          // بدون راتب
  | 'emergency'       // اضطرارية
  | 'maternity'       // أمومة / وضع
  | 'paternity'       // أبوة
  | 'hajj'            // حج
  | 'bereavement'     // وفاة
  | 'marriage';       // زواج

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  daysCount: number;
  reason: string;
  status: LeaveStatus;
  approvedBy?: string;
  approvalDate?: string;
  rejectionReason?: string;
  attachmentName?: string;
  createdAt: string;
}

export interface LeaveBalanceSummary {
  employeeId: string;
  employeeName: string;
  department: string;
  annualEntitlement: number;
  carriedOver: number;
  accruedCurrentYear: number;
  adjustments: number;
  totalAvailable: number; // (carriedOver + accruedCurrentYear + adjustments)
  usedAnnualDays: number;
  usedOtherDays: number;
  remainingAnnualBalance: number;
  pendingDays: number;
  lastCalculatedDate: string;
}

// ------------------------------------------
// Attendance & Overtime
// ------------------------------------------
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'half_day' | 'on_leave' | 'holiday' | 'weekend';

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  checkIn?: string; // HH:mm
  checkOut?: string; // HH:mm
  workingHours: number;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  status: AttendanceStatus;
  notes?: string;
}

export type OvertimeRateMultiplier = 1.5 | 2.0; // 1.5x regular day, 2.0x weekend/holiday

export interface OvertimeRecord {
  id: string;
  employeeId: string;
  date: string;
  hours: number;
  multiplier: OvertimeRateMultiplier;
  hourlyRate: number; // Auto calculated from salary: (basicSalary / 240)
  totalAmount: number; // hours * hourlyRate * multiplier
  type: 'regular_day' | 'weekend' | 'holiday';
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  approvedBy?: string;
  approvalDate?: string;
  payrollPeriod?: string; // YYYY-MM
  createdAt: string;
}

// ------------------------------------------
// Salary Increments & Loan Advances
// ------------------------------------------
export interface SalaryIncrement {
  id: string;
  employeeId: string;
  type: 'percentage' | 'fixed_amount';
  value: number; // e.g., 10% or 1000 SAR
  previousBasicSalary: number;
  newBasicSalary: number;
  previousTotalSalary: number;
  newTotalSalary: number;
  effectiveDate: string;
  reason: string;
  approvedBy: string;
  createdAt: string;
}

export interface LoanAdvance {
  id: string;
  employeeId: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  installmentAmount: number;
  installmentsCount: number;
  startDate: string; // YYYY-MM
  reason: string;
  status: 'active' | 'completed' | 'cancelled';
  installments: {
    month: string; // YYYY-MM
    amount: number;
    isPaid: boolean;
    paidInPayrollId?: string;
  }[];
  createdAt: string;
}

// ------------------------------------------
// Payroll System
// ------------------------------------------
export type PayrollStatus = 'draft' | 'approved' | 'paid' | 'locked';

export interface PayrollItem {
  id: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  department: string;
  jobTitle: string;
  bankName: string;
  iban: string;

  // Earnings
  basicSalary: number;
  housingAllowance: number;
  transportAllowance: number;
  otherAllowances: number;
  overtimeHours: number;
  overtimeAmount: number;
  bonuses: number;
  otherEarnings: number;
  grossSalary: number; // Sum of all earnings

  // Deductions
  absenceDays: number;
  absenceDeduction: number;
  lateMinutes: number;
  lateDeduction: number;
  loanInstallment: number;
  gosiEmployeeDeduction: number; // Social insurance employee share
  gosiCompanyContribution: number; // Social insurance company share
  penaltiesDeduction: number;
  otherDeductions: number;
  totalDeductions: number;

  // Final Net
  netSalary: number;
  notes?: string;
  isPaid: boolean;
}

export interface PayrollBatch {
  id: string;
  month: string; // YYYY-MM (e.g. 2026-08)
  title: string;
  issueDate: string;
  status: PayrollStatus;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalCompanyGosi: number;
  employeesCount: number;
  items: PayrollItem[];
  approvedBy?: string;
  approvalDate?: string;
  createdAt: string;
}

// ------------------------------------------
// End of Service & Resignation (EOSB)
// ------------------------------------------
export type TerminationReason = 
  | 'resignation'                  // استقالة الموظف
  | 'company_termination'          // إنهاء خدمات من الشركة
  | 'contract_expiration'          // انتهاء مدة العقد وعدم التجديد
  | 'mutual_agreement'             // إنهاء بالتراضي
  | 'probation_failure'            // عدم اجتياز فترة التجربة
  | 'article_80_violation'         // فسخ بموجب المادة القانونية بدون مكافأة
  | 'force_majeure';               // قوة قاهرة / عجز

export interface EOSBCalculation {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  hireDate: string;
  terminationDate: string;
  reason: TerminationReason;

  // Service Length
  totalServiceDays: number;
  serviceYears: number;
  serviceMonths: number;
  serviceDays: number;

  // Financial basis
  lastBasicSalary: number;
  lastGrossSalary: number; // Basic + Allowances
  
  // EOSB Calculation specifics
  eosbFullEntitlement: number; // Full award based on years
  entitlementRatio: number; // 0, 1/3, 2/3, or 1.0 (based on resignation rules)
  finalEOSBAmount: number;

  // Unused Leave Settlement
  unusedLeaveDays: number;
  dailyWage: number;
  leaveCompensationAmount: number;

  // Remaining Working Days of current month
  workedDaysInFinalMonth: number;
  finalMonthSalary: number;

  // Other adjustments
  bonusCompensation: number;
  remainingLoanDeductions: number;
  otherDeductions: number;

  // Final settlement total
  netSettlementAmount: number;

  // Status & Clearances
  status: 'draft' | 'approved' | 'paid';
  clearanceItems: {
    department: string;
    item: string;
    isHandedOver: boolean;
    clearedBy?: string;
    notes?: string;
  }[];
  experienceCertificateIssued: boolean;
  notes?: string;
  createdAt: string;
}

// ------------------------------------------
// Organization Settings & Config
// ------------------------------------------
export interface SystemSettings {
  companyName: string;
  companyNameEn?: string;
  commercialRegistration?: string;
  taxNumber?: string;
  logoUrl?: string;
  currency: string; // e.g., 'SAR' | 'AED' | 'EGP' | 'USD'
  currencySymbol: string; // 'ر.س' | 'د.إ' | 'ج.م' | '$'
  workingDaysPerMonth: number; // Default 30
  workingHoursPerDay: number; // Default 8
  defaultAnnualLeaveDays: number; // Default 30 or 21
  maxCarryOverDays: number; // Default 15 or unlimited
  gosiEmployeePercent: number; // Default 9.75%
  gosiCompanyPercent: number; // Default 11.75%
  overtimeRegularRate: number; // Default 1.5
  overtimeHolidayRate: number; // Default 2.0
  laborLawStandard: 'saudi' | 'uae' | 'egyptian' | 'custom';
}
