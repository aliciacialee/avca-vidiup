-- Migration 0001: Initial schema

CREATE TABLE trips (
  id         TEXT PRIMARY KEY,          -- nanoid
  name       TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,
  start_at   INTEGER NOT NULL,          -- Unix epoch (seconds)
  end_at     INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE files (
  id                  TEXT PRIMARY KEY, -- nanoid
  trip_id             TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  uploader_name       TEXT NOT NULL,
  original_name       TEXT NOT NULL,
  file_path           TEXT NOT NULL,    -- 行程/日期/上傳者/原檔名
  mime_type           TEXT,
  size                INTEGER,          -- bytes
  is_private          INTEGER NOT NULL DEFAULT 0, -- 0 = 公開, 1 = 不可公開
  uploaded_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  upload_completed_at INTEGER           -- NULL 表示尚未完成
);

CREATE INDEX idx_files_trip_id ON files(trip_id);
CREATE INDEX idx_trips_code ON trips(code);
