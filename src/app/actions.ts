"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resetDemoData } from "@/lib/store";
import {
  createFinalInvoiceForJob,
  createInvoice,
  createInvoiceForJob,
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
import { InvoiceNotReadyError } from "@/lib/invoices/validate";
import { getInvoice, getQuoteByToken } from "@/lib/services/data";
import {
  completeReminder,
  describeSnoozeUntil,
  dismissReminder,
  reopenReminder,
  snoozeReminderBy,
  unsnoozeReminder,
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
import { applyBusinessProfilePatch, updateCompanySettings, type CompanySettingsInput } from "@/lib/services/settings";
import { createCustomer, updateCustomer, updateCustomerNotes } from "@/lib/services/customers";
import {
  createExpenseFromInboxItem,
  ingestUploadedDocument,
  markInboxMailProcessed,
} from "@/lib/services/inbox";
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
  markQuoteNotRelevant,
  updateQuote,
  type QuoteInput,
  type QuoteVersionInput,
} from "@/lib/services/quotes";
import {
  appendJobNote,
  createJob,
  deleteOrArchiveJob,
  reopenJob,
  setJobStatus,
  updateJob,
  updateJobNotes,
} from "@/lib/services/jobs";
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
  generateWebsite,
  publishWebsite,
  removeServiceItem,
  reorderSections,
  reorderServiceItems,
  rewriteSectionHeading,
  sectionImages,
  setSectionVisible,
  submitContactForm,
  updateSection,
  updateServiceItem,
} from "@/lib/services/website";
import {
  cancelPendingAction,
  completeCreateCustomerAndResume,
  confirmPendingAction,
} from "@/lib/services/assistant";
import type { Customer, WebsiteSectionItem } from "@/lib/types";
import { hrefWithNav, type ReturnNav } from "@/lib/nav";
import { headers } from "next/headers";
import { isSupabaseMode } from "@/lib/storage/config";
import { withBusiness, withBusinessRead, withPublicBusiness } from "@/lib/auth/session";

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
): Promise<{ ok: true; mailed: boolean } | { ok: false; errors: string[] }> {
  return withBusiness(
    async () => {
      try {
        const { outcome } = await sendQuoteWithEmail(quoteId);
        if (!outcome.ok) {
          return { ok: false, errors: [outcome.error ?? "Kunde inte skicka offerten."] } as const;
        }
        refresh();
        return { ok: true, mailed: outcome.mode === "live" } as const;
      } catch (e) {
        return {
          ok: false,
          errors: [e instanceof Error ? e.message : "Kunde inte skicka offerten."],
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
): Promise<{ ok: true; mailed: boolean } | { ok: false; errors: string[]; issued?: boolean }> {
  // Steg 1: utfärda + committa ATOMÄRT – ingen e-post i den här transaktionen.
  // issueInvoice är idempotent, så dubbelklick/CAS-retry kan aldrig ge två nummer.
  try {
    await withBusiness(() => {
      issueInvoice(invoiceId);
    }, { capability: "send_invoice" });
  } catch (e) {
    refresh();
    if (e instanceof InvoiceNotReadyError) {
      return { ok: false, errors: e.blockers.map((b) => b.message) } as const;
    }
    return { ok: false, errors: [e instanceof Error ? e.message : "Kunde inte utfärda fakturan."] } as const;
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
        return { ok: true, mailed: outcome.mode === "live" } as const;
      } catch (e) {
        refresh();
        return {
          ok: false,
          errors: [e instanceof Error ? e.message : "Kunde inte skicka fakturan."],
          issued: true,
        } as const;
      }
    },
    { retry: false }
  );
}

export async function deliverInvoiceAction(
  invoiceId: string
): Promise<{ ok: true; mailed: boolean } | { ok: false; errors: string[] }> {
  return withBusiness(
    async () => {
      try {
        const { outcome } = await emailInvoice(invoiceId);
        refresh();
        if (!outcome.ok) {
          return { ok: false, errors: [outcome.error ?? "E-posten kunde inte skickas."] } as const;
        }
        return { ok: true, mailed: outcome.mode === "live" } as const;
      } catch (e) {
        return { ok: false, errors: [e instanceof Error ? e.message : "Kunde inte skicka fakturan igen."] } as const;
      }
    },
    { retry: false }
  );
}

export async function discardInvoiceAction(invoiceId: string): Promise<never> {
  return withBusiness((): never => {
    discardInvoice(invoiceId);
    refresh();
    redirect("/ekonomi?flik=fakturor");
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

export async function updateSectionAction(
  sectionId: string,
  fields: { heading?: string; body?: string; image?: string | null; primaryCtaLabel?: string },
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

export async function rewriteSectionAction(sectionId: string) {
  await withBusiness(() => {
    rewriteSectionHeading(sectionId);
    refresh();
  });
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

export async function resetDemoAction() {
  // Endast JSON-läget – resetDemoData() vägrar köra mot Supabase.
  resetDemoData();
  refresh();
}
