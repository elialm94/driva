/**
 * Efterarbete för en inkommen orderbekräftelse: AI-fallback när den
 * deterministiska tolkningen inte hittade några rader. Körs EFTER att
 * webhooksvaret skickats (next/server `after`) i en egen tenantkörning, så
 * att LLM-anropet aldrig blockerar eller påverkar själva mottagningen.
 *
 * Idempotent: bara bekräftelser utan rader berikas, och resultatet är alltid
 * "kontrollera" – ingenting skickas, bokförs eller kopplas automatiskt.
 */
import { withPublicBusiness } from "../auth/session";
import { isSupabaseMode } from "../storage/config";
import { getInboxMail } from "../services/inbox";
import { enrichConfirmationWithAi } from "../services/purchase-order-confirmations";

export async function followUpInboundConfirmation(slug: string, itemId: string): Promise<void> {
  const run = async () => {
    const item = getInboxMail(itemId);
    if (!item || item.documentType !== "orderbekraftelse" || !item.purchaseOrderConfirmationId) return;
    await enrichConfirmationWithAi(item.purchaseOrderConfirmationId);
  };
  try {
    if (!isSupabaseMode()) {
      await run();
      return;
    }
    await withPublicBusiness("inbound", slug, run, { retry: false });
  } catch (e) {
    // Bäst-ansträngning: posten står kvar som "kontrollera" utan AI-kandidater.
    console.error("[inbox] AI-fallback för orderbekräftelse misslyckades:", e instanceof Error ? e.message : e);
  }
}
