/**
 * Rapportrader och K2-årsredovisning.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID } from "./common";

/* ------------------------------- Årsredovisning ------------------------------- */

export interface ReportRow {
  label: string;
  amount: number;
  /**
   * Jämförelsetal för föregående räkenskapsår (ÅRL 3:1). Undefined för det
   * första året – då finns inget att jämföra med.
   */
  prior?: number;
  /** Summeringsrad. */
  bold?: boolean;
  /** Notreferens. */
  note?: number;
}

/**
 * Flerårsöversikt enligt ÅRL 6:1. Nyckeltalen räknas ur varje års egna
 * fastställda siffror – aldrig ur årets siffror med förra årets etikett.
 */
export interface MultiYearRow {
  label: string;
  nettoomsattning: number;
  resultatEfterFinansiella: number;
  soliditetProcent: number;
  /** Saknas för år Ferva inte har bokföring för. */
  ofullstandig?: boolean;
}

/**
 * Den som skriver under årsredovisningen. Enligt ÅRL 2:7 skrivs den under av
 * samtliga styrelseledamöter och av verkställande direktören.
 */
export interface AnnualReportSignatory {
  name: string;
  /** Styrelseledamot, styrelsens ordförande, verkställande direktör … */
  role: string;
  /** Ort och datum för underskriften. Tomt tills den skrivits under. */
  signedAt?: string;
  place?: string;
}

/**
 * Fastställelseintyget: bestyrkandet på den kopia som skickas till
 * Bolagsverket. Intygar att resultat- och balansräkningen fastställts på
 * årsstämman och att stämman beslutat om resultatdispositionen.
 */
export interface AnnualReportCertification {
  /** Datum för årsstämman. */
  stammaDate?: string;
  /** Den styrelseledamot eller VD som bestyrker kopian. */
  certifiedByName?: string;
  certifiedByRole?: string;
  /** Stämmans beslut, i klartext. */
  dispositionDecision?: string;
}

export interface AnnualReportContent {
  companyName: string;
  orgNumber: string;
  fiscalLabel: string;
  periodStart: string;
  periodEnd: string;
  /** Bolagets säte – ska framgå av årsredovisningen (ÅRL 6:1). */
  sate?: string;
  forvaltningsberattelse: {
    verksamhet: string;
    vasentligaHandelser: string;
    flerarsoversikt: MultiYearRow[];
    /** Förändringar i eget kapital under året (ÅRL 6:2). */
    egetKapitalForandring?: {
      label: string;
      aktiekapital: number;
      balanseratResultat: number;
      aretsResultat: number;
      summa: number;
    }[];
    resultatdisposition: { tillForfogande: number; balanserasINyRakning: number; utdelning?: number };
  };
  resultatrakning: ReportRow[];
  balansrakningTillgangar: ReportRow[];
  balansrakningEgetKapitalSkulder: ReportRow[];
  /**
   * Noterna, numrerade i uppställningsordning. Numret ligger i datan och inte i
   * renderingen, för de upphöjda hänvisningarna i resultat- och balansräkningen
   * pekar på det – räknas det om vid visningen kan de gå isär.
   */
  noter: { number: number; title: string; body: string }[];
  /**
   * Medelantalet anställda som tal. Står också i noten, men i en mening – och
   * iXBRL-filen ska bära det som ett taggat tal med egen enhet, inte som text.
   * Saknas i rapporter upprättade innan Ferva sparade det.
   */
  medelantalAnstallda?: number;
  underskrifter?: AnnualReportSignatory[];
  fastallelseintyg?: AnnualReportCertification;
}

export interface AnnualReport {
  id: ID;
  fiscalYearId: ID;
  /** Ingen riktig inlämning sker – "inlamnad_markerad" är en manuell markering med audit trail. */
  status: "genererad" | "granskad" | "signerad" | "inlamnad_markerad";
  content: AnnualReportContent;
  generatedAt: string;
  reviewedAt?: string;
  signedAt?: string;
  markedFiledAt?: string;
  /**
   * Satt när räkenskapsåret öppnats igen efter att rapporten upprättades.
   * Rapporten står kvar – den kan vara undertecknad och inlämnad, och då är den
   * en historisk handling – men den beskriver inte längre böckerna.
   */
  supersededAt?: string;
  supersededReason?: string;
}
