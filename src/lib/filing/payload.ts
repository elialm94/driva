/**
 * Filerna en inlämning består av. Ett enda ställe som vet vilken generator som
 * hör till vilken deklaration, vilken myndighet den går till och vad perioden
 * heter i klartext.
 *
 * Generatorerna (eskd.ts, agi-xml.ts, sru.ts, ixbrl.ts) äger innehållet och
 * teckenuppsättningen. Här läggs ingenting till: samma byte som användaren kan
 * hämta i nedladdningen är de byte som lämnas in, och kontrollsumman i
 * inlämningen är summan av just dem.
 */
import type { FilingAuthority, FilingKind } from "../types";
import { db } from "../store";
import { fiscalYears } from "../accounting/fiscal";
import { vatPeriodByKey } from "../accounting/vat";
import { employerDeclarationFor } from "../accounting/payroll";
import { eskdBytes, eskdForPeriod } from "../accounting/eskd";
import { agiForMonth } from "../accounting/agi-xml";
import { sruBytes, sruForFiscalYear } from "../accounting/sru";
import { ixbrlBytes, ixbrlForAnnualReport, ixbrlBlockers } from "../accounting/ixbrl";
import { FilingDataError } from "../accounting/filing-format";
import type { FilingPayloadFile } from "./provider";

export const FILING_AUTHORITY: Record<FilingKind, FilingAuthority> = {
  moms: "skatteverket",
  agi: "skatteverket",
  ink2: "skatteverket",
  arsredovisning: "bolagsverket",
};

export const FILING_KIND_LABEL: Record<FilingKind, string> = {
  moms: "Momsdeklaration",
  agi: "Arbetsgivardeklaration",
  ink2: "Inkomstdeklaration 2",
  arsredovisning: "Årsredovisning",
};

export interface FilingPayload {
  kind: FilingKind;
  subjectId: string;
  label: string;
  authority: FilingAuthority;
  files: FilingPayloadFile[];
  /**
   * Sådant som inte hindrar inlämningen men som användaren ska se innan den
   * görs: otaggat innehåll i iXBRL, konton utan ruta i SRU, en fil som bygger
   * på ett utkast i stället för en redovisad period.
   */
  warnings: string[];
}

/**
 * Bygg filerna för en inlämning. Kastar FilingDataError när underlaget saknas –
 * en inlämning ska aldrig gå vidare på en halv fil.
 */
export function buildFilingPayload(kind: FilingKind, subjectId: string): FilingPayload {
  switch (kind) {
    case "moms": {
      const file = eskdForPeriod(subjectId);
      const label = vatPeriodByKey(subjectId)?.label ?? subjectId;
      return {
        kind,
        subjectId,
        label,
        authority: FILING_AUTHORITY[kind],
        files: [{ filename: file.filename, contentType: "text/xml; charset=iso-8859-1", bytes: eskdBytes(file) }],
        warnings: file.fromDeclaredReport
          ? []
          : ["Momsperioden är inte markerad som deklarerad. Filen bygger på bokföringen som den ser ut nu."],
      };
    }
    case "agi": {
      const declaration = employerDeclarationFor(subjectId);
      const file = agiForMonth(subjectId);
      return {
        kind,
        subjectId,
        label: declaration?.label ?? subjectId,
        authority: FILING_AUTHORITY[kind],
        files: [
          { filename: file.filename, contentType: "text/xml; charset=utf-8", bytes: new TextEncoder().encode(file.xml) },
        ],
        warnings: file.fromDeclaredReport
          ? []
          : ["Arbetsgivardeklarationen är ett utkast. Markera den som lämnad på lönesidan när den är inlämnad."],
      };
    }
    case "ink2": {
      const fy = fiscalYears().find((f) => f.id === subjectId);
      if (!fy) throw new FilingDataError(`Okänt räkenskapsår: ${subjectId}.`);
      const filing = sruForFiscalYear(fy.id);
      const unmapped = filing.unmappedAccounts.map(
        (a) => `Konto ${a.account} ${a.name} saknar ruta i räkenskapsschemat och kom inte med i filen.`
      );
      return {
        kind,
        subjectId,
        label: fy.label,
        authority: FILING_AUTHORITY[kind],
        // Skatteverket tar emot båda filerna tillsammans: INFO.SRU säger vem som
        // lämnar, BLANKETTER.SRU vad som lämnas.
        files: [
          {
            filename: filing.blanketterFilename,
            contentType: "text/plain; charset=iso-8859-1",
            bytes: sruBytes(filing.blanketter),
          },
          {
            filename: filing.infoFilename,
            contentType: "text/plain; charset=iso-8859-1",
            bytes: sruBytes(filing.info),
          },
        ],
        warnings: [...filing.warnings, ...unmapped],
      };
    }
    case "arsredovisning": {
      const report = db().annualReports.find((r) => r.id === subjectId);
      if (!report) throw new FilingDataError("Årsredovisningen finns inte.");
      const file = ixbrlForAnnualReport(report.id);
      return {
        kind,
        subjectId,
        label: report.content.fiscalLabel,
        authority: FILING_AUTHORITY[kind],
        files: [
          {
            filename: file.filename,
            contentType: "application/xhtml+xml; charset=utf-8",
            bytes: ixbrlBytes(file),
          },
        ],
        warnings: [...ixbrlBlockers(report), ...file.warnings],
      };
    }
  }
}
