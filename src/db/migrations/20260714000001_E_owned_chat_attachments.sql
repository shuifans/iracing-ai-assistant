-- Migration: 20260714000001_E_owned_chat_attachments
-- Description: Two-phase, user-owned chat image attachments.

CREATE TABLE message_attachments_new (
  id              TEXT PRIMARY KEY,
  message_id      TEXT,
  uploaded_by     TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'image',
  relative_path   TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  width           INTEGER,
  height          INTEGER,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  bound_at        TEXT,
  CHECK (
    (message_id IS NULL AND bound_at IS NULL)
    OR (message_id IS NOT NULL AND bound_at IS NOT NULL)
  ),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Every legacy attachment is already bound. Derive its owner through the
-- message -> session relationship so no existing row or FK is discarded.
INSERT INTO message_attachments_new (
  id, message_id, uploaded_by, kind, relative_path, mime_type, size_bytes,
  sha256, width, height, created_at, expires_at, bound_at
)
SELECT
  a.id, a.message_id, s.user_id, a.kind, a.relative_path, a.mime_type,
  a.size_bytes, a.sha256, a.width, a.height, a.created_at,
  datetime(a.created_at, '+1 day'), a.created_at
FROM message_attachments a
JOIN messages m ON m.id = a.message_id
JOIN chat_sessions s ON s.id = m.session_id;

DROP TABLE message_attachments;
ALTER TABLE message_attachments_new RENAME TO message_attachments;

CREATE INDEX idx_message_attachments_message ON message_attachments(message_id);
CREATE INDEX idx_message_attachments_owner_unbound ON message_attachments(uploaded_by, message_id);
CREATE INDEX idx_message_attachments_expiry ON message_attachments(expires_at);

PRAGMA foreign_key_check;
