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
  deliverInvoice,
  sendInvoice,
  sendReminder,
  updateInvoice,
  type InvoiceInput,
  type InvoiceUpdateInput,
} from "@/lib/services/invoices";
import { InvoiceNotReadyError } from "@/lib/invoices/validate";
import { getInvoice } from "@/lib/services/data";
import { updateCompanySettings, type CompanySettingsInput } from "@/lib/services/settings";
import { createCustomer, createRequest, updateCustomer, updateCustomerNotes } from "@/lib/services/customers";
import {
  askQuoteQuestion,
  createQuote,
  declineQuote,
  followUpQuote,
  sendQuote,
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
  sendUserMessage,
} from "@/lib/services/assistant";
import type { Customer, RequestSource, WebsiteSectionItem } from "@/lib/types";
import { hrefWithNav, type ReturnNav } from "@/lib/nav";

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
  const c = createCustomer(input);
  refresh();
  return c.id;
}

export async function updateCustomerNotesAction(customerId: string, notes: string) {
  updateCustomerNotes(customerId, notes);
  refresh();
}

export async function updateCustomerDetailsAction(
  customerId: string,
  patch: {
    email?: string;
    phone?: string;
    address?: string;
    postalCode?: string;
    city?: string;
    orgNumber?: string;
    contactPerson?: string;
  }
) {
  updateCustomer(customerId, patch);
  refresh();
}

/* ------------------------------ Förfrågningar ------------------------------ */

export async function createRequestAction(input: {
  customerId: string;
  title: string;
  message: string;
  source: RequestSource;
}) {
  createRequest(input);
  refresh();
}

/* --------------------------------- Offerter -------------------------------- */

export async function createQuoteAction(input: QuoteInput, nav?: ReturnNav): Promise<never> {
  const quote = createQuote(input);
  refresh();
  redirect(hrefWithNav(`/pengar/offerter/${quote.id}`, nav));
}

export async function updateQuoteAction(quoteId: string, input: QuoteVersionInput) {
  updateQuote(quoteId, input);
  refresh();
}

export async function sendQuoteAction(quoteId: string) {
  sendQuote(quoteId);
  refresh();
}

export async function followUpQuoteAction(quoteId: string) {
  followUpQuote(quoteId);
  refresh();
}

export async function declineQuoteAction(quoteId: string, reason?: string) {
  declineQuote(quoteId, reason);
  refresh();
}

export async function askQuoteQuestionAction(quoteId: string, question: string) {
  askQuoteQuestion(quoteId, question);
  refresh();
}

/* ----------------------------------- Uppdrag ---------------------------------- */

export async function createJobAction(input: {
  customerId: string;
  title: string;
  description?: string;
  startDate?: string;
}): Promise<string> {
  const job = createJob(input);
  refresh();
  return job.id;
}

export async function setJobStatusAction(jobId: string, status: "kommande" | "pagar" | "klart") {
  setJobStatus(jobId, status);
  refresh();
}

export async function updateJobAction(
  jobId: string,
  input: { title?: string; description?: string; address?: string; startDate?: string; endDate?: string }
) {
  updateJob(jobId, input);
  refresh();
}

export async function updateJobNotesAction(jobId: string, notes: string) {
  updateJobNotes(jobId, notes);
  refresh();
}

export async function appendJobNoteAction(jobId: string, text: string) {
  appendJobNote(jobId, text);
  refresh();
}

/* --------------------------------- Fakturor -------------------------------- */

export async function createFinalInvoiceForJobAction(jobId: string): Promise<string> {
  const inv = createFinalInvoiceForJob(jobId);
  refresh();
  return inv.id;
}

export async function createNextInvoiceForJobAction(jobId: string): Promise<string> {
  const inv = createNextInvoiceForJob(jobId);
  refresh();
  return inv.id;
}

export async function createPartInvoiceAction(quoteId: string, partIndex: number): Promise<string> {
  const inv = createPartInvoiceForQuote(quoteId, partIndex);
  refresh();
  return inv.id;
}

export async function createInvoiceAction(input: InvoiceInput, nav?: ReturnNav): Promise<never> {
  const inv = createInvoice(input);
  refresh();
  redirect(hrefWithNav(`/pengar/fakturor/${inv.id}`, nav));
}

export async function updateInvoiceAction(
  invoiceId: string,
  input: InvoiceUpdateInput,
  nav?: ReturnNav
): Promise<never> {
  const inv = updateInvoice(invoiceId, input);
  refresh();
  redirect(hrefWithNav(`/pengar/fakturor/${inv.id}`, nav));
}

export async function sendInvoiceAction(
  invoiceId: string
): Promise<{ ok: true } | { ok: false; errors: string[]; issued?: boolean }> {
  try {
    sendInvoice(invoiceId);
    refresh();
    return { ok: true };
  } catch (e) {
    if (e instanceof InvoiceNotReadyError) {
      return { ok: false, errors: e.blockers.map((b) => b.message) };
    }
    refresh();
    const invoice = getInvoice(invoiceId);
    return {
      ok: false,
      errors: [e instanceof Error ? e.message : "Kunde inte skicka fakturan."],
      issued: Boolean(invoice && invoice.status !== "utkast"),
    };
  }
}

export async function deliverInvoiceAction(
  invoiceId: string
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  try {
    deliverInvoice(invoiceId);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : "Kunde inte skicka fakturan igen."] };
  }
}

export async function discardInvoiceAction(invoiceId: string): Promise<never> {
  discardInvoice(invoiceId);
  refresh();
  redirect("/pengar?flik=fakturor");
}

export async function sendReminderAction(invoiceId: string) {
  sendReminder(invoiceId);
  refresh();
}

export async function creditInvoiceAction(invoiceId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    creditInvoice(invoiceId);
    refresh();
    return { ok: true };
  } catch (e) {
    if (e instanceof InvoiceNotReadyError) {
      return { ok: false, error: e.blockers.map((b) => b.message).join(" ") };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Kunde inte kreditera fakturan." };
  }
}

export async function createDeniedReductionInvoiceAction(
  invoiceId: string,
  deniedAmount: number
): Promise<{ ok: true; invoiceId: string } | { ok: false; error: string }> {
  try {
    const inv = createDeniedReductionInvoice(invoiceId, deniedAmount);
    refresh();
    return { ok: true, invoiceId: inv.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Kunde inte skapa fakturautkast." };
  }
}

export async function simulatePaymentAction(invoiceId: string) {
  simulateIncomingPayment(invoiceId);
  refresh();
}

export async function paySupplierInvoiceAction(supplierInvoiceId: string) {
  paySupplierInvoice(supplierInvoiceId);
  refresh();
}

/* ------------------------------ Utgifter/kvitton ---------------------------- */

export async function uploadReceiptAction(expenseId: string, filename: string) {
  uploadReceiptForExpense(expenseId, filename, "uppladdning");
  refresh();
}

export async function uploadStandaloneReceiptAction(filename: string) {
  uploadStandaloneReceipt(filename);
  refresh();
}

export async function answerExpenseQuestionAction(expenseId: string, answer: string) {
  answerExpenseQuestion(expenseId, answer);
  refresh();
}

/* ---------------------------------- Hemsida --------------------------------- */

export async function generateWebsiteAction(description: string) {
  generateWebsite(description);
  refresh();
}

export async function updateSectionAction(
  sectionId: string,
  fields: { heading?: string; body?: string; image?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    updateSection(sectionId, fields);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara." };
  }
  refresh();
  return { ok: true };
}

/** Läser bilddata för en sektion vid behov (redigeraren) i stället för att skicka den med sidan. */
export async function getSectionImagesAction(sectionId: string) {
  try {
    return sectionImages(sectionId);
  } catch {
    return null;
  }
}

export async function addServiceItemAction(
  sectionId: string,
  item: WebsiteSectionItem,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    addServiceItem(sectionId, item);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara tjänsten." };
  }
  refresh();
  return { ok: true };
}

export async function updateServiceItemAction(
  sectionId: string,
  index: number,
  fields: { title?: string; text?: string; image?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    updateServiceItem(sectionId, index, fields);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara tjänsten." };
  }
  refresh();
  return { ok: true };
}

export async function removeServiceItemAction(sectionId: string, index: number) {
  const result = removeServiceItem(sectionId, index);
  if (!result.error) refresh();
  return result;
}

export async function reorderServiceItemsAction(sectionId: string, fromIndex: number, toIndex: number) {
  reorderServiceItems(sectionId, fromIndex, toIndex);
  refresh();
}

export async function reorderSectionsAction(orderedIds: string[]) {
  reorderSections(orderedIds);
  refresh();
}

export async function setSectionVisibleAction(sectionId: string, visible: boolean) {
  setSectionVisible(sectionId, visible);
  refresh();
}

export async function rewriteSectionAction(sectionId: string) {
  rewriteSectionHeading(sectionId);
  refresh();
}

export async function publishWebsiteAction() {
  publishWebsite();
  refresh();
}

export async function submitContactFormAction(input: {
  name: string;
  email: string;
  phone?: string;
  message: string;
}) {
  submitContactForm(input);
  refresh();
}

/* --------------------------------- Assistent -------------------------------- */

export async function sendAssistantMessageAction(text: string) {
  await sendUserMessage(text);
  refresh();
}

export async function confirmAssistantActionAction(actionId: string) {
  confirmPendingAction(actionId);
  refresh();
}

export async function cancelAssistantActionAction(actionId: string) {
  cancelPendingAction(actionId);
  refresh();
}

export async function completeAssistantCustomerAction(actionId: string, customerId: string) {
  completeCreateCustomerAndResume(actionId, customerId);
  refresh();
}

/* ------------------------------ Företagsuppgifter --------------------------- */

export async function updateCompanySettingsAction(
  input: CompanySettingsInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    updateCompanySettings(input);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Kunde inte spara." };
  }
}

/* ------------------------------------ Demo ---------------------------------- */

export async function resetDemoAction() {
  resetDemoData();
  refresh();
}
