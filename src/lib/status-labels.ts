/**
 * Central presentationskarta: domäntillstånd → svensk UI-etikett.
 *
 * EN källa för all status-, badge- och filtertext så att samma domäntillstånd
 * aldrig visas med olika ord på olika sidor. Domänenums förblir tekniska
 * internt (types.ts) – här bor det användaren ser.
 *
 * Principer (se UX-spec för statusspråk):
 *   * Statusen svarar på: Vad har hänt? Vad/vem väntar vi på? Behöver jag
 *     göra något? – aldrig implementationstermer (BankID, provider,
 *     processing, pending) som primär status.
 *   * BankID är en METOD, inte en status: badge säger "Väntar på signering" /
 *     "Signerad"; tidslinje och underlag säger "Signerad med BankID av …".
 *   * Aktuell status är kort (badge), historik är precis (tidslinje),
 *     detaljsidor får förklara i hela meningar.
 *   * Filter använder exakt samma ordförråd som statusarna.
 *   * Färger: grå = neutral/utkast · blå = pågår/information · gul = väntar/
 *     behöver uppmärksamhet · röd = försenat/fel · grön = klart/betalt/bokfört.
 *     Texten bär betydelsen – färgen är sekundär.
 *
 * Modulen är ren (inga server-/store-beroenden) och kan importeras av både
 * serverkod och klientkomponenter.
 */

import type {
  CollaborationInviteStatus,
  ExpenseStatus,
  InboxItemStatus,
  Invoice,
  Quote,
  SupplierPaymentStatus,
  TaxReductionApplicationStatus,
  TxStatus,
} from "./types";

/** Samma toner som Badge i UI:t (delmängd av BadgeTone) – hålls som data. */
export type StatusTone = "neutral" | "info" | "ok" | "warn" | "danger";

export interface StatusLabel {
  label: string;
  tone: StatusTone;
}

/* ---------------------------------- Offerter ---------------------------------- */

/**
 * Offertstatus. "skickad" betyder för användaren: vi väntar på att kunden
 * signerar – inte vilken teknik som används. "godkand" = kunden har signerat.
 */
export const QUOTE_STATUS: Record<Quote["status"], StatusLabel> = {
  utkast: { label: "Utkast", tone: "neutral" },
  skickad: { label: "Väntar på signering", tone: "warn" },
  godkand: { label: "Signerad", tone: "ok" },
  avbojd: { label: "Avböjd", tone: "danger" },
  utgangen: { label: "Utgången", tone: "neutral" },
};

/** Filteretiketter – samma ordförråd som statusarna, i pluralform där det passar. */
export const QUOTE_STATUS_FILTER: Record<Quote["status"], string> = {
  utkast: "Utkast",
  skickad: "Väntar på signering",
  godkand: "Signerade",
  avbojd: "Avböjda",
  utgangen: "Utgångna",
};

/**
 * Radtext för en skickad offert i listor/På gång: "Öppnad · väntar på
 * signering" när kunden öppnat den, annars "Väntar på signering".
 */
export function quoteWaitingLabel(opts: { viewed?: boolean } = {}): string {
  return opts.viewed ? "Öppnad · väntar på signering" : "Väntar på signering";
}

/**
 * Tidslinje-/historiketiketter för offertflödet. Här hör metoden hemma:
 * "Signerad med BankID", aldrig som primär status.
 */
export const QUOTE_TIMELINE = {
  skapad: "Skapad",
  skickad: "Skickad",
  oppnad: "Öppnad av kunden",
  paminnelse: "Påminnelse",
  signerad: "Signerad med BankID",
  avbojd: "Avböjd",
} as const;

/** Underlag/metadata: "Signerad med BankID av Sara Nilsson". */
export function signedWithBankIdBy(name: string): string {
  return `${QUOTE_TIMELINE.signerad} av ${name}`;
}

/* ---------------------------------- Fakturor ---------------------------------- */

/**
 * Fakturastatus. Förfallen HÄRLEDS (isOverdue i services/data.ts) och visas
 * då i stället för "Skickad"/"Delbetald" – använd invoiceOverdueLabel.
 */
export const INVOICE_STATUS: Record<Invoice["status"], StatusLabel> = {
  utkast: { label: "Utkast", tone: "neutral" },
  skickad: { label: "Skickad", tone: "info" },
  delbetald: { label: "Delbetald", tone: "warn" },
  betald: { label: "Betald", tone: "ok" },
  krediterad: { label: "Krediterad", tone: "neutral" },
};

/** En kreditfaktura är ingen fordran – egen etikett, aldrig "förfallen". */
export const INVOICE_CREDIT_NOTE: StatusLabel = { label: "Kreditfaktura", tone: "neutral" };

/** "Förfallen 7 dagar" – kanoniskt ord för passerat förfallodatum (inte "försenad"). */
export function invoiceOverdueLabel(days?: number): StatusLabel {
  if (!days || days <= 0) return { label: "Förfallen", tone: "danger" };
  return { label: `Förfallen ${days} ${days === 1 ? "dag" : "dagar"}`, tone: "danger" };
}

export const INVOICE_STATUS_FILTER = {
  utkast: "Utkast",
  obetald: "Obetalda",
  forfallen: "Förfallna",
  betald: "Betalda",
  kredit: "Krediterade",
} as const;

/* ------------------------------ Uppdrag (arbete) ------------------------------ */

/**
 * Arbetsstatus för uppdrag – beskriver ARBETET, aldrig ekonomin. Pengaläget
 * ("25 500 kr kvar att fakturera", "Väntar på betalning") visas separat och
 * får aldrig bakas in i "Klart".
 */
export const JOB_STATUS: Record<"planerat" | "pagar" | "klart" | "arkiverat", StatusLabel> = {
  planerat: { label: "Planerat", tone: "neutral" },
  pagar: { label: "Pågår", tone: "info" },
  klart: { label: "Klart", tone: "ok" },
  arkiverat: { label: "Arkiverat", tone: "neutral" },
};

/* ----------------------------- Banktransaktioner ------------------------------ */

/**
 * "behover_atgard" är motorns reserv – när åtgärdsmotorn vet mer visas den
 * konkreta etiketten ("Matcha betalning" osv., se action-issue.ts) i stället.
 */
export const TX_STATUS: Record<TxStatus, StatusLabel> = {
  ny: { label: "Ny", tone: "neutral" },
  bokford: { label: "Bokförd", tone: "ok" },
  behover_atgard: { label: "Behöver åtgärd", tone: "warn" },
};

/* ---------------------------------- Utgifter ---------------------------------- */

/** Utgiftsstatus – säger vad som faktiskt behöver hända. */
export const EXPENSE_STATUS: Record<ExpenseStatus, StatusLabel> = {
  saknar_kvitto: { label: "Kvitto saknas", tone: "warn" },
  behover_svar: { label: "Välj kategori", tone: "warn" },
  bokford: { label: "Bokförd", tone: "ok" },
};

/* --------------------------- Leverantörsfakturor ------------------------------ */

/**
 * Kanonisk livscykel för leverantörsfakturor – EN vokabulär som alla ytor
 * (Inbox, Ekonomi, Hem, admin) delar. Nyckeln är ett presentationstillstånd:
 * flera tekniska tillstånd kan mappa till samma etikett, men en etikett har
 * alltid samma ord överallt. Aldrig "Behandlad"/"Processing"/"Klar" när den
 * verkliga innebörden är mer specifik.
 */
export type SupplierInvoiceLifecycleState =
  | "BEHOVER_KONTROLL"
  | "BOKFORD"
  | "REDO_ATT_BETALA"
  | "BANKFIL_SKAPAD"
  | "VANTAR_PA_BETALNING"
  | "BETALD"
  | "AVSTAMD";

export const SUPPLIER_INVOICE_LIFECYCLE: Record<SupplierInvoiceLifecycleState, StatusLabel> = {
  BEHOVER_KONTROLL: { label: "Behöver kontroll", tone: "warn" },
  BOKFORD: { label: "Bokförd", tone: "info" },
  REDO_ATT_BETALA: { label: "Redo att betala", tone: "warn" },
  BANKFIL_SKAPAD: { label: "Bankfil skapad", tone: "info" },
  VANTAR_PA_BETALNING: { label: "Väntar på betalning", tone: "info" },
  BETALD: { label: "Betald", tone: "ok" },
  AVSTAMD: { label: "Avstämd", tone: "ok" },
};

/**
 * Betalningsinstruktionens status (SupplierPaymentStatus) → etikett.
 * scheduledDate ger "Betalas 3 sep" i stället för abstrakta "Schemalagd".
 */
export function supplierPaymentStatus(
  status: SupplierPaymentStatus,
  opts: { scheduledDate?: string; formatDate?: (iso: string) => string } = {}
): StatusLabel {
  switch (status) {
    case "DRAFT":
    case "READY":
      return SUPPLIER_INVOICE_LIFECYCLE.REDO_ATT_BETALA;
    case "SUBMITTED_TO_BANK":
    case "AWAITING_APPROVAL":
      return { label: "Skickad till banken", tone: "info" };
    case "SCHEDULED": {
      const when =
        opts.scheduledDate && opts.formatDate ? opts.formatDate(opts.scheduledDate) : undefined;
      return { label: when ? `Betalas ${when}` : "Betalning planerad", tone: "info" };
    }
    case "PAID":
      return SUPPLIER_INVOICE_LIFECYCLE.BETALD;
    case "FAILED":
      return { label: "Betalningen misslyckades", tone: "danger" };
    case "CANCELLED":
      return { label: "Avbruten", tone: "neutral" };
  }
}

/* --------------------------- Betalningsuppgifter ------------------------------ */

/**
 * Härledd orsak när betalningsuppgifter inte är betalbara
 * (services/payment-details.ts). Etiketten säger vad som behöver hända –
 * aldrig "Extraction failed"/"Ofullständig".
 */
export const PAYMENT_DETAILS_CAUSE: Record<
  "EXTRACTION_UNCERTAIN" | "MISSING" | "AWAITING_SUPPLIER" | "CHANGED",
  StatusLabel
> = {
  EXTRACTION_UNCERTAIN: { label: "Kontrollera betalningsuppgifter", tone: "warn" },
  MISSING: { label: "Betalningsuppgifter saknas", tone: "warn" },
  AWAITING_SUPPLIER: { label: "Väntar på leverantören", tone: "info" },
  CHANGED: { label: "Kontrollera bankuppgifter", tone: "danger" },
};

/* ----------------------------------- Inbox ------------------------------------ */

/**
 * Inboxpostens lagrade status. "behandlad" betyder att dokumentet är
 * omhändertaget (utgift/leverantörsfaktura skapad) – visas som "Hanterad".
 * När vi vet mer (fakturan behöver kontroll, belopp saknas, redo att betala)
 * visas det specifika tillståndet i stället (inbox/workflow.ts).
 */
export const INBOX_ITEM_STATUS: Record<InboxItemStatus, StatusLabel> = {
  ny: { label: "Ny", tone: "info" },
  behandlad: { label: "Hanterad", tone: "neutral" },
  bokford: { label: "Bokförd", tone: "ok" },
};

/** Belopp kunde inte läsas ur dokumentet → be användaren kontrollera, inte "Ej tolkad". */
export const INBOX_AMOUNT_REVIEW: StatusLabel = { label: "Kontrollera belopp", tone: "warn" };

/* --------------------------------- Bokföring ---------------------------------- */

/**
 * Bokföringens tillståndsord – mänskliga etiketter, aldrig
 * POSTED/RECONCILED/CORRECTED i UI:t.
 */
export const ACCOUNTING_STATE = {
  bokford: { label: "Bokförd", tone: "ok" },
  behoverGranskas: { label: "Behöver granskas", tone: "warn" },
  rattad: { label: "Rättad", tone: "warn" },
  rattelse: { label: "Rättelse", tone: "warn" },
  avstamd: { label: "Avstämd", tone: "ok" },
  redoForMoms: { label: "Redo för moms", tone: "info" },
  momsDeklarerad: { label: "Moms deklarerad", tone: "ok" },
} as const satisfies Record<string, StatusLabel>;

/** Momsperiodens läge (accounting/vat.ts): kommande → pågår → att deklarera → deklarerad. */
export const VAT_PERIOD_STATE = {
  kommande: { label: "Kommande", tone: "neutral" },
  pagaende: { label: "Pågår", tone: "info" },
  att_deklarera: { label: "Att deklarera", tone: "warn" },
  deklarerad: { label: "Deklarerad", tone: "ok" },
} as const satisfies Record<string, StatusLabel>;

/* ---------------------------------- ROT/RUT ----------------------------------- */

/** Ansökans läge – Skatteverket är aktören användaren väntar på efter ansökan. */
export const TAX_REDUCTION_STATUS: Record<TaxReductionApplicationStatus, StatusLabel> = {
  preliminar: { label: "Preliminär", tone: "neutral" },
  redo_att_ansokas: { label: "Redo att ansökas", tone: "warn" },
  underlag_skapat: { label: "Väntar på Skatteverket", tone: "info" },
  godkant: { label: "Godkänd", tone: "ok" },
  delvis_godkant: { label: "Delvis godkänd", tone: "warn" },
  nekat: { label: "Nekad", tone: "danger" },
};

/* ---------------------------------- Samarbete --------------------------------- */

/**
 * Samarbetsstatus (konsult/revisor). Aldrig Active/Pending/Revoked i svensk UI.
 * "pending" = inbjudan skickad, vi väntar på att personen accepterar.
 */
export const COLLABORATION_STATUS: Record<CollaborationInviteStatus, StatusLabel> = {
  pending: { label: "Inbjudan skickad", tone: "warn" },
  accepted: { label: "Ansluten", tone: "ok" },
  revoked: { label: "Åtkomst borttagen", tone: "neutral" },
  expired: { label: "Inbjudan har gått ut", tone: "neutral" },
};

/* -------------------------------- Support/Admin ------------------------------- */

/**
 * Supportärendets status (Driva Admin). Primäretiketterna är klarspråk även i
 * admin – tekniska provider-/statusfält visas separat som sekundär metadata.
 */
export type SupportTicketState = "open" | "in_progress" | "waiting_on_customer" | "resolved";

export const SUPPORT_TICKET_STATUS: Record<SupportTicketState, StatusLabel> = {
  open: { label: "Öppet", tone: "warn" },
  in_progress: { label: "Pågår", tone: "info" },
  waiting_on_customer: { label: "Väntar på kunden", tone: "neutral" },
  resolved: { label: "Löst", tone: "ok" },
};
