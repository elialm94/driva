/**
 * Gemensamma byggstenar för myndighetsfilerna.
 *
 * Skatteverkets filformat är gamla och petiga: eSKD och SRU vill ha
 * ISO 8859-1 och CRLF, alla belopp i hela kronor utan tusenavgränsare, och
 * organisationsnummer ibland med bindestreck och ibland tolvsiffrigt med
 * sekelprefix. Reglerna hör inte hemma i varje filbyggare för sig, så de bor
 * här och används av eskd.ts, agi-xml.ts, sru.ts och ixbrl.ts.
 *
 * Ingen av filerna skickas någonstans av Driva. De laddas ner av användaren
 * och lämnas in i Skatteverkets eller Bolagsverkets egna tjänster.
 */

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * ISO 8859-1 (latin-1). Tecken utanför tabellen ersätts med närmaste
 * latinska motsvarighet där en sådan finns, annars med frågetecken – en
 * avvisad fil är sämre än ett bolagsnamn med "e" i stället för "ě".
 */
export function encodeLatin1(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text.replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')) {
    const code = ch.codePointAt(0) ?? 0x3f;
    if (code <= 0xff) {
      bytes.push(code);
      continue;
    }
    const stripped = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").codePointAt(0);
    bytes.push(stripped !== undefined && stripped <= 0xff ? stripped : 0x3f);
  }
  return new Uint8Array(bytes);
}

/** Hela kronor, utan decimaler och utan tusenavgränsare. Minus tillåts. */
export function heltalKronor(amount: number): string {
  return String(Math.round(amount));
}

/** Bara siffrorna: "556677-8899" → "5566778899". */
export function orgNumberDigits(orgNumber: string): string {
  return orgNumber.replace(/\D/g, "");
}

/**
 * Tiosiffrigt med bindestreck – formen eSKD vill ha i OrgNr.
 * Ett tolvsiffrigt nummer kortas ner: sekelprefixet hör inte hit.
 */
export function orgNumber10(orgNumber: string): string {
  const digits = orgNumberDigits(orgNumber);
  const ten = digits.length === 12 ? digits.slice(2) : digits;
  if (ten.length !== 10) throw new FilingDataError("Organisationsnummer saknas eller är ogiltigt.", ["orgNumber"]);
  return `${ten.slice(0, 6)}-${ten.slice(6)}`;
}

/**
 * Tolvsiffrigt utan bindestreck – formen SRU och AGI vill ha. Juridiska
 * personer prefixas med 16, fysiska med sekel (19/20 finns redan i numret).
 */
export function orgNumber12(orgNumber: string): string {
  const digits = orgNumberDigits(orgNumber);
  if (digits.length === 12) return digits;
  if (digits.length !== 10) throw new FilingDataError("Organisationsnummer saknas eller är ogiltigt.", ["orgNumber"]);
  return `16${digits}`;
}

/** Personnummer tolvsiffrigt utan bindestreck – AGI:s BetalningsmottagarId. */
export function personnummer12(personnummer: string): string {
  const digits = personnummer.replace(/\D/g, "");
  if (digits.length === 12) return digits;
  if (digits.length !== 10) {
    throw new FilingDataError(`Personnummret ${personnummer} går inte att tolka.`, ["personnummer"]);
  }
  // Tvåsiffrigt år: 00–29 tolkas som 2000-talet, resten som 1900-talet. Ingen
  // anställd är född före 1930 och ingen är född efter i dag.
  const yy = Number(digits.slice(0, 2));
  return `${yy <= 29 ? "20" : "19"}${digits}`;
}

/** YYYYMM ur ett ISO-datum eller en YYYY-MM-månad. */
export function periodYYYYMM(isoDateOrMonth: string): string {
  return isoDateOrMonth.slice(0, 7).replace("-", "");
}

/** YYYYMMDD ur ett ISO-datum. */
export function dateYYYYMMDD(isoDate: string): string {
  return isoDate.slice(0, 10).replace(/-/g, "");
}

export const CRLF = "\r\n";

/** Rader till en fil med CRLF och avslutande radbrytning, som formaten kräver. */
export function crlfFile(lines: string[]): string {
  return lines.join(CRLF) + CRLF;
}

/**
 * Uppgifter saknas för att bygga filen. Kastas med en text som går att visa
 * för användaren: en fil som avvisas vid uppladdning hjälper ingen, så det är
 * bättre att säga vad som fattas.
 */
export class FilingDataError extends Error {
  constructor(
    message: string,
    readonly missingFields: string[] = []
  ) {
    super(message);
    this.name = "FilingDataError";
  }
}
