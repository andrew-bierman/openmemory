CREATE TABLE send_budget (
  run_id TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 12),
  expires_at INTEGER NOT NULL
);
