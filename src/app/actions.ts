"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resetDemoData } from "@/lib/store";
import {
  createFinalInvoiceForJob,
  createInvoice,
  createNextInvoiceForJob,
  createPartInvoiceForQuote,
  createDeniedReductionInvoice,
  creditInvoice,
  discardInvoice,
  updateInvoice,
  type InvoiceInput,
  type InvoiceUpdateInput,
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
import { completeReminder, dismissReminder, snoozeReminderBy } from "@/lib/services/reminders";
import { snoozeAttention } from "@/lib/services/attention-state";
import type { AttentionSnoozeChoice } from "@/lib/services/action-issue";
import {
  createTaxReductionUnderlag,
  patchTaxReductionFields,
  setTaxReductionDecision,
} from "@/lib/services/tax-reduction";
import type { DwellingType, TaxReductionDetails } from "@/lib/types";
import { applyBusinessProfilePatch, updateCompanySettings, type CompanySettingsInput } from "@/lib/services/settings";
import { createCustomer, createRequest, markInquiryHandled, updateCustomer, updateCustomerNotes } from "@/lib/services/customers";
import { createExpenseFromInboxItem, markInboxMailProcessed } from "@/lib/services/inbox";
import { CustomerValidationError } from "@/lib/customer-validation";
import {
  addWorkLocation,
  revealCustomerPersonnummer,
  setCustomerPersonnummer,
  updateWorkLocation,
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
  setJobStatus,
  updateJob,
  updateJobNotes,
} from "@/lib/services/jobs";
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
import type { Customer, RequestSource, WebsiteSectionItem } from "@/lib/types";
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
  email: string;
  phone: string;
  address?: string;
  postalCode?: string;
  city?: string;
}): Promise<string> {
  return withBusiness(() => {
    const c = createCustomer(input);
    refresh();
    return c.id;
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
  });
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

/* ------------------------------ Förfrågningar ------------------------------ */

export async function createRequestAction(input: {
  customerId: string;
  title: string;
  message: string;
  source: RequestSource;
}) {
  await withBusiness(() => {
    createRequest(input);
    refresh();
  });
}

/* --------------------------------- Offerter -------------------------------- */

export async function createQuoteAction(input: QuoteInput, nav?: ReturnNav): Promise<never> {
  // redirect() kastar kontrollflödesfel – adaptern committar innan den släpper
  // vidare felet, så mutationen går aldrig förlorad.
  return withBusiness((): never => {
    const quote = createQuote(input);
    refresh();
    redirect(hrefWithNav(`/ekonomi/offerter/${quote.id}`, nav));
  });
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

export async function followUpQuoteAction(quoteId: string) {
  await withBusiness(
    async () => {
      await followUpQuoteByEmail(quoteId);
      refresh();
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
    });
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

export async function sendReminderAction(invoiceId: string) {
  await withBusiness(
    async () => {
      await remindInvoiceByEmail(invoiceId);
      refresh();
    },
    { retry: false }
  );
}

export async function completeReminderAction(reminderId: string) {
  await withBusiness(
    async () => {
      completeReminder(reminderId);
      refresh();
    },
    { retry: false }
  );
}

export async function snoozeReminderAction(reminderId: string, choice: "1h" | "imorgon" | { date: string }) {
  await withBusiness(
    async () => {
      snoozeReminderBy(reminderId, choice);
      refresh();
    },
    { retry: false }
  );
}

/** Mjuk borttagning av påminnelse (status DISMISSED – historiken kvar). */
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
  await withBusiness(
    async () => {
      snoozeAttention(actionId, choice);
      refresh();
    },
    { retry: false }
  );
}

/** "Markera hanterad" på en förfrågan – domänövergång ny → besvarad. */
export async function markInquiryHandledAction(requestId: string) {
  await withBusiness(
    async () => {
      markInquiryHandled(requestId);
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
  });
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
  });
}

/* ------------------------------ Utgifter/kvitton ---------------------------- */

export async function uploadReceiptAction(expenseId: string, filename: string) {
  await withBusiness(() => {
    uploadReceiptForExpense(expenseId, filename, "uppladdning");
    refresh();
  });
}

export async function uploadStandaloneReceiptAction(filename: string) {
  await withBusiness(() => {
    uploadStandaloneReceipt(filename);
    refresh();
  });
}

export async function answerExpenseQuestionAction(expenseId: string, answer: string) {
  await withBusiness(() => {
    answerExpenseQuestion(expenseId, answer);
    refresh();
  });
}

/* ---------------------------------- Hemsida --------------------------------- */

export async function generateWebsiteAction(description: string) {
  await withBusiness(() => {
    generateWebsite(description);
    refresh();
  });
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
      return { ok: false, error: e instanceof Error ? e.message : "Kunde inte skicka förfrågan." } as const;
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
