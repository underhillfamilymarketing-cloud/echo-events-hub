import { ensureTelegramWebhook } from "./telegram-events-bot";
import { runtimeValue, type RuntimeEnv } from "./runtime-env";

const COOKIE_NAME = "echo_events_edit_session";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type SessionPayload = { exp: number; v: 1 };

function encodeBase64Url(value: string): string {
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function cookieValue(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const entry = header.split(";").find((part) => part.trim().startsWith(`${COOKIE_NAME}=`));
  return entry?.trim().slice(COOKIE_NAME.length + 1) ?? null;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}

function clearCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

async function makeSessionCookie(env: RuntimeEnv): Promise<string> {
  const secret = runtimeValue(env, "EVENTS_SESSION_SECRET");
  if (!secret) throw new Error("Секрет сесії редагування ще не налаштований");

  const payload = encodeBase64Url(JSON.stringify({ v: 1, exp: Date.now() + SESSION_DURATION_MS }));
  const signature = await sign(payload, secret);
  return `${COOKIE_NAME}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export async function hasEditorSession(request: Request, env: RuntimeEnv): Promise<boolean> {
  const secret = runtimeValue(env, "EVENTS_SESSION_SECRET");
  const cookie = cookieValue(request);
  if (!secret || !cookie) return false;

  const [payload, receivedSignature] = cookie.split(".");
  if (!payload || !receivedSignature) return false;
  const expectedSignature = await sign(payload, secret);
  if (receivedSignature !== expectedSignature) return false;

  const decoded = decodeBase64Url(payload);
  if (!decoded) return false;
  try {
    const session = JSON.parse(decoded) as SessionPayload;
    return session.v === 1 && Number.isFinite(session.exp) && session.exp > Date.now();
  } catch {
    return false;
  }
}

export async function handleEditorSession(request: Request, env: RuntimeEnv): Promise<Response> {
  if (request.method === "GET") {
    return Response.json({ authorized: await hasEditorSession(request, env) });
  }

  if (request.method === "DELETE") {
    if (!sameOrigin(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
    return new Response(null, { status: 204, headers: { "set-cookie": clearCookie() } });
  }

  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!sameOrigin(request)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const expectedPassword = runtimeValue(env, "EVENTS_EDIT_PASSWORD");
  if (!expectedPassword) {
    return Response.json({ error: "Редагування ще не налаштовано" }, { status: 503 });
  }

  let password: unknown;
  try {
    password = ((await request.json()) as { password?: unknown }).password;
  } catch {
    return Response.json({ error: "Некоректний запит" }, { status: 400 });
  }

  if (typeof password !== "string" || password !== expectedPassword) {
    return Response.json({ error: "Неправильний пароль" }, { status: 401 });
  }

  try {
    await ensureTelegramWebhook(env, new URL(request.url).origin);
  } catch (error) {
    console.warn("[telegram-events] webhook setup skipped", error);
  }

  return Response.json(
    { authorized: true },
    { headers: { "set-cookie": await makeSessionCookie(env) } },
  );
}

export function isSameOriginRequest(request: Request): boolean {
  return sameOrigin(request);
}
