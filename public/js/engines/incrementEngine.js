// ==========================================
// HRMS Salary Increment & Progression Engine
// ==========================================

export function applySalaryIncrement(params) {
  const {
    employee,
    type,
    value,
    effectiveDate,
    reason,
    approvedBy,
    updateHousingAndTransportProportionally = false,
  } = params;

  const previousBasicSalary = Number(employee.basicSalary) || 0;
  const previousTotalSalary =
    previousBasicSalary +
    (Number(employee.housingAllowance) || 0) +
    (Number(employee.transportAllowance) || 0) +
    (Number(employee.otherAllowances) || 0);

  let newBasicSalary = previousBasicSalary;
  let newHousingAllowance = Number(employee.housingAllowance) || 0;
  let newTransportAllowance = Number(employee.transportAllowance) || 0;

  const numVal = Number(value) || 0;

  if (type === 'percentage') {
    const multiplier = 1 + numVal / 100;
    newBasicSalary = parseFloat((previousBasicSalary * multiplier).toFixed(2));
    if (updateHousingAndTransportProportionally) {
      newHousingAllowance = parseFloat((newHousingAllowance * multiplier).toFixed(2));
      newTransportAllowance = parseFloat((newTransportAllowance * multiplier).toFixed(2));
    }
  } else {
    newBasicSalary = parseFloat((previousBasicSalary + numVal).toFixed(2));
  }

  const newTotalSalary = parseFloat(
    (newBasicSalary + newHousingAllowance + newTransportAllowance + (Number(employee.otherAllowances) || 0)).toFixed(2)
  );

  const incrementRecord = {
    id: `INC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    employeeId: employee.id,
    type,
    value: numVal,
    previousBasicSalary,
    newBasicSalary,
    previousTotalSalary,
    newTotalSalary,
    effectiveDate,
    reason,
    approvedBy,
    createdAt: new Date().toISOString(),
  };

  const updatedEmployee = {
    ...employee,
    basicSalary: newBasicSalary,
    housingAllowance: newHousingAllowance,
    transportAllowance: newTransportAllowance,
  };

  return { updatedEmployee, incrementRecord };
}
