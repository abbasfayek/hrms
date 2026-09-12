# Phase 9 Specification: Archived Payroll Correction / Post-Payment Correction

**Status:** P9 = DECISIONS APPROVED / **GO ISSUED** / CODE IN PROGRESS  
**Changes Confirmed:** All 8 decisions in §11.2–§11.9 reviewed and **approved by the approver** (confirmed in §11.12 with approver + date). The approver issued an **explicit GO** authorizing implementation. Execution follows the mandatory order in §11.13 once `p9-tests.mjs` (Step 1) is written.  
**Prerequisite:** Phase 1-8 Complete (all gates green)  
**Dependencies:** Phase 3 Data Model, Phase 4 Currency Governance, Phase 5 Audit Trail, Phase 6 Payroll Workflow, Phase 7 EOSB Workflow, Phase 8 Currency + Reports

---

## 0. IMMUTABLE RULES — FOUNDATIONAL BASELINE (Locked Before Any Implementation)

The following 13 rules constitute the **non-negotiable foundation** of Phase 9. They are locked and cannot be modified, waived, or bypassed by any implementation decision, business policy, or technical workaround. Any violation = spec breach.

| # | Immutable Rule | Enforcement |
|---|----------------|-------------|
| **1** | **Archived Payroll is Immutable** — No modification, deletion, or un-archiving for any reason. | Storage layer rejects write; audit trail logs denial. |
| **2** | **No Direct Modification After Archive** — Error discovered at any time (1 minute, 1 hour, 1 day, 1 month, 1 year) → original record NEVER modified. | State machine: `archived` is terminal; no transition out. |
| **3** | **Correction = New Transaction** — Linked via `originalTransactionId` to the archived payroll. | Data model requires `originalTransactionId` (FK to archived batch). |
| **4** | **Correction Workflow** — `Archived → Correction Request → Under Audit → Approved → Payment/Adjustment → Archive` | State machine enforced by guard layer (permission → scope → state). |
| **5** | **No Double Counting** — Correction is NOT an independent payroll. Reports: `Original + Corrections = Net/Effective`. | Aggregation logic in reports; audit event `CORRECTION_PAID` distinct from `PAID`. |
| **6** | **Reporting Formula** — `Original Amount + Corrections = Net / Effective Amount` (three-column view). | Report layer computes; Excel/Print = Screen. |
| **7** | **Original Snapshots Preserved** — Archived record retains: `rate`, `baseAmount`, `currency`, `exchangeRate`, `exchangeRateDate`, `baseCurrency`, `baseAmount` exactly as at approval/payment. | Storage never rewrites archived batch fields; `stampPayrollBatch` with `force=false` on committed records. |
| **8** | **No Historical Recalculation** — `baseAmount` never recomputed with current rate. Revaluation not supported. | `convertWithSnapshot` uses sealed snapshot; `stampPayrollBatch` skips sealed rows. |
| **9** | **Positive Correction** — Additional amount owed; paid/settled via workflow. | `direction: "credit"`; follows Payment/Adjustment → Archive. |
| **10** | **Negative Correction** — No automatic recovery assumed. Recovery method = Business Decision Matrix (Decision #2). | `direction: "debit"`; recovery logic NOT implemented without decision. |
| **11** | **Full Audit Trail** — Every correction logs: creator, reason, original record, original amount, correction amount, currency, rate, reviewer, approver, settlement method, timestamps. | P5 audit events: `CORRECTION_REQUEST`, `CORRECTION_REJECTED`, `CORRECTION_CORRECTED`, `CORRECTION_RESUBMITTED`, `CORRECTION_APPROVED`, `CORRECTION_PAID`, `CORRECTION_ARCHIVED`, `DENIED`. |
| **12** | **Zero Exception Window** — Even 1 hour after archive, NO direct modification. Rule 1 applies absolutely. | No time-based exception in state machine or guard layer. |
| **13** | **Controlled Correction Access** — Only authorized users with dedicated Correction Creation permission may initiate a Correction Request. The permission does NOT grant modify/delete/un-archive on the original record. Every action (create/review/reject/approve/settle) is logged in Central Audit Trail. | Guard layer enforces `payroll.correction.create` permission; scope check; audit logs every action; state machine rejects `archived → draft` transition. |

**These 13 rules are the contract. Implementation must pass tests proving each rule. No rule may be relaxed without formal spec amendment and re-baselining all gates.**

---

## 0a. CORRECTION REQUEST CREATION CONDITIONS (Rule 13 Enforcement)

A Correction Request may only be created when ALL of the following conditions are met. Any violation → request rejected at guard layer, denial logged in audit trail.

| # | Condition | Enforcement |
|---|-----------|-------------|
| 1 | **Dedicated Permission** — User holds `payroll.correction.create` (or equivalent dedicated role). | `requirePayrollCorrectionAction(user, 'create')` passes permission layer. |
| 2 | **Scope Compliance** — User's assigned company/branch includes the original payroll's company/branch. | `payrollBatchInScope(user, originalBatch)` returns true. |
| 3 | **Reason Required** — Non-empty `reason` field describing the error. | Guard rejects empty/whitespace reason. |
| 4 | **Affected Amount/Item Specified** — Correction payload includes `amount`, `currency`, and optional `employeeId`/`itemId` identifying the affected line. | Payload validation rejects missing amount/currency. |
| 5 | **Original Record Preserved** — No write to archived batch; new correction record created with `originalTransactionId`. | Storage `addPayrollCorrection` only inserts; never updates archived batch. |
| 6 | **Segregation of Duties** — Creator cannot approve their own correction. | `requirePayrollCorrectionAction(user, 'approve')` fails if `user.id === correction.createdBy`. |
| 7 | **Audit/Approval Required** — Correction must pass `under_audit → approved → paid → archive` workflow; no shortcuts. | State machine enforces transitions; guard layer blocks `create → paid`. |
| 8 | **No Un-archive** — Correction Request never transitions `archived → draft` on original record. | State machine: `archived` is terminal; no transition out for original. |
| 9 | **Original Record Never Deleted** — Correction never deletes or replaces archived batch. | Storage layer: `deletePayrollBatch` denied for `status === 'archived'`. |
| 10 | **Full Audit Trail** — Every action (create/review/reject/approve/settle) logged as P5 audit event. | `appendAuditEvent` called for each transition; `DENIED` for guard failures. |
| 11 | **No Double Counting** — Guard rejects correction that would cause double counting in reports. | Aggregation logic validates `direction` + `amount` against existing corrections. |
| 12 | **Concurrency Guard** — If prior correction on same `originalTransactionId` is in `under_audit` or `approved` (not yet paid/archived), new request rejected with `correction_conflict` error. | `requirePayrollCorrectionAction` checks existing open corrections. |
| 13 | **Permission ≠ Original Modify** — `payroll.correction.create` does NOT imply `payroll.edit` on archived records. | Permission catalog separates `payroll.correction.*` from `payroll.edit`. |
| 14 | **Original Stays Archived** — Throughout correction lifecycle, original batch status remains `archived`. | State machine: correction has own status; original never transitions. |

**Violations are logged as `DENIED` audit events with `layer: 'permission' | 'scope' | 'state' | 'business'` and `requestedAction`.**

---

## 1. PROBLEM STATEMENT

When a payroll reaches `Approved → Payment Queue → Paid → Archive`, it becomes **immutable historical record** representing what was actually paid. If an error is discovered later, **direct modification of the archived record is forbidden** — it would corrupt the audit trail, break hash-chain integrity, and misrepresent what was actually disbursed.

We need a formal **Correction Workflow** that:
- Preserves the original archived record as-is
- Creates a linked correction transaction
- Maintains full audit trail
- Follows same currency/state machine/permission rules
- Reports show Original + Corrections + Net/Effective Amount

---

## 2. CURRENT RULE (Phase 6 Payroll Workflow)

```
Draft → Under Audit → Approved → Paid → Archive
```

- **Archive** is terminal state
- Archived record: read-only, financial snapshots sealed
- No correction path exists after Archive
- If error found: no formal mechanism, manual workarounds only

---

## 3. PROPOSED RULE — Correction Workflow

```
Archived Payroll
    ↓
Correction Request (by company_hr / payroll_admin)
    ↓
Under Audit (Correction) — NEW correction record created
    ↓
    ├─ Reject → Returned / Needs Correction
    │            ↓
    │        Correction (fresh calc) → Resubmit
    └─ Approve → Payment/Adjustment
                 ↓
            Paid (Correction)
                 ↓
            Archive (Correction)
```

### Key Principles

| Principle | Rule |
|-----------|------|
| **Original Immutable** | Archived payroll record NEVER modified |
| **Correction = New Transaction** | Separate record with `correctionId`, `originalTransactionId` |
| **Linkage** | `sourceId` / `originalTransactionId` points to archived payroll |
| **Currency Model** | Correction carries full snapshot: `amount, currency, exchangeRate, exchangeRateDate, baseCurrency, baseAmount, governance` |
| **Historical Rate** | Correction uses rate at correction time (NEW snapshot), NOT original rate (unless business policy says otherwise — see Decision #2) |
| **State Machine** | Correction follows same: Draft → Under Audit → Approved → Paid → Archive |
| **Permissions** | Same as payroll: payroll_admin creates, audit_reviewer approves, payments_officer pays |
| **Audit Trail** | Full P5 audit events: CORRECTION_REQUEST, CORRECTED, APPROVED, PAID, ARCHIVED |
| **No Double Counting** | Reports aggregate Original + Corrections → Net/Effective; never count correction as standalone payroll |

---

## 4. CORRECTION DATA MODEL

```javascript
{
  // Identity
  correctionId: "CORR-PAY-2026-06-001",
  originalTransactionId: "PAYROLL-2026-06",  // link to archived payroll
  correctionType: "positive" | "negative",   // add or subtract
  
  // Financial (with full currency snapshot)
  amount: 100,                               // correction amount (always positive)
  currency: "USD",
  exchangeRate: 1480,
  exchangeRateDate: "2026-09-15",
  baseCurrency: "USD",
  baseAmount: 148000,
  governance: { schema: "p4", baseCurrency: "USD", baseAmount: 148000, resolvedAt: "..." },
  currencyModel: "p4",
  
  // Direction
  direction: "credit" | "debit",             // credit = positive correction (add), debit = negative (subtract/recover)
  
  // Reason & Metadata
  reason: "Missing overtime hours for employee EMP-001",
  description: "Detailed explanation...",
  
  // State Machine
  status: "draft" | "under_audit" | "approved" | "paid" | "archived" | "rejected",
  returnState: "needs_correction" | "corrected" | "resubmitted" | undefined,
  
  // Audit Stamps
  createdBy: "HR One",
  createdAt: "2026-09-15T10:00:00.000Z",
  rejectedBy: null,
  rejectedAt: null,
  rejectionReason: null,
  auditedBy: "Audit Reviewer",
  auditedAt: "2026-09-16T14:00:00.000Z",
  approvedBy: "Audit Reviewer",
  approvedAt: "2026-09-16T14:00:00.000Z",
  paidBy: "Payments Officer",
  paidAt: "2026-09-17T09:00:00.000Z",
  paymentReference: { referenceId: "CORR-PAY-REF-001", executedBy: "...", executedAt: "...", netSettlementAmount: 148000 },
  archivedAt: "2026-09-18T10:00:00.000Z",
  archivedBy: "Super Admin",
  
  // Versioning
  versions: [...],           // linked version chain
  revision: 1,
  baselineSnapshot: {...},   // sealed at creation (under_audit)
  rejectedSnapshot: {...},   // if rejected
  
  // Scope
  companyId: "comp-1",
  branchId: "br-1",
  employeeId: "emp-001",     // specific employee affected (or null for batch-wide)
}
```

---

## 5. BUSINESS DECISIONS REQUIRED (Must Decide Before Implementation)

| # | Decision Point | Options | Current Status |
|---|----------------|---------|----------------|
| **1** | **Correction Exchange Rate** | A) Use current rate at correction time (NEW snapshot)<br>B) Use original payroll rate (lock to history)<br>C) Configurable per company | **UNDECIDED** — Need finance/legal input |
| **2** | **Negative Correction Recovery** | A) Automatic deduction from next payroll<br>B) Separate recovery payment (employee pays back)<br>C) Write-off (requires approval)<br>D) All of above, configurable | **UNDECIDED** — HR/Payroll policy needed |
| **3** | **Correction Approval Authority** | A) Same as payroll (audit_reviewer approves)<br>B) Higher authority required (CFO/Finance Director)<br>C) Dual approval for negative corrections | **UNDECIDED** |
| **4** | **Time Limit for Corrections** | A) No limit<br>B) Within same fiscal year<br>C) Within 12 months<br>D) Configurable | **UNDECIDED** |
| **5** | **Employee Notification** | A) Automatic notification on correction creation<br>B) Only on approval<br>C) Manual | **UNDECIDED** |
| **6** | **Batch vs. Employee-Level Correction** | A) Both supported<br>B) Only employee-level<br>C) Only batch-level (with employee breakdown) | **UNDECIDED** |
| **7** | **Correction Numbering** | A) Sequential per company: CORR-001, CORR-002<br>B) Per original payroll: PAY-2026-06-CORR-001<br>C) Global unique ID | **UNDECIDED** |
| **8** | **Reporting: Net/Effective Calculation** | A) Original + Σ(corrections × direction) = Net<br>B) Separate columns: Original, Corrections, Net<br>C) Both views available | **PROPOSED: C** |

---

## 6. FORBIDDEN ACTIONS (Hard Constraints) — Mapped to Immutable Rules

| # | Forbidden | Immutable Rule | Rationale |
|---|-----------|----------------|-----------|
| 1 | Modify archived payroll record directly | Rule 1, 2, 12 | Breaks immutability, audit trail, hash chain |
| 2 | Delete original transaction | Rule 1, 2 | Destroys evidence of what was actually paid |
| 3 | Change historical snapshot (rate, baseAmount) | Rule 7 | Violates currency governance (Phase 4) |
| 4 | Recalculate historical baseAmount with current rate | Rule 8 | Revaluation not supported (Phase 4 policy) |
| 5 | Count correction as standalone payroll (double counting) | Rule 5 | Financial misstatement |
| 6 | Show Original + Correction as two independent payments without linkage | Rule 6 | Confuses reconciliation |
| 7 | Bypass audit/approval workflow for corrections | Rule 4 | Same controls as original payroll |
| 8 | Assume recovery method for negative corrections | Rule 10 | Business policy, not technical decision |
| 9 | Modify archived record even minutes after archive | Rule 12 | Zero exception window |
| 10 | Use current rate to recalculate original baseAmount | Rule 8 | Historical snapshots immutable |

---

## 7. REPORTING REQUIREMENTS

### Payroll Detail Report (per employee)
| Column | Source |
|--------|--------|
| Original Gross | Archived payroll item |
| Original Net | Archived payroll item |
| Correction(s) | Linked correction records |
| Correction Direction | credit/debit |
| Correction Amount | Correction records |
| **Net/Effective Gross** | Original + Σ(corrections) |
| **Net/Effective Net** | Original + Σ(corrections) |
| Currency | Original currency (corrections show own currency) |
| Exchange Rate | Original rate (corrections show own rate) |

### Payroll Summary Report (per month)
| Section | Content |
|---------|---------|
| Original Totals | From archived payroll batch |
| Corrections | List of linked corrections with amounts/directions |
| **Net/Effective Totals** | Original + Corrections |
| Currency Breakdown | Per-currency segments (Phase 8 rules) |
| Base Currency Total | Σ(baseAmount) from all snapshots |

### Excel Export
- Sheet 1: Original Payroll (as-is from archive)
- Sheet 2: Corrections (each correction with full snapshot)
- Sheet 3: Net/Effective Summary (Original + Corrections)

---

## 8. AUDIT TRAIL EVENTS (Phase 5)

| Event | Action | Outcome | Key Fields |
|-------|--------|---------|------------|
| Correction Request | `CORRECTION_REQUEST` | success | originalTransactionId, amount, currency, direction, reason |
| Reject Correction | `CORRECTION_REJECTED` | success | rejectionReason, rejectedBy, rejectedAt |
| Correct Correction | `CORRECTION_CORRECTED` | success | old→new diff (like payroll correction) |
| Resubmit Correction | `CORRECTION_RESUBMITTED` | success | resubmittedBy, resubmittedAt |
| Approve Correction | `CORRECTION_APPROVED` | success | approvedBy, approvedAt |
| Pay Correction | `CORRECTION_PAID` | success | paymentReference, paidBy, paidAt |
| Archive Correction | `CORRECTION_ARCHIVED` | success | archivedBy, archivedAt |
| Denied | `DENIED` | denied | layer: permission/scope/state, requestedAction |

All events include: `versionId`, `auditAttempt`, `financial` snapshot, `currency` snapshot.

---

## 9. PHASE 9 TEST MATRIX (Must All Pass)

| # | Test | Expected |
|---|------|----------|
| 1 | Paid → Archived → Correction Request created | Original immutable, correction linked |
| 2 | Original record remains unchanged after correction | All snapshots identical |
| 3 | Positive correction (add missing amount) | Original + correction = Net |
| 4 | Negative correction (overpayment recovery) | Original - correction = Net |
| 5 | Multiple corrections on same payroll | All linked, all applied in Net |
| 6 | No double counting in reports | Original counted once, corrections applied |
| 7 | Historical exchange rate unchanged on original | Original baseAmount frozen |
| 8 | Correction uses correct currency snapshot | New rate for correction (per Decision #1) |
| 9 | Company/Branch scope isolation | Comp A corrections invisible to Comp B |
| 10 | Full audit trail: request→reject→correct→resubmit→approve→pay→archive | All events present, chain valid |
| 11 | Correction cannot bypass audit/approval | Permission/scope/state guards active |
| 12 | Reports show: Original + Corrections + Net/Effective | Clear three-column view |
| 13 | Excel = Screen = Print for corrections | All currency fields match |
| 14 | Changing current employee/rate/settings doesn't affect Original or Correction snapshots | Source of Truth preserved |

---

## 10. IMPLEMENTATION SEQUENCE (After Business Decisions)

1. **Data Model** — `correction` schema in storage, migration script
2. **Engine** — `payrollCorrectionWorkflow.js` (state machine, transitions, snapshots)
3. **Access** — `payrollCorrectionAccess.js` (guards, permissions, scope)
4. **Storage** — `persistPayrollCorrection`, audit hooks, versioning
5. **UI** — Correction tab in PayrollView, correction modal
6. **Reports** — Update Payroll Report, Comparison Report, Excel exports
7. **Tests** — `p9-tests.mjs` with all 14 test cases
8. **Gates** — All Phase 1-8 + P9 must pass

---

## 11. BUSINESS DECISION MATRIX — 8 DECISIONS TO CONFIRM BEFORE ANY CODE

> **Status: PENDING REVIEW — DECISIONS NOT APPROVED.** This Section 11 is the **Decision
> Matrix FOR REVIEW ONLY**: the "Recommended Option" columns are **proposals**, NOT approved
> decisions. NONE of the 8 decisions becomes binding until the approver reviews them, records
> each choice in the Decision Log (§11.12) and issues an **explicit GO**. Any choice may be
> changed during review; recommendations carry no authority. Do not write any Phase 9 code
> (engine / data model / UI / tests / storage / permissions) before the GO.

### 11.1 HOW TO READ THIS MATRIX

Each decision records: **Available Options** → **Recommended Option** (with rationale) →
**Impact on Payroll Workflow / Currency / Audit Trail / Reports / Permissions** →
**Risks & Edge Cases**.

**Locked constraints that apply to EVERY decision (no decision may override these):**

| # | Locked Constraint | Source |
|---|-------------------|--------|
| L1 | **No un-archive, no direct modification of the original record — ever** (even 1 hour after archive). | Rules 1, 2, 12 |
| L2 | Every post-archive case passes the same route: `Archived → Correction Request → Under Audit → Approved → Payment/Adjustment → Archive`. | Rule 4 |
| L3 | A correction, once **archived**, is **itself immutable** — no edit, no delete, no un-archive. Any later discovery = a **NEW correction** linked to the **original transaction** (never to a previous correction). | Rule 4 + Phase 3 versioning |
| L4 | **Branch Isolation (mandatory):** every correction **inherits and validates** `companyId`, `branchId`, `employeeId` (per line), `payrollPeriodId`, `originalTransactionId`. A correction can **never** be created from a Branch Context different from the original transaction's real branch. | Branch-Isolation closure + §11.11 |
| L5 | **Component-level corrections (mandatory):** corrections target payroll *components*, never a blind lump-sum amount. Every line carries reason + source-rule chain. | §11.10 |
| L6 | **No double counting:** reports always `Original + Σ(corrections × direction) = Net/Effective`. | Rule 5, 6 |

---

### 11.2 DECISION 1 — CORRECTION EXCHANGE RATE POLICY (سعر صرف التصحيح)

| Field | Content |
|-------|---------|
| **Available Options** | **A) Current** — correction uses the exchange rate at correction time (new snapshot).<br>**B) Original** — correction inherits the rate locked in the original transaction's snapshot.<br>**C) Configurable** — per-company policy sets the mode (default + override), administratively governed. |
| **Recommended Option** | **C — Configurable, with per-company default = B (Original).** Phase 4 (Rules 7/8) forbids revaluing history; netting under a different rate makes `Original + Corrections = Net` inconsistent in base currency. Defaulting to the Original snapshot keeps bookkeeping and reconciliation exact, while Configurable covers subsidiaries whose tax/regulatory rules require netting at the current rate — as an explicit, audited policy override. |
| **Impact on Payroll Workflow** | A — the correction requires a live, resolvable rate at creation (may be locked/missing for legacy periods → resolution step or fallback policy). B — no live-rate dependency; works for any period, regardless of how old. C — a company setting resolved when the correction request is created decides which path the workflow follows. |
| **Impact on Currency** | A — new snapshot `currency, exchangeRate, exchangeRateDate, baseCurrency, baseAmount` (locked at approval). B — identical sealed snapshot to the original (same rate/date/base). C — both, governed by company setting. In every mode the ORIGINAL's snapshot is never recomputed (Rule 8). |
| **Impact on Audit Trail** | All modes log the full financial snapshot + governance on the correction (Rule 11). A additionally logs rate provenance (rate row id/date). B logs `rateSource: 'original_snapshot'` + the referenced original id. C logs the applied policy id + effective mode per correction. |
| **Impact on Reports** | B — Net/Effective rows net amounts AND baseAmount exactly. A — correction base differs from original base → always show both Base columns and the rate of each side. C — the report carries a per-correction "rate source" column (original/current) so totals are explainable. |
| **Impact on Permissions** | A / B — no new permission. C — changing the rate mode policy requires currency-governance admin (`canGovern` / `settings.manage`); per-correction execution needs no extra permission. |
| **Risks & Edge Cases** | A + long legacy corrections → missing/locked rate → explicit fallback decision required before creation. Multi-currency companies: B inherits the original's foreign-currency rate (consistent). C misconfiguration → mixed-rate reports (mitigated by per-correction rate-source audit field). Cross-devaluation boundary: B keeps comparability; A creates "two-rate" reconciliation complexity. |

---

### 11.3 DECISION 2 — NEGATIVE CORRECTION RECOVERY MECHANISM (استرداد التصحيح السالب)

| Field | Content |
|-------|---------|
| **Available Options** | **A) Deduct from next payroll**.<br>**B) Separate payment / recovery** (employee pays back).<br>**C) Write-off** (requires elevated approval).<br>**D) Configurable — all methods available, gated by role/permission.** |
| **Recommended Option** | **D — Configurable per company, gated by permission; default A for salary-active employees, B for terminated/absent, C strictly elevated (never a default).** Rule 10 already forbids assuming any recovery method — this decision only decides *who may pick and how it is controlled*. |
| **Impact on Payroll Workflow** | A — the negative correction feeds the NEXT payroll as a deduction line (must not mutate a closed/archived month; it links forward). B — a standalone recovery settlement with its own payment reference (EOSB-disbursement pattern). C — correction is approved as a loss and closed without cash movement, with management authority recorded. D — company policy proposes a default per employee status; the approver may override within permission. |
| **Impact on Currency** | A — deduction booked at the NEXT payroll snapshot currency; conversion vs original snapshot documented. B — recovery carries its own snapshot + `baseAmount`, with a recovery/expense flag for GL reconciliation. C — write-off keeps `baseAmount` preserved for reconciliation (never "silently dropped"). D — snapshot consistent with the chosen method; mixing guards per Phase 4 are unchanged. |
| **Impact on Audit Trail** | D logs the chosen method on every correction. A logs the forward link (next-payroll reference). B logs the settlement (payment ref, recoveredBy/At). C logs write-off authority + management reason. All settle as `CORRECTION_PAID` — distinct from `PAID` (Rule 5). |
| **Impact on Reports** | A — Net/Effective shows the scheduled deduction linked to the next month. B — a per-employee recovery item. C — a visible reconciling write-off item. D — report column "recovery method" per correction; never aggregated silently. |
| **Impact on Permissions** | A / B — existing `payroll.disburse` / settlement roles. C — NEW elevated permission `payroll.correction.writeOff` + manager/CFO approval (never auto). D — method selection maps to roles; write-off strictly elevated. |
| **Risks & Edge Cases** | A — employee leaves before the next payroll → auto-fallback to B. A — next payroll net too small / minimum-wage floor → partial recovery, remainder reclassified (documented). B — termination + non-cooperation → escalate to C (decision required). C — abuse → mandatory reason + elevated permission + amount threshold. D — policy sprawl → method ALWAYS recorded per correction. **Negative > net-due** → split: partial recovery + remainder. |

---

### 11.4 DECISION 3 — CORRECTION APPROVAL AUTHORITY (صلاحية اعتماد التصحيح)

| Field | Content |
|-------|---------|
| **Available Options** | **A) Same approval level** as the original payroll (audit_reviewer).<br>**B) Higher approval level** (CFO / Finance Director) for all corrections.<br>**C) Dual approval** (second approver) for negative corrections. |
| **Recommended Option** | **A for positive corrections + C (Dual approval) for negative corrections.** Rule 13 already blocks creator-approves-own; dual sign-off on negative corrections (money owed to the business / employee livelihoods) adds the required control without slowing the common positive path. |
| **Impact on Payroll Workflow** | A — approved by `audit_reviewer` exactly like the original. B — a finance sign-off inserted before payment for every correction. C — negative corrections require `audit_reviewer` AND a second approver, both recorded, before the payment slot opens. |
| **Impact on Currency** | Level/currency combine only at thresholds: under B / C, corrections whose base amount exceeds a configured threshold require the higher authority regardless of direction. |
| **Impact on Audit Trail** | C logs two approvers (`approvedBy` + `coApprovedBy` + timestamps). B logs the elevated approver. A logs the standard approver. In all cases `CORRECTION_REJECTED` keeps the rejection reason + auditor. |
| **Impact on Reports** | Approval-path column per correction: standard / elevated / dual (with both approvers). |
| **Impact on Permissions** | B / C need a NEW permission `payroll.correction.coApprove` (finance director) mapped with amount/currency thresholds. A uses the existing `payroll.approve`. |
| **Risks & Edge Cases** | B slows every correction (queue bottleneck). C's asymmetry is acceptable but "negative" must be defined precisely = `direction: 'debit'`. Threshold anti-circumvention: split-amount guard must detect co-timed related corrections summing above threshold. **Split-payment guard:** sum of related corrections across a window → dual approval regardless of individual size. |

---

### 11.5 DECISION 4 — TIME LIMIT FOR CORRECTIONS (مهلة إنشاء التصحيح)

| Field | Content |
|-------|---------|
| **Available Options** | **A) No limit**.<br>**B) Within the same financial year** (of the original transaction).<br>**C) Within 12 months.**<br>**D) Configurable.** |
| **Recommended Option** | **D — Configurable per company; default B (same Financial Year as the ORIGINAL transaction).** Bounds the ledger liability while reflecting that corrections are tied to the original's period, not to when they were discovered. |
| **Impact on Payroll Workflow** | Window is enforced at Correction-Request creation (§0a). Outside the window → rejected with `correction_window_expired`; a denial is logged. Window changes apply prospectively only (never retroactively re-open/close existing requests). |
| **Impact on Currency** | No direct impact. Rate availability for old periods is still governed by Decision 1 (mode B avoids the missing-rate path entirely). |
| **Impact on Audit Trail** | Creation timestamp versus window boundary recorded; `DENIED` events for expired attempts carry the window config id + boundary. |
| **Impact on Reports** | Corrections always tagged with the ORIGINAL period (period column); window boundaries shown in the period-aggregation views. |
| **Impact on Permissions** | Window configuration = admin (`settings.manage` / company admin). No window ever grants modify-original rights (Rules 1/12 remain absolute). |
| **Risks & Edge Cases** | Year-boundary: a Dec error discovered in Jan → tagged to the ORIGINAL period's financial year, not the discovery year. Fiscal year may differ from calendar year per entity (Iraq context). A (no limit) → unbounded ledger liability — hence the default B. Year definition change mid-flight → freeze existing windows, apply new rule to new requests. |

---

### 11.6 DECISION 5 — EMPLOYEE NOTIFICATION (إشعار الموظف)

| Field | Content |
|-------|---------|
| **Available Options** | **A) Automatic at creation of the correction request**.<br>**B) Automatic ON APPROVAL.**<br>**C) Manual.** |
| **Recommended Option** | **B — automatic notification on approval** (with payslip/statement visibility updated on payment). A notifies employees about rejected drafts (false alarms); C creates HR burden and inconsistency. |
| **Impact on Payroll Workflow** | B triggers on the `Approved` transition. A triggers at request creation. C — HR dispatches externally; system remains silent. |
| **Impact on Currency** | No arithmetic impact. The notification references the correction's amount + currency snapshot. |
| **Impact on Audit Trail** | B / A log the notification-generation event (`notifiedAt`, `notifiedVersion`) in the central trail; actual delivery (e-mail/SMS) failure → logged fallback flag, never a silent loss. C — a manual flag records that HR handles it. |
| **Impact on Reports** | Notification status column per correction (pending / on-approval / manual / retries). |
| **Impact on Permissions** | No new permission; delivery preference is a per-company setting. |
| **Risks & Edge Cases** | Employee disputes before payment → B mitigates. Delivery failure → retry + log. Privacy: notify with a minimal statement, never full payroll export. **Negative corrections:** B must include recovery explanation + next-step (bank deduction / repayment / write-off scope) in the notice. |

---

### 11.7 DECISION 6 — CORRECTION LEVEL (مستوى التصحيح)

| Field | Content |
|-------|---------|
| **Available Options** | **A) Entire payroll** (batch-level).<br>**B) Specific employee / specific component.**<br>**C) Both.** |
| **Recommended Option** | **C — Both; component-level is the MANDATORY minimum unit (§11.10 locks this).** "Entire payroll" corrections are only *aggregates of component lines* — a blind lump-sum total is never a valid correction. |
| **Impact on Payroll Workflow** | B sets line-level fields; A aggregates. Recalculation recomputes every component line from its inputs (hours/days/units + rule), so amounts are reproducible, not hand-typed. |
| **Impact on Currency** | Each component line carries its own currency + snapshot (e.g., an IQD local deduction inside a USD payroll) — Phase 4 mixing guards apply per line. |
| **Impact on Audit Trail** | Per-line identity: `componentCode, quantity, rateOrRuleRef + ruleSnapshot, calculatedAmount, reason, sourceRef, direction, currency`. Batch entries flagged as aggregates; blind entries flagged `manualEntry` (§11.10.4). |
| **Impact on Reports** | Net/Effective at employee, component, and component-category levels; Excel sheet per component category (overtime, absences, allowances, …). |
| **Impact on Permissions** | `payroll.correction.create` covers component corrections. Manual (non-rule) entry is an exception → `payroll.correction.manual` (§11.10.4). |
| **Risks & Edge Cases** | Blind totals → misallocation. Component-master drift between original and correction → the correction stores the RULE REFERENCE + RULE SNAPSHOT at correction time. Unknown component code → the guard rejects. Component later removed from the master → still correctable (reference preserved). |

---

### 11.8 DECISION 7 — CORRECTION NUMBERING (ترقيم التصحيح)

| Field | Content |
|-------|---------|
| **Available Options** | **A) Global sequential** (CORR-001, CORR-002 …).<br>**B) Per payroll** (sequential per original payroll).<br>**C) UUID.** |
| **Recommended Option** | **B — per-original-payroll sequential, human-readable `{originalTransactionId}-CORR-{n}` for display/reconciliation, with the internal `correctionId` a UUID for storage.** Hybrid: unique, traceable to one branch/period, and collision-safe. |
| **Impact on Payroll Workflow** | Sequence is scoped per original batch (which is already composite: `PAYROLL-{month}-{companyId}-{branchId}`) → numbering is branch-isolated by construction. A global counter exists only as an audit cross-index. |
| **Impact on Currency** | None — pure identity. |
| **Impact on Audit Trail** | Numbers are immutable once issued and **never reused**, even for a rejected/recreated request (preserves reference integrity across the trail). Gaps are kept (no re-issue). |
| **Impact on Reports** | Display number cross-linked to the original + audit reference; the UUID maps to any UI surface. |
| **Impact on Permissions** | None — system-generated, no manual assignment. |
| **Risks & Edge Cases** | Two companies / two branches same period → composite prefix disambiguates. Crash mid-issue → lock-free counter on the original batch avoids duplicates. Global-only numbering leaks cross-company ordering (another reason B is default). |

---

### 11.9 DECISION 8 — NET/EFFECTIVE DISPLAY (عرض Net/Effective)

| Field | Content |
|-------|---------|
| **Available Options** | **A) Original + Corrections = Net/Effective** (one dynamic column).<br>**B) Separate columns** — Original \| Corrections \| Net/Effective.<br>**C) Both.** |
| **Recommended Option** | **C — Both: the three-column master view (Rule 6) is the default detailed view, with an A-style single aggregate toggle for summaries.** |
| **Impact on Payroll Workflow** | Master applies at employee, component, and month levels: `Net/Effective = Original ± Σ(direction × amount)`. Latency: derived live, never stored on the original. |
| **Impact on Currency** | Columns show per-currency segments (Phase 8) + base total. With Decision 1 mode A, each side's base is shown without recomputing the original. |
| **Impact on Audit Trail** | The formula is derived — the trail stores the original snapshot + each correction snapshot independently; nothing "recomputed" is re-persisted on the original. |
| **Impact on Reports** | Excel: Sheet 1 Original (as archived) + Sheet 2 Corrections + Sheet 3 Net/Effective (existing §7), extended with component-level columns and the per-correction rate-source field. |
| **Impact on Permissions** | None — presentation only. |
| **Risks & Edge Cases** | Mixed Decision-1 modes in one net view → always display rate-source. **Over-recovery → negative Net**: display an explicit negative sign, never clamp/hide. Rounding: net to 2 decimals, computed on base first then formatted (order documented). |

---

### 11.10 COMPONENT-LEVEL CORRECTION MODEL — MANDATORY ENGINEERING CONSTRAINT (مهم جداً)

**Locked:** corrections operate on **payroll components**, not only on a grand total. Support, at minimum, these component categories (code catalog):

| Code | Component | Code | Component |
|------|-----------|------|-----------|
| `OVERTIME` | Overtime | `ALLOWANCE` | Allowance |
| `ABSENCE` | Absence | `BONUS` | Bonus |
| `LATE` | Late | `COMMISSION` | Commission |
| `DEDUCTION` | Deduction | `LOAN_DEDUCTION` | Loan deduction |
| `SALARY_CUT` | Salary cut | `EOSB_ADJUSTMENT` | EOSB adjustment |
| `TAX_ADJUSTMENT` | Tax adjustment | `GOSI_ADJUSTMENT` | GOSI adjustment |
| `OTHER_*` | Any other *pre-approved* component (requires reason + source/approval; never a free-text catch-all) | | |

**Rule-driven calculation chain (per component line):**

```
Overtime:    hours → rateOrRuleRef (rule resolved & snapshot) → calculatedAmount → currency → reason → sourceRef
Absence/Deduction: daysOrUnits → ruleRef (rule snapshot) → calculatedAmount → currency → reason → sourceRef
Salary/Allowance/Bonus/Commission: fixedReference or formula → calculatedAmount → currency → reason → sourceRef
Loan / EOSB / Tax / GOSI: systemReference (loan record / EOSB settlement / tax file / GOSI file) → calculatedAmount → currency → reason → sourceRef
```

Every line = `{ employeeId, componentCode, quantity, unit, rateOrRuleRef, ruleSnapshot, calculatedAmount, currency, exchangeRate, exchangeRateDate, baseCurrency, baseAmount, reason, sourceRef, direction }`.

* **Reason is REQUIRED** on every line (Condition §0a.3) — no explanation-free amounts.
* **Source is retained when it exists** (`sourceRef` → overtime record, leave record, attendance record, loan, EOSB settlement, tax/GOSI submission, manager memo). The system never fabricates a source.
* **Manual entry is a CONTROLLED EXCEPTION, not the normal path:** requires `payroll.correction.manual` permission, mandatory reason, and the line is flagged `manualEntry: true` in the audit trail. A manual total without component breakdown is forbidden.
* **Reproducibility:** recalculation must recompute all component lines from inputs (hours/days/units + rule + snapshot); any hand-adjusted amount stays flagged.
* **Immutability:** once the correction is archived, its component lines are sealed exactly like payroll items (Rule 4 / §11.1 L3).

---

### 11.11 CORRECTION IDENTITY & BRANCH ISOLATION — MANDATORY (عزل الفروع)

Every correction **inherits and validates**:

| Field | Rule |
|-------|------|
| `companyId` | from the original transaction (never typed). |
| `branchId` | from the original transaction (never typed). |
| `employeeId` | per component line (nullable for batch-aggregate lines). |
| `payrollPeriodId` | equal to the original transaction's period. |
| `originalTransactionId` | FK to the archived payroll batch — always the reference root (even for corrections-of-corrections, §11.1 L3). |

**Branch-context binding (mirror of the closed Branch-Isolation gate):**
* Correction creation from a Branch Context `{ companyId, branchId }` that differs from the **original transaction's real branch** → rejected with `branch_mismatch` (context layer) in BOTH directions; the denial is logged with the target identity.
* Guard order is unchanged: permission → scope → **context** → state (identity-less or wrong-branch corrections never reach the state machine).
* Storage only ever INSERTs a correction record — the archived original is never updated (`addPayrollCorrection` insert-only).

---

### 11.12 DECISION LOG (APPROVED — all 8 confirmed with approver + date)

| Decision # | Question | Decision | Decided By | Date | Notes |
|------------|----------|----------|------------|------|-------|
| 1 | Correction exchange rate policy (§11.2) | **C** — Configurable per company; default = Original payroll snapshot rate | Approver (owner) | 2026-09-12 | Drop-down policy; validated allowed values; per-company default. |
| 2 | Negative correction recovery method (§11.3) | **D** — Configurable; `next_payroll` / `separate_recovery` / `write_off` | Approver (owner) | 2026-09-12 | No default outside approved policy; `write_off` requires elevated permission + admin approval. |
| 3 | Correction approval authority (§11.4) | Positive = same level as payroll approval; Negative = **Dual Approval**; creator cannot approve own correction | Approver (owner) | 2026-09-12 | Primary approve + `coApprove` by a different authorized user for debit corrections. |
| 4 | Time limit for corrections (§11.5) | **D** — Configurable per company; default = same financial year as original payroll | Approver (owner) | 2026-09-12 | Policy changes apply prospectively only. |
| 5 | Employee notification (§11.6) | **B** — Automatic on Approval; status recorded in audit trail; delivery failure not silent | Approver (owner) | 2026-09-12 | Notification status + failure surfaced in audit trail / UI. |
| 6 | Batch vs employee-level (§11.7) | **C** — Both; **component-level is the mandatory minimum**; blind lump-sum forbidden | Approver (owner) | 2026-09-12 | Each component keeps reason + source + rule/calculation basis. |
| 7 | Correction numbering scheme (§11.8) | **B** — Sequential per Original Payroll; human-readable linked to original; internal `correctionId` = UUID | Approver (owner) | 2026-09-12 | Display number `{originalTransactionId}-CORR-{n}`; numbers never reused, even when rejected. |
| 8 | Net/Effective display format (§11.9) | **C** — Both; main display `Original | Corrections | Net/Effective`; aggregates in summaries | Approver (owner) | 2026-09-12 | Three-column view = screen = Excel/Print. |

---

### 11.13 READY-TO-IMPLEMENT CHECKLIST (gates the GO signal)

1. All 8 decisions reviewed and **confirmed** in §11.12 (with approver + date). **[DONE — 2026-09-12, all 8 recorded]**
2. Approver issues an **explicit GO** authorizing Phase 9 implementation start. **[DONE — GO issued by approver]**
3. Then the **mandatory execution order** (approved by the approver):

   1. `p9-tests.mjs` **first** (Drive the 14 base cases of §9 **plus** §11.10 component chains, §11.11 branch-isolation cases, and the Dual-approval / recovery / window / numbering / notification assertions)
   2. Data Model
   3. Engine
   4. Access / Permissions
   5. Storage
   6. UI
   7. Reports
   8. All Phase Gates (P9 gate + dependent)
   9. Full P1–P8 regression
   10. Build
   11. Release Report
   12. Final Commit

[*Document Version 2.1 — Section 11 decisions APPROVED and recorded in §11.12; GO issued (Branch-Isolation gate closed, baselines unchanged).*]

---

## 12. NEXT STEP

**Current status (confirmed by the approver):**
`P9 = DECISIONS APPROVED / GO ISSUED / CODE IN PROGRESS`

**The approver has:**
1. Reviewed the 8 decisions in the Decision Matrix (§11.2–§11.9) and **approved** them.
2. Recorded final choices in the Decision Log (§11.12) with approver + date (2026-09-12).
3. Issued an **explicit GO**.

**In progress (mandatory §11.13 order):** `p9-tests.mjs` (written, syntax-validated) → Data Model → Engine → Access → Storage → UI → Reports → Phase Gates → full regression → Build → Release Report → Final Commit.

---

*Document Version: 2.1*  
*Created: Phase 9 Specification Phase*  
*Baseline: Phase 8 Complete (all gates green)*  
*Status: DECISIONS APPROVED / GO ISSUED / CODE IN PROGRESS (2026-09-12)*