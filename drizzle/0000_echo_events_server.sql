CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  project TEXT NOT NULL,
  event_date TEXT NOT NULL,
  event_time TEXT,
  location TEXT,
  description TEXT,
  link TEXT,
  created_via TEXT NOT NULL DEFAULT 'site' CHECK (created_via IN ('site', 'telegram', 'pool_sync')),
  created_by_telegram_chat_id INTEGER,
  telegram_update_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_events_date_time ON events (event_date, event_time);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_events_project_date ON events (project, event_date);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_telegram_update_id
  ON events (telegram_update_id)
  WHERE telegram_update_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS telegram_event_users (
  chat_id INTEGER PRIMARY KEY NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  username TEXT,
  display_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS telegram_event_drafts (
  chat_id INTEGER PRIMARY KEY NOT NULL,
  step TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
