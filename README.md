# fledge-plugin-memory

Three-tier memory plugin for [fledge](https://github.com/CorvidLabs/fledge).

## Install

```bash
fledge plugins install CorvidLabs/fledge-plugin-memory
```

## Commands

| Command | Description |
|---------|-------------|
| `fledge memory save --key <k> --value <v> [--tier ...]` | Save a memory |
| `fledge memory recall --key <k>` or `--query <q>` | Retrieve memories |
| `fledge memory list [--tier ...]` | List memories |
| `fledge memory delete --key <k>` | Delete (ephemeral/mutable) |
| `fledge memory promote --key <k> [--tier ...]` | Promote to higher tier |
| `fledge memory identity` | Show wallet address and encryption key |

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
- **Mutable** memories are on-chain ASAs — they persist as long as the Algorand network is running. A `fledge localnet reset` will destroy them.
- **Permanent** memories are immutable Algorand transactions — they persist as long as the chain exists.

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

## Remote Localnet (socat)

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
