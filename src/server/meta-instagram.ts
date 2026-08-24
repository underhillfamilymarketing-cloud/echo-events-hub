import { syncPoolEvents } from "./pool-event-sync";

const DEFAULT_INSTAGRAM_APP_ID = "1707908973581917";
const DEFAULT_REDIRECT_URI = "https://events.echomarketing.agency/api/meta/instagram/callback";
const GRAPH_VERSION = "v25.0";

type MetaRuntimeEnv = {
  META_INSTAGRAM_APP_ID?: string;
  META_INSTAGRAM_APP_SECRET?: string;
  META_INSTAGRAM_REDIRECT_URI?: string;
  META_INSTAGRAM_ACCESS_TOKEN?: string;
  META_INSTAGRAM_USER_ID?: string;
};

type InstagramMedia = {
  id?: string;
  caption?: string;
  media_type?: string;
  permalink?: string;
  timestamp?: string;
  media_url?: string;
  thumbnail_url?: string;
};

type InstagramCollection = {
  data?: InstagramMedia[];
  paging?: { next?: string };
};

function runtimeValue(env: MetaRuntimeEnv, key: keyof MetaRuntimeEnv): string | undefined {
  return env[key] ?? process.env[key];
}

function getConfig(env: MetaRuntimeEnv) {
  return {
    appId: runtimeValue(env, "META_INSTAGRAM_APP_ID") ?? DEFAULT_INSTAGRAM_APP_ID,
    appSecret: runtimeValue(env, "META_INSTAGRAM_APP_SECRET"),
    redirectUri: runtimeValue(env, "META_INSTAGRAM_REDIRECT_URI") ?? DEFAULT_REDIRECT_URI,
    accessToken: runtimeValue(env, "META_INSTAGRAM_ACCESS_TOKEN"),
    userId: runtimeValue(env, "META_INSTAGRAM_USER_ID"),
  };
}

function htmlPage(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#0b0d12;color:#f5f7fb;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}main{max-width:560px;border:1px solid #2a303c;border-radius:18px;padding:28px;background:#141821;box-shadow:0 20px 60px #0006}h1{font-size:24px;margin:0 0 12px}p{color:#aab2c0;line-height:1.55}a{color:#8ab4ff}</style></head><body><main><h1>${title}</h1><p>${body}</p><p><a href="/">Повернутися до календаря</a></p></main></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export function handleInstagramConnect(request: Request, env: MetaRuntimeEnv): Response {
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const config = getConfig(env);
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic");
  return Response.redirect(url.toString(), 302);
}

export async function handleInstagramCallback(
  request: Request,
  env: MetaRuntimeEnv,
): Promise<Response> {
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    const reason = url.searchParams.get("error_message") ?? error;
    return htmlPage("Instagram не підключено", `Meta повернула відмову: ${reason}.`);
  }

  const code = url.searchParams.get("code");
  const config = getConfig(env);
  if (!code || !config.appSecret) {
    return htmlPage(
      "Потрібне завершення налаштування",
      "Callback отримав відповідь, але секрет Instagram API ще не доданий у секрети хостингу.",
    );
  }

  try {
    const tokenResponse = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.appId,
        client_secret: config.appSecret,
        grant_type: "authorization_code",
        redirect_uri: config.redirectUri,
        code,
      }),
    });
    if (!tokenResponse.ok)
      throw new Error(`Instagram token exchange returned ${tokenResponse.status}`);

    const shortLived = (await tokenResponse.json()) as { access_token?: string; user_id?: string };
    if (!shortLived.access_token || !shortLived.user_id)
      throw new Error("Instagram token response was incomplete");

    const longLivedUrl = new URL(`https://graph.instagram.com/${GRAPH_VERSION}/access_token`);
    longLivedUrl.searchParams.set("grant_type", "ig_exchange_token");
    longLivedUrl.searchParams.set("client_secret", config.appSecret);
    longLivedUrl.searchParams.set("access_token", shortLived.access_token);
    const longLivedResponse = await fetch(longLivedUrl);
    if (!longLivedResponse.ok)
      throw new Error(`Instagram long-lived token exchange returned ${longLivedResponse.status}`);

    const longLived = (await longLivedResponse.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!longLived.access_token)
      throw new Error("Instagram long-lived token response was incomplete");

    return htmlPage(
      "Instagram підключено",
      `Акаунт ${shortLived.user_id} авторизований для читання. Тепер додайте отриманий довготривалий токен до секрету META_INSTAGRAM_ACCESS_TOKEN і ID ${shortLived.user_id} до META_INSTAGRAM_USER_ID у хостингу. Термін дії токена: приблизно ${Math.round((longLived.expires_in ?? 0) / 86400)} днів.`,
    );
  } catch (callbackError) {
    console.warn("[meta-instagram] callback failed", callbackError);
    return htmlPage(
      "Instagram не підключено",
      "Meta не дозволила завершити обмін токена. Перевірте, що акаунт доданий як тестувальник Instagram API і що redirect URL збігається один в один.",
    );
  }
}

async function fetchInstagramCollection(
  url: string,
  accessToken: string,
  limit = 5,
): Promise<InstagramMedia[]> {
  const events: InstagramMedia[] = [];
  let nextUrl: string | undefined = url;
  for (let page = 0; nextUrl && page < limit; page += 1) {
    const response = await fetch(nextUrl, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Instagram Graph returned ${response.status}`);
    const payload = (await response.json()) as InstagramCollection;
    events.push(...(payload.data ?? []));
    nextUrl = payload.paging?.next;
  }
  return events;
}

export async function syncInstagramEvents(env: MetaRuntimeEnv) {
  const config = getConfig(env);
  if (!config.accessToken) {
    return { configured: false, media: 0, stories: 0, result: await syncPoolEvents() };
  }

  const userId = config.userId ?? (await fetchInstagramMe(config.accessToken));
  const fields = "id,caption,media_type,permalink,timestamp,media_url,thumbnail_url";
  const mediaUrl = `https://graph.instagram.com/${GRAPH_VERSION}/${userId}/media?fields=${fields}&limit=100`;
  const storiesUrl = `https://graph.instagram.com/${GRAPH_VERSION}/${userId}/stories?fields=${fields}&limit=100`;
  const [media, stories] = await Promise.all([
    fetchInstagramCollection(
      `${mediaUrl}&access_token=${encodeURIComponent(config.accessToken)}`,
      config.accessToken,
    ),
    fetchInstagramCollection(
      `${storiesUrl}&access_token=${encodeURIComponent(config.accessToken)}`,
      config.accessToken,
    ).catch(() => []),
  ]);

  const result = await syncPoolEvents({ instagramMedia: media, instagramStories: stories });
  return { configured: true, media: media.length, stories: stories.length, result };
}

async function fetchInstagramMe(accessToken: string): Promise<string> {
  const url = `https://graph.instagram.com/${GRAPH_VERSION}/me?fields=id&access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Instagram profile lookup returned ${response.status}`);
  const payload = (await response.json()) as { id?: string };
  if (!payload.id) throw new Error("Instagram profile response did not include an ID");
  return payload.id;
}
