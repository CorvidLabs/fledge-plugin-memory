-- Add user_address and expires_at columns if upgrading from pre-v0.2 schema
ALTER TABLE memories ADD COLUMN user_address TEXT NOT NULL DEFAULT '';
ALTER TABLE memories ADD COLUMN expires_at TEXT;

-- Drop old single-column primary key, rebuild with composite
-- SQLite doesn't support DROP PRIMARY KEY, so we rebuild the table
CREATE TABLE memories_new (
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    user_address TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    PRIMARY KEY (key, user_address)
);
INSERT INTO memories_new (key, value, user_address, created_at, updated_at)
    SELECT key, value, '', created_at, updated_at FROM memories;
DROP TABLE memories;
ALTER TABLE memories_new RENAME TO memories;
CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);
CREATE INDEX IF NOT EXISTS idx_memories_expires ON memories(expires_at);
