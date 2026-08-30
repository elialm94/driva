/**
 * Klient-säkra typer för offert → uppdrag → faktura-kedjan.
 * Ingen store-import – sidor och knappar får bara data härifrån.
 */

export type ChainCtaKind =
  | "starta_uppdrag"
  | "oppna_uppdrag"
  | "skapa_faktura"
  | "skapa_delfaktura"
  | "skapa_slutfaktura"
  | "fristaende_faktura"
  | "skapa_offert";

export interface ChainCta {
  kind: ChainCtaKind;
  label: string;
  href?: string;
  quoteId?: string;
  jobId?: string;
  /** true = primär knapp. */
  primary?: boolean;
}

export interface QuoteChainState {
  quoteId: string;
  quoteNumber: number;
  status: "utkast" | "skickad" | "godkand" | "avbojd" | "utgangen";
  jobId?: string;
  jobTitle?: string;
  waitingLabel: string | null;
  primary: ChainCta | null;
  secondary: ChainCta[];
  overflow: ChainCta[];
}

export interface CustomerChainCtas {
  /** Godkänd offert utan uppdrag – starta därifrån. */
  approvedQuoteId?: string;
  approvedQuoteNumber?: number;
  /** Öppet uppdrag som Ny faktura bör fortsätta. */
  openJobId?: string;
  openJobTitle?: string;
  preferLinkedInvoice: boolean;
  primary: ChainCta | null;
  secondary: ChainCta[];
}

export interface CustomerActivityMember {
  kind: "offert" | "faktura" | "uppdrag" | "betalning";
  title: string;
  href: string;
  statusLabel: string;
}

export interface InvoiceChainLink {
  quoteId?: string;
  quoteNumber?: number;
  quoteHref?: string;
  jobId?: string;
  jobTitle?: string;
  jobHref?: string;
  /** "Kopplat till offert #N · Jobbnamn" */
  label: string | null;
}
