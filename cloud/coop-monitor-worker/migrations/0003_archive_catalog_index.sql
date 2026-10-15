-- Catalog pagination filters by device then orders by object key.
-- The existing (device_id, hour_start) index cannot satisfy that order.
CREATE INDEX IF NOT EXISTS archives_device_key ON archive_manifests(device_id, object_key);
