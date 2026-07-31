import type { EventInput, EventRow } from "@/lib/events";

type SyncAction = "create" | "update" | "delete";

type SyncPayload = {
  action: SyncAction;
  event: Partial<EventRow> & Partial<EventInput> & { id?: string };
  synced_at: string;
};

const SYNC_ENDPOINT = "/api/events-sheet-sync";

export function queueEventSheetSync(action: SyncAction, event: SyncPayload["event"]) {
  if (typeof window === "undefined") return;

  const payload: SyncPayload = {
    action,
    event,
    synced_at: new Date().toISOString(),
  };

  window
    .fetch(SYNC_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    })
    .catch((error) => {
      console.warn("[events-sheet-sync] Google Sheets mirror skipped", error);
    });
}
