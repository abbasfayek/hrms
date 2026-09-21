# Production Release Handover — v1.3.0 (Release Candidate)

**Project:** HRMS / BinoSoft
**Version:** `v1.3.0`
**Status:** `RELEASE CANDIDATE` (not a final release)
**Release Candidate preparation date:** 2026-09-21
**Final Release Date:** not set (release commit/tag pending)

---

## 1. Release Identity (v1.3.0)

| Item | Value |
| :--- | :--- |
| **Project** | HRMS / BinoSoft |
| **Version** | `v1.3.0` (Release Candidate) |
| **Status** | `RELEASE CANDIDATE` |
| **Current candidate HEAD** | `ad72e4d80faee946d53126a74a97c1657b905bcf` |
| **Git tag `v1.3.0`** | **PENDING** (does not exist yet) |
| **Release commit** | **PENDING** |
| **Final tag** | **PENDING** |
| **Final release SHA** | **PENDING** |

> This document describes the v1.3.0 Release Candidate only. The Git tag `v1.3.0`, the release commit, and the final release SHA have **not** been created yet. Do not treat `v1.3.0` as an existing Git tag.

---

## 2. Version History (already released — unchanged)

| Version | Git tag | Commit | Date | Status |
| :--- | :--- | :--- | :--- | :--- |
| v1.0.0 | `v1.0.0` | `6ba5503c` | 2026-09-12 | First Production Release |
| v1.1.0 | `v1.1.0` | `5c35c916` | 2026-09-15 | Released |
| v1.1.1 | `v1.1.1` | `48933f11` | 2026-09-16 | Released |
| v1.2.0 | `v1.2.0` | `852b17ee` | 2026-09-17 | Released |
| **v1.3.0** | `v1.3.0` (**PENDING**) | **PENDING** | 2026-09-21 | **Release Candidate** |

---

## 3. Release Candidate Basis

- The v1.3.0 Release Candidate is based on the repository state at HEAD:
  `ad72e4d80faee946d53126a74a97c1657b905bcf`
  (`docs(test): track project architecture and regression assets`).
- v1.2.0 (`852b17ee0574ec435eb5d57f3edcae86aeb15979`) is a confirmed ancestor of the candidate HEAD, so the candidate includes all v1.2.0 content plus subsequent commits.
- **Repository identity check** — after the final release is tagged:
  ```text
  git describe --tags
  should resolve to v1.3.0
  ```
  Before the final release, `git rev-parse HEAD` must equal the approved release candidate commit.

---

## 4. Working Tree / Release State

```text
Release preparation is in progress.
The release commit/tag have not been created yet.
```

The working tree currently contains release-preparation changes and untracked documentation that are pending the release commit. It is **not** marked Clean.

---

## 5. Test & Verification Status

The candidate continues from the previously validated release baseline:

- Release Gate Suite: **66 / 66 PASS**
- Live E2E Backup & Restore: **26 / 26 PASS**
- Regression suites and production build passed for the v1.0.0–v1.2.0 lineage.
- Subsequent candidate commits add print integrations, payroll resubmit/audit stability fixes, an i18n fix, and a unified green test gate (39/39 PASS, `npm test`).

> Final consolidated verification results will be recorded alongside the release commit.

---

## 6. Deployment

- Follow `docs/PRODUCTION_SETUP_v1.3.0.md` for the operator installation checklist (v1.3.0 Release Candidate).
- The historical `docs/PRODUCTION_SETUP_v1.2.0.md` remains the reference for the v1.2.0 installation.
- This v1.3.0 handover document is a **Release Candidate** artifact; a final handover will be issued after the release commit/tag.

---

**Status: RELEASE CANDIDATE — NOT FINAL.**

Release commit: **PENDING** · Final tag: **PENDING** · Final release SHA: **PENDING**