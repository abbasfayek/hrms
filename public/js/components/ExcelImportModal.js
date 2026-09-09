// ==========================================
// Comprehensive Excel Import Modal (Bilingual & Bulletproof Download)
// ==========================================

import { storage } from '../storage.js';
import { createModal } from './Modal.js';
import { toast } from './Toast.js';
import { Icons } from '../icons.js';
import { i18n, t } from '../i18n.js';

export function openExcelImportModal(onImportSuccess) {
  const state = storage.getState();
  const { companies, settings } = state;
  const targetCompId = storage.getSelectedCompanyId();
  const lang = i18n.getLang();
  const isEn = lang === 'en';

  const bodyHtml = `
    <div id="excel-import-container">
      <!-- Instructions & Template Download -->
      <div class="card" style="padding:16px; margin-bottom:18px; background:var(--bg-card-hover); border:1px solid var(--border-color);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <h4 style="font-size:14px; font-weight:800; color:var(--text-main);">
              ${isEn ? '1. Download Standard Excel Template' : '1. تحميل القالب النموذجي الشامل لكافة البيانات'}
            </h4>
            <p style="font-size:12px; color:var(--text-muted); margin-top:2px;">
              ${isEn ? 'The template includes all employee, company, branch, salary, social security, bank, and leave fields.' : 'يحتوي القالب على كافة الحقول (الشركة، الفرع، الراتب والبدلات، التأمينات، البنك، الإجازات، والبيانات الشخصية)'}
            </p>
          </div>
          <button type="button" class="btn btn-outline btn-sm" id="btn-download-emp-template">
            ${Icons.download(14)} ${isEn ? 'Download Excel Template (.xlsx / .csv)' : 'تحميل نموذج Excel المعتمد (.xlsx)'}
          </button>
        </div>
      </div>

      <!-- File Upload Drop Zone -->
      <div class="card" style="padding:24px; text-align:center; border:2px dashed var(--primary); background:rgba(79,70,229,0.03); cursor:pointer; margin-bottom:18px;" id="drop-zone">
        <input type="file" id="excel-file-input" accept=".xlsx, .xls, .csv" style="display:none;">
        <div style="font-size:36px; margin-bottom:8px;">📊</div>
        <div style="font-size:14px; font-weight:700; color:var(--text-main);">
          ${isEn ? 'Click to select Excel file or drag and drop here' : 'انقر لاختيار ملف Excel أو اسحب الملف وأفلته هنا'}
        </div>
        <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
          ${isEn ? 'Supports (.xlsx, .xls, .csv) with automatic parsing of companies, branches & social security' : 'يدعم صيغ (.xlsx, .xls, .csv) مع قراءة آلية للشركات والفروع والتأمينات'}
        </div>
      </div>

      <!-- Options -->
      <div class="grid grid-cols-2" style="margin-bottom:16px;">
        <div class="form-group">
          <label class="form-label">
            ${isEn ? 'Default Target Company (if omitted in file)' : 'الشركة الافتراضية (في حال لم تُذكر بالملف)'}
          </label>
          <select class="form-select" id="import-target-company">
            ${companies.map((c) => `<option value="${c.id}" ${c.id === targetCompId ? 'selected' : ''}>${isEn && c.nameEn ? c.nameEn : c.nameAr} (${c.code})</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">
            ${isEn ? 'Import Mode' : 'طريقة الاستيراد'}
          </label>
          <select class="form-select" id="import-mode">
            <option value="merge" selected>${isEn ? 'Merge & Update (Add new, update existing by ID)' : 'دمج وتحديث (إضافة الجدد وتحديث بيانات الموظفين الموجودين)'}</option>
            <option value="append">${isEn ? 'Append New Only (Skip existing IDs)' : 'إضافة كجدد فقط (تخطي الأرقام الوظيفية المكررة)'}</option>
          </select>
        </div>
      </div>

      <!-- Preview Table Container -->
      <div id="import-preview-wrapper" style="display:none;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h4 style="font-size:13.5px; font-weight:800; color:var(--text-main);">
            ${isEn ? 'Parsed Data Preview' : 'معاينة البيانات المستخرجة'} (<span id="preview-count">0</span> ${isEn ? 'employees' : 'موظف'})
          </h4>
          <span class="badge badge-success" id="preview-status-badge">${isEn ? 'Ready to Import' : 'جاهز للاستيراد والحفظ'}</span>
        </div>
        <div class="table-container" style="max-height:240px; overflow-y:auto; border:1px solid var(--border-color); border-radius:var(--radius-md);">
          <table class="table" id="preview-table" style="font-size:11.5px; white-space:nowrap;">
            <thead>
              <tr>
                <th>${isEn ? 'Emp ID' : 'الرقم الوظيفي'}</th>
                <th>${isEn ? 'Employee Name' : 'اسم الموظف'}</th>
                <th>${isEn ? 'Company / Branch' : 'الشركة / الفرع'}</th>
                <th>${isEn ? 'Department & Job' : 'القسم والوظيفة'}</th>
                <th>${isEn ? 'Basic Salary' : 'الراتب الأساسي'}</th>
                <th>${isEn ? 'Allowances' : 'البدلات'}</th>
                <th>${isEn ? 'Social Security Wage' : 'أجر التأمينات'}</th>
                <th>${isEn ? 'National ID' : 'رقم الهوية'}</th>
                <th>${isEn ? 'Phone' : 'الجوال'}</th>
                <th>${isEn ? 'Bank Account / IBAN' : 'الحساب البنكي / IBAN'}</th>
              </tr>
            </thead>
            <tbody id="preview-table-body"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${isEn ? 'Cancel' : 'إلغاء'}</button>
    <button type="button" class="btn btn-primary" id="btn-execute-import" disabled>
      ✓ ${isEn ? 'Execute & Save Employees' : 'تنفيذ استيراد وحفظ الموظفين'}
    </button>
  `;

  createModal({
    title: isEn ? 'Import Employees from Excel / CSV' : 'استيراد بيانات الموظفين الشاملة من Excel',
    size: 'lg',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      let parsedEmployees = [];

      const dropZone = overlay.querySelector('#drop-zone');
      const fileInput = overlay.querySelector('#excel-file-input');
      const previewWrapper = overlay.querySelector('#import-preview-wrapper');
      const previewTableBody = overlay.querySelector('#preview-table-body');
      const previewCount = overlay.querySelector('#preview-count');
      const executeBtn = overlay.querySelector('#btn-execute-import');
      const companySelect = overlay.querySelector('#import-target-company');
      const modeSelect = overlay.querySelector('#import-mode');

      // 1. Download Template - Always works via server endpoint (token protected)
      overlay.querySelector('#btn-download-emp-template')?.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          const res = await storage.apiFetch(`/api/download-template?lang=${lang}`);
          if (!res.ok) {
            toast.error(isEn ? 'Failed to download template' : 'تعذر تحميل النموذج');
            return;
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = isEn ? 'Employee_Import_Template.xls' : 'قالب_استيراد_الموظفين.xls';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          toast.success(isEn ? 'Excel template download started' : 'جاري تحميل نموذج Excel...');
        } catch (err) {
          toast.error(isEn ? 'Failed to download template' : 'تعذر تحميل النموذج');
        }
      });

      // 2. File Selection & Drag-Drop
      dropZone?.addEventListener('click', () => fileInput.click());

      dropZone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--success)';
      });

      dropZone?.addEventListener('dragleave', () => {
        dropZone.style.borderColor = 'var(--primary)';
      });

      dropZone?.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--primary)';
        if (e.dataTransfer.files.length > 0) {
          handleFile(e.dataTransfer.files[0]);
        }
      });

      fileInput?.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          handleFile(e.target.files[0]);
        }
      });

      function handleFile(file) {
        const isCsv = file.name.endsWith('.csv');

        if (isCsv) {
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const text = e.target.result;
              const rows = parseCSVText(text);
              if (rows.length === 0) {
                toast.error(isEn ? 'CSV file is empty' : 'ملف CSV فارغ');
                return;
              }
              parsedEmployees = mapExcelRowsToComprehensiveEmployees(rows, companies, companySelect.value, settings);
              renderPreview(parsedEmployees);
              dropZone.innerHTML = `
                <div style="font-size:28px; color:var(--success);">✅</div>
                <div style="font-weight:700; color:var(--text-main); margin-top:4px;">${file.name}</div>
                <div style="font-size:12px; color:var(--text-muted);">${parsedEmployees.length} ${isEn ? 'records parsed' : 'موظف تم استخراجه'}</div>
              `;
              executeBtn.disabled = false;
              toast.success(isEn ? `Extracted ${parsedEmployees.length} employees` : `تم استخراج ${parsedEmployees.length} سجل موظف بنجاح`);
            } catch (err) {
              toast.error(err.message);
            }
          };
          reader.readAsText(file, 'utf-8');
          return;
        }

        if (window.XLSX) {
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const data = new Uint8Array(e.target.result);
              const workbook = XLSX.read(data, { type: 'array' });
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

              if (jsonData.length === 0) {
                toast.error(isEn ? 'Excel sheet is empty' : 'ملف Excel فارغ');
                return;
              }

              parsedEmployees = mapExcelRowsToComprehensiveEmployees(jsonData, companies, companySelect.value, settings);

              if (parsedEmployees.length === 0) {
                toast.error(isEn ? 'Could not recognize columns' : 'لم يتم التعرف على أعمدة بيانات الموظفين في الملف');
                return;
              }

              renderPreview(parsedEmployees);
              dropZone.innerHTML = `
                <div style="font-size:28px; color:var(--success);">✅</div>
                <div style="font-weight:700; color:var(--text-main); margin-top:4px;">${file.name}</div>
                <div style="font-size:12px; color:var(--text-muted);">${parsedEmployees.length} ${isEn ? 'records parsed' : 'موظف تم استخراجه'}</div>
              `;
              executeBtn.disabled = false;
              toast.success(isEn ? `Extracted ${parsedEmployees.length} records successfully` : `تم استخراج ${parsedEmployees.length} سجل موظف بنجاح`);
            } catch (err) {
              console.error(err);
              toast.error((isEn ? 'Error reading Excel file: ' : 'خطأ في قراءة ملف Excel: ') + err.message);
            }
          };
          reader.readAsArrayBuffer(file);
        } else {
          toast.error(isEn ? 'Excel parser library loading, please use .CSV or retry in a moment' : 'يرجى استخدام ملف CSV أو الانتظار لحظات لتحميل المكتبة');
        }
      }

      function renderPreview(emps) {
        previewWrapper.style.display = 'block';
        previewCount.textContent = emps.length;
        previewTableBody.innerHTML = emps
          .map((e) => {
            const comp = companies.find((c) => c.id === e.companyId);
            const branch = comp ? (comp.branches || []).find((b) => b.id === e.branchId) : null;
            const totalAllow = (e.housingAllowance || 0) + (e.transportAllowance || 0) + (e.otherAllowances || 0);

            return `
            <tr>
              <td><strong>${e.employeeNumber}</strong></td>
              <td><strong>${e.fullName}</strong></td>
              <td>${comp ? (isEn && comp.nameEn ? comp.nameEn : comp.nameAr) : '-'} ${branch ? `(${branch.nameAr})` : ''}</td>
              <td>${e.department} - ${e.jobTitle}</td>
              <td>${e.basicSalary}</td>
              <td>${totalAllow}</td>
              <td>${e.isSubjectToGosi ? e.gosiRegisteredWage : `<span class="badge badge-gray">${isEn ? 'Exempt' : 'غير خاضع'}</span>`}</td>
              <td>${e.nationalId || '-'}</td>
              <td>${e.phone || '-'}</td>
              <td>${e.iban || e.bankAccountNumber || '-'}</td>
            </tr>
          `;
          })
          .join('');
      }

      // 3. Execute Import
      executeBtn?.addEventListener('click', () => {
        if (parsedEmployees.length === 0) return;

        const currentEmployees = storage.get('hrms_employees_v3', []);
        const mode = modeSelect.value;

        let finalEmployees = [];

        if (mode === 'merge') {
          const map = {};
          currentEmployees.forEach((e) => {
            map[e.employeeNumber] = e;
          });
          parsedEmployees.forEach((e) => {
            map[e.employeeNumber] = { ...(map[e.employeeNumber] || {}), ...e };
          });
          finalEmployees = Object.values(map);
        } else {
          // append new only
          const existingNums = new Set(currentEmployees.map((e) => String(e.employeeNumber)));
          const newEmps = parsedEmployees.filter((e) => !existingNums.has(String(e.employeeNumber)));
          finalEmployees = [...newEmps, ...currentEmployees];
        }

        storage.saveEmployees(finalEmployees);

        // Backend sync
        storage.apiFetch('/api/import-employees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employees: parsedEmployees, mode }),
        }).catch(() => {});

        toast.success(isEn ? `🎉 Successfully imported and saved ${parsedEmployees.length} employees` : `🎉 تم استيراد وحفظ ${parsedEmployees.length} موظف بنجاح`);
        close();
        if (onImportSuccess) onImportSuccess();
      });

      overlay.querySelector('.close-modal-btn')?.addEventListener('click', close);
    },
  });
}

function parseCSVText(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  // Parse header
  const headers = parseCSVLine(lines[0]);
  const results = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = values[idx] !== undefined ? values[idx].trim() : '';
    });
    results.push(row);
  }
  return results;
}

function parseCSVLine(line) {
  const result = [];
  let inQuotes = false;
  let cur = '';

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function mapExcelRowsToComprehensiveEmployees(rows, companies, defaultCompanyId, settings) {
  return rows
    .map((row, idx) => {
      // 1. Resolve Company
      const compVal = String(row['كود الشركة'] || row['اسم الشركة'] || row['رقم الشركة'] || row['Company'] || row['CompanyCode'] || '').trim();
      let matchedComp = companies.find(
        (c) => c.code?.toLowerCase() === compVal.toLowerCase() || c.nameAr === compVal || c.nameEn?.toLowerCase() === compVal.toLowerCase() || c.id === compVal
      );
      if (!matchedComp) {
        matchedComp = companies.find((c) => c.id === defaultCompanyId) || companies[0] || { id: 'comp-1', branches: [] };
      }

      // 2. Resolve Branch
      const branchVal = String(row['اسم الفرع'] || row['الفرع'] || row['Branch'] || row['BranchName'] || '').trim();
      let matchedBranch = (matchedComp.branches || []).find(
        (b) => b.nameAr === branchVal || b.nameEn?.toLowerCase() === branchVal.toLowerCase() || b.id === branchVal
      );
      if (!matchedBranch) {
        matchedBranch = (matchedComp.branches || [])[0] || { id: 'br-1' };
      }

      const empNum =
        row['الرقم الوظيفي'] || row['رقم الموظف'] || row['EmployeeNumber'] || row['EmployeeID'] || row['emp_id'] || `EMP-${1000 + idx + 1}`;
      const fullName =
        row['الاسم الكامل'] || row['اسم الموظف'] || row['الاسم'] || row['FullName'] || row['name'] || `موظف ${idx + 1}`;
      const fullNameEn = row['الاسم بالإنجليزية'] || row['FullNameEn'] || row['EnglishName'] || '';
      const dept = row['القسم'] || row['الإدارة'] || row['Department'] || 'العمليات والتشغيل';
      const jobTitle = row['المسمى الوظيفي'] || row['الوظيفة'] || row['JobTitle'] || 'موظف';
      const hireDate = String(row['تاريخ التعيين'] || row['تاريخ المباشرة'] || row['HireDate'] || row['JoinDate'] || new Date().toISOString().split('T')[0]);
      const contractType = row['نوع العقد'] || row['ContractType'] || 'full_time';
      const status = row['الحالة'] || row['Status'] || 'active';

      // Salaries & Allowances
      const basicSalary = Number(row['الراتب الأساسي'] || row['BasicSalary'] || row['salary'] || 5000);
      const housingAllowance = Number(row['بدل السكن'] || row['HousingAllowance'] || 0);
      const transportAllowance = Number(row['بدل النقل'] || row['TransportAllowance'] || 0);
      const otherAllowances = Number(row['بدلات أخرى'] || row['OtherAllowances'] || 0);

      // Social Security / GOSI
      const gosiSubjectVal = String(row['خاضع للتأمينات'] || row['خاضع للضمان'] || row['GOSI'] || row['IsGOSI'] || 'نعم').trim();
      const isSubjectToGosi = !['لا', 'no', 'false', '0', 'exempt'].includes(gosiSubjectVal.toLowerCase());
      const gosiRegisteredWage = Number(row['الأجر المسجل في الضمان'] || row['أجر التأمينات'] || row['GOSIWage'] || (basicSalary + housingAllowance));
      const gosiEmployeePercent = Number(row['نسبة استقطاع الموظف %'] || row['GOSIEmpPercent'] || (settings.socialInsuranceEmployeePercent !== undefined ? settings.socialInsuranceEmployeePercent : (settings.gosiEmployeePercent || 0)));
      const gosiCompanyPercent = Number(row['نسبة مساهمة الشركة %'] || row['GOSICompPercent'] || (settings.socialInsuranceCompanyPercent !== undefined ? settings.socialInsuranceCompanyPercent : (settings.gosiCompanyPercent || 0)));

      // Bank Details
      const bankName = String(row['اسم البنك'] || row['البنك'] || row['BankName'] || '');
      const bankAccountNumber = String(row['رقم الحساب'] || row['BankAccount'] || '');
      const iban = String(row['الآيبان'] || row['IBAN'] || '');

      // Personal Info
      const nationalId = String(row['رقم الهوية'] || row['الإقامة'] || row['NationalID'] || '');
      const phone = String(row['رقم الهاتف'] || row['الجوال'] || row['Phone'] || '');
      const email = String(row['البريد الإلكتروني'] || row['Email'] || '');
      const nationality = String(row['الجنسية'] || row['Nationality'] || '');
      const gender = String(row['الجنس'] || row['Gender'] || 'male');
      const dateOfBirth = String(row['تاريخ الميلاد'] || row['DOB'] || '1995-01-01');

      // Leaves
      const annualLeaveBalance = Number(row['رصيد الإجازات السنوي'] || row['AnnualLeaveBalance'] || settings.defaultAnnualLeaveDays || 21);
      const hourlyLeaveQuota = Number(row['رصيد الساعات الشهري'] || row['HourlyLeaveQuota'] || matchedComp.hourlyLeaveQuota || 4);

      return {
        id: `emp-imp-${Date.now()}-${idx}`,
        companyId: matchedComp.id,
        branchId: matchedBranch.id,
        employeeNumber: String(empNum),
        fullName: String(fullName),
        fullNameEn: String(fullNameEn),
        department: String(dept),
        jobTitle: String(jobTitle),
        hireDate,
        contractType,
        status,
        basicSalary,
        housingAllowance,
        transportAllowance,
        otherAllowances,
        isSubjectToGosi,
        gosiRegisteredWage,
        gosiEmployeePercent,
        gosiCompanyPercent,
        bankName,
        bankAccountNumber,
        iban,
        nationalId,
        phone,
        email,
        nationality,
        gender,
        dateOfBirth,
        annualLeaveBalance,
        annualLeaveEntitlement: annualLeaveBalance,
        carriedOverLeaveBalance: 0,
        hourlyLeaveQuota,
      };
    })
    .filter((e) => e.fullName);
}

function downloadComprehensiveEmployeeTemplate(companies = [], settings = {}) {
  const compExample = companies[0] || { code: 'MAIN', nameAr: 'الشركة الرئيسية', branches: [{ nameAr: 'الفرع الرئيسي' }] };
  const branchExample = compExample.branches?.[0]?.nameAr || 'الفرع الرئيسي';

  const sampleData = [
    {
      'كود الشركة': compExample.code || 'MAIN',
      'اسم الفرع': branchExample,
      'الرقم الوظيفي': 'EMP-101',
      'الاسم الكامل': 'محمد بن صالح القحطاني',
      'الاسم بالإنجليزية': 'Mohammed Al-Qahtani',
      'القسم': 'تقنية المعلومات',
      'المسمى الوظيفي': 'مهندس نظم أول',
      'تاريخ التعيين': '2023-01-15',
      'نوع العقد': 'full_time',
      'الحالة': 'active',
      'الراتب الأساسي': 12000,
      'بدل السكن': 3000,
      'بدل النقل': 1000,
      'بدلات أخرى': 500,
      'خاضع للتأمينات': 'نعم',
      'الأجر المسجل في الضمان': 15000,
      'نسبة استقطاع الموظف %': 5,
      'نسبة مساهمة الشركة %': 8,
      'اسم البنك': 'البنك الأهلي',
      'رقم الحساب': 'SA1280000123456789012345',
      'الآيبان': 'SA1280000123456789012345',
      'رقم الهوية': '1088992211',
      'الجنسية': '',
      'الجنس': 'male',
      'تاريخ الميلاد': '1992-05-10',
      'رقم الهاتف': '0551234567',
      'البريد الإلكتروني': 'mohammed@company.com',
      'رصيد الإجازات السنوي': 30,
      'رصيد الساعات الشهري': 4,
    },
    {
      'كود الشركة': compExample.code || 'MAIN',
      'اسم الفرع': branchExample,
      'الرقم الوظيفي': 'EMP-102',
      'الاسم الكامل': 'نورة بنت فهد السبيعي',
      'الاسم بالإنجليزية': 'Noura Al-Subaie',
      'القسم': 'الموارد البشرية',
      'المسمى الوظيفي': 'أخصائي موارد بشرية ورواتب',
      'تاريخ التعيين': '2023-06-01',
      'نوع العقد': 'full_time',
      'الحالة': 'active',
      'الراتب الأساسي': 9000,
      'بدل السكن': 2250,
      'بدل النقل': 800,
      'بدلات أخرى': 0,
      'خاضع للتأمينات': 'نعم',
      'الأجر المسجل في الضمان': 11250,
      'نسبة استقطاع الموظف %': 5,
      'نسبة مساهمة الشركة %': 8,
      'اسم البنك': 'البنك الأهلي',
      'رقم الحساب': 'SA4410000098765432109876',
      'الآيبان': 'SA4410000098765432109876',
      'رقم الهوية': '1099887766',
      'الجنسية': '',
      'الجنس': 'female',
      'تاريخ الميلاد': '1995-11-20',
      'رقم الهاتف': '0559876543',
      'البريد الإلكتروني': 'noura@company.com',
      'رصيد الإجازات السنوي': 25,
      'رصيد الساعات الشهري': 4,
    },
  ];

  // Try XLSX download first
  if (window.XLSX) {
    try {
      const ws = XLSX.utils.json_to_sheet(sampleData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'بيانات الموظفين');
      XLSX.writeFile(wb, 'قالب_استيراد_الموظفين_الشامل.xlsx');
      toast.success(i18n.getLang() === 'en' ? 'Excel template downloaded successfully' : 'تم تنزيل قالب Excel النموذجي بنجاح');
      return;
    } catch (err) {
      console.warn('XLSX download error, falling back to direct CSV:', err);
    }
  }

  // Fallback: Direct CSV download (Always works in 100% of browsers)
  const headers = Object.keys(sampleData[0]);
  const csvRows = sampleData.map((row) =>
    headers.map((h) => `"${(row[h] !== undefined ? row[h] : '').toString().replace(/"/g, '""')}"`).join(',')
  );
  const csvContent = '\uFEFF' + [headers.join(','), ...csvRows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'قالب_استيراد_الموظفين_الشامل.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success(i18n.getLang() === 'en' ? 'Template downloaded successfully (.csv)' : 'تم تنزيل القالب النموذجي بنجاح (.csv)');
}
