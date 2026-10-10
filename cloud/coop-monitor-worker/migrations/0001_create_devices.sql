CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT,
  last_boot_id TEXT,
  last_sequence INTEGER,
  desired_config_revision INTEGER NOT NULL DEFAULT 1,
  applied_config_revision INTEGER NOT NULL DEFAULT 0,
  writes_paused INTEGER NOT NULL DEFAULT 0 CHECK (writes_paused IN (0, 1))
);
