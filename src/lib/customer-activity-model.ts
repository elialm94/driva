/**
 * Visa Alla / Offerter / Fakturor / Uppdrag / Betalningar så fort det
 * finns minst en rad. Tröskeln 8 gömde flikarna efter kedjegruppering
 * (seed-kunder har typiskt 1-5 rader).
 */
export const ACTIVITY_FILTER_MIN = 0;

export type CustomerActivityKind = "offert" | "faktura" | "uppdrag" | "betalning";

export interface CustomerActivityMember {
  kind: CustomerActivityKind;
  title: string;
  href: string;
  statusLabel: string;
}

export interface CustomerActivityRow {
  id: string;
  at: string;
  kind: CustomerActivityKind;
  /** Alla slags objekt i kedjan – filtret matchar mot den här listan. */
  kinds: CustomerActivityKind[];
  title: string;
  subtitle?: string;
  amount?: number;
  statusLabel: string;
  href: string;
  members?: CustomerActivityMember[];
}

export interface CustomerMoneyLine {
  /** Godkända offerter. Uppdrag som ärver en offert räknas inte igen. */
  avtalat: number;
  /** Fakturor som räknas (countsTowardInvoiced). */
  fakturerat: number;
  /** Öppna fordringar (isOpenReceivable). */
  obetalt: number;
}
