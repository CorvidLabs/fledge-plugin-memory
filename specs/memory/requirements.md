---
spec: memory.spec.md
---

## User Stories

- As an AI agent, I want to persist memories across sessions with different durability tiers
- As a developer, I want to store project data locally or on-chain
- As a developer, I want to promote important memories to durable storage

## Acceptance Criteria

- Three tiers work independently with graceful degradation
- Ephemeral falls back to store when sql plugin absent
- Clear error messages for missing plugins

## Constraints

- Composes with other plugins via exec
- TypeScript/Bun implementation

## Out of Scope

- Cross-project sharing

## Implemented (previously out of scope)

- Encryption at rest (all tiers use ts-algochat NaCl envelope encryption)
- Memory expiration/TTL (ephemeral tier supports --ttl in hours, default 168h)
