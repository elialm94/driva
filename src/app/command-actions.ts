"use server";

import { revalidatePath } from "next/cache";
import { withBusiness, withBusinessRead } from "@/lib/auth/session";
import type { CommandId } from "@/lib/command-bar";
import {
  interpretFreeTextViaAi,
  invoiceTargetOptionsFor,
  quoteTopicOptionsFor,
  runBarCommand,
  sanitizeTurns,
  searchCustomersForCommand,
  type CommandEntityHit,
  type CommandRunParams,
  type CommandRunResult,
  type InvoiceTargetOption,
  type QuoteTopicOption,
} from "@/lib/services/command-bar";

/**
 * Server actions för kommandofältet. Tunna skal: auktorisering via
 * withBusiness/withBusinessRead (tenantkontext i Supabase-läget), all logik i
 * tjänstelagret. Klienten får bara begränsade, färdigformaterade rader.
 */

/** Debouncat kundsök för entitetssteget – max ~8 träffar, aldrig hela registret. */
export async function commandCustomerSearchAction(q: string): Promise<CommandEntityHit[]> {
  return withBusinessRead(() => searchCustomersForCommand(q));
}

/** Alternativ till "Vad gäller fakturan?" – fakturerbara uppdrag + fristående. */
export async function commandInvoiceTargetsAction(customerId: string): Promise<InvoiceTargetOption[]> {
  return withBusinessRead(() => invoiceTargetOptionsFor(customerId));
}

/** Alternativ till "Vad gäller offerten?" – kundens öppna förfrågningar. */
export async function commandQuoteTopicsAction(customerId: string): Promise<QuoteTopicOption[]> {
  return withBusinessRead(() => quoteTopicOptionsFor(customerId));
}

/** Kör ett kommando via verktygslagret (samma väg som assistenten). */
export async function runCommandAction(commandId: CommandId, params: CommandRunParams = {}): Promise<CommandRunResult> {
  const result = await withBusiness(() => runBarCommand(commandId, params), { retry: false });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/**
 * Fri text som deterministiska regler inte klarar. Anropas bara när en LLM är
 * konfigurerad – utan nyckel svarar klienten själv med den ärliga texten,
 * helt utan nätverk. Noop-leverantören svarar ändå "not_configured" typat.
 *
 * `turns` är fältets senaste utbyte (kompakt) så att uppföljningssvar
 * fortsätter samma flöde. Saneras serverside – klienten är opålitlig.
 */
export async function interpretFreeTextAction(
  text: string,
  turns: { role: "user" | "assistant"; text: string }[] = []
): Promise<CommandRunResult> {
  const result = await withBusiness(() => interpretFreeTextViaAi(text.slice(0, 2000), sanitizeTurns(turns)), {
    retry: false,
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
