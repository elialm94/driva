"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, resetDemoData, save } from "@/lib/store";
import {
  addIgnoredLineDescription,
  collectLineDescriptionVocabulary,
} from "@/lib/line-description-suggestions";
import {
  createFinalInvoiceForJob,
  createInvoice,
  createInvoiceForJob,
  createInvoiceFromQuote,
  createNextInvoiceForJob,
  createPartInvoiceForQuote,
  createDeniedReductionInvoice,
  creditInvoice,
  discardInvoice,
  updateInvoice,
  type InvoiceInput,
  type InvoiceUpdateInput,
  type JobInvoiceBasis,
} from "@/lib/services/invoices";
import {
  emailInvoice,
  followUpQuoteByEmail,
  remindInvoiceByEmail,
  sendQuoteWithEmail,
} from "@/lib/services/document-mail";
import { issueInvoice } from "@/lib/services/invoices";
import { getInvoiceSendBlockers, InvoiceNotReadyError } from "@/lib/invoices/validate";
import { userFacingInvoiceSendError, userFacingIssueError } from "@/lib/invoices/issue-errors";
import { QuoteNotReadyError } from "@/lib/services/quotes";
import { getInvoice, getQuoteByToken } from "@/lib/services/data";
import {
  completeReminder,
  describeSnoozeUntil,
  dismissReminder,
  reopenReminder,
  snoozeReminderBy,
  unsnoozeReminder,
  updateReminder,
} from "@/lib/services/reminders";
import { clearAttentionSnooze, snoozeAttention } from "@/lib/services/attention-state";
import { snoozeDoneText } from "@/lib/reminders/when";
import type { AttentionSnoozeChoice } from "@/lib/services/action-issue";
import {
  createTaxReductionUnderlag,
  patchTaxReductionFields,
  setTaxReductionDecision,
} from "@/lib/services/tax-reduction";
import type { DwellingType, PaymentDetailsMethod, TaxReductionDetails } from "@/lib/types";
import {
  applyBusinessProfilePatch,
  updateCompanySettings,
  updateWebsiteFormRecipient,
  type CompanySettingsInput,
} from "@/lib/services/settings";
import { createCustomer, updateCustomer, updateCustomerNotes } from "@/lib/services/customers";
import {
  approveInboxExtraction,
  createExpenseFromInboxItem,
  ingestUploadedDocument,
  markInboxMailProcessed,
  type ApproveExtractionInput,
} from "@/lib/services/inbox";
import { createPaymentFile, regeneratePaymentFile } from "@/lib/services/payment-files";
import {
  confirmChangedPaymentDetails,
  prepareSupplierPayment,
  submitSupplierPayment,
  useVerifiedSupplierDetails,
  verifySupplierPaymentDetails,
} from "@/lib/services/supplier-payments";
import { requestPaymentDetailsFromSupplier } from "@/lib/services/payment-details";
import { CustomerValidationError } from "@/lib/customer-validation";
import { resolveCustomerEmail } from "@/lib/resolve-missing-requirements";
import {
  addWorkLocation,
  removeWorkLocation,
  revealCustomerPersonnummer,
  setCustomerPersonnummer,
  isDesignationOnlyLocation,
  syncCustomerProperties,
  updateWorkLocation,
  type PropertyDesignationRow,
  type WorkLocationInput,
} from "@/lib/services/work-locations";
import { maskPersonnummer } from "@/lib/personnummer";
import {
  askQuoteQuestion,
  createQuote,
  declineQuote,
  discardQuote,
  markQuoteNotRelevant,
  updateQuote,
  type QuoteInput,
  type QuoteVersionInput,
} from "@/lib/services/quotes";
import {
  appendJobNote,
  createJob,
  startJobFromQuote,
  deleteOrArchiveJob,
  reopenJob,
  setJobStatus,
  updateJob,
  updateJobNotes,
} from "@/lib/services/jobs";
import {
  createJobAndLinkDocument,
  linkDocumentToJob,
  tryDocumentLink,
  tryDocumentUnlink,
  unlinkDocumentFromJob,
} from "@/lib/services/document-job-link";
import type { DocumentLinkKind, DocumentLinkResult } from "@/lib/document-job-link-model";
import {
  addJobMaterial,
  deleteJobWorkEntry,
  registerJobTime,
  updateJobWorkEntry,
  type JobMaterialInput,
  type JobTimeInput,
  type JobWorkEntryPatch,
} from "@/lib/services/job-work";
import { paySupplierInvoice, simulateIncomingPayment } from "@/lib/services/banking";
import {
  answerExpenseQuestion,
  uploadReceiptForExpense,
  uploadStandaloneReceipt,
} from "@/lib/services/expenses";
import {
  addServiceItem,
  addTestimonialItem,
  addWebsiteSection,
  generateWebsite,
  publishWebsite,
  removeServiceItem,
  removeTestimonialItem,
  removeWebsiteSection,
  reorderSections,
  reorderServiceItems,
  reorderTestimonialItems,
  rewriteSectionHeading,
  sectionImages,
  setSectionVisible,
  setWebsiteDesign,
  setWebsiteFooter,
  submitContactForm,
  updatePrivacyPolicySupplement,
  updateWebsitePrivacyPolicy,
  updateSection,
  updateServiceItem,
  updateTestimonialItem,
  type UpdateSectionFields,
} from "@/lib/services/website";
import type { AddableSectionType } from "@/lib/website-sections";
import {
  cancelPendingAction,
  completeCreateCustomerAndResume,
  confirmPendingAction,
} from "@/lib/services/assistant";
import type { Customer, WebsiteSectionItem } from "@/lib/types";
import { hrefWithNav, type ReturnNav } from "@/lib/nav";
import {
  activateOptionalFeature,
  deactivateOptionalFeature,
  isOptionalFeatureId,
  optionalFeatureHref,
  shouldShowWebsiteRestoreNotice,
  websiteRestoreNoticeHref,
  type OptionalFeatureId,
} from "@/lib/features";
import { headers } from "next/headers";
import { isSupabaseMode } from "@/lib/storage/config";
import { requireBusiness, withBusiness, withBusinessRead, withPublicBusiness } from "@/lib/auth/session";
import { isDemoUserEmail, rateLimitDemoReset } from "@/lib/auth/demo-session";

/**
 * Alla åtgärder körs i tenantkontext via withBusiness (ladda → domänlogik →
 * atomär commit). I JSON-läge kör withBusiness fn direkt – testerna och det
 * lokala läget är oförändrade. Flöden med externa sidoeffekter (mejl, LLM)
 * skickar { retry: false } så att en samtidighetskonflikt aldrig kan skicka
 * om ett mejl.
 */

function refresh() {
  revalidatePath("/", "layout");
}

/* --------------------------------- Kunder --------------------------------- */

export async function createCustomerAction(input: {
  kind: Customer["kind"];
  name: string;
  contactPerson?: string;
  orgNumber?: string;
  /** Frivillig vid skapande – skickaflöden ber om adressen när den behövs. */
  email?: string;
  phone?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  personalIdentityNumber?: string;
  propertyDesignations?: string[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string; field?: string }> {
  return withBusiness(() => {
    try {
      const c = createCustomer(input);
      refresh();
      return { ok: true, id: c.id } as const;
    } catch (e) {
      if (e instanceof CustomerValidationError) {
        return { ok: false, error: e.message, field: e.errors[0]?.field } as const;
      }
      return { ok: false, error: "Kunde inte skapa kunden" } as const;
    }
  });
}

export async function updateCustomerNotesAction(customerId: string, notes: string) {
  await withBusiness(() => {
    updateCustomerNotes(customerId, notes);
    refresh();
  });
}

export async function updateCustomerDetailsAction(
  customerId: string,
  patch: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    postalCode?: string;
    city?: string;
    orgNumber?: string;
    contactPerson?: string;
    notes?: string;
  }
): Promise<{ ok: true } | { ok: false; error: string; field?: string }> {
  return withBusiness(() => {
    try {
      updateCustomer(customerId, patch);
      refresh();
      return { ok: true } as const;
    } catch (e) {
      if (e instanceof CustomerValidationError) {
        return { ok: false, error: e.message, field: e.errors[0]?.field } as const;
      }
      return { ok: false, error: "Kunde inte spara ändringen" } as const;
    }
  });
}

export async function resolveCustomerEmailAction(
  customerId: string,
  email: string
): Promise<{ ok: true; email: string; customerId: string } | { ok: false; error: string }> {
  return withBusiness(() => {
    const result = resolveCustomerEmail(customerId, email);
    if (result.ok) refresh();
    return result;
  });
}

export async function updateCustomerPersonnummerAction(
  customerId: string,
  value: string
): Promise<{ ok: true; masked: string } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      const stored = setCustomerPersonnummer(customerId, value);
      refresh();
      return { ok: true, masked: stored ? maskPersonnummer(stored) : "" } as const;
    } catch (e) {
      if (e instanceof CustomerValidationError) {
        return { ok: false, error: e.message } as const;
      }
      return { ok: false, error: "Kunde inte spara ändringen" } as const;
    }
  });
}

/** Dedikerad Visa-åtgärd. Returnerar fullt personnummer – anropa inte från listor eller AI. */
export async function revealCustomerPersonnummerAction(
  customerId: string
): Promise<{ ok: true; value: string } | { ok: false }> {
  return withBusiness(() => {
    const value = revealCustomerPersonnummer(customerId);
    if (!value) return { ok: false } as const;
    return { ok: true, value } as const;
  }, { capability: "reveal_personnummer" });
}

export async function upsertCustomerWorkLocationAction(
  customerId: string,
  input: WorkLocationInput & { id?: string }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      const location = input.id
        ? updateWorkLocation(customerId, input.id, input)
        : addWorkLocation(customerId, input);
      refresh();
      return { ok: true, id: location.id } as const;
    } catch (e) {
      if (e instanceof CustomerValidationError) {
        return { ok: false, error: e.message } as const;
      }
      return { ok: false, error: "Kunde inte spara bostaden" } as const;
    }
  });
}

export async function syncCustomerPropertiesAction(
  customerId: string,
  rows: PropertyDesignationRow[]
): Promise<
  { ok: true; properties: { id: string; designation: string }[] } | { ok: false; error: string; field?: string }
> {
  return withBusiness(() => {
    try {
      const locations = syncCustomerProperties(customerId, rows);
      refresh();
      return {
        ok: true,
        properties: locations
          .filter((location) => location.propertyDesignation?.trim() || isDesignationOnlyLocation(location))
          .map((location) => ({ id: location.id, designation: location.propertyDesignation ?? "" })),
      } as const;
    } catch (e) {
      if (e instanceof CustomerValidationError) {
        return { ok: false, error: e.message, field: e.errors[0]?.field } as const;
      }
      return { ok: false, error: "Kunde inte spara fastigheterna" } as const;
    }
  });
}

export async function removeCustomerWorkLocationAction(
  customerId: string,
  locationId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      removeWorkLocation(customerId, locationId);
      refresh();
      return { ok: true } as const;
    } catch {
      return { ok: false, error: "Kunde inte ta bort bostaden" } as const;
    }
  });
}

/**
 * Kompakt vokabulär för prisrads-autocomplete.
 * Business hämtas från den autentiserade sessionen via withBusinessRead –
 * klienten skickar inget business_id. Demo ser bara demoföretagets rader.
 */
export async function getLineDescriptionVocabularyAction() {
  return withBusinessRead(() => collectLineDescriptionVocabulary(db()));
}

/**
 * Glöm ett autocomplete-förslag för det aktuella företaget.
 * Skriver bara till businesses.meta.ignoredLineDescriptions – historiska
 * offerter, fakturor och uppdrag lämnas orörda. Business hämtas från sessionen.
 */
export async function forgetLineDescriptionSuggestionAction(text: string) {
  return withBusiness(() => {
    addIgnoredLineDescription(db().meta, text);
    save();
    return collectLineDescriptionVocabulary(db());
  });
}

/* --------------------------------- Offerter -------------------------------- */

export async function createQuoteAction(input: QuoteInput, nav?: ReturnNav): Promise<never> {
  // redirect() kastar kontrollflödesfel – adaptern committar innan den släpper
  // vidare felet, så mutationen går aldrig förlorad.
  return withBusiness(
    (): never => {
      const quote = createQuote(input);
      refresh();
      redirect(hrefWithNav(`/ekonomi/offerter/${quote.id}`, nav));
    },
    { capability: "create_quote" }
  );
}

export async function updateQuoteAction(quoteId: string, input: QuoteVersionInput) {
  await withBusiness(() => {
    updateQuote(quoteId, input);
    refresh();
  });
}

export async function sendQuoteAction(
  quoteId: string
): Promise<{ ok: true; mailed: boolean; demo?: boolean } | { ok: false; errors: string[] }> {
  return withBusiness(
    async () => {
      try {
        const { outcome } = await sendQuoteWithEmail(quoteId);
        if (!outcome.ok) {
          return { ok: false, errors: [outcome.error ?? "Kunde inte skicka offerten."] } as const;
        }
        refresh();
        return { ok: true, mailed: outcome.mode === "live", demo: outcome.mode === "demo" } as const;
      } catch (e) {
        if (e instanceof QuoteNotReadyError) {
          return { ok: false, errors: e.blockers.map((b) => b.message) } as const;
        }
        return {
          ok: false,
          errors: ["Offerten kunde inte skickas just nu. Kontrollera uppgifterna och försök igen."],
        } as const;
      }
    },
    { retry: false }
  );
}

export async function followUpQuoteAction(
  quoteId: string
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  return withBusiness(
    async () => {
      try {
        const { outcome } = await followUpQuoteByEmail(quoteId);
        if (!outcome.ok) {
          return { ok: false, errors: [outcome.error ?? "Påminnelsen kunde inte skickas. Försök igen."] } as const;
        }
        refresh();
        return { ok: true } as const;
      } catch (e) {
        return {
          ok: false,
          errors: [e instanceof Error ? e.message : "Påminnelsen kunde inte skickas. Försök igen."],
        } as const;
      }
    },
    { retry: false }
  );
}

/**
 * Publika åtgärder från /offert/[token]. Kunden identifieras via offertens
 * token – aldrig via internt id – så att en besökare inte kan påverka andra
 * offerter än den hen faktiskt fått länken till.
 */
export async function declineQuoteByTokenAction(token: string, reason?: string) {
  await withPublicBusiness("quote", token, () => {
    const quote = getQuoteByToken(token);
    if (!quote || quote.status !== "skickad") return;
    declineQuote(quote.id, typeof reason === "string" ? reason.slice(0, 2000) : undefined);
    refresh();
  });
}

export async function askQuoteQuestionByTokenAction(token: string, question: string) {
  await withPublicBusiness("quote", token, () => {
    const quote = getQuoteByToken(token);
    if (!quote || quote.status === "utkast") return;
    const text = typeof question === "string" ? question.trim().slice(0, 4000) : "";
    if (!text) return;
    askQuoteQuestion(quote.id, text);
    refresh();
  });
}

/* ----------------------------------- Uppdrag ---------------------------------- */

export async function startJobFromQuoteAction(quoteId: string): Promise<string> {
  return withBusiness(() => {
    const job = startJobFromQuote(quoteId);
    refresh();
    return job.id;
  });
}

export async function createInvoiceFromQuoteAction(quoteId: string): Promise<string> {
  return withBusiness(() => {
    const inv = createInvoiceFromQuote(quoteId);
    refresh();
    return inv.id;
  });
}

export async function createJobAction(input: {
  customerId: string;
  title: string;
  description?: string;
  startDate?: string;
  workLocationId?: string;
  newWorkLocation?: WorkLocationInput;
}): Promise<string> {
  return withBusiness(() => {
    const job = createJob(input);
    refresh();
    return job.id;
  });
}

export async function setJobStatusAction(jobId: string, status: "kommande" | "pagar" | "klart") {
  await withBusiness(() => {
    setJobStatus(jobId, status);
    refresh();
  }, { capability: "change_jobs" });
}

export async function reopenJobAction(jobId: string) {
  await withBusiness(() => {
    reopenJob(jobId);
    refresh();
  });
}

export async function deleteOrArchiveJobAction(jobId: string): Promise<"deleted" | "archived"> {
  return withBusiness(() => {
    const result = deleteOrArchiveJob(jobId);
    refresh();
    return result.kind;
  });
}

export async function updateJobAction(
  jobId: string,
  input: { title?: string; description?: string; address?: string; startDate?: string; endDate?: string }
) {
  await withBusiness(() => {
    updateJob(jobId, input);
    refresh();
  });
}

export async function updateJobNotesAction(jobId: string, notes: string) {
  await withBusiness(() => {
    updateJobNotes(jobId, notes);
    refresh();
  });
}

export async function appendJobNoteAction(jobId: string, text: string) {
  await withBusiness(() => {
    appendJobNote(jobId, text);
    refresh();
  });
}

export async function registerJobTimeAction(jobId: string, input: JobTimeInput) {
  await withBusiness(() => {
    registerJobTime(jobId, input);
    refresh();
  });
}

export async function addJobMaterialAction(jobId: string, input: JobMaterialInput) {
  await withBusiness(() => {
    addJobMaterial(jobId, input);
    refresh();
  });
}

export async function updateJobWorkEntryAction(entryId: string, patch: JobWorkEntryPatch) {
  await withBusiness(() => {
    updateJobWorkEntry(entryId, patch);
    refresh();
  });
}

export async function deleteJobWorkEntryAction(entryId: string) {
  await withBusiness(() => {
    deleteJobWorkEntry(entryId);
    refresh();
  });
}

export async function createInvoiceForJobAction(jobId: string, basis: JobInvoiceBasis): Promise<string> {
  return withBusiness(() => {
    const inv = createInvoiceForJob(jobId, basis);
    refresh();
    return inv.id;
  });
}

export async function linkDocumentToJobAction(
  kind: DocumentLinkKind,
  documentId: string,
  jobId: string
): Promise<DocumentLinkResult> {
  return withBusiness(() => {
    const result = tryDocumentLink(() => linkDocumentToJob(kind, documentId, jobId));
    if (result.ok) refresh();
    return result;
  });
}

export async function unlinkDocumentFromJobAction(
  kind: DocumentLinkKind,
  documentId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    const result = tryDocumentUnlink(() => unlinkDocumentFromJob(kind, documentId));
    if (result.ok) refresh();
    return result;
  });
}

export async function createJobAndLinkDocumentAction(
  kind: DocumentLinkKind,
  documentId: string,
  title: string
): Promise<DocumentLinkResult> {
  return withBusiness(() => {
    const result = tryDocumentLink(() => createJobAndLinkDocument(kind, documentId, title));
    if (result.ok) refresh();
    return result;
  });
}

/* --------------------------------- Fakturor -------------------------------- */

export async function createFinalInvoiceForJobAction(jobId: string): Promise<string> {
  return withBusiness(() => {
    const inv = createFinalInvoiceForJob(jobId);
    refresh();
    return inv.id;
  });
}

export async function createNextInvoiceForJobAction(jobId: string): Promise<string> {
  return withBusiness(() => {
    const inv = createNextInvoiceForJob(jobId);
    refresh();
    return inv.id;
  });
}

export async function createPartInvoiceAction(quoteId: string, partIndex: number): Promise<string> {
  return withBusiness(() => {
    const inv = createPartInvoiceForQuote(quoteId, partIndex);
    refresh();
    return inv.id;
  });
}

export async function createInvoiceAction(input: InvoiceInput, nav?: ReturnNav): Promise<never> {
  return withBusiness((): never => {
    const inv = createInvoice(input);
    refresh();
    redirect(hrefWithNav(`/ekonomi/fakturor/${inv.id}`, nav));
  });
}

export async function updateInvoiceAction(
  invoiceId: string,
  input: InvoiceUpdateInput,
  nav?: ReturnNav
): Promise<never> {
  return withBusiness((): never => {
    const inv = updateInvoice(invoiceId, input);
    refresh();
    redirect(hrefWithNav(`/ekonomi/fakturor/${inv.id}`, nav));
  });
}

export async function sendInvoiceAction(
  invoiceId: string
): Promise<{ ok: true; mailed: boolean; demo?: boolean } | { ok: false; errors: string[]; issued?: boolean }> {
  // Steg 1: utfärda + committa ATOMÄRT – ingen e-post i den här transaktionen.
  // issueInvoice är idempotent, så dubbelklick/CAS-retry kan aldrig ge två nummer.
  try {
    await withBusiness(() => {
      const blockers = getInvoiceSendBlockers(invoiceId);
      if (blockers.length) throw new InvoiceNotReadyError(blockers);
      issueInvoice(invoiceId);
    }, { capability: "send_invoice" });
  } catch (e) {
    refresh();
    if (e instanceof InvoiceNotReadyError) {
      return { ok: false, errors: e.blockers.map((b) => b.message) } as const;
    }
    return { ok: false, errors: [userFacingIssueError(e)] } as const;
  }

  // Steg 2: e-posta i EGEN transaktion (retry: false – ett mejl får aldrig
  // skickas om av en samtidighetskonflikt). Misslyckas mejlet är läget ärligt:
  // "utfärdad, ej skickad" med en skicka-igen-åtgärd som aldrig utfärdar om.
  return withBusiness(
    async () => {
      try {
        const { outcome } = await emailInvoice(invoiceId);
        refresh();
        if (!outcome.ok) {
          return { ok: false, errors: [outcome.error ?? "E-posten kunde inte skickas."], issued: true } as const;
        }
        return { ok: true, mailed: outcome.mode === "live", demo: outcome.mode === "demo" } as const;
      } catch (e) {
        refresh();
        return {
          ok: false,
          errors: [userFacingInvoiceSendError(e)],
          issued: true,
        } as const;
      }
    },
    { retry: false }
  );
}

export async function deliverInvoiceAction(
  invoiceId: string
): Promise<{ ok: true; mailed: boolean; demo?: boolean } | { ok: false; errors: string[] }> {
  return withBusiness(
    async () => {
      try {
        const { outcome } = await emailInvoice(invoiceId);
        refresh();
        if (!outcome.ok) {
          return { ok: false, errors: [outcome.error ?? "E-posten kunde inte skickas."] } as const;
        }
        return { ok: true, mailed: outcome.mode === "live", demo: outcome.mode === "demo" } as const;
      } catch (e) {
        return { ok: false, errors: [userFacingInvoiceSendError(e)] } as const;
      }
    },
    { retry: false }
  );
}

export async function discardInvoiceAction(invoiceId: string): Promise<never> {
  return withBusiness((): never => {
    discardInvoice(invoiceId);
    refresh();
    redirect("/ekonomi?flik=fakturor&kastat=faktura");
  });
}

export async function discardQuoteAction(quoteId: string): Promise<never> {
  return withBusiness((): never => {
    discardQuote(quoteId);
    refresh();
    redirect("/ekonomi?flik=offerter&kastat=offert");
  });
}

export async function sendReminderAction(
  invoiceId: string
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  return withBusiness(
    async () => {
      try {
        const { outcome } = await remindInvoiceByEmail(invoiceId);
        if (!outcome.ok) {
          return { ok: false, errors: [outcome.error ?? "Påminnelsen kunde inte skickas. Försök igen."] } as const;
        }
        refresh();
        return { ok: true } as const;
      } catch (e) {
        return {
          ok: false,
          errors: [e instanceof Error ? e.message : "Påminnelsen kunde inte skickas. Försök igen."],
        } as const;
      }
    },
    { retry: false }
  );
}

export async function completeReminderAction(reminderId: string) {
  await withBusiness(
    async () => {
      completeReminder(reminderId);
      // Ingen revalidatePath här – raden stannar så Ångra kan visas.
    },
    { retry: false }
  );
}

export async function undoCompleteReminderAction(reminderId: string) {
  await withBusiness(
    async () => {
      reopenReminder(reminderId);
      refresh();
    },
    { retry: false }
  );
}

export async function snoozeReminderAction(
  reminderId: string,
  choice: "1h" | "imorgon" | { date: string; time?: string }
) {
  return withBusiness(
    async () => {
      const { reminder, previousSnoozedUntil } = snoozeReminderBy(reminderId, choice);
      refresh();
      const until = reminder.snoozedUntil;
      if (!until) throw new Error("Påminnelsen saknar snoozetid.");
      return {
        ok: true as const,
        until,
        untilText: describeSnoozeUntil(until, reminder.timezone),
        toast: snoozeDoneText(until, new Date(), reminder.timezone),
        previousSnoozedUntil: previousSnoozedUntil ?? null,
      } as const;
    },
    { retry: false }
  );
}

export async function undoSnoozeReminderAction(reminderId: string, previousSnoozedUntil?: string | null) {
  return unsnoozeReminderAction(reminderId, previousSnoozedUntil);
}

export async function unsnoozeReminderAction(reminderId: string, previousSnoozedUntil?: string | null) {
  await withBusiness(
    async () => {
      unsnoozeReminder(reminderId, previousSnoozedUntil);
      refresh();
    },
    { retry: false }
  );
}

/**
 * Mjuk borttagning (status DISMISSED). Inte en kundåtgärd på påminnelseraden –
 * Klar är enda sättet att avsluta i UI. Behålls för admin/API.
 */
export async function dismissReminderAction(reminderId: string) {
  await withBusiness(
    async () => {
      dismissReminder(reminderId);
      refresh();
    },
    { retry: false }
  );
}

export async function updateReminderAction(
  reminderId: string,
  patch: { title?: string; whenDate?: string; time?: string; clearWhen?: boolean }
) {
  return withBusiness(
    async () => {
      const updated = updateReminder(reminderId, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        when: patch.clearWhen
          ? { kind: "none" }
          : patch.whenDate
            ? { kind: "date", date: patch.whenDate, time: patch.time }
            : undefined,
      });
      if (!updated.ok) return { ok: false as const, error: updated.error };
      refresh();
      return { ok: true as const };
    },
    { retry: false }
  );
}

/**
 * Snooza en uppmärksamhetsrad: döljer den ur "Behöver din uppmärksamhet"
 * tills tidpunkten passerat. Ändrar ALDRIG domänstatus – fakturan förblir
 * försenad, registren visar fortfarande fakta.
 */
export async function snoozeAttentionAction(actionId: string, choice: AttentionSnoozeChoice) {
  return withBusiness(
    async () => {
      const state = snoozeAttention(actionId, choice);
      refresh();
      const until = state.snoozedUntil!;
      return { until, toast: snoozeDoneText(until) } as const;
    },
    { retry: false }
  );
}

export async function unsnoozeAttentionAction(actionId: string) {
  await withBusiness(
    async () => {
      clearAttentionSnooze(actionId);
      refresh();
    },
    { retry: false }
  );
}

export async function markInboxMailProcessedAction(itemId: string) {
  await withBusiness(
    async () => {
      markInboxMailProcessed(itemId);
      refresh();
    },
    { retry: false }
  );
}

/**
 * Godkänn (ev. rättade) tolkade uppgifter från Kontrollera-vyn. Efter
 * godkännandet körs dokumentpipelinen om med konfidens 1 – kvitton matchas
 * och bokförs, fakturor skapas/bokförs och blir redo att betala.
 */
export async function approveInboxExtractionAction(
  input: ApproveExtractionInput
): Promise<
  | { ok: true; autoBooked: boolean; expenseId?: string; invoiceId?: string }
  | { ok: false; error: string }
> {
  return withBusiness(() => {
    try {
      const result = approveInboxExtraction({ ...input, by: "anvandare" });
      refresh();
      return {
        ok: true as const,
        autoBooked: result.autoBooked,
        ...(result.expenseId ? { expenseId: result.expenseId } : {}),
        ...(result.invoiceId ? { invoiceId: result.invoiceId } : {}),
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Uppgifterna kunde inte godkännas." };
    }
  }, { capability: "write_accounting" });
}

/**
 * Skapa bankfil (pain.001) för en eller flera bokförda fakturor. Kräver
 * submit_bank_payment: konsulten förbereder, ägaren godkänner bankåtgärden.
 */
export async function createPaymentFileAction(input: {
  supplierInvoiceIds: string[];
}): Promise<{ ok: true; fileId: string; filename: string } | { ok: false; problems: string[] }> {
  return withBusiness(() => {
    const result = createPaymentFile({ supplierInvoiceIds: input.supplierInvoiceIds, by: "anvandare" });
    if (!result.ok) return { ok: false as const, problems: result.problems };
    refresh();
    return { ok: true as const, fileId: result.file.id, filename: result.file.filename };
  }, { capability: "submit_bank_payment" });
}

/** Ersätt en aktiv bankfil med en ny (gamla får status REPLACED – aldrig två aktiva). */
export async function regeneratePaymentFileAction(
  fileId: string
): Promise<{ ok: true; fileId: string; filename: string } | { ok: false; problems: string[] }> {
  return withBusiness(() => {
    const result = regeneratePaymentFile(fileId, "anvandare");
    if (!result.ok) return { ok: false as const, problems: result.problems };
    refresh();
    return { ok: true as const, fileId: result.file.id, filename: result.file.filename };
  }, { capability: "submit_bank_payment" });
}

export async function createExpenseFromInboxAction(
  itemId: string
): Promise<{ ok: true; expenseId: string } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      const result = createExpenseFromInboxItem(itemId);
      refresh();
      return { ok: true as const, expenseId: result.expenseId };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Kunde inte skapa utgift." };
    }
  }, { capability: "write_accounting" });
}

/** "Inte aktuell" på en väntande offert – domänövergång till avböjd med skäl. */
export async function markQuoteNotRelevantAction(quoteId: string) {
  await withBusiness(
    async () => {
      markQuoteNotRelevant(quoteId);
      refresh();
    },
    { retry: false }
  );
}

export async function creditInvoiceAction(invoiceId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      creditInvoice(invoiceId);
      refresh();
      return { ok: true } as const;
    } catch (e) {
      if (e instanceof InvoiceNotReadyError) {
        return { ok: false, error: e.blockers.map((b) => b.message).join(" ") } as const;
      }
      return { ok: false, error: e instanceof Error ? e.message : "Kunde inte kreditera fakturan." } as const;
    }
  });
}

export async function createDeniedReductionInvoiceAction(
  invoiceId: string,
  deniedAmount: number
): Promise<{ ok: true; invoiceId: string } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      const inv = createDeniedReductionInvoice(invoiceId, deniedAmount);
      refresh();
      return { ok: true, invoiceId: inv.id } as const;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Kunde inte skapa fakturautkast." } as const;
    }
  });
}

export async function createTaxReductionUnderlagAction(input: {
  jobId?: string;
  invoiceId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      createTaxReductionUnderlag(input);
      refresh();
      return { ok: true } as const;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Kunde inte skapa underlag." } as const;
    }
  });
}

export async function setTaxReductionDecisionAction(input: {
  jobId?: string;
  invoiceId?: string;
  outcome: "godkant" | "delvis_godkant" | "nekat";
  deniedAmount?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      setTaxReductionDecision(input);
      refresh();
      return { ok: true } as const;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara beslut." } as const;
    }
  });
}

export async function patchTaxReductionFieldsAction(input: {
  jobId?: string;
  invoiceId?: string;
  personalIdentityNumber?: string;
  details?: Partial<TaxReductionDetails>;
  dwellingType?: DwellingType;
  propertyDesignation?: string;
  brfOrgNumber?: string;
  apartmentNumber?: string;
  workAddress?: string;
  workPeriodStart?: string;
  workPeriodEnd?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      patchTaxReductionFields(input);
      refresh();
      return { ok: true } as const;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara uppgiften." } as const;
    }
  });
}

export async function simulatePaymentAction(invoiceId: string) {
  await withBusiness(() => {
    simulateIncomingPayment(invoiceId);
    refresh();
  });
}

export async function paySupplierInvoiceAction(supplierInvoiceId: string) {
  await withBusiness(() => {
    paySupplierInvoice(supplierInvoiceId);
    refresh();
  }, { capability: "submit_bank_payment" });
}

export async function uploadInboxDocumentAction(input: {
  filename: string;
  contentType?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  return withBusiness(() => {
    const result = ingestUploadedDocument({
      filename: input.filename,
      contentType: input.contentType,
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    refresh();
    return { ok: true as const, id: result.item.id };
  }, { capability: "write_accounting" });
}

export async function submitSupplierPaymentAction(input: {
  supplierInvoiceId: string;
  paymentId?: string;
  scheduledDate?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      const payment = prepareSupplierPayment({
        supplierInvoiceId: input.supplierInvoiceId,
        scheduledDate: input.scheduledDate,
      });
      const result = submitSupplierPayment(payment.id, input.scheduledDate);
      if (!result.ok) return { ok: false as const, error: result.error };
      refresh();
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Kunde inte skicka betalningen." };
    }
  }, { capability: "submit_bank_payment" });
}

/* ------------------------------ Utgifter/kvitton ---------------------------- */

export async function uploadReceiptAction(expenseId: string, filename: string) {
  await withBusiness(() => {
    uploadReceiptForExpense(expenseId, filename, "uppladdning");
    refresh();
  }, { capability: "categorize" });
}

export async function uploadStandaloneReceiptAction(filename: string) {
  await withBusiness(() => {
    uploadStandaloneReceipt(filename);
    refresh();
  }, { capability: "categorize" });
}

export async function answerExpenseQuestionAction(expenseId: string, answer: string) {
  await withBusiness(() => {
    answerExpenseQuestion(expenseId, answer);
    refresh();
  }, { capability: "categorize" });
}

export async function prepareSupplierPaymentAction(input: {
  supplierInvoiceId: string;
  scheduledDate?: string;
}): Promise<{ ok: true; paymentId: string } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      const payment = prepareSupplierPayment({
        supplierInvoiceId: input.supplierInvoiceId,
        scheduledDate: input.scheduledDate,
      });
      refresh();
      return { ok: true as const, paymentId: payment.id };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Kunde inte förbereda betalningen." };
    }
  }, { capability: "prepare_supplier_payment" });
}

/* ----------------------- Betalningsuppgifter (leverantör) ------------------- */

/** Människan har kontrollerat/angett uppgifterna → verifiera med proveniens. */
export async function verifySupplierPaymentDetailsAction(input: {
  supplierInvoiceId: string;
  method: PaymentDetailsMethod;
  account: string;
  ocr?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      verifySupplierPaymentDetails(input);
      refresh();
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Kunde inte spara uppgifterna." };
    }
  }, { capability: "prepare_supplier_payment" });
}

/** Återanvänd tidigare VERIFIERADE uppgifter för samma leverantör. */
export async function useVerifiedSupplierDetailsAction(
  supplierInvoiceId: string
): Promise<{ ok: true; account: string } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      const { details } = useVerifiedSupplierDetails(supplierInvoiceId);
      refresh();
      return { ok: true as const, account: details.account };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Kunde inte återanvända uppgifterna." };
    }
  }, { capability: "prepare_supplier_payment" });
}

/**
 * Godkänn ÄNDRAD betaldestination efter mänsklig kontroll. Samma behörighet
 * som att skicka pengar – det är i praktiken ett betalningsgodkännande.
 */
export async function confirmChangedSupplierDetailsAction(
  supplierInvoiceId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      confirmChangedPaymentDetails(supplierInvoiceId);
      refresh();
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Kunde inte godkänna uppgifterna." };
    }
  }, { capability: "submit_bank_payment" });
}

/** Skicka mejlförfrågan om betalningsuppgifter till leverantören (bekräftad i UI:t). */
export async function requestSupplierDetailsAction(
  supplierInvoiceId: string
): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  return withBusiness(async () => {
    const result = await requestPaymentDetailsFromSupplier(supplierInvoiceId);
    if (!result.ok) return { ok: false as const, error: result.error };
    refresh();
    return { ok: true as const, to: result.to };
  }, { capability: "prepare_supplier_payment" });
}

/* ---------------------------------- Hemsida --------------------------------- */

export async function generateWebsiteAction(description: string) {
  await withBusiness(() => {
    generateWebsite(description);
    refresh();
  }, { capability: "change_website" });
}

export async function activateOptionalFeatureAction(
  id: OptionalFeatureId,
): Promise<{ ok: true; href: string } | { ok: false; error: string }> {
  try {
    return await withBusiness(async () => {
      if (!isOptionalFeatureId(id)) {
        return { ok: false, error: "Okänd funktion." } as const;
      }
      const wasPaused = id === "website" && shouldShowWebsiteRestoreNotice();
      activateOptionalFeature(id);
      if (id === "collaboration") {
        const { actorForFeatureChange, logCollaborationFeatureEnabled } = await import(
          "@/lib/collaboration/service"
        );
        const actor = actorForFeatureChange();
        logCollaborationFeatureEnabled(actor.name, actor.userId);
      }
      refresh();
      const href =
        id === "website" && (wasPaused || shouldShowWebsiteRestoreNotice())
          ? websiteRestoreNoticeHref()
          : optionalFeatureHref(id);
      return { ok: true, href } as const;
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Kunde inte aktivera funktionen." };
  }
}

export async function deactivateOptionalFeatureAction(
  id: OptionalFeatureId,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    return await withBusiness(
      async () => {
        if (!isOptionalFeatureId(id)) {
          return { ok: false, error: "Okänd funktion." } as const;
        }
        deactivateOptionalFeature(id);
        if (id === "collaboration") {
          const { actorForFeatureChange, revokeCollaborationAccessForFeatureOff } = await import(
            "@/lib/collaboration/service"
          );
          const actor = actorForFeatureChange();
          await revokeCollaborationAccessForFeatureOff({
            businessId: actor.businessId,
            revokedByUserId: actor.userId,
            revokedByName: actor.name,
          });
        }
        refresh();
        return { ok: true } as const;
      },
      id === "collaboration" ? { capability: "revoke_collaborator", retry: false } : { retry: false },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Kunde inte stänga av funktionen." };
  }
}

export async function updateSectionAction(
  sectionId: string,
  fields: UpdateSectionFields,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      updateSection(sectionId, fields);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara." } as const;
    }
    refresh();
    return { ok: true } as const;
  });
}

/** Läser bilddata för en sektion vid behov (redigeraren) i stället för att skicka den med sidan. */
export async function getSectionImagesAction(sectionId: string) {
  return withBusinessRead(() => {
    try {
      return sectionImages(sectionId);
    } catch {
      return null;
    }
  });
}

export async function addServiceItemAction(
  sectionId: string,
  item: WebsiteSectionItem,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      addServiceItem(sectionId, item);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara tjänsten." } as const;
    }
    refresh();
    return { ok: true } as const;
  });
}

export async function updateServiceItemAction(
  sectionId: string,
  index: number,
  fields: { title?: string; text?: string; image?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      updateServiceItem(sectionId, index, fields);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara tjänsten." } as const;
    }
    refresh();
    return { ok: true } as const;
  });
}

export async function removeServiceItemAction(sectionId: string, index: number) {
  return withBusiness(() => {
    const result = removeServiceItem(sectionId, index);
    if (!result.error) refresh();
    return result;
  });
}

export async function reorderServiceItemsAction(sectionId: string, fromIndex: number, toIndex: number) {
  await withBusiness(() => {
    reorderServiceItems(sectionId, fromIndex, toIndex);
    refresh();
  });
}

export async function reorderSectionsAction(orderedIds: string[]) {
  await withBusiness(() => {
    reorderSections(orderedIds);
    refresh();
  });
}

export async function setSectionVisibleAction(sectionId: string, visible: boolean) {
  await withBusiness(() => {
    setSectionVisible(sectionId, visible);
    refresh();
  });
}

export async function addWebsiteSectionAction(
  type: AddableSectionType,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      const section = addWebsiteSection(type);
      refresh();
      return { ok: true as const, id: section.id };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Kunde inte lägga till sektionen." };
    }
  });
}

export async function removeWebsiteSectionAction(
  sectionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      removeWebsiteSection(sectionId);
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Kunde inte ta bort sektionen." };
    }
    refresh();
    return { ok: true as const };
  });
}

export async function addTestimonialItemAction(
  sectionId: string,
  item: WebsiteSectionItem,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      addTestimonialItem(sectionId, item);
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Kunde inte spara omdömet." };
    }
    refresh();
    return { ok: true as const };
  });
}

export async function updateTestimonialItemAction(
  sectionId: string,
  index: number,
  fields: { title?: string; text?: string; location?: string | null; rating?: number | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      updateTestimonialItem(sectionId, index, fields);
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Kunde inte spara omdömet." };
    }
    refresh();
    return { ok: true as const };
  });
}

export async function removeTestimonialItemAction(sectionId: string, index: number) {
  return withBusiness(() => {
    const result = removeTestimonialItem(sectionId, index);
    if (!result.error) refresh();
    return result;
  });
}

export async function reorderTestimonialItemsAction(sectionId: string, fromIndex: number, toIndex: number) {
  await withBusiness(() => {
    reorderTestimonialItems(sectionId, fromIndex, toIndex);
    refresh();
  });
}

export async function rewriteSectionAction(sectionId: string) {
  await withBusiness(() => {
    rewriteSectionHeading(sectionId);
    refresh();
  });
}

/**
 * Tema/accent-val från Utseende-panelen. Sparas som utkast direkt (ingen
 * spara-knapp) – den publika sajten ändras först vid "Publicera ändringar".
 */
export async function setWebsiteDesignAction(input: {
  themeId: string;
  accent: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    return await withBusiness(() => {
      try {
        setWebsiteDesign(input);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Kunde inte byta utseende." } as const;
      }
      refresh();
      return { ok: true } as const;
    }, { capability: "change_website" });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara utseendet." };
  }
}

export async function setWebsiteFooterAction(input: {
  showPhone?: boolean;
  showEmail?: boolean;
  showAddress?: boolean;
  showServices?: boolean;
  showLogo?: boolean;
  aboutText?: string;
  social?: { instagram?: string; facebook?: string; tiktok?: string };
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    return await withBusiness(() => {
      try {
        setWebsiteFooter(input);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara sidfoten." } as const;
      }
      refresh();
      return { ok: true } as const;
    }, { capability: "change_website" });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara sidfoten." };
  }
}

export async function updatePrivacyPolicySupplementAction(
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      updatePrivacyPolicySupplement(text);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara." } as const;
    }
    refresh();
    return { ok: true } as const;
  }, { capability: "change_website" });
}

export async function updateWebsiteFormRecipientAction(
  email: string | null,
): Promise<{ ok: true; recipient: string } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      const recipient = updateWebsiteFormRecipient(email);
      refresh();
      return { ok: true, recipient } as const;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara." } as const;
    }
  }, { capability: "change_website" });
}

export async function updateWebsitePrivacyPolicyAction(input: {
  mode: "standard" | "custom";
  supplement?: string;
  customBody?: unknown;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      updateWebsitePrivacyPolicy(input);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara." } as const;
    }
    refresh();
    return { ok: true } as const;
  }, { capability: "change_website" });
}

export async function publishWebsiteAction() {
  await withBusiness(() => {
    publishWebsite();
    refresh();
  });
}

export async function submitContactFormAction(input: {
  name: string;
  email: string;
  phone?: string;
  message: string;
  website?: string;
  idempotencyKey?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const fn = async () => {
    try {
      await submitContactForm(input);
      refresh();
      return { ok: true } as const;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Kunde inte skicka meddelandet." } as const;
    }
  };
  // Publik sajt: företaget löses från värdnamnet (kundens domän). I appens
  // förhandsvisning matchar inget värdnamn – då gäller inloggad session.
  if (isSupabaseMode()) {
    const h = await headers();
    const host = h.get("x-driva-public-host") ?? h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const viaHost = await withPublicBusiness("hostname", host, fn, { retry: false });
      if (viaHost) return viaHost;
    }
  }
  return withBusiness(fn, { retry: false });
}

/* --------------------------------- Assistent -------------------------------- */

export async function confirmAssistantActionAction(actionId: string) {
  await withBusiness(
    async () => {
      await confirmPendingAction(actionId);
      refresh();
    },
    { retry: false }
  );
}

export async function cancelAssistantActionAction(actionId: string) {
  await withBusiness(() => {
    cancelPendingAction(actionId);
    refresh();
  });
}

export async function completeAssistantCustomerAction(actionId: string, customerId: string) {
  await withBusiness(() => {
    completeCreateCustomerAndResume(actionId, customerId);
    refresh();
  });
}

/* ------------------------------ Företagsuppgifter --------------------------- */

export async function updateCompanySettingsAction(
  input: CompanySettingsInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      updateCompanySettings(input);
      refresh();
      return { ok: true } as const;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara." } as const;
    }
  });
}

/** Autosparar enbart logotypen (null = ta bort). Rör aldrig resten av ett halvredigerat formulär. */
export async function saveLogoAction(
  logoDataUrl: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withBusiness(() => {
    try {
      applyBusinessProfilePatch({ logoDataUrl });
      refresh();
      return { ok: true } as const;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara." } as const;
    }
  });
}

/* ------------------------------------ Demo ---------------------------------- */

export async function resetDemoAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isSupabaseMode()) {
    // Publika demosessionen: töm demoföretaget i databasen (SQL-funktionen
    // vägrar för alla företag som inte skapades som demo) och spela upp
    // exempeldatat igen genom appens vanliga importväg.
    const { user, businessId } = await requireBusiness();
    if (!isDemoUserEmail(user.email)) {
      return { ok: false, error: "Endast demosessionen kan återställa demon." };
    }
    if (!rateLimitDemoReset()) {
      return { ok: false, error: "Demon återställdes nyss. Vänta en liten stund och försök igen." };
    }
    const { resetDemoBusinessToSeed } = await import("@/lib/storage/demo-reset");
    try {
      await resetDemoBusinessToSeed(businessId, user.id);
    } catch (e) {
      console.error(`[driva:demo] återställning misslyckades: ${e instanceof Error ? e.message : e}`);
      return { ok: false, error: "Demon kunde inte återställas just nu. Försök igen om en stund." };
    }
    refresh();
    return { ok: true };
  }
  // JSON-läget – resetDemoData() vägrar köra mot Supabase.
  resetDemoData();
  refresh();
  return { ok: true };
}
