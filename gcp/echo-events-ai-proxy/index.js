import { http } from "@google-cloud/functions-framework";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "project-6e90d45f-5494-4a8a-a8c";
const MODEL_URL =
  "https://aiplatform.googleapis.com/v1/projects/" +
  PROJECT_ID +
  "/locations/global/publishers/google/models/gemini-2.5-flash:generateContent";

function allowed(request) {
  const expected = process.env.ECHO_EVENTS_PROXY_SECRET || "";
  const provided = request.get("x-echo-events-proxy-secret") || "";
  if (!expected || expected.length !== provided.length) return false;

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return difference === 0;
}

async function parseEvent(request, response) {
  response.set("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!allowed(request)) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const payload = request.body;
  const prompt = payload && typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!prompt || prompt.length > 12_000) {
    response.status(400).json({ error: "invalid_request" });
    return;
  }

  try {
    const metadata = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" } },
    );
    if (!metadata.ok) throw new Error("metadata token failed");
    const identity = await metadata.json();
    if (!identity || typeof identity.access_token !== "string") {
      throw new Error("metadata token missing");
    }

    const requestBody =
      '{"contents":[{"role":"user","parts":[{"text":' +
      JSON.stringify(prompt) +
      '}]}],"generationConfig":{"temperature":0,"maxOutputTokens":700,"responseMimeType":"application/json"}}';
    const model = await fetch(MODEL_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + identity.access_token,
        "Content-Type": "application/json",
      },
      body: requestBody,
    });
    if (!model.ok) {
      console.error("[echo-events-ai-proxy] model status", model.status);
      response.status(502).json({ error: "model_unavailable" });
      return;
    }

    const modelData = await model.json();
    const parts =
      modelData &&
      modelData.candidates &&
      modelData.candidates[0] &&
      modelData.candidates[0].content &&
      modelData.candidates[0].content.parts;
    const text = Array.isArray(parts)
      ? parts
          .map((part) => (typeof part.text === "string" ? part.text : ""))
          .join("")
          .trim()
      : "";
    if (!text) {
      response.status(502).json({ error: "empty_model_response" });
      return;
    }

    response.status(200).json({ text });
  } catch (error) {
    console.error(
      "[echo-events-ai-proxy] request failed",
      error instanceof Error ? error.message : "unknown",
    );
    response.status(502).json({ error: "model_unavailable" });
  }
}

http("parseEvent", parseEvent);
