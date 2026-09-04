/**
 * Läsbara inbound-sluggar från företagsnamn.
 *
 * Slugen är local-part i {slug}@{INBOUND_MAIL_DOMAIN}. Kunden väljer eller
 * redigerar den aldrig. Namnbyte skriver inte om en redan tilldelad slug.
 */

export const INBOUND_MAIL_SLUG_MAX = 24;
export const INBOUND_MAIL_SLUG_FALLBACK = "foretag";

/** Local-parts som inte får användas nakna – behandlas som upptagna. */
export const RESERVED_INBOUND_LOCAL_PARTS = [
  "demo",
  "inbox",
  "postmaster",
  "noreply",
  "support",
  "admin",
  "mail",
  "www",
  "root",
  "ferva",
  "driva",
] as const;

const COMPANY_FORM_WORDS = /\b(ab|hb|kb|eftr|aktiebolag)\b/g;
const HEX_INBOUND_SLUG = /^[0-9a-f]{12}$/;
const MAX_ALLOC_ATTEMPTS = 10_000;

export function isReservedInboundLocalPart(slug: string): boolean {
  return (RESERVED_INBOUND_LOCAL_PARTS as readonly string[]).includes(slug);
}

export function isLegacyHexInboundSlug(slug: string | undefined | null): boolean {
  return Boolean(slug && HEX_INBOUND_SLUG.test(slug));
}

export function isInboundMailItem(item: { kind?: string; source?: string }): boolean {
  return item.kind === "mail" || item.source === "email" || item.source === "vidarebefordrad";
}

export function shouldRemintHexInboundSlug(
  slug: string | undefined,
  inboxItems: Array<{ kind?: string; source?: string }>,
): boolean {
  if (!isLegacyHexInboundSlug(slug)) return false;
  return !inboxItems.some(isInboundMailItem);
}

/**
 * Normaliserar företagsnamn till en slug-bas (utan unikt suffix).
 * Åäö-fold som hemsideslugen, men utan bindestreck – bara a-z och 0-9.
 */
export function slugFromCompanyName(name: string): string {
  const folded = name
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o");
  const withoutForms = folded.replace(COMPANY_FORM_WORDS, " ");
  const compact = withoutForms.replace(/[^a-z0-9]+/g, "").slice(0, INBOUND_MAIL_SLUG_MAX);
  return compact.length < 3 ? INBOUND_MAIL_SLUG_FALLBACK : compact;
}

export function allocateInboundMailSlug(
  name: string,
  isOccupied: (slug: string) => boolean,
): string {
  const base = slugFromCompanyName(name);
  let candidate = base;
  let n = 2;
  for (let i = 0; i < MAX_ALLOC_ATTEMPTS; i++) {
    if (!isReservedInboundLocalPart(candidate) && !isOccupied(candidate)) return candidate;
    candidate = `${base}${n}`;
    n += 1;
  }
  throw new Error("Kunde inte allokera inbound-slug.");
}

export async function allocateInboundMailSlugAsync(
  name: string,
  isOccupied: (slug: string) => boolean | Promise<boolean>,
): Promise<string> {
  const base = slugFromCompanyName(name);
  let candidate = base;
  let n = 2;
  for (let i = 0; i < MAX_ALLOC_ATTEMPTS; i++) {
    if (!isReservedInboundLocalPart(candidate) && !(await isOccupied(candidate))) return candidate;
    candidate = `${base}${n}`;
    n += 1;
  }
  throw new Error("Kunde inte allokera inbound-slug.");
}
