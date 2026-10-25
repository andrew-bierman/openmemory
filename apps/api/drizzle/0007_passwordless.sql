CREATE TABLE passwordless_otp (
  email TEXT PRIMARY KEY NOT NULL,
  hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE passwordless_throttle (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX passwordless_otp_expires_at_idx ON passwordless_otp(expires_at);
CREATE INDEX passwordless_throttle_expires_at_idx ON passwordless_throttle(expires_at);
