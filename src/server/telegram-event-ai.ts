import { PROJECTS } from "@/lib/projects";
import { parseEventInput, type EventInput } from "./events-store";
import { runtimeValue, type RuntimeEnv } from "./runtime-env";

type RequiredEventField = "title" | "project" | "event_date";

type JsonObject = Record<string, unknown>;

type ParsedModelEvent = {
  title: string | null;
  project: string | null;
  event_date: string | null;
  event_time: string | null;
  location: string | null;
  description: string | null;
  link: string | null;
  missing: RequiredEventField[];
};

export type NaturalEventParseResult =
  | { kind: "input"; input: EventInput }
  | { kind: "missing"; fields: RequiredEventField[] }
  | { kind: "unavailable" };

const PROJECT_ALIASES: Record<string, string[]> = {
  echo: ["echo", "echo marketing"],
  underhill: ["underhill", "underhill resort", "underhill resort spa"],
  hazard: ["hazard"],
  "arkan-group": ["arkan", "arkan group"],
  "arkan-arena": ["arkan arena"],
  pool: ["pool", "pool cdm", "pool cruce de mares", "cruce de mares", "пул", "пул круз де марес"],
  gustos: ["gustos", "cruce de gustos", "перетин смаків", "крусе де густос"],
  "el-cofre": ["el cofre", "cofre", "ель кофре"],
  provence: ["la provence", "provence", "прованс"],
  rebar: ["rebar", "рібар"],
  park: ["парк історії землі", "парк історії"],
  hype: ["hype", "хайп"],
  passport: ["паспорт країни", "паспорт"],
  other: ["інше", "other"],
};

const REQUIRED_FIELDS: RequiredEventField[] = ["title", "project", "event_date"];

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalize(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("uk-UA")
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function textValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function parseDate(value: string | null): string | null {
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const local = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : local
      ? { year: Number(local[3]), month: Number(local[2]), day: Number(local[1]) }
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

function parseTime(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]!.padStart(2, "0")}:${match[2]}` : null;
}

function parseUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function projectCandidates(project: (typeof PROJECTS)[number]): string[] {
  return [project.id, project.name, project.short, ...(PROJECT_ALIASES[project.id] ?? [])];
}

function explicitProjectId(message: string): string | null {
  const normalizedMessage = ` ${normalize(message)} `;
  const matches = PROJECTS.filter((project) =>
    projectCandidates(project).some((candidate) => {
      const normalizedCandidate = normalize(candidate);
      return normalizedCandidate && normalizedMessage.includes(` ${normalizedCandidate} `);
    }),
  ).map((project) => project.id);

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function currentKyivDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function eventParserPrompt(message: string): string {
  const projectList = PROJECTS.map((project) => {
    const aliases = PROJECT_ALIASES[project.id] ?? [];
    return `- ${project.id}: ${project.name}${aliases.length ? ` (aliases: ${aliases.join(", ")})` : ""}`;
  }).join("\n");

  return [
    "Extract one ECHO calendar event from the Telegram message below.",
    "Return one JSON object only, with no markdown and exactly these keys:",
    '{"title":string|null,"project":string|null,"event_date":"YYYY-MM-DD"|null,"event_time":"HH:MM"|null,"location":string|null,"description":string|null,"link":string|null,"missing":string[]}',
    "Required fields are title, project, and event_date. The missing array may contain only title, project, or event_date.",
    `Current date in Europe/Kyiv: ${currentKyivDate()}.`,
    "Use a project ID only from this list when the match is clear:",
    projectList,
    "Rules:",
    "- Read Ukrainian, Russian, English, Spanish, and mixed messages.",
    "- Do not invent a project, date, time, location, title, link, or description.",
    "- Preserve a URL exactly when one is present; otherwise use null.",
    "- For a date without a year, infer a year only when the date is unambiguously current or future relative to the current date. Otherwise mark event_date missing.",
    "- A relative date such as today, tomorrow, or a named weekday may be resolved from the current date only when it is unambiguous.",
    "- Make description a concise factual summary only when the message contains useful details beyond title, date, time, and location; otherwise use null.",
    "Telegram message:",
    message.slice(0, 8_000),
  ].join("\n");
}

function parseModelJson(value: string): JsonObject | null {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const objectText = trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  try {
    const parsed = JSON.parse(objectText) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parsedModelEvent(value: JsonObject): ParsedModelEvent {
  const missing = Array.isArray(value.missing)
    ? value.missing.filter((field): field is RequiredEventField =>
        REQUIRED_FIELDS.includes(field as RequiredEventField),
      )
    : [];
  return {
    title: textValue(value.title, 140),
    project: textValue(value.project, 120),
    event_date: textValue(value.event_date, 20),
    event_time: textValue(value.event_time, 20),
    location: textValue(value.location, 200),
    description: textValue(value.description, 2_000),
    link: textValue(value.link, 500),
    missing,
  };
}

function requiredFields(event: ParsedModelEvent, message: string): RequiredEventField[] {
  const missing = new Set(event.missing);
  if (!event.title) missing.add("title");
  if (explicitProjectId(message)) missing.delete("project");
  else missing.add("project");
  if (!parseDate(event.event_date)) missing.add("event_date");
  return REQUIRED_FIELDS.filter((field) => missing.has(field));
}

function modelInput(event: ParsedModelEvent, message: string): EventInput | null {
  const project = explicitProjectId(message);
  const eventDate = parseDate(event.event_date);
  if (!event.title || !project || !eventDate) return null;
  try {
    return parseEventInput({
      title: event.title,
      project,
      event_date: eventDate,
      event_time: parseTime(event.event_time),
      location: event.location,
      description: event.description,
      link: parseUrl(event.link),
    });
  } catch {
    return null;
  }
}

async function requestModel(env: RuntimeEnv, message: string): Promise<ParsedModelEvent | null> {
  const url = runtimeValue(env, "EVENTS_AI_PROXY_URL");
  const secret = runtimeValue(env, "EVENTS_AI_PROXY_SECRET");
  if (!url || !secret) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-echo-events-proxy-secret": secret,
      },
      body: JSON.stringify({ prompt: eventParserPrompt(message) }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const body = (await response.json().catch(() => null)) as unknown;
    if (!isObject(body) || typeof body.text !== "string") return null;
    const parsed = parseModelJson(body.text);
    return parsed ? parsedModelEvent(parsed) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function parseNaturalTelegramEvent(
  env: RuntimeEnv,
  message: string,
): Promise<NaturalEventParseResult> {
  const parsed = await requestModel(env, message);
  if (!parsed) return { kind: "unavailable" };

  const missing = requiredFields(parsed, message);
  if (missing.length > 0) return { kind: "missing", fields: missing };

  const input = modelInput(parsed, message);
  return input ? { kind: "input", input } : { kind: "unavailable" };
}
