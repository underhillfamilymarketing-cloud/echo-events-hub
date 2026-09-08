import {
  createEventRecord,
  deleteEventRecord,
  parseEventInput,
  updateEventRecord,
} from "./events-store";
import { hasEditorSession, isSameOriginRequest } from "./editor-session";
import type { RuntimeEnv } from "./runtime-env";

function eventIdFromPath(request: Request): string | null {
  const match = new URL(request.url).pathname.match(/^\/api\/events\/([0-9a-f-]{36})$/i);
  return match?.[1] ?? null;
}

async function requestPayload(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("Некоректні дані події");
  }
}

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Не вдалося зберегти подію";
  return Response.json({ error: message }, { status: 400 });
}

export async function handleEventMutation(request: Request, env: RuntimeEnv): Promise<Response> {
  if (!isSameOriginRequest(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!(await hasEditorSession(request, env))) {
    return Response.json({ error: "Потрібен доступ до редагування" }, { status: 401 });
  }

  try {
    if (request.method === "POST" && new URL(request.url).pathname === "/api/events") {
      const result = await createEventRecord(env, parseEventInput(await requestPayload(request)));
      return Response.json(result, { status: 201 });
    }

    const eventId = eventIdFromPath(request);
    if (!eventId) return new Response("Not Found", { status: 404 });

    if (request.method === "PUT") {
      const result = await updateEventRecord(
        env,
        eventId,
        parseEventInput(await requestPayload(request)),
      );
      return Response.json(result);
    }

    if (request.method === "DELETE") {
      const result = await deleteEventRecord(env, eventId);
      return Response.json(result);
    }
  } catch (error) {
    console.warn("[events-admin] mutation failed", error);
    return errorResponse(error);
  }

  return new Response("Method Not Allowed", { status: 405 });
}
