/**
 * Demoföretag i Supabase-läget: per-sessionsprovisionering och återställning.
 *
 * Vägen är avsiktligt densamma som seedningen (db:seed --demo):
 *   1. app.reset_demo_business(id) tömmer företagets data atomärt i databasen
 *      (SQL-funktionen vägrar för företag som inte skapades med is_demo).
 *   2. importStateIntoBusiness spelar upp exempeldatat genom appens vanliga
 *      commit-väg (RPC:er, nummerserier, immutabilitet).
 *
 * Entiteters id är GLOBALA primärnycklar (id text primary key) och offert-/
 * fakturatokens är globalt unika – när flera isolerade demosessioner ska
 * samexistera måste seedens id:n därför mappas om per företag. Det gör
 * demoSeedFor: företagsunikt suffix på alla id:n, nya slumpade tokens och
 * omräknade innehållshashar för BankID-låsta offertversioner.
 */
import { randomBytes } from "crypto";
import type { DB } from "../types";
import { buildSeed } from "../seed";
import { quoteVersionHash } from "../hash";
import { createDemoSessionBusiness, loadStateSnapshot, sqlClient } from "./adapter-supabase";
import { bindTransaction } from "./load";
import { importStateIntoBusiness } from "./import-state";

/**
 * Fält som bär interna entitetsreferenser. Medveten INKLUDERINGSLISTA –
 * nycklar utanför listan (userId, themeId, externalId, providerPaymentId,
 * messageId, idempotencyKey …) ska ALDRIG mappas om: de är auth-uuid:n,
 * designnycklar, externa referenser eller redan företags-skopade.
 */
const ID_KEYS = new Set([
  "id",
  "customerId",
  "quoteId",
  "quoteVersionId",
  "currentVersionId",
  "jobId",
  "invoiceId",
  "expenseId",
  "receiptId",
  "bankTransactionId",
  "verificationId",
  "paymentVerificationId",
  "supplierInvoiceId",
  "supplierPaymentId",
  "inboxItemId",
  "matchedId",
  "workLocationId",
  "defaultWorkLocationId",
  "accountId",
  "paymentFileId",
  "replacedByFileId",
  "creditsInvoiceId",
  "deniedReductionOf",
  "correctedByVerificationId",
]);

const ID_ARRAY_KEYS = new Set(["paymentIds", "supplierInvoiceIds"]);

function remapIdsInPlace(node: unknown, suffix: string): void {
  if (Array.isArray(node)) {
    for (const item of node) remapIdsInPlace(item, suffix);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (ID_KEYS.has(key) && typeof value === "string" && value) {
      record[key] = `${value}-${suffix}`;
    } else if (ID_ARRAY_KEYS.has(key) && Array.isArray(value)) {
      record[key] = value.map((v) => (typeof v === "string" && v ? `${v}-${suffix}` : v));
    } else {
      remapIdsInPlace(value, suffix);
    }
  }
}

function randomDemoToken(): string {
  return `demo-${randomBytes(9).toString("base64url")}`;
}

/**
 * Exempeldatat anpassat till ETT specifikt företag:
 *   * alla interna id:n suffixas med företagets id (globala PK-kollisioner
 *     mellan samtidiga demosessioner är omöjliga),
 *   * offert-/fakturatokens slumpas om (globalt unika, ogissbara),
 *   * hemsidans slug görs företagsunik (globalt unik),
 *   * inkommande-mejlsluggen ersätts med företagets egen,
 *   * BankID-låsta offertversioners contentHash + signaturbevis räknas om
 *     eftersom hashen innehåller quoteId.
 */
export function demoSeedFor(businessId: string, inboundMailSlug?: string): DB {
  const seed = buildSeed();
  const compact = businessId.replace(/-/g, "");
  const suffix = compact.slice(0, 10) || "demo";

  remapIdsInPlace(seed as unknown as Record<string, unknown>, suffix);

  for (const quote of seed.quotes) quote.token = randomDemoToken();
  for (const invoice of seed.invoices) invoice.token = randomDemoToken();

  if (seed.website) {
    seed.website.slug = `${seed.website.slug}-${suffix}`;
  }

  // Låsta versioner: hashen täcker quoteId – räkna om efter remappningen och
  // spegla till signaturens bevis så att verifieringskedjan förblir intakt.
  for (const version of seed.quoteVersions) {
    if (!version.lockedAt) continue;
    version.contentHash = quoteVersionHash(version);
    for (const signature of seed.signatures) {
      if (signature.quoteVersionId === version.id) {
        signature.evidence = { ...signature.evidence, contentHash: version.contentHash };
      }
    }
  }

  const fallback = compact.slice(0, 12) || "demo";
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

/**
 * Provisionera en NY isolerad demosession: eget företag + exempeldata.
 * Misslyckas importen städas det halvfärdiga företaget bort (bäst
 * ansträngning) innan felet kastas vidare – ingen kaka har satts än.
 */
export async function provisionDemoSessionBusiness(input: {
  tokenHash: string;
  expiresAt: string;
  userId: string;
}): Promise<string> {
  const template = buildSeed().settings;
  const businessId = await createDemoSessionBusiness({
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
    name: template.name,
    orgNumber: template.orgNumber,
    email: template.email,
    phone: template.phone,
  });
  try {
    await importStateIntoBusiness(businessId, input.userId, demoSeedFor(businessId));
  } catch (err) {
    try {
      const client = await sqlClient();
      // Importen rullades tillbaka i sin helhet – företaget är tomt och kan
      // raderas direkt (inga barnrader med immutabilitetstriggrar finns).
      await client.query(`delete from public.businesses where id = $1 and is_demo`, [businessId]);
    } catch {
      // Kvarlämnat tomt demoföretag städas av utgångsstädningen inom 24 h.
    }
    throw err;
  }
  return businessId;
}
