export const ACTIVITY_FILTER_MIN = 8;

export type CustomerActivityKind = "offert" | "faktura" | "uppdrag" | "forfragan" | "betalning";

export interface CustomerActivityRow {
  id: string;
  at: string;
  kind: CustomerActivityKind;
  title: string;
  amount?: number;
  statusLabel: string;
  href: string;
}

export interface CustomerMoneyLine {
  avtalat: number;
  fakturerat: number;
  obetalt: number;
}
