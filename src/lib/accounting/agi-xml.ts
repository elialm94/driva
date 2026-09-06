import { db } from "../store";
import type { EmployerDeclaration } from "../types";
import { employerDeclarationFor } from "./payroll";
import {
  crlfFile,
  escapeXml,
  FilingDataError,
  heltalKronor,
  orgNumber12,
  periodYYYYMM,
  personnummer12,
} from "./filing-format";

/**
 * Arbetsgivardeklaration på individnivå (AGI) som XML-fil.
 *
 * Filen laddas upp i Skatteverkets e-tjänst "Lämna arbetsgivardeklaration".
 * Där granskas den, kompletteras om något fattas, och signeras med
 * e-legitimation innan den skickas in. Driva lämnar inte in något.
 *
 * Strukturen följer Skatteverkets schema (da/instans 1.1, teknisk beskrivning
 * 1.1.18): en huvuduppgift (HU) med arbetsgivarens summor och en individuppgift
 * (IU) per betalningsmottagare, var och en i ett eget Blankett-element. Varje
 * beloppselement bär attributet `faltkod` med fältkoden från blanketten.
 *
 * Fältkoderna Driva fyller i:
 *   HU  201 arbetsgivarens id, 006 redovisningsperiod,
 *       487 summa arbetsgivaravgifter, 497 summa avdragen skatt.
 *   IU  201 arbetsgivarens id, 215 betalningsmottagarens personnummer,
 *       006 redovisningsperiod, 570 specifikationsnummer,
 *       011 kontant ersättning som är underlag för arbetsgivaravgifter,
 *       001 avdragen preliminärskatt.
 *
 * Förmåner, växa-stöd och frånvarouppgifter finns inte i Driva och saknas
 * därför i filen. En lön utan förmåner är fullständig med de här fälten.
 */

const INSTANS_NS = "http://xmls.skatteverket.se/se/skatteverket/da/instans/schema/1.1";
const KOMPONENT_NS = "http://xmls.skatteverket.se/se/skatteverket/da/komponent/schema/1.1";
const SCHEMA_LOCATION =
  "http://xmls.skatteverket.se/se/skatteverket/da/instans/schema/1.1 " +
  "http://xmls.skatteverket.se/se/skatteverket/da/arbetsgivardeklaration/arbetsgivardeklaration_1.1.xsd";
const PROGRAMNAMN = "Driva";

export interface AgiFile {
  filename: string;
  xml: string;
  /** Antal individuppgifter i filen. */
  individualCount: number;
  /** Sant när filen bygger på en lämnad deklaration, inte på ett utkast. */
  fromDeclaredReport: boolean;
}

/** Bygg AGI-filen för en redovisningsmånad, YYYY-MM. */
export function agiForMonth(month: string): AgiFile {
  const declaration = employerDeclarationFor(month);
  if (!declaration) {
    throw new FilingDataError(
      `Det finns ingen arbetsgivardeklaration för ${month}. Skapa utkastet på lönesidan först.`
    );
  }
  return agiFile(declaration);
}

export function agiFile(declaration: EmployerDeclaration): AgiFile {
  const settings = db().settings;
  const agId = orgNumber12(settings.orgNumber);
  const period = periodYYYYMM(declaration.month);

  if (!declaration.rows.length) {
    throw new FilingDataError(
      `Arbetsgivardeklarationen för ${declaration.label} har inga individuppgifter – ingen lön är bokförd på månaden.`
    );
  }

  const contactName = settings.name.trim();
  const contactPhone = settings.phone.trim();
  const contactEmail = settings.email.trim();
  const missing: string[] = [];
  if (!contactName) missing.push("företagsnamn");
  if (!contactPhone) missing.push("telefon");
  if (!contactEmail) missing.push("e-post");
  if (missing.length) {
    throw new FilingDataError(
      `Filen kräver kontaktuppgifter: ${missing.join(", ")} saknas i företagsinställningarna.`,
      missing
    );
  }

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<Skatteverket xmlns="${INSTANS_NS}"`,
    `              xmlns:agd="${INSTANS_NS}"`,
    `              xmlns:gem="${KOMPONENT_NS}"`,
    '              xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    `              xsi:schemaLocation="${SCHEMA_LOCATION}"`,
    '              omrade="Arbetsgivardeklaration">',
    "  <agd:Avsandare>",
    `    <agd:Programnamn>${escapeXml(PROGRAMNAMN)}</agd:Programnamn>`,
    `    <agd:Organisationsnummer>${agId}</agd:Organisationsnummer>`,
    "    <agd:TekniskKontaktperson>",
    `      <agd:Namn>${escapeXml(contactName)}</agd:Namn>`,
    `      <agd:Telefon>${escapeXml(contactPhone)}</agd:Telefon>`,
    `      <agd:Epostadress>${escapeXml(contactEmail)}</agd:Epostadress>`,
    "    </agd:TekniskKontaktperson>",
    `    <agd:Skapad>${skapad(declaration)}</agd:Skapad>`,
    "  </agd:Avsandare>",
    "  <agd:Blankettgemensamt>",
    "    <agd:Arbetsgivare>",
    `      <agd:AgRegistreradId>${agId}</agd:AgRegistreradId>`,
    "      <agd:Kontaktperson>",
    `        <agd:Namn>${escapeXml(contactName)}</agd:Namn>`,
    `        <agd:Telefon>${escapeXml(contactPhone)}</agd:Telefon>`,
    `        <agd:Epostadress>${escapeXml(contactEmail)}</agd:Epostadress>`,
    "      </agd:Kontaktperson>",
    "    </agd:Arbetsgivare>",
    "  </agd:Blankettgemensamt>",
  ];

  // Huvuduppgiften: arbetsgivarens summor för månaden.
  lines.push(...blankett(agId, period, [
    "        <agd:HU>",
    "          <agd:ArbetsgivareHUGROUP>",
    `            <agd:AgRegistreradId faltkod="201">${agId}</agd:AgRegistreradId>`,
    "          </agd:ArbetsgivareHUGROUP>",
    `          <agd:RedovisningsPeriod faltkod="006">${period}</agd:RedovisningsPeriod>`,
    `          <agd:SummaArbAvgSlf faltkod="487">${heltalKronor(declaration.employerContribution)}</agd:SummaArbAvgSlf>`,
    `          <agd:SummaSkatteavdr faltkod="497">${heltalKronor(declaration.tax)}</agd:SummaSkatteavdr>`,
    "        </agd:HU>",
  ]));

  // En individuppgift per betalningsmottagare.
  declaration.rows.forEach((row, index) => {
    if (!row.personnummer.replace(/\D/g, "")) {
      throw new FilingDataError(
        `${row.name} saknar personnummer. Individuppgiften kan inte lämnas utan betalningsmottagarens identitet.`,
        ["personnummer"]
      );
    }
    const iu: string[] = [
      "        <agd:IU>",
      "          <agd:ArbetsgivareIUGROUP>",
      `            <agd:AgRegistreradId faltkod="201">${agId}</agd:AgRegistreradId>`,
      "          </agd:ArbetsgivareIUGROUP>",
      "          <agd:BetalningsmottagareIUGROUP>",
      "            <agd:BetalningsmottagareIDChoice>",
      `              <agd:BetalningsmottagarId faltkod="215">${personnummer12(row.personnummer)}</agd:BetalningsmottagarId>`,
      "            </agd:BetalningsmottagareIDChoice>",
      "          </agd:BetalningsmottagareIUGROUP>",
      `          <agd:RedovisningsPeriod faltkod="006">${period}</agd:RedovisningsPeriod>`,
      `          <agd:Specifikationsnummer faltkod="570">${row.specifikationsnummer ?? index + 1}</agd:Specifikationsnummer>`,
    ];
    if (row.gross !== 0) {
      iu.push(
        `          <agd:KontantErsattningUlagAG faltkod="011">${heltalKronor(row.gross)}</agd:KontantErsattningUlagAG>`
      );
    }
    // Skatteavdraget lämnas även när det är noll: Skatteverket kräver att
    // fältet finns när en kontant ersättning redovisas.
    iu.push(`          <agd:AvdrPrelSkatt faltkod="001">${heltalKronor(row.tax)}</agd:AvdrPrelSkatt>`);
    iu.push("        </agd:IU>");
    lines.push(...blankett(agId, period, iu));
  });

  lines.push("</Skatteverket>");

  return {
    filename: `arbetsgivardeklaration-${declaration.month}.xml`,
    xml: crlfFile(lines),
    individualCount: declaration.rows.length,
    fromDeclaredReport: declaration.status === "deklarerad",
  };
}

function blankett(agId: string, period: string, innehall: string[]): string[] {
  return [
    "  <agd:Blankett>",
    "    <agd:Arendeinformation>",
    `      <agd:Arendeagare>${agId}</agd:Arendeagare>`,
    `      <agd:Period>${period}</agd:Period>`,
    "    </agd:Arendeinformation>",
    "    <agd:Blankettinnehall>",
    ...innehall,
    "    </agd:Blankettinnehall>",
    "  </agd:Blankett>",
  ];
}

/**
 * Skapandetidpunkt utan tidszon, som schemat vill ha den. En lämnad
 * deklaration använder sin egen tidsstämpel så att filen går att bygga om
 * likadant i efterhand.
 */
function skapad(declaration: EmployerDeclaration): string {
  const iso = declaration.declaredAt ?? declaration.generatedAt ?? new Date().toISOString();
  return iso.slice(0, 19);
}
