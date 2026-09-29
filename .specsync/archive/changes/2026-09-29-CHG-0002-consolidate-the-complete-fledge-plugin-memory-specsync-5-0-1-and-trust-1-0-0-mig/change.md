---
id: CHG-0002-consolidate-the-complete-fledge-plugin-memory-specsync-5-0-1-and-trust-1-0-0-mig
state: archived
type: migration
base_commit: 0924825732e50308f0e97a9bcf63ed2e2435d737
---

# Consolidate the complete fledge-plugin-memory SpecSync 5.0.1 and Trust 1.0.0 migration with portable final evidence

## Intent

Consolidate the complete fledge-plugin-memory SpecSync 5.0.1 and Trust 1.0.0 migration with portable final evidence

## Affected Canonical Specs

- `memory`

## Acceptance Criteria

- The exact main-to-head migration and correction paths are governed without a dot scope; the native evidence lane passes independently; the separate strict CI lane passes at 100% coverage; Gemini forwards {{args}}; final portable evidence records the verified submitted history.

## No-spec Rationale

This successor governs the complete submitted migration and configuration-correction delivery range without changing the already accepted Memory product contract.

## Migration Note

Migrated by hand to SpecSync 6 per Leif's decision (2026-09-28); the 6.0.0 tool refused to archive this legacy record (`` exact-only delivery input `.github/workflows/trust.yml` changed after acceptance and requires an audited reopen; run `specsync change reopen CHG-0002-consolidate-the-complete-fledge-plugin-memory-specsync-5-0-1-and-trust-1-0-0-mig` to re-verify the accepted change, or supersede it from a later change under a module granted the path by `owns` in `.specsync/config.toml` ``).

- Workflow v1 (SpecSync 5) record, accepted on 2026-07-14 by the closing approval already stored in `approvals.json`. SpecSync 6.0.0 reports its accepted evidence as stale, for the reason quoted above.
- Moved by hand from `.specsync/changes/CHG-0002-consolidate-the-complete-fledge-plugin-memory-specsync-5-0-1-and-trust-1-0-0-mig/` into the layout `specsync change archive` writes: `accepted-state.json` is the unchanged accepted `state.json`, `state.json` is marked `archived`, and this file's front matter says `archived`.
- `approvals.json`, `verification.json`, `verification-attempts.json` and every other artifact are the original SpecSync 5 evidence, unchanged. `verification.json` verifies commit `e6d1c62cfec59847ec5dae7d4511007163c7eccc`, not the tree this record was archived from.
- This migration added no verification evidence, test result, attempt history, or approval. It is a manual migration, not a fresh re-verification.
- Closing it through the tool takes `specsync change reopen`, `specsync change verify`, then `specsync change accept`, which writes a new closing approval. Per Leif's decision it was archived by hand instead, so no reopen or new approval is recorded.
