/**
 * LLM-abstraktion för kommandofältet: EN integrationspunkt där en framtida
 * modell (OpenAI/OpenRouter via ai/provider.ts) kan tolka fri text till ett
 * verktygsanrop ur samma registret som allt annat.
 *
 * Utan konfiguration används NoopAiIntentProvider som ÄRLIGT svarar
 * "not_configured" – ett typat resultat, aldrig ett fejkat modellsvar.
 *
 * Env (valfria – appen fungerar fullt ut utan dem):
 *   AI_PROVIDER=openrouter + OPENROUTER_API_KEY → OpenRouterAiIntentProvider
 *     med serverside verktygsloop (AI_MODEL_FAST/AI_MODEL_SMART, se provider.ts)
 *   AI_PROVIDER=openai-compatible + AI_API_KEY/AI_BASE_URL → äldre ett-stegs-tolkning
 *   Ingen nyckel → NoopAiIntentProvider ("not_configured", aldrig fejk)
 */

import type { AssistantCard } from "../types";
import { aiConfig, chatWithTools, isAiConfigured, type AiToolDef } from "./provider";
import { runAiCommandLoop, type LoopTurn } from "./loop";

export interface IntentContext {
  /** Dagens datum (ISO, YYYY-MM-DD) så modellen kan tolka relativa datum. */
  today: string;
  locale: "sv";
  /** Senaste utbytet i fältet (kompakt) – lättviktig fleragskontext, ingen historik. */
  turns?: LoopTurn[];
  executeOptions?: import("./tools").ExecuteToolOptions;
}

export type IntentResult =
  /** Ingen LLM konfigurerad – anroparen visar den ärliga fallbacktexten. */
  | { kind: "not_configured" }
  /** Modellen svarade utan att kunna välja verktyg. */
  | { kind: "none" }
  /** Modellen valde ett verktyg ur registret. Exekvering sker hos anroparen. */
  | { kind: "tool_call"; tool: string; args: Record<string, unknown> }
  /** Rent textsvar från modellen (ingen åtgärd). */
  | { kind: "answer"; text: string }
  /** Hela verktygsloopen kördes serverside – färdigt resultat med ev. kort. */
  | { kind: "final"; ok: boolean; text: string; card?: AssistantCard; requiresConfirmation?: boolean; undo?: { kind: "dismiss_reminder"; id: string } }
  /** Transportfel (nere/timeout/429/ogiltigt svar) – ärligt besked, inga påhitt. */
  | { kind: "unavailable"; text: string };

export interface AiIntentProvider {
  readonly name: string;
  interpret(input: string, availableTools: AiToolDef[], context: IntentContext): Promise<IntentResult>;
}

/** Ärlig noll-leverantör: ingen modell finns, så vi säger det – typat. */
export class NoopAiIntentProvider implements AiIntentProvider {
  readonly name = "noop";
  async interpret(): Promise<IntentResult> {
    return { kind: "not_configured" };
  }
}

/**
 * OpenAI-kompatibel tolkning via befintliga ai/provider.ts (Chat Completions
 * med tool calling). Ett varv, ett verktygsval – exekveringen görs av
 * anroparen via samma executeTool som resten av produkten.
 */
export class OpenAiCompatibleIntentProvider implements AiIntentProvider {
  readonly name = "openai-compatible";

  async interpret(input: string, availableTools: AiToolDef[], context: IntentContext): Promise<IntentResult> {
    const result = await chatWithTools({
      messages: [
        {
          role: "system",
          content:
            `Du tolkar korta svenska kommandon i ett hantverkar-ekonomisystem. Idag är ${context.today}. ` +
            "Välj i första hand ETT verktyg som utför det användaren ber om. Hitta aldrig på belopp, " +
            "personnummer eller kunder. Om inget verktyg passar: svara kort på svenska vad du inte kan göra.",
        },
        { role: "user", content: input },
      ],
      tools: availableTools,
    });

    const call = result.toolCalls[0];
    if (call) {
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(call.function.arguments || "{}");
        if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
      } catch {
        args = {};
      }
      return { kind: "tool_call", tool: call.function.name, args };
    }
    const text = result.content?.trim();
    if (text) return { kind: "answer", text };
    return { kind: "none" };
  }
}

/**
 * OpenRouter med serverside verktygsloop: modellen kan söka kund, läsa
 * fakturerbara uppdrag och skapa utkast i flera steg – allt genom samma
 * executeTool som kommandofältet, med riskklasser och validering upprätthållna
 * i registret. Bekräftelsekort stoppar alltid loopen.
 */
export class OpenRouterAiIntentProvider implements AiIntentProvider {
  readonly name = "openrouter";

  async interpret(input: string, availableTools: AiToolDef[], context: IntentContext): Promise<IntentResult> {
    const result = await runAiCommandLoop(input, availableTools, {
      today: context.today,
      turns: context.turns,
      executeOptions: context.executeOptions,
    });
    if (result.unavailable) return { kind: "unavailable", text: result.text };
    return {
      kind: "final",
      ok: result.ok,
      text: result.text,
      card: result.card,
      requiresConfirmation: result.requiresConfirmation,
      undo: result.undo,
    };
  }
}

/** Aktiv leverantör utifrån miljön. Utan nyckel: Noop – inget fejkas. */
export function getAiIntentProvider(): AiIntentProvider {
  if (!isAiConfigured()) return new NoopAiIntentProvider();
  return aiConfig().provider === "openrouter" ? new OpenRouterAiIntentProvider() : new OpenAiCompatibleIntentProvider();
}
