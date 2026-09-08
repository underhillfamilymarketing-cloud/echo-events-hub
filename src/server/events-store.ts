import { createClient } from "@supabase/supabase-js";
import { PROJECTS } from "@/lib/projects";
import { mirrorEventToSheet, type SheetSyncStatus } from "./events-sheet-mirror";
import { runtimeValue, type RuntimeEnv } from "./runtime-env";

export type EventInput = {
  title: string;
  project: string;
  event_date: string;
  event_time: string | null;
  location: string | null;
  description: string | null;
  link: string | null;
};

export type StoredEvent = EventInput & { id: string };

export type EventWriteResult = {
  event: StoredEvent;
  sheetSync: SheetSyncStatus;
  deduplicated: boolean;
};

type EventMetadata = {
  createdVia?: "site" | "telegram";
  telegramChatId?: number;
  telegramUpdateId?: number;
};

const EVENT_COLUMNS = "id,title,project,event_date,event_time,location,description,link";
const PROJECT_IDS = new Set(PROJECTS.map((project) => project.id));

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error("Некоректне значення поля події");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw new Error("Значення поля події надто довге");
  return trimmed;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function parseEventInput(value: unknown): EventInput {
  if (!isRecord(value)) throw new Error("Некоректні дані події");

  const title = optionalText(value.title, 140);
  const project = optionalText(value.project, 80);
  const eventDate = optionalText(value.event_date, 10);
  const eventTime = optionalText(value.event_time, 5);
  const location = optionalText(value.location, 200);
  const description = optionalText(value.description, 2_000);
  const link = optionalText(value.link, 500);

  if (!title) throw new Error("Вкажіть назву події");
  if (!project || !PROJECT_IDS.has(project)) throw new Error("Оберіть коректний проєкт");
  if (!eventDate || !validDate(eventDate)) throw new Error("Вкажіть коректну дату події");
  if (eventTime && !validTime(eventTime)) throw new Error("Вкажіть коректний час події");
  if (link && !validUrl(link)) throw new Error("Вкажіть коректне посилання");

  return {
    title,
    project,
    event_date: eventDate,
    event_time: eventTime,
    location,
    description,
    link,
  };
}

export function createEventsAdminClient(env: RuntimeEnv) {
  const url = runtimeValue(env, "SUPABASE_URL");
  const serviceRoleKey = runtimeValue(env, "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("Серверний доступ до календаря ще не налаштований");
  }

  return createClient(url, serviceRoleKey, {
    global: { fetch: createSupabaseFetch(serviceRoleKey) },
    auth: { autoRefreshToken: false, persistSession: false, storage: undefined },
  });
}

async function findTelegramEvent(env: RuntimeEnv, updateId: number): Promise<StoredEvent | null> {
  const client = createEventsAdminClient(env);
  const { data, error } = await client
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("telegram_update_id", updateId)
    .maybeSingle();
  if (error) throw error;
  return (data as StoredEvent | null) ?? null;
}

export async function createEventRecord(
  env: RuntimeEnv,
  input: EventInput,
  metadata: EventMetadata = {},
): Promise<EventWriteResult> {
  const client = createEventsAdminClient(env);
  const { data, error } = await client
    .from("events")
    .insert({
      ...input,
      created_via: metadata.createdVia ?? "site",
      created_by_telegram_chat_id: metadata.telegramChatId ?? null,
      telegram_update_id: metadata.telegramUpdateId ?? null,
    })
    .select(EVENT_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505" && metadata.telegramUpdateId != null) {
      const event = await findTelegramEvent(env, metadata.telegramUpdateId);
      if (event) return { event, sheetSync: "synced", deduplicated: true };
    }
    throw error;
  }

  const event = data as StoredEvent;
  const sheetSync = await mirrorEventToSheet("create", event, env);
  return { event, sheetSync, deduplicated: false };
}

export async function updateEventRecord(
  env: RuntimeEnv,
  eventId: string,
  input: EventInput,
): Promise<EventWriteResult> {
  const client = createEventsAdminClient(env);
  const { data, error } = await client
    .from("events")
    .update(input)
    .eq("id", eventId)
    .select(EVENT_COLUMNS)
    .single();
  if (error) throw error;

  const event = data as StoredEvent;
  const sheetSync = await mirrorEventToSheet("update", event, env);
  return { event, sheetSync, deduplicated: false };
}

export async function deleteEventRecord(
  env: RuntimeEnv,
  eventId: string,
): Promise<EventWriteResult> {
  const client = createEventsAdminClient(env);
  const { data: existing, error: lookupError } = await client
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!existing) throw new Error("Подію не знайдено");

  const { error } = await client.from("events").delete().eq("id", eventId);
  if (error) throw error;

  const event = existing as StoredEvent;
  const sheetSync = await mirrorEventToSheet("delete", event, env);
  return { event, sheetSync, deduplicated: false };
}
