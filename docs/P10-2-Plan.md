# P10-2 — Security & Integrity Deep Audit

> **Goal:** Comprehensive security audit of all API endpoints after P10-1. No features/UI. Only vulnerability discovery + regression tests.

---

## 1. Complete API Endpoint Inventory

### Public Endpoints (No Auth Required)

| Method | Path | Handler | Auth | Notes |
|---|---|---|---|---|
| GET | `/api/status` | Main handler | None | Health check, shows `protected` flag |
| POST | `/api/auth/login` | Main handler | None | Rate-limited, PBKDF2 verify, returns user session |
| GET | `/api/download-template` | Main handler | None | Public Excel template |

### Protected Endpoints (Require Valid User Session via `X-Session-Token`)

All routed through `handleAPI()` → `resolveAuthContext()` → permission/scope checks.

| Method | Path | Collection/Action | Read Perm | Write Perm | Scope Validate | Notes |
|---|---|---|---|---|---|---|
| POST | `/api/access-token` | Master token mgmt | — | `super_admin` (via `access-token` gate) | — | Rotates/disables token; kills all sessions |
| POST | `/api/auth/session` | Gate session | — | Master token only | — | Exchanges master token for short-lived gate session |
| GET | `/api/data/:collection` | 17 collections | Per-collection | — | Yes (row-level) | Row filtering by company/branch/employeeId |
| POST | `/api/data/:collection` | 17 collections | — | Per-collection | Yes (atomic) | Atomic rejection if any record out of scope |
| GET | `/api/backup` | Full backup | `users.manage` (super_admin) | — | N/A | Masks password hashes in users |
| POST | `/api/restore` | Full restore | — | `users.manage` (super_admin) | N/A | Replaces entire collections |
| POST | `/api/import-employees` | Employee import | — | `employees.add` | Yes | `replace` mode = super_admin only |
| GET | `/api/download-template` | Excel template | None | — | N/A | Public |

### Collections (17 in `ALLOWED_COLLECTIONS`)

| Collection | Type | Merge? | Scope Fields | Employee Indirection | Read Perm | Write Perm | Super Only |
|---|---|---|---|---|---|---|---|
| `companies` | Admin | Yes | `id`, `branchId` | No | `companies.view` | `companies.manage` | No* |
| `users` | Admin | No | — | No | `users.view` | `users.manage` | **Yes** |
| `settings` | Admin | No | — | No | `settings.view` | `settings.manage` | **Yes** |
| `employees` | Employee | Yes | `companyId`, `branchId` | Self (`id`) | `employees.view` | `employees.edit` | No |
| `leaves` | Employee | Yes | `companyId`, `branchId` | `employeeId` | `leaves.view` | `leaves.edit` | No |
| `hourly_leaves` | Employee | Yes | `companyId`, `branchId` | `employeeId` | `hourlyLeaves.view` | `hourlyLeaves.edit` | No |
| `overtime` | Employee | Yes | `companyId`, `branchId` | `employeeId` | `attendance.view` | `attendance.edit` | No |
| `loans` | Employee | Yes | `companyId`, `branchId` | `employeeId` | `loans.view` | `loans.edit` | No |
| `increments` | Employee | Yes | `companyId`, `branchId` | `employeeId` | `increments.view` | `increments.edit` | No |
| `attendance` | Employee | Yes | `companyId`, `branchId` | `employeeId` | `attendance.view` | `attendance.edit` | No |
| `holidays` | Employee | Yes | `companyId`, `branchId` | No | `employees.view` | `employees.edit` | No |
| `payrolls` | Payroll | Yes | `companyId`, `branchId`, `items[].employeeId` | `items[].employeeId` | `payroll.view` | `payroll.edit` | No |
| `eosb` | EOSB | Yes | `companyId`, `branchId` | `employeeId` | `eosb.view` | `eosb.calculate` | No |
| `audit` | Audit | Yes | `companyId`, `branchId` | No | `audit.view` | `audit.view` (super) | No* |
| `audit_trail` | Audit | No | Event `companyId`, `branchId` | No | `audit.view` | `audit.view` (super) | No* |
| `deleted_records` | Audit | Yes | `data.companyId`, `data.branchId`, `data.employeeId` | `data.employeeId` | `audit.view` | `audit.view` (super) | **Yes** |
| `corrections` | Payroll | No | — | — | `payroll.correction.create` | `payroll.correction.create` | **Yes** |

* `companies.manage` for non-super is limited to own company only (P10-1 restriction)
* `audit`/`audit_trail` write = super_admin only; scoped reads via `audit.view`

---

## 2. Authorization Architecture Verification

### 2.1 All Sensitive Endpoints → `resolveAuthContext()`

**Required:** Every endpoint except the 3 public ones must call `resolveAuthContext()` and enforce:
- Valid user session (not gate, not master)
- User exists in `users.json`
- Sliding session renewal (12h)

**Current state (P10-1):**
- ✅ `handleAPI()` resolves context at entry
- ✅ All collection endpoints go through `handleAPI()`
- ✅ `/api/backup`, `/api/restore`, `/api/import-employees`, `/api/access-token` go through `handleAPI()`
- ✅ `/api/auth/session` handled separately but validates master token
- ✅ Public endpoints explicitly listed

**Gaps to verify:**
- No hidden routes bypassing `handleAPI()`
- No `GET` with body bypassing auth
- No alternative parameter paths (e.g., `/api/data/companies?id=xxx`)

---

## 3. IDOR/BOLA Test Matrix

### 3.1 Cross-Company Read (Company A user reads Company B data)

| Collection | Test | Expected |
|---|---|---|
| `employees` | GET `/api/data/employees` as company_hr(comp-2) | Only comp-2 employees |
| `leaves` | GET `/api/data/leaves` as company_hr(comp-2) | Only comp-2 employees' leaves |
| `payrolls` | GET `/api/data/payrolls` as payroll_admin(comp-2) | Only comp-2 batches |
| `companies` | GET `/api/data/companies` as company_hr(comp-2) | Only comp-2 record |
| `audit` | GET `/api/data/audit` as audit_reviewer(comp-1) | Only comp-1 events |
| `audit_trail` | GET `/api/data/audit_trail` as audit_reviewer(comp-1) | Only comp-1 events (fail-closed globals) |
| `deleted_records` | GET as company_hr(comp-2) | 403 (super_only) |

### 3.2 Cross-Branch Read (Branch HR reads other branch)

| Collection | Test | Expected |
|---|---|---|
| `employees` | GET as branch_hr(comp-1/br-2) | Only br-2 employees |
| `attendance` | GET as branch_hr(comp-1/br-2) | Only br-2 attendance |

### 3.3 Cross-Company Write (Company A user writes Company B data)

| Collection | Test | Expected |
|---|---|---|
| `employees` | POST forged comp-1 employee as company_hr(comp-2) | 403 atomic rejection |
| `leaves` | POST leave with comp-1 employeeId as company_hr(comp-2) | 403 |
| `payrolls` | POST batch with comp-1 items as payroll_admin(comp-2) | 403 |
| `companies` | POST new company as company_hr(comp-2) | 403 (own company only) |
| `deleted_records` | POST tombstone for comp-1 employee as company_hr(comp-2) | 403 |

### 3.4 Cross-Branch Write (Branch HR writes other branch)

| Collection | Test | Expected |
|---|---|---|
| `employees` | POST employee with br-1 branchId as branch_hr(comp-1/br-2) | 403 |

---

## 4. Header/Body Tampering Resistance

### 4.1 Forbidden Headers (Must Be Ignored)

| Header | Test | Expected |
|---|---|---|
| `X-Role` | Send `X-Role: super_admin` | Ignored, scope unchanged |
| `X-Company-Id` | Send `X-Company-Id: all` | Ignored |
| `X-Branch-Id` | Send `X-Branch-Id: all` | Ignored |
| `X-Permissions` | Send comma-separated perms | Ignored |
| `X-User-Id` | Send different userId | Ignored |

### 4.2 Body Fields (Must Not Influence Auth)

| Field | Test | Expected |
|---|---|---|
| `role` in user record | POST users with `role: super_admin` | Ignored/403 |
| `assignedCompanyId` | POST user with `assignedCompanyId: all` | Ignored/403 |
| `permissions` array | POST user with extra perms | Ignored/403 |

---

## 5. Admin Operations RBAC + Scope

| Operation | Role | Expected |
|---|---|---|
| `GET /api/backup` | super_admin | 200, passwords masked |
| `GET /api/backup` | company_hr | 403 |
| `POST /api/restore` | super_admin | 200 |
| `POST /api/restore` | company_hr | 403 |
| `POST /api/import-employees` (append) | company_hr(comp-2) | 200, scope validated |
| `POST /api/import-employees` (append, cross-company) | company_hr(comp-2) | 403 |
| `POST /api/import-employees` (replace) | super_admin | 200 |
| `POST /api/import-employees` (replace) | company_hr | 403 |
| `POST /api/access-token` | super_admin | 200 |
| `POST /api/access-token` | company_hr | 403 |
| `POST /api/data/companies` (new tenant) | company_hr | 403 |
| `POST /api/data/companies` (edit own) | company_hr(comp-2) | 200 |
| `GET /api/data/users` | super_admin | 200, no passwords |
| `GET /api/data/users` | company_hr | 403 |
| `POST /api/data/users` (add admin) | company_hr | 403 |
| `POST /api/data/settings` | super_admin | 200 |
| `POST /api/data/settings` | company_hr | 403 |

---

## 6. Privilege Escalation Vectors (Beyond P10-1)

| Vector | Test | Expected |
|---|---|---|
| Self-promote via users POST | company_hr POST users with own role=super_admin | 403 |
| Create hidden super_admin | company_hr POST users with hidden super_admin | 403 |
| Password replacement | POST users with new password hash for another user | 403 |
| Protected account deletion | POST users without protected system accounts | 403 (protected preserved) |
| Session fixation | Reuse old session token after password change | Session invalidated |
| Session hijacking via headers | Inject `X-Session-Token` from another user | 401/403 |
| Master token rotation by non-super | POST `/api/access-token` as company_hr | 403 |
| Backup + restore cycle | company_hr backup → modify → restore | 403 on both |
| Audit trail tampering | POST to audit/audit_trail as non-super | 403 |
| Deleted records manipulation | POST tombstones for other company | 403 |

---

## 7. Password/Hash Lifecycle

| Property | Test | Expected |
|---|---|---|
| No hash in any response | All GET endpoints | No `password` field anywhere |
| Hash preserved on users write | super_admin writes masked users → scoped user can still login | ✅ |
| No hash in backup | `GET /api/backup` | users have no `password` field |
| Hash upgrade on login | Login with plaintext → hash stored | ✅ |
| No hash in audit trail | Audit events never contain password | ✅ |

---

## 8. Audit Trail Integrity

| Property | Test | Expected |
|---|---|---|
| Non-super cannot read all events | audit_reviewer(comp-1) GET audit_trail | Only comp-1 events (fail-closed globals) |
| Non-super cannot write events | POST `/api/data/audit_trail` as company_hr | 403 |
| Events immutable | Attempt to modify audit_trail | 403 |
| Chain integrity | Verify hash chain after operations | Valid |
| Scope fail-closed | Global events (no companyId) hidden from scoped users | ✅ |

---

## 9. Read-Modify-Write Race Conditions

| Scenario | Test | Expected |
|---|---|---|
| Concurrent writes to same collection | Two sessions POST employees simultaneously | Last write wins (merge), no data loss |
| Read during write | GET during POST | Consistent view (server is single-threaded Node) |
| Scope check between read and write | Read scoped data → another admin changes scope → write | Scope validated on write (atomic) |
| Partial write on rejection | POST with 1 valid + 1 invalid record | Atomic 403, nothing written |

---

## 10. Atomic Authorization Rejection

| Operation | Test | Expected |
|---|---|---|
| POST employees (1 valid + 1 cross-company) | Mixed payload | 403, neither written |
| POST payrolls (mixed scope batches) | Mixed payload | 403 |
| POST deleted_records (mixed tombstones) | Mixed payload | 403 |

---

## 11. Concurrent Request Testing

| Scenario | Test | Expected |
|---|---|---|
| 10 parallel logins same user | All succeed, independent sessions | ✅ |
| 10 parallel writes same collection | All processed, merge semantics | ✅ |
| Parallel scope violations | Multiple cross-company writes | All 403, no partial writes |
| Session expiry during request | Expire session mid-request | 401 on next request |

---

## 12. Error Message Information Leakage

| Endpoint | Error | Must Not Leak |
|---|---|---|
| 401/403 responses | `error`, `code` | No internal IDs, no company names, no user emails, no stack traces |
| 500 responses | Generic `Server error` | No file paths, no SQL/queries, no internal details |
| Scope violation | `recordId` only | No cross-company data in error |

---

## 13. Bypass Surface Scan

| Potential Bypass | Check | Expected |
|---|---|---|
| `/api/data/companies?id=xxx` query params | `urlParts[3]` only, ignores query | 400/404 |
| `/api/data/companies/` trailing slash | `urlParts` split handles | 400/404 |
| `GET` with JSON body | `readBody` only on POST/PUT | Ignored |
| `PUT`/`DELETE` methods | Only GET/POST handled | 404/405 |
| Alternative routes | `/api/companies` vs `/api/data/companies` | 404 |
| Case sensitivity | `/api/Data/Employees` | 400/404 |
| Double encoding | `%2Fapi%2Fdata%2Femployees` | 404 |
| Null bytes | `/api/data/employees\0` | 400/404 |

---

## 14. Automated Test Coverage Requirement

Every vulnerability discovered → automated test in `scripts/p10-2-tests.mjs` covering:
- Negative test (expect rejection)
- Positive control (legit request works)
- Assertions on response code, body, and side effects (data unchanged)

---

## 15. Regression Suite Gates

All must pass after any fix:

| Suite | Command | Required |
|---|---|---|
| P9 | `npm run p9:test` | 134/134 |
| Branch isolation | `npm run branch:isolation` | 75/75 |
| Release gate | `npm run release:test` | 66/66 |
| P2.1 | `npm run p21:test` | 47/47 |
| P2.1 UI | `npm run p21:uitest` | 44/44 |
| P2.2 | `npm run p22:test` | 123/123 |
| P2.2 Roles | `npm run p22:roles:test` | 92/92 |
| P3 | `npm run p3:test` | 66/66 |
| P4 | `npm run p4:test` | 140/140 |
| P5 | `npm run p5:test` | 61/61 |
| P6 | `npm run p6:test` | 142/142 |
| Build | `npm run build` | ✅ |

---

## 16. Deliverables

1. `docs/P10-2-Plan.md` — This document
2. `scripts/p10-2-tests.mjs` — All automated tests
3. Final report with:
   - Vulnerabilities discovered (if any)
   - Fixes applied
   - Test count
   - All regression results
   - Commit SHA
   - Final verdict: any known remaining vulnerabilities?