import { db, save } from "../store";
import { uid } from "../ids";
import { CONFIDENCE_THRESHOLDS, decideFromConfidence } from "../autopilot";
import {
  inboundMailAddress,
  inboundSlugFromTo,
  type InboundMailPayload,
} from "../inbox/inbound-mail";
import type { InboxAttachment, InboxItem, InboxItemStatus } from "../types";
import { createExpenseFromKnownReceipt } from "./expenses";
import { listInquiriesInbox, countOpenInquiries, getInquiryView, type InquiryInboxRow, type PagedResult } from "./customers";

export type { PagedResult };

export const INBOX_PAGE_SIZE = 20;

export type InboxListFilter = "oppna" | "alla";
export type InboxRowKind = "inquiry" | "mail";

export interface InboxListRow {
  id: string;
  kind: InboxRowKind;
  title: string;
  summary: string;
  fromLabel: string;
  createdAt: string;
  status: "ny" | "hanterad";
}

export function inboxItems(): InboxItem[] {
  return db().inboxItems ?? [];
}

export function inboundAddressForBusiness(): string {
  const slug = db().settings.inboundMailSlug || "demo";
  return inboundMailAddress(slug);
}

export function countOpenInboxMail(): number {
  let n = 0;
  for (const item of inboxItems()) if (item.status === "ny") n += 1;
  return n;
}

export function countOpenInbox(): number {
  return countOpenInquiries() + countOpenInboxMail();
}

function mailMatchesQuery(item: InboxItem, q: string): boolean {
  if (!q) return true;
  const hay = [item.fromAddress, item.toAddress, item.subject, item.textBody, item.parsedSupplier]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function toMailRow(item: InboxItem): InboxListRow {
  return {
    id: item.id,
    kind: "mail",
    title: item.subject || "(utan ämne)",
    summary: item.textBody.replace(/\s+/g, " ").trim().slice(0, 90),
    fromLabel: item.fromAddress,
    createdAt: item.createdAt,
    status: item.status === "ny" ? "ny" : "hanterad",
  };
}

function toInquiryRow(r: InquiryInboxRow): InboxListRow {
  return {
    id: r.id,
    kind: "inquiry",
    title: r.title,
    summary: r.summary,
    fromLabel: r.customerName,
    createdAt: r.createdAt,
    status: r.status,
  };
}

export function listInbox(input: {
  q?: string;
  filter?: InboxListFilter;
  page?: number;
  pageSize?: number;
} = {}): PagedResult<InboxListRow> {
  const q = (input.q ?? "").trim().toLowerCase();
  const filter = input.filter ?? "oppna";
  const pageSize = input.pageSize ?? INBOX_PAGE_SIZE;
  const page = Math.max(1, input.page ?? 1);

  const inquiries = listInquiriesInbox({
    q: input.q,
    filter: filter === "alla" ? "alla" : "oppna",
    page: 1,
    pageSize: 500,
  }).rows.map(toInquiryRow);

  const mail: InboxListRow[] = [];
  for (const item of inboxItems()) {
    if (filter === "oppna" && item.status !== "ny") continue;
    if (!mailMatchesQuery(item, q)) continue;
    mail.push(toMailRow(item));
  }

  const rows = [...inquiries, ...mail].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title, "sv")
  );
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

export function getInboxMail(id: string): InboxItem | undefined {
  return inboxItems().find((item) => item.id === id);
}

export function getInboxView(id: string):
  | { kind: "inquiry"; view: NonNullable<ReturnType<typeof getInquiryView>> }
  | { kind: "mail"; item: InboxItem }
  | undefined {
  const inquiry = getInquiryView(id);
  if (inquiry) return { kind: "inquiry", view: inquiry };
  const item = getInboxMail(id);
  if (item) return { kind: "mail", item };
  return undefined;
}

export function inboundSlugMatches(to: string): boolean {
  const slug = inboundSlugFromTo(to);
  const expected = db().settings.inboundMailSlug;
  return Boolean(slug && expected && slug === expected);
}

export type IngestResult =
  | { ok: true; item: InboxItem; created: boolean; autoBooked: boolean }
  | { ok: false; error: string; status: number };

/**
 * Idempotent ingest. Andra post med samma external_id är no-op.
 * Autopilot bokar bara vid konfidens ≥ AUTO och kända belopp – aldrig gissade.
 */
export function ingestInboundMail(payload: InboundMailPayload): IngestResult {
  if (!inboundSlugMatches(payload.to)) {
    return { ok: false, error: "Okänd inkommande adress", status: 404 };
  }

  const data = db();
  const items = data.inboxItems ?? (data.inboxItems = []);
  const existing = payload.externalId
    ? items.find((i) => i.externalId === payload.externalId)
    : undefined;
  if (existing) {
    return { ok: true, item: existing, created: false, autoBooked: false };
  }

  const parsed = payload.parsed;
  const attachments: InboxAttachment[] = (payload.attachments ?? []).map((a) => ({
    id: uid(),
    filename: a.filename,
    contentType: a.contentType,
    size: a.size ?? 0,
    storageKey: `inbox/${payload.externalId}/${a.filename}`,
  }));

  const item: InboxItem = {
    id: `inbox-${uid()}`,
    kind: "mail",
    status: "ny",
    externalId: payload.externalId,
    fromAddress: payload.from,
    toAddress: payload.to,
    subject: payload.subject,
    textBody: payload.text,
    ...(payload.html ? { htmlBody: payload.html } : {}),
    attachments,
    createdAt: new Date().toISOString(),
  };

  if (parsed) {
    if (typeof parsed.amount === "number" && Number.isInteger(parsed.amount) && parsed.amount >= 1) {
      item.parsedAmount = parsed.amount;
    }
    if (typeof parsed.vatAmount === "number" && Number.isInteger(parsed.vatAmount) && parsed.vatAmount >= 0) {
      item.parsedVatAmount = parsed.vatAmount;
    }
    if (parsed.supplier?.trim()) item.parsedSupplier = parsed.supplier.trim();
    if (parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) item.parsedDate = parsed.date;
    if (typeof parsed.confidence === "number") item.confidence = parsed.confidence;
  }

  items.push(item);

  let autoBooked = false;
  const conf = item.confidence ?? 0;
  if (
    decideFromConfidence(conf) === "AUTO_EXECUTE" &&
    item.parsedAmount != null &&
    item.parsedVatAmount != null &&
    item.parsedSupplier
  ) {
    const { expense, autoBooked: booked } = createExpenseFromKnownReceipt({
      supplier: item.parsedSupplier,
      amount: item.parsedAmount,
      vatAmount: item.parsedVatAmount,
      date: item.parsedDate ?? item.createdAt.slice(0, 10),
      description: item.subject,
      filename: attachments[0]?.filename,
      source: "email",
    });
    item.expenseId = expense.id;
    autoBooked = booked;
    if (booked) {
      item.status = "bokford";
      item.processedAt = new Date().toISOString();
    }
  }

  save();
  return { ok: true, item, created: true, autoBooked };
}

export function markInboxMailProcessed(id: string): InboxItem {
  const item = getInboxMail(id);
  if (!item) throw new Error("Posten finns inte i inboxen.");
  if (item.status === "ny") {
    item.status = "behandlad";
    item.processedAt = new Date().toISOString();
    save();
  }
  return item;
}

export function createExpenseFromInboxItem(id: string): { expenseId: string; autoBooked: boolean } {
  const item = getInboxMail(id);
  if (!item) throw new Error("Posten finns inte i inboxen.");
  if (item.expenseId) return { expenseId: item.expenseId, autoBooked: false };
  if (item.parsedAmount == null || item.parsedVatAmount == null || !item.parsedSupplier) {
    throw new Error("Belopp eller leverantör saknas – Driva gissar inte belopp.");
  }
  const { expense, autoBooked } = createExpenseFromKnownReceipt({
    supplier: item.parsedSupplier,
    amount: item.parsedAmount,
    vatAmount: item.parsedVatAmount,
    date: item.parsedDate ?? item.createdAt.slice(0, 10),
    description: item.subject,
    filename: item.attachments[0]?.filename,
    source: "email",
  });
  item.expenseId = expense.id;
  item.status = autoBooked ? "bokford" : "behandlad";
  item.processedAt = new Date().toISOString();
  save();
  return { expenseId: expense.id, autoBooked };
}

export function attachInboxItemToExpense(id: string, expenseId: string): InboxItem {
  const item = getInboxMail(id);
  if (!item) throw new Error("Posten finns inte i inboxen.");
  const expense = db().expenses.find((e) => e.id === expenseId);
  if (!expense) throw new Error("Utgiften finns inte.");
  item.expenseId = expenseId;
  if (item.status === "ny") {
    item.status = "behandlad";
    item.processedAt = new Date().toISOString();
  }
  save();
  return item;
}

export { CONFIDENCE_THRESHOLDS };
export type { InboxItemStatus };
