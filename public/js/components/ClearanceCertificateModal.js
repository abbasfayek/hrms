// ==========================================
// Official Clearance & Experience Certificate Modal (Bilingual)
// Default: RELEASE-OF-LIABILITY ONLY (no salary / financial figures)
//=========================================

import { storage } from '../storage.js';
import { createModal } from './Modal.js';
import { Icons } from '../icons.js';
import { formatDate, TERMINATION_REASONS, resolveEmployeeCurrency, formatAmountWithCode, escapeHtml } from '../types.js';
import { i18n } from '../i18n.js';

export function openClearanceCertificateModal(employeeOrEosb, customSettings = null) {
  const state = storage.getState();
  const settings = customSettings || state.settings || {};
  // P2.2 multi-currency: the certificate prints the EMPLOYEE's currency CODE
  // (stamped on the EOSB record at save time; resolved per employee otherwise)
  // so IQD settlements are never implied as USD by a bare global symbol.
  const curCode = employeeOrEosb.currency || resolveEmployeeCurrency(employeeOrEosb, settings, state.companies).code || settings.currency || 'USD';
  const isEn = i18n.getLang() === 'en';

  // Support both employee or eosb record
  const empName = escapeHtml(employeeOrEosb.fullName || employeeOrEosb.employeeName || (isEn ? 'Employee' : 'موظف'));
  const dept = escapeHtml(employeeOrEosb.department || '-');
  const hireDate = employeeOrEosb.hireDate || employeeOrEosb.joinDate || '2023-01-01';
  const termDate = employeeOrEosb.terminationDate || new Date().toISOString().split('T')[0];
  const lastWorkingDay = employeeOrEosb.lastWorkingDay || termDate;
  const isSalaryBond = employeeOrEosb.settlementType === 'salary_bond';
  const reason = employeeOrEosb.reason || (isEn ? 'resignation' : 'resignation');
  const serviceYears = employeeOrEosb.serviceYears || 0;
  const serviceMonths = employeeOrEosb.serviceMonths || 0;
  const serviceDays = employeeOrEosb.serviceDays || 0;

  const eosbAmount = employeeOrEosb.finalEOSBAmount || 0;
  const leaveComp = employeeOrEosb.leaveCompensationAmount || 0;
  const finalMonthSalary = employeeOrEosb.finalMonthSalary || 0;
  const netAmount = employeeOrEosb.netSettlementAmount || (eosbAmount + leaveComp);

  // Generic clearance items; company can adjust through the EOSB engine's items.
  const clearanceItems = employeeOrEosb.clearanceItems || [
    { department: isEn ? 'IT Department' : 'تقنية المعلومات', item: isEn ? 'Return laptop, email and system permissions' : 'تسليم اللابتوب والبريد الإلكتروني والصلاحيات' },
    { department: isEn ? 'Administration' : 'الشؤون الإدارية', item: isEn ? 'Return ID badge, insurance card and office keys' : 'تسليم بطاقة العمل وبطاقة التأمين ومفاتيح المكتب' },
    { department: isEn ? 'Finance & Accounting' : 'المالية والمحاسبة', item: isEn ? 'Settle advances, custodians and discharge liabilities' : 'تسوية السلف والعهد المالية وإبراء الذمة' },
  ];

  const safeCompanyName = escapeHtml(settings.companyName || (isEn ? 'Company' : 'الشركة'));
  const safeCompanyNameEn = escapeHtml(settings.companyNameEn || (isEn ? 'Human Resources Department' : 'إدارة الموارد البشرية'));
  const safeCommercialReg = escapeHtml(settings.commercialRegistration || '-');
  const safeReason = isEn ? escapeHtml(TERMINATION_REASONS[reason]?.en || reason) : escapeHtml(TERMINATION_REASONS[reason]?.ar || reason);

  // MODE 1 - RELEASE OF LIABILITY ONLY (clean, NO salary / NO financial figures)
  const releaseOnlyHtml = `
    <!-- Company Header -->
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #0f172a; padding-bottom:14px; margin-bottom:20px; flex-wrap:wrap; gap:10px;">
      <div>
        <h2 style="font-size:20px; font-weight:900; color:#0f172a;">${safeCompanyName}</h2>
        <div style="font-size:12px; color:#64748b;">${safeCompanyNameEn}</div>
        <div style="font-size:12px; color:#64748b; margin-top:2px;">${isEn ? 'Registration No.: ' : 'السجل التجاري: '}${safeCommercialReg}</div>
      </div>

      <div style="text-align:${isEn ? 'right' : 'left'};">
        <div style="background:#0f172a; color:#ffffff; padding:8px 18px; border-radius:6px; font-weight:800; font-size:14px; direction:${isEn ? 'ltr' : 'rtl'};">
          ${isEn ? 'RELEASE OF LIABILITY' : 'إخلاء مسؤولية'}
        </div>
        <div style="font-size:12px; color:#64748b; margin-top:4px;">${isEn ? 'Date: ' : 'التاريخ: '}${formatDate(new Date().toISOString())}</div>
      </div>
    </div>

    <!-- Employee Identity -->
    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:16px; margin-bottom:20px; font-size:13.5px; line-height:1.9;">
      ${
        isEn
          ? `This is to certify that the employee <strong style="color:#1e1b4b; font-size:15px;">${empName}</strong>, who worked at <strong>${dept}</strong>, joined on <strong>${formatDate(hireDate)}</strong> and their service ended on <strong>${formatDate(termDate)}</strong> (last working day <strong>${formatDate(lastWorkingDay)}</strong>) due to <strong>${safeReason}</strong>, after serving <strong>${serviceYears} year(s), ${serviceMonths} month(s) and ${serviceDays} day(s)</strong>.`
          : `تشهد <strong>${safeCompanyName}</strong> بأن الموظف: <strong style="color:#1e1b4b; font-size:15px;">${empName}</strong>، والذي كان يعمل بإدارة: <strong>${dept}</strong>، قد التحق بالعمل بتاريخ <strong>${formatDate(hireDate)}</strong> وانتهت خدمته بتاريخ <strong>${formatDate(termDate)}</strong> (آخر يوم دوام <strong>${formatDate(lastWorkingDay)}</strong>) بسبب: <strong>${safeReason}</strong>، وذلك بعد قضاء خدمة فعلية مدتها <strong>${serviceYears} سنة و ${serviceMonths} شهر و ${serviceDays} يوم</strong>.`
      }
    </div>

    <!-- Release of Liability Statement (administrative only, NO financial content) -->
    <div style="border:1px solid #e2e8f0; border-radius:8px; padding:16px; margin-bottom:24px; font-size:13.5px; line-height:1.9;">
      <h4 style="font-size:14px; font-weight:800; margin-bottom:10px; color:#0f172a;">${isEn ? 'Statement of Release:' : 'بيان إخلاء المسؤولية:'}</h4>
      ${
        isEn
          ? `Based on the completion of all administrative procedures and the handover of all assigned assets, custody and duties, the above-named employee is hereby cleared and discharged from any further administrative or organizational liability towards <strong>${safeCompanyName}</strong> as of the date of this certificate.`
          : `بناءً على استكمال كافة الإجراءات الإدارية وتسليم جميع العهد والممتلكات والواجبات المكلف بها، فإن الموظف المذكور أعلاه يُخلّى طرفه ويُبرأ من أي مسؤولية إدارية أو تنظيمية لاحقة تجاه <strong>${safeCompanyName}</strong> اعتباراً من تاريخ هذا الكتاب.`
      }
    </div>

    <!-- Clearance / Handover Checklist -->
    <div style="margin-bottom:24px;">
      <h4 style="font-size:14px; font-weight:800; margin-bottom:10px; color:#0f172a;">${isEn ? 'Handover of Assigned Assets:' : 'تسليم العهد المكلف بها:'}</h4>
      <div style="border:1px solid #e2e8f0; border-radius:8px; overflow:hidden;">
        <table class="table" style="font-size:12.5px;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th>${isEn ? 'Department' : 'الإدارة المعنية'}</th>
              <th>${isEn ? 'Item / Custody' : 'العهدة'}</th>
              <th>${isEn ? 'Status' : 'حالة الاستلام والتسليم'}</th>
              <th>${isEn ? 'Officer Signature' : 'توقيع المسؤول'}</th>
            </tr>
          </thead>
          <tbody>
            ${clearanceItems
              .map(
                (item) => `
              <tr>
                <td><strong>${item.department}</strong></td>
                <td>${item.item}</td>
                <td><span style="color:#059669; font-weight:700;">${isEn ? '✓ Handed over & cleared' : '✓ تم التسليم والإخلاء'}</span></td>
                <td>..............................</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Official Signatures -->
    <div style="display:grid; grid-template-columns: repeat(3, 1fr); text-align:center; font-size:13px; color:#334155; padding-top:10px;">
      <div>
        <strong>${isEn ? 'Human Resources' : 'إدارة الموارد البشرية'}</strong>
        <div style="margin-top:35px;">..............................</div>
      </div>
      <div>
        <strong>${isEn ? 'Handover Officer' : 'مسؤول التسليم والاستلام'}</strong>
        <div style="margin-top:35px;">..............................</div>
      </div>
      <div>
        <strong>${isEn ? 'Employee Signature' : 'توقيع وبصمة الموظف'}</strong>
        <div style="margin-top:35px;">..............................</div>
      </div>
    </div>
  `;

  // MODE 2 - FULL DETAILED FORM (page 1: settlement figures, page 2: acknowledgment + signatures)
  const fullPage1Html = `
      <!-- Company Header -->
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #0f172a; padding-bottom:14px; margin-bottom:20px; flex-wrap:wrap; gap:10px;">
        <div>
          <h2 style="font-size:20px; font-weight:900; color:#0f172a;">${safeCompanyName}</h2>
          <div style="font-size:12px; color:#64748b;">${safeCompanyNameEn}</div>
          <div style="font-size:12px; color:#64748b; margin-top:2px;">${isEn ? 'Registration No.: ' : 'السجل التجاري: '}${safeCommercialReg}</div>
        </div>

        <div style="text-align:${isEn ? 'right' : 'left'};">
          <div style="display:flex; align-items:center; gap:8px; justify-content:flex-end;">
            <div style="background:#0f172a; color:#ffffff; padding:6px 14px; border-radius:6px; font-weight:800; font-size:14px; direction:${isEn ? 'ltr' : 'rtl'};">
              ${isEn ? 'FINAL CLEARANCE' : 'مخالصة نهائية وإخلاء طرف'}
            </div>
            <div style="font-size:11px; color:#64748b; background:#f1f5f9; padding:4px 8px; border-radius:5px; font-weight:700;">${isEn ? 'Page 1' : 'الورقة 1'}</div>
          </div>
          <div style="font-size:12px; color:#64748b; margin-top:4px;">${isEn ? 'Date: ' : 'التاريخ: '}${formatDate(new Date().toISOString())}</div>
        </div>
      </div>

      <!-- Employee Meta -->
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px; margin-bottom:20px; font-size:13.5px; line-height:1.8;">
        ${
          isEn
            ? (isSalaryBond
                ? `This is to certify that the employee <strong style="color:#1e1b4b; font-size:15px;">${empName}</strong>, who worked at <strong>${dept}</strong> and joined on <strong>${formatDate(hireDate)}</strong>, did not pass the probationary period. According to the applicable regulations he is paid a <strong>Salary Bond (سند راتب)</strong> equal to his nominal salary for the days worked, with no service gratuity and no leave cashout. His last working day was <strong>${formatDate(lastWorkingDay)}</strong>.`
                : `This is to certify that the employee <strong style="color:#1e1b4b; font-size:15px;">${empName}</strong>, who worked at <strong>${dept}</strong>, joined on <strong>${formatDate(hireDate)}</strong> and their service ended on <strong>${formatDate(termDate)}</strong> (last working day <strong>${formatDate(lastWorkingDay)}</strong>) due to <strong>${safeReason}</strong>, after serving <strong>${serviceYears} year(s), ${serviceMonths} month(s) and ${serviceDays} day(s)</strong>.`)
            : (isSalaryBond
                ? `تشهد <strong>${safeCompanyName}</strong> بأن الموظف: <strong style="color:#1e1b4b; font-size:15px;">${empName}</strong>، والذي كان يعمل بإدارة: <strong>${dept}</strong> وقد التحق بالعمل بتاريخ <strong>${formatDate(hireDate)}</strong>، لم يجتز فترة الاختبار. وبناءً على الأحكام النافذة يُصرف له <strong>سند راتب</strong> بقيمة راتبه الاسمي عن أيام العمل فقط، دون مكافأة نهاية خدمة ودون بدل إجازات، وكان آخر يوم دوام له هو <strong>${formatDate(lastWorkingDay)}</strong>.`
                : `تشهد <strong>${safeCompanyName}</strong> بأن الموظف: <strong style="color:#1e1b4b; font-size:15px;">${empName}</strong>، والذي كان يعمل بإدارة: <strong>${dept}</strong>، قد التحق بالعمل بتاريخ <strong>${formatDate(hireDate)}</strong> وانتهت خدمته بتاريخ <strong>${formatDate(termDate)}</strong> (آخر يوم دوام <strong>${formatDate(lastWorkingDay)}</strong>) بسبب: <strong>${safeReason}</strong>، وذلك بعد قضاء خدمة فعلية مدتها <strong>${serviceYears} سنة و ${serviceMonths} شهر و ${serviceDays} يوم</strong>.`)
        }
      </div>

      <!-- Clearance Checklist -->
      <div style="margin-bottom:20px;">
        <h4 style="font-size:14px; font-weight:800; margin-bottom:10px; color:#0f172a;">${isEn ? 'Clearance & Handover Statement:' : 'بيان تسليم العهد وإخلاء الطرف الإداري:'}</h4>
        <div style="border:1px solid #e2e8f0; border-radius:8px; overflow:hidden;">
          <table class="table" style="font-size:12.5px;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th>${isEn ? 'Department' : 'الإدارة المعنية'}</th>
                <th>${isEn ? 'Item / Handover' : 'البند والعهد المسلمة'}</th>
                <th>${isEn ? 'Status' : 'حالة الاستلام والتسليم'}</th>
                <th>${isEn ? 'Officer Signature' : 'توقيع المسؤول'}</th>
              </tr>
            </thead>
            <tbody>
              ${clearanceItems
                .map(
                  (item) => `
                <tr>
                  <td><strong>${item.department}</strong></td>
                  <td>${item.item}</td>
                  <td><span style="color:#059669; font-weight:700;">${isEn ? '✓ Handed over & cleared' : '✓ تم التسليم والإخلاء'}</span></td>
                  <td>..............................</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Financial Settlement Summary -->
      <div id="clearance-financial-section" style="margin-bottom:20px; border:1px solid #e2e8f0; border-radius:8px; padding:14px;">
        <h4 style="font-size:14px; font-weight:800; margin-bottom:10px; color:#0f172a;">
          ${
            isEn
              ? (isSalaryBond ? 'Salary Bond (سند راتب) Final Statement:' : 'Final Financial Settlement:')
              : (isSalaryBond ? 'بيان سند الراتب النهائي (سند راتب):' : 'بيان التصفية المالية المستحقة:')
          }
        </h4>
        ${
          isSalaryBond
            ? `<div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:8px; font-size:13px;">
          <div>${isEn ? 'Nominal Salary (Final Month Worked Days): ' : 'الراتب الاسمي (أيام العمل في الشهر الأخير): '}<strong>${formatAmountWithCode(finalMonthSalary, curCode)}</strong></div>
          <div>${isEn ? 'Additional Bonuses / Compensation: ' : 'المكافآت أو التعويضات الإضافية: '}<strong>${formatAmountWithCode(employeeOrEosb.bonusCompensation || 0, curCode)}</strong></div>
        </div>
        <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:8px; font-size:13px; margin-top:8px;">
          <div>${isEn ? 'End of Service Benefit: ' : 'مكافأة نهاية الخدمة: '}<strong>0.00 ${curCode}</strong></div>
          <div>${isEn ? 'Unused Leave Cashout: ' : 'بدل رصيد الإجازات: '}<strong>0.00 ${curCode}</strong></div>
        </div>
        <div style="border-top:1px solid #e2e8f0; margin-top:10px; padding-top:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <span style="font-weight:800; font-size:14px;">${isEn ? 'Total paid to the employee under this salary bond:' : 'إجمالي المبلغ المصروف للموظف بموجب هذا السند:'}</span>
          <span style="font-weight:900; font-size:18px; color:#059669;">${formatAmountWithCode(netAmount, curCode)}</span>
        </div>`
            : `<div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:8px; font-size:13px;">
          <div>${isEn ? 'End of Service Benefit: ' : 'مكافأة نهاية الخدمة: '}<strong>${formatAmountWithCode(eosbAmount, curCode)}</strong></div>
          <div>${isEn ? 'Unused Leave Cashout: ' : 'بدل رصيد الإجازات: '}<strong>${formatAmountWithCode(leaveComp, curCode)}</strong></div>
        </div>
        <div style="border-top:1px solid #e2e8f0; margin-top:10px; padding-top:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <span style="font-weight:800; font-size:14px;">${isEn ? 'Total amount paid to the employee under this clearance:' : 'إجمالي المبلغ المصروف للموظف بموجب هذه المخالصة:'}</span>
          <span style="font-weight:900; font-size:18px; color:#059669;">${formatAmountWithCode(netAmount, curCode)}</span>
        </div>`
        }
      </div>
  `;

  const fullPage2Html = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #0f172a; padding-bottom:12px; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="font-size:16px; font-weight:900; color:#0f172a;">${safeCompanyName}</h3>
          <div style="font-size:11.5px; color:#64748b;">${safeCompanyNameEn}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:11px; color:#334155;">
            <div style="border:1px solid #cbd5e1; border-radius:5px; padding:3px 8px; text-align:center; font-weight:700;" id="clearance-pg-num">${isEn ? 'Page 2' : 'الورقة 2'}</div>
            <div style="border:1px solid #cbd5e1; border-radius:5px; padding:3px 8px; text-align:center; font-weight:700;" id="clearance-pg-count">${isEn ? 'of 2' : 'من 2'}</div>
          </div>
        </div>
      </div>

      <!-- Employee Acknowledgment & Disclaimer -->
      <div style="background:#fef2f2; border:1px solid #fee2e2; border-radius:8px; padding:12px; font-size:12.5px; color:#991b1b; line-height:1.6; margin-bottom:24px;">
        ${
          isEn
            ? (isSalaryBond
                ? `<strong>Acknowledgment & Receipt:</strong> I, the undersigned employee <strong>${empName}</strong>, confirm that I have received my nominal salary under this Salary Bond (سند راتب) in full, and that I have no further financial or in-kind claim against the company, releasing it fully and finally.`
                : `<strong>Acknowledgment & Receipt:</strong> I, the undersigned employee <strong>${empName}</strong>, confirm that I have received all my legal and financial entitlements, including the end of service benefit, leave cashout and experience certificate, and that I have no further financial or in-kind claim against the company, releasing it fully and finally.`)
            : (isSalaryBond
                ? `<strong>إقرار واستلام الموظف:</strong> أقر أنا الموظف <strong>${empName}</strong> الموقع أدناه بأنني استلمت راتبي الاسمي بموجب سند الراتب هذا كاملاً، ولم يعد لي أي حق أو مطالبة مالية أو عينية تجاه الشركة، وأبرئ ذمتها إبراءً شاملاً ونهائياً لا رجعة فيه.`
                : `<strong>إقرار واستلام الموظف:</strong> أقر أنا الموظف <strong>${empName}</strong> الموقع أدناه بأنني استلمت كافة مستحقاتي النظامية والمالية ومكافأة نهاية الخدمة وبدل الإجازات وشهادة الخبرة، ولم يعد لي أي حق أو مطالبة مالية أو عينية تجاه الشركة، وأبرئ ذمتها إبراءً شاملاً ونهائياً لا رجعة فيه.`)
        }
      </div>

      <!-- Official Signatures -->
      <div style="display:grid; grid-template-columns: repeat(3, 1fr); text-align:center; font-size:13px; color:#334155; padding-top:10px;">
        <div>
          <strong>${isEn ? 'Human Resources' : 'إدارة الموارد البشرية'}</strong>
          <div style="margin-top:35px;">..............................</div>
        </div>
        <div>
          <strong>${isEn ? 'Finance Department' : 'الإدارة المالية'}</strong>
          <div style="margin-top:35px;">..............................</div>
        </div>
        <div>
          <strong>${isEn ? 'Employee Signature' : 'توقيع وبصمة الموظف'}</strong>
          <div style="margin-top:35px;">..............................</div>
        </div>
      </div>
  `;

  const bodyHtml = `
    <style>
      .clearance-page-1 { page-break-after: always; break-after: page; }
      @media print { .clearance-wrapper { padding:0; border:none; border-radius:0; } .clearance-noprint { display:none !important; } }
      @media screen { .clearance-page-1 { box-shadow:0 1px 8px rgba(15,23,42,.08); } }
    </style>

    <div class="clearance-wrapper print-page" style="background:#ffffff; color:#0f172a; padding:28px; border-radius:var(--radius-lg); border:1px solid #e2e8f0; font-family:'Segoe UI', Tahoma, Arial, sans-serif; direction:${isEn ? 'ltr' : 'rtl'}; text-align:${isEn ? 'left' : 'right'};">

      <!-- Mode Toggle (not printed) -->
      <div class="clearance-noprint" style="display:flex; justify-content:flex-end; margin-bottom:14px; flex-wrap:wrap; gap:12px;">
        <label style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:#334155; cursor:pointer; user-select:none;">
          <span>${isEn ? 'Print format:' : 'نوع الطباعة:'}</span>
          <select id="clearance-mode-select" class="form-input" style="width:auto; padding:4px 10px; font-size:12.5px;">
            <option value="release" ${localStorage.getItem('hrms_clearance_mode') !== 'full' ? 'selected' : ''}>${isEn ? 'Release of Liability only (no salary/financial)' : 'إخلاء مسؤولية فقط (بدون رواتب وماليات)'}</option>
            <option value="full" ${localStorage.getItem('hrms_clearance_mode') === 'full' ? 'selected' : ''}>${isEn ? 'Full detailed clearance (with settlement)' : 'المخالصة الكاملة (مع التصفية المالية)'}</option>
          </select>
        </label>
      </div>

      <!-- MODE 1: Release Only -->
      <div id="clearance-release-page">${releaseOnlyHtml}</div>

      <!-- MODE 2: Full (Page 1 + Page 2) -->
      <div id="clearance-full-wrapper" style="display:none;">
        <div class="clearance-page-1" id="clearance-page-1">${fullPage1Html}</div>
        <div id="clearance-page-2">${fullPage2Html}</div>
      </div>

    </div>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${isEn ? 'Close' : 'إغلاق'}</button>
    <button type="button" class="btn btn-primary print-clearance-btn">
      ${Icons.printer(16)} ${isEn ? 'Print Certificate' : 'طباعة النموذج'}
    </button>
  `;

  createModal({
    title: `${isEn ? 'Clearance Certificate' : 'مخالصة وإخلاء طرف'}: ${empName}`,
    size: 'lg',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      overlay.querySelector('.close-modal-btn')?.addEventListener('click', close);

      const modeSelect = overlay.querySelector('#clearance-mode-select');
      const releasePage = overlay.querySelector('#clearance-release-page');
      const fullWrapper = overlay.querySelector('#clearance-full-wrapper');

      const applyMode = () => {
        const mode = modeSelect ? modeSelect.value : 'release';
        localStorage.setItem('hrms_clearance_mode', mode);
        if (releasePage) releasePage.style.display = mode === 'full' ? 'none' : '';
        if (fullWrapper) fullWrapper.style.display = mode === 'full' ? '' : 'none';
      };
      if (modeSelect) modeSelect.addEventListener('change', applyMode);
      applyMode();

      overlay.querySelector('.print-clearance-btn')?.addEventListener('click', () => {
        const mode = modeSelect ? modeSelect.value : 'release';
        // Apply the selected mode to the printable pages, then print.
        if (releasePage) releasePage.style.display = mode === 'full' ? 'none' : '';
        if (fullWrapper) fullWrapper.style.display = mode === 'full' ? '' : 'none';
        window.print();
      });
    },
  });
}