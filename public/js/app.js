// ==========================================
// HRMS Master Application Coordinator (With Authentication)
// ==========================================

import { auth } from './auth.js';
import { storage } from './storage.js';
import { i18n, t } from './i18n.js';
import { Icons } from './icons.js';
import { USER_ROLES, can, isPayrollViewEnabled } from './types.js';

import { renderLoginView } from './components/LoginView.js';
import { renderDashboardView } from './components/DashboardView.js';
import { renderEmployeesView } from './components/EmployeesView.js';
import { renderLeavesView } from './components/LeavesView.js';
import { renderHourlyLeaveView } from './components/HourlyLeaveView.js';
import { renderAttendanceOvertimeView } from './components/AttendanceOvertimeView.js';
import { renderPayrollView } from './components/PayrollView.js';
import { renderEOSBView } from './components/EOSBView.js';
import { renderCompaniesView } from './components/CompaniesView.js';
import { renderUsersView } from './components/UsersView.js';
import { renderAuditView } from './components/AuditView.js';
import { renderReportsView } from './components/ReportsView.js';
import { renderSettingsView } from './components/SettingsView.js';
import { openDeletedRecordsModal } from './components/DeletedRecordsModal.js';
import { toast } from './components/Toast.js';

const ROUTE_PERMISSIONS = {
  dashboard: 'dashboard.view',
  employees: 'employees.view',
  leaves: 'leaves.view',
  'hourly-leaves': 'hourlyLeaves.view',
  attendance: 'attendance.view',
  payroll: 'payroll.view',
  eosb: 'eosb.view',
  companies: 'companies.view',
  users: 'users.view',
  audit: 'audit.view',
  reports: 'reports.view',
  settings: 'settings.view',
};

// Routes that are server-side super-only (server-authz READ/WRITE_GATES mark
// users/settings with superOnly: true). The client mirrors that: these pages
// may only be seen and opened by a super_admin, regardless of granular
// permission grants, so a non-super user never gets a broken 403 screen.
const SUPER_ONLY_ROUTES = new Set(['users', 'settings']);


class HRMSApp {
  constructor() {
    this.currentRoute = 'dashboard';
    this.appWrapper = document.getElementById('app-main-wrapper');
    this.loginWrapper = document.getElementById('app-login-wrapper');
    this.container = document.getElementById('view-content');
    this.sidebar = document.getElementById('app-sidebar');
    this.pageTitle = document.getElementById('page-title-text');
    this.pageSub = document.getElementById('page-sub-text');
    this.themeToggleBtn = document.getElementById('btn-theme-toggle');
    this.langToggleBtn = document.getElementById('btn-lang-toggle');
    this.logoutBtn = document.getElementById('btn-logout');
    this.restoreBtn = document.getElementById('btn-restore-records');
    this.sidebarToggleBtn = document.getElementById('btn-sidebar-toggle');
    this.companySelector = document.getElementById('topbar-company-select');
    this.branchSelector = document.getElementById('topbar-branch-select');

    this.gateOverlay = null;

    this.init();
  }

  /**
   * Full-screen server access gate. The server refuses every /api request
   * unless this token is present, so the rest of the app stays hidden
   * until the user unlocks it.
   */
  ensureGate() {
    if (this.gateOverlay || !document.getElementById('access-gate-overlay')) {
      return;
    }
    const isEn = i18n.getLang() === 'en';
    const overlay = document.createElement('div');
    overlay.id = 'access-gate-overlay';
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:99999; display:flex; align-items:center; justify-content:center;
      background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%);
      font-family:Segoe UI,Arial,sans-serif;
    `;
    overlay.innerHTML = `
      <div style="background:#fff; border-radius:16px; padding:36px 32px; width:min(92vw,420px); box-shadow:0 25px 60px rgba(0,0,0,.45); text-align:center;">
        <div style="font-size:34px; margin-bottom:6px;">🔐</div>
        <div style="font-size:20px; font-weight:800; color:#1e1b4b;">BenoSoft</div>
        <div style="font-size:13px; color:#64748b; margin-top:4px;">${isEn ? 'This system is protected by an access token' : 'هذا النظام محمي برمز وصول'}</div>
        <input id="gate-token-input" type="password" autocomplete="off"
          placeholder="${isEn ? 'Enter access token' : 'أدخل رمز الوصول'}"
          style="width:100%; margin-top:20px; padding:12px 14px; font-size:15px; border:1.5px solid #e2e8f0; border-radius:10px; outline:none; text-align:center; box-sizing:border-box;">
        <div id="gate-token-error" style="display:none; color:#dc2626; font-size:12.5px; margin-top:8px;">
          ${isEn ? 'Incorrect token. Please try again.' : 'رمز غير صحيح. حاول مرة أخرى.'}
        </div>
        <button id="gate-token-submit" type="button"
          style="width:100%; margin-top:16px; padding:12px; font-size:15px; font-weight:700; border:none; border-radius:10px; cursor:pointer; background:#4f46e5; color:#fff;">
          ${isEn ? 'Unlock' : 'فتح النظام'}
        </button>
      </div>
    `;
    document.body.appendChild(overlay);
    this.gateOverlay = overlay;

    const input = overlay.querySelector('#gate-token-input');
    const btn = overlay.querySelector('#gate-token-submit');
    const errBox = overlay.querySelector('#gate-token-error');

    const submit = async () => {
      const token = (input.value || '').trim();
      if (!token) return;
      btn.disabled = true;
      btn.textContent = isEn ? 'Checking...' : 'جاري التحقق...';
      errBox.style.display = 'none';
      const result = await storage.unlockWithToken(token);
      if (result && result.ok) {
        // The master token was exchanged for a session: remove the gate. If a
        // user was already signed in (e.g. a session expired mid-use) resume the
        // current view instead of forcing the login screen again.
        window.hrmsApp.hideGate();
        storage.startAutoSync();
        if (auth.isLoggedIn()) {
          window.hrmsApp.showApp();
          window.hrmsApp.navigateTo(window.hrmsApp.currentRoute);
        } else {
          window.hrmsApp.showLogin();
        }
      } else {
        errBox.textContent = result && result.rateLimited
          ? (isEn ? 'Too many attempts. Wait 15 minutes and try again.' : 'محاولات كثيرة جدًا. انتظر 15 دقيقة ثم حاول مجددًا.')
          : (isEn ? 'Incorrect token. Please try again.' : 'رمز غير صحيح. حاول مرة أخرى.');
        errBox.style.display = 'block';
        btn.disabled = false;
        btn.textContent = isEn ? 'Unlock' : 'فتح النظام';
        input.value = '';
        input.focus();
      }
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    setTimeout(() => input.focus(), 50);
  }

  hideGate() {
    if (this.gateOverlay) {
      this.gateOverlay.remove();
      this.gateOverlay = null;
    }
  }

  init() {
    // Check if user is logged in
    if (!auth.isLoggedIn()) {
      this.showLogin();
      return;
    }

    this.showApp();

    // Periodic background sync: every browser connected to the same server /
    // tunnel converges on identical data, so a save made on any device appears
    // in every other open session within seconds.
    storage.startAutoSync();

    // Apply saved language direction and translate legacy hard-coded labels
    // before the first view is rendered.
    i18n.setLang(i18n.getLang());

    // 1. Theme initialization
    const savedTheme = storage.getTheme();
    storage.setTheme(savedTheme);
    this.updateThemeButton(savedTheme);

    this.themeToggleBtn?.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      storage.setTheme(next);
      this.updateThemeButton(next);
    });

    // 2. Language Toggle
    this.updateLangButton();
    this.langToggleBtn?.addEventListener('click', () => {
      i18n.toggleLang();
      this.updateLangButton();
      this.updateStaticTexts();
      this.setupTopbarControls();
      this.updatePageHeader(this.currentRoute);
      this.renderCurrentView();
    });

    // 3. Logout handler
    this.logoutBtn?.addEventListener('click', () => {
      auth.logout();
    });

    // 3.5 Deletion Log & Recovery (super admin / developer only)
    this.restoreBtn?.addEventListener('click', () => {
      openDeletedRecordsModal();
    });

    // 4. Mobile Sidebar toggle
    this.sidebarToggleBtn?.addEventListener('click', () => {
      this.sidebar.classList.toggle('open');
    });

    // 5. Navigation Links
    document.querySelectorAll('.nav-item').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const route = link.getAttribute('data-route');
        if (route) {
          this.navigateTo(route);
          if (window.innerWidth <= 1024) {
            this.sidebar.classList.remove('open');
          }
        }
      });
    });

    // 6. Setup Topbar Company & User Controls
    this.setupTopbarControls();

    // 7. Reactive updates for sidebar badges & state
    storage.subscribe(() => {
      this.updateBadges();
      this.setupTopbarControls();
    });
    this.updateBadges();

    // 8. Render Initial Route
    this.updateStaticTexts();
    this.applyNavPermissionFilter();
    this.navigateTo('dashboard');
  }

  /**
   * Hide navigation entries the current user has no permission to open.
   */
  applyNavPermissionFilter() {
    const user = storage.getActiveUser();
    const payrollLocked = !isPayrollViewEnabled(storage.getState().settings) && user && user.role !== 'super_admin';
    document.querySelectorAll('.nav-item[data-route]').forEach((link) => {
      const route = link.getAttribute('data-route');
      const perm = ROUTE_PERMISSIONS[route];
      const hidden = (route === 'payroll' && payrollLocked)
        || (SUPER_ONLY_ROUTES.has(route) && (!user || user.role !== 'super_admin'))
        || (perm && !can(user, perm));
      link.style.display = hidden ? 'none' : '';
    });
  }

  showLogin() {
    if (this.appWrapper) this.appWrapper.style.display = 'none';
    if (this.loginWrapper) {
      this.loginWrapper.style.display = 'block';
      renderLoginView(this.loginWrapper, (user) => {
        window.location.reload();
      });
    }
  }

  showApp() {
    if (this.loginWrapper) this.loginWrapper.style.display = 'none';
    if (this.appWrapper) this.appWrapper.style.display = 'flex';
  }

  updateThemeButton(theme) {
    if (this.themeToggleBtn) {
      this.themeToggleBtn.innerHTML = theme === 'dark' ? Icons.sun(18) : Icons.moon(18);
      this.themeToggleBtn.title = theme === 'dark' ? t('lightMode') : t('darkMode');
    }
  }

  updateLangButton() {
    const lang = i18n.getLang();
    if (this.langToggleBtn) {
      this.langToggleBtn.innerHTML = lang === 'ar' ? `<span>🇺🇸 English</span>` : `<span>🇸🇦 العربية</span>`;
      this.langToggleBtn.title = lang === 'ar' ? 'Switch to English' : 'التحويل للغة العربية';
    }
  }

  updateStaticTexts() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
  }

  setupTopbarControls() {
    const currentUser = auth.getCurrentUser() || storage.getActiveUser();
    const state = storage.getState();
    const { companies, selectedCompanyId, selectedBranchId } = state;
    const isEn = i18n.getLang() === 'en';

    // Deletion log button: visible only to global super admins.
    if (this.restoreBtn) {
      this.restoreBtn.style.display = currentUser.role === 'super_admin' ? 'inline-flex' : 'none';
    }

    // Company Selector
    if (this.companySelector) {
      const isSuperAdmin = currentUser.role === 'super_admin';
      
      if (isSuperAdmin) {
        this.companySelector.disabled = false;
        this.companySelector.innerHTML = `
          <option value="all">${t('allCompanies')}</option>
          ${companies.map((c) => `<option value="${c.id}" ${c.id === selectedCompanyId ? 'selected' : ''}>${isEn && c.nameEn ? c.nameEn : c.nameAr}</option>`).join('')}
        `;
      } else {
        const assignedComp = companies.find((c) => c.id === currentUser.assignedCompanyId);
        this.companySelector.disabled = true;
        this.companySelector.innerHTML = `
          <option value="${currentUser.assignedCompanyId}">${assignedComp ? (isEn && assignedComp.nameEn ? assignedComp.nameEn : assignedComp.nameAr) : t('company')}</option>
        `;
      }

      this.companySelector.onchange = (e) => {
        storage.setSelectedCompanyId(e.target.value);
        this.setupTopbarControls();
        this.renderCurrentView();
      };
    }

    // Branch Selector
    if (this.branchSelector) {
      const isBranchHR = currentUser.role === 'branch_hr';
      const effectiveCompId = storage.getSelectedCompanyId();
      const currentComp = companies.find((c) => c.id === effectiveCompId);

      if (isBranchHR) {
        const assignedBranch = (currentComp?.branches || []).find((b) => b.id === currentUser.assignedBranchId);
        this.branchSelector.disabled = true;
        this.branchSelector.innerHTML = `
          <option value="${currentUser.assignedBranchId}">${assignedBranch ? (isEn && assignedBranch.nameEn ? assignedBranch.nameEn : assignedBranch.nameAr) : t('branch')}</option>
        `;
      } else if (currentComp) {
        this.branchSelector.disabled = false;
        this.branchSelector.innerHTML = `
          <option value="all">${t('allBranches')}</option>
          ${(currentComp.branches || []).map((b) => `<option value="${b.id}" ${b.id === selectedBranchId ? 'selected' : ''}>${isEn && b.nameEn ? b.nameEn : b.nameAr}</option>`).join('')}
        `;
      } else {
        this.branchSelector.disabled = true;
        this.branchSelector.innerHTML = `<option value="all">${t('allBranches')}</option>`;
      }

      this.branchSelector.onchange = (e) => {
        storage.setSelectedBranchId(e.target.value);
        this.renderCurrentView();
      };
    }

    // User Badge in sidebar footer and topbar
    const footerAvatar = document.getElementById('user-footer-avatar');
    const footerName = document.getElementById('user-footer-name');
    const footerRole = document.getElementById('user-footer-role');
    const topbarUserName = document.getElementById('topbar-user-name');

    const displayName = isEn ? (currentUser.nameEn || (currentUser.role === 'super_admin' ? 'General Manager' : currentUser.name)) : currentUser.name;
    const roleName = isEn ? (USER_ROLES[currentUser.role]?.nameEn || currentUser.role) : (USER_ROLES[currentUser.role]?.nameAr || currentUser.role);

    if (footerAvatar) footerAvatar.textContent = displayName.charAt(0);
    if (footerName) footerName.textContent = displayName;
    if (footerRole) footerRole.textContent = roleName;
    if (topbarUserName) topbarUserName.textContent = displayName;
  }

  updateBadges() {
    const state = storage.getState();
    const activeEmps = state.employees.filter((e) => e.status === 'active' || e.status === 'probation');
    const pendingLeaves = state.leaves.filter((l) => l.status === 'pending');
    const pendingOt = state.overtime.filter((o) => o.status === 'pending');

    const empBadge = document.getElementById('badge-nav-employees');
    const leaveBadge = document.getElementById('badge-nav-leaves');
    const otBadge = document.getElementById('badge-nav-attendance');

    if (empBadge) empBadge.textContent = activeEmps.length > 0 ? activeEmps.length : '';
    if (leaveBadge) leaveBadge.textContent = pendingLeaves.length > 0 ? pendingLeaves.length : '';
    if (otBadge) otBadge.textContent = pendingOt.length > 0 ? pendingOt.length : '';
  }

  renderCurrentView(options = {}) {
    this.navigateTo(this.currentRoute, options);
  }

  /**
   * Re-render the open screen when background sync pulled newer data, but only
   * when it is safe: no modal open and no form field focused (so in-progress
   * typing is never interrupted). Scroll position is preserved.
   */
  isSafeToRefresh() {
    if (document.querySelector('.modal-overlay')) return false;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return false;
    return true;
  }

  navigateTo(route, options = {}) {
    // Route guard: redirect to dashboard when the user lacks permission.
    const user = storage.getActiveUser();
    const required = ROUTE_PERMISSIONS[route];
    const superOnlyBlocked = SUPER_ONLY_ROUTES.has(route) && (!user || user.role !== 'super_admin');
    if (superOnlyBlocked || (required && !can(user, required))) {
      if (route !== 'dashboard') {
        toast.error(t('route.noAccess'));
        this.navigateTo('dashboard');
        return;
      }
    }

    // P2.2 payroll lock guard: when the Super Admin disabled payroll display,
    // only super_admins may open the payroll screen.
    if (route === 'payroll' && !isPayrollViewEnabled(storage.getState().settings)) {
      const user = storage.getActiveUser();
      if (user && user.role !== 'super_admin') {
        toast.error(t('route.noAccess'));
        this.navigateTo('dashboard');
        return;
      }
    }

    this.currentRoute = route;

    document.querySelectorAll('.nav-item').forEach((link) => {
      if (link.getAttribute('data-route') === route) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    const titles = {
      dashboard: { title: t('dashboard'), sub: t('appSubtitle') },
      employees: { title: t('employees'), sub: t('employeeDirectorySub') },
      leaves: { title: t('leaves'), sub: t('leavesManagementSub') },
      'hourly-leaves': { title: t('hourlyLeaves'), sub: t('hourlyLeavesReport') },
      attendance: { title: t('attendance'), sub: t('attendanceOvertimeSub') },
      payroll: { title: t('payroll'), sub: t('payrollSub') },
      eosb: { title: t('eosb'), sub: t('eosbSub') },
      companies: { title: t('companies'), sub: t('companiesSub') },
      users: { title: t('users'), sub: t('usersSub') },
      audit: { title: t('audit.title'), sub: t('audit.subtitle') },
      reports: { title: t('reports'), sub: t('reports') },
      settings: { title: t('settings'), sub: t('settingsSub') },
    };

    const info = titles[route] || { title: t('appTitle'), sub: '' };
    if (this.pageTitle) this.pageTitle.textContent = info.title;
    if (this.pageSub) this.pageSub.textContent = info.sub;

    if (!options.noScroll) window.scrollTo({ top: 0, behavior: 'smooth' });

    switch (route) {
      case 'dashboard':
        renderDashboardView(this.container, (r, opt) => this.navigateTo(r, opt));
        break;
      case 'employees':
        renderEmployeesView(this.container, options);
        break;
      case 'leaves':
        renderLeavesView(this.container, options);
        break;

      case 'attendance':
        renderAttendanceOvertimeView(this.container, options);
        break;
      case 'hourly-leaves':
        renderHourlyLeaveView(this.container, options);
        break;
      case 'payroll':
        renderPayrollView(this.container, options);
        break;
      case 'eosb':
        renderEOSBView(this.container, options);
        break;
      case 'companies':
        renderCompaniesView(this.container);
        break;
      case 'users':
        renderUsersView(this.container, { onNavigate: (r) => this.navigateTo(r) });
        break;
      case 'audit':
        renderAuditView(this.container);
        break;
      case 'reports':
        renderReportsView(this.container, options);
        break;
      case 'settings':
        renderSettingsView(this.container, options);
        break;
      default:
        renderDashboardView(this.container, (r, opt) => this.navigateTo(r, opt));
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Wait until the server-gate check finishes before rendering anything, so the
  // full-screen gate always covers the screen before any login/app UI shows.
  await storage.whenGateChecked;
  window.hrmsApp = new HRMSApp();
  if (storage.tokenRequired) {
    window.hrmsApp.ensureGate();
  }
  window.addEventListener('hrms:access-gate', (ev) => {
    if (ev.detail && ev.detail.required === true && window.hrmsApp) {
      window.hrmsApp.ensureGate();
    }
    if (ev.detail && ev.detail.required === false && window.hrmsApp) {
      window.hrmsApp.hideGate();
    }
  });

  window.addEventListener('hrms:sync', () => {
    if (!window.hrmsApp || !auth.isLoggedIn()) return;
    if (window.hrmsApp.isSafeToRefresh()) {
      window.hrmsApp.renderCurrentView({ noScroll: true });
    }
  });
});
