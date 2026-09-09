import type {
  Employee,
  EOSBCalculation,
  TerminationReason,
  SystemSettings,
  LeaveRequest,
  LoanAdvance,
} from '../types/hrms';
import { calculateLeaveBalance } from './leaveEngine';

export interface EOSBParams {
  employee: Employee;
  terminationDate: string; // YYYY-MM-DD
  reason: TerminationReason;
  leaveRequests: LeaveRequest[];
  loans: LoanAdvance[];
  workedDaysInFinalMonth?: number;
  bonusCompensation?: number;
  otherDeductions?: number;
  notes?: string;
  settings: SystemSettings;
}

/**
 * Calculates End of Service Benefit according to Labor Laws (Saudi / Gulf standard)
 */
export function calculateEOSB(params: EOSBParams): EOSBCalculation {
  const {
    employee,
    terminationDate,
    reason,
    leaveRequests,
    loans,
    workedDaysInFinalMonth = 0,
    bonusCompensation = 0,
    otherDeductions = 0,
    notes = '',
    settings,
  } = params;

  const hire = new Date(employee.hireDate);
  const term = new Date(terminationDate);

  // Exact days between hire and termination
  const diffTime = Math.max(0, term.getTime() - hire.getTime());
  const totalServiceDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  // Service Breakdown (Years, Months, Days)
  const totalYearsExact = totalServiceDays / 365.25;
  const serviceYears = Math.floor(totalYearsExact);
  const remainingDaysAfterYears = totalServiceDays - Math.floor(serviceYears * 365.25);
  const serviceMonths = Math.floor(remainingDaysAfterYears / 30.4375);
  const serviceDays = Math.max(0, Math.floor(remainingDaysAfterYears - serviceMonths * 30.4375));

  // Salaries basis (In labor law, EOSB is calculated based on last Total Wage: Basic + Fixed Allowances)
  const lastBasicSalary = employee.basicSalary;
  const lastGrossSalary =
    employee.basicSalary +
    employee.housingAllowance +
    employee.transportAllowance +
    employee.otherAllowances;

  const monthlyWage = lastGrossSalary;
  const dailyWage = parseFloat((monthlyWage / 30).toFixed(2));

  // 1. Calculate Full EOSB entitlement before resignation ratio
  let fullAward = 0;
  if (totalYearsExact <= 5) {
    // 0.5 month per year for first 5 years
    fullAward = totalYearsExact * (monthlyWage * 0.5);
  } else {
    // 0.5 month for first 5 years + 1 full month for each year beyond 5
    const first5YearsAward = 5 * (monthlyWage * 0.5);
    const subsequentYears = totalYearsExact - 5;
    const subsequentAward = subsequentYears * monthlyWage;
    fullAward = first5YearsAward + subsequentAward;
  }
  fullAward = parseFloat(Math.max(0, fullAward).toFixed(2));

  // 2. Determine entitlement ratio based on reason
  let entitlementRatio = 1.0;

  if (reason === 'resignation') {
    if (totalYearsExact < 2) {
      entitlementRatio = 0.0; // Less than 2 years in resignation = 0
    } else if (totalYearsExact < 5) {
      entitlementRatio = 1 / 3; // 2 to 5 years = 1/3
    } else if (totalYearsExact < 10) {
      entitlementRatio = 2 / 3; // 5 to 10 years = 2/3
    } else {
      entitlementRatio = 1.0; // 10 years or more = Full award
    }
  } else if (reason === 'article_80_violation' || reason === 'probation_failure') {
    entitlementRatio = 0.0;
  } else {
    // company_termination, contract_expiration, mutual_agreement, force_majeure
    entitlementRatio = 1.0;
  }

  const finalEOSBAmount = parseFloat((fullAward * entitlementRatio).toFixed(2));

  // 3. Unused Leave Compensation
  const leaveSummary = calculateLeaveBalance(employee, leaveRequests, term, settings);
  const unusedLeaveDays = Math.max(0, leaveSummary.remainingAnnualBalance);
  const leaveCompensationAmount = parseFloat((unusedLeaveDays * dailyWage).toFixed(2));

  // 4. Final Month Salary
  const finalMonthSalary = parseFloat((workedDaysInFinalMonth * dailyWage).toFixed(2));

  // 5. Remaining Loan / Advance Deductions
  const activeLoans = loans.filter((l) => l.employeeId === employee.id && l.status === 'active');
  const remainingLoanDeductions = parseFloat(
    activeLoans.reduce((sum, l) => sum + l.remainingAmount, 0).toFixed(2)
  );

  // 6. Net Settlement Total
  const totalPayable = finalEOSBAmount + leaveCompensationAmount + finalMonthSalary + bonusCompensation;
  const totalDeductible = remainingLoanDeductions + otherDeductions;
  const netSettlementAmount = parseFloat(Math.max(0, totalPayable - totalDeductible).toFixed(2));

  // Default clearance checklist
  const clearanceItems = [
    { department: 'إدارة تقنية المعلومات IT', item: 'تسليم اللابتوب والبريد الإلكتروني والصلاحيات', isHandedOver: false },
    { department: 'الشؤون الإدارية والخدمات', item: 'تسليم بطاقة العمل ومفاتيح المكتب والسيارة', isHandedOver: false },
    { department: 'الإدارة المالية', item: 'تصفية العهد المالية والقروض والسلف المعلقة', isHandedOver: remainingLoanDeductions === 0 },
    { department: 'الموارد البشرية HR', item: 'تسليم التأمين الطبي وتوقيع مخالصة الاستلام النهائية', isHandedOver: false },
  ];

  return {
    id: `EOSB-${employee.id}-${Date.now()}`,
    employeeId: employee.id,
    employeeName: employee.fullName,
    department: employee.department,
    hireDate: employee.hireDate,
    terminationDate,
    reason,
    totalServiceDays,
    serviceYears,
    serviceMonths,
    serviceDays,
    lastBasicSalary,
    lastGrossSalary,
    eosbFullEntitlement: fullAward,
    entitlementRatio: parseFloat(entitlementRatio.toFixed(4)),
    finalEOSBAmount,
    unusedLeaveDays,
    dailyWage,
    leaveCompensationAmount,
    workedDaysInFinalMonth,
    finalMonthSalary,
    bonusCompensation,
    remainingLoanDeductions,
    otherDeductions,
    netSettlementAmount,
    status: 'draft',
    clearanceItems,
    experienceCertificateIssued: true,
    notes,
    createdAt: new Date().toISOString(),
  };
}
