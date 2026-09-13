/**
 * Auditlogg, roller och aktivitetsflöde.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID } from "./common";

/* --------------------------------- Audit trail -------------------------------- */

export type AuditAction =
  | "verifikation_bokford"
  | "bokforing_importerad"
  | "verifikation_rattad"
  | "period_last"
  | "period_stangd"
  | "momsrapport_genererad"
  | "momsrapport_deklarerad"
  | "momsperiodicitet_andrad"
  | "skattekonto_bokford"
  | "skattekonto_ocr_andrad"
  | "fskatt_andrad"
  | "anstalld_andrad"
  | "lon_bokford"
  | "arbetsgivardeklaration_genererad"
  | "arbetsgivardeklaration_deklarerad"
  | "rakenskapsar_skapat"
  | "rakenskapsar_andrat"
  | "sie_import"
  | "rakenskapsar_stangt"
  | "rakenskapsar_oppnat"
  | "period_upplast"
  | "inventarie_registrerad"
  | "avskrivning_bokford"
  | "periodisering_planerad"
  | "periodisering_bokford"
  | "bokslutsbilaga_andrad"
  | "bokslutsbilaga_bokford"
  | "arsredovisning_genererad"
  | "arsredovisning_status"
  | "arsredovisning_andrad"
  | "inlamning_genererad"
  | "inlamning_signerad"
  | "inlamning_inlamnad"
  | "inlamning_kvitterad"
  | "inlamning_avvisad"
  | "inlamning_nedladdad"
  | "inlamning_rapporterad"
  | "bokforing_angrad"
  // Affärshändelser (autopiloten): kritiska pengaflöden auditloggas alltid,
  // i samma transaktion som själva händelsen.
  | "faktura_utfardad"
  | "faktura_skickad"
  | "faktura_krediterad"
  | "betalning_matchad"
  | "utgift_bokford"
  | "utgift_privat"
  | "banktransaktion_bokford"
  | "rot_underlag_skapat"
  | "rot_fil_nedladdad"
  | "rot_beslut"
  | "rot_utbetalning_mottagen"
  | "taxreduktion_uppgift_andrad"
  | "samarbete_bjuden"
  | "samarbete_accepterad"
  | "samarbete_aterkallad"
  | "samarbete_avstangd"
  | "samarbete_aktiverad"
  | "samarbete_aterstalld"
  | "samarbete_skrivning"
  | "kundunderlag_begart"
  | "kundunderlag_lost"
  // Avslut och ändringar: kundgodkännanden och avslutsbeslut auditloggas.
  | "andring_godkand"
  | "andring_avbojd"
  | "uppdrag_avslutat"
  | "uppdrag_oppnat_igen"
  | "uppdrag_kundvy_stangd"
  // Produktomfattning (spec §10): konsultens godkännanden av konsultfall och
  // ägarens ändrade svar auditloggas – de styr vad servern släpper igenom.
  | "omfattning_godkand"
  | "omfattning_aterkallad"
  | "omfattning_andrad";

export type BusinessRole = "owner" | "admin" | "member" | "accounting_consultant" | "auditor";
export type CollaborationRole = "accounting_consultant" | "auditor";

export interface AuditEvent {
  id: ID;
  at: string;
  actor: "anvandare" | "assistent" | "system";
  /** Verifierad användare när skrivningen gjordes av en människa (ägare/konsult/revisor). */
  actorUserId?: string;
  actorRole?: BusinessRole;
  action: AuditAction;
  targetType?: string;
  targetId?: ID;
  details: string;
}

/* ---------------------------------- Aktivitet -------------------------------- */

export interface ActivityEvent {
  id: ID;
  at: string;
  text: string;
  customerId?: ID;
  createdBy?: "anvandare" | "assistent";
  entity?: {
    type: "offert" | "faktura" | "jobb" | "utgift" | "verifikation" | "hemsida" | "doman" | "andring";
    id: ID;
  };
}
