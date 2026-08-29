import type { DocLine } from "./types";

/**
 * Delat mönster för formulärvalidering: varje större formulär beräknar en
 * lista "vad saknas?" från sitt state. Listan visas i FormValidationSummary
 * intill knappen, och varje post kan fokusera sitt fält (fieldId) eller
 * länka vidare (href). Etiketterna är mänsklig svenska – aldrig fältnamn.
 *
 * Utkast kräver bara det som behövs för att spara; full "skicka"-validering
 * bor i domänlagret (validateInvoiceForIssue m.fl.) och presenteras av UI:t.
 */
export interface MissingRequirement {
  id: string;
  /** Mänsklig svensk etikett, t.ex. "Rubrik" eller "Pris på raden ”Montör”". */
  label: string;
  /** DOM-id att rulla till och fokusera. */
  fieldId?: string;
  /** Alternativ: länk (t.ex. till en annan inställningsflik). */
  href?: string;
}

export type RequirementMode = "draft" | "send";

const ORDINALS = ["första", "andra", "tredje", "fjärde", "femte", "sjätte", "sjunde", "åttonde", "nionde", "tionde"];

/** "första raden", "andra raden" … faller tillbaka på "rad 11". */
export function radLabel(index: number): string {
  return index < ORDINALS.length ? `${ORDINALS[index]} raden` : `rad ${index + 1}`;
}

export function lineFieldId(lineId: string, part: "beskrivning" | "pris"): string {
  return `rad-${lineId}-${part}`;
}

type LineLike = Pick<DocLine, "description" | "unitPrice">;

/** Orörd rad (ingen beskrivning, inget à-pris) – sparas inte och felmarkeras inte. */
export function lineIsBlank(line: LineLike): boolean {
  return !line.description.trim() && line.unitPrice === 0;
}

/** Vad som saknas på en påbörjad rad. Blanka rader räknas inte. */
export function lineMissingParts(line: LineLike): { description: boolean; price: boolean } {
  if (lineIsBlank(line)) return { description: false, price: false };
  return { description: !line.description.trim(), price: line.unitPrice === 0 };
}

/** Raderna som faktiskt sparas: orörda rader rensas bort. */
export function prunedLines<T extends LineLike>(lines: T[]): T[] {
  return lines.filter((line) => !lineIsBlank(line));
}

export function hasCompleteLine(lines: LineLike[]): boolean {
  return lines.some((line) => line.description.trim() && line.unitPrice !== 0);
}

/** Per-rad-krav med mänskliga etiketter: "Beskrivning på första raden", "Pris på raden ”Montör”". */
export function lineRequirements(lines: DocLine[]): MissingRequirement[] {
  const started = lines.filter((line) => !lineIsBlank(line));
  if (started.length === 0) {
    return [
      {
        id: "rader",
        label: "Minst en prisrad med beskrivning och pris",
        fieldId: lines[0] ? lineFieldId(lines[0].id, "beskrivning") : "prisrader",
      },
    ];
  }
  const out: MissingRequirement[] = [];
  lines.forEach((line, i) => {
    const missing = lineMissingParts(line);
    if (missing.description) {
      out.push({
        id: `rad-${line.id}-beskrivning`,
        label: `Beskrivning på ${radLabel(i)}`,
        fieldId: lineFieldId(line.id, "beskrivning"),
      });
    }
    if (missing.price) {
      const name = line.description.trim();
      out.push({
        id: `rad-${line.id}-pris`,
        label: name ? `Pris på raden ”${name}”` : `Pris på ${radLabel(i)}`,
        fieldId: lineFieldId(line.id, "pris"),
      });
    }
  });
  return out;
}

export interface QuoteFormState {
  customerId: string;
  title: string;
  lines: DocLine[];
  planPercentTotal: number;
  validUntil: string;
  paymentTermsDays: number;
  /** Behövs bara i läget "send". */
  customerEmail?: string;
}

/** Vad som saknas innan offerten kan sparas som utkast (eller skickas). */
export function quoteMissingRequirements(state: QuoteFormState, mode: RequirementMode = "draft"): MissingRequirement[] {
  const out: MissingRequirement[] = [];
  if (!state.customerId) out.push({ id: "kund", label: "Kund", fieldId: "offert-kund" });
  if (!state.title.trim()) out.push({ id: "rubrik", label: "Rubrik", fieldId: "offert-rubrik" });
  out.push(...lineRequirements(state.lines));
  if (state.planPercentTotal !== 100) {
    out.push({
      id: "betalplan",
      label: `Betalningsplan som summerar till 100 % (nu ${state.planPercentTotal} %)`,
      fieldId: "offert-betalplan",
    });
  }
  if (!state.validUntil) out.push({ id: "giltig-till", label: "Giltig till-datum", fieldId: "offert-giltig-till" });
  if (!Number.isFinite(state.paymentTermsDays) || state.paymentTermsDays < 1) {
    out.push({ id: "betalvillkor", label: "Betalningsvillkor (minst 1 dag)", fieldId: "offert-betalvillkor" });
  }
  if (mode === "send" && !state.customerEmail?.trim()) {
    out.push({ id: "kund-epost", label: "Kundens e-postadress" });
  }
  return out;
}

export interface InvoiceFormState {
  customerId: string;
  lines: DocLine[];
  dueInDays: number;
  /** Behövs bara i läget "send". */
  customerEmail?: string;
}

/**
 * Vad som saknas innan fakturautkastet kan sparas. Full utfärdande-validering
 * (företagsuppgifter, kundadress, totaler …) ligger i validateInvoiceForIssue
 * och visas i checklistan på fakturasidan.
 */
export function invoiceMissingRequirements(state: InvoiceFormState, mode: RequirementMode = "draft"): MissingRequirement[] {
  const out: MissingRequirement[] = [];
  if (!state.customerId) out.push({ id: "kund", label: "Kund", fieldId: "faktura-kund" });
  out.push(...lineRequirements(state.lines));
  if (!Number.isFinite(state.dueInDays) || state.dueInDays < 1) {
    out.push({ id: "betalvillkor", label: "Betalningsvillkor (minst 1 dag)", fieldId: "faktura-betalvillkor" });
  }
  if (mode === "send" && !state.customerEmail?.trim()) {
    out.push({ id: "kund-epost", label: "Kundens e-postadress" });
  }
  return out;
}
