import { importLegacyEvents } from "./events-store";
import { runtimeValue, type RuntimeEnv } from "./runtime-env";

export async function handleLegacyEventsMigration(
  request: Request,
  env: RuntimeEnv,
): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const expectedSecret = runtimeValue(env, "EVENTS_MIGRATION_SECRET");
  if (!expectedSecret) return new Response("Not Found", { status: 404 });
  if (request.headers.get("x-events-migration-secret") !== expectedSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return Response.json(await importLegacyEvents(env));
  } catch (error) {
    console.warn("[events-migration] import failed", error);
    const message = error instanceof Error ? error.message : "Не вдалося перенести події";
    return Response.json({ error: message }, { status: 502 });
  }
}
