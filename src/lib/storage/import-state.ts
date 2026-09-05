/**
 * Importera ett komplett domänstate (seed eller lokal JSON-databas) till ett
 * företag i Postgres. Går genom EXAKT samma väg som appen: runWithTenant →
 * diff mot baslinjen → atomär commit där verifikationer, utfärdade fakturor
 * och betalningar går via databasens RPC:er i nummerordning. Det som inte kan
 * importeras konsistent (obalanserad verifikation, nummerlucka) stoppar hela
 * transaktionen – ingen halvimport.
 */
import type { DB } from "../types";
import { db, normalize, save } from "../store";
import { quoteVersionHash } from "../hash";
import { loadStateSnapshot, runWithTenant, sqlClient } from "./adapter-supabase";
import { bindTransaction } from "./load";

export class ImportPreconditionError extends Error {}

/** Samlingar som räknas vid validering (nyckel i DB → etikett i rapporten). */
const COUNTED: Array<[keyof DB, string]> = [
  ["customers", "kunder"],
  ["quotes", "offerter"],
  ["quoteVersions", "offertversioner"],
  ["signatures", "signaturer"],
  ["bankidOrders", "BankID-ordrar"],
  ["jobs", "uppdrag"],
  ["jobWorkEntries", "uppdragsposter"],
  ["invoices", "fakturor"],
  ["payments", "betalningar"],
  ["bankAccounts", "bankkonton"],
  ["bankTransactions", "banktransaktioner"],
  ["bankConnections", "bankkopplingar"],
  ["expenses", "utgifter"],
  ["receipts", "kvitton"],
  ["supplierInvoices", "leverantörsfakturor"],
  ["supplierPayments", "leverantörsbetalningar"],
  ["verifications", "verifikationer"],
  ["fiscalYears", "räkenskapsår"],
  ["vatReports", "momsrapporter"],
  ["assets", "tillgångar"],
  ["accruals", "periodiseringar"],
  ["auditTrail", "bokföringsaudit"],
  ["annualReports", "årsredovisningar"],
  ["activity", "aktivitetshändelser"],
  ["website", "hemsida"],
  ["domains", "domäner"],
  ["domainAudit", "domänaudit"],
  ["assistantMessages", "assistentmeddelanden"],
  ["pendingActions", "väntande åtgärder"],
  ["assistantAudit", "assistentaudit"],
  ["reminders", "påminnelser"],
  ["attentionStates", "uppmärksamhetstillstånd"],
  ["inboxItems", "inkorgsposter"],
  ["wholesalerConnections", "grossistanslutningar"],
  ["wholesalerPriceImports", "prisimporter"],
  ["purchaseOrders", "materialbeställningar"],
  ["purchaseOrderLines", "beställningsrader"],
  ["purchaseOrderConfirmations", "orderbekräftelser"],
  ["dataImports", "dataimporter"],
  ["suppliers", "leverantörer"],
];

function countOf(state: DB, key: keyof DB): number {
  const v = state[key];
  return Array.isArray(v) ? v.length : v ? 1 : 0;
}

export interface ImportReport {
  rows: Array<{ label: string; expected: number; actual: number; ok: boolean }>;
  ok: boolean;
}

/**
 * Skriver hela `source` till företaget. Företaget måste vara tomt (inga
 * kunder/fakturor/verifikationer) – en halvfylld databas går inte att
 * diff-importera säkert.
 */
export async function importStateIntoBusiness(
  businessId: string,
  userId: string,
  source: DB
): Promise<void> {
  // Samma hydrering som vid load: utfärdade fakturor får sina frysta
  // snapshots, säljar-/köparsnapshots byggs och bokföringsmotorn backfyller
  // räkenskapsår. Utan detta vägrar app.issue_invoice (snapshot är NOT NULL
  // för utfärdade fakturor). persistIfDirty=false: källan får inte skrivas
  // till den lokala JSON-filen som bieffekt.
  normalize(source, { persistIfDirty: false });

  // Källans numrering börjar sällan på 1 (t.ex. fakturor från 1032). RPC:erna
  // kräver att varje nummer är exakt nästa lediga – flytta fram räknarna till
  // källans FÖRSTA nummer innan uppspelningen, så att serien replayas exakt.
  await presetSequences(businessId, source);

  await runWithTenant({ businessId, userId, access: "write", retry: false }, () => {
    const target = db();
    if (target.customers.length || target.invoices.length || target.verifications.length) {
      throw new ImportPreconditionError(
        "Företaget innehåller redan data. Importera till ett nyskapat företag (eller rensa det manuellt)."
      );
    }
    for (const key of Object.keys(source) as Array<keyof DB>) {
      (target as unknown as Record<string, unknown>)[key] = source[key];
    }
    save();
  });

  // Räknarna ska sluta exakt där källan slutade (aldrig bakåt) – annars kan
  // nästa dokument återanvända ett nummer som källan redan förbrukat.
  await finalizeSequences(businessId, source);
}

async function presetSequences(businessId: string, source: DB): Promise<void> {
  const invoiceNumbers = source.invoices
    .map((i) => i.number)
    .filter((n): n is number => typeof n === "number");
  const verificationNumbers = source.verifications.map((v) => v.number);
  if (invoiceNumbers.length === 0 && verificationNumbers.length === 0) return;

  const client = await sqlClient();
  await client.transaction(async (tx) => {
    await bindTransaction(tx, businessId);
    if (invoiceNumbers.length > 0) {
      await tx.query(`update public.business_sequences set invoice = $2 where business_id = $1`, [
        businessId,
        Math.min(...invoiceNumbers),
      ]);
    }
    if (verificationNumbers.length > 0) {
      await tx.query(`update public.business_sequences set verification = $2 where business_id = $1`, [
        businessId,
        Math.min(...verificationNumbers),
      ]);
    }
  });
}

async function finalizeSequences(businessId: string, source: DB): Promise<void> {
  const client = await sqlClient();
  await client.transaction(async (tx) => {
    await bindTransaction(tx, businessId);
    await tx.query(
      `update public.business_sequences
          set quote = greatest(quote, $2),
              invoice = greatest(invoice, $3),
              verification = greatest(verification, $4)
        where business_id = $1`,
      [businessId, source.sequences.quote, source.sequences.invoice, source.sequences.verification]
    );
  });
}

/** Läs om företaget och jämför antal per samling + frysta ytor. */
export async function validateImport(businessId: string, source: DB): Promise<ImportReport> {
  const actual = await loadStateSnapshot(businessId);
  const rows = COUNTED.map(([key, label]) => {
    const expected = countOf(source, key);
    const got = countOf(actual, key);
    return { label, expected, actual: got, ok: expected === got };
  });

  // Frysta ytor. OBS: jsonb kanoniserar nyckelordning, så jämförelsen görs
  // nyckelordnings-oberoende. Det juridiskt bärande är quoteVersionHash –
  // hashen kanoniserar själv fältordningen, så gamla signaturer verifierar
  // identiskt efter migrering (bekräftas nedan, hash för hash).
  const actualVersions = new Map(actual.quoteVersions.map((v) => [v.id, v]));
  const versionsExact = source.quoteVersions.every((src) => {
    const got = actualVersions.get(src.id);
    return got !== undefined && canonical(src) === canonical(got);
  });
  rows.push({
    label: "offertversioner värde-exakta",
    expected: 1,
    actual: versionsExact ? 1 : 0,
    ok: versionsExact,
  });
  const hashesExact = source.quoteVersions.every((src) => {
    const got = actualVersions.get(src.id);
    return got !== undefined && quoteVersionHash(src) === quoteVersionHash(got);
  });
  rows.push({
    label: "offertversioner hashar identiskt (signaturer intakta)",
    expected: 1,
    actual: hashesExact ? 1 : 0,
    ok: hashesExact,
  });

  const actualSnapshots = new Map(actual.invoices.map((i) => [i.id, i.issuedSnapshot ?? null]));
  const snapshotsExact = source.invoices.every(
    (i) => canonical(i.issuedSnapshot ?? null) === canonical(actualSnapshots.get(i.id) ?? null)
  );
  rows.push({
    label: "fakturasnapshots värde-exakta",
    expected: 1,
    actual: snapshotsExact ? 1 : 0,
    ok: snapshotsExact,
  });

  return { rows, ok: rows.every((r) => r.ok) };
}

/** Deterministisk serialisering med sorterade nycklar (jsonb-ordningsoberoende). */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}
