/**
 * Primitiver som hela domänen delar.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

export type ID = string;
/**
 * V1: inhemsk svensk moms. Omvänd byggmoms finns (då är radens sats 0 och
 * köparen redovisar momsen, se lib/invoices/reverse-charge). EU-handel,
 * export och vinstmarginalbeskattning stöds inte.
 */
export type VatRate = 0 | 6 | 12 | 25;
/**
 * Redovisningsperiod för moms. Skatteverket registrerar företaget för en av
 * dessa utifrån beskattningsunderlagets storlek: helår upp till 1 mkr, kvartal
 * upp till 40 mkr (huvudregel), månad över 40 mkr eller på egen begäran.
 */
export type VatPeriodicity = "manad" | "kvartal" | "helar";
