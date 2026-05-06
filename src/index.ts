import { recvJson, sendOutput, sendError, type InitMessage } from "./protocol.js";
import { getOrCreateIdentity } from "./identity.js";
import { ensureEphemeral, ephemeralSave, ephemeralRecall, ephemeralList, ephemeralDelete, ephemeralSearch, ephemeralGetRaw } from "./ephemeral.js";
import { mutableSave, mutableRecall, mutableList, mutableDelete } from "./mutable.js";
import { permanentSave } from "./permanent.js";
import { publicKeyToBase64, fingerprint } from "@corvidlabs/ts-algochat";

interface ParsedArgs {
  command: string;
  key?: string;
  value?: string;
  query?: string;
  ttl?: number;
  tier: "ephemeral" | "mutable" | "permanent";
}

function parseArgs(args: string[]): ParsedArgs {
  const command = args[0] ?? "help";
  let key: string | undefined;
  let value: string | undefined;
  let query: string | undefined;
  let ttl: number | undefined;
  let tier: "ephemeral" | "mutable" | "permanent" = "ephemeral";

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--key": key = args[++i]; break;
      case "--value": value = args[++i]; break;
      case "--query": query = args[++i]; break;
      case "--tier": tier = args[++i] as typeof tier; break;
      case "--ttl": ttl = parseInt(args[++i], 10); break;
    }
  }
  return { command, key, value, query, ttl, tier };
}

async function main() {
  const init = await recvJson<InitMessage>();
  const parsed = parseArgs(init.args);
  const pluginDir = init.plugin.dir;

  if (parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h") {
    cmdHelp();
    process.exit(0);
  }

  const identity = await getOrCreateIdentity();

  if (parsed.command === "identity") {
    sendOutput(`Address: ${identity.address}`);
    sendOutput(`Public key: ${publicKeyToBase64(identity.publicKey)}`);
    sendOutput(`Fingerprint: ${fingerprint(identity.publicKey)}`);
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
  switch (args.tier) {
    case "ephemeral":
      if (!sqlReady) { sendError("SQL plugin not available for ephemeral storage."); process.exit(1); }
      await ephemeralSave(args.key, args.value, identity, args.ttl);
      sendOutput(`Saved to ephemeral: ${args.key} (expires in ${args.ttl ?? 168}h)`);
      break;
    case "mutable": {
      const asaId = await mutableSave(args.key, args.value, identity);
      if (!asaId) process.exit(1);
      sendOutput(`Saved to mutable (ASA ID: ${asaId}): ${args.key}`);
      break;
    }
    case "permanent": {
      const txid = await permanentSave(args.key, args.value, identity);
      if (!txid) process.exit(1);
      sendOutput(`Saved to permanent (txid: ${txid}): ${args.key}`);
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
    if (results.length === 0) { sendOutput("No memories found."); return; }
    for (const r of results) sendOutput(`[ephemeral] ${r.key} = ${r.value} (updated: ${r.updated_at})`);
    return;
  }

  if (args.key) {
    if (sqlReady) {
      const result = await ephemeralRecall(args.key, identity);
      if (result) {
        const expiry = result.expires_at ? ` (expires: ${result.expires_at})` : "";
        sendOutput(`[ephemeral] ${result.key} = ${result.value} (updated: ${result.updated_at})${expiry}`);
        return;
      }
    }

    const mResult = await mutableRecall(args.key, identity);
    if (mResult) {
      sendOutput(`[mutable] ${mResult.key} = ${mResult.value} (ASA: ${mResult.asaId})`);
      return;
    }

    sendError(`Memory not found: ${args.key}`);
  }
}

async function cmdList(args: ParsedArgs, identity: ReturnType<typeof getOrCreateIdentity> extends Promise<infer T> ? T : never, sqlReady: boolean) {
  const showEphemeral = args.tier === "ephemeral" || !args.tier;
  const showMutable = args.tier === "mutable" || !args.tier;
  let hasResults = false;

  if (showEphemeral && sqlReady) {
    const items = await ephemeralList(identity);
    for (const item of items) {
      const expiry = item.expires_at ? ` expires:${item.expires_at}` : "";
      sendOutput(`ephemeral    ${item.key.padEnd(20)} ${item.updated_at}${expiry}`);
      hasResults = true;
    }
  }
  if (showMutable) {
    const items = await mutableList(identity);
    for (const item of items) {
      sendOutput(`mutable      ${item.key.padEnd(20)} ASA:${item.asaId}`);
      hasResults = true;
    }
  }
  if (!hasResults) sendOutput("No memories found.");
}

async function cmdDelete(args: ParsedArgs, identity: ReturnType<typeof getOrCreateIdentity> extends Promise<infer T> ? T : never, sqlReady: boolean) {
  if (!args.key) {
    sendError("Usage: fledge memory delete --key <k>");
    process.exit(1);
  }
  if (args.tier === "permanent") {
    sendError("Permanent memories cannot be deleted.");
    process.exit(1);
  }
  let deleted = false;
  if ((args.tier === "ephemeral" || !args.tier) && sqlReady) {
    deleted = await ephemeralDelete(args.key, identity);
    if (deleted) { sendOutput(`Deleted from ephemeral: ${args.key}`); return; }
  }
  if (args.tier === "mutable" || (!args.tier && !deleted)) {
    deleted = await mutableDelete(args.key, identity);
    if (deleted) { sendOutput(`Deleted from mutable: ${args.key}`); return; }
  }
  if (!deleted) sendError(`Memory not found: ${args.key}`);
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

  const targetTier = args.tier === "ephemeral" ? "mutable" : args.tier;
  const value = await ephemeralGetRaw(args.key, identity);
  if (!value) {
    sendError(`Memory not found in ephemeral tier: ${args.key}`);
    process.exit(1);
  }

  if (targetTier === "mutable") {
    const asaId = await mutableSave(args.key, value, identity);
    if (!asaId) process.exit(1);
    await ephemeralDelete(args.key, identity);
    sendOutput(`Promoted ${args.key} from ephemeral to mutable (ASA ID: ${asaId})`);
  } else if (targetTier === "permanent") {
    const txid = await permanentSave(args.key, value, identity);
    if (!txid) process.exit(1);
    await ephemeralDelete(args.key, identity);
    sendOutput(`Promoted ${args.key} from ephemeral to permanent (txid: ${txid})`);
  }
}

function cmdHelp() {
  sendOutput("fledge-plugin-memory — Three-tier encrypted memory management");
  sendOutput("  Uses: fledge-plugin-sql, fledge-plugin-localnet, @corvidlabs/ts-algochat");
  sendOutput("");
  sendOutput("Commands:");
  sendOutput("  save --key <k> --value <v> [--tier ...] [--ttl <hours>]");
  sendOutput("  recall --key <k> | --query <search>");
  sendOutput("  list [--tier ...]");
  sendOutput("  delete --key <k>");
  sendOutput("  promote --key <k> [--tier mutable|permanent]");
  sendOutput("  identity                     Show wallet & encryption key");
  sendOutput("");
  sendOutput("Tiers: ephemeral (default, 7d TTL), mutable (on-chain ASA), permanent (immutable tx)");
  sendOutput("All memories are encrypted and tied to your wallet identity.");
}

main().catch((err) => {
  sendError(String(err));
  process.exit(1);
});
