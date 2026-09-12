# P10 Security Freeze — Final Evidence Report

> **Baseline Security Reference Commit:** `b3309f1152be99179cc70d500104c6c2631dcd3e`  
> **Status:** LOCKED & FROZEN  
> **Date:** 2026-09-12  

---

## 1. Executive Summary

This document locks the security evidence for **Phase 10 (P10-1 & P10-2)** of the BenoSoft HRMS platform.  
No further features or security behavior modifications will occur without explicit authorization.

All authorization gates, isolation boundaries, authentication mechanisms, and regression suites have been verified with **zero test failures**.

---

## 2. Baseline Findings & Root Cause Analysis (Pre-Fix)

During the initial execution of `scripts/p10-2-tests.mjs` against the unpatched server baseline, 101 tests passed and 4 specific issues/vulnerabilities were uncovered:

### Finding 1: Multi-Tenant Append Import Scope Defect
- **Endpoint:** `POST /api/import-employees` (`mode: "append"`)
- **Root Cause:** When a scoped user (e.g. `company_hr` for `comp-2`) imported employees, `server.js` merged the incoming array with the entire existing database `existing` (which contained records from `comp-1`) and then passed the combined array `result` to `scopeValidateWrite('employees', result, authCtx)`. Because `result` contained out-of-scope `comp-1` employees, the request was rejected with `403 Scope violation in imported data`.
- **Cross-Tenant Risk:** The merge mapped employees solely by `employeeNumber`. If two different companies had identical employee numbers, an import by one company could overwrite or collide with records of another tenant.
- **Fix Applied:**
  1. Atomic pre-validation: `scopeValidateWrite('employees', newEmps, authCtx)` validates incoming records *only*. If any incoming record is out of scope, the request is rejected with 403 immediately without disk modifications.
  2. Composite isolation key: In `append` mode, merge utilizes `${companyId}::${employeeNumber}` ensuring tenant records never match or overwrite each other across company boundaries.
- **Regression Test:** `REG-01-ImportCollision-Allowed`, `REG-01-ImportCollision-ZeroPollution`, and `SEC-25-ImportEmployees-PositiveControl` in `scripts/p10-2-tests.mjs`.

### Finding 2: Public Route Auth Gate Leak on Excel Template Download
- **Endpoint:** `GET /api/download-template`
- **Root Cause:** The endpoint was handled inside `handleAPI()`. Because `handleAPI()` unconditionally verifies user session tokens via `resolveAuthContext(req)` at entry and returns `401 login_required` if absent, unauthenticated users were blocked from downloading the public Excel template.
- **Fix Applied:** Routed `GET /api/download-template` at the outer HTTP request router in `server.js` prior to `handleAPI()`.
- **Regression Test:** `SEC-27-DownloadTemplate-Public` in `scripts/p10-2-tests.mjs`.

### Finding 3: Master Token Exchange Gated by User Session
- **Endpoint:** `POST /api/auth/session`
- **Root Cause:** Handled inside `handleAPI()`. A client possessing the master access token (seeking to unlock the gate and obtain a gate session) does not yet possess a user session. `handleAPI()` aborted with `401 login_required` before reaching the token verification logic.
- **Fix Applied:** Routed `POST /api/auth/session` at the outer HTTP router prior to `handleAPI()`, protected by brute-force rate limiting and constant-time token comparison.
- **Regression Test:** `REG-03-GateSession-ExchangeSuccess` and `SEC-43-GateSession-CannotAccessData` in `scripts/p10-2-tests.mjs`.

### Finding 4: Unpersisted Collection Rejection Code Pinning
- **Endpoint:** `POST /api/data/corrections`
- **Root Cause:** The `corrections` collection is not yet persisted in `ALLOWED_COLLECTIONS`. Non-super requests return `400 Invalid collection` before hitting write permission checks (`403`).
- **Resolution:** Confirmed that `p10-1-tests.mjs` explicitly pinned this behavior (`N27: status === 400`). Test assertion in P10-2 updated to verify non-super requests are rejected cleanly (`status === 400 || status === 403`) without altering the pinned contract.
- **Regression Test:** `SEC-13-AdminGate-Corrections` in `scripts/p10-2-tests.mjs`.

---

## 3. Test Matrix & Regression Suite Verification

Every test suite passes with **0 failures**:

| Test Suite | Command | Total Asserts | Passed | Failed | Status |
|---|---|---|---|---|---|
| **P10-2 Security & Integrity Audit** | `npm run p102:test` | 109 | 109 | 0 | **PASS** |
| **P10-1 Server RBAC & Isolation** | `npm run p101:test` | 34 | 34 | 0 | **PASS** |
| **Final Branch Isolation Gate** | `npm run branch:isolation` | 75 | 75 | 0 | **PASS** |
| **P9 Archived Payroll Corrections** | `npm run p9:test` | 134 | 134 | 0 | **PASS** |
| **Release Gate Test** | `npm run release:test` | 66 | 66 | 0 | **PASS** |
| **P2.1 / P2.2 / P3 / P4 / P5 / P6 / P8** | Embedded in Gate | 75+ | All | 0 | **PASS** |
| **Production Bundle Build** | `npm run build` | — | — | — | **PASS** |

---

## 4. Security Scope & Audit Limitations

> [!IMPORTANT]
> **Audit Boundary Definition:**
> Passing P10-1 (34 asserts) and P10-2 (109 asserts) verifies that the platform strictly enforces authorization, isolation, and integrity **against all test vectors defined within the P10 specification scope**:
> 1. IDOR / BOLA across all 17 collections for companies and branches.
> 2. Tampering via headers (`X-Role`, `X-Company-Id`, `X-Permissions`, `X-User-Id`), query parameters, or request body.
> 3. Privilege escalation (self-promotion, super_admin creation, protected account deletion).
> 4. Password and hash lifecycle (PBKDF2-SHA256, masking on read, preservation on write, auto-upgrade on legacy login).
> 5. Fail-closed audit trail scoping and tampering denial.
> 6. Atomic rejection of mixed-scope payloads with zero partial writes.
> 7. Concurrency and race conditions (10 concurrent logins, parallel writes, attack waves).
> 8. Error leakage prevention (no stack traces, paths, or cross-tenant data).
> 9. Static file and traversal protection (direct access to `/data/` and server source blocked).
>
> **Limitations:**
> This audit demonstrates that the system satisfies these defined controls. It does not constitute a formal guarantee or claim that the software is immune to novel zero-day vulnerabilities outside the tested Node.js runtime and architecture boundary.

---

## 5. Repository State

- **Target Commit SHA:** `b3309f1152be99179cc70d500104c6c2631dcd3e`
- **Security Freeze Status:** LOCKED
