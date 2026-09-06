/**
 * "Flytta dina uppgifter till Ferva" – analys och genomförande av uppladdade
 * filer. Filerna sparas aldrig: analysen returnerar en förhandsgranskning
 * (+ filens hash); vid bekräftelse laddas filen upp igen, hashen jämförs och
 * importen körs i EN tenantcommit. Varje genomförd import auditeras i
 * data_imports och samma fil (hash) kan aldrig importeras två gånger för
 * samma ändamål.
 *
 * Deterministiskt först: SIE känns igen på innehållet, tabeller på rubriker.
 * AI (om konfigurerad) får bara FÖRESLÅ typ och kolumnmappning när det
 * deterministiska inte räcker – användaren bekräftar alltid.
 */
import { createHash } from "node:crypto";
import { db, save } from "../store";
import { uid } from "../ids";
import type { DataImport, DataImportKind, WholesalerColumnMapping } from "../types";
import { logActivity } from "./activity";
import { parseSie, looksLikeSieBytes, SieParseError, SIE_LIMITS, type SieFile } from "../imports/sie-parse";
import { applySieImport, previewSie, type SiePreview } from "../imports/sie-import";
import { parsePriceFile, previewImport, type ImportPreview as PriceImportPreview } from "../wholesalers/import-engine";
import { PriceFileError, MAX_PRICE_FILE_BYTES } from "../wholesalers/file-detect";
import type { RawTable } from "../wholesalers/table";
import {
  classifyRegisterTable,
  customersFromDrafts,
  detectRegisterMapping,
  previewCustomerImport,
  previewSupplierImport,
  registerMappingProblems,
  REGISTER_FIELD_LABELS,
  sanitizeRegisterMapping,
  suppliersFromDrafts,
  CUSTOMER_FIELDS,
  SUPPLIER_FIELDS,
  type RegisterField,
  type RegisterKind,
  type RegisterMapping,
} from "../imports/registers";
import { aiSuggestTableMapping } from "../imports/classify-ai";
import { addWorkLocation } from "./work-locations";
import { wholesalerConnections, importPriceFile, type ImportRunner } from "./wholesalers";
import { connectionLabel } from "../wholesalers/labels";
import { wholesalersEnabled } from "../features";
import { isAiConfigured } from "../ai/provider";

export const MAX_IMPORT_FILE_BYTES = SIE_LIMITS.maxBytes;

export class DataImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataImportError";
  }
}

export function fileHashHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/* --------------------------------- analys ----------------------------------- */

export type AnalyzedKind = DataImportKind | "unknown" | "unsupported";

export interface RegisterAnalysis {
  kind: RegisterKind;
  headers: string[];
  sampleRows: string[][];
  rowCount: number;
  mapping: RegisterMapping;
  confidence: Partial<Record<RegisterField, "high" | "medium" | "ai">>;
  /** Fält som kan mappas för registret, med etiketter. */
  fields: { key: RegisterField; label: string }[];
  problems: string[];
  created: number;
  duplicates: { line: number; name: string; matchedOn: string }[];
  invalid: { line: number; message: string }[];
  review: { line: number; message: string }[];
  unmapped: string[];
}

export interface ArticlesAnalysis {
  preview: PriceImportPreview;
  featureEnabled: boolean;
  connections: { id: string; label: string }[];
}

export interface ImportAnalysis {
  fileHash: string;
  filename: string;
  fileSize: number;
  /** sie | csv | txt | xlsx | xml | zip | pdf | okänd */
  fileKind: string;
  kind: AnalyzedKind;
  /** Kortrubrik, t.ex. "Bokföring 2025" eller "Kundregister". */
  title: string;
  /** Kortets underrad, t.ex. "SIE-fil • 1 284 verifikationer • 2025-01-01–2025-12-31". */
  subtitle: string;
  /** "deterministisk" | "ai" – källa till tolkningen när AI föreslagit. */
  source: "deterministic" | "ai";
  aiReason?: string;
  aiAvailable: boolean;
  alreadyImported?: { at: string; summary: string };
  /** Kan ett annat innehåll väljas manuellt (okänd tabell)? */
  canChooseKind: boolean;
  message?: string;
  warnings: string[];
  sie?: SiePreview;
  register?: RegisterAnalysis;
  articles?: ArticlesAnalysis;
}

export interface AnalyzeOptions {
  /** Användarens val när analysen inte kunde avgöra (eller för att byta). */
  kindOverride?: DataImportKind;
  /** Rättad kolumnmappning för register. */
  mapping?: RegisterMapping;
  /** Rättad mappning för artiklar/priser (grossistmodulens). */
  articleMapping?: WholesalerColumnMapping;
  /** Hoppa över AI-förslag (tester). */
  allowAi?: boolean;
}

function fileKindOf(filename: string, bytes: Buffer): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (["se", "si", "sie"].includes(ext)) return "sie";
  return ext || "okänd";
}

function alreadyImportedFor(hash: string, kind: DataImportKind): ImportAnalysis["alreadyImported"] {
  const hit = (db().dataImports ?? []).find((i) => i.fileHash === hash && i.kind === kind && i.status === "imported");
  return hit ? { at: hit.completedAt ?? hit.createdAt, summary: hit.summary } : undefined;
}

function sv(n: number): string {
  return n.toLocaleString("sv-SE");
}

function sieSubtitle(preview: SiePreview): string {
  const selectable = preview.years.filter((y) => y.selectable);
  const vers = selectable.reduce((s, y) => s + y.importableCount, 0);
  const span = selectable.length
    ? `${selectable[0].startDate}–${selectable[selectable.length - 1].endDate}`
    : preview.years.length
      ? `${preview.years[0].startDate}–${preview.years[preview.years.length - 1].endDate}`
      : "";
  const parts = ["SIE-fil"];
  if (selectable.length === 0) {
    const inFile = preview.years.reduce((s, y) => s + y.verificationCount, 0);
    parts.push(`${sv(inFile)} ${inFile === 1 ? "verifikation" : "verifikationer"} i filen`, "inget går att flytta in");
    return parts.join(" • ");
  }
  if (selectable.some((y) => y.balancesOnly) && vers <= selectable.length) parts.push("saldon");
  else parts.push(`${sv(vers)} ${vers === 1 ? "verifikation" : "verifikationer"}`);
  if (span) parts.push(span);
  return parts.join(" • ");
}

function sieTitle(preview: SiePreview): string {
  const labels = preview.years.filter((y) => y.selectable).map((y) => y.label);
  if (labels.length === 0) return "Bokföring";
  return `Bokföring ${labels.length > 2 ? `${labels[0]}–${labels[labels.length - 1]}` : labels.join(" och ")}`;
}

function analyzeSie(bytes: Buffer, base: Omit<ImportAnalysis, "kind" | "title" | "subtitle" | "source" | "canChooseKind" | "warnings">): ImportAnalysis {
  let file: SieFile;
  try {
    file = parseSie(bytes);
  } catch (e) {
    return {
      ...base,
      kind: "unsupported",
      title: "Bokföring (SIE)",
      subtitle: "Filen kunde inte läsas",
      source: "deterministic",
      canChooseKind: false,
      message: e instanceof SieParseError ? e.message : "SIE-filen kunde inte läsas.",
      warnings: [],
    };
  }
  const preview = previewSie(file, db());
  const warnings = [...preview.warnings];
  const already = alreadyImportedFor(base.fileHash, "bokforing");
  return {
    ...base,
    kind: "bokforing",
    title: sieTitle(preview),
    subtitle: sieSubtitle(preview),
    source: "deterministic",
    canChooseKind: false,
    ...(already ? { alreadyImported: already } : {}),
    ...(preview.nothingToImport
      ? { message: "Inget i filen går att flytta in just nu – se vad som utelämnas nedan." }
      : {}),
    warnings,
    sie: preview,
  };
}

function registerFields(kind: RegisterKind): { key: RegisterField; label: string }[] {
  return (kind === "kunder" ? CUSTOMER_FIELDS : SUPPLIER_FIELDS).map((key) => ({ key, label: REGISTER_FIELD_LABELS[key] }));
}

function analyzeRegister(
  table: RawTable,
  kind: RegisterKind,
  base: Omit<ImportAnalysis, "kind" | "title" | "subtitle" | "source" | "canChooseKind" | "warnings">,
  opts: { mapping?: RegisterMapping; source: ImportAnalysis["source"]; aiReason?: string; aiMapping?: RegisterMapping; canChooseKind: boolean },
): ImportAnalysis {
  const detected = detectRegisterMapping(table, kind);
  const confidence: RegisterAnalysis["confidence"] = { ...detected.confidence };
  let mapping = detected.mapping;
  if (opts.aiMapping) {
    for (const [field, header] of Object.entries(opts.aiMapping) as [RegisterField, string][]) {
      if (!mapping[field] && !Object.values(mapping).includes(header)) {
        mapping[field] = header;
        confidence[field] = "ai";
      }
    }
  }
  if (opts.mapping) mapping = sanitizeRegisterMapping(table, kind, opts.mapping);
  const problems = registerMappingProblems(mapping);
  const data = db();
  const preview =
    kind === "kunder" ? previewCustomerImport(table, mapping, data.customers) : previewSupplierImport(table, mapping, data.suppliers ?? []);
  const created = preview.drafts.length;
  const noun = kind === "kunder" ? (created === 1 ? "kund" : "kunder") : created === 1 ? "leverantör" : "leverantörer";
  const review = preview.review.length;
  const subtitleParts = [base.fileKind === "xlsx" ? "Excel" : base.fileKind.toUpperCase(), `${sv(created)} ${noun}`];
  if (preview.duplicates.length > 0) subtitleParts.push(`${sv(preview.duplicates.length)} finns redan`);
  if (review > 0) subtitleParts.push(`${sv(review)} ${review === 1 ? "rad behöver" : "rader behöver"} kontrolleras`);
  const already = alreadyImportedFor(base.fileHash, kind);
  const warnings: string[] = [];
  if (preview.invalid.length > 0) warnings.push(`${sv(preview.invalid.length)} rader saknar namn och tas inte med.`);
  return {
    ...base,
    kind,
    title: kind === "kunder" ? "Kundregister" : "Leverantörsregister",
    subtitle: problems.length ? `${subtitleParts[0]} • ${sv(table.rows.length)} rader • kolumner behöver väljas` : subtitleParts.join(" • "),
    source: opts.source,
    ...(opts.aiReason ? { aiReason: opts.aiReason } : {}),
    canChooseKind: opts.canChooseKind,
    ...(already ? { alreadyImported: already } : {}),
    warnings,
    register: {
      kind,
      headers: table.headers,
      sampleRows: table.rows.slice(0, 5),
      rowCount: table.rows.length,
      mapping,
      confidence,
      fields: registerFields(kind),
      problems,
      created,
      duplicates: preview.duplicates,
      invalid: preview.invalid,
      review: preview.review,
      unmapped: preview.unmapped,
    },
  };
}

function analyzeArticles(
  parsed: ReturnType<typeof parsePriceFile>,
  base: Omit<ImportAnalysis, "kind" | "title" | "subtitle" | "source" | "canChooseKind" | "warnings">,
  opts: { articleMapping?: WholesalerColumnMapping; source: ImportAnalysis["source"]; aiReason?: string; canChooseKind: boolean },
): ImportAnalysis {
  const data = db();
  const enabled = wholesalersEnabled(data);
  const connections = wholesalerConnections()
    .filter((c) => c.active)
    .map((c) => ({ id: c.id, label: connectionLabel(c) }));
  const preview = previewImport(parsed, { override: opts.articleMapping, remembered: undefined });
  const already = alreadyImportedFor(base.fileHash, "artiklar");
  const rows = preview.rowCount;
  const warnings: string[] = [];
  if (preview.discountLetter) warnings.push("Filen är ett rabattbrev – rabattgrupper utan artikelregister. Artiklarna kommer från grossistens prislista.");
  return {
    ...base,
    kind: "artiklar",
    title: "Artiklar och priser",
    subtitle: `${base.fileKind === "xlsx" ? "Excel" : base.fileKind.toUpperCase()} • ${sv(rows)} ${preview.discountLetter ? "rabattrader" : "artiklar"}`,
    source: opts.source,
    ...(opts.aiReason ? { aiReason: opts.aiReason } : {}),
    canChooseKind: opts.canChooseKind,
    ...(already ? { alreadyImported: already } : {}),
    ...(!enabled
      ? { message: "Artiklar och priser hör till Grossistbeställningar. Aktivera funktionen och lägg till grossisten, så kan filen importeras dit." }
      : connections.length === 0
        ? { message: "Lägg först till grossisten under Inställningar → Grossister. Prislistan hör till en grossist." }
        : {}),
    warnings,
    articles: { preview, featureEnabled: enabled, connections },
  };
}

/** Analysera en uppladdad fil. Kastar DataImportError vid gräns-/formatfel. */
export async function analyzeImportFile(bytes: Buffer, filename: string, opts: AnalyzeOptions = {}): Promise<ImportAnalysis> {
  if (bytes.length === 0) throw new DataImportError("Filen är tom.");
  if (bytes.length > MAX_IMPORT_FILE_BYTES) throw new DataImportError("Filen är för stor (max 25 MB).");
  const fileHash = fileHashHex(bytes);
  const fileKind = fileKindOf(filename, bytes);
  const base = { fileHash, filename, fileSize: bytes.length, fileKind, aiAvailable: isAiConfigured() };

  if (fileKind === "pdf") {
    return {
      ...base,
      kind: "unsupported",
      title: "PDF-dokument",
      subtitle: "Kan inte importeras som register",
      source: "deterministic",
      canChooseKind: false,
      message:
        "PDF-filer innehåller inte data vi kan flytta in här. Kvitton och leverantörsfakturor tar du emot i Inboxen – bokföring exporteras som SIE-fil och register som Excel eller CSV.",
      warnings: [],
    };
  }
  if (fileKind === "sie" || looksLikeSieBytes(bytes)) {
    return analyzeSie(bytes, base);
  }

  let parsed: ReturnType<typeof parsePriceFile>;
  try {
    if (bytes.length > MAX_PRICE_FILE_BYTES) throw new DataImportError("Tabellfiler får vara högst 8 MB.");
    parsed = parsePriceFile(bytes, filename);
  } catch (e) {
    if (e instanceof DataImportError) throw e;
    return {
      ...base,
      kind: "unsupported",
      title: filename,
      subtitle: "Filen kunde inte läsas",
      source: "deterministic",
      canChooseKind: false,
      message:
        e instanceof PriceFileError
          ? e.message
          : "Filen kunde inte läsas. Ferva tar emot bokföring som SIE-fil och register som CSV, Excel (.xlsx) eller XML.",
      warnings: [],
    };
  }

  const table = parsed.table;
  const classification = classifyRegisterTable(table);
  let kind: DataImportKind | "unknown" = opts.kindOverride ?? (classification.kind === "unknown" ? "unknown" : classification.kind);
  let source: ImportAnalysis["source"] = "deterministic";
  let aiReason: string | undefined;
  let aiMapping: RegisterMapping | undefined;

  if (!opts.kindOverride && (kind === "unknown" || !detectRegisterMapping(table, kind === "leverantorer" ? "leverantorer" : "kunder").mapping.name)) {
    const suggestion = opts.allowAi === false ? null : await aiSuggestTableMapping(table);
    if (suggestion && suggestion.kind !== "unknown") {
      if (kind === "unknown") kind = suggestion.kind;
      source = "ai";
      aiReason = suggestion.reason;
      aiMapping = suggestion.mapping;
    }
  }

  if (kind === "artiklar") {
    return analyzeArticles(parsed, base, { articleMapping: opts.articleMapping, source, aiReason, canChooseKind: true });
  }
  if (kind === "kunder" || kind === "leverantorer") {
    return analyzeRegister(table, kind, base, { mapping: opts.mapping, source, aiReason, aiMapping, canChooseKind: true });
  }
  return {
    ...base,
    kind: "unknown",
    title: filename,
    subtitle: `${fileKind === "xlsx" ? "Excel" : fileKind.toUpperCase()} • ${sv(table.rows.length)} rader • okänt innehåll`,
    source,
    canChooseKind: true,
    message: `${classification.reason} Välj vad filen innehåller så visar vi kolumnerna.`,
    warnings: [],
    register: {
      kind: "kunder",
      headers: table.headers,
      sampleRows: table.rows.slice(0, 5),
      rowCount: table.rows.length,
      mapping: {},
      confidence: {},
      fields: registerFields("kunder"),
      problems: ["Välj vad filen innehåller."],
      created: 0,
      duplicates: [],
      invalid: [],
      review: [],
      unmapped: table.headers,
    },
  };
}

/* ---------------------------------- import ---------------------------------- */

export interface ImportChoices {
  kind: DataImportKind;
  /** Hashen från analysen – filen måste vara oförändrad. */
  expectedHash: string;
  /** SIE: #RAR-index att ta med. */
  yearIndexes?: number[];
  /** Register: bekräftad kolumnmappning. */
  mapping?: RegisterMapping;
  /** Artiklar: grossistanslutning + ev. mappning. */
  connectionId?: string;
  articleMapping?: WholesalerColumnMapping;
  userId?: string | null;
}

export interface ImportOutcome {
  ok: true;
  importId: string;
  kind: DataImportKind;
  summary: string;
  created: number;
  updated: number;
  ignored: number;
  warnings: string[];
  /** Vart användaren kan fortsätta. */
  nextHref: string;
  nextLabel: string;
}

function assertNotImported(hash: string, kind: DataImportKind): void {
  const already = alreadyImportedFor(hash, kind);
  if (already) {
    throw new DataImportError(`Den här filen är redan importerad (${already.at.slice(0, 10)}: ${already.summary}). Samma fil importeras inte två gånger.`);
  }
}

function recordImport(row: Omit<DataImport, "id" | "createdAt"> & { id?: string }): DataImport {
  const data = db();
  const entry: DataImport = { id: row.id ?? uid(), createdAt: new Date().toISOString(), ...row };
  data.dataImports = [...(data.dataImports ?? []), entry];
  return entry;
}

/**
 * Genomför importen. Körs av anroparen inne i withBusiness: allt eller inget.
 * Artiklar/priser går via grossistmodulens egen (redan atomära) import –
 * anroparen skickar då en runner för dess steg.
 */
export async function runImport(
  bytes: Buffer,
  filename: string,
  choices: ImportChoices,
  runner?: ImportRunner,
): Promise<ImportOutcome> {
  const hash = fileHashHex(bytes);
  if (hash !== choices.expectedHash) {
    throw new DataImportError("Filen har ändrats sedan förhandsgranskningen. Ladda upp den igen och kontrollera på nytt.");
  }
  const now = new Date().toISOString();
  const importId = uid();

  if (choices.kind === "bokforing") {
    assertNotImported(hash, "bokforing");
    let file: SieFile;
    try {
      file = parseSie(bytes);
    } catch (e) {
      throw new DataImportError(e instanceof SieParseError ? e.message : "SIE-filen kunde inte läsas.");
    }
    const yearIndexes = choices.yearIndexes ?? [];
    const result = applySieImport(file, db(), { yearIndexes, importId }, now);
    const warnings = [...result.warnings];
    if (result.skippedUnbalanced) warnings.push(`${result.skippedUnbalanced} verifikationer balanserade inte i filen och togs inte med.`);
    if (result.skippedDuplicates) warnings.push(`${result.skippedDuplicates} dubbletter i filen hoppades över.`);
    if (result.skippedCollisions) warnings.push(`${result.skippedCollisions} verifikationer hade nummer som redan fanns och hoppades över.`);
    recordImport({
      id: importId,
      kind: "bokforing",
      status: "imported",
      filename,
      fileKind: "sie",
      fileHash: hash,
      fileSize: bytes.length,
      userId: choices.userId ?? null,
      choices: { yearIndexes, program: file.program ?? null, encoding: file.encoding },
      created: result.verificationsCreated,
      updated: result.fiscalYearsUpdated,
      ignored: result.skippedUnbalanced + result.skippedDuplicates + result.skippedCollisions,
      warnings,
      summary: result.summary,
      completedAt: now,
    });
    logActivity(`Bokföring flyttades in från SIE-fil: ${result.summary}.`);
    save();
    return {
      ok: true,
      importId,
      kind: "bokforing",
      summary: result.summary,
      created: result.verificationsCreated,
      updated: result.fiscalYearsUpdated,
      ignored: result.skippedUnbalanced + result.skippedDuplicates + result.skippedCollisions,
      warnings,
      nextHref: "/bokforing",
      nextLabel: "Öppna bokföringen",
    };
  }

  if (choices.kind === "kunder" || choices.kind === "leverantorer") {
    assertNotImported(hash, choices.kind);
    let parsed: ReturnType<typeof parsePriceFile>;
    try {
      parsed = parsePriceFile(bytes, filename);
    } catch (e) {
      throw new DataImportError(e instanceof PriceFileError ? e.message : "Filen kunde inte läsas.");
    }
    const mapping = choices.mapping ?? detectRegisterMapping(parsed.table, choices.kind).mapping;
    const problems = registerMappingProblems(sanitizeRegisterMapping(parsed.table, choices.kind, mapping));
    if (problems.length) throw new DataImportError(problems[0]);
    const data = db();
    let created = 0;
    let ignored = 0;
    const warnings: string[] = [];
    let summary: string;
    if (choices.kind === "kunder") {
      const preview = previewCustomerImport(parsed.table, mapping, data.customers);
      if (preview.drafts.length === 0 && preview.duplicates.length === 0) {
        throw new DataImportError("Inga kunder gick att läsa ur filen. Kontrollera kolumnvalen.");
      }
      const customers = customersFromDrafts(preview.drafts, now);
      data.customers.push(...customers);
      preview.drafts.forEach((draft, i) => {
        draft.propertyDesignations.forEach((designation, index) => {
          addWorkLocation(customers[i].id, {
            label: designation,
            address: "",
            propertyType: "smahus",
            propertyDesignation: designation,
            asDefault: index === 0,
          });
        });
      });
      created = customers.length;
      ignored = preview.duplicates.length + preview.invalid.length;
      warnings.push(...preview.review.map((r) => `Rad ${r.line}: ${r.message}`).slice(0, 50));
      if (preview.duplicates.length) warnings.push(`${preview.duplicates.length} kunder fanns redan och hoppades över.`);
      summary = `${sv(created)} ${created === 1 ? "kund" : "kunder"}`;
      logActivity(`${summary} flyttades in från ${filename}.`);
    } else {
      const preview = previewSupplierImport(parsed.table, mapping, data.suppliers ?? []);
      if (preview.drafts.length === 0 && preview.duplicates.length === 0) {
        throw new DataImportError("Inga leverantörer gick att läsa ur filen. Kontrollera kolumnvalen.");
      }
      const suppliers = suppliersFromDrafts(preview.drafts, now);
      data.suppliers = [...(data.suppliers ?? []), ...suppliers];
      created = suppliers.length;
      ignored = preview.duplicates.length + preview.invalid.length;
      warnings.push(...preview.review.map((r) => `Rad ${r.line}: ${r.message}`).slice(0, 50));
      if (preview.duplicates.length) warnings.push(`${preview.duplicates.length} leverantörer fanns redan och hoppades över.`);
      summary = `${sv(created)} ${created === 1 ? "leverantör" : "leverantörer"}`;
      logActivity(`${summary} flyttades in från ${filename}.`);
    }
    recordImport({
      id: importId,
      kind: choices.kind,
      status: "imported",
      filename,
      fileKind: parsed.detected.kind,
      fileHash: hash,
      fileSize: bytes.length,
      userId: choices.userId ?? null,
      choices: { mapping },
      created,
      updated: 0,
      ignored,
      warnings,
      summary,
      completedAt: now,
    });
    save();
    return {
      ok: true,
      importId,
      kind: choices.kind,
      summary,
      created,
      updated: 0,
      ignored,
      warnings,
      nextHref: choices.kind === "kunder" ? "/kunder" : "/ekonomi?flik=utgifter",
      nextLabel: choices.kind === "kunder" ? "Visa kunderna" : "Visa leverantörerna",
    };
  }

  // Artiklar/priser: grossistmodulens import (egen atomär trestegsprocess).
  if (!runner) throw new DataImportError("Artikelimporten behöver en körning per steg.");
  if (!choices.connectionId) throw new DataImportError("Välj vilken grossist prislistan hör till.");
  const connectionId = choices.connectionId;
  await runner(() => {
    if (!wholesalersEnabled(db())) throw new DataImportError("Grossistbeställningar är avstängd. Aktivera funktionen under Inställningar → Funktioner först.");
    assertNotImported(hash, "artiklar");
  });
  const outcome = await importPriceFile({ connectionId, filename, bytes, mapping: choices.articleMapping }, runner);
  if (!outcome.ok) {
    await runner(() => {
      recordImport({
        id: importId,
        kind: "artiklar",
        status: "failed",
        filename,
        fileKind: filename.split(".").pop()?.toLowerCase() ?? "",
        fileHash: hash,
        fileSize: bytes.length,
        userId: choices.userId ?? null,
        choices: { connectionId },
        created: 0,
        updated: 0,
        ignored: 0,
        warnings: (outcome.errors ?? []).slice(0, 20).map((e) => `Rad ${e.row}: ${e.message}`),
        summary: "",
        error: outcome.error,
        completedAt: new Date().toISOString(),
      });
      save();
    });
    throw new DataImportError(outcome.error);
  }
  const summary = `${sv(outcome.productCount)} artiklar`;
  await runner(() => {
    recordImport({
      id: importId,
      kind: "artiklar",
      status: "imported",
      filename,
      fileKind: filename.split(".").pop()?.toLowerCase() ?? "",
      fileHash: hash,
      fileSize: bytes.length,
      userId: choices.userId ?? null,
      choices: { connectionId, priceImportId: outcome.importId },
      created: outcome.productCount,
      updated: 0,
      ignored: 0,
      warnings: [],
      summary,
      completedAt: new Date().toISOString(),
    });
    logActivity(`${summary} flyttades in från ${filename}.`);
    save();
  });
  return {
    ok: true,
    importId,
    kind: "artiklar",
    summary,
    created: outcome.productCount,
    updated: 0,
    ignored: 0,
    warnings: outcome.discountLetter ? ["Filen var ett rabattbrev: rabattgrupperna är sparade på grossisten."] : [],
    nextHref: "/installningar?flik=grossister",
    nextLabel: "Visa artiklar och priser",
  };
}

export function listDataImports(): DataImport[] {
  return (db().dataImports ?? []).slice().sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt));
}
