---
change: CHG-0002-consolidate-the-complete-fledge-plugin-memory-specsync-5-0-1-and-trust-1-0-0-mig
artifact: research
---

# Research

- SpecSync change verification executes the commands in `.specsync/sdd.json`. Calling strict SpecSync validation from that same evidence lane creates a circular dependency while an active change is waiting for evidence.
- A native-only `verify` lane provides reproducible implementation evidence. A separate `ci` lane can compose the native tasks with `specsync check --strict --require-coverage 100 --force` after evidence exists.
- Gemini custom commands interpolate user input through `{{args}}`; `$ARGUMENTS` is not supplied by that integration.
- SpecSync 5.0.2 adds the supported successor lifecycle needed to govern an already-accepted migration without rewriting its accepted definition. The repository remains a SpecSync 5.0.1 consumer.
