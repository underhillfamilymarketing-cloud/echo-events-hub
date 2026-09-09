import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleEventMutation } from "./server/events-admin";
import { handleEventRead } from "./server/events-read";
import { handleEditorSession } from "./server/editor-session";
import { syncPoolEvents } from "./server/pool-event-sync";
import { handleTelegramEventsWebhook } from "./server/telegram-events-bot";
import {
  handleInstagramCallback,
  handleInstagramConnect,
  syncInstagramEvents,
} from "./server/meta-instagram";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type RuntimeEnv = Record<string, unknown> & {
  EVENTS_SHEETS_WEBHOOK_URL?: string;
  EVENTS_SHEETS_WEBHOOK_TOKEN?: string;
  META_INSTAGRAM_APP_ID?: string;
  META_INSTAGRAM_APP_SECRET?: string;
  META_INSTAGRAM_REDIRECT_URI?: string;
  META_INSTAGRAM_ACCESS_TOKEN?: string;
  META_INSTAGRAM_USER_ID?: string;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

async function handlePoolEventSync(request: Request, env: RuntimeEnv): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const result = await syncPoolEvents({}, env);
    return Response.json(result);
  } catch (error) {
    console.warn("[pool-event-sync] source sync failed", error);
    return Response.json({ error: "Pool event sync failed" }, { status: 502 });
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      const runtimeEnv = (env ?? {}) as RuntimeEnv;
      if (url.pathname === "/api/edit-session") {
        return await handleEditorSession(request, runtimeEnv);
      }
      if (url.pathname === "/api/events" && request.method === "GET") {
        return await handleEventRead(request, runtimeEnv);
      }
      if (url.pathname === "/api/events" || url.pathname.startsWith("/api/events/")) {
        return await handleEventMutation(request, runtimeEnv);
      }
      if (url.pathname === "/api/telegram/events/webhook") {
        return await handleTelegramEventsWebhook(request, runtimeEnv);
      }
      if (url.pathname === "/api/pool-events-sync") {
        return await handlePoolEventSync(request, runtimeEnv);
      }
      if (url.pathname === "/api/meta/instagram/connect") {
        return handleInstagramConnect(request, runtimeEnv);
      }
      if (url.pathname === "/api/meta/instagram/callback") {
        return await handleInstagramCallback(request, runtimeEnv);
      }
      if (url.pathname === "/api/meta/instagram-sync") {
        if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
        try {
          return Response.json(await syncInstagramEvents(runtimeEnv));
        } catch (error) {
          console.warn("[meta-instagram] sync failed", error);
          return Response.json({ error: "Instagram sync failed" }, { status: 502 });
        }
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
