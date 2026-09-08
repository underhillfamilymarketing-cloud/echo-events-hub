import { runtimeValue, type RuntimeEnv } from "./runtime-env";

export type SheetSyncAction = "create" | "update" | "delete";

export type SheetSyncEvent = {
  id?: string;
  title?: string;
  project?: string;
  event_date?: string;
  event_time?: string | null;
  location?: string | null;
  description?: string | null;
  link?: string | null;
};

export type SheetSyncStatus = "synced" | "not-configured" | "pending";

export async function mirrorEventToSheet(
  action: SheetSyncAction,
  event: SheetSyncEvent,
  env: RuntimeEnv,
): Promise<SheetSyncStatus> {
  const webhookUrl = runtimeValue(env, "EVENTS_SHEETS_WEBHOOK_URL");
  if (!webhookUrl) return "not-configured";

  const headers = new Headers({ "content-type": "application/json" });
  const token = runtimeValue(env, "EVENTS_SHEETS_WEBHOOK_TOKEN");
  if (token) headers.set("authorization", `Bearer ${token}`);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, event, synced_at: new Date().toISOString() }),
    });
    if (!response.ok) throw new Error(`Sheet webhook returned ${response.status}`);
    return "synced";
  } catch (error) {
    console.warn("[events-sheet-sync] mirror failed", error);
    return "pending";
  }
}
