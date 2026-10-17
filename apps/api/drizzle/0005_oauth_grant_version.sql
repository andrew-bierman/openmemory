-- Bind stateless access tokens to a particular consent and scope generation.
ALTER TABLE oauth_consent ADD COLUMN grant_version TEXT NOT NULL DEFAULT '';
UPDATE oauth_consent SET grant_version = lower(hex(randomblob(16)));
CREATE TRIGGER oauth_consent_version_insert AFTER INSERT ON oauth_consent
BEGIN
  UPDATE oauth_consent SET grant_version = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;
CREATE TRIGGER oauth_consent_version_scopes AFTER UPDATE OF scopes ON oauth_consent
WHEN OLD.scopes IS NOT NEW.scopes
BEGIN
  UPDATE oauth_consent SET grant_version = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;
