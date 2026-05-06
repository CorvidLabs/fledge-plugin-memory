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

## Memory Tiers

| Tier | Backend | Mutable | Dependency |
|------|---------|---------|------------|
| ephemeral | SQLite | Yes | fledge-plugin-sql |
| mutable | ARC-69 ASA | Yes | fledge-plugin-localnet |
| permanent | Algorand txn | No | fledge-plugin-localnet |
