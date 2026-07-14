---
change: CHG-0002-consolidate-the-complete-fledge-plugin-memory-specsync-5-0-1-and-trust-1-0-0-mig
artifact: tasks
---

# Tasks

- Configure `lanes.verify` as the native evidence lane.
- Configure `lanes.ci` as the native plus strict SpecSync gate.
- Use Gemini's `{{args}}` placeholder in the generated change command.
- Validate that CHG-0002 has explicit paths and no `.` scope.
- Run native verification, released SpecSync 5.0.1 strict validation, agent status, and Trust doctor/verify.
- Record portable definition and closing approvals as `user:0xLeif` at their appropriate lifecycle gates.
