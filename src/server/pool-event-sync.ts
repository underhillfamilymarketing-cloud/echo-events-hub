import { supabase } from "@/integrations/supabase/client";

const POOL_HOME_URL = "https://pool.if.ua/";
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
  event_time: string;
  location: string;
  description: string | null;
  link: string;
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

function firstMatch(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match?.[1] ? decodeHtml(match[1]).trim() : null;
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
  };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": "ECHO Events Hub Pool Sync/1.0" },
  });
  if (!response.ok) throw new Error(`Pool source returned ${response.status} for ${url}`);
  return response.text();
}

async function performSync(): Promise<PoolSyncResult> {
  const homeHtml = await fetchText(POOL_HOME_URL);
  const links = extractEventLinks(homeHtml);
  const result: PoolSyncResult = {
    source: POOL_HOME_URL,
    scanned: links.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
  };

  for (const link of links) {
    const html = await fetchText(link);
    const event = parseEventPage(html, link);
    if (!event || !event.event_date.startsWith("2026-")) {
      result.skipped += 1;
      continue;
    }

    const { data: existing, error: lookupError } = await supabase
      .from("events")
      .select("id,title,event_date,event_time,location,description,link")
      .eq("project", "pool")
      .eq("link", event.link)
      .maybeSingle();
    if (lookupError) throw lookupError;

    if (!existing) {
      const { error } = await supabase.from("events").insert({ ...event, project: "pool" });
      if (error) throw error;
      result.inserted += 1;
      continue;
    }

    const changed =
      existing.title !== event.title ||
      existing.event_date !== event.event_date ||
      normaliseStoredTime(existing.event_time) !== event.event_time ||
      existing.location !== event.location ||
      existing.description !== event.description;
    if (!changed) {
      result.unchanged += 1;
      continue;
    }

    const { error } = await supabase.from("events").update(event).eq("id", existing.id);
    if (error) throw error;
    result.updated += 1;
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
