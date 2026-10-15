CREATE TABLE manual_archives (
  archive_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  range_from TEXT NOT NULL,
  range_to TEXT NOT NULL,
  selected_count INTEGER NOT NULL,
  archived_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','complete')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX manual_archives_device_created ON manual_archives(device_id, created_at);
ALTER TABLE archive_manifests ADD COLUMN manual_archive_id TEXT REFERENCES manual_archives(archive_id);
-- Retain sample identities/value fingerprints until normal retention expires.
-- A lost-response firmware retry must not reinsert manually archived readings.
ALTER TABLE reading_windows ADD COLUMN archived_hashes_json TEXT NOT NULL DEFAULT '{}';
