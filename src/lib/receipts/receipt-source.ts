import { db } from "../store";
import type { InboxAttachment, Receipt } from "../types";
import { attachmentIsViewable } from "../inbox/attachment-content";
import { receiptFileStored } from "./receipt-meta";

/**
 * Kvitton som bokförts från inboxen (mejl eller uppladdning) skapades länge
 * med bara filnamnet – själva filen låg kvar på inboxposten och Utgifter
 * visade "kvittouppgifter utan fil" fastän dokumentet fanns.
 *
 * Inboxposter tas aldrig bort (invariant i inbox-servicen), så bilagan är en
 * stabil källa: här slås den upp via kopplingen inboxpost → utgift → kvitto.
 * Små filer kopieras dessutom inline till kvittoraden vid bokföringen
 * (createExpenseFromKnownReceipt); den här vägen täcker bucket-lagrade och
 * demogenererade dokument utan att kvittotabellen behöver en ny kolumn.
 */
export function inboxAttachmentForReceipt(receipt: Pick<Receipt, "expenseId">): InboxAttachment | undefined {
  if (!receipt.expenseId) return undefined;
  const item = (db().inboxItems ?? []).find((i) => i.expenseId === receipt.expenseId);
  const attachment = item?.attachments[0];
  return attachment && attachmentIsViewable(attachment) ? attachment : undefined;
}

/** Går kvittots fil att visa – på raden eller via inboxbilagan den kom från? */
export function receiptFileAvailable(receipt: Pick<Receipt, "expenseId" | "storagePath" | "contentBase64">): boolean {
  return receiptFileStored(receipt) || inboxAttachmentForReceipt(receipt) != null;
}

/**
 * Samma fråga för en hel lista: ett svep över inboxen i stället för ett per
 * kvitto, så registret inte växer kvadratiskt med åren.
 */
export function receiptsWithAvailableFile(receipts: readonly Receipt[]): Map<string, Receipt> {
  const expensesWithInboxFile = new Set<string>();
  for (const item of db().inboxItems ?? []) {
    const attachment = item.attachments[0];
    if (item.expenseId && attachment && attachmentIsViewable(attachment)) expensesWithInboxFile.add(item.expenseId);
  }
  const result = new Map<string, Receipt>();
  for (const r of receipts) {
    if (receiptFileStored(r) || (r.expenseId && expensesWithInboxFile.has(r.expenseId))) result.set(r.id, r);
  }
  return result;
}
