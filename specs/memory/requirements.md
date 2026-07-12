---
spec: memory.spec.md
---

## User Stories

- As an AI agent, I want to persist memories across sessions with different durability tiers
- As a developer, I want to store project data locally or on-chain
- As a developer, I want to promote important memories to durable storage

## Acceptance Criteria

### REQ-memory-001

All three storage tiers work independently with graceful degradation when an optional backend is unavailable.

### REQ-memory-002

The ephemeral tier falls back to the fledge-v1 store capability when the SQL plugin is absent.

### REQ-memory-003

Missing plugins, unavailable localnet, unknown keys, and forbidden permanent deletion produce clear errors.

### REQ-memory-004

All tiers encrypt values before persistence and decrypt values only after successful retrieval.

### REQ-memory-005

On-chain values that exceed a single payload limit are chunked and reassembled in deterministic order.

### REQ-memory-006

Ephemeral memories honor their configured expiration and default TTL behavior.

## Constraints

- Composes with other plugins via exec
- TypeScript/Bun implementation

## Out of Scope

- Cross-project sharing

## Implemented (previously out of scope)

- Encryption at rest (all tiers use ts-algochat NaCl envelope encryption)
- Memory expiration/TTL (ephemeral tier supports --ttl in hours, default 168h)
