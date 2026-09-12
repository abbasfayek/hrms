# P10-1 — Server-side RBAC + Company/Branch Isolation (C-2)

> Status: **PLAN — awaiting approval. No implementation code yet.**
> Baseline: commit `6981083` (official). Scope: server only. Client (P1–P8/P9 UI) untouched.

---

## 1. Problem (C-2, Critical)

The server authenticates *sessions* but never resolves **who** the session belongs to.
`authorize()` (server.js:348-355) returns `{ ok: true, via: 'user' }` for **any** valid
user session, with no role, no company/branch scope and no permission check. Consequences:

- `GET /api/data/:collection` (server.js:391-406) returns the **entire** collection to any
  logged-in user — all companies, all employees, all salaries, all users (incl. password
  hashes), global settings, audit events, deletion tombstones.
- `POST /api/data/:collection` (server.js:409-443) accepts **whole-array replace/merge**
  writes from any session. `mergeCollection` (server.js:492-515) lets an incoming record
  with a newer `updatedAt` overwrite any stored record — so a tampered payload can forge
  out-of-scope records (cross-company write), and non-merge collections (`users`,
  `settings`, `deleted_records`, `audit`, `audit_trail`) can be fully overwritten.
- Privilege escalation: any session can POST `users` (e.g. create a `super_admin`, or
  change their own user record to `super_admin`, or edit another user's password hash) and
  can `POST /api/restore` (server.js:538-550) which overwrites every collection.
- `POST /api/access-token` (server.js:826) can be rotated by **any** user session.

The browser's UI already filters data (`storage.getState()` branch isolation) and checks
permissions client-side, but that is cosmetic — a modified DevTools request/payload bypasses
it entirely.

## 2. Source of truth (no blind trust of the browser)

| Fact | Source of truth | Why it can't be spoofed |
|---|---|---|
| Who is calling | `X-Session-Token` → `sessions` map (token=128-bit random, 12h, sliding) → `userId` | Token issued only by `/api/auth/login` after PBKDF2 verification; server-generated |
| Role, assignedCompanyId, assignedBranchId | `users.json` row for `session.userId` (fields `role`, `assignedCompanyId`, `assignedBranchId`) | Read from disk at request time; never parsed from headers/body |
| Effective permissions | `user.permissions` array if present, else role defaults | Computed server-side from a pinned catalog (`server-authz.mjs`), mirroring `types.js` semantics |
| Permission catalog & role defaults | `server-authz.mjs` + parity test against `public/js/types.js` (parsed as text) | `p10-1-tests` asserts exact set equality → catalog drift fails CI |

Client-supplied identity/perms/scope headers (e.g. `X-Role`, `X-Company-Id`,
`X-Permissions`, body role fields) are **ignored**; requests are always resolved from the
session.

## 3. Endpoint inventory & required protection

Read = `GET`, Write = `POST`. Status codes: 401 = no/invalid session; 403 = session ok but
no permission or out of scope.

| Endpoint | Baseline guard (today) | P10-1 guard | Notes |
|---|---|---|---|
| `GET /api/status` | public | unchanged | health/gate probe only |
| `POST /api/auth/session` | master token / rate-limit | unchanged | gate session |
| `POST /api/auth/login` | weak-login rate-limit | unchanged | real login, creates `user` session |
| `GET /api/download-template` | public | unchanged | no PII |
| `GET /api/data/companies` | any session | `companies.view` + scope (non-super sees only own company+branches) | |
| `GET /api/data/{employees,leaves,hourly_leaves,overtime,loans,increments,attendance,holidays,payrolls,eosb}` | any session | matching `<module>.view` + row scope filter | payrolls: batch visible only if every item is in scope |
| `GET /api/data/users` | any session | `users.view` **and** super_admin; password hashes **masked** | |
| `GET /api/data/settings` | any session | `settings.view` **and** super_admin | global singleton |
| `GET /api/data/audit` | any session | `audit.view` + row scope filter (rows w/o scope → super only) | |
| `GET /api/data/audit_trail` | any session | `audit.view` + event scope filter | envelope `{events:[...]}` |
| `GET /api/data/deleted_records` | any session | super_admin only | |
| `POST /api/data/{…employee collections…}` | any session | module add/edit/delete perms + **scope-validate every record** (reject 403 whole payload if any record out of scope) | atomic, fail-closed |
| `POST /api/data/payrolls` | any session | `payroll.edit/generate` + batch & every item in scope | |
| `POST /api/data/companies` | any session | `companies.manage`; non-super may only edit **their own** company; create/other-company **403** (H-1 remains until P10-3 fixes the role default) | |
| `POST /api/data/users` | any session | `users.manage` **and** super_admin | blocks account creation / self-promotion / password tamper |
| `POST /api/data/settings` | any session | `settings.manage` **and** super_admin | |
| `POST /api/data/audit`, `audit_trail` | any session | super_admin only | client computes chain; ingest kept super-only for C-2 |
| `POST /api/data/deleted_records` | any session | record's module delete perm + tombstone scope; super unrestricted | |
| `POST /api/data/corrections` | 400 "Invalid collection" | **unchanged (out of C-2)** — corrections are not persisted server-side today; server persistence is a documented later item (P10-2/P10-3) | negative test pins the 400 |
| `GET /api/backup` | any session | super_admin only; backup payload must **mask** password hashes | |
| `POST /api/restore` | any session | super_admin only | |
| `POST /api/import-employees` | any session | `employees.add` + imported array scope-validated; `mode:"replace"` → super_admin only | |
| `POST /api/access-token` | any session OR token | super_admin (user path) OR current master token | |

## 4. Scope algorithm (server mirror of the locked client logic)

Mirrors `storage.getState()` (storage.js:633-740) — same rules, authoritative from the
session user:

```
companyScopedRoles = ['company_hr','branch_hr','payroll_admin','audit_reviewer','payments_officer']
compScoped   = role!=='super_admin' && (companyScopedRoles.includes(role) ||
                                 (assignedCompanyId && assignedCompanyId!=='all'))
branchScoped = compScoped && assignedBranchId && assignedBranchId!=='all'
```

- **Reads**: filter by `isItemPermitted(item)` (item.companyId/branchId === assigned scope or
  `'all'`) **plus** `permittedEmpIds` (employeeId indirection); payroll batches require **all**
  items in scope (storage.js:710-714). Super admin = unfiltered.
- **Writes (scope validation, atomic)**: for each incoming record resolve its owning scope:
  - direct fields `companyId`/`branchId` (employees, holidays, companies, payrolls),
  - `employeeId` → look up that employee's company/branch server-side (leaves, hourly_leaves,
    overtime, loans, increments, attendance, eosb),
  - deleted_records tombstone → `data.companyId`/`branchId`/`employeeId`.
  If ANY record resolves outside the caller's scope → reject the whole POST with **403** and
  do not write anything (prevents merge/overwrite attacks, e.g. forging an out-of-scope
  record with a newer `updatedAt`).

## 5. Privilege-escalation closures

1. Server derives role/perms/scope **only** from `session → users.json`. Headers/body fields
   that assert role/permissions/company are ignored (pinned by test N14).
2. `users` collection write is super_admin-only → cannot create an admin, cannot self-promote,
   cannot edit another user's password, cannot add hidden/protected accounts.
3. `/api/restore`, `/api/backup`, `/api/access-token` narrowed to super_admin (backup masks hashes).
4. `/api/data/settings`, `audit`, `audit_trail` super-only writes.
5. Password hashes are masked on every users read (GET data, backup); hashes only leave disk
   as writes from super_admin through the app.
6. Read permissions enforced per collection (payments_officer still has no `employees.view`
   even though it has a session).

### 5.1 Password-write preservation (required by the masking change)

Masking `password` on users reads means the client will later POST the users array **without**
hashes. A naive full-replace write would then wipe every stored credential (and offline login).
So the users write path must **carry forward the stored hash when the incoming record omits
`password`** (same spirit as the existing protected-account merge). This is pinned by test
**N22b**: after a super_admin posts the masked users array, a scoped user must still be able
to log in.

## 6. Implementation shape (server only, minimal diff)

- **New file `server-authz.mjs`** (root, ESM, mirroring the current `server.js` style):
  - pinned `ALL_PERMISSIONS`, `DEFAULT_ROLE_PERMISSIONS` (parity-tested against types.js),
  - `getEffectivePerms(user)`, `can(user, perm)`,
  - `resolveAuthContext(req)` → `{ user, perms }` from `X-Session-Token` (reuses `sessions`),
  - scope helpers: `companyScopedRoles`, `isScoped`, `isSuper`, `isItemPermitted`,
  - `READ_GATES` / `WRITE_GATES` (collection → role/perm policy),
  - `filterCollectionRead(collection, data, ctx)`,
  - `scopeValidateWrite(collection, incoming, ctx, stateProvider)`.
- **`server.js` changes (surgical)**: replace the blanket `authorize()` with context
  resolution; gate each endpoint in `handleAPI`; mask password hashes on `users` reads and
  backup; keep hashing/merge/session logic untouched.
- **No client changes.** The existing client already handles 401/403 gracefully
  (`persistToServer` catch → `serverSyncAvailable=false`; `syncFromServer` skips `!res.ok`),
  and sends exactly the scoped data for legit users — so a legit scoped user's reads/writes
  keep working; super admin behaves exactly as today.

## 7. Deliverables & gates (per user's Phase-10 rules)

- `scripts/p10-1-tests.mjs` — negative security battery (this repo). Red on baseline
  (proves C-2), green after implementation. Harness = live server on a **temp copy** of the
  app (pattern proven by `release-gate-test-part-b.mjs`): seeds scoped test users with
  known passwords, a second company `comp-2`, cross-company employees/payrolls/audit
  events/deleted tombstones. Never touches real `data/`.
- Beat the tests: every negative scenario asserts the protected property (403 / scoped
  payload / masked hashes / atomic unchanged data), not implementation details.
- Regression after implementation: full battery `p9:test`, `branch:isolation`, release gate
  (part B live), P2.2 roles, build. Any regression → stop and fix before moving on.
- Single commit, message following repo style (e.g.
  `P10-1: server-side RBAC + company/branch isolation on /api`). Independent release report.

## 8. Out of scope (later P10 items — not part of this commit)

- Corrections server persistence + protection (P10-2/P10-3).
- `company_hr` default `companies.manage` removal in client role defaults (P10-3, H-1) —
  server already fails closed here.
- getState stream tighten-ups (companies/audit/auditTrail/rawEmployees) on the client (P10-3).
- XSS, audit-trail UI, payslip SSOT, GOSI gate, notifications, backup automation (P10-4..10).

## 9. Test-seed fixture (temp copy only)

Seeded into the throwaway copy of `data/` (never the real workspace):

| User | role | scope | purpose |
|---|---|---|---|
| `system` (factory cred) | super_admin | all | global control / compatibility |
| `c2-hr` | company_hr | comp-2 / all | cross-company read/write attacks |
| `c1b2-hr` | branch_hr | comp-1 / br-1788788794421 | branch scoping |
| `c2-pay` | payroll_admin | comp-2 / all | payroll cross-company |
| `c1-payoff` | payments_officer | comp-1 / br-1 | read/write permission denial |
| `c1-audit` | audit_reviewer | comp-1 / br-1 | audit_trail scoping |

Data seeds: `comp-2` (+branches), comp-2 employees, comp-1/comp-2 payroll batches,
comp-1/comp-2 audit events + 1 global event, comp-1/comp-2 deleted tombstones.

## 10. Red / Green evidence

- **Red (this plan)**: `node scripts/p10-1-tests.mjs` on baseline `6981083` → **24 negative
  asserts fail, 10 canaries pass** (each failure names the leak/scope/escalation; evidence
  captured in the terminal output). The battery is split into hermetic phases (fresh temp
  server per phase) because some vulnerable-baseline writes mutate shared state.
- **Green (after implementation)**: same file, assert-for-assert → all 34 pass; canaries
  (anonymous 401, wrong login 401, super_admin full access, legit scoped writes, password
  survival) stay green.

### Baseline red summary (per area)

| Area | Failing asserts |
|---|---|
| Cross-company/branch reads | N03 employees, N04 branch, N05 payroll, N16b payout, N06 companies |
| Global collection leaks | N07 users, N08 settings, N09b deleted_records |
| Permission vs auth | N16 payments_officer reads employees |
| Header tamper | N14 role/scope headers ignored |
| Cross-company writes | N10 forged employee, N10b persisted, N25 employeeId indirection |
| Audit scope | N23 audit_trail, N23b legacy audit |
| Privilege escalation | N12 create admin, N13 self-promote, N19 restore, N20 backup, N24 new tenant, N18/N18b import, N28 access-token |
| Password hygiene | N21 hashes exposed on users read |
| Canaries (green) | N01, N02, N31, N32, N11, N33, N22, N22b, N34, N27 |