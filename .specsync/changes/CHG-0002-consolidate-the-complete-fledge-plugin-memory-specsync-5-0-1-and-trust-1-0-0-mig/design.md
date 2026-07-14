---
change: CHG-0002-consolidate-the-complete-fledge-plugin-memory-specsync-5-0-1-and-trust-1-0-0-mig
artifact: design
---

# Design

Keep `lanes.verify` limited to the existing build, test, ShellCheck, shell syntax, and manifest tasks. Add a strict SpecSync task and a separate `lanes.ci` composition containing all native tasks plus that contract gate.

Correct only the generated Gemini change-creation instruction, replacing `$ARGUMENTS` with `{{args}}`. CHG-0002 lists each migration or correction file explicitly and does not use a repository-wide dot scope. It declares no canonical spec change because CHG-0001 already contains the accepted Memory contract.
