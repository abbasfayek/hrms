// ==========================================
// Comprehensive Excel Import Modal (Bilingual & Bulletproof Download)
// ==========================================

import { storage } from '../storage.js';
import { createModal } from './Modal.js';
import { toast } from './Toast.js';
import { Icons } from '../icons.js';
import { i18n, t } from '../i18n.js';

// =========================================================
// X-2: Deterministic, scope-safe import pipeline.
// The pure functions below are exported so the automated test suite
// (scripts/p5-fix2-excel-id-preservation-tests.mjs) and the modal UI
// exercise the SAME logic. Import sequencing is server-first:
// prepare + validate → POST (await) → persist locally only when the
// server accepts the import.
// =========================================================

// Fields Excel is allowed to write onto an EXISTING employee.
// Identity (id / employeeNumber / companyId / branchId) and balance/status
// fields are preserved — an update can never re-key or zero them.
export const IMPORT_FIELD_WHITELIST = [
  'fullName', 'fullNameEn', 'department', 'jobTitle', 'contractType',
  'hireDate', 'basicSalary', 'housingAllowance', 'transportAllowance',
  'otherAllowances', 'isSubjectToGosi', 'gosiRegisteredWage',
  'gosiEmployeePercent', 'gosiCompanyPercent', 'bankName',
  'bankAccountNumber', 'iban', 'nationalId', 'phone', 'email',
  'nationality', 'gender', 'dateOfBirth',
];

const IMPORT_NUMERIC_FIELDS = new Set([
  'basicSalary', 'housingAllowance', 'transportAllowance', 'otherAllowances',
  'gosiRegisteredWage', 'gosiEmployeePercent', 'gosiCompanyPercent',
]);

// Column aliases (Arabic + English). Keys are unchanged from the original
// template so existing files keep parsing identically.
const IMPORT_FIELD_KEYS = {
  fullName: ['الاسم الكامل', 'اسم الموظف', 'الاسم', 'FullName', 'name'],
  fullNameEn: ['الاسم بالإنجليزية', 'FullNameEn', 'EnglishName'],
  department: ['القسم', 'الإدارة', 'Department'],
  jobTitle: ['المسمى الوظيفي', 'الوظيفة', 'JobTitle'],
  contractType: ['نوع العقد', 'ContractType'],
  hireDate: ['تاريخ التعيين', 'تاريخ المباشرة', 'HireDate', 'JoinDate'],
  basicSalary: ['الراتب الأساسي', 'BasicSalary', 'salary'],
  housingAllowance: ['بدل السكن', 'HousingAllowance'],
  transportAllowance: ['بدل النقل', 'TransportAllowance'],
  otherAllowances: ['بدلات أخرى', 'OtherAllowances'],
  isSubjectToGosi: ['خاضع للتأمينات', 'خاضع للضمان', 'GOSI', 'IsGOSI'],
  gosiRegisteredWage: ['الأجر المسجل في الضمان', 'أجر التأمينات', 'GOSIWage'],
  gosiEmployeePercent: ['نسبة استقطاع الموظف %', 'GOSIEmpPercent'],
  gosiCompanyPercent: ['نسبة مساهمة الشركة %', 'GOSICompPercent'],
  bankName: ['اسم البنك', 'البنك', 'BankName'],
  bankAccountNumber: ['رقم الحساب', 'BankAccount'],
  iban: ['الآيبان', 'IBAN'],
  nationalId: ['رقم الهوية', 'الإقامة', 'NationalID'],
  phone: ['رقم الهاتف', 'الجوال', 'Phone'],
  email: ['البريد الإلكتروني', 'Email'],
  nationality: ['الجنسية', 'Nationality'],
  gender: ['الجنس', 'Gender'],
  dateOfBirth: ['تاريخ الميلاد', 'DOB'],
};

// Canonical (already-normalized) field names are included as aliases so this
// normalizer is idempotent: acceptParsedRows() output can be re-validated by
// runImport() without being destructively re-parsed (X-2 UI boundary).
const IMPORT_COMPANY_KEYS = ['كود الشركة', 'اسم الشركة', 'رقم الشركة', 'Company', 'CompanyCode', 'companyId'];
const IMPORT_BRANCH_KEYS = ['اسم الفرع', 'الفرع', 'Branch', 'BranchName', 'branchId'];
const IMPORT_NUMBER_KEYS = ['الرقم الوظيفي', 'رقم الموظف', 'EmployeeNumber', 'EmployeeID', 'emp_id', 'employeeNumber'];

let importIdCounter = 0;
function defaultImportId() {
  importIdCounter += 1;
  return `emp-imp-${Date.now()}-${importIdCounter}`;
}

function firstCell(row, keys) {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/**
 * Strict, side-effect-free parse of uploaded rows.
 * Resolves company/branch WITHOUT any comp-1 / br-1 / companies[0] fallbacks:
 * an unknown company or branch is a reported error, never a silent re-key.
 * Rows that fail identity resolution (company, branch or employee number) are
 * excluded and reported so the caller can block the import.
 * Only non-empty cells are carried — empty cells cannot clobber anything.
 */
export function normalizeImportedRows(rows, { companies, defaultCompanyId, settings } = {}) {
  const comps = Array.isArray(companies) ? companies : [];
  const out = [];
  const errors = [];

  rows.forEach((row, idx) => {
    const line = idx + 1;
    if (!row || typeof row !== 'object') {
      errors.push({ row: line, code: 'invalid_row', message: 'Row is not an object' });
      return;
    }

    const companyVal = firstCell(row, IMPORT_COMPANY_KEYS);
    const matchedComp = companyVal
      ? comps.find((c) => c && (
        String(c.code || '').toLowerCase() === companyVal.toLowerCase()
          || c.nameAr === companyVal
          || String(c.nameEn || '').toLowerCase() === companyVal.toLowerCase()
          || c.id === companyVal))
      : comps.find((c) => c && c.id === defaultCompanyId);
    if (!matchedComp) {
      errors.push({ row: line, code: companyVal ? 'unknown_company' : 'missing_company', value: companyVal });
      return;
    }

    const branchVal = firstCell(row, IMPORT_BRANCH_KEYS);
    const branches = Array.isArray(matchedComp.branches) ? matchedComp.branches : [];
    const matchedBranch = branchVal
      ? branches.find((b) => b && (b.nameAr === branchVal || String(b.nameEn || '').toLowerCase() === branchVal.toLowerCase() || b.id === branchVal))
      : branches[0];
    if (!matchedBranch) {
      errors.push({ row: line, code: branchVal ? 'unknown_branch' : 'no_branches', value: branchVal });
      return;
    }

    const employeeNumber = firstCell(row, IMPORT_NUMBER_KEYS);
    if (!employeeNumber) {
      errors.push({ row: line, code: 'missing_employee_number', value: '' });
      return;
    }

    const rec = { employeeNumber, companyId: matchedComp.id, branchId: matchedBranch.id };
    for (const field of IMPORT_FIELD_WHITELIST) {
      const raw = firstCell(row, [...(IMPORT_FIELD_KEYS[field] || []), field]);
      if (raw === '') continue;
      if (field === 'isSubjectToGosi') {
        rec[field] = !['لا', 'no', 'false', '0', 'exempt'].includes(raw.toLowerCase());
      } else if (IMPORT_NUMERIC_FIELDS.has(field)) {
        rec[field] = Number(raw);
      } else {
        rec[field] = raw;
      }
    }
    out.push(rec);
  });

  return { rows: out, errors };
}

function createEmployeeFromRow(row, { company, settings, id }) {
  const target = { ...row };
  target.id = id;
  if (target.hireDate === undefined) target.hireDate = new Date().toISOString().split('T')[0];
  if (target.status === undefined) target.status = 'active';
  if (target.contractType === undefined) target.contractType = 'full_time';
  if (target.gender === undefined) target.gender = 'male';
  if (target.department === undefined) target.department = 'العمليات والتشغيل';
  if (target.jobTitle === undefined) target.jobTitle = 'موظف';
  if (target.basicSalary === undefined) target.basicSalary = 5000;
  if (target.annualLeaveBalance === undefined) target.annualLeaveBalance = settings.defaultAnnualLeaveDays || 21;
  if (target.annualLeaveEntitlement === undefined) target.annualLeaveEntitlement = target.annualLeaveBalance;
  if (target.carriedOverLeaveBalance === undefined) target.carriedOverLeaveBalance = 0;
  if (target.hourlyLeaveQuota === undefined) target.hourlyLeaveQuota = (company && company.hourlyLeaveQuota) || settings.defaultHourlyLeaveQuota || 4;
  return target;
}

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
              acceptParsedRows(rows);
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

              acceptParsedRows(jsonData);
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

      // Parse gate: strictly normalize, preview the valid rows and COUNT errors.
      // When any row fails identity resolution the import button stays disabled
      // so a half-valid file can never be silently committed (X-2).
      function acceptParsedRows(rawRows) {
        const { rows: mapped, errors } = normalizeImportedRows(rawRows, {
          companies,
          defaultCompanyId: companySelect.value,
          settings,
        });
        if (!mapped.length) {
          const first = errors[0];
          let msg = isEn ? 'No valid employee rows could be parsed' : 'لم يتم العثور على صفوف موظفين صالحة';
          if (first) msg = isEn ? `Row ${first.row}: ${first.code}` : `السطر ${first.row}: ${first.code}`;
          executeBtn.disabled = true;
          toast.error(msg);
          return;
        }
        parsedEmployees = mapped;
        renderPreview(parsedEmployees);
        dropZone.innerHTML = `
          <div style="font-size:28px; color:${errors.length ? 'var(--warning)' : 'var(--success)'};">${errors.length ? '⚠️' : '✅'}</div>
          <div style="font-weight:700; color:var(--text-main); margin-top:4px;">${file.name}</div>
          <div style="font-size:12px; color:var(--text-muted);">${parsedEmployees.length} ${isEn ? 'records parsed' : 'موظف تم استخراجه'}</div>
        `;
        executeBtn.disabled = errors.length > 0;
        if (errors.length) {
          toast.warning(isEn
            ? `${errors.length} row(s) skipped: ${errors.slice(0, 3).map((e) => `Row ${e.row} ${e.code}`).join(', ')}`
            : `تم تجاوز ${errors.length} صف: ${errors.slice(0, 3).map((e) => `السطر ${e.row} ${e.code}`).join(', ')}`);
        } else {
          toast.success(isEn ? `Extracted ${parsedEmployees.length} employees` : `تم استخراج ${parsedEmployees.length} سجل موظف بنجاح`);
        }
      }

      // 3. Execute Import — server-first sequencing (X-2)
      executeBtn?.addEventListener('click', () => {
        if (parsedEmployees.length === 0) return;
        executeBtn.disabled = true;
        void runImport({ rows: parsedEmployees, mode: modeSelect.value, store: storage })
          .then((result) => {
            executeBtn.disabled = false;
            if (!result.ok) {
              let msg = result.error || (isEn ? 'Import failed' : 'فشل الاستيراد');
              if (result.step === 'server') {
                msg = isEn ? `Import rejected by server: ${result.error}` : `رفض الخادم الاستيراد: ${result.error}`;
              } else if (result.step === 'parse' && result.errors && result.errors.length) {
                msg = isEn
                  ? `${result.errors.length} row(s) are invalid: ${result.errors.slice(0, 3).map((e) => `Row ${e.row} ${e.code}`).join(', ')}`
                  : `${result.errors.length} سطر غير صالح: ${result.errors.slice(0, 3).map((e) => `السطر ${e.row} ${e.code}`).join(', ')}`;
              }
              toast.error(msg);
              return;
            }
            toast.success(isEn
              ? `🎉 Imported: ${result.updated} updated, ${result.created} added${result.skipped ? `, ${result.skipped} skipped` : ''}`
              : `🎉 تم التحديث: ${result.updated} موظف محدَّث، ${result.created} موظف جديد${result.skipped ? `، تم تجاوز ${result.skipped}` : ''}`);
            close();
            if (onImportSuccess) onImportSuccess();
          })
          .catch((err) => {
            executeBtn.disabled = false;
            toast.error(err && err.message ? err.message : String(err));
          });
      });

      overlay.querySelector('.close-modal-btn')?.addEventListener('click', close);
    },
  });
}

/**
 * Build the deterministic import plan against the WRITABLE employee set.
 * Identity key is the composite `${companyId}::${employeeNumber}` so two
 * tenants may safely reuse an employee number without colliding. A matched
 * employee keeps its stored id byte-for-byte; duplicate rows for the same key
 * collapse into ONE result (last occurrence wins). Brand-new employees get a
 * fresh unique id via allocId (default: emp-imp-...).
 */
export function planImport(rows, { employees, companies, settings, mode = 'merge', allocId } = {}) {
  const empList = Array.isArray(employees) ? employees : [];
  const comps = Array.isArray(companies) ? companies : [];
  const s = settings || {};
  const byId = new Map();
  const byKey = new Map();
  empList.forEach((e) => {
    if (!e) return;
    if (e.id) byId.set(e.id, e);
    if (e.companyId && e.employeeNumber != null) byKey.set(`${e.companyId}::${e.employeeNumber}`, e);
  });
  const usedIds = new Set(byId.keys());
  const alloc = allocId || defaultImportId;
  const plan = [];
  const skipped = [];
  // last-row-wins: a duplicate composite key yields exactly ONE result.
  const lastIdx = new Map();
  rows.forEach((row, i) => {
    if (row && row.companyId && row.employeeNumber != null) lastIdx.set(`${row.companyId}::${row.employeeNumber}`, i);
  });
  rows.forEach((row, i) => {
    if (!row) return;
    const key = `${row.companyId}::${row.employeeNumber}`;
    if (lastIdx.get(key) !== i) return;
    const existing = byKey.get(key);
    if (existing) {
      if (mode === 'append') {
        skipped.push({ employeeNumber: row.employeeNumber, companyId: row.companyId, branchId: row.branchId });
        return;
      }
      const target = { ...existing };
      IMPORT_FIELD_WHITELIST.forEach((f) => { if (row[f] !== undefined) target[f] = row[f]; });
      target.id = existing.id;
      plan.push({ action: 'update', id: existing.id, companyId: existing.companyId, branchId: existing.branchId, employeeNumber: existing.employeeNumber, target });
      return;
    }
    let id = alloc();
    let guard = 0;
    while (usedIds.has(id) && guard++ < 1000) id = alloc();
    usedIds.add(id);
    const company = comps.find((c) => c && c.id === row.companyId) || null;
    const target = createEmployeeFromRow(row, { company, settings: s, id });
    plan.push({ action: 'create', id, companyId: row.companyId, branchId: row.branchId, employeeNumber: row.employeeNumber, target });
  });

  return { plan, skipped };
}

/**
 * Mirror of the server's validateServerBranchContext for WRITES: the returned
 * employee list is the set the caller may actually update/create. super_admin
 * is branch-scoped like everyone else — a concrete selectedBranchId is
 * required (server policy agrees); branch_hr is pinned to its assigned branch;
 * company-scoped roles must have a concrete branch selected when they span
 * several branches.
 */
export function buildWriteScopeForUser({ user, employees = [], selectedBranchId = 'all' } = {}) {
  if (!user) return { ok: false, error: 'no_user' };
  const companyScopedRoles = ['company_hr', 'payroll_admin', 'audit_reviewer', 'payments_officer'];
  if (user.role === 'super_admin') {
    if (!selectedBranchId || selectedBranchId === 'all') return { ok: false, error: 'branch_required' };
    return { ok: true, companyIds: 'all', branchIds: 'all', employees, selectedBranchId };
  }
  if (user.role === 'branch_hr') {
    if (!user.assignedBranchId || user.assignedBranchId === 'all') return { ok: false, error: 'branch_required' };
    const scoped = employees.filter((e) => e && e.companyId === user.assignedCompanyId && e.branchId === user.assignedBranchId);
    return { ok: true, companyIds: [user.assignedCompanyId], branchIds: [user.assignedBranchId], employees: scoped, selectedBranchId: user.assignedBranchId };
  }
  if (companyScopedRoles.includes(user.role)) {
    const assigned = Array.isArray(user.assignedBranches) && user.assignedBranches.length
      ? user.assignedBranches
      : [user.assignedBranchId || 'all'];
    const companyId = user.assignedCompanyId || (Array.isArray(user.assignedCompanyIds) && user.assignedCompanyIds[0]) || null;
    const multiBranch = assigned.includes('all') || assigned.length !== 1;
    if (multiBranch) {
      if (!selectedBranchId || selectedBranchId === 'all') return { ok: false, error: 'branch_required' };
      const scoped = employees.filter((e) => e && e.companyId === companyId && e.branchId === selectedBranchId);
      return { ok: true, companyIds: [companyId], branchIds: [selectedBranchId], employees: scoped, selectedBranchId };
    }
    const scoped = employees.filter((e) => e && e.companyId === companyId && e.branchId === assigned[0]);
    return { ok: true, companyIds: [companyId], branchIds: [assigned[0]], employees: scoped, selectedBranchId: assigned[0] };
  }
  const branchId = user.assignedBranchId && user.assignedBranchId !== 'all'
    ? user.assignedBranchId
    : (selectedBranchId !== 'all' ? selectedBranchId : null);
  if (!branchId) return { ok: false, error: 'branch_required' };
  const scoped = employees.filter((e) => e && e.branchId === branchId);
  return { ok: true, companyIds: [user.assignedCompanyId || null], branchIds: [branchId], employees: scoped, selectedBranchId: branchId };
}

/**
 * Server-first import executor. Sequencing:
 *   1. build the caller's write scope;
 *   2. strictly normalize the rows (report invalid identity rows);
 *   3. reject out-of-scope rows before anything is sent;
 *   4. POST /api/import-employees (await), sending X-Branch-Id when a concrete
 *      branch is required;
 *   5. persist locally ONLY on server success (mergeEmployeeUpdatesById +
 *      addEmployee). The local employee collection is never touched when the
 *      server rejects the import.
 */
export async function runImport({ rows, mode = 'merge', store = storage, apiFetch, allocId } = {}) {
  if (!store || !Array.isArray(rows)) return { ok: false, step: 'input', error: 'invalid input' };
  const state = store.getState();
  const user = store.getActiveUser();
  const companies = state.companies || [];
  const settings = state.settings || {};
  const allEmployees = state.rawEmployees || [];

  const scope = buildWriteScopeForUser({
    user,
    employees: allEmployees,
    selectedBranchId: store.getSelectedBranchId(),
  });
  if (!scope.ok) {
    const msg = scope.error === 'branch_required'
      ? (i18n.getLang() === 'en' ? 'Please select a branch first to continue.' : 'يرجى اختيار الفرع أولاً للمتابعة.')
      : scope.error;
    return { ok: false, step: 'scope', error: scope.error, message: msg };
  }

  const { rows: cleanRows, errors: parseErrors } = normalizeImportedRows(rows, { companies, settings });
  if (parseErrors.length) return { ok: false, step: 'parse', error: 'invalid_rows', errors: parseErrors };

  const outOfScope = cleanRows.filter((r) => {
    if (scope.companyIds !== 'all' && !scope.companyIds.includes(r.companyId)) return true;
    if (scope.branchIds !== 'all' && !scope.branchIds.includes(r.branchId)) return true;
    return false;
  });
  if (outOfScope.length) {
    return {
      ok: false,
      step: 'scope_rows',
      error: 'scope_violation',
      rows: outOfScope.map((r) => ({ employeeNumber: r.employeeNumber, companyId: r.companyId, branchId: r.branchId })),
    };
  }

  const { plan, skipped } = planImport(cleanRows, { employees: scope.employees, companies, settings, mode, allocId });
  const targetEmps = plan.map((p) => p.target);

  const send = apiFetch || store.apiFetch.bind(store);
  let res = null;
  try {
    res = await send('/api/import-employees', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Branch-Id': scope.selectedBranchId || 'all',
      },
      body: JSON.stringify({ employees: targetEmps, mode }),
    });
  } catch (err) {
    return { ok: false, step: 'network', error: String((err && err.message) || err) };
  }

  if (!res || !res.ok) {
    let data = null;
    try { data = await (res && res.json ? res.json() : Promise.resolve(null)); } catch (e) {}
    const status = res ? res.status : 0;
    return {
      ok: false,
      step: 'server',
      status,
      data,
      error: (data && data.error) || (status === 403 ? 'Permission denied' : 'Import rejected'),
    };
  }

  // Persist locally ONLY after the server accepted the import.
  const updates = plan.filter((p) => p.action === 'update').map((p) => p.target);
  const creates = plan.filter((p) => p.action === 'create').map((p) => p.target);
  if (updates.length) store.mergeEmployeeUpdatesById(updates);
  creates.forEach((emp) => store.addEmployee(emp));

  return { ok: true, updated: updates.length, created: creates.length, skipped: skipped.length, plan };
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
  return normalizeImportedRows(rows, { companies, defaultCompanyId, settings }).rows;
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
