CREATE TABLE IF NOT EXISTS telegram_event_access_requests (
  chat_id INTEGER PRIMARY KEY NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  username TEXT,
  display_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by_chat_id INTEGER
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_telegram_event_access_requests_status
  ON telegram_event_access_requests (status, requested_at);
