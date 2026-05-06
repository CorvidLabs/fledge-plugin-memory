CREATE TABLE IF NOT EXISTS memories (
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    user_address TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    PRIMARY KEY (key, user_address)
);
CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);
CREATE INDEX IF NOT EXISTS idx_memories_expires ON memories(expires_at);
