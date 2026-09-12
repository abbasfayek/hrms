# Phase 9 — Post-Payment Payroll Corrections: Release Report

- **Date:** 2026-09-12
- **Spec:** `docs/P9-Archived-Payroll-Correction-Spec.md` v2.1 (§11.2–§11.13)
- **Status:** SHIPPED — all §11.13 execution steps complete (except step 12, which requires explicit approval to commit).

---

## 1. What was delivered

| # | §11.13 step | Deliverable |
|---|-------------|-------------|
| 1 | p9-tests first | `scripts/p9-tests.mjs` — drives §9 base cases + §11.10 component chains + §11.11 branch isolation + dual-approval / recovery / window / numbering / notification assertions → **134 passed / 0 failed** |
| 2 | Data Model | `public/js/engines/payrollCorrectionModel.js` — 12-code component catalog (+ `OTHER_*`), `correctionDisplayNumber`, `correctionFinancialView` (currency-segmented signed view), `COMPONENT_CATALOG` |
| 3 | Engine | `public/js/engines/payrollCorrectionEngine.js` — `createCorrection`, `computeNetEffective` (Original + Σ direction·amount), `transitionCorrection`, `coApproveCorrection`, `archiveCorrection`, window/state/resolve-chain, `Notification` policy (never silent) |
| 4 | Access / Permissions | `public/js/engines/payrollCorrectionAccess.js` — guarded entry points: `createPayrollCorrectionGuarded`, `transitionCorrectionGuarded`, `coApproveCorrectionGuarded`, `archiveCorrectionGuarded`; SoD-before-permission ordering; branch-isolation identity inheritance (L3) |
| 5 | Storage | `public/js/storage.js` — `getCorrections/rawCorrections/addPayrollCorrection` (number stamped at INSERT per Decision 7, never reused), rejection of re-writes on archived corrections, `_auditCorrection` event derivation, audit-integrity verified |
| 6 | UI | `public/js/components/PayrollCorrectionModal.js` (request form: direction, recovery, rate source, component lines with live Net/Effective preview, next-number preview) + `public/js/components/PayrollView.js` ("Corrections" tab, per-row "Correction" buttons on archived disbursed batches, action buttons with guarded transitions + audit writes) |
| 7 | Reports | `public/js/components/ReportsView.js` — "Corrections" tab: **Original | Corrections | Net/Effective** three-column summary (per-currency segmented), per-record table (number, direction, rate source, signed amount, recovery, status), Excel export gated by `reports.export`; i18n keys added (en/ar) |
| 8 | Phase gates | `scripts/final-branch-isolation-gate.mjs` → **75 passed / 0 failed** (runs P8 + P2.1-UI + release-gate internally) |
| 9 | Full P1–P8 regression | All green (see §2) |
| 10 | Build | `vite build` → production bundle built successfully (`dist/`) |
| 11 | Release Report | this document |

## 2. Verification results (all run locally, green)

| Suite | Command | Result |
|-------|---------|--------|
| Phase 9 contract | `npm run p9:test` | 134 / 0 |
| P3 | `npm run p3:test` | 66 / 0 |
| P4 | `npm run p4:test` | 140 / 0 |
| P5 | `npm run p5:test` | 61 / 0 |
| P6 | `npm run p6:test` | 142 / 0 |
| P2.1 matrix | `npm run p21:test` | 47 / 0 |
| P2.1 UI automation | `npm run p21:uitest` | 44 / 0 (includes 13 new P9 UI smoke tests) |
| P2.2 matrix | `npm run p22:test` | 123 / 0 |
| P2.2b roles/scope | `npm run p22:roles:test` | 92 / 0 |
| Branch-isolation gate | `npm run branch:isolation` | 75 / 0 |
| Release gate | `npm run release:test` | 66 / 0 |
| Production build | `npm run build` | success |
| Syntax | `node --check` on all modified JS | pass |

## 3. Approved business decisions applied (§11.12)

1. **Rate policy:** default = original snapshotted rate; **current** = explicit override.
2. **Recovery:** `next_payroll` / `separate_recovery` / `write_off` (write-off requires elevated permission + dual approval).
3. **Approval:** negative corrections → Dual Approval; creator cannot approve own.
4. **Window:** default same financial year (prospective configurable months).
5. **Notification:** auto on approval; delivery failure is never silent.
6. **Level:** component-level minimum — no blind lump-sum corrections.
7. **Numbering:** `{originalTransactionId}-CORR-{n}` (padStart(3)) + internal UUID, stamped at storage insert, never reused, archived corrections immutable.
8. **Display:** three columns `Original | Corrections | Net/Effective`, per-currency segmented.

## 4. Guardrails locked in L1–L5

- Archived original payroll is never modified (corrections are additive records).
- Corrections immutable after archive; identity inherited → branch isolation (mismatch = `branch_mismatch`, identity-less = `branch_context_required`).
- `Original + Σ(direction × amount) = Net/Effective` enforced and UI/report-tested.
- Audit trail: dedicated `CORRECTION_*` events with identity + financial + components; denials carry `requestedAction`; full effect visible in the Audit screen.

## 5. Residual risks / notes

- i18n audit reports ~877 pre-existing hard-coded UI literals (repo-wide convention, includes P9 inline strings); the fix added formal keys only for the new report title.
- `getAuditTrailMeta()` has no `envelope` property; integrity checks use `storage.auditTrailIntegrity().valid` (contract fixture updated accordingly).
- C04/engine contract nuance: a regenerated draft may reuse the identical payroll id; P9 verification seeds corrections against a genuinely archived stored batch.

## 6. Release checklist status

- [x] Tests (P0/C01–C20/MATRIX + full regression)
- [x] Gates (branch isolation + release gate)
- [x] Build
- [x] Release report
- [ ] Final commit — **pending explicit approval** (§11.13 step 12)

---

*Phase 9 release report — prepared after Step 11; Step 12 (commit) left for explicit request.*