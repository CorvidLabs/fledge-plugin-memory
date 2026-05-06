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
