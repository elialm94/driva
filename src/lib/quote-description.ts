/**
 * EN kanonisk beskrivning per offert.
 *
 * Historik: offerten hade två överlappande fritextfält – "Beskrivning av
 * arbetet" (`QuoteVersion.intro`, ren text) och rik text-fältet Beskrivning
 * (`QuoteVersion.richText`). Numera är rik texten offertens enda
 * beskrivningsfält (samma modell som fakturan). Äldre data migreras genom
 * att intro-texten flyttas in ÖVERST i rik text-dokumentet som vanliga
 * stycken – ingen information får försvinna.
 *
 * VIKTIGT: BankID-låsta versioner är hash-frysta (`quoteVersionHash`
 * inkluderar intro) och får ALDRIG muteras – för dem slås fälten i stället
 * ihop vid rendering via `quoteDescriptionDoc`, så dokumentet visar samma
 * innehåll utan att signeringsunderlaget bryts.
 *
 * Lagringslägen:
 *   * JSON (dev): `store.normalize()` migrerar olåsta versioner och
 *     persisterar – samma mönster som övriga hydreringar.
 *   * Supabase (produktion): `quote_versions.payload` bär hela QuoteVersion
 *     som jsonb, så ingen SQL-migrering behövs (samma slutsats som
 *     rik text-migreringen, 11_richtext.sql). Olåsta payloads uppgraderas
 *     vid läsning i mapparen och skrivs tillbaka nästa gång versionen ändras.
 */

import type { DB, QuoteVersion } from "./types";
import type { RichTextBlock, RichTextDoc, RichTextInline } from "./richtext";
import { sanitizeRichText } from "./richtext";

/**
 * Ren text → stycken. Blankrad = nytt stycke, enkel radbrytning = hård
 * radbrytning. Texten tolkas ALDRIG som markdown – gamla beskrivningar
 * ska bevaras bokstavligt.
 */
export function plainTextToRichTextBlocks(text: string): RichTextBlock[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  return normalized.split(/\n{2,}/).map((paragraph) => {
    const content: RichTextInline[] = [];
    paragraph.split("\n").forEach((line, i) => {
      if (i > 0) content.push({ type: "hardBreak" });
      const trimmed = line.trim();
      if (trimmed) content.push({ type: "text", text: trimmed });
    });
    return { type: "paragraph", content };
  });
}

/** Ren text → sanerad RichTextDoc. Tom/blank text → undefined (fältet utelämnas). */
export function plainTextToRichText(text: string | null | undefined): RichTextDoc | undefined {
  if (!text) return undefined;
  const blocks = plainTextToRichTextBlocks(text);
  if (blocks.length === 0) return undefined;
  return sanitizeRichText({ type: "doc", content: blocks });
}

/**
 * Offertens kanoniska beskrivning: legacy-intro (om den finns kvar) följt av
 * rik texten. Ren funktion – muterar ingenting, så den är säker även för
 * hash-frysta (låsta) versioner. Alla ytor (dokument, PDF, editor, AI)
 * läser beskrivningen härifrån.
 */
export function quoteDescriptionDoc(
  version: Pick<QuoteVersion, "intro" | "richText">
): RichTextDoc | undefined {
  const introBlocks = version.intro ? plainTextToRichTextBlocks(version.intro) : [];
  if (introBlocks.length === 0) return version.richText;
  return sanitizeRichText({
    type: "doc",
    content: [...introBlocks, ...(version.richText?.content ?? [])],
  });
}

/**
 * Migrera EN versions beskrivning: flytta intro in överst i rik texten och
 * ta bort fältet. Låsta versioner rörs aldrig (hash-fryst yta – de slås
 * ihop vid rendering i stället). Idempotent; returnerar true vid ändring.
 */
export function migrateQuoteVersionDescription(version: QuoteVersion): boolean {
  if (version.intro === undefined) return false;
  if (version.lockedAt) return false;
  const merged = quoteDescriptionDoc(version);
  // Tom intro ("") lämnar rik texten orörd – bara fältet städas bort.
  if (merged) version.richText = merged;
  delete version.intro;
  return true;
}

/** Migrera alla olåsta versioner (JSON-lagrets normalize + tester). */
export function migrateQuoteDescriptions(data: DB): boolean {
  let changed = false;
  for (const version of data.quoteVersions) {
    if (migrateQuoteVersionDescription(version)) changed = true;
  }
  return changed;
}
