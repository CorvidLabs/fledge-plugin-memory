---
module: memory
version: 1
status: active
files:
  - src/index.ts
  - src/protocol.ts
  - src/ephemeral.ts
  - src/mutable.ts
  - src/permanent.ts

db_tables:
  - memories
depends_on: []
---

# Memory

## Purpose

Three-tier memory system for fledge projects. Provides ephemeral (SQLite), mutable (ARC-69 ASAs), and permanent (on-chain transactions) storage tiers. Each tier offers different persistence, mutability, and cost trade-offs. Uses fledge-v1 `exec` capability to compose with fledge-plugin-sql and fledge-plugin-localnet.

## Public API

### Commands

| Command | Args | Description |
|---------|------|-------------|
| `save` | `--key <k> --value <v> [--tier ephemeral\|mutable\|permanent]` | Save a memory. Default: ephemeral. |
| `recall` | `--key <k>` or `--query <search>` | Retrieve by key or fuzzy search |
| `list` | `[--tier ephemeral\|mutable\|permanent]` | List memories |
| `delete` | `--key <k>` | Delete (ephemeral/mutable only) |
| `promote` | `--key <k> [--tier mutable\|permanent]` | Move to higher tier |

### Modules

| File | Responsibility |
|------|---------------|
| `src/index.ts` | Entry point, arg parsing, command dispatch |
| `src/protocol.ts` | fledge-v1 send/recv helpers |
| `src/ephemeral.ts` | SQLite-backed ephemeral tier via `fledge sql` |
| `src/mutable.ts` | ARC-69 ASA-backed mutable tier |
| `src/permanent.ts` | Transaction note-field permanent tier |

## Invariants

1. Default tier is ephemeral if `--tier` is not specified.
2. Ephemeral tier falls back to fledge-v1 `store` if fledge-plugin-sql is not installed.
3. Mutable and permanent tiers require fledge-plugin-localnet.
4. `delete` on permanent returns error: "Permanent memories cannot be deleted."
5. `promote` copies value to target tier and deletes from source.
6. `recall --query` searches across all available tiers.
7. Ephemeral tier auto-initializes database and migrations on first use.
8. Mutable tier uses ARC-69 metadata in asset config transaction notes.
9. Permanent tier uses payment transaction note fields with JSON.
10. All operations go through fledge-v1 `exec` to call other plugins.

## Behavioral Examples

```
$ fledge memory save --key user-name --value "Alice"
  Saved to ephemeral: user-name

$ fledge memory save --key api-key --value "sk_123" --tier mutable
  Saved to mutable (ASA ID: 42): api-key

$ fledge memory recall --key user-name
  [ephemeral] user-name = Alice (updated: 2026-05-06 10:00)

$ fledge memory list
  Tier        Key           Updated
  ephemeral   user-name     2026-05-06 10:00
  mutable     api-key       2026-05-06 10:01

$ fledge memory promote --key user-name --tier permanent
  Promoted user-name from ephemeral to permanent (txid: ABC123...)

$ fledge memory delete --key user-name
  Deleted from ephemeral: user-name
```

## Error Cases

| Error | When | Behavior |
|-------|------|----------|
| `fledge-plugin-sql not installed` | Ephemeral without sql | Fall back to store with warning |
| `fledge-plugin-localnet not installed` | Mutable/permanent ops | Error with install instructions |
| `Localnet not running` | On-chain ops when stopped | Error with start hint |
| `Key not found` | Unknown key | Error: "Memory not found: <key>" |
| `Cannot delete permanent` | Delete permanent | Error message |
| `Tier unavailable` | Save to missing tier | Error with install/start instructions |

## Dependencies

- fledge-plugin-sql (runtime, ephemeral tier -- optional)
- fledge-plugin-localnet (runtime, mutable/permanent)
- `algosdk` (ARC-69 ASA construction)
- fledge-v1 protocol

## Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1 | 2026-05-06 | Initial spec |
