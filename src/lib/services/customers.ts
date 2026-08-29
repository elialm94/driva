import { db, save } from "../store";
import { uid } from "../ids";
import type { Customer, CustomerRequest, RequestSource } from "../types";
import { logActivity } from "./activity";
import { normalizePersonnummer } from "../personnummer";
import { invoiceOutstanding, isOpenReceivable, isOverdue } from "./data";
import { CustomerValidationError, customerContactFieldErrors, personnummerFieldError } from "../customer-validation";

export function createCustomer(input: {
  kind: Customer["kind"];
  name: string;
  contactPerson?: string;
  orgNumber?: string;
  email: string;
  phone: string;
  address?: string;
  postalCode?: string;
  city?: string;
}): Customer {
  const customer: Customer = {
    id: uid(),
    notes: "",
    createdAt: new Date().toISOString(),
    ...input,
  };
  db().customers.push(customer);
  save();
  return customer;
}

export function updateCustomerNotes(customerId: string, notes: string): void {
  const c = db().customers.find((c) => c.id === customerId);
  if (!c) return;
  c.notes = notes;
  save();
}

export function updateCustomer(
  customerId: string,
  patch: Partial<Pick<Customer, "name" | "email" | "phone" | "address" | "postalCode" | "city" | "orgNumber" | "contactPerson" | "personalIdentityNumber" | "notes">>
): Customer {
  const c = db().customers.find((x) => x.id === customerId);
  if (!c) throw new Error("Kunden finns inte");
  const fieldErrors = customerContactFieldErrors(patch);
  if (fieldErrors.length) throw new CustomerValidationError(fieldErrors);
  if (patch.name !== undefined) c.name = patch.name.trim();
  if (patch.email !== undefined) c.email = patch.email.trim();
  if (patch.phone !== undefined) c.phone = patch.phone.trim();
  if (patch.address !== undefined) c.address = patch.address.trim() || undefined;
  if (patch.postalCode !== undefined) c.postalCode = patch.postalCode.trim() || undefined;
  if (patch.city !== undefined) c.city = patch.city.trim() || undefined;
  if (patch.orgNumber !== undefined) c.orgNumber = patch.orgNumber.trim() || undefined;
  if (patch.contactPerson !== undefined) c.contactPerson = patch.contactPerson.trim() || undefined;
  if (patch.notes !== undefined) c.notes = patch.notes;
  if (patch.personalIdentityNumber !== undefined) {
    const pnError = personnummerFieldError(patch.personalIdentityNumber);
    if (pnError) throw new CustomerValidationError([{ field: "personalIdentityNumber", message: pnError }]);
    const trimmed = patch.personalIdentityNumber.trim();
    c.personalIdentityNumber = trimmed ? normalizePersonnummer(trimmed) : undefined;
  }
  save();
  return c;
}

export function findOrCreateCustomerByEmail(input: {
  name: string;
  email: string;
  phone?: string;
}): { customer: Customer; created: boolean } {
  const data = db();
  const existing = data.customers.find((c) => c.email.toLowerCase() === input.email.trim().toLowerCase());
  if (existing) {
    const phone = input.phone?.trim();
    if (phone && !existing.phone.trim()) {
      existing.phone = phone;
      save();
    }
    return { customer: existing, created: false };
  }
  const customer = createCustomer({
    kind: "privat",
    name: input.name,
    email: input.email,
    phone: input.phone ?? "",
  });
  return { customer, created: true };
}

/** Hitta kund på (del av) namn – används av assistenten. */
export function findCustomersByName(name: string): Customer[] {
  const n = name.trim().toLowerCase();
  if (!n) return [];
  return db().customers.filter((c) => {
    const full = c.name.toLowerCase();
    return full.includes(n) || full.split(/\s+/).some((part) => part.startsWith(n));
  });
}

/** Enkel "AI-tolkning" av en förfrågningstext (regelbaserad i demon). */
export function interpretRequest(message: string): CustomerRequest["ai"] {
  const ai: NonNullable<CustomerRequest["ai"]> = {};
  const m = message.toLowerCase();
  if (/(kök|luckor|bänkskiva)/.test(m)) ai.workType = "Köksrenovering";
  else if (/garderob/.test(m)) ai.workType = "Platsbyggd garderob";
  else if (/(altan|trall|uteplats)/.test(m)) ai.workType = "Altan/uteplats";
  else if (/(bokhylla|hylla|platsbygg)/.test(m)) ai.workType = "Platsbyggd möbel";
  else if (/(fönster)/.test(m)) ai.workType = "Fönsterarbete";
  const monthMatch = m.match(
    /(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)/
  );
  if (monthMatch) ai.desiredStart = monthMatch[1].charAt(0).toUpperCase() + monthMatch[1].slice(1);
  const budgetMatch = m.match(/(\d[\d\s]{2,})\s*(?:kr|:-|kronor)/);
  if (budgetMatch) ai.budget = `${budgetMatch[1].trim()} kr`;
  return Object.keys(ai).length ? ai : undefined;
}

export function createRequest(input: {
  customerId: string;
  title: string;
  message: string;
  source: RequestSource;
  idempotencyKey?: string;
}): CustomerRequest {
  const data = db();
  const customer = data.customers.find((c) => c.id === input.customerId);
  const request: CustomerRequest = {
    id: uid(),
    customerId: input.customerId,
    title: input.title,
    message: input.message,
    source: input.source,
    status: "ny",
    createdAt: new Date().toISOString(),
    ai: interpretRequest(`${input.title}. ${input.message}`),
  };
  if (input.idempotencyKey) request.idempotencyKey = input.idempotencyKey;
  data.requests.push(request);
  const sourceText: Record<RequestSource, string> = {
    hemsida: "via hemsidan",
    email: "via e-post",
    telefon: "via telefon",
    manuell: "",
    assistent: "via assistenten",
  };
  logActivity(
    `Ny förfrågan ${sourceText[input.source]} från ${customer?.name ?? "okänd"}: ${input.title}.`.replace("  ", " "),
    { customerId: input.customerId, entity: { type: "forfragan", id: request.id } }
  );
  save();
  return request;
}

/* ---------------------------- Register / inbox ----------------------------- */

export const CUSTOMER_PAGE_SIZE = 50;

export type CustomerStatusKey = "bankid" | "uppdrag" | "forfragan" | "ingen";
export type CustomerSort = "namn" | "aktivitet" | "attBetala";
export type CustomerKindFilter = "alla" | "privat" | "foretag";
export type CustomerActivityFilter = "alla" | "uppdrag" | "ingen";
export type CustomerPaymentFilter = "alla" | "obetalt" | "forsenad";
export type InquiryInboxFilter = "oppna" | "alla";

export interface CustomerTableRow {
  id: string;
  name: string;
  kind: Customer["kind"];
  contactPerson?: string;
  email: string;
  phone: string;
  orgNumber?: string;
  statusKey: CustomerStatusKey;
  statusLabel: string;
  activeJobs: number;
  outstanding: number;
  overdue: boolean;
  lastActivityAt: string;
}

export interface InquiryInboxRow {
  id: string;
  customerId: string;
  customerName: string;
  customerKind: Customer["kind"];
  contactPerson?: string;
  email: string;
  phone: string;
  title: string;
  summary: string;
  createdAt: string;
  status: "ny" | "hanterad";
  source: RequestSource;
  quoteId?: string;
}

export interface PagedResult<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface CustomerStats {
  waitingQuotes: number;
  activeJobs: number;
  newRequests: number;
  outstanding: number;
  overdue: boolean;
  lastActivityAt: string;
}

function bumpActivity(stats: CustomerStats, at?: string) {
  if (at && at > stats.lastActivityAt) stats.lastActivityAt = at;
}

/** En genomläsning av lagret – inga fulla kundgrafer, ingen N+1. */
function customerStatsById(): Map<string, CustomerStats> {
  const data = db();
  const stats = new Map<string, CustomerStats>();

  for (const c of data.customers) {
    stats.set(c.id, {
      waitingQuotes: 0,
      activeJobs: 0,
      newRequests: 0,
      outstanding: 0,
      overdue: false,
      lastActivityAt: c.createdAt,
    });
  }

  for (const q of data.quotes) {
    const s = stats.get(q.customerId);
    if (!s) continue;
    if (q.status === "skickad") s.waitingQuotes += 1;
    bumpActivity(s, q.createdAt);
    bumpActivity(s, q.sentAt);
    bumpActivity(s, q.decidedAt);
  }

  for (const j of data.jobs) {
    const s = stats.get(j.customerId);
    if (!s) continue;
    if (j.status !== "klart") s.activeJobs += 1;
    bumpActivity(s, j.createdAt);
    bumpActivity(s, j.startDate);
    bumpActivity(s, j.completedAt);
  }

  for (const inv of data.invoices) {
    const s = stats.get(inv.customerId);
    if (!s) continue;
    bumpActivity(s, inv.createdAt);
    bumpActivity(s, inv.issueDate);
    bumpActivity(s, inv.paidAt);
    if (!isOpenReceivable(inv)) continue;
    s.outstanding += invoiceOutstanding(inv);
    if (isOverdue(inv)) s.overdue = true;
  }

  for (const r of data.requests) {
    const s = stats.get(r.customerId);
    if (!s) continue;
    if (r.status === "ny") s.newRequests += 1;
    bumpActivity(s, r.createdAt);
  }

  for (const a of data.activity) {
    if (!a.customerId) continue;
    const s = stats.get(a.customerId);
    if (s) bumpActivity(s, a.at);
  }

  return stats;
}

function customerStatus(s: CustomerStats): { key: CustomerStatusKey; label: string } {
  if (s.waitingQuotes > 0) return { key: "bankid", label: "Väntar på BankID" };
  if (s.activeJobs > 0) return { key: "uppdrag", label: "Aktivt uppdrag" };
  if (s.newRequests > 0) return { key: "forfragan", label: "Ny förfrågan" };
  return { key: "ingen", label: "—" };
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function customerMatchesQuery(c: Customer, q: string): boolean {
  if (!q) return true;
  const hay = [c.name, c.contactPerson, c.email, c.phone, c.orgNumber, c.city]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (hay.includes(q)) return true;
  const qDigits = phoneDigits(q);
  return qDigits.length >= 3 && phoneDigits(c.phone).includes(qDigits);
}

function toTableRow(c: Customer, s: CustomerStats): CustomerTableRow {
  const status = customerStatus(s);
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    contactPerson: c.contactPerson,
    email: c.email,
    phone: c.phone,
    orgNumber: c.orgNumber,
    statusKey: status.key,
    statusLabel: status.label,
    activeJobs: s.activeJobs,
    outstanding: s.outstanding,
    overdue: s.overdue,
    lastActivityAt: s.lastActivityAt,
  };
}

function paginate<T>(items: T[], page: number, pageSize: number): PagedResult<T> {
  const size = Math.max(1, pageSize);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * size;
  return {
    rows: items.slice(start, start + size),
    page: current,
    pageSize: size,
    total,
    totalPages: total === 0 ? 1 : totalPages,
  };
}

export function listCustomersForTable(input: {
  q?: string;
  kind?: CustomerKindFilter;
  activity?: CustomerActivityFilter;
  payment?: CustomerPaymentFilter;
  sort?: CustomerSort;
  page?: number;
  pageSize?: number;
} = {}): PagedResult<CustomerTableRow> {
  const data = db();
  const stats = customerStatsById();
  const q = normalizeSearch(input.q ?? "");
  const kind = input.kind ?? "alla";
  const activity = input.activity ?? "alla";
  const payment = input.payment ?? "alla";
  const sort = input.sort ?? "aktivitet";

  const rows: CustomerTableRow[] = [];
  for (const c of data.customers) {
    if (kind !== "alla" && c.kind !== kind) continue;
    if (!customerMatchesQuery(c, q)) continue;
    const s = stats.get(c.id)!;
    if (activity === "uppdrag" && s.activeJobs === 0) continue;
    if (activity === "ingen" && s.activeJobs > 0) continue;
    if (payment === "obetalt" && s.outstanding <= 0) continue;
    if (payment === "forsenad" && !s.overdue) continue;
    rows.push(toTableRow(c, s));
  }

  rows.sort((a, b) => {
    if (sort === "namn") return a.name.localeCompare(b.name, "sv");
    if (sort === "attBetala") return b.outstanding - a.outstanding || a.name.localeCompare(b.name, "sv");
    return b.lastActivityAt.localeCompare(a.lastActivityAt) || a.name.localeCompare(b.name, "sv");
  });

  return paginate(rows, input.page ?? 1, input.pageSize ?? CUSTOMER_PAGE_SIZE);
}

export function inquiryDisplayStatus(status: CustomerRequest["status"]): "ny" | "hanterad" {
  return status === "ny" ? "ny" : "hanterad";
}

function inquirySummary(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 90 ? `${compact.slice(0, 87)}…` : compact;
}

function inquiryMatchesQuery(
  request: CustomerRequest,
  customer: Customer | undefined,
  q: string
): boolean {
  if (!q) return true;
  const hay = [customer?.name, customer?.contactPerson, customer?.email, customer?.phone, customer?.orgNumber, request.title, request.message]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (hay.includes(q)) return true;
  const qDigits = phoneDigits(q);
  return Boolean(customer && qDigits.length >= 3 && phoneDigits(customer.phone).includes(qDigits));
}

function toInboxRow(request: CustomerRequest, customer: Customer | undefined): InquiryInboxRow {
  return {
    id: request.id,
    customerId: request.customerId,
    customerName: customer?.name ?? "Okänd kund",
    customerKind: customer?.kind ?? "privat",
    contactPerson: customer?.contactPerson,
    email: customer?.email ?? "",
    phone: customer?.phone ?? "",
    title: request.title,
    summary: inquirySummary(request.message),
    createdAt: request.createdAt,
    status: inquiryDisplayStatus(request.status),
    source: request.source,
    quoteId: request.quoteId,
  };
}

export function listInquiriesInbox(input: {
  q?: string;
  filter?: InquiryInboxFilter;
  page?: number;
  pageSize?: number;
} = {}): PagedResult<InquiryInboxRow> {
  const data = db();
  const customers = new Map(data.customers.map((c) => [c.id, c]));
  const q = normalizeSearch(input.q ?? "");
  const filter = input.filter ?? "oppna";

  const matched: InquiryInboxRow[] = [];
  for (const r of data.requests) {
    if (filter === "oppna" && r.status !== "ny") continue;
    const customer = customers.get(r.customerId);
    if (!inquiryMatchesQuery(r, customer, q)) continue;
    matched.push(toInboxRow(r, customer));
  }

  matched.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.customerName.localeCompare(b.customerName, "sv"));
  return paginate(matched, input.page ?? 1, input.pageSize ?? CUSTOMER_PAGE_SIZE);
}

export function countOpenInquiries(): number {
  let n = 0;
  for (const r of db().requests) if (r.status === "ny") n += 1;
  return n;
}

export function getInquiryView(id: string): { request: CustomerRequest; customer: Customer } | undefined {
  const request = db().requests.find((r) => r.id === id);
  if (!request) return undefined;
  const customer = db().customers.find((c) => c.id === request.customerId);
  if (!customer) return undefined;
  return { request, customer };
}

/**
 * "Markera hanterad": riktig domänövergång (ny → besvarad) – t.ex. när
 * företagaren redan pratat med kunden och ingen offert ska skapas.
 * Förfrågan lämnar "Behöver din uppmärksamhet" men ligger kvar i
 * inboxen/kundhistoriken som hanterad. Idempotent för redan hanterade.
 */
export function markInquiryHandled(requestId: string): CustomerRequest {
  const request = db().requests.find((r) => r.id === requestId);
  if (!request) throw new Error("Förfrågan finns inte.");
  if (request.status !== "ny") return request;
  request.status = "besvarad";
  logActivity(`Förfrågan ”${request.title}” markerades som hanterad.`, {
    customerId: request.customerId,
    entity: { type: "forfragan", id: request.id },
  });
  save();
  return request;
}

/** Hitta öppen förfrågan att koppla till en offert – samma objekt som inboxen. */
export function findMatchingOpenInquiry(customerId: string, hint?: string): CustomerRequest | undefined {
  const open = db().requests.filter((r) => r.customerId === customerId && r.status === "ny");
  if (open.length === 0) return undefined;
  if (open.length === 1) return open[0];
  const q = normalizeSearch(hint ?? "");
  if (!q) return undefined;
  const tokens = q.split(/\s+/).filter((t) => t.length >= 3);
  const scored = open
    .map((r) => {
      const hay = `${r.title} ${r.message} ${r.ai?.workType ?? ""}`.toLowerCase();
      const hits = tokens.filter((t) => hay.includes(t)).length;
      const titleHit = hay.includes(q) ? 2 : 0;
      return { r, score: hits + titleHit };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.r.createdAt.localeCompare(a.r.createdAt));
  if (scored.length === 0) return undefined;
  if (scored.length > 1 && scored[0].score === scored[1].score) return undefined;
  return scored[0].r;
}
