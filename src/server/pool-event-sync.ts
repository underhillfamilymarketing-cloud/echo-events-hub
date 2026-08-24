import { supabase } from "@/integrations/supabase/client";

const POOL_HOME_URL = "https://pool.if.ua/";
const POOL_INSTAGRAM_URL = "https://www.instagram.com/pool_cruce_de_mares/";
const POOL_KASA_URL = "https://kasa.com.ua/pool_cruce_de_mares-t2215162786";
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
  source: "official" | "instagram" | "ticketing";
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

async function findExistingEvent(event: ParsedEvent) {
  const { data: exact, error: exactError } = await supabase
    .from("events")
    .select("id,title,event_date,event_time,location,description,link")
    .eq("project", "pool")
    .eq("link", event.link)
    .maybeSingle();
  if (exactError) throw exactError;
  if (exact) return exact;

  const { data: sameDate, error: dateError } = await supabase
    .from("events")
    .select("id,title,event_date,event_time,location,description,link")
    .eq("project", "pool")
    .eq("event_date", event.event_date);
  if (dateError) throw dateError;
  return sameDate?.find((candidate) => isLikelySameEvent(candidate.title, event.title)) ?? null;
}

function mergeSocialEvent(
  existing: Awaited<ReturnType<typeof findExistingEvent>>,
  event: ParsedEvent,
) {
  if (!existing || existing.link === event.link) return event;
  return {
    ...event,
    title: existing.title.length >= event.title.length ? existing.title : event.title,
    event_time: existing.event_time ?? event.event_time,
    location: existing.location ?? event.location,
    description: existing.description ?? event.description,
    link: existing.link ?? event.link,
  };
}

async function syncOneEvent(event: ParsedEvent, result: PoolSyncResult) {
  const existing = await findExistingEvent(event);
  if (!existing) {
    const { source: _source, ...row } = event;
    const { error } = await supabase.from("events").insert({ ...row, project: "pool" });
    if (error) throw error;
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
  const { error } = await supabase.from("events").update(row).eq("id", existing.id);
  if (error) throw error;
  result.updated += 1;
}

async function performSync(): Promise<PoolSyncResult> {
  const result: PoolSyncResult = {
    source: `${POOL_HOME_URL} + Instagram + Kasa`,
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

  for (const event of candidates) {
    if (!event.event_date.startsWith("2026-")) {
      result.skipped += 1;
      continue;
    }
    await syncOneEvent(event, result);
  }

  lastSyncAt = Date.now();
  return result;
}

export function syncPoolEvents(): Promise<PoolSyncResult> {
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

  activeSync = performSync().finally(() => {
    activeSync = undefined;
  });
  return activeSync;
}
