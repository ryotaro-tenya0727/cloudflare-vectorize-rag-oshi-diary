CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  category TEXT NOT NULL,
  heading TEXT NOT NULL,
  content TEXT NOT NULL,
  source_url TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
CREATE INDEX IF NOT EXISTS idx_chunks_category ON chunks(category);

CREATE TABLE IF NOT EXISTS documents (
  path TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL
);
