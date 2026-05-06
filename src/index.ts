import { recvJson, sendOutput, sendError, type InitMessage } from "./protocol.js";
import { getOrCreateIdentity, initIdentityStorage } from "./identity.js";
import { ensureEphemeral, ephemeralSave, ephemeralRecall, ephemeralList, ephemeralDelete, ephemeralSearch, ephemeralGetRaw } from "./ephemeral.js";
import { mutableSave, mutableRecall, mutableList, mutableDelete } from "./mutable.js";
import { permanentSave, permanentRecall, permanentList, permanentDelete } from "./permanent.js";
import { publicKeyToBase64, fingerprint } from "@corvidlabs/ts-algochat";

type Tier = "ephemeral" | "mutable" | "permanent";

interface ParsedArgs {
  command: string;
  key?: string;
  value?: string;
  query?: string;
  ttl?: number;
  tier?: Tier;
  json: boolean;
}

const VALID_KEY_RE = /^[a-zA-Z0-9_\-.:]+$/;

function validateKey(key: string): boolean {
  return VALID_KEY_RE.test(key) && key.length <= 256;
}

function parseArgs(args: string[]): ParsedArgs {
  const command = args[0] ?? "help";
  let key: string | undefined;
  let value: string | undefined;
  let query: string | undefined;
  let ttl: number | undefined;
  let tier: Tier | undefined;
  let json = false;

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--key": key = args[++i]; break;
      case "--value": value = args[++i]; break;
      case "--query": query = args[++i]; break;
      case "--tier": tier = args[++i] as Tier; break;
      case "--ttl": ttl = parseInt(args[++i], 10); break;
      case "--json": json = true; break;
    }
  }

  if (key && !validateKey(key)) {
    sendError("Invalid key: must be alphanumeric, hyphens, underscores, dots, colons (max 256 chars)");
    process.exit(1);
  }

  return { command, key, value, query, ttl, tier, json };
}

function sendJson(data: unknown): void {
  sendOutput(JSON.stringify(data));
}

async function main() {
  const init = await recvJson<InitMessage>();
  const parsed = parseArgs(init.args);
  const pluginDir = init.plugin.dir;
  initIdentityStorage(init.project.root);

  if (parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h") {
    cmdHelp();
    process.exit(0);
  }

  const identity = await getOrCreateIdentity();

  if (parsed.command === "identity") {
    const data = {
      address: identity.address,
      publicKey: publicKeyToBase64(identity.publicKey),
      fingerprint: fingerprint(identity.publicKey),
    };
    if (parsed.json) {
      sendJson(data);
    } else {
      sendOutput(`Address: ${data.address}`);
      sendOutput(`Public key: ${data.publicKey}`);
      sendOutput(`Fingerprint: ${data.fingerprint}`);
    }
    process.exit(0);
  }

  const sqlReady = await ensureEphemeral(pluginDir);

  switch (parsed.command) {
    case "save": await cmdSave(parsed, identity, sqlReady); break;
    case "recall": await cmdRecall(parsed, identity, sqlReady); break;
    case "list": await cmdList(parsed, identity, sqlReady); break;
    case "delete": await cmdDelete(parsed, identity, sqlReady); break;
    case "promote": await cmdPromote(parsed, pluginDir, identity, sqlReady); break;
    default:
      sendError(`Unknown command: ${parsed.command}. Run: fledge memory help`);
      process.exit(1);
  }

  await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
  process.exit(0);
}

async function cmdSave(args: ParsedArgs, identity: ReturnType<typeof getOrCreateIdentity> extends Promise<infer T> ? T : never, sqlReady: boolean) {
  if (!args.key || !args.value) {
    sendError("Usage: fledge memory save --key <k> --value <v> [--tier ...] [--ttl <hours>]");
    process.exit(1);
  }
  const tier = args.tier ?? "ephemeral";
  switch (tier) {
    case "ephemeral":
      if (!sqlReady) { sendError("SQL plugin not available for ephemeral storage."); process.exit(1); }
      await ephemeralSave(args.key, args.value, identity, args.ttl);
      if (args.json) {
        sendJson({ ok: true, tier: "ephemeral", key: args.key, ttl: args.ttl ?? 168 });
      } else {
        sendOutput(`Saved to ephemeral: ${args.key} (expires in ${args.ttl ?? 168}h)`);
      }
      break;
    case "mutable": {
      const asaId = await mutableSave(args.key, args.value, identity);
      if (!asaId) process.exit(1);
      if (args.json) {
        sendJson({ ok: true, tier: "mutable", key: args.key, asaId });
      } else {
        sendOutput(`Saved to mutable (ASA ID: ${asaId}): ${args.key}`);
      }
      break;
    }
    case "permanent": {
      const txid = await permanentSave(args.key, args.value, identity);
      if (!txid) process.exit(1);
      if (args.json) {
        sendJson({ ok: true, tier: "permanent", key: args.key, txid });
      } else {
        sendOutput(`Saved to permanent (txid: ${txid}): ${args.key}`);
      }
      break;
    }
  }
}

async function cmdRecall(args: ParsedArgs, identity: ReturnType<typeof getOrCreateIdentity> extends Promise<infer T> ? T : never, sqlReady: boolean) {
  if (!args.key && !args.query) {
    sendError("Usage: fledge memory recall --key <k> | --query <search>");
    process.exit(1);
  }

  if (args.query) {
    if (!sqlReady) { sendError("SQL plugin not available for search."); process.exit(1); }
    const results = await ephemeralSearch(args.query, identity);
    if (args.json) {
      sendJson({ results: results.map(r => ({ key: r.key, value: r.value, tier: "ephemeral", updated_at: r.updated_at })) });
    } else {
      if (results.length === 0) { sendOutput("No memories found."); return; }
      for (const r of results) sendOutput(`[ephemeral] ${r.key} = ${r.value} (updated: ${r.updated_at})`);
    }
    return;
  }

  if (args.key) {
    if (sqlReady) {
      const result = await ephemeralRecall(args.key, identity);
      if (result) {
        if (args.json) {
          sendJson({ key: result.key, value: result.value, tier: "ephemeral", updated_at: result.updated_at, expires_at: result.expires_at });
        } else {
          const expiry = result.expires_at ? ` (expires: ${result.expires_at})` : "";
          sendOutput(`[ephemeral] ${result.key} = ${result.value} (updated: ${result.updated_at})${expiry}`);
        }
        return;
      }
    }

    const mResult = await mutableRecall(args.key, identity);
    if (mResult) {
      if (args.json) {
        sendJson({ key: mResult.key, value: mResult.value, tier: "mutable", asaId: mResult.asaId });
      } else {
        sendOutput(`[mutable] ${mResult.key} = ${mResult.value} (ASA: ${mResult.asaId})`);
      }
      return;
    }

    const pResult = await permanentRecall(args.key, identity);
    if (pResult) {
      if (args.json) {
        sendJson({ key: pResult.key, value: pResult.value, tier: "permanent", txid: pResult.txid, created: pResult.created });
      } else {
        sendOutput(`[permanent] ${pResult.key} = ${pResult.value} (tx: ${pResult.txid})`);
      }
      return;
    }

    if (args.json) {
      sendJson({ error: "not_found", key: args.key });
    } else {
      sendError(`Memory not found: ${args.key}`);
    }
    process.exit(1);
  }
}

async function cmdList(args: ParsedArgs, identity: ReturnType<typeof getOrCreateIdentity> extends Promise<infer T> ? T : never, sqlReady: boolean) {
  const showEphemeral = args.tier === "ephemeral" || !args.tier;
  const showMutable = args.tier === "mutable" || !args.tier;
  const showPermanent = args.tier === "permanent" || !args.tier;
  const memories: { key: string; tier: string; updated_at?: string; expires_at?: string | null; asaId?: string; txid?: string; created?: string }[] = [];

  if (showEphemeral && sqlReady) {
    const items = await ephemeralList(identity);
    for (const item of items) {
      memories.push({ key: item.key, tier: "ephemeral", updated_at: item.updated_at, expires_at: item.expires_at });
    }
  }
  if (showMutable) {
    const items = await mutableList(identity);
    for (const item of items) {
      memories.push({ key: item.key, tier: "mutable", asaId: item.asaId });
    }
  }
  if (showPermanent) {
    const items = await permanentList(identity);
    for (const item of items) {
      memories.push({ key: item.key, tier: "permanent", txid: item.txid, created: item.created });
    }
  }

  if (args.json) {
    sendJson({ memories });
  } else {
    if (memories.length === 0) { sendOutput("No memories found."); return; }
    for (const m of memories) {
      if (m.tier === "ephemeral") {
        const expiry = m.expires_at ? ` expires:${m.expires_at}` : "";
        sendOutput(`ephemeral    ${m.key.padEnd(20)} ${m.updated_at}${expiry}`);
      } else {
        sendOutput(`mutable      ${m.key.padEnd(20)} ASA:${m.asaId}`);
      }
    }
  }
}

async function cmdDelete(args: ParsedArgs, identity: ReturnType<typeof getOrCreateIdentity> extends Promise<infer T> ? T : never, sqlReady: boolean) {
  if (!args.key) {
    sendError("Usage: fledge memory delete --key <k>");
    process.exit(1);
  }
  let deleted = false;
  let fromTier = "";
  let tombstoneTxid: string | null = null;
  if ((args.tier === "ephemeral" || !args.tier) && sqlReady) {
    deleted = await ephemeralDelete(args.key, identity);
    if (deleted) fromTier = "ephemeral";
  }
  if (!deleted && (args.tier === "mutable" || !args.tier)) {
    deleted = await mutableDelete(args.key, identity);
    if (deleted) fromTier = "mutable";
  }
  if (!deleted && args.tier === "permanent") {
    // Tombstone the permanent record. The original tx remains on-chain
    // (that's what "permanent" means), but a follow-up tx with a
    // tombstone note tells scanPermanent to treat the key as deleted.
    tombstoneTxid = await permanentDelete(args.key, identity);
    if (tombstoneTxid) {
      deleted = true;
      fromTier = "permanent";
    }
  }
  if (deleted) {
    if (args.json) {
      sendJson(tombstoneTxid
        ? { ok: true, key: args.key, tier: fromTier, tombstoneTxid }
        : { ok: true, key: args.key, tier: fromTier });
    } else {
      sendOutput(`Deleted from ${fromTier}: ${args.key}`);
    }
  } else {
    if (args.json) {
      sendJson({ error: "not_found", key: args.key });
    } else {
      sendError(`Memory not found: ${args.key}`);
    }
    process.exit(1);
  }
}

async function cmdPromote(args: ParsedArgs, pluginDir: string, identity: ReturnType<typeof getOrCreateIdentity> extends Promise<infer T> ? T : never, sqlReady: boolean) {
  if (!args.key) {
    sendError("Usage: fledge memory promote --key <k> [--tier mutable|permanent]");
    process.exit(1);
  }
  if (!sqlReady) {
    sendError("SQL plugin not available — cannot read ephemeral memories.");
    process.exit(1);
  }

  const targetTier = (!args.tier || args.tier === "ephemeral") ? "mutable" : args.tier;
  const value = await ephemeralGetRaw(args.key, identity);
  if (!value) {
    sendError(`Memory not found in ephemeral tier: ${args.key}`);
    process.exit(1);
  }

  if (targetTier === "mutable") {
    const asaId = await mutableSave(args.key, value, identity);
    if (!asaId) process.exit(1);
    await ephemeralDelete(args.key, identity);
    if (args.json) {
      sendJson({ ok: true, key: args.key, from: "ephemeral", to: "mutable", asaId });
    } else {
      sendOutput(`Promoted ${args.key} from ephemeral to mutable (ASA ID: ${asaId})`);
    }
  } else if (targetTier === "permanent") {
    const txid = await permanentSave(args.key, value, identity);
    if (!txid) process.exit(1);
    await ephemeralDelete(args.key, identity);
    if (args.json) {
      sendJson({ ok: true, key: args.key, from: "ephemeral", to: "permanent", txid });
    } else {
      sendOutput(`Promoted ${args.key} from ephemeral to permanent (txid: ${txid})`);
    }
  }
}

function cmdHelp() {
  sendOutput("fledge-plugin-memory — Three-tier encrypted memory management");
  sendOutput("  Uses: fledge-plugin-sql, fledge-plugin-localnet, @corvidlabs/ts-algochat");
  sendOutput("");
  sendOutput("Commands:");
  sendOutput("  save --key <k> --value <v> [--tier ...] [--ttl <hours>] [--json]");
  sendOutput("  recall --key <k> | --query <search> [--json]");
  sendOutput("  list [--tier ...] [--json]");
  sendOutput("  delete --key <k> [--json]");
  sendOutput("  promote --key <k> [--tier mutable|permanent] [--json]");
  sendOutput("  identity [--json]                Show wallet & encryption key");
  sendOutput("");
  sendOutput("Tiers: ephemeral (default, 7d TTL), mutable (on-chain ASA), permanent (immutable tx)");
  sendOutput("All memories are encrypted and tied to your wallet identity.");
}

main().catch((err) => {
  sendError(String(err));
  process.exit(1);
});
