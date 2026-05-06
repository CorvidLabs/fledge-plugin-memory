---
spec: memory.spec.md
---

## Context

Extracted from corvid-agent's three-tier memory system.

## Related Modules

- fledge-plugin-sql (ephemeral tier backend)
- fledge-plugin-localnet (on-chain tier backend)
- corvid-agent memory system (compatible design)

## Design Decisions

- Composes with sql/localnet plugins via exec rather than importing code
- Ephemeral falls back to fledge-v1 store capability for basic operation
- ARC-69 for mutable tier -- standard format, updatable
- Payment transaction notes for permanent tier -- simplest immutable storage
