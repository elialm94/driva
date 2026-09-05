import { db } from "../store";
import { bokforingsdatum } from "../accounting/dates";
import { fiscalYears } from "../accounting/fiscal";
import { verificationLabel } from "../accounting/engine";
import { verificationsInRange } from "../accounting/ledger";
import { generateSie, encodeSieToPc8 } from "../accounting/sie";
import {
  balansCsv,
  huvudbokCsv,
  resultatCsv,
  saldobalansCsv,
  verifikationerCsv,
  CSV_BOM,
} from "../accounting/export";
import { seriesLabel } from "../accounting/series";
import { annualReportFor } from "../accounting/annual-report";
import { receiptFileContent } from "../receipts/receipt-file";
import { verificationAttachmentContent } from "../receipts/verification-attachment";
import { attachmentBytes } from "../inbox/attachment-content";
import { invoiceTotals } from "../services/data";
import { invoiceNumberLabel } from "../invoices/display";
import { datumLang } from "../format";
import { buildZip, safeZipPath, type ZipEntry } from "./zip";
import { retentionPolicyText, retentionUntil } from "./retention";
import type { FiscalYear, Verification } from "../types";

/**
 * Arkivexporten: räkenskapsåret som en zip-fil som går att läsa utan Driva.
 *
 * SIE-filen och CSV-rapporterna fanns redan, men de bär bara siffrorna. Ett
 * arkiv som saknar underlagen uppfyller inte bokföringslagen, och det är också
 * det som gör en bokföring granskningsbar: en verifikation utan sin faktura är
 * ett påstående. Därför packas underlagen med, i mappar som är döpta efter
 * verifikationen de hör till, så att en granskare kan gå från en rad i
 * huvudboken till pappret utan att gissa.
 *
 * Det arkivet inte gör är att låtsas. Ett underlag som inte finns lagrat får
 * ingen platshållarfil – det står i underlagsregistret vad som saknas och
 * varför, för det är den uppgiften en granskare behöver.
 */

/** Vad ett underlag kom ifrån – bestämmer var i arkivet det hamnar. */
export type UnderlagKind = "verifikat" | "kvitto" | "inbox";

export interface UnderlagRow {
  verification: string;
  date: string;
  description: string;
  source: string;
  /** Sökväg i arkivet, när underlaget följde med. */
  path?: string;
  kind?: UnderlagKind;
  /** Varför underlaget inte finns med, i klartext. */
  missing?: string;
}

export interface ArchiveSummary {
  fiscalYear: string;
  filename: string;
  verifications: number;
  /** Underlag som följde med i arkivet. */
  documents: number;
  /** Verifikationer vars underlag inte kunde packas med. */
  missing: number;
  sizeBytes: number;
  retentionUntil: string;
}

export interface ArchiveResult {
  filename: string;
  bytes: Buffer;
  summary: ArchiveSummary;
  rows: UnderlagRow[];
}

export class ArchiveError extends Error {}

const SOURCE_TEXT: Record<string, string> = {
  kundfaktura: "Kundfaktura",
  betalning: "Betalning",
  utgift: "Kvitto/utgift",
  leverantorsfaktura: "Leverantörsfaktura",
  banktransaktion: "Banktransaktion",
  rattelse: "Rättelse",
  avskrivning: "Avskrivning",
  periodisering: "Periodisering",
  moms: "Momsredovisning",
  skattekonto: "Skattekontot",
  lon: "Lön",
  bokslut: "Bokslutspost",
  ingaende_balans: "Ingående balans",
  manuell: "Manuellt verifikat",
};

/**
 * Verifikationer som inte har ett eget underlag, och inte ska ha det. En
 * momsredovisning eller en avskrivning vilar på bokföringen själv – att
 * efterfråga ett papper för dem vore att uppfinna ett krav.
 */
const SELF_EVIDENT = new Set([
  "moms",
  "avskrivning",
  "periodisering",
  "bokslut",
  "ingaende_balans",
  "skattekonto",
  "betalning",
  "banktransaktion",
  "rattelse",
]);

function fiscalYearOrThrow(fiscalYearId: string): FiscalYear {
  const fy = fiscalYears().find((f) => f.id === fiscalYearId);
  if (!fy) throw new ArchiveError("Räkenskapsåret finns inte.");
  return fy;
}

/** Mappnamn per verifikation: "A12 2026-03-14 Beijer Bygg". */
function verificationFolder(v: Verification): string {
  const label = verificationLabel(v);
  const description = v.description.replace(/[/\\]/g, "-").slice(0, 60).trim();
  return safeZipPath(`${label} ${bokforingsdatum(v.date)} ${description}`.trim());
}

async function underlagFor(
  v: Verification
): Promise<{ kind: UnderlagKind; filename: string; bytes: Buffer } | { missing: string }> {
  if (v.attachment) {
    const content = await verificationAttachmentContent(v.attachment);
    if (content) return { kind: "verifikat", filename: v.attachment.filename, bytes: content.bytes };
    return { missing: "Bilagan är registrerad men filen kunde inte läsas ur fillagringen." };
  }

  const data = db();
  const source = v.source;
  if (source.type === "utgift") {
    const expense = data.expenses.find((e) => e.id === source.id);
    const receipt = expense?.receiptId
      ? data.receipts.find((r) => r.id === expense.receiptId)
      : data.receipts.find((r) => r.expenseId === source.id);
    if (!receipt) return { missing: "Kvittot saknas – köpet har bokförts utan underlag." };
    const content = await receiptFileContent(receipt);
    if (!content) return { missing: "Kvittot är registrerat men filen finns inte lagrad." };
    return { kind: "kvitto", filename: receipt.filename, bytes: content.bytes };
  }

  if (source.type === "leverantorsfaktura") {
    const invoice = data.supplierInvoices.find((s) => s.id === source.id);
    const item = invoice?.inboxItemId
      ? (data.inboxItems ?? []).find((i) => i.id === invoice.inboxItemId)
      : undefined;
    const attachment = item?.attachments[0];
    if (!attachment) return { missing: "Fakturan bokfördes utan dokument i inboxen." };
    const content = await attachmentBytes(attachment);
    if (!content) return { missing: "Dokumentets innehåll finns inte lagrat – bara uppgifterna om det." };
    return { kind: "inbox", filename: attachment.filename, bytes: content.bytes };
  }

  if (source.type === "kundfaktura") {
    // Fakturan är vårt eget dokument och finns i sin helhet i kundfakturaregistret
    // som packas med. Att generera en PDF här hade skapat ett andra original.
    return { missing: "Underlaget är vår egen faktura – se underlag/kundfakturor.csv." };
  }

  if (SELF_EVIDENT.has(source.type)) {
    return { missing: "Behöver inget separat underlag – verifikationen vilar på bokföringen." };
  }
  return { missing: "Inget underlag är kopplat till verifikationen." };
}

function csvOf(rows: (string | number)[][]): string {
  const escape = (v: string | number): string => {
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return CSV_BOM + rows.map((r) => r.map(escape).join(";")).join("\r\n") + "\r\n";
}

function customerInvoicesCsv(fy: FiscalYear): string {
  const rows: (string | number)[][] = [
    ["Fakturanummer", "Datum", "Förfallodag", "Kund", "Belopp exkl. moms", "Moms", "Belopp inkl. moms", "Status"],
  ];
  const data = db();
  const issued = data.invoices
    .filter((i) => i.issuedAt && i.issueDate >= fy.startDate && i.issueDate <= fy.endDate)
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || (a.number ?? 0) - (b.number ?? 0));
  for (const invoice of issued) {
    const totals = invoiceTotals(invoice);
    rows.push([
      invoiceNumberLabel(invoice),
      invoice.issueDate,
      invoice.dueDate,
      data.customers.find((c) => c.id === invoice.customerId)?.name ?? "",
      totals.subtotal,
      totals.vat,
      totals.total,
      invoice.status,
    ]);
  }
  return csvOf(rows);
}

function underlagCsv(rows: UnderlagRow[]): string {
  const out: (string | number)[][] = [
    ["Verifikation", "Datum", "Beskrivning", "Källa", "Underlag i arkivet", "Anmärkning"],
  ];
  for (const r of rows) {
    out.push([r.verification, r.date, r.description, r.source, r.path ?? "", r.missing ?? ""]);
  }
  return csvOf(out);
}

function readme(fy: FiscalYear, summary: Omit<ArchiveSummary, "sizeBytes">, createdAt: Date): string {
  const settings = db().settings;
  const lines = [
    `ARKIV – ${settings.name || "Företaget"} – räkenskapsåret ${fy.label}`,
    "",
    `Skapat ${datumLang(createdAt.toISOString().slice(0, 10))} ur Driva.`,
    settings.orgNumber ? `Organisationsnummer: ${settings.orgNumber}` : "",
    `Räkenskapsår: ${fy.startDate} – ${fy.endDate} (${fy.status === "stangt" ? "stängt" : "öppet"})`,
    "",
    "ARKIVERINGSTID",
    retentionPolicyText(fy),
    "Driva raderar ingenting automatiskt när tiden gått ut. Behåll den här filen",
    "på ett ställe som finns kvar även om abonnemanget avslutas.",
    "",
    "INNEHÅLL",
    "  bokforing/bokforing.se          Hela året som SIE 4 – läses av alla bokföringsprogram",
    "  bokforing/verifikationer.csv    Varje verifikationsrad med konto, debet och kredit",
    "  bokforing/huvudbok.csv          Huvudbok per konto",
    "  bokforing/saldobalans.csv       Saldobalans med ingående och utgående balans",
    "  bokforing/resultatrakning.csv   Resultaträkning",
    "  bokforing/balansrakning.csv     Balansräkning per den sista dagen",
    "  underlag/register.csv           Varje verifikation och var dess underlag ligger",
    "  underlag/kundfakturor.csv       Utfärdade kundfakturor under året",
    "  underlag/<verifikation>/…       Kvitton och fakturor, en mapp per verifikation",
    "",
    "OMFATTNING",
    `  Verifikationer: ${summary.verifications}`,
    `  Underlag i arkivet: ${summary.documents}`,
    `  Verifikationer utan bifogat underlag: ${summary.missing} (skälet står i underlag/register.csv)`,
    "",
    "Ett underlag som inte finns lagrat får ingen platshållarfil. Står det i",
    "registret att kvittot saknas är det för att köpet bokfördes utan det –",
    "arkivet visar bokföringen som den är, inte som den borde ha varit.",
    "",
    "CSV-filerna är semikolonseparerade med UTF-8 BOM och öppnas direkt i Excel.",
    "SIE-filen är kodad som PC8 (CP437), vilket standarden föreskriver.",
  ];
  return lines.filter((l) => l !== "").join("\n") + "\n";
}

/**
 * Bygger arkivet för ett räkenskapsår. Anropas i tenantkontexten: underlagen
 * hämtas ur fillagringen, och sökvägarna dit är per företag.
 */
export async function buildFiscalYearArchive(
  fiscalYearId: string,
  now = new Date()
): Promise<ArchiveResult> {
  const fy = fiscalYearOrThrow(fiscalYearId);
  const range = { from: fy.startDate, to: fy.endDate };
  const verifications = verificationsInRange(range);

  const entries: ZipEntry[] = [];
  const rows: UnderlagRow[] = [];
  let documents = 0;

  for (const v of verifications) {
    const found = await underlagFor(v);
    const row: UnderlagRow = {
      verification: verificationLabel(v),
      date: bokforingsdatum(v.date),
      description: v.description,
      source: `${SOURCE_TEXT[v.source.type] ?? v.source.type} · serie ${seriesLabel(v.series)}`,
    };
    if ("missing" in found) {
      row.missing = found.missing;
    } else {
      const path = `underlag/${verificationFolder(v)}/${found.filename}`;
      entries.push({ path, bytes: found.bytes, modified: new Date(v.postedAt) });
      row.path = safeZipPath(path);
      row.kind = found.kind;
      documents++;
    }
    rows.push(row);
  }

  const missing = rows.filter((r) => r.missing).length;
  const summary: Omit<ArchiveSummary, "sizeBytes"> = {
    fiscalYear: fy.label,
    filename: archiveFilename(fy, now),
    verifications: verifications.length,
    documents,
    missing,
    retentionUntil: retentionUntil(fy),
  };

  const text = (s: string) => Buffer.from(s, "utf8");
  entries.unshift(
    { path: "LÄSMIG.txt", bytes: text(readme(fy, summary, now)) },
    { path: "bokforing/bokforing.se", bytes: Buffer.from(encodeSieToPc8(generateSie(fy.id))) },
    { path: "bokforing/verifikationer.csv", bytes: text(verifikationerCsv(range)) },
    { path: "bokforing/huvudbok.csv", bytes: text(huvudbokCsv(range)) },
    { path: "bokforing/saldobalans.csv", bytes: text(saldobalansCsv(range)) },
    { path: "bokforing/resultatrakning.csv", bytes: text(resultatCsv(range)) },
    { path: "bokforing/balansrakning.csv", bytes: text(balansCsv(fy.endDate)) },
    { path: "underlag/register.csv", bytes: text(underlagCsv(rows)) },
    { path: "underlag/kundfakturor.csv", bytes: text(customerInvoicesCsv(fy)) }
  );

  const report = annualReportFor(fy.id);
  if (report) {
    entries.push({
      path: "arsredovisning/arsredovisning.txt",
      bytes: text(annualReportNote(report.status, fy)),
    });
  }

  const bytes = buildZip(entries, now);
  return { filename: summary.filename, bytes, summary: { ...summary, sizeBytes: bytes.length }, rows };
}

function annualReportNote(status: string, fy: FiscalYear): string {
  return [
    `Årsredovisningen för ${fy.label} finns upprättad i Driva (status: ${status}).`,
    "Den fastställda årsredovisningen laddas ner som iXBRL från bokslutssidan och",
    "hör till arkivet – lägg filen i den här mappen när den är signerad.",
    "",
    retentionPolicyText(fy),
  ].join("\n");
}

/** driva-arkiv-2026-20260905.zip – året först, för det är så filer sorteras. */
export function archiveFilename(fy: Pick<FiscalYear, "label">, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const label = fy.label.replace(/[^\w-]/g, "-");
  return `driva-arkiv-${label}-${stamp}.zip`;
}

/** Kort mänsklig sammanfattning för gränssnittet. */
export function archiveSummaryText(summary: ArchiveSummary): string {
  const size = summary.sizeBytes >= 1_000_000
    ? `${(summary.sizeBytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(summary.sizeBytes / 1000))} kB`;
  return `${summary.verifications} verifikationer och ${summary.documents} underlag, ${size}. Bevaras till ${summary.retentionUntil}.`;
}
