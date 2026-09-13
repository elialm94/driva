/**
 * Plus-tagg i inkommande adress: foretaget+FV-1042@in.ferva.se.
 *
 * Tenant löses ALDRIG härifrån. Sluggen är local-part före +, samma som
 * inboundSlugFromTo. Taggen är bara en kandidat för uppdragsmatchning
 * efter att tenanten redan är identifierad.
 */
import { FERVA_REFERENCE_RE } from "../wholesalers/confirmation-parse";

export function inboundPlusTagFromTo(to: string): string | null {
  const trimmed = to.trim().toLowerCase();
  const angle = trimmed.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : trimmed).split(",")[0]?.trim() ?? "";
  const at = addr.lastIndexOf("@");
  if (at <= 0) return null;
  const local = addr.slice(0, at);
  const plus = local.indexOf("+");
  if (plus < 0) return null;
  const tag = local.slice(plus + 1).trim();
  return tag || null;
}

/** Normaliserad Ferva-referens ur en plus-tagg, eller null om det inte är FV-n. */
export function fervaRefFromPlusTag(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const compact = tag.replace(/\s+/g, "").toUpperCase();
  const m = FERVA_REFERENCE_RE.exec(compact);
  return m ? `FV-${m[1]}` : null;
}

/**
 * Plus-adressering i UI:n. Resend Receiving tar emot catch-all på in.ferva.se,
 * men plus-taggen är inte verifierad mot en riktig leverans i den här
 * kodbasen. Påstå därför inte att +FV-1042 fungerar i produktion.
 */
export function inboundPlusAddressingVerified(): boolean {
  return process.env.INBOUND_PLUS_ADDRESSING === "verified";
}
