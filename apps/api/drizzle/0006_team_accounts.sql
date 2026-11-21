ALTER TABLE workspace_member ADD COLUMN accepted_at integer;
-- Preserve historical owner rows; only one deterministic identity gains acceptance.
UPDATE workspace_member SET accepted_at=created_at, role='owner', status='active'
WHERE user_id=(SELECT owner_user_id FROM workspace WHERE id=workspace_id)
AND EXISTS(SELECT 1 FROM user u WHERE u.id=workspace_member.user_id)
AND id=(SELECT min(m.id) FROM workspace_member m WHERE m.workspace_id=workspace_member.workspace_id AND m.user_id=workspace_member.user_id);
UPDATE workspace_member SET status='invited', role=CASE WHEN role='admin' THEN 'admin' ELSE 'member' END
WHERE accepted_at IS NULL;
-- Add an owner membership only from a live designated owner, never an email match.
-- Conflicting historical emails remain untouched and require reviewed repair.
INSERT INTO workspace_member(id,workspace_id,user_id,email,role,status,created_at,updated_at,accepted_at)
SELECT lower(hex(randomblob(16))),w.id,u.id,lower(u.email),'owner','active',unixepoch(),unixepoch(),unixepoch()
FROM workspace w JOIN user u ON u.id=w.owner_user_id
WHERE NOT EXISTS(SELECT 1 FROM workspace_member m WHERE m.workspace_id=w.id AND m.user_id=u.id)
AND NOT EXISTS(SELECT 1 FROM workspace_member m WHERE m.workspace_id=w.id AND lower(m.email)=lower(u.email));
CREATE UNIQUE INDEX workspace_member_user_idx ON workspace_member(workspace_id,user_id) WHERE accepted_at IS NOT NULL;
CREATE TABLE workspace_invitation (
 id text PRIMARY KEY NOT NULL,
 workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
 email text NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','member')),
 token_hash text NOT NULL,
 inviter_user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 inviter_member_id text NOT NULL,
 target_user_id text REFERENCES user(id) ON DELETE CASCADE,
 expires_at integer NOT NULL,
 created_at integer NOT NULL,
 accepted_at integer,
 accepted_user_id text REFERENCES user(id) ON DELETE CASCADE,
 accepted_member_id text
);
CREATE UNIQUE INDEX workspace_invitation_workspace_email_idx ON workspace_invitation(workspace_id,email);
CREATE TABLE workspace_share_directory (
 share_id text PRIMARY KEY NOT NULL,
 owner_user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
 memory_id text NOT NULL,
 created_at integer NOT NULL
);
CREATE INDEX workspace_share_directory_page_idx ON workspace_share_directory(workspace_id,created_at,share_id);
CREATE TABLE workspace_audit (
 id text PRIMARY KEY NOT NULL,
 workspace_id text NOT NULL,
 subject_user_id text,
 member_id text,
 action text NOT NULL,
 created_at integer NOT NULL
);
CREATE TRIGGER workspace_invitation_created AFTER INSERT ON workspace_invitation BEGIN
 DELETE FROM workspace_member WHERE workspace_id=NEW.workspace_id AND lower(email)=NEW.email AND accepted_at IS NULL;
 INSERT INTO workspace_member(id,workspace_id,user_id,email,role,status,created_at,updated_at)
 VALUES(NEW.id,NEW.workspace_id,NEW.target_user_id,NEW.email,NEW.role,'invited',NEW.created_at,NEW.created_at);
 INSERT INTO workspace_audit VALUES(lower(hex(randomblob(16))),NEW.workspace_id,NEW.inviter_user_id,NEW.inviter_member_id,'invitation_created',NEW.created_at);
END;
CREATE TRIGGER workspace_invitation_deleted AFTER DELETE ON workspace_invitation BEGIN
 DELETE FROM workspace_member WHERE id=OLD.id AND accepted_at IS NULL;
END;
CREATE TRIGGER workspace_invitation_accepted AFTER UPDATE OF accepted_at ON workspace_invitation
WHEN OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL BEGIN
 DELETE FROM workspace_member WHERE id=NEW.id AND accepted_at IS NULL;
 INSERT INTO workspace_member(id,workspace_id,user_id,email,role,status,created_at,updated_at,accepted_at)
 VALUES(NEW.accepted_member_id,NEW.workspace_id,NEW.accepted_user_id,NEW.email,NEW.role,'active',NEW.accepted_at,NEW.accepted_at,NEW.accepted_at);
END;
CREATE TRIGGER workspace_member_removed AFTER DELETE ON workspace_member BEGIN
 DELETE FROM workspace_invitation WHERE (id=OLD.id AND accepted_at IS NULL) OR accepted_member_id=OLD.id;
 INSERT INTO workspace_audit VALUES(lower(hex(randomblob(16))),OLD.workspace_id,OLD.user_id,OLD.id,'member_removed',unixepoch());
END;
CREATE TRIGGER workspace_member_accepted AFTER INSERT ON workspace_member WHEN NEW.accepted_at IS NOT NULL BEGIN
 INSERT INTO workspace_audit VALUES(lower(hex(randomblob(16))),NEW.workspace_id,NEW.user_id,NEW.id,'member_accepted',unixepoch());
END;
CREATE TRIGGER workspace_member_role_changed AFTER UPDATE OF role ON workspace_member WHEN OLD.role<>NEW.role BEGIN
 INSERT INTO workspace_audit VALUES(lower(hex(randomblob(16))),NEW.workspace_id,NEW.user_id,NEW.id,'member_role_changed',unixepoch());
END;
CREATE TRIGGER workspace_deleted AFTER DELETE ON workspace BEGIN
 INSERT INTO workspace_audit VALUES(lower(hex(randomblob(16))),OLD.id,OLD.owner_user_id,NULL,'workspace_deleted',unixepoch());
END;
