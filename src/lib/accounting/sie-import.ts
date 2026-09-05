import { db, save } from "../store";
import { chartAccount, ensureAccount } from "./chart";
import { logAudit } from "./audit";
import { nextDay } from "./dates";
import { getFiscalYear } from "./fiscal";
import type { SieImportPreview } from "./sie";

/**
 * SIE-import: att ta över en klient som redan har historik.
 *
 * En byrå får sällan börja på en tom bokföring. Klienten kommer från Fortnox,
 * Visma eller Björn Lundén, mitt i ett räkenskapsår, och det som ska följa med
 * är kontoplanen med byråns egna kontonamn och de ingående balanserna. Utan det
 * går det inte att fortsätta bokföra – varje rapport skulle utgå från noll.
 *
 * Importen tar därför MEDVETET inte in verifikationerna. Verifikationer i Driva
 * är oföränderliga och numrerade av motorn, och att skriva in en främmande
 * historik i dem skulle vara att påstå att Driva bokförde dem. Historiken
 * ligger kvar i det gamla programmet, som lagen ändå kräver i sju år, och
 * kommer in i Driva som ingående balans – vilket är precis vad en byrå gör i en
 * manuell övertagning.
 *
 * Filen läses i två steg: preview() visar vad importen skulle göra utan att
 * röra något, och importOpeningBalances() utför den. Steget emellan är inte
 * artigt – ingående balanser är den enda punkten där någon kan skriva historik
 * utan verifikation, och den ska ingen göra av misstag.
 */

export class SieImportError extends Error {}

/** Fältvärde i en SIE-post: antingen ett bart ord eller en citerad sträng. */
interface SieEntry {
  label: string;
  fields: string[];
}

/** PC8/CP437 → Unicode. Omvänd tabell till exportens encodeSieToPc8. */
const CP437_HIGH = [
  // 0x80–0x9f
  "Ç", "ü", "é", "â", "ä", "à", "å", "ç", "ê", "ë", "è", "ï", "î", "ì", "Ä", "Å",
  "É", "æ", "Æ", "ô", "ö", "ò", "û", "ù", "ÿ", "Ö", "Ü", "¢", "£", "¥", "₧", "ƒ",
  // 0xa0–0xbf
  "á", "í", "ó", "ú", "ñ", "Ñ", "ª", "º", "¿", "⌐", "¬", "½", "¼", "¡", "«", "»",
  "░", "▒", "▓", "│", "┤", "╡", "╢", "╖", "╕", "╣", "║", "╗", "╝", "╜", "╛", "┐",
  // 0xc0–0xdf
  "└", "┴", "┬", "├", "─", "┼", "╞", "╟", "╚", "╔", "╩", "╦", "╠", "═", "╬", "╧",
  "╨", "╤", "╥", "╙", "╘", "╒", "╓", "╫", "╪", "┘", "┌", "█", "▄", "▌", "▐", "▀",
  // 0xe0–0xff
  "α", "ß", "Γ", "π", "Σ", "σ", "µ", "τ", "Φ", "Θ", "Ω", "δ", "∞", "φ", "ε", "∩",
  "≡", "±", "≥", "≤", "⌠", "⌡", "÷", "≈", "°", "∙", "·", "√", "ⁿ", "²", "■", " ",
];

/**
 * Standarden säger PC8 (#FORMAT PC8), men flera program skriver UTF-8 ändå, och
 * raden som anger kodningen kommer först efter #FLAGGA – för sent att styra
 * avkodningen på. Vi provar UTF-8 strikt först: en CP437-fil med svenska tecken
 * är nästan aldrig giltig UTF-8, så ett lyckat avkodningsförsök är ett gott
 * besked. En ren ASCII-fil blir samma sträng vilken väg vi än tar.
 */
export function decodeSie(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    let out = "";
    for (const byte of bytes) {
      out += byte < 0x80 ? String.fromCharCode(byte) : (CP437_HIGH[byte - 0x80] ?? "?");
    }
    return out;
  }
}

/**
 * En SIE-rad: `#LABEL fält fält "fält med blanksteg"`. Klamrarna kring #TRANS
 * är egna rader i SIE 4 och behandlas som poster utan fält.
 */
function parseLine(line: string): SieEntry | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("#")) return undefined;
  const fields: string[] = [];
  let i = 1;
  let label = "";
  while (i < trimmed.length && !/\s/.test(trimmed[i])) label += trimmed[i++];
  while (i < trimmed.length) {
    while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
    if (i >= trimmed.length) break;
    if (trimmed[i] === '"') {
      i++;
      let value = "";
      while (i < trimmed.length && trimmed[i] !== '"') value += trimmed[i++];
      i++;
      fields.push(value);
      continue;
    }
    if (trimmed[i] === "{") {
      // Objektlista (kostnadsställe/projekt). Driva har inga dimensioner.
      while (i < trimmed.length && trimmed[i] !== "}") i++;
      i++;
      fields.push("");
      continue;
    }
    let value = "";
    while (i < trimmed.length && !/\s/.test(trimmed[i])) value += trimmed[i++];
    fields.push(value);
  }
  return { label: label.toUpperCase(), fields };
}

/** SIE-datum är YYYYMMDD. Vissa program skriver YYYYMM för #RAR. */
function sieDateToIso(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (digits.length === 6) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-01`;
  return undefined;
}

/**
 * SIE-belopp är kronor med punkt som decimaltecken. Driva bokför i hela kronor,
 * så ören avrundas – och att de fanns sägs i förhandsvisningens varningar, för
 * en avrundning som ingen nämner är en avrundning ingen upptäcker.
 */
function parseAmount(raw: string): number | undefined {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined;
  return Number(cleaned);
}

/**
 * Tolka en SIE-fil och visa vad en import skulle innebära. Rör ingenting.
 *
 * `#RAR 0` är filens innevarande år och `#RAR -1` året före; balansposterna
 * bär samma årsindex, så #UB för år 0 är den utgående balansen vi vill ha som
 * ingående balans i Driva när övertagandet sker vid ett årsskifte, medan #IB
 * för år 0 är den vi vill ha när övertagandet sker mitt i året.
 */
export function previewSieImport(bytes: Uint8Array): SieImportPreview {
  const text = decodeSie(bytes);
  const warnings: string[] = [];
  const accounts = new Map<number, string>();
  const ib = new Map<number, number>();
  const ub = new Map<number, number>();
  const years = new Map<number, { startDate: string; endDate: string }>();
  let companyName: string | undefined;
  let orgNumber: string | undefined;
  let verificationCount = 0;
  let sawOre = false;
  let sietyp: string | undefined;

  for (const line of text.split(/\r?\n/)) {
    const entry = parseLine(line);
    if (!entry) continue;
    const [a, b, c] = entry.fields;
    switch (entry.label) {
      case "SIETYP":
        sietyp = a;
        break;
      case "FNAMN":
        if (a) companyName = a;
        break;
      case "ORGNR":
        if (a) orgNumber = a;
        break;
      case "RAR": {
        const index = Number(a);
        const start = sieDateToIso(b ?? "");
        const end = sieDateToIso(c ?? "");
        if (Number.isInteger(index) && start && end) years.set(index, { startDate: start, endDate: end });
        break;
      }
      case "KONTO": {
        const account = Number(a);
        if (Number.isInteger(account) && account > 0) accounts.set(account, (b ?? "").trim() || `Konto ${account}`);
        break;
      }
      case "IB":
      case "UB": {
        if (Number(a) !== 0) break; // Bara filens innevarande år.
        const account = Number(b);
        const amount = parseAmount(c ?? "");
        if (!Number.isInteger(account) || amount === undefined) break;
        if (!Number.isInteger(amount)) sawOre = true;
        const target = entry.label === "IB" ? ib : ub;
        target.set(account, (target.get(account) ?? 0) + amount);
        break;
      }
      case "VER":
        verificationCount++;
        break;
      default:
        break;
    }
  }

  if (sietyp && !["1", "2", "3", "4", "4E"].includes(sietyp.toUpperCase())) {
    warnings.push(`Filen anger SIE-typ ${sietyp}, som Driva inte känner. Importen läser den som SIE 4.`);
  }
  if (years.size === 0) {
    throw new SieImportError(
      "Filen saknar räkenskapsår (#RAR). Utan det går det inte att avgöra vilken period balanserna hör till."
    );
  }
  const current = years.get(0);
  if (!current) {
    throw new SieImportError("Filen saknar det innevarande räkenskapsåret (#RAR 0).");
  }
  if (ib.size === 0 && ub.size === 0) {
    throw new SieImportError(
      "Filen innehåller inga balansposter (#IB eller #UB). En SIE-fil av typ 1 eller 4 behövs för att ta över balanser."
    );
  }
  if (sawOre) {
    warnings.push("Filen har belopp med ören. Driva bokför i hela kronor, så beloppen avrundas vid importen.");
  }
  if (verificationCount > 0) {
    warnings.push(
      `Filen innehåller ${verificationCount} verifikation${verificationCount === 1 ? "" : "er"}. De importeras inte – historiken ligger kvar i det gamla programmet och kommer in här som ingående balans.`
    );
  }

  // Konton som har saldo men saknar #KONTO-rad: filen är ofullständig, men
  // saldot är det viktiga och namnet kan hämtas ur BAS-registret vid import.
  for (const account of [...ib.keys(), ...ub.keys()]) {
    if (!accounts.has(account)) accounts.set(account, `Konto ${account}`);
  }

  // #UB är balanserna vid filens årsslut – det byrån tar över vid ett
  // årsskifte. #IB är reserv för filer som bara har ingående balanser.
  const openingBalances: Record<string, number> = {};
  const source = ub.size > 0 ? ub : ib;
  for (const [account, amount] of source) {
    // Bara balanskonton följer med, samma gräns som bokslutet drar (close.ts).
    if (account >= 3000) continue;
    const rounded = Math.round(amount);
    if (rounded !== 0) openingBalances[String(account)] = rounded;
  }

  const sum = Object.values(openingBalances).reduce((s, v) => s + v, 0);
  if (sum !== 0) {
    warnings.push(
      `Balansposterna summerar till ${sum} kr i stället för noll. Skillnaden bokförs mot ${BALANCE_ADJUST_ACCOUNT} vid importen så att bokföringen går ihop – kontrollera den mot klientens balansrapport.`
    );
  }

  return {
    companyName,
    orgNumber: orgNumber?.replace(/[^0-9-]/g, "") || undefined,
    fiscalYears: [...years.entries()].sort((a, b) => b[0] - a[0]).map(([, y]) => y),
    accounts: [...accounts.entries()].sort((a, b) => a[0] - b[0]).map(([account, name]) => ({ account, name })),
    openingBalances,
    verificationCount,
    warnings,
  };
}

/**
 * Balanserade balanser är ett krav i Driva – saldobalansen ska alltid summera
 * till noll. Går filen inte ihop läggs skillnaden på balanserat resultat, som
 * är den post en revisor ändå skulle fråga om, i stället för att importen
 * vägrar och byrån får leta manuellt.
 */
const BALANCE_ADJUST_ACCOUNT = 2091;

export interface SieImportResult {
  fiscalYearId: string;
  accountsCreated: number;
  accountsTotal: number;
  balancedWith?: number;
  warnings: string[];
}

/**
 * Skriv in kontoplanen och de ingående balanserna på ett räkenskapsår.
 *
 * Året måste vara öppet och tomt: finns det redan verifikationer i det har
 * någon börjat bokföra, och att då byta ingående balans under fötterna vore att
 * ändra historik utan verifikation. Har året redan IB från föregående års
 * bokslut skrivs den inte över heller – den är beräknad ur en stängd bokföring
 * och väger tyngre än en fil.
 */
export function importSieOpeningBalances(
  preview: SieImportPreview,
  fiscalYearId: string,
  actor: "anvandare" | "assistent" | "system" = "anvandare"
): SieImportResult {
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) throw new SieImportError("Räkenskapsåret finns inte.");
  if (fy.status === "stangt") {
    throw new SieImportError(`${fy.label} är stängt. Ingående balanser kan bara sättas på ett öppet år.`);
  }
  if (fy.openingSource === "foregaende_ar") {
    throw new SieImportError(
      `${fy.label} har redan ingående balanser från bokslutet för ${Number(fy.label) - 1}. De är beräknade ur en stängd bokföring och ska inte skrivas över av en fil.`
    );
  }
  const booked = db().verifications.filter((v) => v.fiscalYearId === fy.id);
  if (booked.length > 0) {
    throw new SieImportError(
      `Det finns redan ${booked.length} verifikation${booked.length === 1 ? "" : "er"} bokförda i ${fy.label}. Ingående balanser måste vara på plats innan bokföringen börjar.`
    );
  }
  if (Object.keys(preview.openingBalances).length === 0) {
    throw new SieImportError("Filen gav inga ingående balanser att importera.");
  }

  let created = 0;
  for (const { account, name } of preview.accounts) {
    if (account < 1000 || account > 8999) continue;
    if (!chartAccount(account)) created++;
    ensureAccount(account, name);
  }

  const opening: Record<string, number> = {};
  for (const [account, amount] of Object.entries(preview.openingBalances)) {
    const number = Number(account);
    if (!Number.isInteger(number) || number < 1000 || number > 8999) continue;
    ensureAccount(number, preview.accounts.find((a) => a.account === number)?.name ?? `Konto ${number}`);
    opening[account] = Math.round(amount);
  }

  const sum = Object.values(opening).reduce((s, v) => s + v, 0);
  let balancedWith: number | undefined;
  if (sum !== 0) {
    const key = String(BALANCE_ADJUST_ACCOUNT);
    ensureAccount(BALANCE_ADJUST_ACCOUNT, "Balanserad vinst eller förlust");
    opening[key] = (opening[key] ?? 0) - sum;
    if (opening[key] === 0) delete opening[key];
    balancedWith = -sum;
  }

  fy.openingBalances = opening;
  fy.openingSource = "migrering";

  const warnings = [...preview.warnings];
  // Ett övertagande vid årsskiftet lägger filens utgående balans som ingående
  // balans i året efter. Går datumen inte ihop är det inte nödvändigtvis fel –
  // en byrå kan ta över mitt i ett år – men då saknas årets bokförda händelser
  // fram till övertagandet, och det ska sägas rakt ut.
  const fileYear = preview.fiscalYears[0];
  if (fileYear && nextDay(fileYear.endDate) !== fy.startDate) {
    warnings.push(
      `Filens räkenskapsår slutar ${fileYear.endDate} men balanserna lades som ingående balans den ${fy.startDate}. Är övertagandet mitt i ett år saknas händelserna däremellan i Driva – de ligger kvar i det gamla programmet.`
    );
  }

  const accountCount = Object.keys(opening).length;
  logAudit(
    actor,
    "sie_import",
    `Ingående balanser importerades från SIE-fil till ${fy.label}: ${accountCount} konto${accountCount === 1 ? "" : "n"}${
      balancedWith ? `, differens ${balancedWith} kr mot ${BALANCE_ADJUST_ACCOUNT}` : ""
    }.${preview.companyName ? ` Filen kommer från "${preview.companyName}".` : ""}`,
    { targetType: "rakenskapsar", targetId: fy.id }
  );
  save();

  return {
    fiscalYearId: fy.id,
    accountsCreated: created,
    accountsTotal: accountCount,
    balancedWith,
    warnings,
  };
}
