CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id TEXT PRIMARY KEY,
  client_uid TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT NOT NULL,
  send_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  onesignal_id TEXT,
  failure_reason TEXT
);

CREATE INDEX IF NOT EXISTS scheduled_notifications_due
  ON scheduled_notifications (status, send_at);

CREATE TABLE IF NOT EXISTS notification_audit (
  id TEXT PRIMARY KEY,
  actor_uid TEXT NOT NULL,
  audience TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  onesignal_id TEXT
);

CREATE INDEX IF NOT EXISTS notification_audit_created_at
  ON notification_audit (created_at);

CREATE TABLE IF NOT EXISTS notification_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS notification_templates_name
  ON notification_templates (name);
