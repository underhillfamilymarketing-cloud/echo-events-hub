import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type RuntimeEnv = {
  EVENTS_SHEETS_WEBHOOK_URL?: string;
  EVENTS_SHEETS_WEBHOOK_TOKEN?: string;
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

async function handleEventsSheetSync(request: Request, env: RuntimeEnv): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const webhookUrl = env.EVENTS_SHEETS_WEBHOOK_URL ?? process.env.EVENTS_SHEETS_WEBHOOK_URL;
  if (!webhookUrl) {
    return new Response(null, { status: 204 });
  }

  const body = await request.text();
  const headers = new Headers({ "content-type": "application/json" });
  const token = env.EVENTS_SHEETS_WEBHOOK_TOKEN ?? process.env.EVENTS_SHEETS_WEBHOOK_TOKEN;
  if (token) headers.set("authorization", `Bearer ${token}`);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      console.warn(`[events-sheet-sync] webhook returned ${response.status}`);
    }
  } catch (error) {
    console.warn("[events-sheet-sync] webhook request failed", error);
  }

  return new Response(null, { status: 204 });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/events-sheet-sync") {
        return await handleEventsSheetSync(request, (env ?? {}) as RuntimeEnv);
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
