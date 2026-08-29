"use server";

import { withBusiness } from "@/lib/auth/session";
import { improveRichText, type ImproveRichTextResult, type RichTextAiActionId } from "@/lib/ai/improve-text";

/**
 * Server action för "Förbättra med AI" i rik text-fältet ("Övrig information").
 *
 * Medvetet ETT dedikerat, verktygslöst AI-anrop – registreras ALDRIG i
 * assistentens verktygsregister. Modellen får bara fältets egen text, inga
 * affärsdata. Svaret parsas deterministiskt och vitlistesaneras i
 * improveRichText. Klienten skriver in förslaget som ett vanligt
 * editor-historiksteg (ett Cmd/Ctrl+Z ångrar).
 */
export async function improveRichTextAction(
  actionId: RichTextAiActionId,
  doc: unknown
): Promise<ImproveRichTextResult> {
  // retry: false – ett LLM-anrop är en extern sidoeffekt och får inte köras om
  // av en samtidighetskonflikt (usage-loggen skrivs i samma transaktion).
  return withBusiness(() => improveRichText({ actionId, doc }), { retry: false });
}
