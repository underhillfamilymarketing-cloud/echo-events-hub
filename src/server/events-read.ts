import { listEventsInRange, listUpcomingEvents, searchStoredEvents } from "./events-store";
import type { RuntimeEnv } from "./runtime-env";

function validDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Не вдалося завантажити події";
  return Response.json({ error: message }, { status: 503 });
}

export async function handleEventRead(request: Request, env: RuntimeEnv): Promise<Response> {
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  try {
    const url = new URL(request.url);
    const search = url.searchParams.get("q");
    if (search) return Response.json({ events: await searchStoredEvents(env, search) });

    const upcomingFrom = url.searchParams.get("upcomingFrom");
    if (validDate(upcomingFrom)) {
      const requested = Number(url.searchParams.get("limit") ?? "50");
      const limit = Number.isFinite(requested) ? Math.floor(requested) : 50;
      return Response.json({ events: await listUpcomingEvents(env, upcomingFrom, limit) });
    }

    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!validDate(from) || !validDate(to) || from > to) {
      return Response.json({ error: "Вкажіть коректний період календаря" }, { status: 400 });
    }
    return Response.json({ events: await listEventsInRange(env, from, to) });
  } catch (error) {
    console.warn("[events-read] request failed", error);
    return errorResponse(error);
  }
}
