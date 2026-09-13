/**
 * ROT/RUT: bostadsuppgifter, HUS-kategorier och begäran till Skatteverket.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID } from "./common";

export interface RotRut {
  type: "rot" | "rut";
  /**
   * Maximalt avdrag utifrån denna offert/faktura (arbetskostnad + ROT/RUT-regler).
   * Inte kundens saldo hos Skatteverket.
   */
  calculatedEligibleTaxReduction?: number;
  /** Avdraget som används på dokumentet. Standard: samma som calculated. */
  appliedTaxReduction?: number;
  /** true när användaren sänkt avdraget manuellt. */
  taxReductionManuallyAdjusted?: boolean;
}

/** Bostadstyp för ROT – bara ett fältset visas åt gången. */
export type DwellingType = "smahus" | "bostadsratt";

/** Fastighets-/bostadsuppgifter. Ägs av uppdraget och återanvänds på del-fakturor. */
export interface HousingDetails {
  dwellingType?: DwellingType;
  /** Fastighetsbeteckning – endast vid Fastighet/småhus. */
  propertyDesignation?: string;
  /** BRF organisationsnummer – endast vid Bostadsrätt. */
  brfOrgNumber?: string;
  /** Lägenhetsnummer – endast vid Bostadsrätt. */
  apartmentNumber?: string;
}

export type TaxReductionApplicationStatus =
  | "preliminar"
  | "redo_att_ansokas"
  | "underlag_skapat"
  | "godkant"
  | "delvis_godkant"
  | "nekat";

/** Arbetsområden i Skatteverkets HUS-schema (Begäran v6). ROT-områden först, sedan RUT. */
export type HusRotWorkCategory =
  | "Bygg"
  | "El"
  | "GlasPlatarbete"
  | "MarkDraneringarbete"
  | "Murning"
  | "MalningTapetsering"
  | "Vvs";
export type HusRutWorkCategory =
  | "Stadning"
  | "KladOchTextilvard"
  | "Snoskottning"
  | "Tradgardsarbete"
  | "Barnpassning"
  | "Personligomsorg"
  | "Flyttjanster"
  | "ItTjanster"
  | "ReparationAvVitvaror"
  | "Moblering"
  | "TillsynAvBostad";
export type HusWorkCategory = HusRotWorkCategory | HusRutWorkCategory;

/**
 * Uppgifter som bara behövs för Skatteverkets HUS-fil (XML-import i e-tjänsten
 * "Rot och rut – företag"). Filen laddas ner och importeras av användaren själv –
 * Ferva skickar aldrig något till Skatteverket.
 */
export interface TaxReductionHusDetails {
  /** Arbetsområde enligt schemat. ROT utan val = Bygg (snickardefault). RUT måste väljas. */
  workCategory?: HusWorkCategory;
  /**
   * Arbetade timmar per faktura när fakturaraderna inte är timprisade
   * (fast pris). Anges av användaren – räknas aldrig fram ur beloppet.
   */
  laborHoursByInvoice?: Record<ID, number>;
  /** Senaste nedladdning av HUS-filen. Ingen inlämning – bara att filen hämtats. */
  fileDownloadedAt?: string;
}

/** Manuellt ansökningssteg – ingen Skatteverket-API i V1. */
export interface TaxReductionApplication {
  status: TaxReductionApplicationStatus;
  underlagCreatedAt?: string;
  /** Sammanfattning för export. Innehåller inte personnummer i aktivitetsloggen. */
  underlagSummary?: string;
  /** Kompletterande uppgifter för HUS-filen till Skatteverket. */
  hus?: TaxReductionHusDetails;
  decision?: {
    outcome: "godkant" | "delvis_godkant" | "nekat";
    decidedAt: string;
    deniedAmount?: number;
  };
  /**
   * Skatteverkets utbetalning: bokas 1930 mot 1513 när pengarna kommer.
   * Sätts EN gång per ansökan (idempotensvakt – en ansökan kan aldrig få
   * dubbla utbetalningsbokningar).
   */
  payout?: {
    amount: number;
    at: string;
    verificationId: ID;
    bankTransactionId?: ID;
  };
}

/** ROT/RUT-uppgifter på fakturan. Personnummer ligger på kunden, inte här. */
export interface TaxReductionDetails {
  workAddress?: string;
  workPeriodStart?: string;
  workPeriodEnd?: string;
  /**
   * Varifrån perioden kom. "invoice" (eller saknat värde på äldre fakturor) =
   * manuellt angivet och det enda som får skrivas till uppdraget. "job" =
   * uppdragets datum. "derived" = aktuell månad, sista utposten och ingen
   * uppgift om när arbetet gjordes. Allt utom "invoice" räknas om vid nästa
   * sparning, så perioden följer uppdraget när det får riktiga datum.
   */
  workPeriodSource?: "invoice" | "job" | "derived";
  housing?: HousingDetails;
}

/**
 * Immutabelt utdrag av ROT/RUT-villkor som kunden såg och (vid BankID) godkände.
 * Version + full text sparas så att senare ändringar av standardtexten inte
 * skriver över det signerade innehållet.
 */
export interface TaxReductionTermsSnapshot {
  version: string;
  type: "rot" | "rut";
  heading: string;
  body: string;
  text: string;
}
