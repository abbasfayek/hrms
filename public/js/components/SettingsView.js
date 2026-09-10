// ==========================================
// System Settings & Multi-Currency Setup View
// ==========================================

import { storage } from '../storage.js';
import { Icons } from '../icons.js';
import { i18n, t } from '../i18n.js';
import { showConfirmDialog } from './Modal.js';
import { toast } from './Toast.js';
import { getAllCurrencies, can } from '../types.js';
import { testBiometricConnection, syncBiometricLogs } from '../engines/biometricEngine.js';

export function renderSettingsView(container) {
  const state = storage.getState();
  const settings = state.settings;
  const isEn = i18n.getLang() === 'en';
  const isSuperAdmin = (storage.getActiveUser() || {}).role === 'super_admin';
  const allCurrencies = getAllCurrencies(settings);
  const customCurrArr = (Array.isArray(settings.customCurrencies) ? settings.customCurrencies : []).map((c) => ({ ...c }));

  container.innerHTML = `
    <!-- Top Header -->
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:20px;">
      <div>
        <h2 style="font-size:20px; font-weight:800; color:var(--text-main);">${t('settingsTitle')}</h2>
        <p style="font-size:13px; color:var(--text-muted);">${t('settingsSub')}</p>
      </div>

      <div style="display:flex; align-items:center; gap:10px;">
        <button type="button" class="btn btn-outline" id="btn-export-backup">
          ${Icons.download(16)} ${t('exportBackupBtn')}
        </button>
        <button type="button" class="btn btn-primary" id="btn-save-settings">
          ${Icons.check(16)} ${t('saveSettingsBtn')}
        </button>
      </div>
    </div>

    <!-- Main Settings Form -->
    <form id="settings-form">
      <div class="grid grid-cols-2" style="margin-bottom:24px;">
        
        <!-- Company Profile & Currency Card -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">${Icons.building(20)} ${t('companyDetailsCard')}</div>
          </div>

          <div class="form-group">
            <label class="form-label">${t('companyNameArabic')} *</label>
            <input type="text" class="form-input" name="companyName" value="${settings.companyName}" required>
          </div>

          <div class="form-group">
            <label class="form-label">${isEn ? 'Company Name (English)' : 'اسم المنشأة بالإنجليزي'}</label>
            <input type="text" class="form-input" name="companyNameEn" value="${settings.companyNameEn || ''}">
          </div>

          <div class="grid grid-cols-2">
            <div class="form-group">
              <label class="form-label">${isEn ? 'Company Phone' : 'رقم الهاتف'}</label>
              <input type="text" class="form-input" name="companyPhone" value="${settings.companyPhone || ''}" dir="ltr" style="text-align:left;">
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'WhatsApp / Mobile' : 'واتساب / موبايل'}</label>
              <input type="text" class="form-input" name="companyWhatsApp" value="${settings.companyWhatsApp || ''}" dir="ltr" style="text-align:left;">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">${isEn ? 'Company Email' : 'البريد الإلكتروني'}</label>
            <input type="email" class="form-input" name="companyEmail" value="${settings.companyEmail || ''}" dir="ltr" style="text-align:left;">
          </div>

          <div class="grid grid-cols-2">
            <div class="form-group">
              <label class="form-label">${t('crNumber')}</label>
              <input type="text" class="form-input" name="commercialRegistration" value="${settings.commercialRegistration || ''}">
            </div>

            <div class="form-group">
              <label class="form-label">${t('vatNumber')}</label>
              <input type="text" class="form-input" name="taxNumber" value="${settings.taxNumber || ''}">
            </div>
          </div>

          <!-- Currency Preset Selection (User Request: اختيار العملة) -->
          <div class="grid grid-cols-2">
            <div class="form-group">
              <label class="form-label">${isEn ? 'Select the System Base Currency *' : 'اختيار العملة الأساسية للنظام *'}</label>
              <select class="form-select" id="currency-preset-select">
                ${allCurrencies
                  .map(
                    (c) => `
                  <option value="${c.code}|${c.symbol}" ${c.code === settings.currency ? 'selected' : ''}>
                    ${isEn ? (c.nameEn || c.nameAr) : c.nameAr} (${c.code} - ${c.symbol})
                  </option>
                `
                  )
                  .join('')}
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'Currency Symbol Shown in System *' : 'رمز العملة الظاهر بالنظام *'}</label>
              <input type="text" class="form-input" name="currencySymbol" id="currency-symbol-input" value="${settings.currencySymbol || '$'}" required>
            </div>
          </div>

          <input type="hidden" name="currency" id="currency-code-input" value="${settings.currency || 'USD'}">
        </div>

        <!-- Custom & Additional Currencies Card -->
        <div class="card" style="grid-column: span 2; border:1px solid rgba(6, 182, 212, 0.25);">
          <div class="card-header">
            <div class="card-title" style="display:flex; align-items:center; gap:8px;">
              ${Icons.dollar(20)} ${isEn ? 'Custom & Additional Currencies' : 'العملات المخصصة والإضافية'}
            </div>
            <span class="badge badge-info">${customCurrArr.length}</span>
          </div>

          <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:12px;">
            ${isEn ? 'Add extra currencies to the list. Employees can then be paid in dinar (IQD), euro (EUR), dollar (USD) or any currency you define here — their payslips and salary displays will use the selected currency.' : 'أضف عملات إضافية إلى القائمة، وعندها يمكن صرف رواتب الموظفين بالدينار (IQD) أو اليورو (EUR) أو الدولار (USD) أو أي عملة تعرّفها هنا — وتُعرض رواتبهم وقسائمهم بالعملة المختارة.'}
          </div>

          <div id="custom-currencies-list"></div>

          <div class="grid grid-cols-4" style="margin-top:14px; align-items:end;">
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${isEn ? 'Code' : 'الكود'}</label>
              <input type="text" class="form-input" id="cust-cur-code" placeholder="e.g. IQD" style="text-transform:uppercase;">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${isEn ? 'Symbol' : 'الرمز'}</label>
              <input type="text" class="form-input" id="cust-cur-symbol" placeholder="e.g. د.ع">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${isEn ? 'Name (AR)' : 'الاسم بالعربي'}</label>
              <input type="text" class="form-input" id="cust-cur-name-ar" placeholder="دينار عراقي">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${isEn ? 'Name (EN)' : 'الاسم بالإنجليزي'}</label>
              <div style="display:flex; gap:8px;">
                <input type="text" class="form-input" id="cust-cur-name-en" placeholder="Iraqi Dinar">
                <button type="button" class="btn btn-primary" id="btn-add-custom-curr" style="white-space:nowrap;">${Icons.check(16)} ${isEn ? 'Add' : 'إضافة'}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- P4 Currency Governance & Exchange Rates Card (Super Admin only) -->
        ${isSuperAdmin ? `
        <div class="card" style="grid-column: span 2; border:1px solid rgba(16, 185, 129, 0.3); background:linear-gradient(135deg, rgba(16, 185, 129, 0.02) 0%, rgba(6, 182, 212, 0.02) 100%);">
          <div class="card-header">
            <div class="card-title" style="display:flex; align-items:center; gap:8px;">
              ${Icons.dollar(20)} ${isEn ? 'Currency Governance & Exchange Rates' : 'إدارة العملات وأسعار الصرف'}
            </div>
            <span class="badge badge-success">${isEn ? 'Super Admin only' : 'المسؤول العام فقط'}</span>
          </div>

          <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:14px;">
            ${isEn ? 'The base currency is the single reference used to convert every recorded amount. Each financial record (payroll item, EOSB settlement, loan) pins the exchange rate in force on the day it was recorded; committed records are never re-priced with a later rate. The base currency always has an implicit rate of 1.' : 'العملة الأساسية هي المرجع الوحيد لتحويل كل مبلغ مسجل. كل سجل مالي (بند رواتب، نهاية خدمة، سلفة) يثبّت سعر الصرف المعمول به يوم تسجيله؛ ولا يُعاد تسعير السجلات المؤكدة بسعر لاحق أبداً. سعر العملة الأساسية ضمني دائماً = 1.'}
          </div>

          <div class="grid grid-cols-2">
            <div class="form-group">
              <label class="form-label">${isEn ? 'Base Currency (applies to NEW records only)' : 'العملة الأساسية (تنطبق فقط على السجلات الجديدة)'}</label>
              <select class="form-select" name="baseCurrency">
                ${allCurrencies
                  .map(
                    (c) => `
                    <option value="${c.code}" ${(settings.baseCurrency || settings.currency || 'USD') === c.code ? 'selected' : ''}>
                      ${isEn ? (c.nameEn || c.nameAr) : c.nameAr} (${c.code})
                    </option>
                  `
                  )
                  .join('')}
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'Pinned Snapshot Policy' : 'سياسة السعر المثبّت'}</label>
              <div style="font-size:12.5px; color:var(--text-muted); padding-top:8px;">
                ${isEn ? 'Rate set today = used by records created from now on. Once a record commits, its rate is pinned and cannot be edited — add a new rate for later records.' : 'السعر المحدد اليوم يُستخدم للسجلات التي تُنشأ من الآن. بمجرد تأكيد السجل يصبح سعره مثبتاً لا يُعدّل — أضف سعراً جديداً للسجلات اللاحقة.'}
              </div>
            </div>
          </div>

          <div id="exchange-rates-list" style="margin-top:4px;"></div>

          <div class="grid grid-cols-4" style="margin-top:14px; align-items:end;">
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${isEn ? 'Currency' : 'العملة'}</label>
              <select class="form-select" id="p4-rate-currency"></select>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${isEn ? 'Rate (1 unit = how many base)' : 'سعر الصرف (1 وحدة = كم من الأساسية)'}</label>
              <input type="number" step="0.000001" min="0.000001" class="form-input" id="p4-rate-value" placeholder="e.g. 1460.000000">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${isEn ? 'Rate Date *' : 'تاريخ السعر *'}</label>
              <input type="date" class="form-input" id="p4-rate-date">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">${isEn ? 'Note / Source' : 'ملاحظة / المصدر'}</label>
              <div style="display:flex; gap:8px;">
                <input type="text" class="form-input" id="p4-rate-note" placeholder="e.g. manual entry">
                <button type="button" class="btn btn-primary" id="btn-save-ex-rate" style="white-space:nowrap;">${Icons.check(16)} ${isEn ? 'Set' : 'تثبيت'}</button>
              </div>
            </div>
          </div>
        </div>
        ` : ''}

        <!-- P2.2 Super-Admin Payroll Lock (visible to Super Admin only) -->
        ${isSuperAdmin ? `
        <div class="card" style="grid-column: span 2; border:1px solid rgba(220, 38, 38, 0.25);">
          <div class="card-header">
            <div class="card-title" style="display:flex; align-items:center; gap:8px;">
              ${Icons.lock(20)} ${isEn ? 'Payroll Visibility Control (Super Admin)' : 'التحكم بإظهار الرواتب (المسؤول العام فقط)'}
            </div>
            <span class="badge badge-warning">${isEn ? 'Super Admin' : 'مسؤول عام'}</span>
          </div>

          <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:12px;">
            ${isEn ? 'When disabled, payroll screens, payslips and salary totals are hidden from all users except Super Admins until this option is re-enabled. No payroll data is deleted — it is simply not displayed.' : 'عند الإيقاف تُخفى شاشات الرواتب وقسائم الرواتب والمجاميع من جميع المستخدمين ما عدا المسؤول العام حتى تُفعّل من جديد. لا يُحذف أي بيانات رواتب — فقط يُوقف عرضها.'}
          </div>

          <div class="form-group" style="display:flex; align-items:center; gap:12px; margin-bottom:0;">
            <label style="display:flex; align-items:center; gap:10px; cursor:pointer; font-weight:700; color:var(--text-main);">
              <input type="checkbox" name="payrollViewEnabled" ${settings.payrollViewEnabled !== false ? 'checked' : ''} style="width:18px; height:18px;">
              <span>${isEn ? 'Enable payroll display for all authorized users' : 'تفعيل عرض الرواتب لجميع المستخدمين المصرح لهم'}</span>
            </label>
          </div>
        </div>
        ` : ''}

        <!-- Labor & Payroll Rules Card -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">${Icons.shieldCheck(20)} ${t('laborPoliciesCard')}</div>
          </div>

          <div class="grid grid-cols-2">
            <div class="form-group">
              <label class="form-label">${t('approvedWorkDaysPerMonth')}</label>
              <input type="number" class="form-input" name="workingDaysPerMonth" value="${settings.workingDaysPerMonth || 30}" required>
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'Daily Working Hours' : 'ساعات العمل اليومية'}</label>
              <input type="number" class="form-input" name="workingHoursPerDay" value="${settings.workingHoursPerDay || 8}" required>
            </div>
          </div>

          <div class="form-group" style="margin-top:-4px;">
            <label class="form-label">${isEn ? 'Daily Wage Calculation Method' : 'طريقة حساب أجر اليوم'}</label>
            <select class="form-input" name="dailyRateMethod">
              <option value="" ${!settings.dailyRateMethod ? 'selected' : ''}>${isEn ? 'Keep defaults per module (not unified)' : 'إبقاء الوضع الحالي لكل وحدة (غير موحّد)'}</option>
              <option value="workingDays" ${settings.dailyRateMethod === 'workingDays' ? 'selected' : ''}>${isEn ? 'Working days per month (basic+housing+transport ÷ working days)' : 'أيام العمل الشهرية (أساسي+سكن+نقل ÷ أيام العمل)'}</option>
              <option value="fixed30" ${settings.dailyRateMethod === 'fixed30' ? 'selected' : ''}>${isEn ? 'Fixed 30 days (basic+housing+transport ÷ 30)' : 'ثابت 30 يوماً (أساسي+سكن+نقل ÷ 30)'}</option>
              <option value="calendarDays" ${settings.dailyRateMethod === 'calendarDays' ? 'selected' : ''}>${isEn ? 'Actual calendar days of the month (gross ÷ calendar days)' : 'أيام التقويم الفعلية للشهر (إجمالي الراتب ÷ أيام الشهر)'}</option>
              <option value="basicOnly" ${settings.dailyRateMethod === 'basicOnly' ? 'selected' : ''}>${isEn ? 'Basic salary only ÷ working days' : 'الأساسي فقط ÷ أيام العمل'}</option>
            </select>
            <p style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">
              ${isEn ? 'Applies the SAME method to payroll, leave cash-out, overtime, EOSB, absence and payslips. Empty = each module keeps its current historical formula.' : 'تطبيق نفس الطريقة على الرواتب وصرف الإجازات والإضافي ونهاية الخدمة والغياب وكشوف الرواتب. فارغ = تحتفظ كل وحدة بصيغتها الحالية.'}
            </p>
          </div>

          <div class="grid grid-cols-3">
            <div class="form-group">
              <label class="form-label">${t('annualLeaveEntitlementDaysYear')}</label>
              <input type="number" class="form-input" name="defaultAnnualLeaveDays" value="${settings.defaultAnnualLeaveDays || 30}" required>
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'Max Leave Carry-over (Days)' : 'الحد الأقصى لترحيل الإجازات (أيام)'}</label>
              <input type="number" class="form-input" name="maxCarryOverDays" value="${settings.maxCarryOverDays || 15}">
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'Hourly Leave Quota (hrs/month) *' : 'رصيد الإجازات الزمنية (ساعات/شهر) *'}</label>
              <input type="number" step="0.5" class="form-input" name="defaultHourlyLeaveQuota" value="${settings.defaultHourlyLeaveQuota !== undefined ? settings.defaultHourlyLeaveQuota : 4}" required title="${isEn ? 'Renews monthly and is not carried over' : 'تتجدد شهرياً وغير قابلة للترحيل'}">
            </div>
          </div>

          <div class="grid grid-cols-2">
            <div class="form-group">
              <label class="form-label">${isEn ? 'Social Insurance (Employee) %' : 'نسبة التأمينات الاجتماعية على الموظف (%)'}</label>
              <input type="number" step="0.01" min="0" class="form-input" name="socialInsuranceEmployeePercent" value="${settings.socialInsuranceEmployeePercent !== undefined ? settings.socialInsuranceEmployeePercent : (settings.gosiEmployeePercent || 0)}" title="${isEn ? 'Leave 0 if the company is not subject to insurance contributions' : 'تُترك 0 إن لم تكن المنشأة ملتزمة باشتراكات تأمين'}">
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'Company Insurance Contribution %' : 'نسبة مساهمة المنشأة في التأمينات (%)'}</label>
              <input type="number" step="0.01" min="0" class="form-input" name="socialInsuranceCompanyPercent" value="${settings.socialInsuranceCompanyPercent !== undefined ? settings.socialInsuranceCompanyPercent : (settings.gosiCompanyPercent || 0)}" title="${isEn ? 'Leave 0 if the company is not subject to insurance contributions' : 'تُترك 0 إن لم تكن المنشأة ملتزمة باشتراكات تأمين'}">
            </div>
          </div>

          <div class="grid grid-cols-2">
            <div class="form-group">
              <label class="form-label">${isEn ? 'Overtime Multiplier (Regular Days)' : 'معامل الإضافي في الأيام العادية'}</label>
              <input type="number" step="0.1" class="form-input" name="overtimeRegularRate" value="${settings.overtimeRegularRate || 1.5}">
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'Overtime Multiplier (Official Holidays)' : 'معامل الإضافي في العطل الرسمية'}</label>
              <input type="number" step="0.1" class="form-input" name="overtimeHolidayRate" value="${settings.overtimeHolidayRate || 2.0}">
            </div>
          </div>

          <!-- Configurable Weekly Days Off (generalized, no fixed Friday) -->
          <div class="form-group" style="margin-top:6px;">
            <label class="form-label">${isEn ? 'Weekly Days Off (excluded from leave & working-day calculations)' : 'أيام العطلة الأسبوعية (تُستثنى من احتساب الإجازات وأيام العمل)'}</label>
            <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:4px;">
              ${[
                { n: 0, ar: 'الأحد', en: 'Sun' },
                { n: 1, ar: 'الإثنين', en: 'Mon' },
                { n: 2, ar: 'الثلاثاء', en: 'Tue' },
                { n: 3, ar: 'الأربعاء', en: 'Wed' },
                { n: 4, ar: 'الخميس', en: 'Thu' },
                { n: 5, ar: 'الجمعة', en: 'Fri' },
                { n: 6, ar: 'السبت', en: 'Sat' },
              ]
                .map(
                  (d) => `
                <label style="display:flex; align-items:center; gap:6px; padding:6px 12px; border:1px solid var(--border-color); border-radius:8px; cursor:pointer; background:var(--bg-card); font-size:13px; font-weight:700; color:var(--text-main);">
                  <input type="checkbox" name="weekendDay" value="${d.n}" ${(settings.weekendDays || [6, 0]).includes(d.n) ? 'checked' : ''} style="width:16px; height:16px; accent-color:var(--primary);">
                  ${isEn ? d.en : d.ar} (${isEn ? d.ar : d.en})
                </label>
              `
                )
                .join('')}
            </div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">${isEn ? 'Set the weekly closure days according to the company country (Saturday & Sunday in most countries).' : 'اضبط أيام تعطيل الأسبوع حسب بلد المنشأة (السبت والأحد في معظم الدول).'}</div>
          </div>
        </div>

        <!-- EOSB Calculation Policies Card (Requirement 4) -->
        <div class="card" style="grid-column: span 2; border:1px solid rgba(16, 185, 129, 0.3); background:linear-gradient(135deg, rgba(16, 185, 129, 0.02) 0%, rgba(79, 70, 229, 0.02) 100%);">
          <div class="card-header">
            <div class="card-title" style="display:flex; align-items:center; gap:8px;">
              ${Icons.award(20)} ${isEn ? 'End of Service Benefit Calculation Policies' : 'ضوابط احتساب مكافأة نهاية الخدمة'}
            </div>
            <span class="badge badge-success">${isEn ? 'Calculation settings are editable' : 'محددات الاحتساب قابلة للتعديل'}</span>
          </div>

          <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:16px;">
            ${isEn ? 'Define the EOSB calculation algorithm to suit your company: months of salary per service year (first & subsequent tiers), resignation & termination rules, and automatic inclusion of the final month working days until clearance.' : 'عرّف خوارزمية مكافأة نهاية الخدمة بما يناسب نظام شركتك: عدد أشهر الراتب الممنوحة عن كل سنة خدمة (مرحلة أولى ومرحلة لاحقة)، وضوابط الاستقالة وإنهاء الخدمات، وتفعيل احتساب أجر أيام العمل الأخيرة حتى تاريخ المخالصة.'}
          </div>

          <div class="grid grid-cols-4">
            <div class="form-group">
              <label class="form-label">${isEn ? 'Salary months per year (First tier)' : 'عدد أشهر الراتب لكل سنة (المرحلة الأولى)'}</label>
              <input type="number" step="0.1" min="0" class="form-input" name="eosbTier1RateMonths" value="${settings.eosbTier1RateMonths !== undefined ? settings.eosbTier1RateMonths : 0.5}" required title="${isEn ? 'Salary months due for each service year in the first tier' : 'عدد أشهر الراتب المستحقة عن كل سنة خدمة في المرحلة الأولى'}">
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'First tier end limit (years)' : 'حد نهاية المرحلة الأولى (سنوات)'}</label>
              <input type="number" step="0.5" min="0" class="form-input" name="eosbTier1Years" value="${settings.eosbTier1Years !== undefined ? settings.eosbTier1Years : 5}" required title="${isEn ? 'When these years expire, calculation moves to the next tier' : 'عند انتهاء هذه السنوات ينتقل الاحتساب للمرحلة اللاحقة'}">
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'Salary months per year (Next tier)' : 'أشهر الراتب لكل سنة (المرحلة اللاحقة)'}</label>
              <input type="number" step="0.1" min="0" class="form-input" name="eosbTier2RateMonths" value="${settings.eosbTier2RateMonths !== undefined ? settings.eosbTier2RateMonths : 1}" required title="${isEn ? 'Salary months due for each service year after the first tier' : 'عدد أشهر الراتب المستحقة عن كل سنة خدمة بعد المرحلة الأولى'}">
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'Years to qualify for resignation benefit' : 'عدد سنوات بدء استحقاق الاستقالة'}</label>
              <input type="number" step="0.5" class="form-input" name="eosbMinYearsForResignation" value="${settings.eosbMinYearsForResignation !== undefined ? settings.eosbMinYearsForResignation : 2}" required title="${isEn ? 'Minimum service period after which an employee is entitled to a benefit on resignation' : 'أقل مدة خدمة يستحق بعدها الموظف مكافأة عند الاستقالة'}">
            </div>
          </div>

            <div class="grid grid-cols-3" style="margin-top:10px;">
            <div class="form-group">
              <label class="form-label">${isEn ? 'Resignation rate (less than' : 'نسبة الاستقالة (أقل من'} ${settings.eosbTier1Years !== undefined ? settings.eosbTier1Years : 5} ${isEn ? 'years) %' : 'سنوات) %'}</label>
              <input type="number" step="0.01" min="0" max="100" class="form-input" name="eosbResignationTier1Pct" value="${settings.eosbResignationTier1Pct !== undefined ? settings.eosbResignationTier1Pct : 33.33}" required>
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'Resignation rate (from' : 'نسبة الاستقالة (من'} ${settings.eosbTier1Years !== undefined ? settings.eosbTier1Years : 5} ${isEn ? 'to' : 'إلى'} ${(settings.eosbTier1Years !== undefined ? settings.eosbTier1Years : 5) * 2} ${isEn ? 'years) %' : 'سنوات) %'}</label>
              <input type="number" step="0.01" min="0" max="100" class="form-input" name="eosbResignationTier2Pct" value="${settings.eosbResignationTier2Pct !== undefined ? settings.eosbResignationTier2Pct : 66.66}" required>
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'Resignation rate (' : 'نسبة الاستقالة ('}${(settings.eosbTier1Years !== undefined ? settings.eosbTier1Years : 5) * 2} ${isEn ? 'years or more) %' : 'سنوات فأكثر) %'}</label>
              <input type="number" step="0.01" min="0" max="100" class="form-input" name="eosbResignationTier3Pct" value="${settings.eosbResignationTier3Pct !== undefined ? settings.eosbResignationTier3Pct : 100}" required>
            </div>
          </div>

          <div class="grid grid-cols-2" style="margin-top:10px;">
            <div class="form-group">
              <label class="form-label">${isEn ? 'Company termination rate (%)' : 'نسبة إنهاء الخدمة من طرف المنشأة (%)'}</label>
              <input type="number" step="0.01" class="form-input" name="eosbCompanyTerminationPct" value="${settings.eosbCompanyTerminationPct !== undefined ? settings.eosbCompanyTerminationPct : 100}" required>
            </div>

            <div class="form-group" style="display:flex; align-items:center; gap:10px; margin-top:24px;">
              <label style="display:flex; align-items:center; gap:10px; cursor:pointer; font-weight:700; color:var(--text-main);">
                <input type="checkbox" name="eosbAutoIncludeFinalMonthSalary" ${settings.eosbAutoIncludeFinalMonthSalary !== false ? 'checked' : ''} style="width:18px; height:18px;">
                <span>${isEn ? 'Automatically include the final month actual working days in the settlement' : 'احتساب أجر أيام العمل الفعلية للشهر الأخير تلقائياً في التصفية'}</span>
              </label>
            </div>
          </div>
        </div>

        <!-- Biometric Device & Attendance Policy Card (Requested Feature) -->
        <div class="card" style="grid-column: span 2; border:1px solid rgba(79, 70, 229, 0.3); background:linear-gradient(135deg, rgba(79, 70, 229, 0.02) 0%, rgba(6, 182, 212, 0.02) 100%);">
          <div class="card-header">
            <div class="card-title" style="display:flex; align-items:center; gap:8px;">
              ${Icons.clock(20)} ${isEn ? 'Biometric Devices & Auto Attendance Pattern (Biometric Integration)' : 'ربط أجهزة البصمة ونمط الحضور التلقائي'}
            </div>
            <span class="badge badge-primary">TCP/IP & Cloud API</span>
          </div>

          <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:16px;">
            ${isEn ? 'These settings allow direct integration with biometric devices (ZKTeco / Hikvision / Suprema) to pull movements automatically, or enable the automatic monthly working-day calculation while respecting the configured weekly days off.' : 'تتيح لك هذه الإعدادات الربط المباشر مع أجهزة البصمة (ZKTeco / Hikvision / Suprema) لسحب الحركات آلياً، أو تفعيل نمط الاحتساب التلقائي لأيام العمل الشهرية مع مراعاة أيام العطلة الأسبوعية المحددة بالمنشأة.'}
          </div>

          <div class="grid grid-cols-4">
            <div class="form-group">
              <label class="form-label">${isEn ? 'Biometric Device IP Address' : 'عنوان IP لجهاز البصمة'}</label>
              <input type="text" class="form-input" name="biometricIp" id="bio-ip-input" value="${settings.biometricIp || '192.168.1.201'}" placeholder="e.g. 192.168.1.201">
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'Port' : 'المنفذ'}</label>
              <input type="number" class="form-input" name="biometricPort" id="bio-port-input" value="${settings.biometricPort || 4370}">
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'Device Username' : 'اسم مستخدم الجهاز'}</label>
              <input type="text" class="form-input" name="biometricUser" id="bio-user-input" value="${settings.biometricUser || 'admin'}">
            </div>

            <div class="form-group">
              <label class="form-label">${isEn ? 'Device Password' : 'كلمة مرور جهاز البصمة'}</label>
              <input type="password" class="form-input" name="biometricPass" id="bio-pass-input" value="${settings.biometricPass || ''}" placeholder="••••••">
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-top:8px; padding-top:12px; border-top:1px solid var(--border-color);">
            <div style="display:flex; align-items:center; gap:8px;">
              <button type="button" class="btn btn-sm btn-outline" id="btn-test-biometric">
                ${Icons.refresh(14)} ${isEn ? 'Test Biometric Connection' : 'فحص الاتصال بجهاز البصمة'}
              </button>
              <button type="button" class="btn btn-sm btn-success" id="btn-sync-biometric">
                ${Icons.download(14)} ${isEn ? 'Pull & Sync Movements Now' : 'سحب ومزامنة الحركات الآن'}
              </button>
            </div>

            <div style="font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px;">
              <span style="width:8px; height:8px; border-radius:50%; background:var(--success); display:inline-block;"></span>
              <span>${isEn ? 'Auto working mode: monthly working days calculated per the weekly days off above' : 'نمط العمل التلقائي: احتساب أيام العمل شهرياً وفق أيام العطلة الأسبوعية المحددة أعلاه'}</span>
            </div>
          </div>
        </div>

      </div>
    </form>

    <!-- HTTP Access Token Card -->
    <div class="card" style="border-color:rgba(79, 70, 229, 0.3); margin-top:20px;">
      <div class="card-header">
        <div class="card-title">
          <span style="color:#4f46e5;">🔐</span> ${isEn ? 'HTTP Access Token (Server Protection)' : 'رمز الوصول (حماية الخادم)'}
        </div>
      </div>

      <div style="max-width:640px;">
        <div style="font-weight:600; font-size:13.5px; color:var(--text-main);" id="access-token-status">-</div>
        <p style="font-size:12.5px; color:var(--text-muted); margin-top:4px;">
          ${isEn
            ? 'This token guards the whole server: nobody can open the program, read data or download backups from the cloud/LAN link without it. It is entered ONCE per device and exchanged for a 12-hour session, so employees do not repeat it during the day; the master token is never stored in the browser.'
            : 'هذا الرمز يحمي الخادم بالكامل: لا أحد يستطيع فتح البرنامج أو قراءة البيانات أو تحميل النسخ الاحتياطية من الرابط السحابي أو الشبكة بدون معرفته. يُدخل مرة واحدة لكل جهاز ثم يتحول إلى جلسة سريعة المفعول تدوم 12 ساعة، فلا يكرره الموظفون خلال اليوم — والرمز الأصلي لا يُحفظ في المتصفح أبدًا.'}
        </p>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:14px;">
          <input type="password" id="access-token-current" autocomplete="off"
            placeholder="${isEn ? 'Current token (needed to change / disable)' : 'الرمز الحالي (مطلوب للتغيير أو الإيقاف)'}"
            style="flex:1; min-width:220px; padding:10px 12px; font-size:13.5px; border:1.5px solid var(--border-color); border-radius:10px; background:var(--bg-input); color:var(--text-main); outline:none; direction:ltr; text-align:left;">
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
          <input type="text" id="access-token-input" autocomplete="off"
            placeholder="${isEn ? 'New token (minimum 8 characters)' : 'رمز جديد (8 أحرف على الأقل)'}"
            style="flex:1; min-width:220px; padding:10px 12px; font-size:13.5px; border:1.5px solid var(--border-color); border-radius:10px; background:var(--bg-input); color:var(--text-main); outline:none;">
        </div>
        <div style="display:flex; gap:10px; margin-top:10px;">
          <button type="button" class="btn btn-primary" id="btn-save-access-token">${isEn ? 'Set Token' : 'تثبيت الرمز'}</button>
          <button type="button" class="btn btn-outline" id="btn-clear-access-token" style="color:var(--danger); border-color:rgba(239,68,68,0.3);">${isEn ? 'Disable Protection' : 'إيقاف الحماية'}</button>
        </div>
        <div style="font-size:11.5px; color:var(--text-muted); margin-top:8px;">
          ${isEn ? 'Pick a long random passphrase (letters + numbers + symbols). Changing the token instantly locks every device.' : 'اختر عبارة طويلة عشوائية (أحرف وأرقام ورموز). تغيير الرمز يقفل جميع الأجهزة فورًا.'}
        </div>
      </div>
    </div>

    <!-- Backup, Data Clearing & Maintenance Card -->
    <div class="card" style="border-color:rgba(239, 68, 68, 0.25);">
      <div class="card-header">
        <div class="card-title">
          <span style="color:var(--danger);">${Icons.refresh(20)}</span> ${t('backupMaintenanceCard')}
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
        <div style="max-width:600px;">
          <div style="font-weight:700; font-size:14px; color:var(--text-main);">${isEn ? 'Data Management & Clearing' : 'إدارة وتفريغ البيانات'}</div>
          <div style="font-size:12.5px; color:var(--text-muted); line-height:1.6; margin-top:2px;">
            ${isEn ? 'Save a backup of all your entries, or clear all employee & transaction records to start fresh.' : 'يمكنك حفظ نسخة احتياطية من كافة مدخلاتك، أو تفريغ كافة سجلات الموظفين والعمليات للبدء من جديد.'}
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <input type="file" id="backup-file-input" accept=".json" style="display:none;">
          
          <button type="button" class="btn btn-outline" id="btn-trigger-import">
            ${Icons.upload(16)} ${t('importBackupBtn')}
          </button>

          <button type="button" class="btn btn-danger" id="btn-clear-all-data">
            ${Icons.trash(16)} ${t('clearAllDataBtn')}
          </button>
        </div>
      </div>
    </div>
  `;

  // Currency Preset Listener
  const currencyPreset = container.querySelector('#currency-preset-select');
  const currencyCodeInput = container.querySelector('#currency-code-input');
  const currencySymbolInput = container.querySelector('#currency-symbol-input');

  currencyPreset?.addEventListener('change', (e) => {
    const [code, symbol] = e.target.value.split('|');
    if (currencyCodeInput) currencyCodeInput.value = code;
    if (currencySymbolInput) currencySymbolInput.value = symbol;
  });

  // Custom currencies: render list
  function renderCustomCurrencies() {
    const listEl = container.querySelector('#custom-currencies-list');
    if (!listEl) return;
    if (customCurrArr.length === 0) {
      listEl.innerHTML = `<div style="font-size:12.5px; color:var(--text-muted); padding:8px 0;">${isEn ? 'No custom currencies added yet.' : 'لم تتم إضافة أي عملات مخصصة بعد.'}</div>`;
      return;
    }
    listEl.innerHTML = customCurrArr
      .map(
        (c, i) => `
      <div style="display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--border-color); border-radius:8px; margin-bottom:6px; background:var(--bg-card);">
        <span class="badge badge-primary">${c.code || '?'}</span>
        <strong style="min-width:64px; font-size:14px;">${c.symbol || '?'}</strong>
        <span style="flex:1;">${isEn ? (c.nameEn || c.nameAr || '') : (c.nameAr || c.nameEn || '')}</span>
        <button type="button" class="btn btn-icon btn-sm btn-outline btn-del-custom-curr" data-index="${i}" title="${isEn ? 'Remove currency' : 'حذف العملة'}" style="color:var(--danger);">${Icons.trash(14)}</button>
      </div>`
      )
      .join('');
    listEl.querySelectorAll('.btn-del-custom-curr').forEach((btn) => {
      btn.addEventListener('click', () => {
        customCurrArr.splice(Number(btn.getAttribute('data-index')), 1);
        renderCustomCurrencies();
      });
    });
  }
  renderCustomCurrencies();

  // Custom currencies: add new
  container.querySelector('#btn-add-custom-curr')?.addEventListener('click', () => {
    const code = (container.querySelector('#cust-cur-code')?.value || '').trim().toUpperCase();
    const symbol = (container.querySelector('#cust-cur-symbol')?.value || '').trim();
    const nameAr = (container.querySelector('#cust-cur-name-ar')?.value || '').trim();
    const nameEn = (container.querySelector('#cust-cur-name-en')?.value || '').trim();
    if (!code || !symbol) {
      return toast.error(isEn ? 'Currency code and symbol are required' : 'كود العملة ورمزها مطلوبان');
    }
    if (customCurrArr.some((c) => c.code === code)) {
      return toast.error(isEn ? 'This currency code was already added' : 'كود العملة هذا مضاف مسبقاً');
    }
    customCurrArr.push({ code, symbol, nameAr, nameEn });
    ['#cust-cur-code', '#cust-cur-symbol', '#cust-cur-name-ar', '#cust-cur-name-en'].forEach((s) => {
      const el = container.querySelector(s);
      if (el) el.value = '';
    });
    renderCustomCurrencies();
  });

  // P4 Exchange Rates: render + manage (Super Admin only)
  const exchangeRatesListEl = container.querySelector('#exchange-rates-list');
  const rateCurrencySel = container.querySelector('#p4-rate-currency');
  const rateCurrencyLabel = container.querySelector('#p4-rate-currency-label');
  const baseCurrencySel = container.querySelector('select[name="baseCurrency"]');

  const p4CurrentBase = () => (baseCurrencySel?.value || '') || settings.baseCurrency || settings.currency || 'USD';

  function p4RateOptions() {
    if (!rateCurrencySel) return;
    const base = p4CurrentBase();
    const known = allCurrencies.filter((c) => c.code !== base);
    const current = rateCurrencySel.value;
    rateCurrencySel.innerHTML = known
      .map(
        (c) => `
        <option value="${c.code}" ${(current === '' ? (c.code === 'USD' ? 'selected' : '') : current === c.code) ? 'selected' : ''}>
          ${isEn ? (c.nameEn || c.nameAr) : c.nameAr} (${c.code})
        </option>`
      )
      .join('');
  }

  function p4ActiveRate(code) {
    const base = p4CurrentBase();
    const suited = storage.getExchangeRates()
      .filter((r) => r.currency === code && r.baseCurrency === base)
      .sort((a, b) => String(b.rateDate || '').localeCompare(String(a.rateDate || '')));
    return suited[0] || null;
  }

  function renderExchangeRates() {
    if (!exchangeRatesListEl) return;
    const base = p4CurrentBase();
    const entries = storage.getExchangeRates().filter((r) => r.baseCurrency === base);
    if (!entries.length) {
      exchangeRatesListEl.innerHTML = `<div style="font-size:12.5px; color:var(--text-muted); padding:8px 0;">${isEn ? 'No exchange rates set for the current base currency yet.' : 'لا توجد أسعار صرف محددة للعملة الأساسية الحالية بعد.'}</div>`;
      return;
    }
    exchangeRatesListEl.innerHTML = entries
      .map(
        (r) => `
      <div style="display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--border-color); border-radius:8px; margin-bottom:6px; background:var(--bg-card);">
        <span class="badge badge-primary">${r.currency}</span>
        <strong style="min-width:130px; font-size:14px; direction:ltr;">1 ${r.currency} = ${r.rate} ${base}</strong>
        <span style="color:var(--text-muted); font-size:12px;">${isEn ? 'on' : 'بتاريخ'} ${r.rateDate || '—'}</span>
        <span style="flex:1; font-size:12px; color:var(--text-muted);">${r.note || ''}</span>
        ${r.locked
          ? `<span class="badge badge-warning" title="${isEn ? 'Referenced by a committed financial record — immutable' : 'مثبت بسجل مالي مؤكد — غير قابل للتعديل'}">🔒 ${isEn ? 'Pinned' : 'مثبّت'}</span>`
          : `<span class="badge badge-success">${isEn ? 'Editable' : 'قابل للتعديل'}</span>`}
        ${r.history && r.history.length
          ? `<span class="badge badge-gray" title="${r.history.map((h) => `${h.from} → ${h.to} (${h.by || ''})${h.reason ? ' · ' + h.reason : ''}`).join(' | ')}" style="cursor:help;">${r.history.length} ${isEn ? 'edit(s)' : 'تعديل'}</span>`
          : ''}
      </div>`
      )
      .join('');
  }

  baseCurrencySel?.addEventListener('change', () => {
    p4RateOptions();
    renderExchangeRates();
  });

  container.querySelector('#btn-save-ex-rate')?.addEventListener('click', () => {
    const code = rateCurrencySel?.value;
    const rate = Number(container.querySelector('#p4-rate-value')?.value);
    const rateDate = (container.querySelector('#p4-rate-date')?.value || '').trim();
    const note = (container.querySelector('#p4-rate-note')?.value || '').trim();
    if (!code) return toast.error(isEn ? 'Select a currency' : 'اختر العملة');
    if (!Number.isFinite(rate) || rate <= 0) return toast.error(isEn ? 'Rate must be a positive number' : 'يجب أن يكون سعر الصرف رقماً موجباً');
    if (!rateDate) return toast.error(isEn ? 'Rate date is required' : 'تاريخ سعر الصرف مطلوب');
    const active = p4ActiveRate(code);
    const res = storage.setExchangeRate({
      user: storage.getActiveUser(),
      currency: code,
      rate,
      rateDate,
      note,
      ...(active && active.locked ? { newRate: true } : {}),
    });
    if (!res.ok) {
      const msg = res.message || res.error;
      return toast.error(isEn ? msg : msg);
    }
    ['#p4-rate-value', '#p4-rate-note'].forEach((s) => {
      const el = container.querySelector(s);
      if (el) el.value = '';
    });
    if (container.querySelector('#p4-rate-date')) container.querySelector('#p4-rate-date').value = '';
    renderExchangeRates();
    toast.success(isEn ? 'Exchange rate saved — it will be pinned on new records' : 'تم حفظ سعر الصرف — وسيُثبّت على السجلات الجديدة');
  });

  if (rateCurrencyLabel) rateCurrencyLabel.textContent = p4CurrentBase();
  p4RateOptions();
  renderExchangeRates();

  // Save Settings
  container.querySelector('#btn-save-settings')?.addEventListener('click', () => {
    if (!can(storage.getActiveUser(), 'settings.manage')) { // RBAC gate (C-5)
      toast.error(isEn ? 'Insufficient permissions' : 'لا تملك صلاحية تعديل الإعدادات');
      return;
    }
    const form = container.querySelector('#settings-form');
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const formData = new FormData(form);
    // Read checked weekly off days (0=Sunday ... 6=Saturday), keep the old
    // Friday-only flag harmless by mapping it. Defaults: Saturday & Sunday.
    const checkedDays = Array.from(formData.getAll('weekendDay')).map(Number).filter((n) => n >= 0 && n <= 6);
    const weekendDays = checkedDays.length ? checkedDays : [6, 0];
    // Start from the LATEST stored settings (P4 exchange rates are saved
    // immediately, so a stale closure copy must never clobber them).
    const fresh = storage.getState().settings || settings;
    const updatedSettings = {
      ...fresh,
      companyName: formData.get('companyName'),
      companyNameEn: formData.get('companyNameEn'),
      companyPhone: formData.get('companyPhone'),
      companyWhatsApp: formData.get('companyWhatsApp'),
      companyEmail: formData.get('companyEmail'),
      commercialRegistration: formData.get('commercialRegistration'),
      taxNumber: formData.get('taxNumber'),
      currency: formData.get('currency'),
      currencySymbol: formData.get('currencySymbol'),
      customCurrencies: customCurrArr,
      workingDaysPerMonth: Number(formData.get('workingDaysPerMonth')) || 30,
      workingHoursPerDay: Number(formData.get('workingHoursPerDay')) || 8,
      dailyRateMethod: formData.get('dailyRateMethod') || '',
      defaultAnnualLeaveDays: Number(formData.get('defaultAnnualLeaveDays')) || 30,
      maxCarryOverDays: Number(formData.get('maxCarryOverDays')) || 15,
      defaultHourlyLeaveQuota: Number(formData.get('defaultHourlyLeaveQuota')) || 4,
      weekendDays,
      eosbAutoIncludeFinalMonthSalary: formData.get('eosbAutoIncludeFinalMonthSalary') === 'on',
      socialInsuranceEmployeePercent: Number(formData.get('socialInsuranceEmployeePercent')) || 0,
      socialInsuranceCompanyPercent: Number(formData.get('socialInsuranceCompanyPercent')) || 0,
      overtimeRegularRate: Number(formData.get('overtimeRegularRate')) || 1.5,
      overtimeHolidayRate: Number(formData.get('overtimeHolidayRate')) || 2.0,
      eosbTier1RateMonths: Number(formData.get('eosbTier1RateMonths')) || 0.5,
      eosbTier1Years: Number(formData.get('eosbTier1Years')) || 5,
      eosbTier2RateMonths: Number(formData.get('eosbTier2RateMonths')) || 1,
      eosbMinYearsForResignation: Number(formData.get('eosbMinYearsForResignation')) || 2,
      eosbResignationTier1Pct: Number(formData.get('eosbResignationTier1Pct')) || 33.33,
      eosbResignationTier2Pct: Number(formData.get('eosbResignationTier2Pct')) || 66.66,
      eosbResignationTier3Pct: Number(formData.get('eosbResignationTier3Pct')) || 100,
      eosbCompanyTerminationPct: Number(formData.get('eosbCompanyTerminationPct')) || 100,
      biometricIp: formData.get('biometricIp'),
      biometricPort: Number(formData.get('biometricPort')) || 4370,
      biometricUser: formData.get('biometricUser'),
      biometricPass: formData.get('biometricPass'),
      // P2.2 payroll lock may only be changed by a Super Admin. Non-super-admin
      // saves simply preserve the current value.
      ...(isSuperAdmin ? { payrollViewEnabled: formData.get('payrollViewEnabled') === 'on' } : {}),
      // P4 base currency may only be changed by a Super Admin; it affects NEW
      // records only (historical baseAmount is never rewritten).
      ...(isSuperAdmin ? { baseCurrency: formData.get('baseCurrency') || fresh.baseCurrency || fresh.currency || 'USD' } : {}),
    };

    storage.saveSettings(updatedSettings);
    toast.success(isEn ? 'System, currency and biometric settings saved successfully' : 'تم حفظ وتثبيت إعدادات النظام والعملة والبصمة بنجاح');
  });

  // Test Biometric Connection
  container.querySelector('#btn-test-biometric')?.addEventListener('click', async () => {
    const ip = container.querySelector('#bio-ip-input')?.value;
    const port = container.querySelector('#bio-port-input')?.value;
    const user = container.querySelector('#bio-user-input')?.value;
    const pass = container.querySelector('#bio-pass-input')?.value;

    toast.info(isEn ? 'Connecting to biometric device...' : 'جاري الاتصال بجهاز البصمة...');
    const res = await testBiometricConnection({ ipAddress: ip, port, username: user, password: pass });
    if (res.success) {
      toast.success(res.message);
    } else {
      toast.error(res.message);
    }
  });

  // Sync Biometric Logs
  container.querySelector('#btn-sync-biometric')?.addEventListener('click', async () => {
    const ip = container.querySelector('#bio-ip-input')?.value;
    const port = container.querySelector('#bio-port-input')?.value;
    const employees = storage.getState().employees;

    if (employees.length === 0) {
      toast.error(t('att.noEmployeesToSync'));
      return;
    }

    toast.info(isEn ? 'Pulling attendance movements from biometric device...' : 'جاري سحب حركات الحضور من جهاز البصمة...');
    const res = await syncBiometricLogs({ ipAddress: ip, port }, employees);
    if (res.success) {
      toast.success(res.message);
    } else {
      toast.error(res.message);
    }
  });

  // Export Backup JSON
  container.querySelector('#btn-export-backup')?.addEventListener('click', async () => {
    const ok = await storage.exportBackupJSON();
    if (ok) {
      toast.success(isEn ? 'Backup downloaded successfully' : 'تم تحميل النسخة الاحتياطية بنجاح');
    } else {
      toast.error(isEn ? 'Failed to download backup' : 'تعذر تحميل النسخة الاحتياطية');
    }
  });

  // Import Backup JSON
  const fileInput = container.querySelector('#backup-file-input');
  container.querySelector('#btn-trigger-import')?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const res = await storage.importBackupJSON(event.target.result);
      if (res.success) {
        toast.success(isEn ? 'Backup restored successfully!' : 'تمت استعادة النسخة الاحتياطية بنجاح!');
        renderSettingsView(container);
      } else {
        toast.error(isEn ? `Failed to restore backup: ${res.error}` : `فشل استعادة النسخة: ${res.error}`);
      }
    };
    reader.readAsText(file);
  });

  // Access Token management (server gate)
  const saveTokenBtn = container.querySelector('#btn-save-access-token');
  const clearTokenBtn = container.querySelector('#btn-clear-access-token');
  const refreshTokenState = async () => {
    try {
      const res = await fetch('/api/status', { method: 'HEAD' });
      const enabled = res.status === 401;
      const statusEl = container.querySelector('#access-token-status');
      if (statusEl) {
        statusEl.textContent = enabled
          ? (isEn ? 'Protection is ON — a token is required.' : 'الحماية مفعّلة — رمز الوصول مطلوب.')
          : (isEn ? 'Protection is OFF — anyone with the link can open the data.' : 'الحماية معطّلة — أي شخص يملك الرابط يفتح البيانات.');
        statusEl.style.color = enabled ? 'var(--success)' : 'var(--danger)';
      }
    } catch (e) {}
  };

  const getCurrentMaster = () => (container.querySelector('#access-token-current')?.value || '').trim();

  const submitAccessToken = async (token, currentToken) => {
    const headers = { 'Content-Type': 'application/json' };
    if (currentToken) headers['X-Access-Token'] = currentToken;
    const sess = storage.getUserSessionToken();
    if (sess) headers['X-Session-Token'] = sess;
    const res = await fetch('/api/access-token', {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: token || '' }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      const cur = container.querySelector('#access-token-current');
      if (cur) cur.value = '';
      toast.success(isEn ? 'Access token updated!' : 'تم تحديث رمز الوصول بنجاح!');
      refreshTokenState();
    } else if (res.status === 401) {
      toast.error(isEn ? 'Enter the correct current token to change or disable protection.' : 'أدخل الرمز الحالي الصحيح لتغيير الحماية أو إيقافها.');
    } else {
      toast.error(isEn ? `Failed: ${data.error || 'Unknown error'}` : `فشل التحديث: ${data.error || 'خطأ غير معروف'}`);
    }
  };

  saveTokenBtn?.addEventListener('click', async () => {
    const input = container.querySelector('#access-token-input');
    const value = (input?.value || '').trim();
    if (!value) {
      toast.error(isEn ? 'Enter a new token (at least 8 characters)' : 'أدخل رمزًا جديدًا (8 أحرف على الأقل)');
      return;
    }
    await submitAccessToken(value, getCurrentMaster());
    if (input) input.value = '';
  });

  clearTokenBtn?.addEventListener('click', async () => {
    showConfirmDialog({
      title: isEn ? 'Disable Access Token?' : 'إيقاف رمز الوصول؟',
      message: isEn
        ? 'The server gate will be turned OFF. Anyone who reaches the link can read all data directly.'
        : 'سيتم إيقاف حماية الخادم. أي شخص يصل للرابط يستطيع قراءة كل البيانات مباشرة.',
      confirmText: isEn ? 'Disable' : 'إيقاف',
      onConfirm: async () => {
        await submitAccessToken('', getCurrentMaster());
      },
    });
  });

  refreshTokenState();

  // Clear All Data
  container.querySelector('#btn-clear-all-data')?.addEventListener('click', () => {
    showConfirmDialog({
      title: isEn ? 'Clear All Data (Clean Slate)' : 'تفريغ كافة البيانات',
      message: isEn ? 'Are you sure you want to clear all employee & transaction records to start with a completely clean system?' : 'هل أنت متأكد من تفريغ كافة سجلات الموظفين والعمليات للبدء بنظام نظيف تماماً؟',
      confirmText: isEn ? 'Yes, clear all data' : 'نعم، تفريغ كافة البيانات',
      onConfirm: () => {
        storage.clearAllData();
        toast.success(isEn ? 'All data cleared successfully!' : 'تم تفريغ كافة البيانات بنجاح!');
        renderSettingsView(container);
      },
    });
  });
}
