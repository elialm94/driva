import { db } from "../store";
import type { VatBox } from "../types";
import { computeVatPosition, vatPeriodByKey, vatReportForPeriod } from "./vat";
import {
  crlfFile,
  encodeLatin1,
  escapeXml,
  FilingDataError,
  heltalKronor,
  orgNumber10,
  periodYYYYMM,
} from "./filing-format";

/**
 * Momsdeklaration som eSKD-fil (eSKDUpload 6.0).
 *
 * Filen laddas upp i Skatteverkets e-tjänst "Lämna momsdeklaration", där
 * uppgifterna granskas och signeras innan de skickas in. Driva skickar
 * ingenting själv – filen är ett underlag, inte en inlämning.
 *
 * Formatets regler (Skatteverket, "Skapa och skicka in momsdeklaration via
 * fil"): XML i ISO 8859-1, en tagg per deklarationsruta, belopp i hela kronor
 * utan tecken för moms att betala och med inledande minus för moms att få
 * tillbaka. Tomma rutor utelämnas. Summeringen MomsBetala (ruta 49) är
 * obligatorisk och skrivs alltid, även när den är noll.
 */

const ESKD_VERSION = "6.0";
const ESKD_DTD =
  '<!DOCTYPE eSKDUpload PUBLIC "-//Skatteverket, Sweden//DTD Skatteverket eSKDUpload-DTD Version 6.0//SV" ' +
  '"https://www1.skatteverket.se/demoeskd/eSKDUpload_6p0.dtd">';

/**
 * Ruta → XML-tagg. Hela blankettens rutor finns med, inte bara de Driva
 * bokför i dag: när en ny momskod tillkommer i VAT_CODES ska filen följa med
 * utan att den här tabellen behöver ändras.
 *
 * Ordningen är blankettens, och det är också ordningen taggarna skrivs i.
 */
const ESKD_TAGS: { box: string; tag: string }[] = [
  { box: "05", tag: "ForsMomsEjAnnan" },
  { box: "06", tag: "UttagMoms" },
  { box: "07", tag: "UlagMargbesk" },
  { box: "08", tag: "HyrinkomstFriv" },
  { box: "10", tag: "MomsUtgHog" },
  { box: "11", tag: "MomsUtgMedel" },
  { box: "12", tag: "MomsUtgLag" },
  { box: "20", tag: "InkopVaruAnnatEg" },
  { box: "21", tag: "InkopTjanstAnnatEg" },
  { box: "22", tag: "InkopTjanstUtomEg" },
  { box: "23", tag: "InkopVaruSverige" },
  { box: "24", tag: "InkopTjanstSverige" },
  { box: "30", tag: "MomsInkopUtgHog" },
  { box: "31", tag: "MomsInkopUtgMedel" },
  { box: "32", tag: "MomsInkopUtgLag" },
  { box: "35", tag: "ForsVaruAnnatEg" },
  { box: "36", tag: "ForsVaruUtomEg" },
  { box: "37", tag: "InkopVaruMellan3p" },
  { box: "38", tag: "ForsVaruMellan3p" },
  { box: "39", tag: "ForsTjSkskAnnatEg" },
  { box: "40", tag: "ForsTjOvrUtomEg" },
  { box: "41", tag: "ForsKopareSkskSverige" },
  { box: "42", tag: "ForsOvrigt" },
  { box: "50", tag: "MomsUlagImport" },
  { box: "60", tag: "MomsImportUtgHog" },
  { box: "61", tag: "MomsImportUtgMedel" },
  { box: "62", tag: "MomsImportUtgLag" },
  { box: "48", tag: "MomsIngAvdr" },
];

/** Ruta 49, summeringen. Skrivs sist och alltid. */
const MOMS_BETALA_BOX = "49";

export interface EskdFile {
  /** Filnamn att föreslå i nedladdningen. */
  filename: string;
  /** Filens text, med CRLF. Kodas till ISO 8859-1 med `eskdBytes`. */
  xml: string;
  /** Rutorna som faktiskt hamnade i filen, i filens ordning. */
  boxes: VatBox[];
  /** Ruta 49: positivt = att betala, negativt = att få tillbaka. */
  attBetala: number;
  /** Sant när filen bygger på en deklarerad rapport, inte på ett utkast. */
  fromDeclaredReport: boolean;
}

/**
 * Bygg eSKD-filen för en momsperiod, t.ex. "2026-K2".
 *
 * Är perioden redovisad används rapportens frysta rutor – filen ska visa det
 * som deklarerades, inte vad huvudboken råkar säga i dag. Annars räknas rutorna
 * fram ur bokföringen precis som momssidan gör.
 */
export function eskdForPeriod(periodKey: string): EskdFile {
  const period = vatPeriodByKey(periodKey);
  if (!period) throw new FilingDataError(`Okänd momsperiod: ${periodKey}.`);

  const settings = db().settings;
  const orgNr = orgNumber10(settings.orgNumber);

  const report = vatReportForPeriod(periodKey);
  const declared = report?.status === "deklarerad";
  const source = declared && report ? { boxes: report.boxes, attBetala: report.attBetala } : computeVatPosition(period);

  const amountOf = (box: string): number => {
    const rows = source.boxes.filter((b) => b.code === box);
    return rows.reduce((sum, b) => sum + Math.round(b.amount), 0);
  };

  const boxes: VatBox[] = [];
  const lines: string[] = [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    ESKD_DTD,
    `<eSKDUpload Version="${ESKD_VERSION}">`,
    `<OrgNr>${escapeXml(orgNr)}</OrgNr>`,
    "<Moms>",
    // Redovisningsperioden anges med sista månaden i perioden.
    `<Period>${periodYYYYMM(period.end)}</Period>`,
  ];

  for (const { box, tag } of ESKD_TAGS) {
    const amount = amountOf(box);
    if (amount === 0) continue;
    const label = source.boxes.find((b) => b.code === box)?.label ?? tag;
    boxes.push({ code: box, label, amount });
    lines.push(`<${tag}>${heltalKronor(amount)}</${tag}>`);
  }

  const attBetala = Math.round(source.attBetala);
  boxes.push({ code: MOMS_BETALA_BOX, label: "Moms att betala eller få tillbaka", amount: attBetala });
  lines.push(`<MomsBetala>${heltalKronor(attBetala)}</MomsBetala>`);

  lines.push("</Moms>");
  lines.push("</eSKDUpload>");

  return {
    filename: `momsdeklaration-${periodKey}.xml`,
    xml: crlfFile(lines),
    boxes,
    attBetala,
    fromDeclaredReport: declared,
  };
}

/** Filens byte-innehåll i ISO 8859-1, som Skatteverket förväntar sig. */
export function eskdBytes(file: EskdFile): Uint8Array {
  return encodeLatin1(file.xml);
}
