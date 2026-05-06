---
spec: memory.spec.md
---

## Test Plan

### Unit Tests

- Arg parsing for all commands
- Tier resolution (default, explicit, fallback)

### Integration Tests

- Ephemeral save/recall/list/delete via fledge sql
- Ephemeral fallback to store
- Mutable save/recall/delete via ARC-69 (requires localnet)
- Permanent save/recall (requires localnet)
- Promote from ephemeral to mutable/permanent
- Cross-tier search
- Error cases: missing plugins, key not found, delete permanent
