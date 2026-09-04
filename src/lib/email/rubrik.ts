import type { Invoice } from "../types";
import type { RichTextDoc } from "../richtext";
import { richTextToPlain } from "../richtext";
import { invoiceTypeLabel } from "../invoices/display";
import { currentVersion, getJob, getQuote } from "../services/data";

/** Ämnesraden ska vara kort; dokumenttext kan vara ett helt stycke. */
const SUBJECT_RUBRIK_MAX = 120;

const GENERIC_RUBRIK = /^(faktura|offert|kreditfaktura|delbetalning|slutfaktura)$/i;

/** En rad, utan extra whitespace. Tom sträng om inget läsbart finns. */
export function collapseSubjectRubrik(text: string | null | undefined): string {
  const one = (text ?? "").replace(/\s+/g, " ").trim();
  if (!one) return "";
  if (one.length <= SUBJECT_RUBRIK_MAX) return one;
  const cut = one.slice(0, SUBJECT_RUBRIK_MAX - 1);
  const atSpace = cut.lastIndexOf(" ");
  const base = atSpace >= 40 ? cut.slice(0, atSpace) : cut;
  return `${base.trimEnd()}…`;
}

export function isGenericSubjectRubrik(text: string): boolean {
  return GENERIC_RUBRIK.test(text.trim());
}

/**
 * `Faktura från Bolaget – Rubrik` / `Offert från Bolaget – Rubrik`.
 * Utelämnar ` – rubrik` när rubriken saknas eller bara upprepar dokumenttypen.
 */
export function documentFromCompanySubject(kind: "Offert" | "Faktura", company: string, rubrik: string): string {
  return appendSubjectRubrik(`${kind} från ${company}`, rubrik);
}

/**
 * `Påminnelse: faktura från Bolaget – Rubrik` (eller offert).
 * Utelämnar ` – rubrik` när rubriken saknas eller bara upprepar dokumenttypen.
 */
export function reminderFromCompanySubject(kind: "faktura" | "offert", company: string, rubrik: string): string {
  return appendSubjectRubrik(`Påminnelse: ${kind} från ${company}`, rubrik);
}

function appendSubjectRubrik(base: string, rubrik: string): string {
  const title = collapseSubjectRubrik(rubrik);
  if (!title || isGenericSubjectRubrik(title)) return base;
  return `${base} – ${title}`;
}

function firstRichTextLine(doc: RichTextDoc | null | undefined): string {
  const plain = richTextToPlain(doc).trim();
  if (!plain) return "";
  const first = plain.split(/\n/)[0] ?? "";
  return collapseSubjectRubrik(first);
}

function firstLineDescription(invoice: Invoice): string {
  const lines = invoice.issuedSnapshot?.lines ?? invoice.lines;
  for (const line of lines) {
    const description = collapseSubjectRubrik(line.description);
    if (description) return description;
  }
  return "";
}

/**
 * Rubrik utan löpnummer – samma heading-känsla som offertens titel på PDF:en.
 *
 * 1. Kopplad offertversions titel (dokumentets rubrik)
 * 2. Första prisradens beskrivning (syns på faktura-PDF)
 * 3. Kopplat uppdrags titel
 * 4. Första raden i övrig information (rich text)
 * 5. Dokumenttyp utan nummer (`Faktura`) – ger ingen extra ` – Faktura` i ämnet
 */
export function invoiceEmailRubrik(invoice: Invoice): string {
  if (invoice.quoteId) {
    const quote = getQuote(invoice.quoteId);
    const title = quote ? collapseSubjectRubrik(currentVersion(quote).title) : "";
    if (title) return title;
  }

  const firstLine = firstLineDescription(invoice);
  if (firstLine) return firstLine;

  if (invoice.jobId) {
    const job = getJob(invoice.jobId);
    const title = collapseSubjectRubrik(job?.title);
    if (title) return title;
  }

  const rich = firstRichTextLine(invoice.issuedSnapshot?.richText ?? invoice.richText);
  if (rich) return rich;

  return invoiceTypeLabel(invoice.type);
}
