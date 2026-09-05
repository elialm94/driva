/**
 * SIE 4 / 4E-läsare (SIE-gruppens specifikation "SIE 4B/4E"). Deterministisk,
 * utan externa beroenden, tolerant mot de varianter som förekommer i svenska
 * bokföringsprogram:
 *
 *   * teckenkodning PC8 (CP437) enligt standarden, UTF-8 (med/utan BOM) när
 *     filen faktiskt är det
 *   * citerade fält med \" inuti, objektlistor {dim "kod"}, klammerblock för #VER
 *   * #RTRANS/#BTRANS (tillagda/borttagna rader) ignoreras – #TRANS är det som gäller
 *   * belopp med punkt eller komma som decimaltecken → heltalsören
 *   * datum YYYYMMDD → YYYY-MM-DD
 *
 * Läsaren dömer inte: obalanser, dubbletter och konflikter rapporteras av
 * förhandsgranskningen (sie-preview.ts). Här samlas bara fakta + varningar om
 * rader som inte kunde tolkas.
 */

export interface SieYear {
  /** 0 = aktuellt år, -1 = föregående, … (filens #RAR-index). */
  index: number;
  startDate: string;
  endDate: string;
}

export interface SieBalance {
  yearIndex: number;
  account: number;
  amountOre: number;
}

export interface SieTransaction {
  account: number;
  amountOre: number;
  /** Radens eget datum (#TRANS transdat) – sällan satt. */
  date?: string;
  text?: string;
  objects: { dimension: number; code: string }[];
  lineNo: number;
}

export interface SieVerification {
  series: string;
  /** Saknas i vissa program (tom sträng) – numreras då vid import. */
  number: number | null;
  date: string;
  text: string;
  registeredDate?: string;
  lines: SieTransaction[];
  lineNo: number;
}

export interface SieFile {
  encoding: "pc8" | "utf-8";
  program?: string;
  sieType?: number;
  generatedAt?: string;
  companyName?: string;
  orgNumber?: string;
  years: SieYear[];
  accounts: Map<number, string>;
  /** #DIM: dimensionsnummer → namn (t.ex. 1 Kostnadsställe, 6 Projekt). */
  dimensions: Map<number, string>;
  /** #OBJEKT: "dim:kod" → namn. */
  objects: Map<string, string>;
  openingBalances: SieBalance[];
  closingBalances: SieBalance[];
  results: SieBalance[];
  verifications: SieVerification[];
  /** Rader läsaren inte förstod, med radnummer. */
  warnings: string[];
  /** Filen innehåller minst en SIE-tagg – annars är den inte SIE. */
  looksLikeSie: boolean;
}

export class SieParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SieParseError";
  }
}

/* ------------------------------- teckenkodning ------------------------------ */

/** CP437 (PC8) 0x80–0xFF → Unicode. Svenska tecken plus resten av tabellen. */
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

export function decodePc8(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80] ?? "?";
  }
  return out;
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** UTF-8 med BOM eller #FORMAT UTF8 → utf-8. Ren 7-bit ASCII → oförändrat. Annars PC8. */
export function decodeSieBytes(bytes: Uint8Array): { text: string; encoding: SieFile["encoding"] } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" };
  }
  const hasHigh = bytes.some((b) => b >= 0x80);
  if (!hasHigh) return { text: new TextDecoder("utf-8").decode(bytes), encoding: "pc8" };
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 4000)));
  if (/#FORMAT\s+UTF-?8/i.test(head) && isValidUtf8(bytes)) {
    return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8" };
  }
  // Giltig UTF-8 med flerbytestecken är i praktiken aldrig meningsfull CP437
  // (CP437-svenska ger byte 0x84/0x86/0x94 som inte bildar giltiga UTF-8-sekvenser).
  if (isValidUtf8(bytes)) {
    return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8" };
  }
  return { text: decodePc8(bytes), encoding: "pc8" };
}

/* --------------------------------- tokenisering ----------------------------- */

type Token = { kind: "word"; value: string } | { kind: "objects"; value: string } | { kind: "brace"; value: "{" | "}" };

/** Dela en SIE-rad i fält: ord, "citerade fält" och {objektlistor}. */
export function tokenizeSieLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i];
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (ch === '"') {
      let value = "";
      i++;
      while (i < n) {
        const c = line[i];
        if (c === "\\" && i + 1 < n && line[i + 1] === '"') {
          value += '"';
          i += 2;
          continue;
        }
        if (c === '"') {
          i++;
          break;
        }
        value += c;
        i++;
      }
      tokens.push({ kind: "word", value });
      continue;
    }
    if (ch === "{") {
      // Objektlista på en #TRANS-rad ({} eller {6 "P1"}), eller ett #VER-block som öppnas på samma rad.
      const close = line.indexOf("}", i);
      const rest = line.slice(i + 1).trim();
      if (close === -1 || rest === "") {
        tokens.push({ kind: "brace", value: "{" });
        i++;
        continue;
      }
      tokens.push({ kind: "objects", value: line.slice(i + 1, close) });
      i = close + 1;
      continue;
    }
    if (ch === "}") {
      tokens.push({ kind: "brace", value: "}" });
      i++;
      continue;
    }
    let value = "";
    while (i < n && line[i] !== " " && line[i] !== "\t") {
      value += line[i];
      i++;
    }
    tokens.push({ kind: "word", value });
  }
  return tokens;
}

function words(tokens: Token[]): string[] {
  return tokens.filter((t): t is { kind: "word"; value: string } => t.kind === "word").map((t) => t.value);
}

/* ---------------------------------- tolkning -------------------------------- */

const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;

export function parseSieDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = DATE_RE.exec(raw.trim());
  if (!m) return undefined;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const iso = `${y}-${mo}-${d}`;
  const check = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== iso) return undefined;
  return iso;
}

/** "1234.50" | "-1234,5" | "1234" → ören. null när det inte är ett tal. */
export function parseSieAmountOre(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [whole, frac = ""] = cleaned.replace("-", "").split(".");
  const ore = Number(whole) * 100 + Math.round(Number(`0.${frac || "0"}`) * 100);
  if (!Number.isFinite(ore)) return null;
  return negative ? -ore : ore;
}

function parseObjects(raw: string): { dimension: number; code: string }[] {
  const tokens = words(tokenizeSieLine(raw));
  const out: { dimension: number; code: string }[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const dim = Number(tokens[i]);
    if (Number.isInteger(dim)) out.push({ dimension: dim, code: tokens[i + 1] });
  }
  return out;
}

export interface ParseSieOptions {
  /** Skydd mot orimligt stora filer i förhandsgranskningen. */
  maxVerifications?: number;
}

export const SIE_LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  /** Rimlig övre gräns per fil – större bokföringar exporteras ett år i taget. */
  maxVerifications: 30_000,
} as const;

export function parseSie(bytes: Uint8Array, options: ParseSieOptions = {}): SieFile {
  if (bytes.length > SIE_LIMITS.maxBytes) {
    throw new SieParseError("Filen är för stor (max 25 MB). Exportera ett räkenskapsår i taget.");
  }
  const { text, encoding } = decodeSieBytes(bytes);
  const file: SieFile = {
    encoding,
    years: [],
    accounts: new Map(),
    dimensions: new Map(),
    objects: new Map(),
    openingBalances: [],
    closingBalances: [],
    results: [],
    verifications: [],
    warnings: [],
    looksLikeSie: false,
  };
  const maxVer = options.maxVerifications ?? SIE_LIMITS.maxVerifications;

  const lines = text.split(/\r\n|\n|\r/);
  let current: SieVerification | null = null;
  let inBlock = false;
  let pendingVer: SieVerification | null = null;

  const balance = (list: SieBalance[], w: string[], lineNo: number, tag: string) => {
    const yearIndex = Number(w[1]);
    const account = Number(w[2]);
    const amount = parseSieAmountOre(w[3]);
    if (!Number.isInteger(yearIndex) || !Number.isInteger(account) || amount == null) {
      file.warnings.push(`Rad ${lineNo}: ${tag} kunde inte läsas.`);
      return;
    }
    list.push({ yearIndex, account, amountOre: amount });
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const lineNo = idx + 1;
    const line = raw.trim();
    if (!line) continue;
    const tokens = tokenizeSieLine(line);
    if (tokens.length === 0) continue;

    const first = tokens[0];
    if (first.kind === "brace") {
      if (first.value === "{") {
        if (pendingVer) {
          current = pendingVer;
          pendingVer = null;
          inBlock = true;
        }
      } else if (first.value === "}") {
        if (current) {
          file.verifications.push(current);
          if (file.verifications.length > maxVer) {
            throw new SieParseError(`Filen innehåller fler än ${maxVer.toLocaleString("sv-SE")} verifikationer. Exportera ett år i taget.`);
          }
        }
        current = null;
        inBlock = false;
      }
      continue;
    }
    if (first.kind !== "word" || !first.value.startsWith("#")) {
      if (inBlock) file.warnings.push(`Rad ${lineNo}: oväntad rad inne i en verifikation.`);
      continue;
    }
    file.looksLikeSie = true;
    const tag = first.value.toUpperCase();
    const w = words(tokens);

    switch (tag) {
      case "#FLAGGA":
      case "#FORMAT":
      case "#KPTYP":
      case "#VALUTA":
      case "#TAXAR":
      case "#ADRESS":
      case "#FTYP":
      case "#BKOD":
      case "#OMFATTN":
      case "#PROSA":
      case "#KTYP":
      case "#SRU":
      case "#ENHET":
      case "#UNDERDIM":
      case "#PSALDO":
      case "#PBUDGET":
      case "#OIB":
      case "#OUB":
        break;
      case "#PROGRAM":
        file.program = w.slice(1).join(" ").trim() || undefined;
        break;
      case "#SIETYP":
        file.sieType = Number(w[1]) || undefined;
        break;
      case "#GEN":
        file.generatedAt = parseSieDate(w[1]);
        break;
      case "#FNAMN":
        file.companyName = w[1]?.trim() || undefined;
        break;
      case "#ORGNR":
        file.orgNumber = w[1]?.trim() || undefined;
        break;
      case "#RAR": {
        const index = Number(w[1]);
        const startDate = parseSieDate(w[2]);
        const endDate = parseSieDate(w[3]);
        if (!Number.isInteger(index) || !startDate || !endDate || endDate < startDate) {
          file.warnings.push(`Rad ${lineNo}: räkenskapsåret (#RAR) kunde inte läsas.`);
          break;
        }
        file.years.push({ index, startDate, endDate });
        break;
      }
      case "#KONTO": {
        const account = Number(w[1]);
        if (!Number.isInteger(account) || account < 1000 || account > 9999) {
          file.warnings.push(`Rad ${lineNo}: kontonumret ${w[1] ?? ""} är inte fyrsiffrigt.`);
          break;
        }
        file.accounts.set(account, (w[2] ?? "").trim() || `Konto ${account}`);
        break;
      }
      case "#DIM": {
        const dim = Number(w[1]);
        if (Number.isInteger(dim)) file.dimensions.set(dim, (w[2] ?? "").trim());
        break;
      }
      case "#OBJEKT": {
        const dim = Number(w[1]);
        if (Number.isInteger(dim) && w[2]) file.objects.set(`${dim}:${w[2]}`, (w[3] ?? w[2]).trim());
        break;
      }
      case "#IB":
        balance(file.openingBalances, w, lineNo, "#IB");
        break;
      case "#UB":
        balance(file.closingBalances, w, lineNo, "#UB");
        break;
      case "#RES":
        balance(file.results, w, lineNo, "#RES");
        break;
      case "#VER": {
        // #VER serie nr datum "text" [regdatum] [sign]
        const series = (w[1] ?? "A").trim() || "A";
        const numberRaw = (w[2] ?? "").trim();
        const number = numberRaw === "" ? null : Number(numberRaw);
        const date = parseSieDate(w[3]);
        if (!date || (number != null && !Number.isInteger(number))) {
          file.warnings.push(`Rad ${lineNo}: verifikationen (#VER) saknar giltigt datum eller nummer och hoppas över.`);
          pendingVer = null;
          break;
        }
        const ver: SieVerification = {
          series,
          number,
          date,
          text: (w[4] ?? "").trim(),
          registeredDate: parseSieDate(w[5]),
          lines: [],
          lineNo,
        };
        // Blocket kan öppnas på samma rad ("#VER … {") eller nästa.
        if (tokens.some((t) => t.kind === "brace" && t.value === "{")) {
          current = ver;
          inBlock = true;
        } else {
          pendingVer = ver;
        }
        break;
      }
      case "#TRANS": {
        if (!current) {
          file.warnings.push(`Rad ${lineNo}: transaktionsrad utanför en verifikation hoppas över.`);
          break;
        }
        // #TRANS konto {objekt} belopp [transdat] ["text"] [kvantitet] ["sign"]
        const account = Number(w[1]);
        const objectsToken = tokens.find((t) => t.kind === "objects");
        const amount = parseSieAmountOre(w[2]);
        if (!Number.isInteger(account) || amount == null) {
          file.warnings.push(`Rad ${lineNo}: transaktionsraden kunde inte läsas (konto eller belopp saknas).`);
          break;
        }
        const date = parseSieDate(w[3]);
        const textIdx = date ? 4 : 3;
        const text = w[textIdx]?.trim();
        current.lines.push({
          account,
          amountOre: amount,
          ...(date ? { date } : {}),
          ...(text && !/^-?\d+([.,]\d+)?$/.test(text) ? { text } : {}),
          objects: objectsToken ? parseObjects(objectsToken.value) : [],
          lineNo,
        });
        break;
      }
      case "#RTRANS":
      case "#BTRANS":
        // Ändringshistorik i filen – #TRANS-raderna är verifikationens gällande innehåll.
        break;
      default:
        file.warnings.push(`Rad ${lineNo}: okänd post ${tag} hoppas över.`);
    }
  }

  if (current) {
    file.warnings.push(`Rad ${current.lineNo}: verifikationen avslutas inte (filen kan vara avhuggen) – den tas inte med.`);
  }
  if (!file.looksLikeSie) {
    throw new SieParseError("Filen innehåller inga SIE-poster. Kontrollera att det är en SIE-export (SIE 4).");
  }
  if (file.years.length === 0 && file.verifications.length === 0 && file.openingBalances.length === 0) {
    throw new SieParseError("SIE-filen saknar både räkenskapsår och verifikationer – det finns ingenting att flytta in.");
  }
  return file;
}

/** Snabb koll för filidentifiering: börjar med #FLAGGA/#PROGRAM/#SIETYP inom de första raderna. */
export function looksLikeSieBytes(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 2000)));
  return /^\s*(\xef\xbb\xbf)?#(FLAGGA|PROGRAM|FORMAT|SIETYP|GEN|FNAMN)\b/im.test(head) || /#SIETYP\s+\d/.test(head);
}
