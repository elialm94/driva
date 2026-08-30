import type { ActionCta, BusinessAction } from "./actions";

/**
 * Central deklaration av hur åtgärdsrader FÅR hanteras – EN källa för Hem,
 * Bokföring, Ekonomi-registren och AI:n.
 *
 *   * issueForAction: korta, konkreta etiketter ("Matcha betalning", aldrig
 *     "Behöver åtgärd" när motorn vet mer).
 *   * controlsForAction: per typ – kan raden snoozas? finns en avfärdanväg
 *     och vad GÖR den (domänövergång, aldrig "dölj för alltid" på
 *     finansiella sanningar)? kräver primäråtgärden bekräftelse?
 *   * Primäråtgärden är motorns cta (services/actions.ts). Sekundära
 *     åtgärder härleds ur deklarationen: "Visa X" (viewLabel +
 *     actionResolveHref), "Snooza" (canSnooze) och avfärdan
 *     (canDismiss/dismissBehavior/dismissLabel). AttentionList renderar ur
 *     detta – ingen sidspecifik hårdkodning.
 */

export const FALLBACK_ISSUE_LABEL = "Behöver åtgärd";

export type ActionSourceKind =
  | "expense"
  | "bank"
  | "invoice"
  | "quote"
  | "job"
  | "supplier"
  | "reminder";

export interface ActionSource {
  kind: ActionSourceKind;
  id: string;
}

const CTA_ISSUE: Partial<Record<ActionCta["type"], string>> = {
  uploadReceipt: "Saknar kvitto",
  answerQuestion: "Välj kategori",
  confirmPaymentMatch: "Matcha betalning",
  pickPaymentMatch: "Matcha betalning",
  retryInvoiceEmail: "Skicka igen",
  remindInvoice: "Skicka påminnelse",
  // Skickar en påminnelse via e-post – etiketten säger vad som händer.
  followUpQuote: "Skicka påminnelse",
  createJobInvoice: "Fakturera",
  startJobFromQuote: "Starta uppdrag",
  paySupplier: "Skicka till bank",
  confirmRotPayout: "Bekräfta utbetalning",
  registerCreditRefund: "Återbetala",
  reminderActions: "Påminnelse",
  verifyPaymentDetails: "Kontrollera uppgifter",
  useVerifiedSupplierDetails: "Använd tidigare uppgifter",
  confirmChangedSupplierDetails: "Kontrollera bankuppgifter",
  requestSupplierDetails: "Fråga leverantören",
  paymentDetailsQueue: "Behöver betalningsuppgifter",
};

/** Kort label för en action – aldrig en generisk badge om vi vet mer. */
export function issueForAction(action: BusinessAction): string {
  if (action.cta?.type && CTA_ISSUE[action.cta.type]) return CTA_ISSUE[action.cta.type]!;
  if (action.id.startsWith("rot-missing-")) return "Komplettera ROT";
  if (action.id.startsWith("rot-ready-")) return "Ansök ROT";
  if (action.id.startsWith("rot-denied-")) return "Fakturera resten";
  if (action.id.startsWith("vat-")) return "Kontrollera moms";
  if (action.id.startsWith("job-new-")) return "Nytt uppdrag";
  if (action.id.startsWith("inbox-mail-")) return "Inkommande mejl";
  if (action.id.startsWith("supplier-bank-")) return "Betalningsuppgifter saknas";
  if (action.id.startsWith("supplier-verify-")) return "Kontrollera uppgifter";
  if (action.id.startsWith("supplier-reuse-")) return "Använd tidigare uppgifter";
  if (action.id.startsWith("supplier-dest-")) return "Kontrollera bankuppgifter";
  if (action.id.startsWith("supplier-fail-")) return "Försök igen";
  if (action.id.startsWith("supplier-")) return "Skicka till bank";
  if (action.id.startsWith("invoice-late-")) return "Försenad";
  if (action.id.startsWith("invoice-refund-")) return "Återbetala";
  if (action.id.startsWith("quote-expired-")) return "Utgången offert";
  if (action.id.startsWith("bank-unexplained")) return "Stäm av banken";
  if (action.id.startsWith("bank-")) return action.title.includes("avviker") ? "Betalningen avviker" : FALLBACK_ISSUE_LABEL;
  return FALLBACK_ISSUE_LABEL;
}

/** Vilken entitet actionen hör till – för registerrader och deep links. */
export function sourceForAction(action: BusinessAction): ActionSource | null {
  const cta = action.cta;
  if (cta?.type === "uploadReceipt" || cta?.type === "answerQuestion") return { kind: "expense", id: cta.expenseId };
  if (cta?.type === "confirmPaymentMatch" || cta?.type === "confirmRotPayout" || cta?.type === "pickPaymentMatch") {
    return { kind: "bank", id: cta.txId };
  }
  if (cta?.type === "retryInvoiceEmail" || cta?.type === "remindInvoice") return { kind: "invoice", id: cta.invoiceId };
  if (cta?.type === "registerCreditRefund") return { kind: "invoice", id: cta.invoiceId };
  if (cta?.type === "followUpQuote") return { kind: "quote", id: cta.quoteId };
  if (cta?.type === "createJobInvoice") return { kind: "job", id: cta.jobId };
  if (cta?.type === "startJobFromQuote") return { kind: "quote", id: cta.quoteId };
  if (cta?.type === "paySupplier") return { kind: "supplier", id: cta.supplierInvoiceId };
  if (
    cta?.type === "verifyPaymentDetails" ||
    cta?.type === "useVerifiedSupplierDetails" ||
    cta?.type === "confirmChangedSupplierDetails" ||
    cta?.type === "requestSupplierDetails"
  ) {
    return { kind: "supplier", id: cta.supplierInvoiceId };
  }
  // Gruppraden pekar på flera fakturor – ingen enskild källa att indexera.
  if (cta?.type === "paymentDetailsQueue") return null;
  if (cta?.type === "reminderActions") return { kind: "reminder", id: cta.reminderId };

  if (action.id.startsWith("receipt-")) return { kind: "expense", id: action.id.slice("receipt-".length) };
  if (action.id.startsWith("question-")) return { kind: "expense", id: action.id.slice("question-".length) };
  if (action.id.startsWith("bank-") && action.id !== "bank-unexplained") {
    return { kind: "bank", id: action.id.slice("bank-".length) };
  }
  if (action.id.startsWith("invoice-delivery-")) return { kind: "invoice", id: action.id.slice("invoice-delivery-".length) };
  if (action.id.startsWith("invoice-late-")) return { kind: "invoice", id: action.id.slice("invoice-late-".length) };
  if (action.id.startsWith("job-new-")) return { kind: "job", id: action.id.slice("job-new-".length) };
  if (action.id.startsWith("quote-expired-")) return { kind: "quote", id: action.id.slice("quote-expired-".length) };
  if (action.id.startsWith("supplier-bank-")) return { kind: "supplier", id: action.id.slice("supplier-bank-".length) };
  if (action.id.startsWith("supplier-dest-")) return { kind: "supplier", id: action.id.slice("supplier-dest-".length) };
  if (action.id.startsWith("supplier-fail-")) return { kind: "supplier", id: action.id.slice("supplier-fail-".length) };
  if (action.id.startsWith("supplier-")) return { kind: "supplier", id: action.id.slice("supplier-".length) };
  return null;
}

export function actionResolveHref(action: BusinessAction): string {
  const source = sourceForAction(action);
  if (source?.kind === "expense") return `/ekonomi?flik=utgifter&atgard=${encodeURIComponent(action.id)}`;
  if (source?.kind === "bank") return `/ekonomi?flik=bank&atgard=${encodeURIComponent(action.id)}`;
  if (source?.kind === "supplier") return `/ekonomi?flik=utgifter&atgard=${encodeURIComponent(action.id)}`;
  const sep = action.href.includes("?") ? "&" : "?";
  return `${action.href}${sep}atgard=${encodeURIComponent(action.id)}`;
}

/** Index: "expense:exp-bauhaus" → action. Byggs ur samma motor som Hem. */
export function indexActionsBySource(actions: BusinessAction[]): Map<string, BusinessAction> {
  const map = new Map<string, BusinessAction>();
  for (const action of actions) {
    const source = sourceForAction(action);
    if (!source) continue;
    map.set(`${source.kind}:${source.id}`, action);
  }
  return map;
}

/* ------------------------------ Kontrolldeklaration ---------------------------- */

/** Typnyckel per åtgärdsrad – härleds deterministiskt ur radens stabila id. */
export type AttentionKind =
  | "invoiceDeliveryFailed"
  | "invoiceOverdue"
  | "invoiceRefund"
  | "quoteFollowUp"
  | "quoteExpired"
  | "jobInvoice"
  | "reminder"
  | "rot"
  | "accountingQuestion"
  | "missingReceipt"
  | "bankMatch"
  | "bankUnexplained"
  | "supplierOverdue"
  | "newJob"
  | "inboxMail"
  | "vat"
  | "clientRequest";

export function attentionKind(action: Pick<BusinessAction, "id">): AttentionKind | null {
  const id = action.id;
  if (id.startsWith("invoice-delivery-")) return "invoiceDeliveryFailed";
  if (id.startsWith("invoice-late-")) return "invoiceOverdue";
  if (id.startsWith("invoice-refund-")) return "invoiceRefund";
  if (id.startsWith("quote-wait-")) return "quoteFollowUp";
  if (id.startsWith("quote-expired-")) return "quoteExpired";
  if (id.startsWith("job-final-") || id.startsWith("job-invoice-")) return "jobInvoice";
  if (id.startsWith("reminder-")) return "reminder";
  if (id.startsWith("rot-")) return "rot";
  if (id.startsWith("question-")) return "accountingQuestion";
  if (id.startsWith("receipt-")) return "missingReceipt";
  if (id === "bank-unexplained") return "bankUnexplained";
  if (id.startsWith("bank-")) return "bankMatch";
  if (id.startsWith("supplier-")) return "supplierOverdue";
  if (id.startsWith("job-new-")) return "newJob";
  if (id.startsWith("inbox-mail-")) return "inboxMail";
  if (id.startsWith("vat-")) return "vat";
  if (id.startsWith("client-request-")) return "clientRequest";
  return null;
}

/**
 * Vad avfärdan GÖR per typ – aldrig ett universellt "ta bort för alltid":
 *   MARK_NOT_RELEVANT offert → status "avbojd" med skäl (riktig domänövergång)
 *   DISMISS_REMINDER  påminnelse → mjuk borttagning via påminnelsetjänsten
 *   HIDE              rent ignorerbara info-rader (ingen nuvarande typ) –
 *                     lagras i attention_states.dismissed_at
 *   none              ingen avfärdanväg (finansiella sanningar snoozas bara)
 */
export type DismissBehavior = "MARK_NOT_RELEVANT" | "DISMISS_REMINDER" | "HIDE" | "none";

export interface ActionControls {
  kind: AttentionKind | "unknown";
  /** Explicit "Visa X"-etikett för overflowmenyn (djuplänk via actionResolveHref). */
  viewLabel: string;
  /**
   * Kan raden snoozas? Snooze ändrar ALDRIG domänstatus – bara "visa inte
   * detta under Behöver din uppmärksamhet förrän X". Påminnelser snoozas via
   * sin egen domänsnooze (reminders-tjänsten), aldrig via attention_states.
   */
  canSnooze: boolean;
  canDismiss: boolean;
  dismissBehavior: DismissBehavior;
  /** Mänsklig avfärdan-etikett ("Markera hanterad", "Inte aktuell", "Ta bort"). */
  dismissLabel?: string;
  /** Ändrar avfärdan entitetens status? → lätt bekräftelse i UI:t före utförande. */
  dismissNeedsConfirm?: boolean;
  /**
   * Primäråtgärden skickar e-post/dokument eller bokför pengar → motorn
   * bifogar bekräftelseinnehåll (action.confirm) och UI:t visar dialogen
   * innan något skickas. Inget mejl får gå från ett rent radklick.
   */
  requiresConfirmation: boolean;
}

const CONTROLS: Record<AttentionKind, Omit<ActionControls, "kind">> = {
  invoiceDeliveryFailed: {
    viewLabel: "Visa faktura",
    canSnooze: true,
    canDismiss: false,
    dismissBehavior: "none",
    requiresConfirmation: true, // skickar fakturan igen via e-post
  },
  invoiceOverdue: {
    viewLabel: "Visa faktura",
    canSnooze: true,
    // En förfallen fordran får ALDRIG döljas permanent – bara skjutas upp.
    canDismiss: false,
    dismissBehavior: "none",
    requiresConfirmation: true, // skickar betalningspåminnelse via e-post
  },
  invoiceRefund: {
    viewLabel: "Visa faktura",
    canSnooze: true,
    canDismiss: false,
    dismissBehavior: "none",
    requiresConfirmation: true, // bokför en återbetalning
  },
  quoteFollowUp: {
    viewLabel: "Visa offert",
    canSnooze: true,
    canDismiss: true,
    dismissBehavior: "MARK_NOT_RELEVANT",
    dismissLabel: "Inte aktuell",
    dismissNeedsConfirm: true, // ändrar offertens status till avböjd
    requiresConfirmation: true, // skickar påminnelse via e-post
  },
  quoteExpired: {
    viewLabel: "Visa offert",
    canSnooze: true,
    canDismiss: true,
    dismissBehavior: "MARK_NOT_RELEVANT",
    dismissLabel: "Inte aktuell",
    dismissNeedsConfirm: true,
    requiresConfirmation: false, // primär är en länk
  },
  jobInvoice: {
    viewLabel: "Visa uppdrag",
    canSnooze: true,
    canDismiss: false,
    dismissBehavior: "none",
    requiresConfirmation: false, // skapar bara ett utkast
  },
  reminder: {
    viewLabel: "Öppna",
    canSnooze: true, // egen domänsnooze (Klar/Snooza-flödet) – inte attention_states
    canDismiss: true,
    dismissBehavior: "DISMISS_REMINDER",
    dismissLabel: "Ta bort",
    requiresConfirmation: false,
  },
  rot: {
    viewLabel: "Visa ärende",
    canSnooze: true,
    canDismiss: false,
    dismissBehavior: "none",
    requiresConfirmation: false,
  },
  accountingQuestion: {
    viewLabel: "Visa utgift",
    canSnooze: true,
    canDismiss: false,
    dismissBehavior: "none",
    requiresConfirmation: false, // svarsalternativen ÄR beslutet
  },
  missingReceipt: {
    // ExpenseStatus saknar "underlag saknas/ej avdragsgillt" → ingen
    // permanent avfärdan av en finansiell sanning; snooze räcker.
    viewLabel: "Visa utgift",
    canSnooze: true,
    canDismiss: false,
    dismissBehavior: "none",
    requiresConfirmation: false,
  },
  bankMatch: {
    viewLabel: "Visa transaktion",
    canSnooze: true,
    canDismiss: false,
    dismissBehavior: "none",
    // "Boka betalningen"-knapparna ÄR bekräftelsen (explicit etikett, härlett förslag).
    requiresConfirmation: false,
  },
  bankUnexplained: {
    // Oförklarad differens mellan bank och bokföring ska aldrig tystas.
    viewLabel: "Öppna banken",
    canSnooze: false,
    canDismiss: false,
    dismissBehavior: "none",
    requiresConfirmation: false,
  },
  supplierOverdue: {
    viewLabel: "Visa räkning",
    canSnooze: true,
    canDismiss: false,
    dismissBehavior: "none",
    requiresConfirmation: true, // skickar betalning till banken
  },
  newJob: {
    viewLabel: "Öppna uppdrag",
    canSnooze: true,
    canDismiss: false,
    dismissBehavior: "none",
    requiresConfirmation: false,
  },
  inboxMail: {
    viewLabel: "Visa i inboxen",
    canSnooze: true,
    canDismiss: false,
    dismissBehavior: "none",
    requiresConfirmation: false,
  },
  vat: {
    viewLabel: "Öppna momsöversikten",
    canSnooze: true,
    canDismiss: false,
    dismissBehavior: "none",
    requiresConfirmation: false,
  },
  clientRequest: {
    viewLabel: "Visa utgift",
    canSnooze: true,
    canDismiss: false,
    dismissBehavior: "none",
    requiresConfirmation: false,
  },
};

/** Konservativ fallback för okända id-format: går att snooza, inget mer. */
export const FALLBACK_CONTROLS: ActionControls = {
  kind: "unknown",
  viewLabel: "Visa",
  canSnooze: true,
  canDismiss: false,
  dismissBehavior: "none",
  requiresConfirmation: false,
};

export function controlsForAction(action: Pick<BusinessAction, "id">): ActionControls {
  const kind = attentionKind(action);
  if (!kind) return FALLBACK_CONTROLS;
  const base = { kind, ...CONTROLS[kind] };
  // Betalningsuppgifter: "Kontrollera" och kön öppnar en fokuserad vy – själva
  // klicket har ingen extern effekt (godkännandet bekräftas i vyn). Övriga i
  // familjen (mejlförfrågan, återanvändning, ändrad destination) behåller
  // requiresConfirmation via motorns confirm-innehåll.
  if (action.id.startsWith("supplier-verify-")) {
    return { ...base, requiresConfirmation: false };
  }
  if (action.id === "supplier-details-group") {
    return { ...base, viewLabel: "Visa leverantörsfakturor", requiresConfirmation: false };
  }
  return base;
}

/* ------------------------------- Snooze-presets -------------------------------- */

/**
 * Snabbval för "Snooza" på en uppmärksamhetsrad. Tidsmatten bor i
 * services/attention-state.ts (reminders/when.ts + businessTimezone()) –
 * här bara nycklar och etiketter så klientkomponenter slipper serverkod.
 */
export type AttentionSnoozeChoice =
  | "senare_idag"
  | "imorgon"
  | "om_3_dagar"
  | "nasta_vecka"
  | { date: string };

export const ATTENTION_SNOOZE_PRESETS: { key: Exclude<AttentionSnoozeChoice, { date: string }>; label: string }[] = [
  { key: "senare_idag", label: "Senare idag" },
  { key: "imorgon", label: "Imorgon" },
  { key: "om_3_dagar", label: "Om 3 dagar" },
  { key: "nasta_vecka", label: "Nästa vecka" },
];
