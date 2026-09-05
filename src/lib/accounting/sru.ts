import { db } from "../store";
import type { FiscalYear } from "../types";
import { accountName } from "./chart";
import { getFiscalYear } from "./fiscal";
import { saldobalans } from "./ledger";
import { computeTaxCalculation, ink2Rows, type TaxCalculation } from "./tax";
import type { Ink2Field } from "./ink2-model";
import {
  ARETS_RESULTAT_ACCOUNTS,
  INK2R_BALANCE,
  INK2R_RESULT,
  INK2R_RESULTAT_FORLUST,
  INK2R_RESULTAT_VINST,
  inRange,
  ruleForAccount,
  type Ink2rRule,
} from "./ink2r-model";
import {
  crlfFile,
  dateYYYYMMDD,
  encodeLatin1,
  FilingDataError,
  heltalKronor,
  orgNumber12,
} from "./filing-format";

/**
 * Inkomstdeklaration 2 som SRU-filer.
 *
 * Deklarationen lämnas som två filer i Skatteverkets e-tjänst Filöverföring:
 * INFO.SRU beskriver vem som lämnar uppgifterna, BLANKETTER.SRU innehåller
 * blankettblocken. Ett aktiebolag lämnar tre block – huvudblanketten INK2,
 * räkenskapsschemat INK2R och de skattemässiga justeringarna INK2S.
 *
 * Formatet följer SKV 269 "Teknisk beskrivning för elektronisk redovisning":
 * ISO 8859-1, en post per rad, raderna i föreskriven ordning, och belopp i hela
 * kronor utan tusenavgränsare. Teckenkonventionen är blankettens: en kostnad
 * skrivs som ett positivt belopp i en kostnadsruta.
 *
 * Driva skickar ingenting. Filerna laddas ner, granskas och lämnas in av den
 * som skriver under deklarationen.
 */

const PROGRAMNAMN = "Driva";
const BLANKETTER_FILNAMN = "BLANKETTER.SRU";
const INFO_FILNAMN = "INFO.SRU";

/**
 * INK2S rutor → fältkoder. Rutan är modellens begrepp (ink2-model.ts) och
 * fältkoden är blankettens namn på den.
 */
const INK2S_FIELD_CODE: Record<Ink2Field, string> = {
  "4.1": "7650",
  "4.2": "7750",
  "4.3a": "7651",
  "4.3c": "7653",
  "4.5c": "7754",
  "4.6a": "7654",
  "4.9": "7666",
  "4.14a": "7763",
  "4.15": "8020",
  "4.16": "8021",
};

/** Huvudblankettens rutor: räkenskapsåret och det skattemässiga resultatet. */
const INK2_RAKENSKAPSAR_FRAN = "7011";
const INK2_RAKENSKAPSAR_TILL = "7012";
const INK2_OVERSKOTT = "7104";
const INK2_UNDERSKOTT = "7114";

export interface SruUppgift {
  /** Fältkoden, t.ex. "7410". */
  code: string;
  /** Värdet som det skrivs i filen. */
  value: string;
  /** Rutans benämning – bara för att kunna visa filen för en människa. */
  label: string;
}

export interface SruBlankett {
  /** Blankettblockets namn, t.ex. "INK2R-2026P4". */
  blankett: string;
  uppgifter: SruUppgift[];
}

export interface SruUnmappedAccount {
  account: number;
  name: string;
  /** Saldo eller nettorörelse som inte kom med i någon ruta. */
  amount: number;
}

export interface SruFiling {
  fiscalYearId: string;
  /** Inkomstår och granskningsperiod, t.ex. "2026P4". */
  period: string;
  infoFilename: string;
  blanketterFilename: string;
  /** INFO.SRU som text, med CRLF. Kodas med `sruBytes`. */
  info: string;
  /** BLANKETTER.SRU som text, med CRLF. */
  blanketter: string;
  blocks: SruBlankett[];
  /**
   * Konton med belopp som inte finns i kopplingstabellen. Filen blir inte fel
   * av dem, men den blir inte komplett – därför visas de i stället för att
   * tigas bort.
   */
  unmappedAccounts: SruUnmappedAccount[];
  warnings: string[];
}

/* ------------------------------ Granskningsperiod -------------------------- */

/**
 * Blankettblockets period: inkomståret följt av den granskningsperiod
 * räkenskapsårets sista månad ger. Ett kalenderår slutar i december och lämnas
 * i period 4, vilket är fallet för nästan alla små aktiebolag.
 *
 * P3 är reserverad för särskilda fall (bland annat förkortade och förlängda
 * räkenskapsår) och går inte att räkna fram ur slutmånaden. Ett sådant år får
 * en varning i stället för en gissad period.
 */
export function granskningsperiod(fy: FiscalYear): { period: string; warning?: string } {
  const incomeYear = fy.endDate.slice(0, 4);
  const endMonth = Number(fy.endDate.slice(5, 7));
  const suffix = endMonth <= 4 ? "P1" : endMonth <= 8 ? "P2" : "P4";
  const months = monthsInFiscalYear(fy);
  const warning =
    months === 12
      ? undefined
      : `Räkenskapsåret är ${months} månader långt. Blankettblocket är satt till ${incomeYear}${suffix} utifrån slutmånaden – kontrollera perioden mot Skatteverkets inlämningsperiod innan filen lämnas in, förkortade och förlängda år kan tillhöra en annan.`;
  return { period: `${incomeYear}${suffix}`, ...(warning ? { warning } : {}) };
}

function monthsInFiscalYear(fy: FiscalYear): number {
  const [startYear, startMonth] = fy.startDate.split("-").map(Number);
  const [endYear, endMonth] = fy.endDate.split("-").map(Number);
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
}

/* --------------------------------- INK2R ---------------------------------- */

interface Ink2rResult {
  uppgifter: SruUppgift[];
  unmapped: SruUnmappedAccount[];
  /** Årets resultat enligt resultaträkningen. Positivt = vinst. */
  aretsResultat: number;
  /** Sant när bokslutets omföring till 899x är bokförd. */
  resultatOmfort: boolean;
}

/**
 * Räkenskapsschemat ur saldobalansen.
 *
 * Balanskonton lämnas med utgående balans, resultatkonton med årets rörelse.
 * Beloppen summeras per ruta och skrivs med blankettens tecken: ett konto vars
 * netto ligger på sin normala sida ger ett positivt belopp.
 */
function ink2rUppgifter(fy: FiscalYear): Ink2rResult {
  const sb = saldobalans({ from: fy.startDate, to: fy.endDate });
  const amounts = new Map<string, { amount: number; label: string }>();
  const unmapped: SruUnmappedAccount[] = [];
  let resultNet = 0; // debetnetto på resultatkonton, exklusive 899x
  let omforingsNet = 0;

  const add = (rule: Ink2rRule, net: number) => {
    // Netto på normal sida = positivt belopp i rutan.
    const signed = rule.normal === "debet" ? net : -net;
    const code = signed < 0 && rule.oppositeCode ? rule.oppositeCode : rule.code;
    const amount = signed < 0 && rule.oppositeCode ? -signed : signed;
    const current = amounts.get(code);
    amounts.set(code, { amount: (current?.amount ?? 0) + amount, label: current?.label ?? rule.label });
  };

  for (const row of sb.rows) {
    const account = row.account;
    const isBalance = account < 3000;
    const net = isBalance ? row.ub : row.debit - row.credit;
    if (net === 0) continue;

    if (inRange(account, ARETS_RESULTAT_ACCOUNTS)) {
      omforingsNet += net;
      continue;
    }
    if (!isBalance) resultNet += net;

    const rule = ruleForAccount(account, isBalance ? INK2R_BALANCE : INK2R_RESULT);
    if (!rule) {
      unmapped.push({ account, name: accountName(account), amount: net });
      continue;
    }
    add(rule, net);
  }

  const aretsResultat = -resultNet;
  const resultatOmfort = omforingsNet !== 0;

  /*
   * Årets resultat i eget kapital. Bokslutet flyttar det till 2099, men INK2R:s
   * balansräkning ska visa det oavsett om omföringen är bokförd – ett schema
   * där tillgångarna inte möter skulderna är inte inlämningsbart. Innan
   * omföringen läggs resultatet därför till fritt eget kapital.
   */
  if (!resultatOmfort && aretsResultat !== 0) {
    const fritt = amounts.get("7302");
    amounts.set("7302", {
      amount: (fritt?.amount ?? 0) + aretsResultat,
      label: fritt?.label ?? "Fritt eget kapital",
    });
  }

  const uppgifter: SruUppgift[] = [];
  for (const [code, { amount, label }] of [...amounts].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (Math.round(amount) === 0) continue;
    uppgifter.push({ code, value: heltalKronor(amount), label });
  }

  if (aretsResultat >= 0) {
    if (Math.round(aretsResultat) !== 0) {
      uppgifter.push({ code: INK2R_RESULTAT_VINST, value: heltalKronor(aretsResultat), label: "Årets resultat, vinst" });
    }
  } else {
    uppgifter.push({
      code: INK2R_RESULTAT_FORLUST,
      value: heltalKronor(-aretsResultat),
      label: "Årets resultat, förlust",
    });
  }

  return { uppgifter, unmapped, aretsResultat, resultatOmfort };
}

/* --------------------------------- INK2S ---------------------------------- */

/**
 * De skattemässiga justeringarna, i blankettens ordning.
 *
 * Raderna kommer från skattemotorn, så filen och INK2-sidan kan aldrig visa
 * olika tal. Minusposter (skattefria intäkter, tidigare års underskott) har en
 * egen ruta på blanketten och skrivs därför som positiva belopp där.
 */
function ink2sUppgifter(tax: TaxCalculation): SruUppgift[] {
  return ink2Rows(tax).map((row) => ({
    code: INK2S_FIELD_CODE[row.field],
    value: heltalKronor(Math.abs(row.amount)),
    label: `${row.field} ${row.label}`,
  }));
}

/* ---------------------------------- Filerna -------------------------------- */

export function sruForFiscalYear(fiscalYearId: string, now: Date = new Date()): SruFiling {
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) throw new FilingDataError(`Räkenskapsåret ${fiscalYearId} finns inte.`);

  const settings = db().settings;
  if ((settings.companyForm ?? "ab") !== "ab") {
    throw new FilingDataError(
      "Inkomstdeklaration 2 gäller aktiebolag och ekonomiska föreningar. En enskild firma deklarerar på NE-bilagan i ägarens egen deklaration."
    );
  }

  const missing: string[] = [];
  if (!settings.name.trim()) missing.push("företagsnamn");
  if (!settings.postalCode.trim()) missing.push("postnummer");
  if (!settings.city.trim()) missing.push("postort");
  if (missing.length) {
    throw new FilingDataError(
      `Deklarationsfilen kräver uppgifter om den som lämnar den: ${missing.join(", ")} saknas i företagsinställningarna.`,
      missing
    );
  }

  const orgNr = orgNumber12(settings.orgNumber);
  const { period, warning: periodWarning } = granskningsperiod(fy);
  const tax = computeTaxCalculation(fy);
  const ink2r = ink2rUppgifter(fy);

  const warnings: string[] = [];
  if (periodWarning) warnings.push(periodWarning);
  if (fy.status !== "stangt") {
    warnings.push(
      `Räkenskapsåret ${fy.label} är inte stängt. Filen bygger på bokföringen som den ser ut nu, och siffrorna ändras med varje verifikation som bokförs efteråt.`
    );
  }
  if (ink2r.unmapped.length) {
    warnings.push(
      `${ink2r.unmapped.length} konto${ink2r.unmapped.length === 1 ? "" : "n"} saknar koppling till en ruta i räkenskapsschemat: ${ink2r.unmapped
        .map((u) => `${u.account} ${u.name}`)
        .join(", ")}. Beloppen är inte med i filen och måste fyllas i för hand.`
    );
  }
  warnings.push(...tax.manualReviewNotes);

  const identitet = `${orgNr} ${dateYYYYMMDD(now.toISOString())} ${klockslag(now)}`;
  const namn = settings.name.trim();

  const blocks: SruBlankett[] = [
    {
      blankett: `INK2-${period}`,
      uppgifter: [
        ...rakenskapsar(fy),
        /*
         * 1.1 och 1.2 ska vara samma tal som 4.15 respektive 4.16 på INK2S.
         * Därför används det skattemässiga resultatet, inte det avrundade
         * beskattningsbara – avrundningen till helt tiotal gör Skatteverket.
         */
        ...(tax.skattemassigtResultat > 0
          ? [
              {
                code: INK2_OVERSKOTT,
                value: heltalKronor(tax.skattemassigtResultat),
                label: "1.1 Överskott av näringsverksamhet",
              },
            ]
          : tax.skattemassigtResultat < 0
            ? [
                {
                  code: INK2_UNDERSKOTT,
                  value: heltalKronor(-tax.skattemassigtResultat),
                  label: "1.2 Underskott av näringsverksamhet",
                },
              ]
            : []),
      ],
    },
    { blankett: `INK2R-${period}`, uppgifter: [...rakenskapsar(fy), ...ink2r.uppgifter] },
    { blankett: `INK2S-${period}`, uppgifter: [...rakenskapsar(fy), ...ink2sUppgifter(tax)] },
  ];

  const blanketterLines: string[] = [];
  for (const block of blocks) {
    blanketterLines.push(`#BLANKETT ${block.blankett}`);
    blanketterLines.push(`#IDENTITET ${identitet}`);
    blanketterLines.push(`#NAMN ${sruText(namn)}`);
    for (const u of block.uppgifter) blanketterLines.push(`#UPPGIFT ${u.code} ${u.value}`);
    blanketterLines.push("#BLANKETTSLUT");
  }
  blanketterLines.push("#FIL_SLUT");

  // Ordningen i INFO.SRU är föreskriven, inte fri: fel ordning avvisar filen.
  const infoLines: string[] = [
    "#DATABESKRIVNING_START",
    "#PRODUKT SRU",
    `#SKAPAD ${dateYYYYMMDD(now.toISOString())} ${klockslag(now)}`,
    `#PROGRAM ${PROGRAMNAMN}`,
    `#FILNAMN ${BLANKETTER_FILNAMN}`,
    "#DATABESKRIVNING_SLUT",
    "#MEDIELEV_START",
    `#ORGNR ${orgNr}`,
    `#NAMN ${sruText(namn)}`,
    ...(settings.address.trim() ? [`#ADRESS ${sruText(settings.address)}`] : []),
    `#POSTNR ${sruText(settings.postalCode)}`,
    `#POSTORT ${sruText(settings.city)}`,
    ...(settings.email.trim() ? [`#EMAIL ${sruText(settings.email)}`] : []),
    ...(settings.phone.trim() ? [`#TELEFON ${sruText(settings.phone)}`] : []),
    "#MEDIELEV_SLUT",
  ];

  return {
    fiscalYearId: fy.id,
    period,
    infoFilename: INFO_FILNAMN,
    blanketterFilename: BLANKETTER_FILNAMN,
    info: crlfFile(infoLines),
    blanketter: crlfFile(blanketterLines),
    blocks,
    unmappedAccounts: ink2r.unmapped,
    warnings,
  };
}

function rakenskapsar(fy: FiscalYear): SruUppgift[] {
  return [
    { code: INK2_RAKENSKAPSAR_FRAN, value: dateYYYYMMDD(fy.startDate), label: "Räkenskapsår från" },
    { code: INK2_RAKENSKAPSAR_TILL, value: dateYYYYMMDD(fy.endDate), label: "Räkenskapsår till" },
  ];
}

function klockslag(now: Date): string {
  return now.toISOString().slice(11, 19).replace(/:/g, "");
}

/**
 * Text i en SRU-post. Brädgården inleder en post och får inte förekomma i ett
 * värde, och en radbrytning skulle bryta posten i två.
 */
function sruText(value: string): string {
  return value.replace(/[#\r\n]+/g, " ").trim();
}

/** Filens byte-innehåll i ISO 8859-1, som Skatteverket förväntar sig. */
export function sruBytes(text: string): Uint8Array {
  return encodeLatin1(text);
}
