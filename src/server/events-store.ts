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

export type TelegramMemberRecord = {
  chat_id: number;
  telegram_user_id: number;
  username: string | null;
  display_name: string | null;
  role: "admin" | "editor";
  is_active: boolean;
};

export type TelegramDraftRecord = {
  step: string;
  payload: Partial<EventInput>;
};

export type TelegramAccessRequestStatus = "pending" | "approved" | "rejected";

export type TelegramAccessRequestRecord = {
  chat_id: number;
  telegram_user_id: number;
  username: string | null;
  display_name: string | null;
  status: TelegramAccessRequestStatus;
  requested_at: string;
  resolved_at: string | null;
  resolved_by_chat_id: number | null;
};

type EventMetadata = {
  createdVia?: "site" | "telegram" | "pool_sync";
  telegramChatId?: number;
  telegramUpdateId?: number;
};

type D1Result = { results?: unknown[]; meta?: { changes?: number } };

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<D1Result>;
};

type D1Database = {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<D1Result[]>;
};

const EVENT_COLUMNS = "id, title, project, event_date, event_time, location, description, link";
const PROJECT_IDS = new Set(PROJECTS.map((project) => project.id));

function getDatabase(env: RuntimeEnv): D1Database {
  const database = env["DB"];
  if (!database || typeof database !== "object" || !("prepare" in database)) {
    throw new Error("Серверне сховище календаря ще не налаштоване");
  }
  return database as D1Database;
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

function eventId(): string {
  return crypto.randomUUID();
}

function changes(result: D1Result): number {
  return Number(result.meta?.changes ?? 0);
}

async function eventById(env: RuntimeEnv, id: string): Promise<StoredEvent | null> {
  return getDatabase(env)
    .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<StoredEvent>();
}

export function parseEventInput(value: unknown): EventInput {
  if (!isRecord(value)) throw new Error("Некоректні дані події");

  const title = optionalText(value["title"], 140);
  const project = optionalText(value["project"], 80);
  const eventDate = optionalText(value["event_date"], 10);
  const eventTime = optionalText(value["event_time"], 5);
  const location = optionalText(value["location"], 200);
  const description = optionalText(value["description"], 2_000);
  const link = optionalText(value["link"], 500);

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

export async function listEventsInRange(
  env: RuntimeEnv,
  from: string,
  to: string,
): Promise<StoredEvent[]> {
  return (
    (
      await getDatabase(env)
        .prepare(
          `SELECT ${EVENT_COLUMNS} FROM events
         WHERE event_date >= ? AND event_date <= ?
         ORDER BY event_date ASC, event_time IS NULL ASC, event_time ASC, id ASC`,
        )
        .bind(from, to)
        .all<StoredEvent>()
    ).results ?? []
  );
}

export async function listUpcomingEvents(
  env: RuntimeEnv,
  from: string,
  limit: number,
): Promise<StoredEvent[]> {
  return (
    (
      await getDatabase(env)
        .prepare(
          `SELECT ${EVENT_COLUMNS} FROM events
         WHERE event_date >= ?
         ORDER BY event_date ASC, event_time IS NULL ASC, event_time ASC, id ASC
         LIMIT ?`,
        )
        .bind(from, Math.max(1, Math.min(limit, 200)))
        .all<StoredEvent>()
    ).results ?? []
  );
}

export async function searchStoredEvents(env: RuntimeEnv, term: string): Promise<StoredEvent[]> {
  const query = term.trim().slice(0, 140);
  if (!query) return [];
  const like = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
  return (
    (
      await getDatabase(env)
        .prepare(
          `SELECT ${EVENT_COLUMNS} FROM events
         WHERE title LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR location LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR description LIKE ? ESCAPE '\\' COLLATE NOCASE
         ORDER BY event_date ASC, event_time IS NULL ASC, event_time ASC, id ASC
         LIMIT 100`,
        )
        .bind(like, like, like)
        .all<StoredEvent>()
    ).results ?? []
  );
}

export async function findEventByProjectLink(
  env: RuntimeEnv,
  project: string,
  link: string,
): Promise<StoredEvent | null> {
  return getDatabase(env)
    .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE project = ? AND link = ? LIMIT 1`)
    .bind(project, link)
    .first<StoredEvent>();
}

export async function listEventsByProjectDate(
  env: RuntimeEnv,
  project: string,
  eventDate: string,
): Promise<StoredEvent[]> {
  return (
    (
      await getDatabase(env)
        .prepare(
          `SELECT ${EVENT_COLUMNS} FROM events
         WHERE project = ? AND event_date = ?
         ORDER BY event_time IS NULL ASC, event_time ASC, id ASC`,
        )
        .bind(project, eventDate)
        .all<StoredEvent>()
    ).results ?? []
  );
}

async function findTelegramEvent(env: RuntimeEnv, updateId: number): Promise<StoredEvent | null> {
  return getDatabase(env)
    .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE telegram_update_id = ? LIMIT 1`)
    .bind(updateId)
    .first<StoredEvent>();
}

export async function createEventRecord(
  env: RuntimeEnv,
  input: EventInput,
  metadata: EventMetadata = {},
): Promise<EventWriteResult> {
  if (metadata.telegramUpdateId != null) {
    const existing = await findTelegramEvent(env, metadata.telegramUpdateId);
    if (existing) return { event: existing, sheetSync: "synced", deduplicated: true };
  }

  const db = getDatabase(env);
  const id = eventId();
  try {
    await db
      .prepare(
        `INSERT INTO events (
          id, title, project, event_date, event_time, location, description, link,
          created_via, created_by_telegram_chat_id, telegram_update_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.title,
        input.project,
        input.event_date,
        input.event_time,
        input.location,
        input.description,
        input.link,
        metadata.createdVia ?? "site",
        metadata.telegramChatId ?? null,
        metadata.telegramUpdateId ?? null,
      )
      .run();
  } catch (error) {
    if (metadata.telegramUpdateId != null) {
      const existing = await findTelegramEvent(env, metadata.telegramUpdateId);
      if (existing) return { event: existing, sheetSync: "synced", deduplicated: true };
    }
    throw error;
  }

  const event = await eventById(env, id);
  if (!event) throw new Error("Подію не вдалося зберегти");
  const sheetSync = await mirrorEventToSheet("create", event, env);
  return { event, sheetSync, deduplicated: false };
}

export async function updateEventRecord(
  env: RuntimeEnv,
  eventId: string,
  input: EventInput,
): Promise<EventWriteResult> {
  const result = await getDatabase(env)
    .prepare(
      `UPDATE events
       SET title = ?, project = ?, event_date = ?, event_time = ?, location = ?,
           description = ?, link = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(
      input.title,
      input.project,
      input.event_date,
      input.event_time,
      input.location,
      input.description,
      input.link,
      eventId,
    )
    .run();
  if (!changes(result)) throw new Error("Подію не знайдено");

  const event = await eventById(env, eventId);
  if (!event) throw new Error("Подію не знайдено");
  const sheetSync = await mirrorEventToSheet("update", event, env);
  return { event, sheetSync, deduplicated: false };
}

export async function deleteEventRecord(
  env: RuntimeEnv,
  eventId: string,
): Promise<EventWriteResult> {
  const event = await eventById(env, eventId);
  if (!event) throw new Error("Подію не знайдено");
  await getDatabase(env).prepare("DELETE FROM events WHERE id = ?").bind(eventId).run();
  const sheetSync = await mirrorEventToSheet("delete", event, env);
  return { event, sheetSync, deduplicated: false };
}

export async function getTelegramMember(
  env: RuntimeEnv,
  chatId: number,
): Promise<TelegramMemberRecord | null> {
  const row = await getDatabase(env)
    .prepare(
      `SELECT chat_id, telegram_user_id, username, display_name, role, is_active
       FROM telegram_event_users WHERE chat_id = ? LIMIT 1`,
    )
    .bind(chatId)
    .first<Omit<TelegramMemberRecord, "is_active"> & { is_active: number }>();
  if (!row || (row.role !== "admin" && row.role !== "editor")) return null;
  return { ...row, is_active: Boolean(row.is_active) };
}

export async function saveTelegramMember(
  env: RuntimeEnv,
  member: TelegramMemberRecord,
): Promise<void> {
  await getDatabase(env)
    .prepare(
      `INSERT INTO telegram_event_users (
        chat_id, telegram_user_id, username, display_name, role, is_active
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        telegram_user_id = excluded.telegram_user_id,
        username = COALESCE(excluded.username, telegram_event_users.username),
        display_name = COALESCE(excluded.display_name, telegram_event_users.display_name),
        role = excluded.role,
        is_active = excluded.is_active,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      member.chat_id,
      member.telegram_user_id,
      member.username,
      member.display_name,
      member.role,
      member.is_active ? 1 : 0,
    )
    .run();
}

export async function listTelegramAdmins(env: RuntimeEnv): Promise<TelegramMemberRecord[]> {
  const rows =
    (
      await getDatabase(env)
        .prepare(
          `SELECT chat_id, telegram_user_id, username, display_name, role, is_active
         FROM telegram_event_users
         WHERE role = 'admin' AND is_active = 1`,
        )
        .all<Omit<TelegramMemberRecord, "is_active"> & { is_active: number }>()
    ).results ?? [];

  return rows.map((row) => ({ ...row, is_active: Boolean(row.is_active) }));
}

function isTelegramAccessRequestStatus(value: string): value is TelegramAccessRequestStatus {
  return value === "pending" || value === "approved" || value === "rejected";
}

export async function getTelegramAccessRequest(
  env: RuntimeEnv,
  chatId: number,
): Promise<TelegramAccessRequestRecord | null> {
  const row = await getDatabase(env)
    .prepare(
      `SELECT chat_id, telegram_user_id, username, display_name, status, requested_at,
              resolved_at, resolved_by_chat_id
       FROM telegram_event_access_requests
       WHERE chat_id = ? LIMIT 1`,
    )
    .bind(chatId)
    .first<Omit<TelegramAccessRequestRecord, "status"> & { status: string }>();

  if (!row || !isTelegramAccessRequestStatus(row.status)) return null;
  return { ...row, status: row.status };
}

export async function createTelegramAccessRequest(
  env: RuntimeEnv,
  request: Pick<
    TelegramAccessRequestRecord,
    "chat_id" | "telegram_user_id" | "username" | "display_name"
  >,
): Promise<{ request: TelegramAccessRequestRecord; created: boolean }> {
  const savedResult = await getDatabase(env)
    .prepare(
      `INSERT INTO telegram_event_access_requests (
        chat_id, telegram_user_id, username, display_name, status, requested_at,
        resolved_at, resolved_by_chat_id
      ) VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, NULL, NULL)
      ON CONFLICT(chat_id) DO UPDATE SET
        telegram_user_id = excluded.telegram_user_id,
        username = COALESCE(excluded.username, telegram_event_access_requests.username),
        display_name = COALESCE(excluded.display_name, telegram_event_access_requests.display_name),
        status = 'pending',
        requested_at = CURRENT_TIMESTAMP,
        resolved_at = NULL,
        resolved_by_chat_id = NULL
      WHERE telegram_event_access_requests.status <> 'pending'`,
    )
    .bind(request.chat_id, request.telegram_user_id, request.username, request.display_name)
    .run();

  const saved = await getTelegramAccessRequest(env, request.chat_id);
  if (!saved) throw new Error("Не вдалося зберегти запит на доступ");
  return { request: saved, created: savedResult.meta.changes === 1 };
}

export async function resolveTelegramAccessRequest(
  env: RuntimeEnv,
  chatId: number,
  status: Exclude<TelegramAccessRequestStatus, "pending">,
  resolvedByChatId: number,
): Promise<TelegramAccessRequestRecord | null> {
  const current = await getTelegramAccessRequest(env, chatId);
  if (!current || current.status !== "pending") return null;

  const result = await getDatabase(env)
    .prepare(
      `UPDATE telegram_event_access_requests
       SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by_chat_id = ?
       WHERE chat_id = ? AND status = 'pending'`,
    )
    .bind(status, resolvedByChatId, chatId)
    .run();

  if (result.meta.changes !== 1) return null;

  const resolved = await getTelegramAccessRequest(env, chatId);
  return resolved?.status === status ? resolved : null;
}

export async function getTelegramDraft(
  env: RuntimeEnv,
  chatId: number,
): Promise<TelegramDraftRecord | null> {
  const row = await getDatabase(env)
    .prepare("SELECT step, payload FROM telegram_event_drafts WHERE chat_id = ? LIMIT 1")
    .bind(chatId)
    .first<{ step: string; payload: string }>();
  if (!row || typeof row.step !== "string" || typeof row.payload !== "string") return null;
  try {
    const payload = JSON.parse(row.payload);
    return isRecord(payload) ? { step: row.step, payload: payload as Partial<EventInput> } : null;
  } catch {
    return null;
  }
}

export async function saveTelegramDraft(
  env: RuntimeEnv,
  chatId: number,
  draft: TelegramDraftRecord,
): Promise<void> {
  await getDatabase(env)
    .prepare(
      `INSERT INTO telegram_event_drafts (chat_id, step, payload)
       VALUES (?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         step = excluded.step,
         payload = excluded.payload,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(chatId, draft.step, JSON.stringify(draft.payload))
    .run();
}

export async function clearTelegramDraft(env: RuntimeEnv, chatId: number): Promise<void> {
  await getDatabase(env)
    .prepare("DELETE FROM telegram_event_drafts WHERE chat_id = ?")
    .bind(chatId)
    .run();
}
