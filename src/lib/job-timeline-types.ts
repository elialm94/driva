/**
 * Typer och filter för uppdragstidslinjen. Ren modul utan serverberoenden så
 * att klientkomponenten kan importera den utan att dra in lagringslagret.
 */
export type TimelineCategory = "kund" | "arbete" | "ekonomi";

export type TimelineIcon =
  | "forfragan"
  | "offert"
  | "andring"
  | "kund"
  | "start"
  | "tid"
  | "material"
  | "foto"
  | "rapport"
  | "faktura"
  | "betalning"
  | "kredit"
  | "beslut"
  | "flagga"
  | "delning";

export interface TimelineEntry {
  id: string;
  /** ISO-tid. Dagsposter (registrerad tid) får dagens slut så de sorteras rätt. */
  at: string;
  category: TimelineCategory;
  title: string;
  detail?: string;
  href?: string;
  icon: TimelineIcon;
  /** Kundens handling (godkännande, öppnad länk). Markeras särskilt i vyn. */
  byCustomer?: boolean;
  /** Dagspost utan klockslag (registrerad tid, foton, betalningsdag). */
  dayOnly?: boolean;
}

export const TIMELINE_FILTERS: { key: "alla" | TimelineCategory; label: string }[] = [
  { key: "alla", label: "Alla" },
  { key: "kund", label: "Kund" },
  { key: "arbete", label: "Arbete" },
  { key: "ekonomi", label: "Ekonomi" },
];
