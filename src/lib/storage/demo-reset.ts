/**
 * Återställning av det publika demoföretaget i Supabase-läget.
 *
 * Vägen är avsiktligt densamma som seedningen (db:seed --demo):
 *   1. app.reset_demo_business(id) tömmer företagets data atomärt i databasen
 *      (SQL-funktionen vägrar för företag som inte skapades med is_demo).
 *   2. importStateIntoBusiness spelar upp exempeldatat genom appens vanliga
 *      commit-väg (RPC:er, nummerserier, immutabilitet).
 *
 * inbound_mail_slug är unik per företag – seedens "demo"-slug ersätts alltid
 * med företagets egen så att återställningen aldrig kolliderar med andra
 * företag och demoföretagets inkommande mejladress förblir stabil.
 */
import type { DB } from "../types";
import { buildSeed } from "../seed";
import { loadStateSnapshot, sqlClient } from "./adapter-supabase";
import { bindTransaction } from "./load";
import { importStateIntoBusiness } from "./import-state";

/** Exempeldatat med företagsunik inkommande-slug (aldrig seedens "demo"). */
export function demoSeedFor(businessId: string, inboundMailSlug?: string): DB {
  const seed = buildSeed();
  const fallback = businessId.replace(/-/g, "").slice(0, 12) || "demo";
  seed.settings.inboundMailSlug = inboundMailSlug?.trim() || fallback;
  return seed;
}

/** Töm demoföretaget och spela upp exempeldatat igen. Kastar för icke-demo. */
export async function resetDemoBusinessToSeed(businessId: string, userId: string): Promise<void> {
  const current = await loadStateSnapshot(businessId);
  if (current.meta.demo !== true) {
    throw new Error("Endast demoföretaget kan återställas.");
  }
  const seed = demoSeedFor(businessId, current.settings.inboundMailSlug);

  const client = await sqlClient();
  await client.transaction(async (tx) => {
    await bindTransaction(tx, businessId);
    // userId = demo-användaren: alla andra medlemskap återkallas i samma
    // transaktion (en accepterad demo-inbjudan överlever inte en återställning).
    await tx.query(`select app.reset_demo_business($1, $2)`, [businessId, userId]);
  });

  await importStateIntoBusiness(businessId, userId, seed);
}
