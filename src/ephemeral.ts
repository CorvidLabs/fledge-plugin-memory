import { sendExec, sendLog } from "./protocol.js";
import { encryptValue, decryptValue } from "./encrypt.js";
import type { Identity } from "./identity.js";

const DEFAULT_TTL_HOURS = 168; // 7 days
let initialized = false;

export async function ensureEphemeral(pluginDir: string): Promise<boolean> {
  if (initialized) return true;

  const sqlCheck = await sendExec("fledge sql help 2>/dev/null");
  if (sqlCheck.code !== 0) {
    sendLog("warn", "fledge-plugin-sql not available. Install: fledge plugins install CorvidLabs/fledge-plugin-sql");
    return false;
  }

  await sendExec("fledge sql init --path .fledge/data.db 2>/dev/null");
  await sendExec(`fledge sql migrate --dir '${pluginDir}/migrations'`);

  initialized = true;
  return true;
}

function escSql(s: string): string {
  return s.replace(/'/g, "''");
}

async function fledgeSqlQuery(sql: string): Promise<string> {
  const result = await sendExec(`fledge sql query --list ${JSON.stringify(sql)}`);
  return result.stdout.trim();
}

export async function ephemeralSave(
  key: string,
  value: string,
  identity: Identity,
  ttlHours?: number,
): Promise<void> {
  const encrypted = encryptValue(value, identity);
  const ttl = ttlHours ?? DEFAULT_TTL_HOURS;
  const expiresAt = `datetime('now', '+${ttl} hours')`;

  await fledgeSqlQuery(
    `INSERT OR REPLACE INTO memories (key, value, user_address, created_at, updated_at, expires_at) ` +
    `VALUES ('${escSql(key)}', '${escSql(encrypted)}', '${escSql(identity.address)}', ` +
    `COALESCE((SELECT created_at FROM memories WHERE key='${escSql(key)}' AND user_address='${escSql(identity.address)}'), datetime('now')), ` +
    `datetime('now'), ${expiresAt})`
  );
}

export async function ephemeralRecall(
  key: string,
  identity: Identity,
): Promise<{ key: string; value: string; updated_at: string; expires_at: string | null } | null> {
  await cleanExpired(identity);

  const output = await fledgeSqlQuery(
    `SELECT key, value, updated_at, expires_at FROM memories ` +
    `WHERE key='${escSql(key)}' AND user_address='${escSql(identity.address)}'`
  );
  if (!output) return null;

  const parts = output.split("|");
  if (parts.length < 4) return null;

  try {
    const decrypted = decryptValue(parts[1], identity);
    return { key: parts[0], value: decrypted, updated_at: parts[2], expires_at: parts[3] || null };
  } catch {
    return null;
  }
}

export async function ephemeralList(
  identity: Identity,
): Promise<{ key: string; value: string; updated_at: string; expires_at: string | null }[]> {
  await cleanExpired(identity);

  const output = await fledgeSqlQuery(
    `SELECT key, value, updated_at, expires_at FROM memories ` +
    `WHERE user_address='${escSql(identity.address)}' ORDER BY updated_at DESC`
  );
  if (!output) return [];

  return output.split("\n").map(line => {
    const parts = line.split("|");
    if (parts.length < 4) return null;
    try {
      const decrypted = decryptValue(parts[1], identity);
      return { key: parts[0], value: decrypted, updated_at: parts[2], expires_at: parts[3] || null };
    } catch {
      return null;
    }
  }).filter((e): e is NonNullable<typeof e> => e !== null);
}

export async function ephemeralDelete(
  key: string,
  identity: Identity,
): Promise<boolean> {
  const check = await ephemeralRecall(key, identity);
  if (!check) return false;
  await fledgeSqlQuery(
    `DELETE FROM memories WHERE key='${escSql(key)}' AND user_address='${escSql(identity.address)}'`
  );
  return true;
}

export async function ephemeralSearch(
  query: string,
  identity: Identity,
): Promise<{ key: string; value: string; updated_at: string }[]> {
  await cleanExpired(identity);

  const all = await ephemeralList(identity);
  const q = query.toLowerCase();
  return all.filter(m =>
    m.key.toLowerCase().includes(q) || m.value.toLowerCase().includes(q)
  );
}

export async function ephemeralGetRaw(
  key: string,
  identity: Identity,
): Promise<string | null> {
  const output = await fledgeSqlQuery(
    `SELECT value FROM memories WHERE key='${escSql(key)}' AND user_address='${escSql(identity.address)}'`
  );
  if (!output) return null;
  try {
    return decryptValue(output.trim(), identity);
  } catch {
    return null;
  }
}

async function cleanExpired(identity: Identity): Promise<void> {
  await fledgeSqlQuery(
    `DELETE FROM memories WHERE user_address='${escSql(identity.address)}' ` +
    `AND expires_at IS NOT NULL AND expires_at < datetime('now')`
  );
}
