---
change: CHG-0002-consolidate-the-complete-fledge-plugin-memory-specsync-5-0-1-and-trust-1-0-0-mig
artifact: testing
---

# Testing

- `fledge lanes run verify` must pass build, 29 tests, ShellCheck, shell syntax, and manifest validation without invoking SpecSync recursively.
- `fledge lanes run ci` must pass the same native tasks followed by released `specsync check --strict --require-coverage 100 --force`.
- `specsync agents status` must report Claude, Cursor, Codex, and Gemini installed.
- `fledge trust doctor` and `fledge trust verify` must pass under the committed Trust 1.0.0 policy, with progressive provenance allowed by policy.
- Hosted Trust and CodeQL must pass on the exact submitted head before merge.
