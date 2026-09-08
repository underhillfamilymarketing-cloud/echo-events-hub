ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS created_via TEXT NOT NULL DEFAULT 'site',
  ADD COLUMN IF NOT EXISTS created_by_telegram_chat_id BIGINT,
  ADD COLUMN IF NOT EXISTS telegram_update_id BIGINT;

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_created_via_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_created_via_check
  CHECK (created_via IN ('site', 'telegram', 'pool_sync', 'import'));

CREATE UNIQUE INDEX IF NOT EXISTS events_telegram_update_id_unique
  ON public.events (telegram_update_id)
  WHERE telegram_update_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.telegram_event_users (
  chat_id BIGINT PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  username TEXT,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.telegram_event_drafts (
  chat_id BIGINT PRIMARY KEY REFERENCES public.telegram_event_users(chat_id) ON DELETE CASCADE,
  step TEXT NOT NULL CHECK (step IN ('project', 'title', 'date', 'time', 'location', 'description', 'link', 'confirm')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER update_telegram_event_users_updated_at
  BEFORE UPDATE ON public.telegram_event_users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_telegram_event_drafts_updated_at
  BEFORE UPDATE ON public.telegram_event_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.telegram_event_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_event_drafts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.telegram_event_users FROM anon, authenticated;
REVOKE ALL ON TABLE public.telegram_event_drafts FROM anon, authenticated;
GRANT ALL ON TABLE public.telegram_event_users TO service_role;
GRANT ALL ON TABLE public.telegram_event_drafts TO service_role;

DROP POLICY IF EXISTS "Anyone can create events" ON public.events;
DROP POLICY IF EXISTS "Anyone can update events" ON public.events;
DROP POLICY IF EXISTS "Anyone can delete events" ON public.events;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.events FROM anon, authenticated;
