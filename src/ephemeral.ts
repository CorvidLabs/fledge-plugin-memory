import { sendExec, sendStore, sendLoad, sendLog } from "./protocol.js";

let dbPath: string | null = null;
let initialized = false;

async function resolveDbPath(pluginDir: string): Promise<string> {
  if (dbPath) return dbPath;
  const result = await sendExec("echo $PWD");
  const projectRoot = result.stdout.trim() || ".";
  dbPath = `${projectRoot}/.fledge/data.db`;
  return dbPath;
}

async function ensureInitialized(pluginDir: string): Promise<void> {
  if (initialized) return;
  const db = await resolveDbPath(pluginDir);

  const checkSqlite = await sendExec("which sqlite3 2>/dev/null");
  if (checkSqlite.code !== 0) {
    sendLog("warn", "sqlite3 not found. Ephemeral tier using fallback store (64KB limit, 256 keys max).");
    dbPath = null;
    initialized = true;
    return;
  }

  await sendExec(`mkdir -p "$(dirname '${db}')" && sqlite3 '${db}' 'SELECT 1' >/dev/null 2>&1`);

  const migrationFile = `${pluginDir}/migrations/001_memories.sql`;
  const checkFile = await sendExec(`test -f '${migrationFile}' && echo yes || echo no`);
  if (checkFile.stdout.trim() === "yes") {
    await sendExec(`sqlite3 '${db}' < '${migrationFile}' 2>/dev/null || true`);
  } else {
    await sendExec(`sqlite3 '${db}' "CREATE TABLE IF NOT EXISTS memories (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE INDEX IF NOT EXISTS idx_memories_value ON memories(value);"`);
  }

  initialized = true;
}

function usingSql(): boolean {
  return dbPath !== null;
}

async function fallbackSave(key: string, value: string): Promise<void> {
  const data = await loadFallbackStore();
  data[key] = { value, updated_at: new Date().toISOString() };
  sendStore("memories", JSON.stringify(data));
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
  sendStore("memories", JSON.stringify(data));
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

function escSql(s: string): string {
  return s.replace(/'/g, "''");
}

async function sqlSave(key: string, value: string): Promise<void> {
  const sql = `INSERT OR REPLACE INTO memories (key, value, created_at, updated_at) VALUES ('${escSql(key)}', '${escSql(value)}', COALESCE((SELECT created_at FROM memories WHERE key='${escSql(key)}'), datetime('now')), datetime('now'))`;
  await sendExec(`sqlite3 '${dbPath}' "${sql}"`);
}

async function sqlRecall(key: string): Promise<{ key: string; value: string; updated_at: string } | null> {
  const result = await sendExec(`sqlite3 -separator '|' '${dbPath}' "SELECT key, value, updated_at FROM memories WHERE key='${escSql(key)}'"`);
  if (result.code !== 0 || !result.stdout.trim()) return null;
  const line = result.stdout.trim().split("\n")[0];
  const parts = line.split("|");
  if (parts.length < 3) return null;
  return { key: parts[0], value: parts.slice(1, -1).join("|"), updated_at: parts[parts.length - 1] };
}

async function sqlList(): Promise<{ key: string; value: string; updated_at: string }[]> {
  const result = await sendExec(`sqlite3 -separator '|' '${dbPath}' "SELECT key, value, updated_at FROM memories ORDER BY updated_at DESC"`);
  if (result.code !== 0 || !result.stdout.trim()) return [];
  return result.stdout.trim().split("\n").map(line => {
    const parts = line.split("|");
    if (parts.length < 3) return null;
    return { key: parts[0], value: parts.slice(1, -1).join("|"), updated_at: parts[parts.length - 1] };
  }).filter((e): e is NonNullable<typeof e> => e !== null && e.key !== "");
}

async function sqlDelete(key: string): Promise<boolean> {
  const check = await sqlRecall(key);
  if (!check) return false;
  await sendExec(`sqlite3 '${dbPath}' "DELETE FROM memories WHERE key='${escSql(key)}'"`);
  return true;
}

async function sqlSearch(query: string): Promise<{ key: string; value: string; updated_at: string }[]> {
  const escaped = escSql(query);
  const result = await sendExec(`sqlite3 -separator '|' '${dbPath}' "SELECT key, value, updated_at FROM memories WHERE key LIKE '%${escaped}%' OR value LIKE '%${escaped}%' ORDER BY updated_at DESC"`);
  if (result.code !== 0 || !result.stdout.trim()) return [];
  return result.stdout.trim().split("\n").map(line => {
    const parts = line.split("|");
    if (parts.length < 3) return null;
    return { key: parts[0], value: parts.slice(1, -1).join("|"), updated_at: parts[parts.length - 1] };
  }).filter((e): e is NonNullable<typeof e> => e !== null && e.key !== "");
}

export async function ephemeralSave(key: string, value: string, pluginDir: string): Promise<void> {
  await ensureInitialized(pluginDir);
  if (usingSql()) await sqlSave(key, value);
  else await fallbackSave(key, value);
}

export async function ephemeralRecall(key: string, pluginDir: string): Promise<{ key: string; value: string; updated_at: string } | null> {
  await ensureInitialized(pluginDir);
  return usingSql() ? sqlRecall(key) : fallbackRecall(key);
}

export async function ephemeralList(pluginDir: string): Promise<{ key: string; value: string; updated_at: string }[]> {
  await ensureInitialized(pluginDir);
  return usingSql() ? sqlList() : fallbackList();
}

export async function ephemeralDelete(key: string, pluginDir: string): Promise<boolean> {
  await ensureInitialized(pluginDir);
  return usingSql() ? sqlDelete(key) : fallbackDelete(key);
}

export async function ephemeralSearch(query: string, pluginDir: string): Promise<{ key: string; value: string; updated_at: string }[]> {
  await ensureInitialized(pluginDir);
  return usingSql() ? sqlSearch(query) : fallbackSearch(query);
}
