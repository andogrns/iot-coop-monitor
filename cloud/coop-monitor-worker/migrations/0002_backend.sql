ALTER TABLE devices ADD COLUMN token_hash TEXT;
ALTER TABLE devices ADD COLUMN desired_config_json TEXT NOT NULL DEFAULT '{"mqThresholdMode":"automatic","manualThresholdMv":null,"warningConsecutiveSamples":3,"samplingIntervalSec":2}';
ALTER TABLE devices ADD COLUMN config_updated_at TEXT;
CREATE TABLE boot_sessions (
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  boot_id TEXT NOT NULL, anchor_ms INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (device_id, boot_id)
) WITHOUT ROWID;
CREATE TABLE reading_windows (
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  block_id TEXT NOT NULL, boot_id TEXT NOT NULL, anchor_ms INTEGER NOT NULL,
  data_json TEXT NOT NULL DEFAULT '[]', state_json TEXT, received_at TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0), request_count INTEGER NOT NULL DEFAULT 0,
  estimated_writes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, block_id)
) WITHOUT ROWID;
CREATE TABLE device_logs (
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  boot_id TEXT NOT NULL, seq INTEGER NOT NULL, uptime_ms INTEGER NOT NULL,
  sampled_at TEXT, received_at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL,
  PRIMARY KEY (device_id, boot_id, seq)
) WITHOUT ROWID;
CREATE INDEX device_logs_received ON device_logs(device_id, received_at);
CREATE TABLE config_history (
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0), settings_json TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (device_id, revision)
) WITHOUT ROWID;
CREATE TABLE commands (
  command_id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  type TEXT NOT NULL, args_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', result_json TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX commands_device ON commands(device_id, created_at);
CREATE TABLE archive_manifests (
  object_key TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  hour_start TEXT NOT NULL, format_version INTEGER NOT NULL, sample_count INTEGER NOT NULL,
  block_count INTEGER NOT NULL, compressed_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
  original_sha256 TEXT NOT NULL, created_at TEXT NOT NULL, verified_at TEXT NOT NULL
);
CREATE INDEX archives_device_hour ON archive_manifests(device_id, hour_start);
CREATE TABLE system_state (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE maintenance_leases (key TEXT PRIMARY KEY, holder TEXT NOT NULL, expires_ms INTEGER NOT NULL);
