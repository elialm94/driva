/**
 * LLM-transport via OpenAI-kompatibel Chat Completions.
 *
 * Primär leverantör: OpenRouter (AI_PROVIDER=openrouter + OPENROUTER_API_KEY).
 * Generisk OpenAI-kompatibel väg finns kvar via AI_API_KEY/AI_BASE_URL.
 *
 * Env (alla valfria – utan nyckel är appen fullt fungerande, se isAiConfigured):
 *   AI_PROVIDER           openrouter | openai-compatible | none/off/rules
 *   OPENROUTER_API_KEY    nyckel för openrouter (endast serversidan)
 *   AI_MODEL_FAST         standard: google/gemini-3.7-flash (billig, snabb, strikt tool calling)
 *   AI_MODEL_SMART        standard: openai/gpt-5.6-terra (djupare fleragsresonemang)
 *   AI_MAX_TOOL_STEPS     max verktygssteg per fråga (standard 6)
 *   AI_MAX_OUTPUT_TOKENS  svarstak per anrop (standard 700)
 *   AI_MODEL / AI_API_KEY / AI_BASE_URL   äldre generisk väg (fungerar som förut)
 *
 * Nyckeln loggas aldrig och lämnar aldrig servern mot något annat än basadressen.
 */

export type AiRoleMessage = { role: "system" | "user" | "assistant"; content: string };

export type AiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type AiAssistantToolMessage = {
  role: "assistant";
  content: string | null;
  tool_calls: AiToolCall[];
};

export type AiToolResultMessage = {
  role: "tool";
  tool_call_id: string;
  content: string;
};

export type AiChatMessage = AiRoleMessage | AiAssistantToolMessage | AiToolResultMessage;

export type AiToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AiUsage = { inputTokens: number; outputTokens: number };

export type ChatWithToolsResult = {
  content: string | null;
  toolCalls: AiToolCall[];
  usage: AiUsage;
  model: string;
};

/** Fel från transporten – statuskod med så att anroparen kan svara ärligt. */
export class AiTransportError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AiTransportError";
  }
}

export const DEFAULT_MODEL_FAST = "google/gemini-3.7-flash";
export const DEFAULT_MODEL_SMART = "openai/gpt-5.6-terra";
const DEFAULT_TIMEOUT_MS = 25_000;

/** USD per miljon tokens (in, ut) för kostnadsuppskattning i användningsloggen. */
const PRICE_PER_MILLION_USD: Record<string, [number, number]> = {
  "google/gemini-3.7-flash": [0.375, 1.875],
  "google/gemini-3.5-flash-lite": [0.3, 2.5],
  "openai/gpt-5.6-luna": [0.2, 1.2],
  "openai/gpt-5.6-terra": [2, 12],
};

export function estimateCostUsd(model: string, usage: AiUsage): number | null {
  const price = PRICE_PER_MILLION_USD[model];
  if (!price) return null;
  return (usage.inputTokens * price[0] + usage.outputTokens * price[1]) / 1_000_000;
}

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]?.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function aiConfig() {
  const provider = (process.env.AI_PROVIDER?.trim() || "openai-compatible").toLowerCase();
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  const genericKey = process.env.AI_API_KEY?.trim() ?? "";
  const isOpenRouter = provider === "openrouter";
  const legacyModel = process.env.AI_MODEL?.trim();
  return {
    provider,
    apiKey: isOpenRouter ? openRouterKey : genericKey,
    baseUrl: (
      process.env.AI_BASE_URL?.trim() ||
      (isOpenRouter ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1")
    ).replace(/\/$/, ""),
    modelFast: process.env.AI_MODEL_FAST?.trim() || legacyModel || DEFAULT_MODEL_FAST,
    modelSmart:
      process.env.AI_MODEL_SMART?.trim() || process.env.AI_MODEL_FAST?.trim() || legacyModel || DEFAULT_MODEL_SMART,
    maxToolSteps: intEnv("AI_MAX_TOOL_STEPS", 6),
    maxOutputTokens: intEnv("AI_MAX_OUTPUT_TOKENS", 700),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

export function isAiConfigured(): boolean {
  const { apiKey, provider } = aiConfig();
  if (provider === "none" || provider === "off" || provider === "rules") return false;
  return apiKey.length > 0;
}

/* ------------------------- Transport (testbar) ------------------------- */

type AiFetch = (url: string, init: RequestInit) => Promise<Response>;

let transport: AiFetch = (url, init) => fetch(url, init);

/** Endast för tester: byt HTTP-transporten (mock av OpenRouter-svar). */
export function __setAiTransportForTests(fn: AiFetch | null) {
  transport = fn ?? ((url, init) => fetch(url, init));
}

export async function chatWithTools(input: {
  messages: AiChatMessage[];
  tools: AiToolDef[];
  model?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<ChatWithToolsResult> {
  const cfg = aiConfig();
  if (!cfg.apiKey) throw new AiTransportError("AI-nyckel saknas");
  const model = input.model ?? cfg.modelFast;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), input.timeoutMs ?? cfg.timeoutMs);
  try {
    const res = await transport(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        // OpenRouter-attribution (valfritt, ofarligt för andra leverantörer).
        "X-Title": "Driva",
      },
      body: JSON.stringify({
        model,
        messages: input.messages,
        // Tom verktygslista utelämnas helt: OpenAI-kompatibla API:er avvisar
        // tools: [] och anrop utan verktyg (t.ex. textförbättring) ska inte
        // ens antyda tool calling.
        ...(input.tools.length > 0 ? { tools: input.tools, tool_choice: "auto" } : {}),
        temperature: 0.2,
        max_tokens: input.maxOutputTokens ?? cfg.maxOutputTokens,
      }),
    });
    if (!res.ok) {
      // Aldrig svarskroppen i felmeddelandet rakt av mot användaren – anroparen
      // visar en ärlig, generisk text. Statusen behövs för logg/diagnos.
      const body = await res.text().catch(() => "");
      throw new AiTransportError(`LLM-anrop misslyckades (${res.status}): ${body.slice(0, 200)}`, res.status);
    }
    const json = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string | null; tool_calls?: AiToolCall[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    } | null;
    const message = json?.choices?.[0]?.message;
    if (!json || !message) throw new AiTransportError("Ogiltigt svar från LLM-leverantören");
    return {
      content: message.content ?? null,
      toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
      model: json.model ?? model,
    };
  } catch (e) {
    if (e instanceof AiTransportError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new AiTransportError("LLM-anropet tog för lång tid");
    throw new AiTransportError(e instanceof Error ? e.message : "Okänt transportfel");
  } finally {
    clearTimeout(t);
  }
}
