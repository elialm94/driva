/**
 * LLM-leverantör via OpenAI-kompatibel Chat Completions (OpenAI, OpenRouter, m.fl.).
 *
 * Env:
 *   AI_PROVIDER   openai-compatible (standard)
 *   AI_MODEL      t.ex. gpt-4.1-mini  (billig standard)
 *   AI_API_KEY    krävs för LLM; saknas den används regelbaserad fallback
 *   AI_BASE_URL   t.ex. https://api.openai.com/v1 eller https://openrouter.ai/api/v1
 *
 * Utan nyckel låtsas vi inte vara en LLM – se `isAiConfigured`.
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

export type ChatWithToolsResult = {
  content: string | null;
  toolCalls: AiToolCall[];
};

export function aiConfig() {
  const key = process.env.AI_API_KEY?.trim() ?? "";
  return {
    provider: (process.env.AI_PROVIDER?.trim() || "openai-compatible").toLowerCase(),
    // gpt-4.1-mini är ett billigt OpenAI-kompatibelt val 2026. På OpenRouter: openai/gpt-4.1-mini
    model: process.env.AI_MODEL?.trim() || "gpt-4.1-mini",
    apiKey: key,
    baseUrl: (process.env.AI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, ""),
  };
}

export function isAiConfigured(): boolean {
  const { apiKey, provider } = aiConfig();
  if (provider === "none" || provider === "off" || provider === "rules") return false;
  return apiKey.length > 0;
}

export async function chatWithTools(input: {
  messages: AiChatMessage[];
  tools: AiToolDef[];
  timeoutMs?: number;
}): Promise<ChatWithToolsResult> {
  const { model, apiKey, baseUrl } = aiConfig();
  if (!apiKey) throw new Error("AI_API_KEY saknas");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), input.timeoutMs ?? 45_000);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: input.messages,
        tools: input.tools,
        tool_choice: "auto",
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LLM-anrop misslyckades (${res.status}): ${body.slice(0, 280)}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: AiToolCall[] } }[];
    };
    const message = json.choices?.[0]?.message;
    return {
      content: message?.content ?? null,
      toolCalls: message?.tool_calls ?? [],
    };
  } finally {
    clearTimeout(t);
  }
}
