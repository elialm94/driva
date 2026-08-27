"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resetDemoData } from "@/lib/store";
import { createCustomer, createRequest, markRequestHandled, updateCustomerNotes } from "@/lib/services/customers";
import {
  createQuote,
  updateQuote,
  sendQuote,
  declineQuote,
  followUpQuote,
  askQuoteQuestion,
  type QuoteInput,
  type QuoteVersionInput,
} from "@/lib/services/quotes";
import {
  addChecklistItem,
  createJob,
  setJobStatus,
  toggleChecklistItem,
  updateJobNotes,
} from "@/lib/services/jobs";
import {
  createFinalInvoiceForJob,
  createInvoice,
  createPartInvoiceForQuote,
  creditInvoice,
  sendInvoice,
  sendReminder,
  updateInvoice,
  type InvoiceInput,
  type InvoiceUpdateInput,
} from "@/lib/services/invoices";
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
  setSectionItems,
  setSectionVisible,
  submitContactForm,
  updateSection,
  updateServiceItem,
} from "@/lib/services/website";
import {
  cancelPendingAction,
  confirmPendingAction,
  sendUserMessage,
} from "@/lib/services/assistant";
import type { Customer, RequestSource, WebsiteSectionItem } from "@/lib/types";

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

export async function markRequestHandledAction(requestId: string, status: "besvarad" | "avslutad") {
  markRequestHandled(requestId, status);
  refresh();
}

/* --------------------------------- Offerter -------------------------------- */

export async function createQuoteAction(input: QuoteInput): Promise<never> {
  const quote = createQuote(input);
  refresh();
  redirect(`/pengar/offerter/${quote.id}`);
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

export async function toggleChecklistAction(jobId: string, itemId: string) {
  toggleChecklistItem(jobId, itemId);
  refresh();
}

export async function addChecklistItemAction(jobId: string, text: string) {
  addChecklistItem(jobId, text);
  refresh();
}

export async function updateJobNotesAction(jobId: string, notes: string) {
  updateJobNotes(jobId, notes);
  refresh();
}

/* --------------------------------- Fakturor -------------------------------- */

export async function createFinalInvoiceForJobAction(jobId: string): Promise<string> {
  const inv = createFinalInvoiceForJob(jobId);
  refresh();
  return inv.id;
}

export async function createPartInvoiceAction(quoteId: string, partIndex: number): Promise<string> {
  const inv = createPartInvoiceForQuote(quoteId, partIndex);
  refresh();
  return inv.id;
}

export async function createInvoiceAction(input: InvoiceInput): Promise<never> {
  const inv = createInvoice(input);
  refresh();
  redirect(`/pengar/fakturor/${inv.id}`);
}

export async function updateInvoiceAction(invoiceId: string, input: InvoiceUpdateInput): Promise<never> {
  const inv = updateInvoice(invoiceId, input);
  refresh();
  redirect(`/pengar/fakturor/${inv.id}`);
}

export async function sendInvoiceAction(invoiceId: string) {
  sendInvoice(invoiceId);
  refresh();
}

export async function sendReminderAction(invoiceId: string) {
  sendReminder(invoiceId);
  refresh();
}

export async function creditInvoiceAction(invoiceId: string) {
  creditInvoice(invoiceId);
  refresh();
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
) {
  updateSection(sectionId, fields);
  refresh();
}

export async function setSectionItemsAction(sectionId: string, items: WebsiteSectionItem[]) {
  setSectionItems(sectionId, items);
  refresh();
}

export async function addServiceItemAction(sectionId: string, item: WebsiteSectionItem) {
  addServiceItem(sectionId, item);
  refresh();
}

export async function updateServiceItemAction(
  sectionId: string,
  index: number,
  fields: { title?: string; text?: string; image?: string | null },
) {
  updateServiceItem(sectionId, index, fields);
  refresh();
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
  sendUserMessage(text);
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

/* ------------------------------------ Demo ---------------------------------- */

export async function resetDemoAction() {
  resetDemoData();
  refresh();
}
