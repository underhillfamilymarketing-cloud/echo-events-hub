import {
  createEventRecord,
  findEventByProjectLink,
  listEventsByProjectDate,
  updateEventRecord,
} from "./events-store";
import type { RuntimeEnv } from "./runtime-env";

const POOL_HOME_URL = "https://pool.if.ua/";
const POOL_INSTAGRAM_URL = "https://www.instagram.com/pool_cruce_de_mares/";
const POOL_KASA_URL = "https://kasa.com.ua/pool_cruce_de_mares-t2215162786";
const POOL_ONECLIX_URL = "https://tickets.oneclix.com/ivano-frankivsk";
const POOL_LOCATION = "POOL Cruce de Mares, вул. Миру, 60, Драгомирчани";
const SYNC_COOLDOWN_MS = 15 * 60 * 1000;

let lastSyncAt = 0;
let activeSync: Promise<PoolSyncResult> | undefined;

export type PoolSyncResult = {
  source: string;
  scanned: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
};

type ParsedEvent = {
  title: string;
  event_date: string;
  event_time: string | null;
  location: string;
  description: string | null;
  link: string;
  source: "official" | "instagram" | "ticketing" | "meta";
};

export type InstagramMediaCandidate = {
  caption?: string;
  permalink?: string;
  timestamp?: string;
};

type PoolSyncSources = {
  instagramMedia?: InstagramMediaCandidate[];
  instagramStories?: InstagramMediaCandidate[];
};

type ExistingEvent = {
  id: string;
  title: string;
  event_date: string;
  event_time: string | null;
  location: string | null;
  description: string | null;
  link: string | null;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&#038;|&#x26;/gi, "&")
    .replace(/&#8212;|&#x2014;/gi, "—")
    .replace(/&#8211;|&#x2013;/gi, "–")
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function stripMarkup(value: string): string {
  return decodeHtml(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseStoredTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.match(/^\d{2}:\d{2}/)?.[0] ?? value;
}

function currentYear(): string {
  return String(new Date().getUTCFullYear());
}

function firstMatch(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match?.[1] ? decodeHtml(match[1]).trim() : null;
}

function metaContent(html: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escapedName}["'][^>]+content=["']([^"']*)`, "i"),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escapedName}["']`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]).trim();
  }
  return null;
}

function extractEventLinks(homeHtml: string): string[] {
  const links = new Set<string>();
  const pattern = /href=["'](https:\/\/pool\.if\.ua\/fat-event\/[^"'#?]+\/?)["']/gi;
  for (const match of homeHtml.matchAll(pattern)) links.add(match[1]);
  return [...links];
}

function parseEventPage(html: string, link: string): ParsedEvent | null {
  const title =
    firstMatch(html, /<div class=["']fat-event-popup-title["'][^>]*>([\s\S]*?)<\/div>/i) ??
    firstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
  const timeLine = stripMarkup(
    firstMatch(html, /<div class=["']fat-event-popup-time["'][^>]*>([\s\S]*?)<\/div>/i) ?? "",
  );
  const content = firstMatch(
    html,
    /<div class=["']fat-event-single-content["'][^>]*>([\s\S]*?)<\/div>/i,
  );
  const timeMatch = timeLine.match(
    /(\d{1,2}:\d{2})\s*(?:до\s*(\d{1,2}:\d{2}))?\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/i,
  );

  if (!title || !timeMatch) return null;

  const [, startTime, endTime, day, month, year] = timeMatch;
  const description = stripMarkup(content ?? "");
  const withEndTime = endTime
    ? `${description}${description ? " " : ""}Час завершення за офіційною афішею: ${endTime}.`
    : description;

  return {
    title: stripMarkup(title),
    event_date: `${year}-${month}-${day}`,
    event_time: startTime.padStart(5, "0"),
    location: POOL_LOCATION,
    description: withEndTime || null,
    link,
    source: "official",
  };
}

function parseInstagramBioEvents(html: string): ParsedEvent[] {
  const bio = metaContent(html, "description");
  if (!bio) return [];

  const events: ParsedEvent[] = [];
  const year = currentYear();
  const pattern = /(?:^|\n)[^\d\n]{0,12}(\d{1,2})[./](\d{1,2})\s*\|\s*([^\n]+)/g;
  for (const match of bio.matchAll(pattern)) {
    const [, day, month, rawTitle] = match;
    const title = stripMarkup(rawTitle)
      .replace(/\s+(?:📍|Купуй|Купуйте|https?:).*/u, "")
      .trim();
    if (!title || title.length < 3) continue;

    const eventDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    events.push({
      title,
      event_date: eventDate,
      event_time: null,
      location: POOL_LOCATION,
      description: `Знайдено в актуальному описі Instagram @pool_cruce_de_mares. Час у джерелі не вказаний.`,
      link: `${POOL_INSTAGRAM_URL}#event-${eventDate}`,
      source: "instagram",
    });
  }
  return events;
}

function parseMetaCaptionEvent(candidate: InstagramMediaCandidate): ParsedEvent | null {
  const caption = candidate.caption?.trim();
  if (!caption) return null;

  const dateMatch = caption.match(/(?:^|\s)(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?(?=\s|$|\|)/u);
  if (!dateMatch) return null;
  const year = dateMatch[3] ?? currentYear();
  if (year !== currentYear()) return null;

  const day = dateMatch[1].padStart(2, "0");
  const month = dateMatch[2].padStart(2, "0");
  const eventDate = `${year}-${month}-${day}`;
  const timeMatch = caption.match(/(?:о|at|від|початок|start)?\s*(\d{1,2}):([0-5]\d)/iu);
  const titleLine = caption
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /\d{1,2}[./]\d{1,2}/u.test(line));
  const rawTitle = (titleLine ?? caption)
    .replace(/^[^\d\n]*\d{1,2}[./]\d{1,2}(?:[./]\d{4})?\s*/u, "")
    .replace(/^\|\s*/u, "")
    .replace(/(?:о|at|від|початок|start)?\s*\d{1,2}:[0-5]\d.*$/iu, "")
    .replace(/https?:\/\/\S+/giu, "")
    .replace(/[#@][\w.-]+/gu, "")
    .replace(/[|•]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (rawTitle.length < 3) return null;

  const link = candidate.permalink ?? `${POOL_INSTAGRAM_URL}#meta-${eventDate}`;
  return {
    title: rawTitle.slice(0, 180),
    event_date: eventDate,
    event_time: timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : null,
    location: POOL_LOCATION,
    description: `Знайдено через Instagram API у публікації Pool Cruce de Mares.${caption.length > 420 ? ` ${caption.slice(0, 420)}…` : ` ${caption}`}`,
    link,
    source: "meta",
  };
}

function parseMetaMediaEvents(candidates: InstagramMediaCandidate[]): ParsedEvent[] {
  return candidates.flatMap((candidate) => {
    const event = parseMetaCaptionEvent(candidate);
    return event ? [event] : [];
  });
}

function parseKasaEvents(html: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const pattern =
    /<a href=["'](https:\/\/kasa\.com\.ua\/[^"']+)["'][\s\S]{0,900}?<h3>([\s\S]*?)<\/h3>[\s\S]{0,1800}?<span>\s*POOL Cruce de Mares\s*<\/span>[\s\S]{0,900}?(\d{4})\.(\d{2})\.(\d{2})[\s\S]{0,500}?<span>\s*Время начала\s*<\/span>\s*(\d{1,2}:\d{2})/gi;

  for (const match of html.matchAll(pattern)) {
    const [, link, rawTitle, year, month, day, startTime] = match;
    if (year !== currentYear()) continue;
    events.push({
      title: stripMarkup(rawTitle),
      event_date: `${year}-${month}-${day}`,
      event_time: startTime.padStart(5, "0"),
      location: POOL_LOCATION,
      description: "Знайдено в афіші Kasa.com.ua для майданчика Pool Cruce de Mares.",
      link,
      source: "ticketing",
    });
  }
  return events;
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
  }
}

function localDateTimeParts(value: string): { date: string; time: string } | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!values.year || !values.month || !values.day || !values.hour || !values.minute) return null;
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function parseOneClixEvents(html: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const pattern =
    /\\\x22id\\\x22:\\\x22[^\x22]+\\\x22,\\\x22name\\\x22:\\\x22([^\x22]+)\\\x22,\\\x22event_type\\\x22:\\\x22[^\x22]*\\\x22,\\\x22event_slug\\\x22:\\\x22([^\x22]+)\\\x22[\s\S]{0,900}?\\\x22start_time\\\x22:\\\x22([^\x22]+)\\\x22[\s\S]{0,1200}?\\\x22location\\\x22:\{[\s\S]{0,500}?\\\x22name\\\x22:\\\x22POOL Cruce de Mares\\\x22/g;

  for (const match of html.matchAll(pattern)) {
    const [, rawTitle, slug, startTime] = match;
    const dateTime = localDateTimeParts(startTime);
    if (!dateTime || !dateTime.date.startsWith(`${currentYear()}-`)) continue;
    events.push({
      title: stripMarkup(decodeJsonString(rawTitle)),
      event_date: dateTime.date,
      event_time: dateTime.time,
      location: POOL_LOCATION,
      description: "Знайдено у відкритій афіші OneClix для POOL Cruce de Mares.",
      link: `https://tickets.oneclix.com/concert/${decodeJsonString(slug)}`,
      source: "ticketing",
    });
  }
  return events;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": "ECHO Events Hub Pool Sync/1.0" },
  });
  if (!response.ok) throw new Error(`Pool source returned ${response.status} for ${url}`);
  return response.text();
}

function normaliseTitle(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .split(/[^a-zа-яіїєґ0-9]+/giu)
      .filter(Boolean),
  );
}

function isLikelySameEvent(left: string, right: string): boolean {
  const leftTokens = normaliseTitle(left);
  const rightTokens = normaliseTitle(right);
  if (leftTokens.size < 2 || rightTokens.size < 2) return false;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap >= Math.max(2, Math.ceil(Math.min(leftTokens.size, rightTokens.size) * 0.5));
}

async function findExistingEvent(
  env: RuntimeEnv,
  event: ParsedEvent,
): Promise<ExistingEvent | null> {
  const exact = await findEventByProjectLink(env, "pool", event.link);
  if (exact) return exact;

  const sameDate = await listEventsByProjectDate(env, "pool", event.event_date);
  return sameDate.find((candidate) => isLikelySameEvent(candidate.title, event.title)) ?? null;
}

function mergeSocialEvent(existing: ExistingEvent | null, event: ParsedEvent) {
  if (!existing || existing.link === event.link) return event;
  const replaceSyntheticLink =
    existing.link?.includes("instagram.com/pool_cruce_de_mares/#event-") ||
    existing.link?.includes("instagram.com/pool_cruce_de_mares/#meta-");
  return {
    ...event,
    title: existing.title.length >= event.title.length ? existing.title : event.title,
    event_time: existing.event_time ?? event.event_time,
    location: existing.location ?? event.location,
    description: existing.description ?? event.description,
    link: replaceSyntheticLink ? event.link : (existing.link ?? event.link),
  };
}

async function syncOneEvent(env: RuntimeEnv, event: ParsedEvent, result: PoolSyncResult) {
  const existing = await findExistingEvent(env, event);
  if (!existing) {
    const { source: _source, ...row } = event;
    await createEventRecord(env, { ...row, project: "pool" }, { createdVia: "pool_sync" });
    result.inserted += 1;
    return;
  }

  const update = mergeSocialEvent(existing, event);
  const changed =
    existing.title !== update.title ||
    existing.event_date !== update.event_date ||
    normaliseStoredTime(existing.event_time) !== update.event_time ||
    existing.location !== update.location ||
    existing.description !== update.description ||
    existing.link !== update.link;
  if (!changed) {
    result.unchanged += 1;
    return;
  }

  const { source: _source, ...row } = update;
  await updateEventRecord(env, existing.id, { ...row, project: "pool" });
  result.updated += 1;
}

async function performSync(
  env: RuntimeEnv,
  sources: PoolSyncSources = {},
): Promise<PoolSyncResult> {
  const result: PoolSyncResult = {
    source: `${POOL_HOME_URL} + Instagram + Kasa + OneClix${sources.instagramMedia ? " + Meta API" : ""}`,
    scanned: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
  };

  const candidates: ParsedEvent[] = [];
  try {
    const homeHtml = await fetchText(POOL_HOME_URL);
    const links = extractEventLinks(homeHtml);
    result.scanned += links.length;
    for (const link of links) {
      try {
        const event = parseEventPage(await fetchText(link), link);
        if (event) candidates.push(event);
        else result.skipped += 1;
      } catch {
        result.skipped += 1;
      }
    }
  } catch {
    result.skipped += 1;
  }

  const metaEvents = parseMetaMediaEvents([
    ...(sources.instagramMedia ?? []),
    ...(sources.instagramStories ?? []),
  ]);
  result.scanned += (sources.instagramMedia?.length ?? 0) + (sources.instagramStories?.length ?? 0);
  result.skipped +=
    (sources.instagramMedia?.length ?? 0) +
    (sources.instagramStories?.length ?? 0) -
    metaEvents.length;
  candidates.push(...metaEvents);

  try {
    const instagramEvents = parseInstagramBioEvents(await fetchText(POOL_INSTAGRAM_URL));
    result.scanned += instagramEvents.length;
    candidates.push(...instagramEvents);
  } catch {
    result.skipped += 1;
  }

  try {
    const kasaEvents = parseKasaEvents(await fetchText(POOL_KASA_URL));
    result.scanned += kasaEvents.length;
    candidates.push(...kasaEvents);
  } catch {
    result.skipped += 1;
  }

  try {
    const oneClixEvents = parseOneClixEvents(await fetchText(POOL_ONECLIX_URL));
    result.scanned += oneClixEvents.length;
    candidates.push(...oneClixEvents);
  } catch {
    result.skipped += 1;
  }

  for (const event of candidates) {
    if (!event.event_date.startsWith(`${currentYear()}-`)) {
      result.skipped += 1;
      continue;
    }
    await syncOneEvent(env, event, result);
  }

  lastSyncAt = Date.now();
  return result;
}

export function syncPoolEvents(
  sources: PoolSyncSources = {},
  env: RuntimeEnv = {},
): Promise<PoolSyncResult> {
  if (activeSync) return activeSync;
  if (Date.now() - lastSyncAt < SYNC_COOLDOWN_MS) {
    return Promise.resolve({
      source: POOL_HOME_URL,
      scanned: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
    });
  }

  activeSync = performSync(env, sources).finally(() => {
    activeSync = undefined;
  });
  return activeSync;
}
