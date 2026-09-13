/**
 * Inlämning till Skatteverket och Bolagsverket.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID } from "./common";

/* --------------------------------- Inlämning --------------------------------- */

/** Vilken deklaration inlämningen gäller. En kind = en filgenerator. */
export type FilingKind = "moms" | "agi" | "ink2" | "arsredovisning";

export type FilingAuthority = "skatteverket" | "bolagsverket";

/**
 * Inlämningens livscykel:
 *   utkast → genererad (filen är byggd och dess innehåll fryst med sha256)
 *   → signerad (behörig firmatecknare har signerat filen)
 *   → inlamnad (myndigheten har tagit emot den och gett ett id)
 *   → kvitterad (kvittensen är hämtad) | avvisad (myndigheten sa nej)
 *
 * Statusen säger vad som HÄNT, aldrig vad Ferva hoppas har hänt: "inlamnad"
 * kräver ett id från myndigheten och "kvitterad" en kvittens.
 */
export type FilingSubmissionStatus = "utkast" | "genererad" | "signerad" | "inlamnad" | "kvitterad" | "avvisad";

/**
 * En genererad fil i inlämningen. sha256 är beviset: kvittensen gäller exakt
 * det innehållet, så en fil som genereras om efter signering upptäcks.
 */
export interface FilingFileRef {
  filename: string;
  /** MIME-typ, t.ex. "application/xml". */
  contentType: string;
  /** Filens storlek i byte. */
  size: number;
  /** Hexadecimal SHA-256 av filens byte. */
  sha256: string;
}

export interface FilingSignature {
  /** bankid_mock = demosignatur. Aldrig ett påstående om riktig BankID-signering. */
  method: "bankid" | "bankid_mock";
  signedAt: string;
  signedByName: string;
  /** Maskerat personnummer – hela numret sparas aldrig i signaturen. */
  personalNumberMasked?: string;
  orderRef?: string;
  /** Förtydligande som visas i UI:t, t.ex. att signaturen är en demosignatur. */
  note?: string;
}

/** Myndighetens kvittens: att filen är mottagen, med myndighetens eget id. */
export interface FilingReceipt {
  /** Kvittensnummer hos myndigheten. */
  receiptId: string;
  receivedAt: string;
  message?: string;
}

/**
 * Kvittensfilen användaren laddar upp efter en manuell inlämning (PDF eller
 * bild från myndighetens e-tjänst). Lagras som kvitton: privat bucket när
 * fillagring finns, annars inline. Aldrig båda satta.
 */
export interface FilingReceiptFile {
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** Sökväg i privata bucketen `receipts`: <business_id>/<inlämnings-id>/<filnamn>. */
  storagePath?: string;
  contentBase64?: string;
}

/**
 * Användarens egen rapport om att filen lämnats in i myndighetens e-tjänst
 * ("Jag har lämnat in"). Ferva har inte skickat något och inte kontrollerat
 * kvittensen – det är därför den som rapporterar, och när, som sparas.
 */
export interface FilingManualReceipt {
  /** Myndighetens referens- eller kvittensnummer, som användaren skrev in. */
  reference?: string;
  note?: string;
  file?: FilingReceiptFile;
  reportedAt: string;
  reportedByName: string;
  reportedByUserId?: string;
}

/**
 * En inlämning av en deklaration till en myndighet. En rad per försök: en
 * avvisad inlämning står kvar och en ny rad skapas för nästa försök, så
 * historiken visar vad som lämnades in och när.
 */
export interface FilingSubmission {
  id: ID;
  kind: FilingKind;
  /**
   * Vad inlämningen gäller i Fervas data: momsrapportens id, AGI-månaden
   * (YYYY-MM), räkenskapsårets id för INK2, årsredovisningens id.
   */
  subjectId: string;
  /** Perioden i klartext, t.ex. "april–juni 2026". */
  label: string;
  authority: FilingAuthority;
  /**
   * Hur filen nådde myndigheten: mock i demo, live mot riktigt avtal,
   * manuell när användaren själv lämnade in filen i e-tjänsten och
   * rapporterade det i Ferva.
   */
  provider: "mock" | "live" | "manuell";
  status: FilingSubmissionStatus;
  /** Filerna som genererades. INK2 har två: BLANKETTER.SRU och INFO.SRU. */
  files: FilingFileRef[];
  generatedAt?: string;
  /** När filen senast hämtades för manuell inlämning. */
  downloadedAt?: string;
  signature?: FilingSignature;
  submittedAt?: string;
  /** Myndighetens id för inlämningen. Finns så snart den togs emot. */
  providerSubmissionId?: string;
  receipt?: FilingReceipt;
  /** Bara när provider är manuell: användarens rapport och kvittens. */
  manualReceipt?: FilingManualReceipt;
  rejection?: { reason: string; at: string };
  /** Senaste användarvända felet. Nollställs vid nästa lyckade steg. */
  lastError?: string;
  createdBy: "anvandare" | "assistent";
  createdAt: string;
  updatedAt: string;
}
