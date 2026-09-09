import type { Employee, SalaryIncrement } from '../types/hrms';

export interface ApplyIncrementParams {
  employee: Employee;
  type: 'percentage' | 'fixed_amount';
  value: number; // e.g. 10 for 10%, or 1500 for 1500 SAR
  effectiveDate: string; // YYYY-MM-DD
  reason: string;
  approvedBy: string;
  updateHousingAndTransportProportionally?: boolean;
}

/**
 * Applies a salary increment to an employee and records an audit log entry
 */
export function applySalaryIncrement(
  params: ApplyIncrementParams
): { updatedEmployee: Employee; incrementRecord: SalaryIncrement } {
  const {
    employee,
    type,
    value,
    effectiveDate,
    reason,
    approvedBy,
    updateHousingAndTransportProportionally = false,
  } = params;

  const previousBasicSalary = employee.basicSalary;
  const previousTotalSalary =
    employee.basicSalary +
    employee.housingAllowance +
    employee.transportAllowance +
    employee.otherAllowances;

  let newBasicSalary = previousBasicSalary;
  let newHousingAllowance = employee.housingAllowance;
  let newTransportAllowance = employee.transportAllowance;

  if (type === 'percentage') {
    const multiplier = 1 + value / 100;
    newBasicSalary = parseFloat((previousBasicSalary * multiplier).toFixed(2));
    if (updateHousingAndTransportProportionally) {
      newHousingAllowance = parseFloat((employee.housingAllowance * multiplier).toFixed(2));
      newTransportAllowance = parseFloat((employee.transportAllowance * multiplier).toFixed(2));
    }
  } else {
    // Fixed amount added directly to basic salary
    newBasicSalary = parseFloat((previousBasicSalary + value).toFixed(2));
  }

  const newTotalSalary = parseFloat(
    (newBasicSalary + newHousingAllowance + newTransportAllowance + employee.otherAllowances).toFixed(2)
  );

  const incrementRecord: SalaryIncrement = {
    id: `INC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    employeeId: employee.id,
    type,
    value,
    previousBasicSalary,
    newBasicSalary,
    previousTotalSalary,
    newTotalSalary,
    effectiveDate,
    reason,
    approvedBy,
    createdAt: new Date().toISOString(),
  };

  const updatedEmployee: Employee = {
    ...employee,
    basicSalary: newBasicSalary,
    housingAllowance: newHousingAllowance,
    transportAllowance: newTransportAllowance,
  };

  return { updatedEmployee, incrementRecord };
}
