import { db, save } from "../store";
import { uid } from "../ids";
import type { Customer, CustomerRequest, RequestSource } from "../types";
import { logActivity } from "./activity";

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
  patch: Partial<Pick<Customer, "name" | "email" | "phone" | "address" | "postalCode" | "city" | "orgNumber" | "contactPerson">>
): Customer {
  const c = db().customers.find((x) => x.id === customerId);
  if (!c) throw new Error("Kunden finns inte");
  if (patch.name !== undefined) c.name = patch.name.trim();
  if (patch.email !== undefined) c.email = patch.email.trim();
  if (patch.phone !== undefined) c.phone = patch.phone.trim();
  if (patch.address !== undefined) c.address = patch.address.trim() || undefined;
  if (patch.postalCode !== undefined) c.postalCode = patch.postalCode.trim() || undefined;
  if (patch.city !== undefined) c.city = patch.city.trim() || undefined;
  if (patch.orgNumber !== undefined) c.orgNumber = patch.orgNumber.trim() || undefined;
  if (patch.contactPerson !== undefined) c.contactPerson = patch.contactPerson.trim() || undefined;
  save();
  return c;
}

export function findOrCreateCustomerByEmail(input: {
  name: string;
  email: string;
  phone?: string;
}): { customer: Customer; created: boolean } {
  const data = db();
  const existing = data.customers.find((c) => c.email.toLowerCase() === input.email.toLowerCase());
  if (existing) return { customer: existing, created: false };
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
