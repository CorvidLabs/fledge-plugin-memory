# fledge-plugin-memory

Three-tier encrypted memory plugin for [fledge](https://github.com/CorvidLabs/fledge). Store agent memories in SQLite (ephemeral), ARC-69 ASAs (mutable), or immutable Algorand transactions (permanent).

![spec coverage](https://img.shields.io/endpoint?url=https://corvidlabs.github.io/fledge-plugin-memory/badges/coverage.json)

## Install

```bash
fledge plugins install CorvidLabs/fledge-plugin-memory
```

## Commands

### `fledge memory identity`

Show wallet address and encryption key fingerprint.

```
$ fledge memory identity --json
{"address":"PZZCVTTZ...","publicKey":"xSlL38...","fingerprint":"FC36 727E 1041 C3BF"}
```

### `fledge memory save --key <k> --value <v> [--tier ...] [--ttl <hours>]`

Save a memory. Defaults to ephemeral tier with 7-day TTL.

```
$ fledge memory save --key user.name --value "Leif" --json
{"ok":true,"tier":"ephemeral","key":"user.name","ttl":168}

$ fledge memory save --key agent.role --value "Lead coordinator" --tier mutable --json
{"ok":true,"tier":"mutable","key":"agent.role","asaId":"115320"}

$ fledge memory save --key founding.date --value "2026-01-15" --tier permanent --json
{"ok":true,"tier":"permanent","key":"founding.date","txid":"DGADHO..."}
```

### `fledge memory recall --key <k>` or `--query <q>`

Retrieve a memory by exact key or fuzzy search.

```
$ fledge memory recall --key user.name --json
{"key":"user.name","value":"Leif","tier":"ephemeral","updated_at":"2026-05-06T18:22:30Z"}

$ fledge memory recall --query "user" --json
[{"key":"user.name","value":"Leif","tier":"ephemeral"},{"key":"user.role","value":"developer","tier":"ephemeral"}]
```

### `fledge memory list [--tier ...]`

List all memories, optionally filtered by tier.

```
$ fledge memory list --json
{"memories":[{"key":"user.name","tier":"ephemeral"},{"key":"agent.role","tier":"mutable","asaId":"115320"}]}
```

### `fledge memory delete --key <k>`

Delete a memory. Works for ephemeral (SQLite row) and mutable (ASA destruction). Permanent memories cannot be deleted.

```
$ fledge memory delete --key user.name --json
{"ok":true,"key":"user.name","tier":"ephemeral"}
```

### `fledge memory promote --key <k> [--tier ...]`

Promote a memory to a higher tier (e.g., ephemeral to mutable).

```
$ fledge memory promote --key important.fact --tier mutable --json
{"ok":true,"key":"important.fact","from":"ephemeral","to":"mutable","asaId":"115322"}
```

## Memory Tiers

| Tier | Backend | Mutable | TTL | Dependency |
|------|---------|---------|-----|------------|
| ephemeral | SQLite | Yes | 7 days (configurable via `--ttl`) | fledge-plugin-sql |
| mutable | ARC-69 ASA | Yes | None | fledge-plugin-localnet |
| permanent | Algorand txn | No | None (immutable) | fledge-plugin-localnet |

All memories are encrypted at rest using ChaCha20-Poly1305 (via [@corvidlabs/ts-algochat](https://github.com/CorvidLabs/ts-algochat)) and tied to a wallet identity.

## Data Persistence

Your wallet identity (address + encryption keys) is stored in `.fledge/memory-identity.json` within your project directory (mode `0600`). This file survives plugin reinstalls.

- **Ephemeral** memories live in a SQLite database managed by `fledge-plugin-sql`. The database file persists across plugin reinstalls.
- **Mutable** memories are on-chain ASAs that persist as long as the Algorand network is running. A `fledge localnet reset` will destroy them.
- **Permanent** memories are immutable Algorand transactions that persist as long as the chain exists.

**Important:** If you delete `.fledge/memory-identity.json`, a new identity is generated and you will not be able to decrypt existing ephemeral memories. On-chain memories (mutable/permanent) will also be inaccessible since they are tied to the old wallet address.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ALGOD_URL` | `http://localhost:4001` | Algorand algod endpoint (mutable/permanent tiers) |
| `INDEXER_URL` | `http://localhost:8980` | Algorand indexer endpoint (mutable recall/list) |
| `KMD_URL` | `http://localhost:4002` | KMD endpoint (for auto-funding) |
| `ALGOD_TOKEN` | localnet default | Algod API token |
| `KMD_TOKEN` | localnet default | KMD API token |

When saving to mutable or permanent tiers, the plugin auto-funds the wallet via KMD if the balance is insufficient.

## Exposing Localnet to Remote Agents (socat)

If the Algorand localnet runs on a different machine (e.g., a host providing Docker to a sandboxed agent), bridge the ports with socat:

```bash
# On the host running Docker/AlgoKit localnet:
socat TCP-LISTEN:4001,fork,reuseaddr,bind=0.0.0.0 TCP:localhost:4001 &
socat TCP-LISTEN:8980,fork,reuseaddr,bind=0.0.0.0 TCP:localhost:8980 &
socat TCP-LISTEN:4002,fork,reuseaddr,bind=0.0.0.0 TCP:localhost:4002 &
```

Then set env vars on the agent side:

```bash
export ALGOD_URL=http://<host-ip>:4001
export INDEXER_URL=http://<host-ip>:8980
export KMD_URL=http://<host-ip>:4002
```

## Security

- All sensitive state (private keys, mnemonics) is stored with file mode `0600` (owner-read-only).
- Memory keys are validated against a strict allowlist (`a-zA-Z0-9_-.:`, max 256 chars) to prevent injection.
- Memory values are encrypted with ChaCha20-Poly1305 before storage (ephemeral tier) or on-chain submission (mutable/permanent tiers).

## Prerequisites

- `fledge-plugin-sql` (for ephemeral tier)
- `fledge-plugin-localnet` or remote Algorand node (for mutable/permanent tiers)

## Development

```bash
bun install
bun test
```

## License

MIT
