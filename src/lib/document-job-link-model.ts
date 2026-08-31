/**
 * Klient-säkra typer för KOPPLAT TILL (offert/faktura → uppdrag).
 * Ingen store-import – sidor och knappar får bara data härifrån.
 */

export type DocumentLinkKind = "quote" | "invoice";

export interface DocumentLinkJobOption {
  id: string;
  title: string;
  statusLabel: string;
}

export interface DocumentLinkJob {
  id: string;
  title: string;
  href: string;
  statusLabel: string;
}

export interface DocumentLinkView {
  kind: DocumentLinkKind;
  documentId: string;
  customerId: string;
  customerName: string;
  job: DocumentLinkJob | null;
  /** Faktura som kommer från en offert – extra rad, inte en egen koppling. */
  quote?: { number: number; href: string };
  jobs: DocumentLinkJobOption[];
  /** Får öppna väljaren (koppla eller byta). */
  canLink: boolean;
  /** Får välja ett annat uppdrag. */
  canChange: boolean;
  /** Får ta bort kopplingen. */
  canUnlink: boolean;
}

export type DocumentLinkResult =
  | { ok: true; jobId: string; jobTitle: string; statusLabel: string }
  | { ok: false; error: string };
