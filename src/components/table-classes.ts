/**
 * Klasser för listtabeller där hela raden är klickbar.
 *
 * Raden görs klickbar med en länk som täcker den (absolute inset-0). Tekniken
 * kräver att <tr> är ett containing block, och där skiljer sig webbläsarna:
 * med border-collapse: collapse ignorerar WebKit position: relative på
 * tabellrader. Länken sträcker sig då i stället över hela sidan, och den
 * sista radens länk slukar klick på filter och knappar ovanför tabellen –
 * ett klick på ett statusfilter öppnade den sista offerten i listan.
 *
 * Därför två lager:
 *   * Tabellen separerar sina kanter, så raden blir ett containing block även
 *     i WebKit. Linjerna ritas på cellerna eftersom rader inte kan ha kanter
 *     i den separerade modellen – utseendet är detsamma.
 *   * Kortet runt tabellen är positionerat, så att en radlänk aldrig kan nå
 *     utanför tabellen ens i en webbläsare som ignorerar raden.
 */

export const LIST_CARD_CLASS = "relative overflow-hidden";

export const LIST_TABLE_CLASS = "w-full border-separate border-spacing-0 text-left text-[14px]";

export const LIST_HEAD_ROW_CLASS =
  "text-[12px] font-medium uppercase tracking-wide text-muted [&>th]:border-b [&>th]:border-line/80";

export const LIST_BODY_ROW_CLASS =
  "relative hover:bg-canvas/70 [&>td]:border-b [&>td]:border-line/60 last:[&>td]:border-0";

/** Länken som gör hela raden klickbar. */
export const LIST_ROW_LINK_CLASS = "absolute inset-0 z-10";
