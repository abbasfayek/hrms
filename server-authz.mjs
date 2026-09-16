// ==========================================
// P10-1: Server-side Authorization & Company/Branch Isolation
// Mirrors the client's locked branch-isolation logic (storage.getState)
// and enforces it authoritatively from the server session.
// ==========================================

// ----- Permission Catalog (pinned mirror of public/js/types.js) -----
export const ALL_PERMISSIONS = [
  'dashboard.view',
  'employees.view', 'employees.add', 'employees.edit', 'employees.delete',
  'leaves.view', 'leaves.add', 'leaves.edit', 'leaves.delete', 'leaves.approve',
  'hourlyLeaves.view', 'hourlyLeaves.add', 'hourlyLeaves.edit', 'hourlyLeaves.delete', 'hourlyLeaves.approve',
  'attendance.view', 'attendance.add', 'attendance.edit', 'attendance.delete',
  'overtime.add', 'overtime.edit', 'overtime.delete', 'overtime.approve',
  'loans.view', 'loans.add', 'loans.edit', 'loans.pay', 'loans.delete',
  'increments.view', 'increments.add', 'increments.edit', 'increments.delete',
  'deductions.view', 'deductions.add', 'deductions.edit', 'deductions.delete',
  'payroll.view', 'payroll.generate', 'payroll.edit', 'payroll.approve', 'payroll.reject', 'payroll.submit', 'payroll.cancelPayment', 'payroll.archive', 'payroll.export', 'payroll.disburse',
  'payroll.correction.create', 'payroll.correction.manual', 'payroll.correction.writeOff', 'payroll.correction.coApprove',
  'eosb.view', 'eosb.calculate', 'eosb.approve', 'eosb.pay', 'eosb.delete',
  'companies.view', 'companies.manage',
  'reports.view', 'reports.export',
  'audit.view',
  'users.view', 'users.manage',
  'settings.view', 'settings.manage',
];

export const DEFAULT_ROLE_PERMISSIONS = {
  super_admin: ALL_PERMISSIONS,
  company_hr: [
    'dashboard.view',
    'employees.view', 'employees.add', 'employees.edit', 'employees.delete',
    'leaves.view', 'leaves.add', 'leaves.edit', 'leaves.delete', 'leaves.approve',
    'hourlyLeaves.view', 'hourlyLeaves.add', 'hourlyLeaves.edit', 'hourlyLeaves.delete', 'hourlyLeaves.approve',
    'attendance.view', 'attendance.add', 'attendance.edit', 'attendance.delete',
    'overtime.add', 'overtime.edit', 'overtime.delete', 'overtime.approve',
    'loans.view', 'loans.add', 'loans.edit', 'loans.pay', 'loans.delete',
    'increments.view', 'increments.add', 'increments.edit', 'increments.delete',
    'deductions.view', 'deductions.add', 'deductions.edit', 'deductions.delete',
    'payroll.view', 'payroll.generate', 'payroll.edit', 'payroll.submit', 'payroll.export',
    'payroll.correction.create', 'payroll.correction.manual',
    'eosb.view', 'eosb.calculate', 'eosb.approve', 'eosb.pay', 'eosb.delete',
    'companies.view', 'companies.manage',
    'reports.view', 'reports.export',
    'audit.view',
  ],
  branch_hr: [
    'dashboard.view',
    'employees.view', 'employees.add', 'employees.edit',
    'leaves.view', 'leaves.add', 'leaves.edit', 'leaves.approve',
    'hourlyLeaves.view', 'hourlyLeaves.add', 'hourlyLeaves.edit', 'hourlyLeaves.approve',
    'attendance.view', 'attendance.add', 'attendance.edit',
    'overtime.add', 'overtime.edit', 'overtime.approve',
    'loans.view', 'loans.add', 'loans.edit', 'loans.pay',
    'increments.view', 'increments.add',
    'deductions.view', 'deductions.add', 'deductions.edit',
    'payroll.view', 'payroll.generate',
    'eosb.view', 'eosb.calculate',
    'companies.view',
    'reports.view',
  ],
  payroll_admin: [
    'dashboard.view',
    'payroll.view', 'payroll.generate', 'payroll.edit', 'payroll.submit', 'payroll.export',
    'payroll.correction.create', 'payroll.correction.manual',
    'reports.view',
  ],
  audit_reviewer: [
    'dashboard.view',
    'payroll.view',
    'payroll.approve', 'payroll.reject', 'payroll.cancelPayment',
    'payroll.correction.coApprove',
    'audit.view',
    'reports.view',
  ],
  payments_officer: [
    'dashboard.view',
    'payroll.view', 'payroll.disburse',
    'reports.view',
  ],
};

// ----- Core permission helpers -----
export function getEffectivePerms(user) {
  if (!user) return [];
  // permissionsExplicit === true marks an admin-chosen set (empty = grant nothing).
  // Absent/false keeps legacy semantics: non-empty honors the set, otherwise role defaults.
  if (user.permissionsExplicit === true) return Array.isArray(user.permissions) ? user.permissions : [];
  if (Array.isArray(user.permissions) && user.permissions.length) return user.permissions;
  return DEFAULT_ROLE_PERMISSIONS[user.role] || [];
}

export function can(user, permission) {
  if (!user) return false;
  const perms = getEffectivePerms(user);
  return perms.includes(permission);
}

export function isSuper(user) {
  return user && user.role === 'super_admin';
}

// ----- Scope logic (mirrors storage.getState branch isolation) -----
export const COMPANY_SCOPED_ROLES = new Set([
  'company_hr', 'branch_hr', 'payroll_admin', 'audit_reviewer', 'payments_officer'
]);

export function getScope(user) {
  if (!user) return { companyId: null, branchId: null, compScoped: false, branchScoped: false };
  const assignedCompanyId = user.assignedCompanyId || 'all';
  const assignedBranchId = user.assignedBranchId || 'all';
  const assignedBranchesList = Array.isArray(user.assignedBranches)
    ? user.assignedBranches
    : (Array.isArray(user.assignedBranchIds) ? user.assignedBranchIds : null);

  const compScoped = !isSuper(user) &&
    (COMPANY_SCOPED_ROLES.has(user.role) || (assignedCompanyId !== 'all' && assignedCompanyId !== ''));

  let branchScoped = false;
  let allowedBranchIds = null;
  let branchId = 'all';

  if (compScoped) {
    if (assignedBranchesList && assignedBranchesList.length > 0) {
      if (!assignedBranchesList.includes('all')) {
        branchScoped = true;
        allowedBranchIds = new Set(assignedBranchesList);
        branchId = assignedBranchesList[0] || 'all';
      }
    } else if (assignedBranchId !== 'all' && assignedBranchId !== '') {
      branchScoped = true;
      allowedBranchIds = new Set([assignedBranchId]);
      branchId = assignedBranchId;
    }
  }

  return {
    companyId: compScoped ? assignedCompanyId : 'all',
    branchId,
    allowedBranchIds,
    compScoped,
    branchScoped,
  };
}

export function isItemPermitted(item, scope) {
  if (!scope.compScoped && !scope.branchScoped) return true;
  if (scope.compScoped) {
    const itemComp = item?.companyId;
    if (!itemComp || itemComp === 'all' || itemComp !== scope.companyId) return false;
  }
  if (scope.branchScoped) {
    const itemBranch = item?.branchId;
    if (!itemBranch || itemBranch === 'all') return false;
    if (scope.allowedBranchIds && scope.allowedBranchIds.size > 0) {
      if (!scope.allowedBranchIds.has(itemBranch)) return false;
    } else if (scope.branchId && scope.branchId !== 'all' && itemBranch !== scope.branchId) {
      return false;
    }
  }
  return true;
}

// Employee ID indirection: items with employeeId inherit that employee's scope
export function resolveEmpScope(employeeId, employees) {
  const emp = employees?.find(e => e.id === employeeId);
  if (!emp) return { companyId: '__UNKNOWN__', branchId: '__UNKNOWN__' };
  return { companyId: emp.companyId || '__UNKNOWN__', branchId: emp.branchId || '__UNKNOWN__' };
}

export function isItemPermittedByEmployee(item, scope, employees) {
  if (isItemPermitted(item, scope)) return true;
  const empId = item?.employeeId;
  if (!empId) return false;
  const empScope = resolveEmpScope(empId, employees);
  return isItemPermitted({ companyId: empScope.companyId, branchId: empScope.branchId }, scope);
}

// ----- Read/Write gates per collection -----
// readGate: { perm: string, superOnly?: boolean }
// writeGate: { perm: string, superOnly?: boolean, scopeValidate?: boolean }
export const READ_GATES = {
  companies: { perm: 'companies.view', superOnly: false },
  employees: { perm: 'employees.view', superOnly: false },
  leaves: { perm: 'leaves.view', superOnly: false },
  hourly_leaves: { perm: 'hourlyLeaves.view', superOnly: false },
  overtime: { perm: 'overtime.add', superOnly: false }, // attendance module
  loans: { perm: 'loans.view', superOnly: false },
  increments: { perm: 'increments.view', superOnly: false },
  attendance: { perm: 'attendance.view', superOnly: false },
  holidays: { perm: 'employees.view', superOnly: false }, // holidays use employees scope
  payrolls: { perm: 'payroll.view', superOnly: false },
  eosb: { perm: 'eosb.view', superOnly: false },
  users: { perm: 'users.view', superOnly: true }, // only super_admin can read users
  settings: { perm: 'settings.view', superOnly: true }, // only super_admin can read settings
  audit: { perm: 'audit.view', superOnly: false },
  audit_trail: { perm: 'audit.view', superOnly: false },
  deleted_records: { perm: 'audit.view', superOnly: true }, // only super_admin
  corrections: { perm: 'payroll.correction.create', superOnly: true }, // not persisted yet
  backup: { perm: 'users.manage', superOnly: true }, // only super_admin can backup
};

export const WRITE_GATES = {
  companies: { perm: 'companies.manage', superOnly: false, scopeValidate: true, ownCompanyOnly: true },
  employees: { perm: 'employees.edit', superOnly: false, scopeValidate: true, ownCompanyOnly: false },
  leaves: { perm: 'leaves.edit', superOnly: false, scopeValidate: true, ownCompanyOnly: false },
  hourly_leaves: { perm: 'hourlyLeaves.edit', superOnly: false, scopeValidate: true, ownCompanyOnly: false },
  overtime: { perm: 'overtime.edit', superOnly: false, scopeValidate: true, ownCompanyOnly: false },
  loans: { perm: 'loans.edit', superOnly: false, scopeValidate: true, ownCompanyOnly: false },
  // WORKFLOW COLLECTIONS (payrolls / increments / eosb) authorize PER RECORD
  // inside scopeValidateWrite, so the blanket gate only requires ANY one of the
  // collection's action permissions. secondaryWritePerms lists every permission
  // that can legitimately write at least one record in the collection:
  //   - payrolls: generate (create) / edit (same-status) / submit + approve +
  //               reject + disburse + cancelPayment + archive (transitions)
  //               — audited per-record with the OFFICIAL state machine below.
  //   - increments: add (create) or edit (modify existing).
  //   - eosb: calculate (create/edit draft) / approve (submit/reject/cancel) /
  //           pay (disburse) / delete — audited per-record with the EOSB machine.
  increments: { perm: 'increments.edit', secondaryWritePerms: ['increments.add'], superOnly: false, scopeValidate: true, ownCompanyOnly: false },
  attendance: { perm: 'attendance.edit', superOnly: false, scopeValidate: true, ownCompanyOnly: false },
  holidays: { perm: 'employees.edit', superOnly: false, scopeValidate: true, ownCompanyOnly: false },
  payrolls: {
    perm: 'payroll.edit',
    secondaryWritePerms: ['payroll.generate', 'payroll.approve', 'payroll.reject', 'payroll.submit', 'payroll.disburse', 'payroll.cancelPayment', 'payroll.archive'],
    superOnly: false, scopeValidate: true, ownCompanyOnly: false,
  },
  eosb: {
    perm: 'eosb.calculate',
    secondaryWritePerms: ['eosb.approve', 'eosb.pay', 'eosb.delete'],
    superOnly: false, scopeValidate: true, ownCompanyOnly: false,
  },
  users: { perm: 'users.manage', superOnly: true, scopeValidate: false, ownCompanyOnly: false },
  settings: { perm: 'settings.manage', superOnly: true, scopeValidate: false, ownCompanyOnly: false },
  audit: { perm: 'audit.view', superOnly: true, scopeValidate: false, ownCompanyOnly: false },
  audit_trail: { perm: 'audit.view', superOnly: true, scopeValidate: false, ownCompanyOnly: false },
  deleted_records: { perm: 'audit.view', superOnly: true, scopeValidate: true, ownCompanyOnly: false },
  corrections: { perm: 'payroll.correction.create', superOnly: true, scopeValidate: false, ownCompanyOnly: false },
  backup: { perm: 'users.manage', superOnly: true, scopeValidate: false, ownCompanyOnly: false },
  restore: { perm: 'users.manage', superOnly: true, scopeValidate: false, ownCompanyOnly: false },
  'import-employees': { perm: 'employees.add', superOnly: false, scopeValidate: true, ownCompanyOnly: false },
};

// ----- Collection -> employee-related key mapping -----
const EMPLOYEE_COLLECTIONS = new Set([
  'employees', 'leaves', 'hourly_leaves', 'overtime', 'loans', 'increments', 'attendance', 'eosb', 'deleted_records'
]);

const PAYROLL_COLLECTIONS = new Set(['payrolls']);

// ----- Auth context resolution -----
export function resolveAuthContext(req, sessions, getUsers) {
  const token = req.headers['x-session-token'];
  if (!token) return { ok: false, reason: 'no_session', status: 401 };
  const s = sessions.get(token);
  if (!s || s.kind !== 'user') return { ok: false, reason: 'invalid_session', status: 401 };
  if (Date.now() > s.expiresAt) {
    sessions.delete(token);
    return { ok: false, reason: 'expired', status: 401 };
  }
  const users = getUsers();
  const user = users.find(u => u.id === s.userId);
  if (!user) return { ok: false, reason: 'user_not_found', status: 401 };
  // sliding renewal
  s.expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  const perms = getEffectivePerms(user);
  const scope = getScope(user);
  return { ok: true, user, perms, scope, session: s };
}

// ----- Permission check helpers -----
export function checkReadPerm(ctx, collection) {
  const gate = READ_GATES[collection];
  if (!gate) return { ok: false, reason: 'unknown_collection', status: 404 };
  if (gate.superOnly && !isSuper(ctx.user)) return { ok: false, reason: 'super_required', status: 403 };
  if (!can(ctx.user, gate.perm)) return { ok: false, reason: 'permission_denied', status: 403 };
  return { ok: true };
}

export function checkWritePerm(ctx, collection) {
  const gate = WRITE_GATES[collection];
  if (!gate) return { ok: false, reason: 'unknown_collection', status: 404 };
  if (gate.superOnly && !isSuper(ctx.user)) return { ok: false, reason: 'super_required', status: 403 };
  if (can(ctx.user, gate.perm)) return { ok: true };
  // Workflow collections allow a write when the user holds ANY of the actions
  // that the state machine can legitimately perform on the collection; the
  // exact per-record authorization still runs in scopeValidateWrite.
  if (Array.isArray(gate.secondaryWritePerms)) {
    for (const p of gate.secondaryWritePerms) {
      if (can(ctx.user, p)) return { ok: true };
    }
  }
  return { ok: false, reason: 'permission_denied', status: 403 };
}

// ----- Read filtering -----
export function filterCollectionRead(collection, data, ctx, getAllEmployees, queryParams = {}) {
  // Keep ctx reference to ensure we use the exact same user object
  const authCtx = ctx;
  const { user, scope } = ctx;
  if (isSuper(user)) {
    if (collection === 'payrolls' && queryParams && Object.keys(queryParams).length > 0) {
      if (Array.isArray(data)) {
        return data.filter(batch => {
          if (queryParams.status && batch.status !== queryParams.status) return false;
          if (queryParams.branchId && queryParams.branchId !== 'all' && batch.branchId !== queryParams.branchId) return false;
          return true;
        });
      }
    }
    return data;
  }

  const employees = getAllEmployees ? getAllEmployees() : [];

  // Handle envelope objects (audit_trail) specially - they have { events: [...] }
  const isEnvelope = collection === 'audit_trail' && data && typeof data === 'object' && Array.isArray(data.events);
  const workingData = isEnvelope ? data.events : data;

  if (!Array.isArray(workingData)) return data;

  let filtered;
  switch (collection) {
    case 'companies':
      // non-super sees only their assigned company (with branches)
      if (scope.compScoped) {
        filtered = workingData.filter(c => c.id === scope.companyId);
      } else {
        filtered = workingData;
      }
      break;

    case 'payrolls': {
      // Requested branch / status filter from query params, if provided
      const reqBranch = queryParams?.branchId || null;
      const reqStatus = queryParams?.status || null;

      // If user attempted spoofing a branch outside their scope:
      if (reqBranch && reqBranch !== 'all') {
        if (scope.branchScoped) {
          if (scope.allowedBranchIds && !scope.allowedBranchIds.has(reqBranch)) {
            // Spoofing attempt blocked: user has no access to this branch
            filtered = [];
            break;
          }
          if (!scope.allowedBranchIds && scope.branchId !== 'all' && scope.branchId !== reqBranch) {
            filtered = [];
            break;
          }
        }
      }

      filtered = workingData.filter(batch => {
        if (!batch || typeof batch !== 'object') return false;

        // Status filter if requested (e.g. status=paid)
        if (reqStatus && batch.status !== reqStatus) return false;

        const items = Array.isArray(batch.items) ? batch.items : [];
        const batchBranch = batch.branchId || (items[0] && items[0].branchId) || null;
        const batchComp = batch.companyId || (items[0] && items[0].companyId) || null;

        // If explicit branch requested, match it
        if (reqBranch && reqBranch !== 'all') {
          if (batchBranch && batchBranch !== reqBranch) return false;
        }

        // 1. Batch level check: companyId & branchId must be permitted
        if (batchComp && scope.compScoped && batchComp !== scope.companyId && batchComp !== 'all') {
          return false;
        }
        if (batchBranch && scope.branchScoped) {
          if (scope.allowedBranchIds && !scope.allowedBranchIds.has(batchBranch) && batchBranch !== 'all') {
            return false;
          }
          if (!scope.allowedBranchIds && scope.branchId !== 'all' && batchBranch !== scope.branchId && batchBranch !== 'all') {
            return false;
          }
        }

        // If batch carries no branch identity when branchScoped is active, do not leak
        if (!items.length && scope.branchScoped && !batchBranch) {
          return false;
        }

        // 2. Item level check: ALL items in batch must be in scope
        if (items.length > 0) {
          const allItemsInScope = items.every(it => {
            const empScope = resolveEmpScope(it.employeeId, employees);
            const itemComp = it.companyId || empScope.companyId;
            const itemBranch = it.branchId || empScope.branchId;
            return isItemPermitted({ companyId: itemComp, branchId: itemBranch }, scope);
          });
          if (!allItemsInScope) return false;
        }

        return true;
      });
      break;
    }

    case 'audit_trail': {
      // envelope { events: [...] } - filter events, fail-closed for globals
      const s = scope; // function-scoped scope from authCtx.scope
      if (!workingData.length) {
        filtered = [];
      } else {
        filtered = workingData.filter(ev => {
          if (!scope.compScoped && !scope.branchScoped) return true;
          const hasScope = ev.companyId && isItemPermitted({ companyId: ev.companyId, branchId: ev.branchId || 'all' }, scope);
          return hasScope && ev.companyId;
        });
      }
      break;
    }

    case 'audit':
      // legacy array - filter by companyId/branchId, fail-closed for globals
      filtered = workingData.filter(ev => {
        if (!scope.compScoped && !scope.branchScoped) return true;
        const hasScope = ev.companyId && isItemPermitted({ companyId: ev.companyId, branchId: ev.branchId || 'all' }, scope);
        return hasScope && ev.companyId;
      });
      break;

    case 'deleted_records':
      // tombstones - filter by data.companyId/branchId/employeeId
      filtered = workingData.filter(rec => {
        const d = rec.data || {};
        return isItemPermittedByEmployee(d, scope, employees);
      });
      break;

    default:
      // employee-scoped collections: filter by item scope OR employeeId indirection
      if (EMPLOYEE_COLLECTIONS.has(collection)) {
        filtered = workingData.filter(item => isItemPermittedByEmployee(item, scope, employees));
      } else {
        // non-scoped collections (settings, users, etc.) - only reachable by super_admin due to gate
        filtered = workingData;
      }
      break;
  }

  // Reconstruct envelope for audit_trail
  if (collection === 'audit_trail' && data && typeof data === 'object' && Array.isArray(data.events)) {
    return { ...data, events: filtered };
  }
  return filtered;
}

// ----- Workflow state machines (pinned mirrors of the client engines) -----
// The server is the FINAL authority: any status change written to a payroll or
// EOSB record must be a transition that exists in these matrices, performed by
// a user holding exactly the permission the client's guarded engines map to
// that transition. Anything else is refused with an illegal_transition result.

export const PAYROLL_TRANSITIONS = {
  draft: ['under_audit'],
  under_audit: ['approved', 'rejected'],
  rejected: ['under_audit'],
  approved: ['paid'],
  paid: [], // terminal — a paid batch can only be echoed unchanged
};

export const EOSB_TRANSITIONS = {
  draft: ['under_audit'],
  under_audit: ['approved', 'draft'],
  approved: ['paid'],
  paid: ['approved'],
};

// Legal statuses for a BRAND-NEW record (nothing to transition FROM).
// EOSB's calculator commits a settlement straight to under_audit.
const PAYROLL_CREATE_STATUSES = ['draft'];
const EOSB_CREATE_STATUSES = ['draft', 'under_audit'];

// (collection, destination status) -> permission required to reach it.
// Mirrors PAYROLL_TRANSITION_ACTION / eosbTransitionAction in the client engines.
export const TRANSITION_PERMISSIONS = {
  payrolls: {
    under_audit: 'payroll.submit',   // draft → under_audit (submit) | rejected → under_audit (resubmit)
    approved: 'payroll.approve',     // under_audit → approved
    rejected: 'payroll.reject',      // under_audit → rejected (returned)
    paid: 'payroll.disburse',        // approved → paid
  },
  eosb: {
    under_audit: 'eosb.approve',     // draft → under_audit (submit)
    approved: 'eosb.approve',        // under_audit → approved (approve) | paid → approved (cancel payment)
    draft: 'eosb.approve',           // under_audit → draft (reject / return)
    paid: 'eosb.pay',                // approved → paid (disburse)
  },
};

// ---- Record-change helpers (must mirror server.js mergeCollection semantics) ----
// A write is a REAL change only when the incoming record replaces the stored
// one: a brand-new id, a strictly newer updatedAt, or an equal timestamp with
// different content (mergeCollection lets the incoming record win ties).
// Record-level authorization is ONLY required for real changes — echoes of a
// stored record (identical payloads carried in a full-collection save by the
// client) and stale copies are no-ops and must never deny a legitimate save.
function stampOf(rec) {
  const v = rec && (rec.updatedAt || rec.createdAt);
  if (!v) return -Infinity;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : -Infinity;
}

function canonical(obj) {
  if (obj === null || obj === undefined || typeof obj !== 'object') return String(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

function recordWouldChangeStored(stored, rec) {
  if (!stored) return true;                                   // create
  const s = stampOf(stored);
  const r = stampOf(rec);
  if (r > s) return true;                                     // newer stamp → server applies rec
  if (r === s && canonical(rec) !== canonical(stored)) return true; // tie, different content → rec wins
  return false;                                               // stale or identical echo → no change
}

function findStoredById(storedData, id) {
  if (!Array.isArray(storedData) || !id) return null;
  return storedData.find((s) => s && s.id === id) || null;
}

// Returns null when allowed, or { reason, status, recordId } to reject.
function authorizePayrollRecord(ctx, rec, storedData) {
  const { user } = ctx;
  const existing = findStoredById(storedData, rec && rec.id);
  const to = (rec && rec.status) || 'draft';

  // Sealed paid batches are immutable (except for an unchanged echo).
  if (existing && existing.status === 'paid') {
    if (to !== 'paid') return { reason: 'paid_batch_immutable', status: 403, recordId: rec.id };
    if (recordWouldChangeStored(existing, rec)) {
      // Financial snapshots cannot be tampered with on a sealed batch.
      if (existing.ratesSnapshot && rec.ratesSnapshot && JSON.stringify(existing.ratesSnapshot) !== JSON.stringify(rec.ratesSnapshot)) {
        return { reason: 'paid_batch_snapshot_immutable', status: 403, recordId: rec.id };
      }
      const existingItems = existing.items || [];
      const incomingItems = Array.isArray(rec.items) ? rec.items : [];
      for (const inItem of incomingItems) {
        const exItem = existingItems.find((it) => it && it.employeeId === inItem.employeeId);
        if (exItem) {
          if ((inItem.exchangeRate !== undefined && inItem.exchangeRate !== null && inItem.exchangeRate !== exItem.exchangeRate) ||
              (inItem.baseAmount !== undefined && inItem.baseAmount !== null && inItem.baseAmount !== exItem.baseAmount) ||
              inItem.netSalary !== exItem.netSalary ||
              inItem.grossSalary !== exItem.grossSalary ||
              inItem.basicSalary !== exItem.basicSalary ||
              inItem.totalDeductions !== exItem.totalDeductions ||
              inItem.totalEarnings !== exItem.totalEarnings) {
            return { reason: 'paid_batch_snapshot_immutable', status: 403, recordId: rec.id };
          }
        }
      }
      if (!can(user, 'payroll.edit')) return { reason: 'paid_batch_immutable', status: 403, recordId: rec.id };
    }
    return null; // unchanged echo of a paid batch — safe
  }

  // Creation — a payroll only ever enters the machine as a draft.
  if (!existing) {
    if (!PAYROLL_CREATE_STATUSES.includes(to)) return { reason: 'illegal_workflow_transition', status: 403, recordId: rec.id };
    if (!can(user, 'payroll.generate')) return { reason: 'permission_denied', status: 403, recordId: rec.id };
    return null;
  }

  // Stale or identical echo — no change will be applied, nothing to authorize.
  if (!recordWouldChangeStored(existing, rec)) return null;

  // Rejection history is a financial audit trail: append-only exact-prefix validation.
  const exHist = Array.isArray(existing.rejectionHistory) ? existing.rejectionHistory : [];
  const inHist = Array.isArray(rec.rejectionHistory) ? rec.rejectionHistory : [];
  if (inHist.length < exHist.length) {
    return { reason: 'history_tampering_detected', status: 403, recordId: rec.id };
  }
  for (let i = 0; i < exHist.length; i++) {
    if (JSON.stringify(inHist[i]) !== JSON.stringify(exHist[i])) {
      return { reason: 'history_tampering_detected', status: 403, recordId: rec.id };
    }
  }

  const from = existing.status || 'draft';

  // Same-status write = an edit to the batch (generate/recalc, correction).
  if (from === to) {
    if (!can(user, 'payroll.edit')) return { reason: 'permission_denied', status: 403, recordId: rec.id };
    return null;
  }

  // Status change: must be a legal transition AND the user must hold the exact
  // permission the client maps to that destination.
  const allowed = PAYROLL_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) return { reason: 'illegal_workflow_transition', status: 403, recordId: rec.id };
  const perm = TRANSITION_PERMISSIONS.payrolls[to];
  if (!perm || !can(user, perm)) return { reason: 'permission_denied', status: 403, recordId: rec.id };
  return null;
}

function authorizeEosbRecord(ctx, rec, storedData) {
  const { user } = ctx;
  const existing = findStoredById(storedData, rec && rec.id);
  const to = (rec && rec.status) || 'draft';

  // Paid settlements are sealed: only the cancel-payment transition may move
  // them (paid → approved), never a plain content write and never another status.
  if (existing && existing.status === 'paid') {
    if (to === 'approved') {
      if (!recordWouldChangeStored(existing, rec)) return null;
      if (!can(user, TRANSITION_PERMISSIONS.eosb.approved)) return { reason: 'permission_denied', status: 403, recordId: rec.id };
      return null;
    }
    if (to !== 'paid') return { reason: 'paid_batch_immutable', status: 403, recordId: rec.id };
    if (recordWouldChangeStored(existing, rec)) return { reason: 'paid_batch_immutable', status: 403, recordId: rec.id };
    return null; // unchanged echo
  }

  if (!existing) {
    if (!EOSB_CREATE_STATUSES.includes(to)) return { reason: 'illegal_workflow_transition', status: 403, recordId: rec.id };
    if (!can(user, 'eosb.calculate')) return { reason: 'permission_denied', status: 403, recordId: rec.id };
    return null;
  }

  if (!recordWouldChangeStored(existing, rec)) return null;

  const from = existing.status || 'draft';

  if (from === to) {
    // Same-status write: a calculation/edit on a draft (returned or fresh).
    if (!can(user, 'eosb.calculate')) return { reason: 'permission_denied', status: 403, recordId: rec.id };
    return null;
  }

  const allowed = EOSB_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) return { reason: 'illegal_workflow_transition', status: 403, recordId: rec.id };
  const perm = TRANSITION_PERMISSIONS.eosb[to];
  if (!perm || !can(user, perm)) return { reason: 'permission_denied', status: 403, recordId: rec.id };
  return null;
}

function authorizeIncrementRecord(ctx, rec, storedData) {
  const { user } = ctx;
  const existing = findStoredById(storedData, rec && rec.id);
  if (!existing) {
    // Creating an increment (salary increment / deduction / bonus) — branch_hr
    // holds increments.add for exactly this and never increments.edit.
    if (!can(user, 'increments.add')) return { reason: 'permission_denied', status: 403, recordId: rec.id };
    return null;
  }
  if (!recordWouldChangeStored(existing, rec)) return null;
  if (!can(user, 'increments.edit')) return { reason: 'permission_denied', status: 403, recordId: rec.id };
  return null;
}

// ----- Write scope validation -----
export function scopeValidateWrite(collection, incoming, ctx, getAllEmployees, storedData = null) {
  if (!Array.isArray(incoming)) return { ok: false, reason: 'payload_not_array', status: 400 };
  if (isSuper(ctx.user)) return { ok: true };
  if (incoming.length === 0) return { ok: true };

  const { scope } = ctx;
  const employees = getAllEmployees ? getAllEmployees() : [];

  for (const rec of incoming) {
    if (!rec || typeof rec !== 'object') continue;

    let ok = false;
    // Set by the workflow cases (payrolls / increments / eosb): a more precise
    // reason than the generic scope_violation when the per-record state-machine
    // or record-level permission check is what turned the record down.
    let flow = null;
    switch (collection) {
      case 'companies':
        // ownCompanyOnly: can only modify their own company record
        ok = rec.id === scope.companyId;
        break;

      case 'payrolls': {
        // batch must have companyId and branchId in scope AND all items in scope
        let compOk = true;
        let branchOk = true;
        if (scope.compScoped) {
          const cId = rec.companyId;
          if (!cId || cId === 'all' || cId !== scope.companyId) compOk = false;
        }
        if (scope.branchScoped) {
          const bId = rec.branchId;
          if (!bId || bId === 'all') {
            branchOk = false;
          } else if (scope.allowedBranchIds && scope.allowedBranchIds.size > 0) {
            if (!scope.allowedBranchIds.has(bId)) branchOk = false;
          } else if (scope.branchId && scope.branchId !== 'all') {
            if (bId !== scope.branchId) branchOk = false;
          }
        }
        if (!compOk || !branchOk) {
          ok = false;
        } else {
          const items = rec.items || [];
          ok = items.length === 0 || items.every(it => {
            const empScope = resolveEmpScope(it.employeeId, employees);
            const itemComp = it.companyId || empScope.companyId;
            const itemBranch = it.branchId || empScope.branchId;
            return isItemPermitted({ companyId: itemComp, branchId: itemBranch }, scope);
          });

          if (ok) {
            // The FULL state-machine + per-record authorization runs here. The
            // per-record layer covers F-06/F-07 protections (paid immutability,
            // snapshot tampering, rejection-history truncation) and — for the
            // first time — the OFFICIAL transition matrix and the exact
            // transition permission (HR07), without requiring payroll.edit for
            // actions that audit_reviewer / payments_officer legitimately own
            // (HR01).
            flow = authorizePayrollRecord(ctx, rec, storedData);
            if (flow) ok = false;
          }
        }
        break;
      }

      case 'increments': {
        // employee-scoped scope check, then per-record create/edit authorization.
        ok = isItemPermittedByEmployee(rec, scope, employees);
        if (ok) {
          flow = authorizeIncrementRecord(ctx, rec, storedData);
          if (flow) ok = false;
        }
        break;
      }

      case 'eosb': {
        ok = isItemPermittedByEmployee(rec, scope, employees);
        if (ok) {
          flow = authorizeEosbRecord(ctx, rec, storedData);
          if (flow) ok = false;
        }
        break;
      }

      case 'deleted_records':
        // tombstone data.companyId/branchId/employeeId
        const d = rec.data || {};
        ok = isItemPermittedByEmployee(d, scope, employees);
        break;

      default:
        if (EMPLOYEE_COLLECTIONS.has(collection)) {
          ok = isItemPermittedByEmployee(rec, scope, employees);
        } else {
          // direct scope fields
          ok = isItemPermitted(rec, scope);
        }
    }

    if (!ok) {
      if (flow) return { ok: false, reason: flow.reason, status: flow.status || 403, recordId: flow.recordId || rec.id };
      return { ok: false, reason: 'scope_violation', status: 403, recordId: rec.id };
    }
  }
  return { ok: true };
}

// ----- Password masking / preservation -----
export function maskPasswords(users) {
  if (!Array.isArray(users)) return users;
  return users.map(u => {
    const { password: _pw, ...safe } = u;
    return safe;
  });
}

// When writing users, preserve stored password if incoming omits it
export function mergeUsersPreservePassword(stored, incoming) {
  if (!Array.isArray(stored)) stored = [];
  if (!Array.isArray(incoming)) return stored;

  const storedMap = new Map(stored.map(u => [u.id, u]));
  const incomingMap = new Map(incoming.map(u => [u.id, u]));

  // For each incoming user, if password is missing, carry forward stored password
  const merged = incoming.map(u => {
    const storedUser = storedMap.get(u.id);
    if (storedUser && !u.password && storedUser.password) {
      return { ...u, password: storedUser.password };
    }
    return u;
  });

  // Preserve protected/system accounts that aren't in incoming
  for (const [id, su] of storedMap) {
    if (su.protected && !incomingMap.has(id)) {
      merged.push(su);
    }
  }

  return merged;
}