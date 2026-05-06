import { sendExec, sendStore, sendLoad, sendLog } from "./protocol.js";

let sqlAvailable: boolean | null = null;
let initialized = false;

async function checkSqlPlugin(): Promise<boolean> {
  if (sqlAvailable !== null) return sqlAvailable;
  const result = await sendExec("fledge sql help");
  sqlAvailable = result.exit_code === 0;
  if (!sqlAvailable) {
    sendLog("warn", "fledge-plugin-sql not installed. Ephemeral tier using fallback store (64KB limit, 256 keys max). Install: fledge plugins install CorvidLabs/fledge-plugin-sql");
  }
  return sqlAvailable;
}

async function ensureInitialized(pluginDir: string): Promise<void> {
  if (initialized) return;
  const hasSql = await checkSqlPlugin();
  if (!hasSql) {
    initialized = true;
    return;
  }
  await sendExec("fledge sql init --path .fledge/data.db 2>/dev/null || true");
  await sendExec(`fledge sql migrate --dir ${pluginDir}/migrations`);
  initialized = true;
}

async function fallbackSave(key: string, value: string): Promise<void> {
  const data = await loadFallbackStore();
  data[key] = { value, updated_at: new Date().toISOString() };
  await sendStore("memories", JSON.stringify(data));
}

async function fallbackRecall(key: string): Promise<{ key: string; value: string; updated_at: string } | null> {
  const data = await loadFallbackStore();
  const entry = data[key];
  if (!entry) return null;
  return { key, value: entry.value, updated_at: entry.updated_at };
}

async function fallbackList(): Promise<{ key: string; value: string; updated_at: string }[]> {
  const data = await loadFallbackStore();
  return Object.entries(data).map(([key, entry]) => ({
    key,
    value: (entry as { value: string; updated_at: string }).value,
    updated_at: (entry as { value: string; updated_at: string }).updated_at,
  }));
}

async function fallbackDelete(key: string): Promise<boolean> {
  const data = await loadFallbackStore();
  if (!(key in data)) return false;
  delete data[key];
  await sendStore("memories", JSON.stringify(data));
  return true;
}

async function fallbackSearch(query: string): Promise<{ key: string; value: string; updated_at: string }[]> {
  const data = await loadFallbackStore();
  const q = query.toLowerCase();
  return Object.entries(data)
    .filter(([key, entry]) =>
      key.toLowerCase().includes(q) ||
      (entry as { value: string }).value.toLowerCase().includes(q)
    )
    .map(([key, entry]) => ({
      key,
      value: (entry as { value: string; updated_at: string }).value,
      updated_at: (entry as { value: string; updated_at: string }).updated_at,
    }));
}

async function loadFallbackStore(): Promise<Record<string, { value: string; updated_at: string }>> {
  const raw = await sendLoad("memories");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function sqlSave(key: string, value: string): Promise<void> {
  const escaped_key = key.replace(/'/g, "''");
  const escaped_value = value.replace(/'/g, "''");
  const sql = `INSERT OR REPLACE INTO memories (key, value, created_at, updated_at) VALUES ('${escaped_key}', '${escaped_value}', COALESCE((SELECT created_at FROM memories WHERE key='${escaped_key}'), datetime('now')), datetime('now'))`;
  await sendExec(`fledge sql query "${sql}"`);
}

async function sqlRecall(key: string): Promise<{ key: string; value: string; updated_at: string } | null> {
  const escaped_key = key.replace(/'/g, "''");
  const result = await sendExec(`fledge sql query "SELECT key, value, updated_at FROM memories WHERE key='${escaped_key}'"`);
  if (result.exit_code !== 0 || !result.stdout.trim()) return null;
  const lines = result.stdout.trim().split("\n").filter(l => l.trim() && !l.startsWith("---"));
  if (lines.length < 2) return null;
  const parts = lines[1].split("|").map(s => s.trim());
  if (parts.length < 3) return null;
  return { key: parts[0], value: parts[1], updated_at: parts[2] };
}

async function sqlList(): Promise<{ key: string; value: string; updated_at: string }[]> {
  const result = await sendExec('fledge sql query "SELECT key, value, updated_at FROM memories ORDER BY updated_at DESC"');
  if (result.exit_code !== 0 || !result.stdout.trim()) return [];
  const lines = result.stdout.trim().split("\n").filter(l => l.trim() && !l.startsWith("---"));
  if (lines.length < 2) return [];
  return lines.slice(1).map(line => {
    const parts = line.split("|").map(s => s.trim());
    return { key: parts[0] ?? "", value: parts[1] ?? "", updated_at: parts[2] ?? "" };
  }).filter(e => e.key);
}

async function sqlDelete(key: string): Promise<boolean> {
  const check = await sqlRecall(key);
  if (!check) return false;
  const escaped_key = key.replace(/'/g, "''");
  await sendExec(`fledge sql query "DELETE FROM memories WHERE key='${escaped_key}'"`);
  return true;
}

async function sqlSearch(query: string): Promise<{ key: string; value: string; updated_at: string }[]> {
  const escaped = query.replace(/'/g, "''");
  const result = await sendExec(`fledge sql query "SELECT key, value, updated_at FROM memories WHERE key LIKE '%${escaped}%' OR value LIKE '%${escaped}%' ORDER BY updated_at DESC"`);
  if (result.exit_code !== 0 || !result.stdout.trim()) return [];
  const lines = result.stdout.trim().split("\n").filter(l => l.trim() && !l.startsWith("---"));
  if (lines.length < 2) return [];
  return lines.slice(1).map(line => {
    const parts = line.split("|").map(s => s.trim());
    return { key: parts[0] ?? "", value: parts[1] ?? "", updated_at: parts[2] ?? "" };
  }).filter(e => e.key);
}

export async function ephemeralSave(key: string, value: string, pluginDir: string): Promise<void> {
  await ensureInitialized(pluginDir);
  if (sqlAvailable) await sqlSave(key, value);
  else await fallbackSave(key, value);
}

export async function ephemeralRecall(key: string, pluginDir: string): Promise<{ key: string; value: string; updated_at: string } | null> {
  await ensureInitialized(pluginDir);
  return sqlAvailable ? sqlRecall(key) : fallbackRecall(key);
}

export async function ephemeralList(pluginDir: string): Promise<{ key: string; value: string; updated_at: string }[]> {
  await ensureInitialized(pluginDir);
  return sqlAvailable ? sqlList() : fallbackList();
}

export async function ephemeralDelete(key: string, pluginDir: string): Promise<boolean> {
  await ensureInitialized(pluginDir);
  return sqlAvailable ? sqlDelete(key) : fallbackDelete(key);
}

export async function ephemeralSearch(query: string, pluginDir: string): Promise<{ key: string; value: string; updated_at: string }[]> {
  await ensureInitialized(pluginDir);
  return sqlAvailable ? sqlSearch(query) : fallbackSearch(query);
}
