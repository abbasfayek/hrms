// =========================================================
// HRMS Storage Service (Clean Slate, Multi-Tenant RBAC & Server Sync)
// =========================================================

import {
  defaultCompanies,
  defaultUsers,
  defaultSettings,
  defaultEmployees,
  defaultLeaves,
  defaultOvertime,
  defaultLoans,
  defaultSalaryIncrements,
  defaultAttendance,
  defaultPayrollBatches,
  defaultEOSBCalculations,
  defaultCurrencies,
} from './seedData.js';
import { getEffectivePermissions, getAllCurrencies, resolveEmployeeCurrency } from './types.js';

const STORAGE_KEYS = {
  COMPANIES: 'hrms_companies_v3',
  USERS: 'hrms_users_v3',
  ACTIVE_USER_ID: 'hrms_active_user_id_v3',
  SELECTED_COMPANY_ID: 'hrms_selected_comp_id_v3',
  SELECTED_BRANCH_ID: 'hrms_selected_branch_id_v3',
  SETTINGS: 'hrms_settings_v3',
  EMPLOYEES: 'hrms_employees_v3',
  LEAVES: 'hrms_leaves_v3',
  HOURLY_LEAVES: 'hrms_hourly_leaves_v3',
  OVERTIME: 'hrms_overtime_v3',
  LOANS: 'hrms_loans_v3',
  INCREMENTS: 'hrms_increments_v3',
  ATTENDANCE: 'hrms_attendance_v3',
  HOLIDAYS: 'hrms_holidays_v3',
  PAYROLLS: 'hrms_payrolls_v3',
  EOSB: 'hrms_eosb_v3',
  THEME: 'hrms_theme_v3',
  AUDIT: 'hrms_audit_v3',
  DELETED_RECORDS: 'hrms_deleted_records_v3',
};

// Map storage keys to server collection names
const KEY_TO_COLLECTION = {
  [STORAGE_KEYS.COMPANIES]: 'companies',
  [STORAGE_KEYS.USERS]: 'users',
  [STORAGE_KEYS.SETTINGS]: 'settings',
  [STORAGE_KEYS.EMPLOYEES]: 'employees',
  [STORAGE_KEYS.LEAVES]: 'leaves',
  [STORAGE_KEYS.HOURLY_LEAVES]: 'hourly_leaves',
  [STORAGE_KEYS.OVERTIME]: 'overtime',
  [STORAGE_KEYS.LOANS]: 'loans',
  [STORAGE_KEYS.INCREMENTS]: 'increments',
  [STORAGE_KEYS.ATTENDANCE]: 'attendance',
  [STORAGE_KEYS.HOLIDAYS]: 'holidays',
  [STORAGE_KEYS.PAYROLLS]: 'payrolls',
  [STORAGE_KEYS.EOSB]: 'eosb',
  [STORAGE_KEYS.AUDIT]: 'audit',
  [STORAGE_KEYS.DELETED_RECORDS]: 'deleted_records',
};

const COLLECTION_TO_KEY = Object.fromEntries(
  Object.entries(KEY_TO_COLLECTION).map(([storageKey, collection]) => [collection, storageKey])
);

class StorageService {
  constructor() {
    this.listeners = new Set();
    this.serverSyncAvailable = true;
    this.tokenRequired = false;
    this.gateChecked = false;
    this._pendingWrites = new Set();
    this.whenGateChecked = new Promise((resolve) => { this._resolveGateCheck = resolve; });
    this.init();
  }

  // ==============================================
  // Server access gate: master token + short-lived sessions
  // ==============================================
  // The master token is NEVER stored in the browser. It is typed into the gate,
  // exchanged for a 12-hour session on the server, and then discarded. apiFetch
  // only ever carries the session token.
  getSessionToken() {
    try { return localStorage.getItem('hrms_gate_session') || ''; } catch (e) { return ''; }
  }

  setSessionToken(token) {
    try { localStorage.setItem('hrms_gate_session', token || ''); } catch (e) {}
  }

  clearSessionToken() {
    try { localStorage.removeItem('hrms_gate_session'); } catch (e) {}
  }

  getUserSessionToken() {
    try { return localStorage.getItem('hrms_user_session') || ''; } catch (e) { return ''; }
  }

  setUserSessionToken(token) {
    try { localStorage.setItem('hrms_user_session', token || ''); } catch (e) {}
  }

  clearUserSessionToken() {
    try { localStorage.removeItem('hrms_user_session'); } catch (e) {}
  }

  async apiFetch(url, options = {}) {
    const opts = { ...options };
    // Prefer the signed-in user session; fall back to the gate session.
    const userSession = this.getUserSessionToken();
    const gateSession = this.getSessionToken();
    const session = userSession || gateSession;
    if (session) {
      opts.headers = { ...(opts.headers || {}), 'X-Session-Token': session };
    }
    const res = await fetch(url, opts);
    // Safety net: a rejected request for a MASTER token re-raises the unlock
    // screen (master protection was enabled). A rejected request for USER login
    // is handled by a normal "please sign in" toast instead of the gate.
    if (res.status === 401) {
      res.clone().json()
        .then((j) => {
          if (j && j.code === 'access_token_required') {
            window.dispatchEvent(new CustomEvent('hrms:access-gate', { detail: { required: true } }));
          }
        })
        .catch(() => {});
    }
    return res;
  }

  // Returns true when the server demands a token at boot (probe without any
  // credentials — 401 means server protection is enabled).
  async checkAccessGate() {
    try {
      const res = await fetch('/api/status');
      return res.status === 401;
    } catch (e) {
      return false; // server not reachable → offline mode, no gate
    }
  }

  // Returns true when the stored session token is still accepted by the server.
  // This is what lets employees open the app again without retyping the master
  // token, for as long as their 12-hour session is alive.
  async checkStoredSession() {
    if (!this.getSessionToken()) return false;
    try {
      const res = await this.apiFetch('/api/status');
      return res.status === 200;
    } catch (e) {
      return false;
    }
  }

  async init() {
    // Gate is required only when the server is protected AND this browser has
    // no live session. First visit / expired session → gate; otherwise the app
    // opens straight away.
    const probe = await this.checkAccessGate();
    const sessionOk = probe ? await this.checkStoredSession() : false;
    this.tokenRequired = probe && !sessionOk;
    this.gateChecked = true;
    this._resolveGateCheck?.();
    if (this.tokenRequired) {
      window.dispatchEvent(new CustomEvent('hrms:access-gate', { detail: { required: true } }));
      return;
    }
    if (!localStorage.getItem(STORAGE_KEYS.COMPANIES)) {
      this.seedIfMissing();
    }
    // Attempt to sync from backend server files
    await this.syncFromServer();
  }

  // Initializes ONLY the storage keys that are missing, so a missing or
  // corrupted key can never destroy data that exists in the other keys.
  seedIfMissing() {
    const ensure = (key, def) => {
      if (this.get(key, null) === null) this.set(key, def);
    };
    ensure(STORAGE_KEYS.COMPANIES, defaultCompanies);
    ensure(STORAGE_KEYS.SETTINGS, { ...defaultSettings, defaultHourlyLeaveQuota: 4 });
    ensure(STORAGE_KEYS.EMPLOYEES, defaultEmployees);
    ensure(STORAGE_KEYS.LEAVES, defaultLeaves);
    ensure(STORAGE_KEYS.HOURLY_LEAVES, []);
    ensure(STORAGE_KEYS.OVERTIME, defaultOvertime);
    ensure(STORAGE_KEYS.LOANS, defaultLoans);
    ensure(STORAGE_KEYS.INCREMENTS, defaultSalaryIncrements);
    ensure(STORAGE_KEYS.ATTENDANCE, defaultAttendance);
    ensure(STORAGE_KEYS.HOLIDAYS, []);
    ensure(STORAGE_KEYS.PAYROLLS, defaultPayrollBatches);
    ensure(STORAGE_KEYS.EOSB, defaultEOSBCalculations);
    if ((this.get(STORAGE_KEYS.USERS, []) || []).length === 0) {
      this.set(STORAGE_KEYS.USERS, defaultUsers);
    }
    if (!this.get(STORAGE_KEYS.ACTIVE_USER_ID, null)) this.set(STORAGE_KEYS.ACTIVE_USER_ID, 'usr-admin');
    if (!this.get(STORAGE_KEYS.SELECTED_COMPANY_ID, null)) this.set(STORAGE_KEYS.SELECTED_COMPANY_ID, 'all');
    if (!this.get(STORAGE_KEYS.SELECTED_BRANCH_ID, null)) this.set(STORAGE_KEYS.SELECTED_BRANCH_ID, 'all');
    ensure(STORAGE_KEYS.DELETED_RECORDS, []);
    this.notify();
  }

  // Called by the gate overlay when the user enters the master token.
  // On success the master is exchanged for a session and all data re-syncs.
  async unlockWithToken(token) {
    let res;
    try {
      res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Token': String(token || '').trim() },
      });
    } catch (e) {
      return { ok: false, offline: true };
    }
    if (res.status === 429) return { ok: false, rateLimited: true };
    if (!res.ok) return { ok: false };
    const data = await res.json().catch(() => ({}));
    if (!data.session) return { ok: false };
    this.setSessionToken(data.session);
    this.tokenRequired = false;
    await this.syncFromServer();
    this.notify();
    window.dispatchEvent(new CustomEvent('hrms:access-gate', { detail: { required: false } }));
    return { ok: true };
  }

  // Server-side sign-in: verifies the username/password on the server (rate
  // limited), and on success stores a USER session that unlocks data access.
  async serverLogin(username, password) {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.status === 429) return { ok: false, rateLimited: true };
      if (res.status === 401) return { ok: false };
      if (!res.ok) return { ok: false };
      const data = await res.json().catch(() => ({}));
      if (!data.session) return { ok: false };
      this.setUserSessionToken(data.session);
      return { ok: true };
    } catch (e) {
      return { ok: false, offline: true }; // server unreachable → local check
    }
  }

  persistToServer(collection, value) {
    // Keep localStorage as an immediate offline copy and ask the local server
    // to persist the same change. keepalive lets the request complete when a
    // user closes or refreshes the browser directly after clicking Save.
    // POSTs are serialized through a promise chain so a later poll can safely
    // await them: a read can never observe the server in a state older than
    // everything this client already wrote.
    this._pendingWrites.add(collection);
    const req = () => this.apiFetch(`/api/data/${collection}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
      keepalive: true,
    });
    this._postChain = Promise.resolve(this._postChain)
      .then(req)
      .then(() => { this.serverSyncAvailable = true; })
      .catch(() => { this.serverSyncAvailable = false; })
      .finally(() => { this._pendingWrites.delete(collection); });
    return this._postChain;
  }

  async syncFromServer(options = {}) {
    const { pushWhenEmpty = true } = options;
    let changed = false;
    try {
      const promises = Object.entries(KEY_TO_COLLECTION).map(async ([storageKey, collection]) => {
        try {
          // Never read the server in a state older than what this client has
          // already written: wait for all of this client's queued POSTs first.
          await Promise.resolve(this._postChain);
          const res = await this.apiFetch(`/api/data/${collection}`);
          if (!res.ok) return;
          this.serverSyncAvailable = true;
          const serverData = await res.json();
          const localData = this.get(storageKey, null);

          // A local save to this collection is still in-flight to the server.
          // Applying the server's (possibly older) copy right now would clobber
          // the change the user just made; skip this collection this tick and
          // reconcile on the next poll once the pending write has landed.
          if (this._pendingWrites.has(collection)) return;

          // SERVER IS THE SOURCE OF TRUTH
          if (serverData !== null && serverData !== undefined) {
            // Server has real data (non-empty array or non-null object) → always use server
            const serverHasData = Array.isArray(serverData)
              ? serverData.length > 0
              : (typeof serverData === 'object' && Object.keys(serverData).length > 0);

            if (serverHasData) {
              // Server wins — load server data into localStorage (only when changed)
              const prev = localStorage.getItem(storageKey);
              const next = JSON.stringify(serverData);
              if (prev !== next) {
                localStorage.setItem(storageKey, next);
                changed = true;
              }
            } else if (pushWhenEmpty) {
              // Server file exists but is empty → push local data up to server if local has data
              if (localData !== null && localData !== undefined) {
                const localHasData = Array.isArray(localData)
                  ? localData.length > 0
                  : (typeof localData === 'object' && Object.keys(localData).length > 0);
                if (localHasData) {
                  this.persistToServer(collection, localData);
                }
              }
            }
          } else if (pushWhenEmpty) {
            // Server file doesn't exist yet → push local data to create it
            if (localData !== null && localData !== undefined) {
              this.persistToServer(collection, localData);
            }
          }
        } catch (e) {
          this.serverSyncAvailable = false;
        }
      });
      await Promise.all(promises);
      this.notify();
    } catch (e) {
      console.warn('Backend sync not reachable, using local storage.');
    }
    return changed;
  }

  /**
   * Periodic background sync so every browser connected to the same server
   * (e.g. via the same tunnel URL) converges on the SAME data: whatever one
   * user saves on any device appears in every other open session within a few
   * seconds. Polls only download (never push), skip while a modal form is open
   * or an input is focused so in-progress edits are never clobbered, and
   * dispatch an 'hrms:sync' event when the data actually changed so the open
   * view can re-render.
   */
  startAutoSync(intervalMs = 6000) {
    if (this._syncTimer) return;

    const canPoll = () => {
      if (document.visibilityState !== 'visible') return false;
      if (!(this.getUserSessionToken() || this.getSessionToken())) return false;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return false;
      if (document.querySelector('.modal-overlay')) return false;
      return true;
    };

    const tick = async () => {
      if (!canPoll()) return;
      try {
        const changed = await this.syncFromServer({ pushWhenEmpty: false });
        if (changed) {
          window.dispatchEvent(new CustomEvent('hrms:sync', { detail: { changed: true } }));
        }
      } catch (e) {
        // ignore transient poll failures; the next tick retries
      }
    };

    this._syncTimer = setInterval(tick, intervalMs);
    this._syncResume = () => tick();
    document.addEventListener('visibilitychange', this._syncResume);
    window.addEventListener('focus', this._syncResume);
  }

  stopAutoSync() {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
    if (this._syncResume) {
      document.removeEventListener('visibilitychange', this._syncResume);
      window.removeEventListener('focus', this._syncResume);
      this._syncResume = null;
    }
  }

  resetToDefaults() {
    this.set(STORAGE_KEYS.COMPANIES, defaultCompanies);
    const currentUsers = this.get(STORAGE_KEYS.USERS, []) || [];
    const protectedAccounts = (currentUsers.filter((u) => u && u.protected)) || [];
    this.saveUsers(protectedAccounts.concat(defaultUsers));
    this.set(STORAGE_KEYS.ACTIVE_USER_ID, 'usr-admin');
    this.set(STORAGE_KEYS.SELECTED_COMPANY_ID, 'all');
    this.set(STORAGE_KEYS.SELECTED_BRANCH_ID, 'all');
    this.set(STORAGE_KEYS.SETTINGS, {
      ...defaultSettings,
      defaultHourlyLeaveQuota: 4, // Default monthly hourly leave quota (hours/month)
    });
    this.set(STORAGE_KEYS.EMPLOYEES, defaultEmployees);
    this.set(STORAGE_KEYS.LEAVES, defaultLeaves);
    this.set(STORAGE_KEYS.HOURLY_LEAVES, []);
    this.set(STORAGE_KEYS.OVERTIME, defaultOvertime);
    this.set(STORAGE_KEYS.LOANS, defaultLoans);
    this.set(STORAGE_KEYS.INCREMENTS, defaultSalaryIncrements);
    this.set(STORAGE_KEYS.ATTENDANCE, defaultAttendance);
    this.set(STORAGE_KEYS.HOLIDAYS, []);
    this.set(STORAGE_KEYS.PAYROLLS, defaultPayrollBatches);
    this.set(STORAGE_KEYS.EOSB, defaultEOSBCalculations);
    this.notify();
  }

  clearAllData() {
    // Archive everything currently in the data collections so the deletion log
    // can still restore it, then wipe each collection.
    const collections = [
      [STORAGE_KEYS.EMPLOYEES, 'employees'],
      [STORAGE_KEYS.LEAVES, 'leaves'],
      [STORAGE_KEYS.HOURLY_LEAVES, 'hourly_leaves'],
      [STORAGE_KEYS.OVERTIME, 'overtime'],
      [STORAGE_KEYS.LOANS, 'loans'],
      [STORAGE_KEYS.INCREMENTS, 'increments'],
      [STORAGE_KEYS.ATTENDANCE, 'attendance'],
      [STORAGE_KEYS.HOLIDAYS, 'holidays'],
      [STORAGE_KEYS.PAYROLLS, 'payrolls'],
      [STORAGE_KEYS.EOSB, 'eosb'],
    ];
    const now = new Date().toISOString();
    const user = this.getActiveUser();
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
    const cleared = [];
    for (const [key, col] of collections) {
      const list = this.get(key, []);
      if (!Array.isArray(list) || !list.length) continue;
      cleared.push(...list.map((item) => ({
        id: `del-${stamp}-${Math.floor(Math.random() * 1000000)}`,
        collection: col,
        data: item,
        deletedAt: now,
        deletedBy: user ? (user.username || user.id) : 'system',
        deletedByName: user ? (user.name || user.username) : 'System',
        reason: 'cleared',
      })));
    }
    if (cleared.length) {
      this.set(STORAGE_KEYS.DELETED_RECORDS, cleared.concat(this.getDeletedRecords()).slice(0, 5000));
    }
    this.set(STORAGE_KEYS.EMPLOYEES, []);
    this.set(STORAGE_KEYS.LEAVES, []);
    this.set(STORAGE_KEYS.HOURLY_LEAVES, []);
    this.set(STORAGE_KEYS.OVERTIME, []);
    this.set(STORAGE_KEYS.LOANS, []);
    this.set(STORAGE_KEYS.INCREMENTS, []);
    this.set(STORAGE_KEYS.ATTENDANCE, []);
    this.set(STORAGE_KEYS.HOLIDAYS, []);
    this.set(STORAGE_KEYS.PAYROLLS, []);
    this.set(STORAGE_KEYS.EOSB, []);
    this.notify();
  }

  get(key, fallback = null) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch (e) {
      console.error(`Error reading ${key} from storage:`, e);
      return fallback;
    }
  }

  set(key, value) {
    try {
      // NOTE: no diff-based auto-archive here on purpose. With multi-device
      // sync, a stale device saving a collection it hasn't refreshed yet looks
      // exactly like a removal — auto-archiving those records would falsely
      // tombstone other people's data. Deletions are archived EXPLICITLY by
      // the delete mutators (deleteEmployee / deleteLeave / ... / clearAllData)
      // so the deletion log only ever holds real deletions.
      const collection = KEY_TO_COLLECTION[key];
      localStorage.setItem(key, JSON.stringify(value));
      this.notify();

      // Async write to server if collection is mapped
      if (collection) {
        this.persistToServer(collection, value);
      }
    } catch (e) {
      console.error(`Error writing ${key} to storage:`, e);
    }
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify() {
    this.listeners.forEach((cb) => {
      try {
        cb(this.getState());
      } catch (err) {
        console.error('Listener notification error:', err);
      }
    });
  }

  // Active User & Scope Management
  getActiveUser() {
    const users = this.get(STORAGE_KEYS.USERS, defaultUsers);
    const activeId = this.get(STORAGE_KEYS.ACTIVE_USER_ID, 'usr-admin');
    return users.find((u) => u.id === activeId) || users[0] || defaultUsers[0];
  }

  setActiveUser(userId) {
    this.set(STORAGE_KEYS.ACTIVE_USER_ID, userId);
    const user = this.getActiveUser();
    
    if (user.role === 'branch_hr') {
      this.set(STORAGE_KEYS.SELECTED_COMPANY_ID, user.assignedCompanyId);
      this.set(STORAGE_KEYS.SELECTED_BRANCH_ID, user.assignedBranchId);
    } else if (user.role === 'company_hr') {
      this.set(STORAGE_KEYS.SELECTED_COMPANY_ID, user.assignedCompanyId);
      this.set(STORAGE_KEYS.SELECTED_BRANCH_ID, 'all');
    } else {
      this.set(STORAGE_KEYS.SELECTED_COMPANY_ID, 'all');
      this.set(STORAGE_KEYS.SELECTED_BRANCH_ID, 'all');
    }
  }

  getSelectedCompanyId() {
    const user = this.getActiveUser();
    if (user.role === 'branch_hr' || user.role === 'company_hr') {
      return user.assignedCompanyId;
    }
    return this.get(STORAGE_KEYS.SELECTED_COMPANY_ID, 'all');
  }

  setSelectedCompanyId(compId) {
    this.set(STORAGE_KEYS.SELECTED_COMPANY_ID, compId);
    this.set(STORAGE_KEYS.SELECTED_BRANCH_ID, 'all');
  }

  getSelectedBranchId() {
    const user = this.getActiveUser();
    if (user.role === 'branch_hr') {
      return user.assignedBranchId;
    }
    return this.get(STORAGE_KEYS.SELECTED_BRANCH_ID, 'all');
  }

  setSelectedBranchId(branchId) {
    this.set(STORAGE_KEYS.SELECTED_BRANCH_ID, branchId);
  }

  getState() {
    const user = this.getActiveUser();
    const companies = this.get(STORAGE_KEYS.COMPANIES, defaultCompanies);
    const users = (this.get(STORAGE_KEYS.USERS, defaultUsers) || []).map((u) => ({
      ...u,
      permissions: getEffectivePermissions(u),
    }));
    const settings = this.get(STORAGE_KEYS.SETTINGS, defaultSettings);

    const allEmployees = this.get(STORAGE_KEYS.EMPLOYEES, []);
    const allLeaves = this.get(STORAGE_KEYS.LEAVES, []);
    const allHourlyLeaves = this.get(STORAGE_KEYS.HOURLY_LEAVES, []);
    const allOvertime = this.get(STORAGE_KEYS.OVERTIME, []);
    // P2.2 loan-currency rule: a loan may never sit in the system without an
    // explicit currency — legacy records missing the field are normalized here
    // to the resolved employee's salary currency (employee > company > settings).
    const allLoans = (this.get(STORAGE_KEYS.LOANS, []) || []).map((ln) => {
      if (ln && !ln.currency) {
        const emp = allEmployees.find((e) => e.id === ln.employeeId);
        const cur = emp
          ? resolveEmployeeCurrency(emp, settings, companies)
          : { code: settings.currency || 'USD', symbol: settings.currencySymbol || '$' };
        ln.currency = cur.code || 'USD';
        ln.currencySymbol = cur.symbol || '';
      }
      return ln;
    });
    const allIncrements = this.get(STORAGE_KEYS.INCREMENTS, []);
    const allAttendance = this.get(STORAGE_KEYS.ATTENDANCE, []);
    const allHolidays = this.get(STORAGE_KEYS.HOLIDAYS, []);
    const allPayrolls = this.get(STORAGE_KEYS.PAYROLLS, []);
    const allEOSB = this.get(STORAGE_KEYS.EOSB, []);
    const allDeletedRecs = this.get(STORAGE_KEYS.DELETED_RECORDS, []);

    const selectedCompId = this.getSelectedCompanyId();
    const selectedBranchId = this.getSelectedBranchId();

    // Phase 2 (Spec v1.0): the financial roles (payroll_admin, audit_reviewer,
    // payments_officer) are company-scoped exactly like company_hr/branch_hr —
    // a user may never see (or act on) records outside their assigned scope.
    const companyScopedRoles = ['company_hr', 'branch_hr', 'payroll_admin', 'audit_reviewer', 'payments_officer'];
    const compScoped = user && user.role !== 'super_admin'
      && (companyScopedRoles.includes(user.role) || (user.assignedCompanyId && user.assignedCompanyId !== 'all'));
    const branchScoped = compScoped && user.assignedBranchId && user.assignedBranchId !== 'all';

    const isItemPermitted = (item) => {
      if (compScoped) {
        if (item.companyId && item.companyId !== user.assignedCompanyId && item.companyId !== 'all') return false;
      }
      if (branchScoped) {
        if (item.branchId && item.branchId !== user.assignedBranchId && item.branchId !== 'all') return false;
      }

      if (selectedCompId !== 'all') {
        if (item.companyId && item.companyId !== selectedCompId && item.companyId !== 'all') return false;
      }
      if (selectedBranchId !== 'all') {
        if (item.branchId && item.branchId !== selectedBranchId && item.branchId !== 'all') return false;
      }

      return true;
    };

    const filteredEmployees = allEmployees.filter(isItemPermitted);
    const permittedEmpIds = new Set(filteredEmployees.map((e) => e.id));

    const filteredLeaves = allLeaves.filter((l) => isItemPermitted(l) || permittedEmpIds.has(l.employeeId));
    const filteredHourlyLeaves = allHourlyLeaves.filter((hl) => isItemPermitted(hl) || permittedEmpIds.has(hl.employeeId));
    const filteredOvertime = allOvertime.filter((o) => isItemPermitted(o) || permittedEmpIds.has(o.employeeId));
    const filteredLoans = allLoans.filter((ln) => isItemPermitted(ln) || permittedEmpIds.has(ln.employeeId));
    const filteredIncrements = allIncrements.filter((i) => isItemPermitted(i) || permittedEmpIds.has(i.employeeId));
    const filteredAttendance = allAttendance.filter((a) => isItemPermitted(a) || permittedEmpIds.has(a.employeeId));
    const filteredHolidays = allHolidays.filter(isItemPermitted);
    const filteredEOSB = allEOSB.filter((es) => isItemPermitted(es) || permittedEmpIds.has(es.employeeId));

    // A payroll batch is only visible when it belongs entirely to the current
    // company/branch scope (every item is one of the permitted employees).
    const filteredPayrolls = allPayrolls.filter((b) => {
      const batchItems = b.items || [];
      if (!batchItems.length) return true;
      return batchItems.every((it) => permittedEmpIds.has(it.employeeId));
    });

    // The deletion log is fully visible to super admins (مدير النظام / المبرمج);
    // other roles only see records that belong to their assigned scope.
    const filteredDeleted = user.role === 'super_admin'
      ? allDeletedRecs
      : allDeletedRecs.filter((r) => isItemPermitted(r.data) || permittedEmpIds.has((r.data || {}).employeeId));

    return {
      currentUser: user,
      companies,
      users,
      settings,
      currencies: getAllCurrencies(settings),
      selectedCompanyId: selectedCompId,
      selectedBranchId: selectedBranchId,
      employees: filteredEmployees,
      rawEmployees: allEmployees,
      leaves: filteredLeaves,
      hourlyLeaves: filteredHourlyLeaves,
      overtime: filteredOvertime,
      loans: filteredLoans,
      increments: filteredIncrements,
      attendance: filteredAttendance,
      holidays: filteredHolidays,
      payrolls: filteredPayrolls,
      eosb: filteredEOSB,
      deletedRecords: filteredDeleted,
      audit: this.get(STORAGE_KEYS.AUDIT, []),
    };
  }

  // Companies Mutators
  saveCompanies(companies) {
    this.set(STORAGE_KEYS.COMPANIES, companies);
  }

  addCompany(comp) {
    const list = this.get(STORAGE_KEYS.COMPANIES, []);
    list.push(comp);
    this.set(STORAGE_KEYS.COMPANIES, list);
  }

  // Users Mutators
  saveUsers(users) {
    const current = this.get(STORAGE_KEYS.USERS, []) || [];
    const protectedAccounts = (current.filter((u) => u && u.protected)) || [];
    if (protectedAccounts.length > 0) {
      const protectedIds = new Set(protectedAccounts.map((u) => u.id));
      const merged = (users || []).filter((u) => u && !protectedIds.has(u.id));
      protectedAccounts.forEach((sp) => {
        const i = merged.findIndex((u) => u && u.id === sp.id);
        if (i >= 0) merged.splice(i, 1);
      });
      users = protectedAccounts.concat(merged);
    }
    this.set(STORAGE_KEYS.USERS, users);
  }

  addUser(user) {
    const list = this.get(STORAGE_KEYS.USERS, []);
    list.push(user);
    this.set(STORAGE_KEYS.USERS, list);
  }

  // Employee Mutators
  addEmployee(emp) {
    const list = this.get(STORAGE_KEYS.EMPLOYEES, []);
    list.unshift(emp);
    this.set(STORAGE_KEYS.EMPLOYEES, list);
  }

  updateEmployee(emp) {
    const list = this.get(STORAGE_KEYS.EMPLOYEES, []);
    const idx = list.findIndex((e) => e.id === emp.id);
    if (idx !== -1) {
      list[idx] = emp;
      this.set(STORAGE_KEYS.EMPLOYEES, list);
    }
  }

  deleteEmployee(id) {
    const list = this.get(STORAGE_KEYS.EMPLOYEES, []);
    const removed = list.filter((e) => e && e.id === id);
    if (removed.length) this.archiveDeletedRecords('employees', removed, 'deleted');
    this.set(STORAGE_KEYS.EMPLOYEES, list.filter((e) => e.id !== id));
  }

  saveEmployees(employees) {
    this.set(STORAGE_KEYS.EMPLOYEES, employees);
  }

  saveSettings(settings) {
    this.set(STORAGE_KEYS.SETTINGS, settings);
  }

  // ==================================================================
  // H-4/H-5: Mandatory company/branch scoping.
  // New records must carry the employee's REAL company & branch. We never
  // fabricate 'comp-1'/'br-1' placeholders — an employee with no assigned
  // company/branch stores explicitly unscoped ('') records instead, and the
  // interactive modals block the save with a clear error (see below).
  // ==================================================================

  /**
   * Interactive-save guard. Returns an error string (or null when OK) so a
   * modal can block saving a record whose employee has no company/branch.
   */
  employeeScopeError(employee) {
    if (!employee) return 'employee_not_found';
    if (!employee.companyId || !employee.branchId) return 'no_scope';
    return null;
  }

  /**
   * Enrichment applied automatically to every add* mutation. Preserves an
   * explicit real scope, fills the scope from the employee otherwise, and
   * clears placeholder/fake scopes (comp-1/br-1) that were never real.
   */
  attachEmployeeScope(record) {
    if (!record || typeof record !== 'object') return record;
    const explicitOk = record.companyId && record.branchId
      && record.companyId !== 'comp-1' && record.branchId !== 'br-1';
    if (explicitOk) return record;
    const employees = this.get(STORAGE_KEYS.EMPLOYEES, []) || [];
    const emp = record.employeeId ? employees.find((e) => e.id === record.employeeId) : null;
    if (emp && emp.companyId && emp.branchId) {
      record.companyId = emp.companyId;
      record.branchId = emp.branchId;
    } else {
      record.companyId = '';
      record.branchId = '';
    }
    return record;
  }

  // ==================================================================
  // P2.1 Data-integrity guards (D-1..D-4).
  // Attendance / leaves / hourly-leaves add* mutators are validated BEFORE
  // anything is persisted. Modals may pre-check for nicer UX, but the storage
  // layer is the last line of defense — no call path (console, restore, test,
  // future server route) can bypass these guards.
  // ==================================================================

  _findEmployee(id) {
    if (!id) return null;
    return (this.get(STORAGE_KEYS.EMPLOYEES, []) || []).find((e) => e && e.id === id) || null;
  }

  findAttendanceByDay(employeeId, date) {
    if (!employeeId || !date) return null;
    return (this.get(STORAGE_KEYS.ATTENDANCE, []) || []).find(
      (a) => a && a.employeeId === employeeId && a.date === date
    ) || null;
  }

  findOverlappingLeaves(employeeId, startDate, endDate, opts = {}) {
    const { excludeId = '', statuses = ['pending', 'approved'] } = opts;
    if (!employeeId || !startDate || !endDate) return [];
    return (this.get(STORAGE_KEYS.LEAVES, []) || []).filter(
      (l) =>
        l && l.employeeId === employeeId &&
        l.id !== excludeId &&
        statuses.includes(l.status) &&
        l.startDate <= endDate &&
        l.endDate >= startDate
    );
  }

  recordErrorText(code, isEn = false) {
    const map = {
      employee_not_found: isEn ? 'Employee record not found.' : 'سجل الموظف غير موجود.',
      no_scope: isEn ? 'This employee has no Company/Branch assigned — assign both in their profile first.' : 'هذا الموظف غير مربوط بشركة وفرع — قم بتعيينهما في ملفه أولاً.',
      checkout_before_checkin: isEn ? 'Check-out time cannot be before check-in time.' : 'وقت الخروج لا يمكن أن يكون قبل وقت الدخول.',
      negative_value: isEn ? 'Negative values are not allowed.' : 'القيم السالبة غير مسموحة.',
      duplicate_attendance: isEn ? 'An attendance record already exists for this employee on this date — edit it instead of creating a duplicate.' : 'يوجد سجل حضور لهذا الموظف في نفس التاريخ — سيتم تعديله بدلاً من إنشاء سجل جديد.',
      leave_overlap: isEn ? 'This leave overlaps an existing approved/pending leave for the same employee.' : 'تتداخل هذه الإجازة مع إجازة سابقة (معتمدة أو معلقة) لنفس الموظف.',
      inactive_employee: isEn ? 'Leave can only be recorded for active (or on-leave) employees.' : 'الإجازة تُسجل فقط للموظف النشط (أو في إجازة).',
      invalid_range: isEn ? 'Invalid date range or day count.' : 'نطاق التواريخ أو عدد الأيام غير صحيح.',
      invalid_record: isEn ? 'Invalid record.' : 'سجل غير صالح.',
      not_found: isEn ? 'Record not found.' : 'السجل غير موجود.',
    };
    return map[code] || (isEn ? 'Unable to save record.' : 'تعذر حفظ السجل.');
  }

  validateAttendanceRecord(att) {
    if (!att || typeof att !== 'object' || !att.employeeId || !att.date) {
      return { ok: false, error: 'invalid_record' };
    }
    const emp = this._findEmployee(att.employeeId);
    if (!emp) return { ok: false, error: 'employee_not_found' };
    if (!emp.companyId || !emp.branchId) return { ok: false, error: 'no_scope' };
    if (att.checkIn && att.checkOut && att.checkOut < att.checkIn) {
      return { ok: false, error: 'checkout_before_checkin' };
    }
    if (
      Number(att.workingHours) < 0 ||
      Number(att.lateMinutes) < 0 ||
      Number(att.earlyDepartureMinutes) < 0
    ) {
      return { ok: false, error: 'negative_value' };
    }
    return { ok: true };
  }

  validateLeaveRecord(leave, opts = {}) {
    if (!leave || typeof leave !== 'object' || !leave.employeeId) {
      return { ok: false, error: 'invalid_record' };
    }
    const emp = this._findEmployee(leave.employeeId);
    if (!emp) return { ok: false, error: 'employee_not_found' };
    if (!emp.companyId || !emp.branchId) return { ok: false, error: 'no_scope' };
    if (!['active', 'probation', 'on_leave'].includes(emp.status)) {
      return { ok: false, error: 'inactive_employee' };
    }
    if (!leave.startDate || !leave.endDate || leave.endDate < leave.startDate) {
      return { ok: false, error: 'invalid_range' };
    }
    if ((Number(leave.daysCount) || 0) <= 0) return { ok: false, error: 'invalid_range' };
    const liveStatuses = ['pending', 'approved'];
    if (
      liveStatuses.includes(leave.status) &&
      this.findOverlappingLeaves(leave.employeeId, leave.startDate, leave.endDate, {
        excludeId: opts.excludeId || '',
      }).length > 0
    ) {
      return { ok: false, error: 'leave_overlap' };
    }
    return { ok: true };
  }

  validateHourlyLeaveRecord(hl) {
    if (!hl || typeof hl !== 'object' || !hl.employeeId) {
      return { ok: false, error: 'invalid_record' };
    }
    const emp = this._findEmployee(hl.employeeId);
    if (!emp) return { ok: false, error: 'employee_not_found' };
    if (!emp.companyId || !emp.branchId) return { ok: false, error: 'no_scope' };
    if ((Number(hl.hours) || 0) <= 0) return { ok: false, error: 'invalid_record' };
    return { ok: true };
  }

  // Attendance Mutators
  saveAttendance(att) { this.set(STORAGE_KEYS.ATTENDANCE, att); }
  addAttendance(att) {
    const check = this.validateAttendanceRecord(att);
    if (!check.ok) return { ok: false, error: check.error };
    if (!att.id) att.id = `att-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const dup = this.findAttendanceByDay(att.employeeId, att.date);
    if (dup && dup.id !== att.id) {
      return { ok: false, error: 'duplicate_attendance', existing: dup };
    }
    this.attachEmployeeScope(att);
    const list = this.get(STORAGE_KEYS.ATTENDANCE, []);
    list.unshift(att);
    this.set(STORAGE_KEYS.ATTENDANCE, list);
    return { ok: true, saved: att };
  }
  updateAttendance(att) {
    const check = this.validateAttendanceRecord(att);
    if (!check.ok) return { ok: false, error: check.error };
    const list = this.get(STORAGE_KEYS.ATTENDANCE, []);
    const idx = list.findIndex((a) => a.id === att.id);
    if (idx === -1) return { ok: false, error: 'not_found' };
    this.attachEmployeeScope(att);
    list[idx] = att;
    this.set(STORAGE_KEYS.ATTENDANCE, list);
    return { ok: true, saved: att };
  }
  deleteAttendance(id) {
    const list = this.get(STORAGE_KEYS.ATTENDANCE, []);
    const removed = list.filter((a) => a && a.id === id);
    if (removed.length) this.archiveDeletedRecords('attendance', removed, 'deleted');
    this.set(STORAGE_KEYS.ATTENDANCE, list.filter((a) => a.id !== id));
  }

  // Leaves Mutators
  saveLeaves(leaves) { this.set(STORAGE_KEYS.LEAVES, leaves); }
  addLeave(leave) {
    const check = this.validateLeaveRecord(leave);
    if (!check.ok) return { ok: false, error: check.error };
    if (!leave.id) leave.id = `leave-${Date.now()}`;
    this.attachEmployeeScope(leave);
    const list = this.get(STORAGE_KEYS.LEAVES, []);
    list.unshift(leave);
    this.set(STORAGE_KEYS.LEAVES, list);
    return { ok: true, saved: leave };
  }
  updateLeave(leave) {
    const check = this.validateLeaveRecord(leave, { excludeId: leave.id });
    if (!check.ok) return { ok: false, error: check.error };
    this.attachEmployeeScope(leave);
    const list = this.get(STORAGE_KEYS.LEAVES, []);
    const idx = list.findIndex((l) => l.id === leave.id);
    if (idx !== -1) {
      list[idx] = leave;
      this.set(STORAGE_KEYS.LEAVES, list);
    }
    return { ok: true, saved: leave };
  }
  deleteLeave(id) {
    const list = this.get(STORAGE_KEYS.LEAVES, []);
    const removed = list.filter((l) => l && l.id === id);
    if (removed.length) this.archiveDeletedRecords('leaves', removed, 'deleted');
    this.set(STORAGE_KEYS.LEAVES, list.filter((l) => l.id !== id));
  }

  // Hourly Leaves Mutators (إجازات الساعات)
  saveHourlyLeaves(leaves) { this.set(STORAGE_KEYS.HOURLY_LEAVES, leaves); }
  addHourlyLeave(hl) {
    const check = this.validateHourlyLeaveRecord(hl);
    if (!check.ok) return { ok: false, error: check.error };
    if (!hl.id) hl.id = `hl-${Date.now()}`;
    this.attachEmployeeScope(hl);
    const list = this.get(STORAGE_KEYS.HOURLY_LEAVES, []);
    list.unshift(hl);
    this.set(STORAGE_KEYS.HOURLY_LEAVES, list);
    return { ok: true, saved: hl };
  }
  updateHourlyLeave(hl) {
    const list = this.get(STORAGE_KEYS.HOURLY_LEAVES, []);
    const idx = list.findIndex((x) => x.id === hl.id);
    if (idx !== -1) {
      list[idx] = hl;
      this.set(STORAGE_KEYS.HOURLY_LEAVES, list);
    }
  }
  deleteHourlyLeave(id) {
    const list = this.get(STORAGE_KEYS.HOURLY_LEAVES, []);
    const removed = list.filter((x) => x && x.id === id);
    if (removed.length) this.archiveDeletedRecords('hourly_leaves', removed, 'deleted');
    this.set(STORAGE_KEYS.HOURLY_LEAVES, list.filter((x) => x.id !== id));
  }

  // Overtime Mutators
  saveOvertime(ot) { this.set(STORAGE_KEYS.OVERTIME, ot); }
  addOvertime(ot) {
    this.attachEmployeeScope(ot);
    const list = this.get(STORAGE_KEYS.OVERTIME, []);
    list.unshift(ot);
    this.set(STORAGE_KEYS.OVERTIME, list);
  }
  updateOvertime(ot) {
    if (!ot || !ot.id) return { ok: false, error: 'invalid_record' };
    const emp = this._findEmployee(ot.employeeId);
    if (!emp) return { ok: false, error: 'employee_not_found' };
    this.attachEmployeeScope(ot);
    const list = this.get(STORAGE_KEYS.OVERTIME, []);
    const idx = list.findIndex((x) => x && x.id === ot.id);
    if (idx === -1) return { ok: false, error: 'not_found' };
    list[idx] = ot;
    this.set(STORAGE_KEYS.OVERTIME, list);
    return { ok: true, saved: ot };
  }
  deleteOvertime(id) {
    const list = this.get(STORAGE_KEYS.OVERTIME, []);
    const removed = list.filter((o) => o && o.id === id);
    if (removed.length) this.archiveDeletedRecords('overtime', removed, 'deleted');
    this.set(STORAGE_KEYS.OVERTIME, list.filter((o) => o.id !== id));
  }

  // Loans Mutators
  saveLoans(loans) { this.set(STORAGE_KEYS.LOANS, loans); }
  // P2.2: no advance may be registered without an explicit currency. When the
  // caller omits it, the loan inherits the employee's resolved salary currency
  // (employee > company > global settings); 'USD' is the final fallback for
  // records whose employee cannot be resolved.
  _loanCurrencyOf(loan) {
    if (loan && loan.currency && String(loan.currency).trim()) return String(loan.currency).trim().toUpperCase();
    const emp = loan && loan.employeeId ? this._findEmployee(loan.employeeId) : null;
    const st = this.getState();
    if (emp) {
      const cur = resolveEmployeeCurrency(emp, st.settings, st.companies);
      return cur.code || 'USD';
    }
    return st.settings.currency || 'USD';
  }
  _loanSymbolOf(currencyCode) {
    const st = this.getState();
    const cur = getAllCurrencies(st.settings).find((c) => c.code === currencyCode);
    return (cur && cur.symbol) || st.settings.currencySymbol || '';
  }
  addLoan(loan) {
    loan.currency = this._loanCurrencyOf(loan);
    loan.currencySymbol = loan.currencySymbol || this._loanSymbolOf(loan.currency);
    this.attachEmployeeScope(loan);
    const list = this.get(STORAGE_KEYS.LOANS, []);
    list.unshift(loan);
    this.set(STORAGE_KEYS.LOANS, list);
  }
  updateLoan(loan) {
    if (!loan || !loan.id) return { ok: false, error: 'invalid_record' };
    const emp = this._findEmployee(loan.employeeId);
    if (!emp) return { ok: false, error: 'employee_not_found' };
    loan.currency = this._loanCurrencyOf(loan);
    loan.currencySymbol = loan.currencySymbol || this._loanSymbolOf(loan.currency);
    this.attachEmployeeScope(loan);
    const list = this.get(STORAGE_KEYS.LOANS, []);
    const idx = list.findIndex((l) => l && l.id === loan.id);
    if (idx === -1) return { ok: false, error: 'not_found' };
    list[idx] = loan;
    this.set(STORAGE_KEYS.LOANS, list);
    return { ok: true, saved: loan };
  }
  deleteLoan(loanId) {
    const list = this.get(STORAGE_KEYS.LOANS, []);
    const removed = list.filter((l) => l && l.id === loanId);
    if (removed.length) this.archiveDeletedRecords('loans', removed, 'deleted');
    this.set(STORAGE_KEYS.LOANS, list.filter((l) => !(l && l.id === loanId)));
  }

  // Increments Mutators
  saveIncrements(inc) { this.set(STORAGE_KEYS.INCREMENTS, inc); }
  addIncrement(inc) {
    this.attachEmployeeScope(inc);
    const list = this.get(STORAGE_KEYS.INCREMENTS, []);
    list.unshift(inc);
    this.set(STORAGE_KEYS.INCREMENTS, list);
  }

  // Payroll Batches Mutators
  savePayrolls(payrolls) { this.set(STORAGE_KEYS.PAYROLLS, payrolls); }
  addPayrollBatch(batch) {
    // Bump the version stamp on EVERY save (draft → under_audit → approved →
    // paid). The cross-device server merge picks the newer updatedAt, so a paid
    // payroll is never silently reverted to draft/approved by a stale device
    // pushing an older copy of the same month during the next sync.
    if (batch && typeof batch === 'object') batch.updatedAt = new Date().toISOString();
    const list = this.get(STORAGE_KEYS.PAYROLLS, []);
    const idx = list.findIndex((b) => b.month === batch.month);
    if (idx !== -1) list[idx] = batch;
    else list.unshift(batch);
    this.set(STORAGE_KEYS.PAYROLLS, list);
  }

  // EOSB Mutators
  saveEOSB(eosb) { this.set(STORAGE_KEYS.EOSB, eosb); }
  addEOSB(eosb) {
    this.attachEmployeeScope(eosb);
    // Bump the version stamp on every save so the cross-device server merge
    // always picks the newest settlement record.
    if (eosb && typeof eosb === 'object') eosb.updatedAt = new Date().toISOString();
    const list = this.get(STORAGE_KEYS.EOSB, []);
    list.unshift(eosb);
    this.set(STORAGE_KEYS.EOSB, list);
  }
  deleteEOSB(eosbId) {
    const list = this.get(STORAGE_KEYS.EOSB, []);
    const removed = list.filter((e) => e && (e.id === eosbId || e.employeeId === eosbId));
    if (removed.length) this.archiveDeletedRecords('eosb', removed, 'deleted');
    this.set(STORAGE_KEYS.EOSB, list.filter((e) => !(e && (e.id === eosbId || e.employeeId === eosbId))));
  }
  updateEOSB(id, patch) {
    const list = this.get(STORAGE_KEYS.EOSB, []);
    const idx = list.findIndex((e) => e && (e.id === id || e.employeeId === id));
    if (idx === -1) return false;
    list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
    this.set(STORAGE_KEYS.EOSB, list);
    return true;
  }

  // Holidays Mutators
  saveHolidays(holidays) { this.set(STORAGE_KEYS.HOLIDAYS, holidays); }
  addHoliday(hol) {
    const list = this.get(STORAGE_KEYS.HOLIDAYS, []);
    list.unshift(hol);
    this.set(STORAGE_KEYS.HOLIDAYS, list);
  }
  deleteHoliday(id) {
    const list = this.get(STORAGE_KEYS.HOLIDAYS, []);
    const removed = list.filter((h) => h && h.id === id);
    if (removed.length) this.archiveDeletedRecords('holidays', removed, 'deleted');
    this.set(STORAGE_KEYS.HOLIDAYS, list.filter((h) => h.id !== id));
  }

  getTheme() {
    return localStorage.getItem(STORAGE_KEYS.THEME) || 'light';
  }

  setTheme(theme) {
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }

  // ==============================================
  // Audit Trail (who did what, when)
  // ==============================================
  getAuditLog() {
    return this.get(STORAGE_KEYS.AUDIT, []);
  }

  saveAuditLog(entries) {
    this.set(STORAGE_KEYS.AUDIT, entries);
  }

  /**
   * Append a single audit entry. Keeps at most 2000 entries so the log
   * cannot grow without bound.
   */
  addAudit(action, targetType, summary, targetId = '') {
    const user = this.getActiveUser();
    const entries = this.getAuditLog();
    const entry = {
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      at: new Date().toISOString(),
      userId: user.id,
      userName: user.name || user.username,
      action,
      targetType,
      targetId,
      summary: String(summary || '').slice(0, 500),
    };
    entries.unshift(entry);
    this.saveAuditLog(entries.slice(0, 2000));
    return entry;
  }

  // ==============================================
  // Deletion Log / Restoration (recover deleted data)
  // ==============================================
  getDeletedRecords() {
    return this.get(STORAGE_KEYS.DELETED_RECORDS, []);
  }

  // Records every item that exists in `oldList` but is missing from `newList`.
  archiveRemovedRecords(collection, oldList, newList) {
    const newIds = new Set(
      (newList || [])
        .filter((n) => n && typeof n === 'object')
        .map((n) => String(n.id ?? n.month ?? n.name ?? ''))
    );
    const removed = oldList.filter(
      (item) => item && typeof item === 'object' && !newIds.has(String(item.id ?? item.month ?? item.name ?? ''))
    );
    if (removed.length) this.archiveDeletedRecords(collection, removed, 'deleted');
  }

  archiveDeletedRecords(collection, items, reason = 'deleted') {
    const user = this.getActiveUser();
    const records = this.getDeletedRecords();
    const now = new Date().toISOString();
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
    const newRecords = items.map((item) => ({
      id: `del-${stamp}-${Math.floor(Math.random() * 1000000)}`,
      collection,
      data: item,
      deletedAt: now,
      deletedBy: user ? (user.username || user.id) : 'system',
      deletedByName: user ? (user.name || user.username) : 'System',
      reason,
    }));
    this.set(STORAGE_KEYS.DELETED_RECORDS, newRecords.concat(records).slice(0, 5000));
  }

  // Re-inserts an archived record back into its original collection.
  restoreDeletedRecord(recordId) {
    const records = this.getDeletedRecords();
    const rec = records.find((r) => r.id === recordId);
    if (!rec) return { success: false, error: 'not_found' };
    if (!rec.data || typeof rec.data !== 'object') {
      return { success: false, error: 'invalid_data' };
    }
    const ok = this.insertRecordIntoCollection(rec.collection, rec.data);
    if (!ok) return { success: false, error: 'unsupported_collection' };
    this.set(STORAGE_KEYS.DELETED_RECORDS, records.filter((r) => r.id !== recordId));
    this.addAudit('restore', rec.collection, `Restored ${rec.collection} record`, String(rec.data.id || rec.data.name || recordId).slice(0, 120));
    return { success: true };
  }

  insertRecordIntoCollection(collection, data) {
    switch (collection) {
      case 'companies': {
        const list = this.get(STORAGE_KEYS.COMPANIES, []);
        if (!list.some((c) => c.id === data.id)) list.push(data);
        this.saveCompanies(list);
        return true;
      }
      case 'users': {
        const list = this.get(STORAGE_KEYS.USERS, []);
        if (!list.some((u) => u.id === data.id)) list.push(data);
        this.saveUsers(list);
        return true;
      }
      case 'employees': {
        const list = this.get(STORAGE_KEYS.EMPLOYEES, []);
        if (!list.some((e) => e.id === data.id)) list.unshift(data);
        this.saveEmployees(list);
        return true;
      }
      case 'leaves': { if (!this.get(STORAGE_KEYS.LEAVES, []).some((l) => l.id === data.id)) this.addLeave(data); return true; }
      case 'hourly_leaves': { if (!this.get(STORAGE_KEYS.HOURLY_LEAVES, []).some((l) => l.id === data.id)) this.addHourlyLeave(data); return true; }
      case 'overtime': { if (!this.get(STORAGE_KEYS.OVERTIME, []).some((o) => o.id === data.id)) this.addOvertime(data); return true; }
      case 'loans': { if (!this.get(STORAGE_KEYS.LOANS, []).some((l) => l.id === data.id)) this.addLoan(data); return true; }
      case 'increments': { if (!this.get(STORAGE_KEYS.INCREMENTS, []).some((i) => i.id === data.id)) this.addIncrement(data); return true; }
      case 'attendance': { if (!this.get(STORAGE_KEYS.ATTENDANCE, []).some((a) => a.id === data.id)) this.addAttendance(data); return true; }
      case 'holidays': { if (!this.get(STORAGE_KEYS.HOLIDAYS, []).some((h) => h.id === data.id)) this.addHoliday(data); return true; }
      case 'payrolls': { if (!this.get(STORAGE_KEYS.PAYROLLS, []).some((b) => b.id === data.id)) this.addPayrollBatch(data); return true; }
      case 'eosb': { if (!this.get(STORAGE_KEYS.EOSB, []).some((e) => e.id === data.id)) this.addEOSB(data); return true; }
      default: return false;
    }
  }

  // Erases an archived record permanently (data then becomes unrecoverable).
  purgeDeletedRecord(recordId) {
    const records = this.getDeletedRecords();
    const rec = records.find((r) => r.id === recordId) || { collection: 'unknown', data: {} };
    this.set(STORAGE_KEYS.DELETED_RECORDS, records.filter((r) => r.id !== recordId));
    this.addAudit('purge', rec.collection, 'Permanently erased deleted record', String(rec.data && rec.data.id || recordId).slice(0, 120));
    return { success: true };
  }

  // ==============================================
  // Backup / Restore (server-side, token protected)
  // ==============================================

  // Downloads the full backup JSON generated by the server.
  async exportBackupJSON() {
    const res = await this.apiFetch('/api/backup');
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="?([^";]+)"?/i);
    a.download = match ? match[1] : `benosoft_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  // Restores a backup JSON (previously exported /api/backup payload).
  async importBackupJSON(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { success: false, error: 'Invalid JSON file' };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { success: false, error: 'Not a valid backup: expected an object of collections' };
    }
    const payload = {};
    for (const [col, value] of Object.entries(data)) {
      if (COLLECTION_TO_KEY[col]) payload[col] = value;
    }
    try {
      const res = await this.apiFetch('/api/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        return { success: false, error: result.error || 'Restore failed' };
      }
      // Update the local cache with the restored collections.
      for (const [col, value] of Object.entries(payload)) {
        localStorage.setItem(COLLECTION_TO_KEY[col], JSON.stringify(value));
      }
      await this.syncFromServer();
      this.notify();
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e.message || e) };
    }
  }
}

export const storage = new StorageService();
