import { recvJson, sendOutput, sendError, type InitMessage } from "./protocol.js";
import { ephemeralSave, ephemeralRecall, ephemeralList, ephemeralDelete, ephemeralSearch } from "./ephemeral.js";
import { mutableSave, mutableList, mutableDelete } from "./mutable.js";
import { permanentSave } from "./permanent.js";

interface ParsedArgs {
  command: string;
  key?: string;
  value?: string;
  query?: string;
  tier: "ephemeral" | "mutable" | "permanent";
}

function parseArgs(args: string[]): ParsedArgs {
  const command = args[0] ?? "help";
  let key: string | undefined;
  let value: string | undefined;
  let query: string | undefined;
  let tier: "ephemeral" | "mutable" | "permanent" = "ephemeral";

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--key": key = args[++i]; break;
      case "--value": value = args[++i]; break;
      case "--query": query = args[++i]; break;
      case "--tier": tier = args[++i] as "ephemeral" | "mutable" | "permanent"; break;
    }
  }
  return { command, key, value, query, tier };
}

async function main() {
  const init = await recvJson<InitMessage>();
  const parsed = parseArgs(init.args);
  const pluginDir = init.plugin.dir;

  switch (parsed.command) {
    case "save": await cmdSave(parsed, pluginDir); break;
    case "recall": await cmdRecall(parsed, pluginDir); break;
    case "list": await cmdList(parsed, pluginDir); break;
    case "delete": await cmdDelete(parsed, pluginDir); break;
    case "promote": await cmdPromote(parsed, pluginDir); break;
    case "help": case "--help": case "-h": cmdHelp(); break;
    default:
      sendError(`Unknown command: ${parsed.command}. Run: fledge memory help`);
      process.exit(1);
  }

  process.exit(0);
}

async function cmdSave(args: ParsedArgs, pluginDir: string) {
  if (!args.key || !args.value) {
    sendError("Usage: fledge memory save --key <k> --value <v> [--tier ephemeral|mutable|permanent]");
    process.exit(1);
  }
  switch (args.tier) {
    case "ephemeral":
      await ephemeralSave(args.key, args.value, pluginDir);
      sendOutput(`Saved to ephemeral: ${args.key}`);
      break;
    case "mutable": {
      const asaId = await mutableSave(args.key, args.value);
      if (asaId) sendOutput(`Saved to mutable (ASA ID: ${asaId}): ${args.key}`);
      break;
    }
    case "permanent": {
      const txid = await permanentSave(args.key, args.value);
      if (txid) sendOutput(`Saved to permanent (txid: ${txid}): ${args.key}`);
      break;
    }
  }
}

async function cmdRecall(args: ParsedArgs, pluginDir: string) {
  if (!args.key && !args.query) {
    sendError("Usage: fledge memory recall --key <k> | --query <search>");
    process.exit(1);
  }
  if (args.query) {
    const results = await ephemeralSearch(args.query, pluginDir);
    if (results.length === 0) { sendOutput("No memories found."); return; }
    for (const r of results) sendOutput(`[ephemeral] ${r.key} = ${r.value} (updated: ${r.updated_at})`);
    return;
  }
  if (args.key) {
    const result = await ephemeralRecall(args.key, pluginDir);
    if (result) sendOutput(`[ephemeral] ${result.key} = ${result.value} (updated: ${result.updated_at})`);
    else sendError(`Memory not found: ${args.key}`);
  }
}

async function cmdList(args: ParsedArgs, pluginDir: string) {
  const showEphemeral = !args.tier || args.tier === "ephemeral";
  const showMutable = !args.tier || args.tier === "mutable";
  let hasResults = false;

  if (showEphemeral) {
    const items = await ephemeralList(pluginDir);
    for (const item of items) {
      sendOutput(`ephemeral    ${item.key.padEnd(20)} ${item.updated_at}`);
      hasResults = true;
    }
  }
  if (showMutable) {
    const items = await mutableList();
    for (const item of items) {
      sendOutput(`mutable      ${item.key.padEnd(20)} ASA:${item.asaId}`);
      hasResults = true;
    }
  }
  if (!hasResults) sendOutput("No memories found.");
}

async function cmdDelete(args: ParsedArgs, pluginDir: string) {
  if (!args.key) {
    sendError("Usage: fledge memory delete --key <k>");
    process.exit(1);
  }
  if (args.tier === "permanent") {
    sendError("Permanent memories cannot be deleted.");
    process.exit(1);
  }
  let deleted = false;
  if (args.tier === "ephemeral" || !args.tier) {
    deleted = await ephemeralDelete(args.key, pluginDir);
    if (deleted) { sendOutput(`Deleted from ephemeral: ${args.key}`); return; }
  }
  if (args.tier === "mutable" || (!args.tier && !deleted)) {
    deleted = await mutableDelete(args.key);
    if (deleted) { sendOutput(`Deleted from mutable: ${args.key}`); return; }
  }
  if (!deleted) sendError(`Memory not found: ${args.key}`);
}

async function cmdPromote(args: ParsedArgs, pluginDir: string) {
  if (!args.key) {
    sendError("Usage: fledge memory promote --key <k> [--tier mutable|permanent]");
    process.exit(1);
  }
  const targetTier = args.tier === "ephemeral" ? "mutable" : args.tier;
  const memory = await ephemeralRecall(args.key, pluginDir);
  if (!memory) {
    sendError(`Memory not found in ephemeral tier: ${args.key}`);
    process.exit(1);
  }
  if (targetTier === "mutable") {
    const asaId = await mutableSave(args.key, memory.value);
    if (asaId) {
      await ephemeralDelete(args.key, pluginDir);
      sendOutput(`Promoted ${args.key} from ephemeral to mutable (ASA ID: ${asaId})`);
    }
  } else if (targetTier === "permanent") {
    const txid = await permanentSave(args.key, memory.value);
    if (txid) {
      await ephemeralDelete(args.key, pluginDir);
      sendOutput(`Promoted ${args.key} from ephemeral to permanent (txid: ${txid})`);
    }
  }
}

function cmdHelp() {
  sendOutput("fledge-plugin-memory — Three-tier memory management");
  sendOutput("");
  sendOutput("Commands:");
  sendOutput("  save --key <k> --value <v> [--tier ...]   Save a memory");
  sendOutput("  recall --key <k> | --query <search>       Retrieve memories");
  sendOutput("  list [--tier ...]                          List memories");
  sendOutput("  delete --key <k>                           Delete (ephemeral/mutable)");
  sendOutput("  promote --key <k> [--tier ...]             Promote to higher tier");
  sendOutput("");
  sendOutput("Tiers: ephemeral (default), mutable, permanent");
}

main().catch((err) => {
  sendError(String(err));
  process.exit(1);
});
