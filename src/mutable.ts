import { sendExec, sendError } from "./protocol.js";

async function checkLocalnet(): Promise<boolean> {
  const result = await sendExec("fledge localnet status 2>/dev/null");
  if (result.exit_code !== 0) {
    const check = await sendExec("which fledge 2>/dev/null && fledge localnet help 2>/dev/null");
    if (check.exit_code !== 0) {
      sendError("Install fledge-plugin-localnet for on-chain memory: fledge plugins install CorvidLabs/fledge-plugin-localnet");
    } else {
      sendError("Localnet is not running. Start it: fledge localnet start");
    }
    return false;
  }
  return true;
}

export async function mutableSave(key: string, value: string): Promise<string | null> {
  if (!await checkLocalnet()) return null;
  const metadata = JSON.stringify({ key, value, type: "memory", updated: new Date().toISOString() });
  const metadataB64 = Buffer.from(metadata).toString("base64");
  const cmd = `docker exec algokit_algod goal asset create --creator $(docker exec algokit_algod goal account list | head -1 | awk '{print $2}') --total 1 --decimals 0 --name "mem:${key}" --note "${metadataB64}" 2>&1`;
  const result = await sendExec(cmd);
  if (result.exit_code !== 0) {
    sendError(`Failed to create ASA: ${result.stderr || result.stdout}`);
    return null;
  }
  const match = result.stdout.match(/Created asset with asset index (\d+)/);
  return match ? match[1] : "unknown";
}

export async function mutableList(): Promise<{ key: string; asaId: string }[]> {
  if (!await checkLocalnet()) return [];
  const cmd = `docker exec algokit_algod goal account listassets --account $(docker exec algokit_algod goal account list | head -1 | awk '{print $2}') 2>&1`;
  const result = await sendExec(cmd);
  if (result.exit_code !== 0) return [];
  const lines = result.stdout.trim().split("\n");
  return lines
    .filter(l => l.includes("mem:"))
    .map(l => {
      const parts = l.trim().split(/\s+/);
      const asaId = parts[0] ?? "";
      const nameMatch = l.match(/mem:(\S+)/);
      return { key: nameMatch?.[1] ?? "", asaId };
    })
    .filter(e => e.key);
}

export async function mutableDelete(key: string): Promise<boolean> {
  if (!await checkLocalnet()) return false;
  const list = await mutableList();
  const entry = list.find(e => e.key === key);
  if (!entry) return false;
  const cmd = `docker exec algokit_algod goal asset destroy --assetid ${entry.asaId} --creator $(docker exec algokit_algod goal account list | head -1 | awk '{print $2}') 2>&1`;
  const result = await sendExec(cmd);
  return result.exit_code === 0;
}
