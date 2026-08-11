import { supabase } from "@/integrations/supabase/client";
import { queueEventSheetSync } from "@/lib/events-sheet-sync";

export type EventRow = {
  id: string;
  title: string;
  project: string;
  event_date: string;
  event_time: string | null;
  location: string | null;
  description: string | null;
  link: string | null;
};

export type EventInput = Omit<EventRow, "id">;

const COLUMNS = "id, title, project, event_date, event_time, location, description, link";

export async function fetchEventsInRange(from: string, to: string): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from("events")
    .select(COLUMNS)
    .gte("event_date", from)
    .lte("event_date", to)
    .order("event_date", { ascending: true })
    .order("event_time", { ascending: true, nullsFirst: true })
    .returns<EventRow[]>();
  if (error) throw error;
  return data ?? [];
}

export async function fetchUpcomingEvents(fromDate: string, limit = 8): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from("events")
    .select(COLUMNS)
    .gte("event_date", fromDate)
    .order("event_date", { ascending: true })
    .order("event_time", { ascending: true, nullsFirst: false })
    .limit(Math.max(limit * 5, 50))
    .returns<EventRow[]>();
  if (error) throw error;
  return data ?? [];
}

export async function searchEvents(term: string): Promise<EventRow[]> {
  const q = term.trim().replace(/[%,()]/g, " ");
  if (!q) return [];
  const { data, error } = await supabase
    .from("events")
    .select(COLUMNS)
    .or(`title.ilike.%${q}%,location.ilike.%${q}%,description.ilike.%${q}%`)
    .order("event_date", { ascending: true })
    .limit(100)
    .returns<EventRow[]>();
  if (error) throw error;
  return data ?? [];
}

export async function createEvent(input: EventInput) {
  const { data, error } = await supabase
    .from("events")
    .insert(input)
    .select(COLUMNS)
    .single<EventRow>();
  if (error) throw error;
  queueEventSheetSync("create", data ?? input);
}

export async function updateEvent(id: string, input: EventInput) {
  const { error } = await supabase.from("events").update(input).eq("id", id);
  if (error) throw error;
  queueEventSheetSync("update", { id, ...input });
}

export async function deleteEvent(id: string) {
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) throw error;
  queueEventSheetSync("delete", { id });
}
