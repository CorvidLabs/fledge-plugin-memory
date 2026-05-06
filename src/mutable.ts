import { sendExec, sendError, sendLog } from "./protocol.js";
import { encryptValue, decryptValue } from "./encrypt.js";
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

function arc69Metadata(key: string, encryptedValue: string, userAddress: string): string {
  return JSON.stringify({
    standard: "arc69",
    description: `mem:${key}`,
    properties: {
      type: "memory",
      key,
      value: encryptedValue,
      user: userAddress,
      updated: new Date().toISOString(),
    },
  });
}

export async function mutableSave(key: string, value: string, identity: Identity): Promise<string | null> {
  if (!await checkLocalnet()) return null;

  const encrypted = encryptValue(value, identity);
  const metadata = arc69Metadata(key, encrypted, identity.address);
  const metadataB64 = Buffer.from(metadata).toString("base64");

  const existing = await findAsaByKey(key, identity);
  if (existing) {
    const cmd = `goal asset config --assetid ${existing.asaId} --manager ${identity.address} --new-note "${metadataB64}" 2>&1`;
    const result = await sendExec(cmd);
    if (result.code !== 0) {
      sendError(`Failed to update ASA: ${result.stderr || result.stdout}`);
      return null;
    }
    return existing.asaId;
  }

  const cmd = `goal asset create --creator ${identity.address} --total 1 --decimals 0 --name "mem:${key}" --note "${metadataB64}" 2>&1`;
  const result = await sendExec(cmd);
  if (result.code !== 0) {
    sendError(`Failed to create ASA: ${result.stderr || result.stdout}`);
    return null;
  }
  const match = result.stdout.match(/Created asset with asset index (\d+)/);
  return match ? match[1] : "unknown";
}

export async function mutableRecall(key: string, identity: Identity): Promise<{ key: string; value: string; asaId: string } | null> {
  if (!await checkLocalnet()) return null;

  const entry = await findAsaByKey(key, identity);
  if (!entry || !entry.metadata) return null;

  try {
    const meta = JSON.parse(entry.metadata);
    const encrypted = meta.properties?.value;
    if (!encrypted) return null;
    const decrypted = decryptValue(encrypted, identity);
    return { key, value: decrypted, asaId: entry.asaId };
  } catch {
    return null;
  }
}

export async function mutableList(identity: Identity): Promise<{ key: string; asaId: string }[]> {
  if (!await checkLocalnet()) return [];

  const cmd = `goal account listassets --account ${identity.address} 2>&1`;
  const result = await sendExec(cmd);
  if (result.code !== 0) return [];

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

export async function mutableDelete(key: string, identity: Identity): Promise<boolean> {
  if (!await checkLocalnet()) return false;

  const entry = await findAsaByKey(key, identity);
  if (!entry) return false;

  const cmd = `goal asset destroy --assetid ${entry.asaId} --creator ${identity.address} 2>&1`;
  const result = await sendExec(cmd);
  return result.code === 0;
}

async function findAsaByKey(key: string, identity: Identity): Promise<{ asaId: string; metadata?: string } | null> {
  const list = await mutableList(identity);
  const entry = list.find(e => e.key === key);
  if (!entry) return null;

  const infoCmd = `goal asset info --assetid ${entry.asaId} 2>&1`;
  const info = await sendExec(infoCmd);
  if (info.code !== 0) return { asaId: entry.asaId };

  const noteMatch = info.stdout.match(/Note:\s*(.+)/);
  if (noteMatch) {
    try {
      const decoded = Buffer.from(noteMatch[1].trim(), "base64").toString("utf-8");
      return { asaId: entry.asaId, metadata: decoded };
    } catch {}
  }
  return { asaId: entry.asaId };
}
