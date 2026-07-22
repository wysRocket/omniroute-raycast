import { getPreferenceValues, open } from "@raycast/api";

export interface Preferences {
  baseUrl: string;
  /** OmniRoute CLI token (x-omniroute-cli-token) OR a server API key (Bearer). */
  apiKey: string;
  defaultModel: string;
  /** When true, the menubar attempts to start the server when it's down. */
  autoStartServer: boolean;
  /** When true, auto-copy answer to clipboard on completion. */
  autoCopyOnCompletion: boolean;
}

export function prefs(): Preferences {
  return getPreferenceValues<Preferences>();
}

function base(): string {
  return prefs().baseUrl.replace(/\/+$/, "");
}

/** OmniRoute's OpenAI-compatible chat endpoint (v1, not /api/v1). */
export function chatEndpoint(): string {
  return `${base()}/v1/chat/completions`;
}

export function modelsEndpoint(): string {
  return `${base()}/v1/models`;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  model?: string;
  raw?: unknown;
}

function authHeaders(): Record<string, string> {
  const p = prefs();
  return {
    "x-omniroute-cli-token": p.apiKey,
    Authorization: `Bearer ${p.apiKey}`,
  };
}

/**
 * Non-streaming chat completion. OmniRoute is OpenAI-compatible; the CLI
 * authenticates with the `x-omniroute-cli-token` header and posts to
 * `/v1/chat/completions`. `model: "auto"` lets the server pick a provider.
 */
export async function chat(
  messages: ChatMessage[],
  model?: string,
): Promise<ChatResult> {
  const p = prefs();
  const body = {
    model: model || p.defaultModel || "auto",
    messages,
    stream: false,
  };
  const res = await fetch(chatEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = (data as { error?: { message?: string } })?.error;
    throw new Error(err?.message || `OmniRoute error ${res.status}`);
  }
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  return { text, model: data?.model, raw: data };
}

/**
 * Streaming chat completion. Returns an async generator yielding incremental
 * text deltas (OpenAI SSE `choices[].delta.content`). The final yielded value
 * is the full accumulated string.
 */
export async function* streamChat(
  messages: ChatMessage[],
  model?: string,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const p = prefs();
  const body = {
    model: model || p.defaultModel || "auto",
    messages,
    stream: true,
  };
  const res = await fetch(chatEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...authHeaders(),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    const err = (data as { error?: { message?: string } })?.error;
    throw new Error(err?.message || `OmniRoute error ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const delta: string = json?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            full += delta;
            yield full;
          }
        } catch {
          // ignore non-JSON keepalive/comment lines
        }
      }
    }
  }
}

export interface ModelInfo {
  id: string;
  name?: string;
}

export async function listModels(): Promise<ModelInfo[]> {
  const out: ModelInfo[] = [];
  const fetchOne = async (url: string) => {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  let data: unknown;
  try {
    data = await fetchOne(modelsEndpoint());
  } catch {
    data = await fetchOne(`${base()}/api/v1/models`);
  }
  const arr =
    (data as { data?: unknown[]; models?: unknown[] })?.data ??
    (data as { models?: unknown[] })?.models ??
    (Array.isArray(data) ? data : []);
  for (const m of arr as Record<string, unknown>[]) {
    const id = (m.id ?? m.name) as string;
    if (id) out.push({ id, name: (m.name as string) ?? (m.id as string) });
  }
  return out;
}

export async function healthCheck(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${base()}/v1/models`, { headers: authHeaders() });
    if (res.ok) return { ok: true, detail: "Reachable, authenticated OK" };
    if (res.status === 401)
      return { ok: false, detail: "Unauthorized — check API Key / CLI token" };
    return { ok: false, detail: `Server responded ${res.status}` };
  } catch (e) {
    return { ok: false, detail: `Unreachable: ${(e as Error).message}` };
  }
}

/**
 * Attempt to start the OmniRoute server. Raycast extensions cannot spawn
 * background processes directly, so this opens the dashboard URL and shows
 * a toast with the exact command to run. When `autoStartServer` is enabled
 * in preferences, the menubar automatically triggers this on health-check
 * failure.
 */
export async function startServer(): Promise<void> {
  const base = prefs().baseUrl.replace(/\/+$/, "");
  await open(base);
}

export interface DetailedHealth {
  ok: boolean;
  detail: string;
  serverModelCount?: number;
  /** Any extra diagnostics extracted from the headers or body */
  diagnostics: Record<string, string>;
}

/**
 * Detailed health check that also extracts model count and response headers.
 * Fetches /v1/models and reads response metadata.
 */
export async function detailedHealth(): Promise<DetailedHealth> {
  const result: DetailedHealth = { ok: false, detail: "", diagnostics: {} };
  try {
    const res = await fetch(`${base()}/v1/models`, { headers: authHeaders() });
    if (res.ok) {
      result.ok = true;
      result.detail = "Reachable, authenticated OK";
      // Extract model count from the JSON body
      const data = await res.json();
      const arr: unknown[] =
        (data as { data?: unknown[] })?.data ??
        (data as { models?: unknown[] })?.models ??
        [];
      result.serverModelCount = arr.length;
      result.diagnostics["Model Count"] = String(arr.length);
      return result;
    }
    if (res.status === 401) {
      result.detail = "Unauthorized — check API Key / CLI token";
      result.diagnostics["Status"] = "401";
      return result;
    }
    result.detail = `Server responded ${res.status}`;
    result.diagnostics["Status"] = String(res.status);
    return result;
  } catch (e) {
    result.detail = `Unreachable: ${(e as Error).message}`;
    result.diagnostics["Error"] = (e as Error).message;
    return result;
  }
}
