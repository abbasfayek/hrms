# FR-1-D4 CRIT-K Architecture Specification
## Smallest Safe localStorage-Compatible Transaction/Recovery Mechanism

**READ-ONLY SPECIFICATION — DO NOT MODIFY FILES**

---

### 1. PROBLEM STATEMENT (Verified Finding)

The current architecture has a critical defect: when `disbursePayrollAtomic`, `reversePayrollDisbursementAtomic`, `disburseEosbAtomic`, or `cancelEosbPaymentAtomic` suffer a storage write failure, their rollback logic **silently swallows rollback errors** and returns `rolledBack: true` even when restoration failed or partially failed.

**Affected Functions:**
- `payrollDisbursement.js:44` — `disbursePayrollAtomic` (lines 181-199)
- `payrollDisbursement.js:422` — `reversePayrollDisbursementAtomic` (lines 602-625)
- `eosbDisbursement.js:37` — `disburseEosbAtomic` (lines 173-189)
- `eosbDisbursement.js:206` — `cancelEosbPaymentAtomic` (lines 265-271)

**Current Defect Pattern (all four functions):**
```javascript
} catch (writeErr) {
  try {
    restorePayrollById(...);  // or storage.saveEOSB / storage.saveLoans
    if (loansChanged) restoreLoansById(...);
  } catch (rbErr) {
    console.error('Critical rollback error:', rbErr);  // SILENTLY SWALLOWED
  }
  return { ok: false, layer: 'storage', error: writeErr.message, rolledBack: true, batch };
}
```

**Consequences:**
1. **False Positive Recovery Signal** — `rolledBack: true` returned even when rollback throws
2. **No Audit Trail** — Rollback failures leave no tamper-evident record
3. **Silent Financial Divergence** — Payroll and loans can diverge without detection
4. **No Recovery Path** — Operators cannot identify or remediate divergence
5. **Scope Isolation Risk** — Rollback may write wrong scope if not id-scoped

---

### 2. AUTHORITATIVE RECORDS & STORAGE KEYS

#### 2.1 Canonical Storage Keys (from `storage.js:61-83`)
| Collection | localStorage Key | Scope |
|------------|------------------|-------|
| Payrolls | `hrms_payrolls_v3` | Company/Branch |
| Loans | `hrms_loans_v3` | Company/Branch (via employee) |
| EOSB | `hrms_eosb_v3` | Company/Branch (via employee) |
| Audit Trail | `hrms_audit_trail_v3` | System-wide (append-only envelope) |
| Legacy Audit | `hrms_audit_v3` | System-wide (bounded UI log) |

#### 2.2 Authoritative Records for Transaction/Recovery Marker
The **smallest safe durable marker** is carried on the **payroll batch** and **EOSB record** themselves — no new storage key required.

| Record Type | Marker Fields (ADDITIVE, backward-compatible) |
|-------------|-----------------------------------------------|
| Payroll Batch | `transactionState: 'committed' \| 'in_progress' \| 'rollback_in_progress' \| 'rollback_complete' \| 'rollback_divergent'`, `recoveryToken?: string`, `rollbackDetail?: { payrollRestored: boolean, loansRestored: boolean, payrollError?: string, loansError?: string, originalError: string }` |
| EOSB Record | `transactionState: 'committed' \| 'in_progress' \| 'rollback_in_progress' \| 'rollback_complete' \| 'rollback_divergent'`, `recoveryToken?: string`, `rollbackDetail?: { eosbRestored: boolean, loansRestored: boolean, eosbError?: string, loansError?: string, originalError: string }` |

**Rationale:** Payroll batches and EOSB records are the **transaction roots** — every disbursement/full-return/cancel operation mutates exactly one root record plus zero or more loan records. The marker on the root record is the authoritative source; loan records need no separate marker because they are restored atomically with the root.

#### 2.3 Loan Records — No Independent Marker Required
Loan records are **always restored as part of the root transaction rollback** (payroll or EOSB). They never undergo independent financial mutations outside these four atomic functions. Therefore:
- A loan's `remainingAmount`/`paidAmount`/`status` are **always consistent with its parent transaction's marker**
- No separate `transactionState` on loans is needed — divergence is detected by reading the parent batch/record marker
- Existing `rolledBack` boolean consumers continue to work (see §11)

---

### 3. TRANSACTION STATE MACHINE

#### 3.1 States (Per Transaction Root)
```
┌─────────────────┐
│   COMMITTED     │  ← Normal steady state (no in-flight operation)
└────────┬────────┘
         │ disburse/full-return/cancel starts
         ▼
┌─────────────────┐     write succeeds     ┌──────────────┐
│  IN_PROGRESS    │ ─────────────────────▶ │  COMMITTED   │
│ (root status    │                         │ (new status) │
│  transitioned,  │                         └──────────────┘
│  loans mutated  │
│  in memory)     │
└────────┬────────┘
         │ write fails
         ▼
┌──────────────────────┐
│  ROLLBACK_IN_PROGRESS│
│ (restoring payroll/  │
│  EOSB + loans)       │
└────────┬─────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌─────────┐ ┌─────────────────┐
│COMPLETE │ │   DIVERGENT     │
│(both    │ │ (one or both    │
│restored)│ │  failed)        │
└─────────┘ └────────┬────────┘
                     │
                     ▼
              ┌───────────────┐
              │ ROLLBACK_DIVERGENT │  ← RECOVERY REQUIRED
              │ (aka DIVERGENT)    │
              └───────────────┘
```

#### 3.2 State Definitions
| State | Meaning | Allowed Next Operations |
|-------|---------|-------------------------|
| `COMMITTED` | Normal; last operation fully succeeded | Any new disburse/full-return/cancel |
| `IN_PROGRESS` | Root transitioned, loans mutated in memory, persistence not yet confirmed | **None** — concurrency guard blocks re-entry |
| `ROLLBACK_IN_PROGRESS` | Write failed; restoration in flight | **None** — internal only |
| `COMMITTED` (after rollback) | Rollback verified complete; financial state matches pre-state | Any new operation |
| `ROLLBACK_DIVERGENT` | **Recovery required** — payroll/EOSB and/or loans not restored | **Only recovery operations** (see §13) |

#### 3.3 State Persistence
- State is **written to the root record** (`batch.transactionState` or `record.transactionState`) via `persistPayrollsById` / `persistEosb`
- **Never** stored in a separate key — avoids scope isolation violations
- Written **after** the root status transition but **before** loan persistence (so a crash after root write but before loan write leaves `IN_PROGRESS` with loans still pre-state)

---

### 4. READERS/WRITERS/ACTIONS THAT MUST REFUSE WHEN RECOVERY REQUIRED

#### 4.1 Payroll Mutation Paths (MUST check `batch.transactionState === 'rollback_divergent'`)
| Operation | Entry Point | Guard Location |
|-----------|-------------|----------------|
| Disburse (`approved` → `paid`) | `PayrollView.js:785` `disburseBatch` → `disbursePayrollAtomic` | **Add at top of `disbursePayrollAtomic`** |
| Full Return (`paid` → `approved`) | `PayrollView.js:708` `runFullReturnFlow` → `reversePayrollDisbursementAtomic` | **Add at top of `reversePayrollDisbursementAtomic`** |
| Reactivate (fully-returned → `rejected`) | `PayrollView.js:748` `runReactivateFlow` → `reactivateFullReturnedBatchGuarded` | **Add in `payrollAccess.js:requirePayrollAction`** for `reactivate` action |
| Archive (`paid` → archived) | `PayrollView.js:1991` → `archivePayrollBatchGuarded` | **Add in `payrollAccess.js:requirePayrollAction`** for `archive` action |
| Correction on returned batch | `PayrollView.js` correction flow → `recordPayrollCorrectionGuarded` | **Add in `payrollAccess.js:requirePayrollAction`** for `edit` on returned batch |

#### 4.2 EOSB Mutation Paths (MUST check `record.transactionState === 'rollback_divergent'`)
| Operation | Entry Point | Guard Location |
|-----------|-------------|----------------|
| Disburse (`approved` → `paid`) | `EOSBView.js:307` → `disburseEosbAtomic` | **Add at top of `disburseEosbAtomic`** |
| Cancel Payment (`paid` → `approved`) | `EOSBView.js:362` → `cancelEosbPaymentAtomic` | **Add at top of `cancelEosbPaymentAtomic`** |
| Correction on returned EOSB | `EOSBView.js:334` → `recordEosbCorrectionGuarded` | **Add in `eosbAccess.js:requireEosbAction`** for `edit` on returned record |

#### 4.3 Loan Mutation Paths (MUST check parent transaction state)
| Operation | Entry Point | Guard Location |
|-----------|-------------|----------------|
| Loan receipt (manual payment) | `LoanReceiptModal.js:160` → `storage.saveLoans` | **Add check in `storage.saveLoans`** — refuse if any affected loan's parent batch/record has `transactionState === 'rollback_divergent'` |
| Loan edit/delete | `LoanModal.js:264/272` → `storage.updateLoan`/`addLoan` | **Add check in `storage.updateLoan`/`addLoan`** — same parent check |
| Payroll correction (P9) on archived batch | `PayrollCorrectionEngine.js` → `storage.persistCorrection` | **Add check in correction guard** — refuse if original batch has `transactionState === 'rollback_divergent'` |

#### 4.4 Archive/Restore Paths
| Operation | Entry Point | Guard Location |
|-----------|-------------|----------------|
| Archive legacy payroll | `ArchivePayrollModal.js:183` → `storage.addPayrollBatch` | **Add check in `storage.addPayrollBatch`** — refuse if batch for same month/company/branch has `transactionState === 'rollback_divergent'` |

---

### 5. PREVENTING UNSAFE RE-DISBURSEMENT AFTER PARTIAL RECOVERY

#### 5.1 Scenario A: Payroll Restored, Loans NOT Restored (`partial_payroll`)
- **State after rollback:** Payroll batch back to `approved` (or `paid` for full-return rollback), but loans **still show settled** (paidAmount increased, remainingAmount = 0, status = 'settled')
- **Divergence:** Loans show money collected that payroll no longer records
- **Prevention:**
  1. `disbursePayrollAtomic` entry guard checks `batch.transactionState === 'rollback_divergent'` → **REFUSES**
  2. `reversePayrollDisbursementAtomic` entry guard checks same → **REFUSES**
  3. `reactivateFullReturnedBatchGuarded` guard in `payrollAccess.js` checks same → **REFUSES**
  4. `storage.saveLoans` / `updateLoan` / `addLoan` check parent batch → **REFUSES** any loan mutation while parent is divergent
  5. **Only allowed:** Manual recovery API (see §13) that explicitly restores loans, then clears marker

#### 5.2 Scenario B: Loans Restored, Payroll NOT Restored (`partial_loans`)
- **State after rollback:** Loans back to pre-state (active, remainingAmount > 0), but payroll batch **stays `paid`** (or `approved` for full-return rollback)
- **Divergence:** Payroll shows disbursed but loans show unpaid
- **Prevention:**
  1. Same entry guards as above — **REFUSE** all new disburse/full-return/cancel
  2. `archivePayrollBatchGuarded` guard → **REFUSES** archival of divergent batch
  3. Loan receipt/edit → **REFUSED** (parent batch divergent)
  4. **Only allowed:** Manual recovery API that explicitly restores payroll, then clears marker

#### 5.3 Scenario C: Both Failed (`failed`)
- **State:** Both payroll and loans in UNKNOWN state (write may have partially persisted)
- **Prevention:** Same guards — **ALL mutations refused** until recovery

---

### 6. ACCOUNTING FOR `localStorage.setItem` SILENT FAILURES

#### 6.1 Failure Modes
| Mode | Behavior | Detection |
|------|----------|-----------|
| Quota exceeded | `setItem` throws `QuotaExceededError` | Caught by try/catch |
| Private browsing (Safari) | `setItem` throws `SecurityError` | Caught by try/catch |
| Silent no-op (some embeddings) | `setItem` returns undefined, no error, **data not persisted** | **Read-back verification REQUIRED** |
| Corrupted write | Data written but truncated/corrupted | Read-back verification |

#### 6.2 Design Constraint: **NO CLAIMED ATOMICITY**
The design **explicitly does not claim atomicity**. Instead:
- Every persistence step returns `{ ok: boolean, restored: boolean, error?: string }`
- **Read-back verification** after every write (including rollback writes)
- `persistPayrollsById` / `persistLoansById` / `persistEosb` **modified to return verification result**
- Rollback logic uses verification results to determine `rolledBack` status enum

#### 6.3 Modified Storage Persistence Signatures
```javascript
// storage.js — MODIFIED to return verification result
persistPayrollsById(payrolls): { ok: boolean, restored: boolean, error?: string }
persistLoansById(loans): { ok: boolean, restored: boolean, error?: string }
persistEosb(record): { ok: boolean, restored: boolean, error?: string }
saveEOSB(list): { ok: boolean, restored: boolean, error?: string }  // EOSB uses whole-list
saveLoans(list): { ok: boolean, restored: boolean, error?: string }  // LoanReceipt uses whole-list
```

**Implementation:** After `localStorage.setItem`, read back the key and verify the expected record(s) match. Return `{ ok: true, restored: true }` only on verified match.

---

### 7. COMPANY/BRANCH SCOPE ISOLATION (Preserved)

#### 7.1 No Wholesale Scoped Writes
- All persistence uses **id-scoped merges**: `persistPayrollsById([batch])`, `persistLoansById(affectedLoans)`, `persistEosb(record)`
- **Never** `savePayrolls(fullArray)` or `saveLoans(fullArray)` in the hot path
- Recovery marker written via same id-scoped path — **zero risk** of clobbering other scopes

#### 7.2 Scope Isolation Verification (Test Requirement)
Every failure-injection test **must verify** that `comp-2/br-2` records are **byte-identical** before and after any rollback scenario (see existing tests in `p18-d4-disbursement-attribute-integrity-tests.mjs:264-281, 385-398`).

---

### 8. BACKWARD COMPATIBILITY FOR `rolledBack` BOOLEAN CONSUMERS

#### 8.1 Current Consumers (grep results)
| File | Line | Usage |
|------|------|-------|
| `f01-disburse-atomicity-tests.mjs` | 327 | `assert.equal(res.rolledBack, true)` |
| `f02-eosb-loan-settlement-tests.mjs` | 236 | `assert.equal(res.rolledBack, true)` |
| `p15-legacy-loan-reversal-hardening-tests.mjs` | 283 | `res.ok === false && res.rolledBack === true` |
| `p18-d4-disbursement-attribute-integrity-tests.mjs` | 323 | `assert.equal(res.rolledBack, true)` |

#### 8.2 Migration Strategy: **Dual Return — No Breaking Change**
```javascript
return {
  ok: false,
  layer: 'storage',
  error: writeErr.message,
  // BACKWARD COMPATIBLE: boolean true when ANY rollback attempted
  rolledBack: rolledBackStatus !== undefined,  
  // NEW: precise status for new consumers
  rolledBackStatus: rolledBackStatus,  // 'complete' | 'partial_payroll' | 'partial_loans' | 'failed'
  rollbackDetail: { ... },
  financialDivergence: boolean,
  recoveryToken: string,
  batch: originalBatch,
}
```
- Existing tests checking `rolledBack === true` **continue to pass** (divergent/failed also returns `rolledBack: true`)
- New code uses `rolledBackStatus` for precise handling
- **No migration needed** — additive field only

---

### 9. FAILURE-INJECTION TESTS (Required for Every Transaction Step)

#### 9.1 Test Matrix — 4 Operations × 8 Scenarios = 32 Tests

| Operation | Failure Point | Expected `rolledBackStatus` | Expected `financialDivergence` |
|-----------|---------------|----------------------------|-------------------------------|
| **disbursePayrollAtomic** | `before_batch_write` (payroll write) | `complete` | `false` |
| | `before_batch_write` + payroll restore fails | `partial_loans` | `true` |
| | `before_batch_write` + loans restore fails | `partial_payroll` | `true` |
| | `before_batch_write` + both restore fail | `failed` | `true` |
| | `before_loan_write` (loan write) | `complete` | `false` |
| | `before_loan_write` + payroll restore fails | `partial_loans` | `true` |
| | `before_loan_write` + loans restore fails | `partial_payroll` | `true` |
| | `before_loan_write` + both restore fail | `failed` | `true` |
| | `after_writes` (audit write) | `complete` | `false` |
| | `after_writes` + both restore fail | `failed` | `true` |
| **reversePayrollDisbursementAtomic** | Same 8 scenarios (payroll write = updated batch, loan write = reversed loans) | | |
| **disburseEosbAtomic** | `before_eosb_write` | `complete` | `false` |
| | `before_eosb_write` + eosb restore fails | `partial_loans` | `true` |
| | `before_eosb_write` + loans restore fails | `partial_eosb` | `true` |
| | `before_eosb_write` + both restore fail | `failed` | `true` |
| | `before_loan_write` | `complete` | `false` |
| | `before_loan_write` + eosb restore fails | `partial_loans` | `true` |
| | `before_loan_write` + loans restore fails | `partial_eosb` | `true` |
| | `before_loan_write` + both restore fail | `failed` | `true` |
| | `after_writes` | `complete` | `false` |
| | `after_writes` + both restore fail | `failed` | `true` |
| **cancelEosbPaymentAtomic** | `eosb_write` (persistEosb) | `complete` | `false` |
| | `eosb_write` + eosb restore fails | `partial_loans` | `true` |
| | `eosb_write` + loans restore fails | `partial_eosb` | `true` |
| | `eosb_write` + both restore fail | `failed` | `true` |
| | `loan_write` (saveLoans) | `complete` | `false` |
| | `loan_write` + eosb restore fails | `partial_loans` | `true` |
| | `loan_write` + loans restore fails | `partial_eosb` | `true` |
| | `loan_write` + both restore fail | `failed` | `true` |

#### 9.2 Additional Required Tests
| Test | Description |
|------|-------------|
| **Silent no-op persistence** | Mock `localStorage.setItem` to succeed but not persist; verify read-back catches it |
| **Thrown persistence failure** | Mock `setItem` to throw; verify `rolledBackStatus` enum correct |
| **Partial rollback** | Mock one restore to succeed, one to fail; verify `partial_*` status |
| **Repeated retry** | Call same operation twice after `rollback_divergent`; verify **both refused** |
| **Recovery-required blocking** | Verify all 7 mutation paths (§4) refuse when `transactionState === 'rollback_divergent'` |
| **Scope isolation** | Verify `comp-2/br-2` records byte-identical after every scenario |
| **Audit trail integrity** | Verify rollback audit events form valid hash chain (`verifyAuditTrail`) |
| **Recovery token uniqueness** | Every rollback failure includes unique `recoveryToken` in return + audit |

#### 9.3 Test Infrastructure
- Mock storage with configurable failure injection at specific persistence steps:
  - `storage.addPayrollBatch` / `storage.persistPayrollsById` → throw on call N
  - `storage.persistLoansById` / `storage.saveLoans` → throw on call N
  - `storage.persistEosb` / `storage.saveEOSB` → throw on call N
  - Restore paths: mock `persistPayrollsById` / `persistLoansById` / `persistEosb` to throw during rollback

---

### 10. RECOVERY SEMANTICS

#### 10.1 What Makes a Record "Safe Again"
A record is **safe** (exits `ROLLBACK_DIVERGENT`) **iff**:
1. **Both** the root record (payroll batch or EOSB) **AND** all affected loans are verified restored to their pre-operation state
2. **Verification** = read-back confirmation that stored values match the pre-operation snapshots exactly
3. The `transactionState` is explicitly set to `COMMITTED` by the recovery operation

#### 10.2 Allowed Operation to Clear Recovery Marker
**Only one operation** may clear `transactionState = 'rollback_divergent'` → `'committed'`:
- **Manual Recovery API** (future enhancement, not in this fix):
  ```javascript
  export function recoverTransaction({ storage, recoveryToken, action: 'restore_payroll' | 'restore_loans' | 'restore_eosb' | 'force_complete' }) {
    // 1. Look up rollback audit event by recoveryToken (Phase 5 trail)
    // 2. Apply missing restoration step(s) with verification
    // 3. On full verification: set transactionState = 'committed', clear recoveryToken/rollbackDetail
    // 4. Emit RECOVERY_COMPLETE audit event
  }
  ```
- **No automated recovery** — current architecture cannot safely guarantee it (localStorage silent failures, no WAL, async server sync)
- **No UI auto-recovery** — operator must acknowledge divergence and explicitly invoke recovery

#### 10.3 Recovery Token
- Generated at rollback start: `RBK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`
- Carried in: return value, `rollbackDetail.recoveryToken`, all rollback audit events
- Used to correlate audit trail → manual recovery action

---

### 11. CANDIDATE DESIGNS COMPARISON

#### Design A: Full Transaction Log (WAL) in localStorage
- **Approach:** Append every mutation to a write-ahead log key; replay on recovery
- **Pros:** True atomicity simulation, automatic recovery possible
- **Cons:** 
  - localStorage single-key writes still not atomic (log + data = 2 keys)
  - Server sync would need to sync log + data atomically (impossible)
  - Significant new code surface (~500 lines), new failure modes
  - **Violates "smallest safe" constraint**

#### Design B: External Coordination Service (Server-Side Transactions)
- **Approach:** Move all financial mutations to server; client only requests
- **Pros:** True ACID transactions, proper rollback
- **Cons:**
  - **Architectural inversion** — this is an offline-first app
  - Requires server infrastructure not in scope
  - Breaks offline capability
  - **Not a localStorage-compatible mechanism**

#### Design C: Explicit Recovery-State Machine on Root Records (SELECTED)
- **Approach:** Add `transactionState` enum + `recoveryToken` + `rollbackDetail` to payroll batch / EOSB record; verify every write; refuse mutations when divergent
- **Pros:**
  - **Smallest change** — ~150 lines across 4 engine files + storage persistence returns
  - Uses existing id-scoped persistence (`persistPayrollsById`, `persistLoansById`, `persistEosb`)
  - Preserves scope isolation by design
  - Backward compatible (dual `rolledBack` boolean + enum)
  - No new storage keys, no new collections
  - Works offline; server sync carries marker naturally
  - Explicit divergence detection via audit trail
- **Cons:**
  - Requires manual recovery (no auto-heal)
  - Read-back verification adds ~2ms per write (negligible)
  - Does not eliminate divergence — only makes it **detectable and blockable**

**Selection Justification:** Design C is the **smallest safe design** that satisfies all constraints:
- localStorage-compatible ✅
- No atomicity claims ✅
- Scope isolation preserved ✅
- Backward compatible ✅
- Detects and blocks divergence ✅
- Minimal code change ✅
- No new infrastructure ✅

**NOT ranked "best"** — it is the **minimum viable** design given the architectural ceiling of localStorage + offline-first + no server transactions.

---

### 12. EXACT FILES/FUNCTIONS LIKELY TO CHANGE (NO CHANGES MADE)

#### 12.1 Core Engine Files
| File | Functions to Modify |
|------|---------------------|
| `public/js/engines/payrollDisbursement.js` | `disbursePayrollAtomic` (lines 44-203), `reversePayrollDisbursementAtomic` (lines 422-630), `restorePayrollById` (251-254), `restoreLoansById` (245-249), `persistLoansById` helper (240-243), `persistPayrollsById` helper (251-254) |
| `public/js/engines/eosbDisbursement.js` | `disburseEosbAtomic` (lines 37-194), `cancelEosbPaymentAtomic` (lines 206-272) |
| `public/js/storage.js` | `persistPayrollsById` (1491-1516), `persistLoansById` (1491-1504), `persistEosb` (1784-1816), `saveEOSB` (1713), `saveLoans` (1474-1478) — **return verification result** |

#### 12.2 Guard/Access Files
| File | Functions to Modify |
|------|---------------------|
| `public/js/engines/payrollAccess.js` | `requirePayrollAction` — add `transactionState` check for `disburse`, `cancelPayment`, `reactivate`, `archive`, `edit` (on returned) |
| `public/js/engines/eosbAccess.js` | `requireEosbAction` — add `transactionState` check for `disburse`, `cancelPayment`, `edit` (on returned) |

#### 12.3 Audit Trail
| File | Changes |
|------|---------|
| `public/js/engines/auditTrail.js` | Add `AUDIT_ACTIONS.ROLLBACK_ATTEMPTED`, `ROLLBACK_COMPLETE`, `ROLLBACK_PARTIAL`, `ROLLBACK_FAILED`, `FINANCIAL_DIVERGENCE_DETECTED`, `RECOVERY_COMPLETE` |

#### 12.4 UI Components (Read-Only Guards)
| File | Changes |
|------|---------|
| `public/js/components/PayrollView.js` | `disburseBatch`, `runFullReturnFlow`, `runReactivateFlow`, archive handler — surface `recoveryToken`/`rolledBackStatus` in toast |
| `public/js/components/EOSBView.js` | Disburse/Cancel handlers — surface recovery info |
| `public/js/components/LoanReceiptModal.js` | `storage.saveLoans` call — will be blocked by storage guard |
| `public/js/components/LoanModal.js` | `storage.addLoan`/`updateLoan` — blocked by storage guard |
| `public/js/components/ArchivePayrollModal.js` | `storage.addPayrollBatch` — blocked by storage guard |

#### 12.5 Test Files (New/Extended)
| File | Purpose |
|------|---------|
| `scripts/f01-rollback-failure-tests.mjs` | **NEW** — 32 matrix tests + silent failure + scope isolation + audit integrity |
| `scripts/f01-disburse-atomicity-tests.mjs` | Extend existing tests to verify `rolledBackStatus` enum |
| `scripts/f02-eosb-loan-settlement-tests.mjs` | Extend for EOSB rollback status |
| `scripts/p15-legacy-loan-reversal-hardening-tests.mjs` | Extend for full-return rollback status |

---

### 13. UNRESOLVED ISSUES (Must Decide Before Implementation)

| # | Issue | Options | Recommendation |
|---|-------|---------|----------------|
| **1** | **Recovery API scope** — Should `recoverTransaction` be in this fix or a follow-up? | A) Include minimal recovery API (restore_payroll/restore_loans/restore_eosb) in this fix<br>B) Defer to follow-up; only block mutations now | **B** — This fix is detection+blocking. Recovery is a separate operator workflow. |
| **2** | **EOSB `rolledBackStatus` enum values** — Payroll uses `partial_payroll`/`partial_loans`; EOSB needs `partial_eosb`/`partial_loans`. Unify naming? | A) Use `partial_root`/`partial_loans` for both<br>B) Keep domain-specific (`partial_payroll` vs `partial_eosb`) | **A** — `partial_root`/`partial_loans` is generic and clearer. |
| **3** | **Audit event payload size** — Current `appendAuditEvent` stores full financial snapshots. Rollback events with pre/post loan states may exceed quota. | A) Store only hashes + recoveryToken; full snapshots in separate key<br>B) Keep inline; monitor quota | **A** — Store `preBatchSnapshotHash` + `originalLoansSnapshotHash` (SHA-256), full snapshots only in memory during rollback. |
| **4** | **Concurrency: in-flight + recovery** — If a rollback leaves `rollback_divergent`, the `inFlightDisbursements`/`inFlightFullReturns`/`inFlightEosbDisbursements` sets are cleared in `finally`. Could a concurrent retry start before marker is read? | A) Check `transactionState` **before** in-flight check (current order: in-flight first)<br>B) Keep in-flight first; recovery marker checked after | **A** — Check `transactionState === 'rollback_divergent'` **first**, before in-flight guard. |
| **5** | **LoanReceiptModal manual payment** — Currently calls `storage.saveLoans(fullArray)`. Must switch to `persistLoansById` for scope safety AND to integrate with recovery guard. | A) Refactor LoanReceiptModal to use `persistLoansById`<br>B) Keep `saveLoans` but add parent-check in `saveLoans` | **A** — Consistent with FR-1-D4; `saveLoans` whole-array is a legacy path. |
| **6** | **ArchivePayrollModal** — Creates new `paid` batches. Must check for existing divergent batch for same month/company/branch. | A) Add check in `storage.addPayrollBatch`<br>B) Add check in modal before save | **A** — Storage is the last line of defense. |

---

### 14. IMPLEMENTATION SEQUENCE (For Reference)

1. **Audit Actions** — Add 6 new `AUDIT_ACTIONS` to `auditTrail.js`
2. **Storage Persistence Returns** — Modify `persistPayrollsById`, `persistLoansById`, `persistEosb`, `saveEOSB`, `saveLoans` to return `{ ok, restored, error }` with read-back verification
3. **Rollback Helpers** — Modify `restorePayrollById`, `restoreLoansById` to return verification result (no throw)
4. **Engine Rollback Blocks** — Rewrite 4 catch blocks to use verification results, emit audit events, set `transactionState` on root record
5. **Entry Guards** — Add `transactionState === 'rollback_divergent'` checks at top of 4 atomic functions + in access guards
6. **Storage Mutation Guards** — Add parent-check in `saveLoans`, `updateLoan`, `addLoan`, `addPayrollBatch`
7. **Tests** — Implement 32+ failure-injection tests
8. **UI Surface** — Display `recoveryToken`/`rolledBackStatus` in toasts for operator visibility

---

CRIT_K_ARCHITECTURE_SPECIFICATION_COMPLETE