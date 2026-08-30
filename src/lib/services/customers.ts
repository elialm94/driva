import { db, save } from "../store";
import { uid } from "../ids";
import type { Customer } from "../types";
import { logActivity } from "./activity";
import { normalizePersonnummer } from "../personnummer";
import { invoiceOutstanding, isOpenReceivable, isOverdue } from "./data";
import { CustomerValidationError, customerContactFieldErrors, personnummerFieldError, sanitizePropertyDesignations } from "../customer-validation";
import { addWorkLocation } from "./work-locations";

/**
 * Namn är det enda som krävs för att skapa en kund. E-post, telefon, adress,
 * personnummer och fastigheter är frivilliga – flöden som behöver dem
 * (skicka via e-post, fakturera, ROT/RUT) frågar efter exakt det som saknas
 * när det behövs.
 */
export function createCustomer(input: {
  kind: Customer["kind"];
  name: string;
  contactPerson?: string;
  orgNumber?: string;
  email?: string;
  phone?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  personalIdentityNumber?: string;
  propertyDesignations?: string[];
}): Customer {
  const { personalIdentityNumber, propertyDesignations, ...rest } = input;
  const fieldErrors = customerContactFieldErrors({
    name: rest.name,
    email: rest.email,
    phone: rest.phone,
    orgNumber: rest.orgNumber,
    contactPerson: rest.contactPerson,
  });
  if (fieldErrors.length) throw new CustomerValidationError(fieldErrors);

  let storedPn: string | undefined;
  if (rest.kind === "privat" && personalIdentityNumber !== undefined) {
    const pnError = personnummerFieldError(personalIdentityNumber);
    if (pnError) throw new CustomerValidationError([{ field: "personalIdentityNumber", message: pnError }]);
    const trimmed = personalIdentityNumber.trim();
    storedPn = trimmed ? normalizePersonnummer(trimmed) : undefined;
  }

  const designations = sanitizePropertyDesignations(propertyDesignations ?? []);

  const customer: Customer = {
    id: uid(),
    notes: "",
    createdAt: new Date().toISOString(),
    ...rest,
    name: rest.name.trim(),
    email: rest.email?.trim() ?? "",
    phone: rest.phone?.trim() ?? "",
    ...(storedPn ? { personalIdentityNumber: storedPn } : {}),
  };
  db().customers.push(customer);
  save();

  designations.forEach((designation, index) => {
    addWorkLocation(customer.id, {
      label: designation,
      address: "",
      propertyType: "smahus",
      propertyDesignation: designation,
      asDefault: index === 0,
    });
  });

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

/* ---------------------------- Register ----------------------------- */

export const CUSTOMER_PAGE_SIZE = 50;

export type CustomerStatusKey = "bankid" | "uppdrag" | "ingen";
export type CustomerSort = "namn" | "aktivitet" | "attBetala";
export type CustomerKindFilter = "alla" | "privat" | "foretag";
export type CustomerActivityFilter = "alla" | "uppdrag" | "ingen";
export type CustomerPaymentFilter = "alla" | "obetalt" | "forsenad";

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
  const designations = (c.workLocations ?? []).map((location) => location.propertyDesignation);
  const hay = [c.name, c.contactPerson, c.email, c.phone, c.orgNumber, c.city, ...designations]
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
