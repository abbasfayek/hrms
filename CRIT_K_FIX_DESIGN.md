# FR-1-D4 CRIT-K Fix Design Specification
## Rollback Failure Detection & Recovery-State Design

---

### 1. PROBLEM STATEMENT

**Current Defect**: In `disbursePayrollAtomic` (lines 181-199) and `reversePayrollDisbursementAtomic` (lines 602-625), when a storage write fails during the atomic persistence phase:

```javascript
} catch (writeErr) {
  try {
    restorePayrollById(storage, preBatch, originalPayrolls);
    if (loansChanged) restoreLoansById(storage, originalLoans, affectedLoanIds);
  } catch (rbErr) {
    console.error('Critical rollback error during disbursement:', rbErr);  // SILENTLY SWALLOWED
  }
  return { ok: false, layer: 'storage', error: writeErr.message, rolledBack: true, batch };  // FALSE POSITIVE
}
```

**Critical Failures**:
1. `rolledBack: true` is returned **even when rollback itself throws** — the catch block swallows `rbErr`
2. No audit trail event for rollback failure (only best-effort in full-return, missing entirely in disbursement)
3. No durable recovery evidence — operator sees "rolled back" but financial state may be divergent
4. Financial divergence between payroll and loans can persist silently
5. Company/branch scope isolation at risk if rollback writes wrong scope

---

### 2. ARCHITECTURAL DECISION: COMPENSATING/RECOVERY-STATE DESIGN

**True transactional storage is NOT feasible** in this architecture:
- localStorage is single-key, single-write, no ACID, no cross-key atomicity
- Server sync is async, eventually consistent, no distributed transactions
- Browser environment has no transaction log or WAL

**Required approach**: Explicit **recovery-state machine** with:
- Rollback status tracking (`rolledBack: 'complete' | 'partial' | 'failed'`)
- Durable audit events for every rollback attempt/outcome
- Financial divergence detection via reconciliation markers
- Recovery API for manual/auto remediation

---

### 3. MINIMAL SAFE ARCHITECTURAL CHANGES

#### 3.1 New Return/Error Semantics

**`disbursePayrollAtomic` and `reversePayrollDisbursementAtomic` return type extends**:

```typescript
interface AtomicResult {
  ok: boolean;
  error?: string;
  layer?: 'validation' | 'permission' | 'scope' | 'context' | 'state' | 'loan' | 'storage' | 'rollback';
  batch?: PayrollBatch;
  loansChanged?: boolean;
  settledLoans?: SettledLoan[];
  reversedLoanIds?: Set<string>;
  loansReversed?: boolean;
  // NEW: Rollback status (replaces boolean rolledBack)
  rolledBack?: 'complete' | 'partial_payroll' | 'partial_loans' | 'failed';
  // NEW: Which restoration steps succeeded/failed
  rollbackDetail?: {
    payrollRestored: boolean;
    loansRestored: boolean;
    payrollError?: string;
    loansError?: string;
  };
  // NEW: Financial divergence marker
  financialDivergence?: boolean;
  // NEW: Recovery token for operator escalation
  recoveryToken?: string;
}
```

**Rollback Status Values**:
| Value | Meaning |
|-------|---------|
| `'complete'` | Both payroll AND loans fully restored to pre-state |
| `'partial_payroll'` | Payroll restored, loans NOT restored (divergence: loans still modified) |
| `'partial_loans'` | Loans restored, payroll NOT restored (divergence: payroll still modified) |
| `'failed'` | NEITHER restored (both writes failed during rollback) |
| `undefined` | No rollback attempted (early validation failure) |

#### 3.2 New Audit Event Types (auditTrail.js)

Add to `AUDIT_ACTIONS`:

```javascript
ROLLBACK_ATTEMPTED: 'rollback_attempted',      // Rollback started
ROLLBACK_COMPLETE: 'rollback_complete',        // Full rollback succeeded
ROLLBACK_PARTIAL: 'rollback_partial',          // Partial rollback (divergence)
ROLLBACK_FAILED: 'rollback_failed',            // Rollback completely failed
FINANCIAL_DIVERGENCE_DETECTED: 'financial_divergence_detected', // Post-hoc detection
```

#### 3.3 Rollback Audit Event Payload

```javascript
{
  recordType: 'payroll',
  recordId: batch.month,
  payrollId: batch.id,
  companyId: batch.companyId,
  branchId: batch.branchId,
  action: 'rollback_attempted' | 'rollback_complete' | 'rollback_partial' | 'rollback_failed',
  outcome: 'success' | 'partial' | 'failed',
  actor: { id, name, role },
  fromStatus: 'paid',  // or 'approved' for full-return rollback
  toStatus: 'approved', // target rollback status
  rollbackDetail: {
    originalError: writeErr.message,      // The write failure that triggered rollback
    payrollRestored: boolean,
    loansRestored: boolean,
    payrollError: string | null,
    loansError: string | null,
    affectedLoanIds: string[],
    preBatchSnapshotHash: string,         // SHA-256 of preBatch for integrity verification
    originalLoansSnapshotHash: string,    // SHA-256 of affected original loans
  },
  financial: {
    payrollStatusBeforeRollback: 'paid',
    payrollStatusAfterRollback: 'approved' | 'paid (divergent)',
    loanStatesBeforeRollback: [...],
    loanStatesAfterRollback: [...],
  },
  reasonKind: 'rollback',
  recoveryToken: string,  // UUID for operator escalation
}
```

#### 3.4 Storage Layer: Idempotent, Verifiable Restore

**Modify `restorePayrollById` and `restoreLoansById`** (payrollDisbursement.js:251-254) to:
- Return `{ ok: boolean, error?: string, restored: boolean }` instead of throwing
- Verify post-write state matches expected pre-state (read-back verification)
- Never throw — return failure detail for audit

```javascript
const restorePayrollById = (storage, preBatch, fullFallback) => {
  try {
    if (typeof storage.persistPayrollsById === 'function') {
      storage.persistPayrollsById([preBatch]);
    } else {
      storage.savePayrolls(fullFallback);
    }
    // Read-back verification
    const stored = storage.getRawPayrolls().find(b => b.id === preBatch.id);
    if (!stored || stored.status !== preBatch.status) {
      return { ok: false, error: 'restore_verification_failed', restored: false };
    }
    return { ok: true, restored: true };
  } catch (e) {
    return { ok: false, error: e.message, restored: false };
  }
};

const restoreLoansById = (storage, preLoans, affectedIds) => {
  try {
    const affected = preLoans.filter(l => l && affectedIds.has(String(l.id)));
    if (typeof storage.persistLoansById === 'function') {
      storage.persistLoansById(affected);
    } else {
      storage.saveLoans(preLoans);
    }
    // Read-back verification for each affected loan
    const stored = storage.getRawLoans();
    for (const expected of affected) {
      const actual = stored.find(l => l.id === expected.id);
      if (!actual || actual.remainingAmount !== expected.remainingAmount || actual.paidAmount !== expected.paidAmount) {
        return { ok: false, error: `restore_verification_failed_loan_${expected.id}`, restored: false };
      }
    }
    return { ok: true, restored: true };
  } catch (e) {
    return { ok: false, error: e.message, restored: false };
  }
};
```

#### 3.5 Recovery Token Generation

```javascript
function generateRecoveryToken() {
  return `RBK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
}
```

---

### 4. BEHAVIOR MATRIX — EIGHT FAILURE SCENARIOS

| Scenario | Payroll Restore | Loans Restore | `rolledBack` | `financialDivergence` | Audit Event | Recovery Action |
|----------|-----------------|---------------|--------------|----------------------|-------------|-----------------|
| **5a** Payroll OK, Loans FAIL | ✅ | ❌ | `'partial_payroll'` | `true` | `ROLLBACK_PARTIAL` | Manual loan restore via recovery API |
| **5b** Loans OK, Payroll FAIL | ❌ | ✅ | `'partial_loans'` | `true` | `ROLLBACK_PARTIAL` | Manual payroll restore via recovery API |
| **5c** Both FAIL | ❌ | ❌ | `'failed'` | `true` | `ROLLBACK_FAILED` | Full manual recovery; system locked for batch |
| **5d** Both OK | ✅ | ✅ | `'complete'` | `false` | `ROLLBACK_COMPLETE` | None (auto-resolved) |
| **5e** Payroll write fails, rollback payroll fails, loans rollback OK | ❌ | ✅ | `'partial_loans'` | `true` | `ROLLBACK_PARTIAL` | Manual payroll restore |
| **5f** Payroll write fails, rollback payroll OK, loans rollback fails | ✅ | ❌ | `'partial_payroll'` | `true` | `ROLLBACK_PARTIAL` | Manual loan restore |
| **5g** Loan write fails first, rollback both OK | ✅ | ✅ | `'complete'` | `false` | `ROLLBACK_COMPLETE` | None |
| **5h** Both writes fail simultaneously (rare) | ❌ | ❌ | `'failed'` | `true` | `ROLLBACK_FAILED` | Full manual recovery |

**Scope Isolation Guarantee**: All restore operations use `persistPayrollsById` / `persistLoansById` which merge **only affected IDs** into canonical collections — out-of-scope records are never touched.

---

### 5. DETAILED IMPLEMENTATION SPEC

#### 5.1 `disbursePayrollAtomic` — Rollback Block Rewrite (lines 181-199)

```javascript
} catch (writeErr) {
  const recoveryToken = generateRecoveryToken();
  const preBatchHash = sha256hex(JSON.stringify(preBatch));
  const originalLoansHash = sha256hex(JSON.stringify(
    originalLoans.filter(l => l && affectedLoanIds.has(String(l.id)))
  ));

  // Emit rollback attempted event
  storage.addAudit('rollback_attempted', 'payroll', 
    `${targetMonth} → rollback started after write failure: ${writeErr.message} [${recoveryToken}]`, 
    batch.id);

  // Phase 5 central audit trail
  try {
    storage.appendAuditEvent({
      recordType: 'payroll',
      recordId: String(targetMonth),
      payrollId: batch.id,
      companyId: batch.companyId,
      branchId: batch.branchId,
      action: 'rollback_attempted',
      outcome: 'in_progress',
      actor: storage._recordActor(actorName),
      fromStatus: 'paid',
      toStatus: 'approved',
      rollbackDetail: {
        originalError: writeErr.message,
        affectedLoanIds: [...affectedLoanIds],
        preBatchSnapshotHash: preBatchHash,
        originalLoansSnapshotHash: originalLoansHash,
        recoveryToken,
      },
      reasonKind: 'rollback',
      recoveryToken,
    });
  } catch (e) { /* never break rollback */ }

  // Execute rollback with verification
  const payrollRestore = restorePayrollById(storage, preBatch, originalPayrolls);
  let loansRestore = { ok: true, restored: true, error: null };
  if (loansChanged) {
    loansRestore = restoreLoansById(storage, originalLoans, affectedLoanIds);
  }

  // Determine rollback status
  let rolledBackStatus;
  let financialDivergence = false;
  if (payrollRestore.ok && loansRestore.ok) {
    rolledBackStatus = 'complete';
  } else if (payrollRestore.ok && !loansRestore.ok) {
    rolledBackStatus = 'partial_payroll';
    financialDivergence = true;
  } else if (!payrollRestore.ok && loansRestore.ok) {
    rolledBackStatus = 'partial_loans';
    financialDivergence = true;
  } else {
    rolledBackStatus = 'failed';
    financialDivergence = true;
  }

  // Emit completion event
  const outcomeMap = { complete: 'success', partial_payroll: 'partial', partial_loans: 'partial', failed: 'failed' };
  storage.addAudit(`rollback_${rolledBackStatus === 'complete' ? 'complete' : rolledBackStatus === 'failed' ? 'failed' : 'partial'}`, 'payroll',
    `${targetMonth} → rollback ${rolledBackStatus}: payroll=${payrollRestore.restored}, loans=${loansRestore.restored} [${recoveryToken}]`,
    batch.id);

  try {
    storage.appendAuditEvent({
      recordType: 'payroll',
      recordId: String(targetMonth),
      payrollId: batch.id,
      companyId: batch.companyId,
      branchId: batch.branchId,
      action: rolledBackStatus === 'complete' ? 'rollback_complete' : 
              rolledBackStatus === 'failed' ? 'rollback_failed' : 'rollback_partial',
      outcome: outcomeMap[rolledBackStatus],
      actor: storage._recordActor(actorName),
      fromStatus: 'paid',
      toStatus: payrollRestore.ok ? 'approved' : 'paid (divergent)',
      rollbackDetail: {
        originalError: writeErr.message,
        payrollRestored: payrollRestore.ok,
        loansRestored: loansRestore.ok,
        payrollError: payrollRestore.error || null,
        loansError: loansRestore.error || null,
        affectedLoanIds: [...affectedLoanIds],
        preBatchSnapshotHash: preBatchHash,
        originalLoansSnapshotHash: originalLoansHash,
        recoveryToken,
      },
      financialDivergence,
      recoveryToken,
      reasonKind: 'rollback',
    });
  } catch (e) { /* never break */ }

  if (financialDivergence) {
    // Additional divergence alert event
    try {
      storage.appendAuditEvent({
        recordType: 'payroll',
        recordId: String(targetMonth),
        payrollId: batch.id,
        companyId: batch.companyId,
        branchId: batch.branchId,
        action: 'financial_divergence_detected',
        outcome: 'failed',
        actor: storage._recordActor(actorName),
        rollbackDetail: { recoveryToken },
        recoveryToken,
        reasonKind: 'divergence',
      });
    } catch (e) {}
  }

  return {
    ok: false,
    layer: 'storage',
    error: writeErr.message || 'storage_write_failure',
    rolledBack: rolledBackStatus,
    rollbackDetail: {
      payrollRestored: payrollRestore.ok,
      loansRestored: loansRestore.ok,
      payrollError: payrollRestore.error || null,
      loansError: loansRestore.error || null,
    },
    financialDivergence,
    recoveryToken,
    batch: batch,
  };
}
```

#### 5.2 `reversePayrollDisbursementAtomic` — Rollback Block Rewrite (lines 602-625)

Same pattern as 5.1, with:
- `fromStatus: 'approved'` (post-full-return target)
- `toStatus: 'paid'` (rollback target)
- `affectedLoanIds` = `reversedLoanIds`
- Include `fullReturn` metadata in audit for traceability

#### 5.3 `persistPayrollsById` / `persistLoansById` — No Changes Required

Already id-scoped, scope-safe. Only the **callers** change to handle return values.

---

### 6. REGRESSION TESTS — REQUIRED FOR EACH FAILURE MATRIX ENTRY

Add to `f01-disburse-atomicity-tests.mjs` and create new `f01-rollback-failure-tests.mjs`:

```javascript
// TEST MATRIX — 8 scenarios × 2 operations (disburse + full-return) = 16 tests

// 1. disburse: payroll write fails, rollback complete
test('disburse: before_batch_write → rollback complete', () => { ... });

// 2. disburse: payroll write fails, rollback payroll fails
test('disburse: before_batch_write + corrupt preBatch → rollback partial_payroll', () => { ... });

// 3. disburse: payroll write fails, rollback loans fail
test('disburse: before_batch_write + corrupt originalLoans → rollback partial_loans', () => { ... });

// 4. disburse: loan write fails, rollback complete
test('disburse: before_loan_write → rollback complete', () => { ... });

// 5. disburse: loan write fails, rollback payroll fails
test('disburse: before_loan_write + corrupt preBatch → rollback partial_loans', () => { ... });

// 6. disburse: loan write fails, rollback loans fail
test('disburse: before_loan_write + corrupt originalLoans → rollback partial_payroll', () => { ... });

// 7. disburse: after_writes (audit) fails, rollback complete
test('disburse: after_writes → rollback complete', () => { ... });

// 8. disburse: after_writes fails, both rollbacks fail
test('disburse: after_writes + corrupt both → rollback failed', () => { ... });

// 9-16. Same 8 for reversePayrollDisbursementAtomic (full-return)

// Additional: Scope isolation verification
test('disburse: rollback does not touch comp-2/br-2 records', () => { ... });

// Additional: Audit trail integrity
test('disburse: rollback audit events form valid hash chain', () => { ... });

// Additional: Recovery token present and unique
test('disburse: every rollback failure includes unique recoveryToken', () => { ... });
```

**Test Infrastructure**: Mock storage to inject failures at specific persistence steps:
- `storage.addPayrollBatch` throws on call N
- `storage.persistLoansById` throws on call N
- `storage.persistPayrollsById` throws during rollback
- `storage.persistLoansById` throws during rollback

---

### 7. COMPATIBILITY & NON-REGRESSION GUARANTEES

| Guarantee | How Preserved |
|-----------|---------------|
| **Authorization** | No permission changes; rollback runs after all guards passed |
| **Attribution** | Loan attribution logic unchanged; rollback restores exact pre-state |
| **Conservation** | Id-scoped persistence unchanged; out-of-scope never touched |
| **Atomicity (logical)** | Early failures (validation, permission, state) still zero side-effects; only storage-layer failures now have explicit status |
| **localStorage architecture** | No schema changes; uses existing `persist*ById` and `addAudit` |
| **Server sync** | Recovery tokens and audit events sync normally via existing pipeline |
| **Scope isolation** | All writes remain id-scoped via `persist*ById` |

---

### 8. EXPLICIT RETURN/ERROR SEMANTICS SUMMARY

**Success**: `{ ok: true, batch, loansChanged, settledLoans|reversedLoanIds }` — unchanged

**Validation/Permission/State Failure**: `{ ok: false, error, layer, batch }` — unchanged, `rolledBack` absent

**Storage Write Failure**: 
```javascript
{
  ok: false,
  layer: 'storage',
  error: string,
  rolledBack: 'complete' | 'partial_payroll' | 'partial_loans' | 'failed',
  rollbackDetail: { payrollRestored, loansRestored, payrollError?, loansError? },
  financialDivergence: boolean,
  recoveryToken: string,
  batch: originalBatch,
}
```

**Rollback Storage Failure** (during rollback itself):
- `rolledBack: 'failed'` or `'partial_*'`
- `financialDivergence: true`
- `recoveryToken` present
- Audit events: `rollback_attempted` → `rollback_failed`/`rollback_partial` + `financial_divergence_detected`

---

### 9. RECOVERY API (Future Enhancement — Not in This Fix)

```javascript
// Manual recovery operator action
export function recoverPayrollRollback({ storage, recoveryToken, action: 'restore_payroll' | 'restore_loans' | 'force_complete' }) {
  // Look up rollback audit event by recoveryToken
  // Apply missing restoration step
  // Emit recovery audit event
}
```

---

### 10. ACCEPTANCE CRITERIA

1. **No false `rolledBack: true`** — every return with `rolledBack` value has verified restoration
2. **Audit trail complete** — `rollback_attempted` → `rollback_complete|partial|failed` chain exists for every storage failure
3. **Divergence detectable** — `financialDivergence: true` + `financial_divergence_detected` audit event when any step fails
4. **Scope isolation** — comp-2/br-2 records byte-identical after any rollback scenario
5. **Recovery token** — unique, present in all rollback audit events and return value
6. **All 16 matrix tests pass** — 8 disburse + 8 full-return scenarios
7. **Existing tests pass** — no regression on success paths, early failures, concurrency, attribution

---

### 11. FILES TO MODIFY (Minimal Set)

1. `public/js/engines/payrollDisbursement.js` — Lines 181-199, 602-625, 245-254 (restore helpers)
2. `public/js/engines/auditTrail.js` — Add 5 new `AUDIT_ACTIONS`
3. `scripts/f01-disburse-atomicity-tests.mjs` — Extend with rollback verification
4. `scripts/f01-rollback-failure-tests.mjs` — New file for 16 matrix tests

**No changes to**: `storage.js` (persistence layer), `payrollAccess.js` (guards), `payrollEngine.js` (state machine), `types.js` (permissions)

---

CRIT_K_FIX_DESIGN_COMPLETE