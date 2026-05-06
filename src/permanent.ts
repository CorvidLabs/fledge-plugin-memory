import { sendExec, sendError } from "./protocol.js";
import { encryptValue } from "./encrypt.js";
import type { Identity } from "./identity.js";

async function checkLocalnet(): Promise<boolean> {
  const result = await sendExec("fledge localnet status 2>/dev/null");
  if (result.code !== 0) {
    const check = await sendExec("which fledge 2>/dev/null && fledge localnet help 2>/dev/null");
    if (check.code !== 0) {
      sendError("Install fledge-plugin-localnet for on-chain memory: fledge plugins install CorvidLabs/fledge-plugin-localnet");
    } else {
      sendError("Localnet is not running. Start it: fledge localnet start");
    }
    return false;
  }
  return true;
}

export async function permanentSave(key: string, value: string, identity: Identity): Promise<string | null> {
  if (!await checkLocalnet()) return null;

  const encrypted = encryptValue(value, identity);
  const note = JSON.stringify({
    key,
    value: encrypted,
    type: "permanent-memory",
    user: identity.address,
    created: new Date().toISOString(),
  });
  const noteB64 = Buffer.from(note).toString("base64");

  const cmd = `goal clerk send -a 0 -f ${identity.address} -t ${identity.address} --note "${noteB64}" 2>&1`;
  const result = await sendExec(cmd);
  if (result.code !== 0) {
    sendError(`Failed to save permanent memory: ${result.stderr || result.stdout}`);
    return null;
  }
  const txid = result.stdout.trim().split("\n").pop() ?? "unknown";
  return txid;
}
