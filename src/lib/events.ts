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

type EventsResponse = { events?: EventRow[]; error?: string };

async function readEvents(params: URLSearchParams): Promise<EventRow[]> {
  const response = await fetch(`/api/events?${params.toString()}`);
  const payload = (await response.json().catch(() => null)) as EventsResponse | null;
  if (!response.ok) throw new Error(payload?.error ?? "Не вдалося завантажити події");
  return payload?.events ?? [];
}

export async function fetchEventsInRange(from: string, to: string): Promise<EventRow[]> {
  return readEvents(new URLSearchParams({ from, to }));
}

export async function fetchUpcomingEvents(fromDate: string, limit = 8): Promise<EventRow[]> {
  return readEvents(
    new URLSearchParams({ upcomingFrom: fromDate, limit: String(Math.max(limit * 5, 50)) }),
  );
}

export async function searchEvents(term: string): Promise<EventRow[]> {
  const query = term.trim();
  if (!query) return [];
  return readEvents(new URLSearchParams({ q: query }));
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
  const init: RequestInit = { method };
  if (body) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
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
