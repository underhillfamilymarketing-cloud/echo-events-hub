CREATE TABLE public.events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT 'other',
  event_date DATE NOT NULL,
  event_time TIME,
  location TEXT,
  description TEXT,
  link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX events_date_idx ON public.events (event_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view events" ON public.events FOR SELECT USING (true);
CREATE POLICY "Anyone can create events" ON public.events FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update events" ON public.events FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete events" ON public.events FOR DELETE USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.events;