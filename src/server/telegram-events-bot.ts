import { PROJECTS, getProject } from "@/lib/projects";
import {
  clearTelegramDraft,
  createEventRecord,
  getTelegramDraft,
  getTelegramMember,
  parseEventInput,
  saveTelegramDraft,
  saveTelegramMember,
  type EventInput,
} from "./events-store";
import { runtimeValue, type RuntimeEnv } from "./runtime-env";

type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramChat = { id: number; type: string };

type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
};

type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type TelegramMember = {
  chat_id: number;
  telegram_user_id: number;
  username: string | null;
  display_name: string | null;
  role: "admin" | "editor";
  is_active: boolean;
};

type DraftStep =
  "project" | "title" | "date" | "time" | "location" | "description" | "link" | "confirm";

type Draft = { step: DraftStep; payload: Partial<EventInput> };

type InlineButton = { text: string; callback_data?: string; url?: string };
type InlineKeyboard = { inline_keyboard: InlineButton[][] };

type TelegramConfig = {
  token: string | undefined;
  webhookSecret: string | undefined;
  bootstrapChatId: string | undefined;
};

const SITE_URL = "https://events.echomarketing.agency/";

function config(env: RuntimeEnv): TelegramConfig {
  return {
    token: runtimeValue(env, "TELEGRAM_BOT_TOKEN"),
    webhookSecret: runtimeValue(env, "TELEGRAM_WEBHOOK_SECRET"),
    bootstrapChatId: runtimeValue(env, "TELEGRAM_BOOTSTRAP_CHAT_ID"),
  };
}

function displayName(user: TelegramUser | undefined): string | null {
  if (!user) return null;
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || user.username || null;
}

async function telegramApi<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = (await response.json().catch(() => null)) as {
    ok?: boolean;
    result?: T;
    description?: string;
  } | null;
  if (!response.ok || !result?.ok) {
    throw new Error(`Telegram ${method} failed: ${result?.description ?? response.status}`);
  }
  return result.result as T;
}

async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboard,
) {
  return telegramApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  });
}

function mainMenu(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "➕ Додати подію", callback_data: "event:new" }],
      [{ text: "Відкрити календар", url: SITE_URL }],
    ],
  };
}

function projectMenu(): InlineKeyboard {
  const rows: InlineButton[][] = [];
  for (let index = 0; index < PROJECTS.length; index += 2) {
    rows.push(
      PROJECTS.slice(index, index + 2).map((project) => ({
        text: project.name,
        callback_data: `project:${project.id}`,
      })),
    );
  }
  rows.push([{ text: "Скасувати", callback_data: "event:cancel" }]);
  return { inline_keyboard: rows };
}

function skipMenu(field: "time" | "location" | "description" | "link"): InlineKeyboard {
  const labels = {
    time: "Без часу",
    location: "Пропустити локацію",
    description: "Пропустити опис",
    link: "Пропустити посилання",
  } as const;
  return {
    inline_keyboard: [
      [{ text: labels[field], callback_data: `skip:${field}` }],
      [{ text: "Скасувати", callback_data: "event:cancel" }],
    ],
  };
}

function confirmationMenu(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "✅ Додати подію", callback_data: "event:save" }],
      [{ text: "↩️ Почати заново", callback_data: "event:new" }],
      [{ text: "Скасувати", callback_data: "event:cancel" }],
    ],
  };
}

function parseDate(value: string): string | null {
  const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const ukrainian = value.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : ukrainian
      ? { year: Number(ukrainian[3]), month: Number(ukrainian[2]), day: Number(ukrainian[1]) }
      : null;
  if (!parts) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day
  ) {
    return null;
  }
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseTime(value: string): string | null {
  const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return `${match[1]!.padStart(2, "0")}:${match[2]!}`;
}

function parseUrl(value: string): string | null {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

function formatDraft(payload: Partial<EventInput>): string {
  const project = payload.project ? getProject(payload.project).name : "—";
  const time = payload.event_time ?? "Без часу";
  return [
    "Перевірте подію перед додаванням:",
    "",
    `Назва: ${payload.title ?? "—"}`,
    `Проєкт: ${project}`,
    `Дата: ${payload.event_date ?? "—"}`,
    `Час: ${time}`,
    `Локація: ${payload.location ?? "—"}`,
    `Опис: ${payload.description ?? "—"}`,
    `Посилання: ${payload.link ?? "—"}`,
  ].join("\n");
}

async function getMember(
  env: RuntimeEnv,
  chatId: number,
  user: TelegramUser | undefined,
): Promise<TelegramMember | null> {
  const existing = await getTelegramMember(env, chatId);
  if (existing) return existing;

  const bootstrapChatId = config(env).bootstrapChatId;
  if (!bootstrapChatId || bootstrapChatId !== String(chatId)) return null;

  const member = {
    chat_id: chatId,
    telegram_user_id: user?.id ?? chatId,
    username: user?.username ?? null,
    display_name: displayName(user),
    role: "admin" as const,
    is_active: true,
  };
  await saveTelegramMember(env, member);
  return member;
}

async function getDraft(env: RuntimeEnv, chatId: number): Promise<Draft | null> {
  const draft = await getTelegramDraft(env, chatId);
  if (!draft || !draft.payload || typeof draft.payload !== "object") return null;
  return { step: draft.step as DraftStep, payload: draft.payload };
}

async function saveDraft(env: RuntimeEnv, chatId: number, draft: Draft) {
  await saveTelegramDraft(env, chatId, draft);
}

async function clearDraft(env: RuntimeEnv, chatId: number) {
  await clearTelegramDraft(env, chatId);
}

async function startEvent(token: string, env: RuntimeEnv, chatId: number) {
  await saveDraft(env, chatId, { step: "project", payload: {} });
  await sendMessage(token, chatId, "Оберіть проєкт для нової події.", projectMenu());
}

async function showMainMenu(token: string, chatId: number) {
  await sendMessage(token, chatId, "ECHO Events Bot готовий. Оберіть дію.", mainMenu());
}

async function ensurePrivateChat(token: string, chat: TelegramChat): Promise<boolean> {
  if (chat.type === "private") return true;
  await sendMessage(
    token,
    chat.id,
    "Для безпеки додавати події можна лише в особистому чаті з ботом.",
  );
  return false;
}

async function handleTextStep(
  token: string,
  env: RuntimeEnv,
  chatId: number,
  draft: Draft,
  text: string,
) {
  const value = text.trim();
  const payload = { ...draft.payload };

  if (draft.step === "title") {
    if (!value || value.length > 140) {
      await sendMessage(token, chatId, "Введіть назву до 140 символів.");
      return;
    }
    payload.title = value;
    await saveDraft(env, chatId, { step: "date", payload });
    await sendMessage(token, chatId, "Введіть дату у форматі ДД.ММ.РРРР, наприклад 12.09.2026.");
    return;
  }

  if (draft.step === "date") {
    const date = parseDate(value);
    if (!date) {
      await sendMessage(token, chatId, "Не бачу коректної дати. Спробуйте, наприклад: 12.09.2026.");
      return;
    }
    payload.event_date = date;
    await saveDraft(env, chatId, { step: "time", payload });
    await sendMessage(
      token,
      chatId,
      "Введіть час у форматі 18:30 або пропустіть його.",
      skipMenu("time"),
    );
    return;
  }

  if (draft.step === "time") {
    const time = parseTime(value);
    if (!time) {
      await sendMessage(
        token,
        chatId,
        "Введіть час у форматі 18:30 або натисніть «Без часу».",
        skipMenu("time"),
      );
      return;
    }
    payload.event_time = time;
    await saveDraft(env, chatId, { step: "location", payload });
    await sendMessage(
      token,
      chatId,
      "Вкажіть локацію події або пропустіть поле.",
      skipMenu("location"),
    );
    return;
  }

  if (draft.step === "location") {
    if (value.length > 200) {
      await sendMessage(
        token,
        chatId,
        "Локація має містити до 200 символів.",
        skipMenu("location"),
      );
      return;
    }
    payload.location = value || null;
    await saveDraft(env, chatId, { step: "description", payload });
    await sendMessage(
      token,
      chatId,
      "Додайте короткий опис або пропустіть поле.",
      skipMenu("description"),
    );
    return;
  }

  if (draft.step === "description") {
    if (value.length > 2_000) {
      await sendMessage(
        token,
        chatId,
        "Опис має містити до 2000 символів.",
        skipMenu("description"),
      );
      return;
    }
    payload.description = value || null;
    await saveDraft(env, chatId, { step: "link", payload });
    await sendMessage(
      token,
      chatId,
      "Додайте посилання на бриф або матеріали, або пропустіть поле.",
      skipMenu("link"),
    );
    return;
  }

  if (draft.step === "link") {
    const link = parseUrl(value);
    if (!link) {
      await sendMessage(
        token,
        chatId,
        "Вкажіть повне посилання, що починається з https://, або пропустіть поле.",
        skipMenu("link"),
      );
      return;
    }
    payload.link = link;
    await saveDraft(env, chatId, { step: "confirm", payload });
    await sendMessage(token, chatId, formatDraft(payload), confirmationMenu());
    return;
  }

  await showMainMenu(token, chatId);
}

async function handleCallback(
  token: string,
  env: RuntimeEnv,
  update: TelegramUpdate,
  callback: TelegramCallbackQuery,
  member: TelegramMember,
) {
  const chatId = callback.message?.chat.id;
  if (!chatId) return;
  const data = callback.data ?? "";
  await telegramApi(token, "answerCallbackQuery", { callback_query_id: callback.id });

  if (data === "event:cancel") {
    await clearDraft(env, chatId);
    await sendMessage(token, chatId, "Чернетку скасовано.", mainMenu());
    return;
  }

  if (data === "event:new") {
    await startEvent(token, env, chatId);
    return;
  }

  if (data.startsWith("project:")) {
    const project = data.slice("project:".length);
    if (!PROJECTS.some((item) => item.id === project)) return;
    await saveDraft(env, chatId, { step: "title", payload: { project } });
    await sendMessage(token, chatId, "Введіть назву події.");
    return;
  }

  const draft = await getDraft(env, chatId);
  if (!draft) {
    await showMainMenu(token, chatId);
    return;
  }

  if (data === "skip:time" && draft.step === "time") {
    const payload = { ...draft.payload, event_time: null };
    await saveDraft(env, chatId, { step: "location", payload });
    await sendMessage(
      token,
      chatId,
      "Вкажіть локацію події або пропустіть поле.",
      skipMenu("location"),
    );
    return;
  }

  if (data === "skip:location" && draft.step === "location") {
    const payload = { ...draft.payload, location: null };
    await saveDraft(env, chatId, { step: "description", payload });
    await sendMessage(
      token,
      chatId,
      "Додайте короткий опис або пропустіть поле.",
      skipMenu("description"),
    );
    return;
  }

  if (data === "skip:description" && draft.step === "description") {
    const payload = { ...draft.payload, description: null };
    await saveDraft(env, chatId, { step: "link", payload });
    await sendMessage(
      token,
      chatId,
      "Додайте посилання на бриф або матеріали, або пропустіть поле.",
      skipMenu("link"),
    );
    return;
  }

  if (data === "skip:link" && draft.step === "link") {
    const payload = { ...draft.payload, link: null };
    await saveDraft(env, chatId, { step: "confirm", payload });
    await sendMessage(token, chatId, formatDraft(payload), confirmationMenu());
    return;
  }

  if (data === "event:save" && draft.step === "confirm") {
    const result = await createEventRecord(env, parseEventInput(draft.payload), {
      createdVia: "telegram",
      telegramChatId: member.chat_id,
      telegramUpdateId: update.update_id,
    });
    await clearDraft(env, chatId);
    const sheetText =
      result.sheetSync === "synced"
        ? "Календар і таблицю оновлено."
        : "Календар оновлено. Синхронізація таблиці ще не підтверджена.";
    const duplicateText = result.deduplicated ? " Подія вже була додана раніше." : "";
    await sendMessage(token, chatId, `Готово. ${sheetText}${duplicateText}`, mainMenu());
  }
}

async function handleMessage(
  token: string,
  env: RuntimeEnv,
  message: TelegramMessage,
  member: TelegramMember | null,
) {
  if (!(await ensurePrivateChat(token, message.chat))) return;
  const chatId = message.chat.id;
  const text = message.text?.trim() ?? "";

  if (/^\/id(?:@\w+)?$/i.test(text)) {
    await sendMessage(token, chatId, `Ваш Telegram chat ID: ${chatId}`);
    return;
  }

  if (!member || !member.is_active) {
    await sendMessage(
      token,
      chatId,
      `Доступ до ECHO Events ще не активовано. Надішліть адміністратору цей ID: ${chatId}`,
    );
    return;
  }

  if (/^\/start(?:@\w+)?$/i.test(text)) {
    await showMainMenu(token, chatId);
    return;
  }

  if (/^\/cancel(?:@\w+)?$/i.test(text)) {
    await clearDraft(env, chatId);
    await sendMessage(token, chatId, "Чернетку скасовано.", mainMenu());
    return;
  }

  const allow = text.match(/^\/allow\s+(\d+)$/i);
  if (allow) {
    if (member.role !== "admin") {
      await sendMessage(token, chatId, "Додавати редакторів може лише адміністратор.");
      return;
    }
    const targetChatId = Number(allow[1]);
    await saveTelegramMember(env, {
      chat_id: targetChatId,
      telegram_user_id: targetChatId,
      username: null,
      display_name: null,
      role: "editor",
      is_active: true,
    });
    await sendMessage(token, chatId, `Редактора з ID ${targetChatId} додано.`);
    return;
  }

  const draft = await getDraft(env, chatId);
  if (!draft) {
    await showMainMenu(token, chatId);
    return;
  }
  await handleTextStep(token, env, chatId, draft, text);
}

export async function ensureTelegramWebhook(env: RuntimeEnv, origin: string): Promise<boolean> {
  const { token, webhookSecret } = config(env);
  if (!token || !webhookSecret) return false;

  const webhookUrl = new URL("/api/telegram/events/webhook", origin).toString();
  await telegramApi(token, "setWebhook", {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  return true;
}

export async function handleTelegramEventsWebhook(
  request: Request,
  env: RuntimeEnv,
): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const { token, webhookSecret } = config(env);
  if (!token || !webhookSecret) {
    return Response.json({ error: "Telegram bot is not configured" }, { status: 503 });
  }
  if (request.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;
  const message = update.message;
  const callback = update.callback_query;

  if (message) {
    const member = await getMember(env, message.chat.id, message.from);
    await handleMessage(token, env, message, member);
  } else if (callback?.message) {
    if (!(await ensurePrivateChat(token, callback.message.chat))) {
      await telegramApi(token, "answerCallbackQuery", { callback_query_id: callback.id });
      return Response.json({ ok: true });
    }
    const member = await getMember(env, callback.message.chat.id, callback.from);
    if (!member || !member.is_active) {
      await telegramApi(token, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Доступ не активовано",
        show_alert: true,
      });
    } else {
      await handleCallback(token, env, update, callback, member);
    }
  }

  return Response.json({ ok: true });
}
