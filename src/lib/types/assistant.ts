/**
 * Assistenten: kort, meddelanden, bekräftelsekort, påminnelser och uppmärksamhetsläge.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID } from "./common";

/* ---------------------------------- Assistent -------------------------------- */

export type AssistantCard =
  | { kind: "links"; links: { label: string; href: string }[] }
  | {
      kind: "list";
      title?: string;
      rows: { label: string; value?: string; href?: string }[];
      links?: { label: string; href: string }[];
    }
  | {
      kind: "confirm";
      actionId: ID;
      summary: string;
      rows?: { label: string; value?: string }[];
      confirmLabel: string;
      state: "vantar" | "utford" | "avbruten";
      resultText?: string;
    }
  | {
      kind: "entity";
      entity: "kund" | "uppdrag" | "offert" | "faktura";
      title: string;
      subtitle?: string;
      href: string;
      openLabel: string;
    }
  | {
      kind: "create_customer";
      actionId: ID;
      suggestedName: string;
      state: "vantar" | "utford" | "avbruten";
      resultText?: string;
    };

export interface AssistantMessage {
  id: ID;
  role: "user" | "assistant";
  at: string;
  text: string;
  card?: AssistantCard;
}

/** Vad assistenten ska fortsätta med efter att en saknad kund skapats. */
export type ResumeAfterCustomer =
  | { kind: "create_quote"; title?: string; amountInclVat?: number; rot?: "rot" | "rut" | null; appliedTaxReduction?: number }
  | { kind: "create_job"; title: string; startDate?: string; description?: string }
  | {
      kind: "create_invoice";
      title?: string;
      amountInclVat?: number;
      jobId?: ID;
      taxReduction?: "rot" | "rut" | null;
      appliedTaxReduction?: number;
    };

export type PendingAssistantAction =
  | { id: ID; type: "paminn_forsenade"; invoiceIds: ID[] }
  | { id: ID; type: "folj_upp_offerter"; quoteIds: ID[] }
  | { id: ID; type: "bokfor_utgift"; expenseId: ID; category: string; jobId?: ID }
  | { id: ID; type: "generera_hemsida"; description: string }
  | { id: ID; type: "skicka_offert"; quoteId: ID }
  | { id: ID; type: "skicka_faktura"; invoiceId: ID }
  | { id: ID; type: "publicera_hemsida" }
  | { id: ID; type: "skapa_kund"; name: string; resume?: ResumeAfterCustomer }
  | { id: ID; type: "uppdatera_foretag"; patch: Record<string, string | number | null> }
  | { id: ID; type: "kor_bokslut_automatik"; fiscalYearId: ID }
  | { id: ID; type: "slutfor_bokslut"; fiscalYearId: ID }
  | { id: ID; type: "angra_utgift"; expenseId: ID }
  | {
      id: ID;
      type: "ratta_bokforing";
      verificationId: ID;
      intent: { kind: "konto"; category: string; reason?: string } | { kind: "omatcha"; reason?: string };
    }
  | { id: ID; type: "markera_moms_deklarerad"; reportId: ID }
  | { id: ID; type: "skapa_tillaggsoffert"; customerId: ID; jobId: ID; title: string; amountInclVat: number }
  | { id: ID; type: "kop_doman"; hostname: string }
  | { id: ID; type: "skicka_leverantorsbetalning"; paymentId: ID }
  | { id: ID; type: "avbryt_leverantorsbetalning"; paymentId: ID }
  | { id: ID; type: "anvand_leverantorsuppgifter"; supplierInvoiceId: ID }
  /** Skapa pain.001-bankfil för fakturorna – utförs först efter bekräftelse. */
  | { id: ID; type: "skapa_bankfil"; supplierInvoiceIds: ID[] }
  | { id: ID; type: "ta_bort_uppdrag"; jobId: ID };

/* --------------------------------- Påminnelser -------------------------------- */

export type ReminderStatus = "PENDING" | "COMPLETED" | "DISMISSED";

export type ReminderRelatedType = "customer" | "quote" | "invoice" | "job";

/**
 * Persisterad påminnelse skapad ur naturligt språk (eller manuellt).
 * "Förfallen" är HÄRLETT ur dueAt/status – aldrig lagrat. Borttagning är
 * mjuk (DISMISSED) så historiken bevaras.
 */
export interface Reminder {
  id: ID;
  /** Skaparen (auth.users.id). null i JSON-läget utan inloggning. */
  userId: string | null;
  title: string;
  description?: string;
  /**
   * Absolut tidpunkt (ISO, UTC-instant) när en dag är känd. Saknas helt för
   * odaterade påminnelser – det är giltigt, inte försenat. Lokal semantik via
   * timezone + hasExplicitTime (datum utan klockslag ≠ midnatt).
   */
  dueAt?: string;
  /** IANA-tidszon, t.ex. Europe/Stockholm – styr all användarvänd formatering. */
  timezone: string;
  /** Angav användaren klockslag/dagsdel? Styr visning och när den dyker upp i uppmärksamhet. */
  hasExplicitTime: boolean;
  status: ReminderStatus;
  source: "assistant" | "user";
  relatedEntityType?: ReminderRelatedType;
  relatedEntityId?: ID;
  createdAt: string;
  completedAt?: string;
  /** Uppskjuten till (ISO) – döljs ur uppmärksamhet tills dess. */
  snoozedUntil?: string;
  /** Reserverad för framtida återkommande påminnelser – ingen implementation ännu. */
  recurrenceRule?: string;
}

/* --------------------------- Uppmärksamhetstillstånd -------------------------- */

/**
 * Snooze/avfärdan för en rad i "Behöver din uppmärksamhet". Ren presentations-
 * policy: domänstatus ändras ALDRIG här – en snoozad faktura är fortfarande
 * försenad, den döljs bara ur uppmärksamhetslistan (och räknaren) tills
 * snoozedUntil passerats. Därefter syns den automatiskt igen OM åtgärds-
 * motorn fortfarande härleder den; är saken löst under tiden är den borta.
 *
 * userId: per användare när inloggning finns (auth.users.id); null i
 * JSON-/demoläget utan inloggning → gäller hela företaget. En rad per
 * (företag, actionId, användare) – tjänstelagret upserttar.
 */
export interface AttentionState {
  id: ID;
  /** Den som snoozade (auth.users.id). null i JSON-läget → företagsgemensam. */
  userId: string | null;
  /** Åtgärdsmotorns stabila rad-id, t.ex. "invoice-late-<id>". */
  actionId: string;
  /** Dold ur uppmärksamhet till denna tidpunkt (ISO). */
  snoozedUntil?: string;
  /** Endast för dismissBehavior HIDE (rena info-rader) – aldrig domänstatus. */
  dismissedAt?: string;
  dismissalReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** Internt verktygsaudit – visas inte i chatten. */
export interface AssistantAuditEntry {
  id: ID;
  at: string;
  tool: string;
  params: unknown;
  success: boolean;
  ms: number;
  error?: string;
}
