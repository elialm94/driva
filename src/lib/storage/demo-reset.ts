/**
 * Seed-verktyg för UTVECKLAR-seedade demoföretag i en riktig Supabase-databas
 * (db:seed --demo och adaptertesterna). Den PUBLIKA demon använder aldrig
 * detta – den bor i JSON-filer per besökare (storage/demo-session-store.ts).
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
import { randomBytes } from "node:crypto";
import type { DB } from "../types";
import { buildSeed } from "../seed";
import { normalize } from "../store";
import { publicToken } from "../ids";
import { quoteVersionHash } from "../hash";
import { loadStateSnapshot, sqlClient } from "./adapter-supabase";
import { bindTransaction } from "./load";
import { importStateIntoBusiness } from "./import-state";

/**
 * Exempeldatats id:n är fasta strängar (cust-anna, quote-kok, …) och
 * primärnycklarna är globala – två företag kan aldrig dela dem. Varje
 * demoseed får därför ett eget suffix på ALLA id:n, konsekvent genom hela
 * objektgrafen (kunder, offerter, referensfält, aktivitetshändelser, …).
 */
function remapSuffix(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function collectIds(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectIds(v, out);
    return;
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.id === "string" && rec.id) out.add(rec.id);
    // BankID-ordrar identifieras av orderRef (signaturer refererar den).
    if (typeof rec.orderRef === "string" && rec.orderRef) out.add(rec.orderRef);
    for (const v of Object.values(rec)) collectIds(v, out);
  }
}

function replaceIds(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => replaceIds(v, map));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = replaceIds(v, map);
    return out;
  }
  return value;
}

/** Gör seedets id:n, tokens och frysta hashar unika för EN demoinstans. */
export function remapSeedForInstance(seed: DB): DB {
  const ids = new Set<string>();
  collectIds(seed, ids);
  const suffix = remapSuffix();
  const map = new Map<string, string>();
  for (const id of ids) map.set(id, `${id}-${suffix}`);
  const remapped = replaceIds(seed, map) as DB;

  // Publika tokens har globala unika index och ska vara ogissbara – nya
  // slumpade värden i stället för suffix (ingen refererar tokenvärdet).
  for (const q of remapped.quotes) q.token = publicToken();
  for (const i of remapped.invoices) i.token = publicToken();

  // contentHash omfattar quoteId – räkna om efter remappningen och håll
  // godkännandenas beviskopior konsekventa (seedens godkännanden är fiktiva).
  for (const v of remapped.quoteVersions) {
    if (v.contentHash) v.contentHash = quoteVersionHash(v);
  }
  for (const s of remapped.signatures) {
    const version = remapped.quoteVersions.find((v) => v.id === s.quoteVersionId);
    if (version?.contentHash) s.contentHash = version.contentHash;
  }
  return remapped;
}

/** Exempeldatat med företagsunik inkommande-slug (aldrig seedens "demo"). */
export function demoSeedFor(businessId: string, inboundMailSlug?: string): DB {
  // Normalisera direkt: hydrerar snapshots/räkenskapsår så att seedet som
  // valideras mot databasen är samma som det som importeras.
  const seed = remapSeedForInstance(normalize(buildSeed(), { persistIfDirty: false }));
  const fallback = businessId.replace(/-/g, "").slice(0, 12) || "demo";
  seed.settings.inboundMailSlug = inboundMailSlug?.trim() || fallback;
  // Hemsidans publika slug är också globalt unik – gör den företagsunik men
  // igenkännbar (används i förhandsvisningens adress).
  if (seed.website) seed.website.slug = `${seed.website.slug}-${fallback.slice(0, 8)}`;
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
