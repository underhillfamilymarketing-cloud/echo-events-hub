import { supabase } from "@/integrations/supabase/client";

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
  await eventMutation("/api/events", "POST", input);
}

export async function updateEvent(id: string, input: EventInput) {
  await eventMutation(`/api/events/${id}`, "PUT", input);
}

export async function deleteEvent(id: string) {
  await eventMutation(`/api/events/${id}`, "DELETE");
}

async function eventMutation(url: string, method: "POST" | "PUT" | "DELETE", body?: EventInput) {
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.ok) return;

  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(payload?.error ?? "Не вдалося зберегти подію");
}

export async function createEditorSession(password: string) {
  const response = await fetch("/api/edit-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (response.ok) return;

  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(payload?.error ?? "Не вдалося відкрити редагування");
}

export async function readEditorSession(): Promise<boolean> {
  const response = await fetch("/api/edit-session");
  if (!response.ok) return false;
  const payload = (await response.json()) as { authorized?: unknown };
  return payload.authorized === true;
}

export async function clearEditorSession() {
  await fetch("/api/edit-session", { method: "DELETE" });
}
