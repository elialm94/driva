import { canonicalizeUnitPrice, isUnsetUnitPrice } from "./line-defaults";
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

export type PriceLineIssue = {
  field: "description" | "price";
  message: string;
};

/**
 * Gemensam validering för offert-, faktura- och uppdragsrader.
 * 0 kr är ett giltigt à-pris. Tom beskrivning är det enda hårda kravet.
 */
export function validatePriceLine(line: {
  description?: string | null;
  unitPrice?: number | string | null;
}): PriceLineIssue[] {
  const issues: PriceLineIssue[] = [];
  if (!line.description?.trim()) {
    issues.push({ field: "description", message: "Beskrivning saknas på raden." });
  }
  if (!isUnsetUnitPrice(line.unitPrice) && !Number.isFinite(Number(line.unitPrice))) {
    issues.push({ field: "price", message: "À-priset är ogiltigt." });
  }
  return issues;
}

/**
 * Orörd startrad (ingen beskrivning, à-pris 0/osatt) – sparas inte.
 * Beskrivning + 0 kr är en riktig kostnadsfri rad och rensas inte.
 */
export function lineIsBlank(line: LineLike): boolean {
  return !line.description.trim() && (isUnsetUnitPrice(line.unitPrice) || line.unitPrice === 0);
}

/** Vad som saknas på en påbörjad rad. Blanka rader räknas inte i UI:t. */
export function lineMissingParts(line: LineLike): { description: boolean; price: boolean } {
  if (lineIsBlank(line)) return { description: false, price: false };
  const issues = validatePriceLine(line);
  return {
    description: issues.some((i) => i.field === "description"),
    price: issues.some((i) => i.field === "price"),
  };
}

/** Raderna som faktiskt sparas: rader utan beskrivning rensas bort. Tomt à-pris → 0. */
export function prunedLines<T extends LineLike>(lines: T[]): T[] {
  return lines
    .filter((line) => !lineIsBlank(line))
    .map((line) => ({ ...line, unitPrice: canonicalizeUnitPrice(line.unitPrice) }));
}

export function hasCompleteLine(lines: LineLike[]): boolean {
  return lines.some((line) => line.description.trim());
}

/** Per-rad-krav med mänskliga etiketter: "Beskrivning på första raden". 0 kr är giltigt. */
export function lineRequirements(lines: DocLine[]): MissingRequirement[] {
  const started = lines.filter((line) => !lineIsBlank(line));
  if (started.length === 0) {
    return [
      {
        id: "rader",
        label: "Minst en prisrad med beskrivning",
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
