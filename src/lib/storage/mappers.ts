/**
 * Mappning domänobjekt ↔ Postgres-rader.
 *
 * Principer:
 *   * Exakt rundresa: det som laddas ska vara byte-identiskt (JSON-mässigt)
 *     med det som sparades. Valfria fält som är null i databasen UTELÄMNAS
 *     i domänobjektet (inte `undefined`-sätts) så att JSON.stringify-ytor –
 *     framför allt hash-frysta offertversioner – aldrig glider.
 *   * Tidsstämplar: domänen använder `new Date().toISOString()` (ms-precision).
 *     Drivrutinerna (postgres.js/PGlite) returnerar Date för timestamptz –
 *     tsIso() ger tillbaka exakt ISO-form. Datumfält (YYYY-MM-DD) läses med
 *     dateOnly(). Fält med blandade strängformat är TEXT-kolumner (verbatim).
 *   * Belopp: hela kronor (bigint i DB, number i domänen). num() tål att
 *     drivrutinen ger string | number | bigint.
 */
import type {
  ActivityEvent,
  AssistantAuditEntry,
  AssistantMessage,
  AuditEvent,
  Asset,
  Accrual,
  AnnualReport,
  AttentionState,
  ClientInformationRequest,
  CollaborationInvitation,
  InboxItem,
  BankAccount,
  BankConnection,
  BankIDEnvironment,
  BankIDOrder,
  BankTransaction,
  CompanySettings,
  Customer,
  DB,
  DocLine,
  Domain,
  DomainAuditEvent,
  Expense,
  FiscalYear,
  Invoice,
  Job,
  JobWorkEntry,
  Payment,
  PaymentFile,
  PendingAssistantAction,
  Reminder,
  Quote,
  QuoteAcceptance,
  QuoteVersion,
  Receipt,
  SupplierInvoice,
  SupplierPayment,
  VatReport,
  Verification,
  VerificationEntry,
  Website,
  WorkLocation,
} from "@/lib/types";
import { syncDocLineClassification } from "@/lib/economic-line-type";
import { migrateQuoteVersionDescription } from "@/lib/quote-description";
import { withoutRetiredSections } from "@/lib/website-sections";
import type { SqlRow } from "./executor";

/* ------------------------------- primitiver ------------------------------- */

export function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v !== "") return Number(v);
  return 0;
}

function numOrU(v: unknown): number | undefined {
  return v == null ? undefined : num(v);
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function strOrU(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}

/** timestamptz → domänens ISO-form (ms-precision, "Z"). */
export function tsIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") {
    // Defensivt: text från t.ex. ::text-cast ("2026-08-28 12:58:11.123+00").
    const normalized = v.includes("T") ? v : v.replace(" ", "T");
    const withTz = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(normalized) ? normalized : `${normalized}Z`;
    const d = new Date(withTz.replace(/([+-]\d{2})$/, "$1:00"));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  throw new Error(`Kan inte tolka tidsstämpel: ${String(v)}`);
}

function tsIsoOrU(v: unknown): string | undefined {
  return v == null ? undefined : tsIso(v);
}

/** date-kolumn eller datumsemantisk timestamptz → "YYYY-MM-DD". */
export function dateOnly(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && v.length >= 10) return v.slice(0, 10);
  throw new Error(`Kan inte tolka datum: ${String(v)}`);
}

function dateOnlyOrU(v: unknown): string | undefined {
  return v == null ? undefined : dateOnly(v);
}

/** jsonb-kolumn – drivrutinerna returnerar redan tolkade värden. */
function jsonVal<T>(v: unknown): T {
  if (typeof v === "string") return JSON.parse(v) as T;
  return v as T;
}

function jsonOrU<T>(v: unknown): T | undefined {
  return v == null ? undefined : jsonVal<T>(v);
}

/** Parametervärde för jsonb-kolumner (skickas som text, kolumnen kastar). */
export function jsonParam(v: unknown): string | null {
  return v === undefined || v === null ? (v === null ? "null" : null) : JSON.stringify(v);
}

/** jsonb-param där null i domänen ska bli SQL NULL (inte jsonb-null). */
function jsonParamOrNull(v: unknown): string | null {
  return v == null ? null : JSON.stringify(v);
}

/** Lägg till nyckel endast om värdet finns – bevarar JSON-ytan exakt. */
function opt<K extends string, V>(key: K, v: V | null | undefined): { [P in K]?: V } {
  return v == null ? {} : ({ [key]: v } as { [P in K]?: V });
}

export interface TableSpec<T> {
  table: string;
  /** Primärnyckelkolumner (för on conflict). */
  pk: string[];
  /** Kolumner som skrivs av appen. */
  columns: string[];
  /** Kolumner som ALDRIG skrivs över vid upsert (DB-ägd metadata). */
  protectedColumns?: string[];
  toRow(entity: T, businessId: string): Record<string, unknown>;
  fromRow(row: SqlRow): T;
}

/* -------------------------------- customers ------------------------------- */

export const customersSpec: TableSpec<Customer> = {
  table: "customers",
  pk: ["id"],
  columns: [
    "id", "business_id", "kind", "name", "contact_person", "org_number", "email", "phone",
    "address", "postal_code", "city", "personal_identity_number", "default_work_location_id",
    "notes", "created_at",
  ],
  toRow: (c, businessId) => ({
    id: c.id,
    business_id: businessId,
    kind: c.kind,
    name: c.name,
    contact_person: c.contactPerson ?? null,
    org_number: c.orgNumber ?? null,
    email: c.email,
    phone: c.phone,
    address: c.address ?? null,
    postal_code: c.postalCode ?? null,
    city: c.city ?? null,
    personal_identity_number: c.personalIdentityNumber ?? null,
    default_work_location_id: c.defaultWorkLocationId ?? null,
    notes: c.notes,
    created_at: c.createdAt,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    kind: r.kind as Customer["kind"],
    name: str(r.name),
    ...opt("contactPerson", strOrU(r.contact_person)),
    ...opt("orgNumber", strOrU(r.org_number)),
    email: str(r.email),
    phone: str(r.phone),
    ...opt("address", strOrU(r.address)),
    ...opt("postalCode", strOrU(r.postal_code)),
    ...opt("city", strOrU(r.city)),
    ...opt("personalIdentityNumber", strOrU(r.personal_identity_number)),
    ...opt("defaultWorkLocationId", strOrU(r.default_work_location_id)),
    notes: str(r.notes),
    createdAt: tsIso(r.created_at),
  }),
};

export const workLocationsSpec: TableSpec<WorkLocation & { customerId: string; position: number }> = {
  table: "work_locations",
  pk: ["id"],
  columns: [
    "id", "business_id", "customer_id", "position", "label", "address", "postal_code",
    "city", "place_id", "property_type", "property_designation", "brf_org_number", "apartment_number",
  ],
  toRow: (w, businessId) => ({
    id: w.id,
    business_id: businessId,
    customer_id: w.customerId,
    position: w.position,
    label: w.label,
    address: w.address,
    postal_code: w.postalCode,
    city: w.city,
    place_id: w.placeId ?? null,
    property_type: w.propertyType,
    property_designation: w.propertyDesignation ?? null,
    brf_org_number: w.brfOrgNumber ?? null,
    apartment_number: w.apartmentNumber ?? null,
  }),
  fromRow: (r) => ({
    customerId: str(r.customer_id),
    position: num(r.position),
    id: str(r.id),
    label: str(r.label),
    address: str(r.address),
    postalCode: str(r.postal_code),
    city: str(r.city),
    ...opt("placeId", strOrU(r.place_id)),
    propertyType: r.property_type as WorkLocation["propertyType"],
    ...opt("propertyDesignation", strOrU(r.property_designation)),
    ...opt("brfOrgNumber", strOrU(r.brf_org_number)),
    ...opt("apartmentNumber", strOrU(r.apartment_number)),
  }),
};

/** Plocka ut ren WorkLocation (utan hjälpfälten) för kundobjektet. */
export function workLocationFromRow(r: SqlRow): WorkLocation {
  const { customerId: _c, position: _p, ...rest } = workLocationsSpec.fromRow(r);
  return rest as WorkLocation;
}

/* --------------------------------- quotes --------------------------------- */

export const quotesSpec: TableSpec<Quote & { amountToPay: number }> = {
  table: "quotes",
  pk: ["id"],
  columns: [
    "id", "business_id", "number", "customer_id", "job_id", "work_location_id", "status",
    "current_version_id", "token", "sent_at", "viewed_at", "decided_at", "decline_reason",
    "follow_ups", "last_email", "last_send_attempt_at", "amount_to_pay", "created_at",
  ],
  toRow: (q, businessId) => ({
    id: q.id,
    business_id: businessId,
    number: q.number,
    customer_id: q.customerId,
    job_id: q.jobId ?? null,
    work_location_id: q.workLocationId ?? null,
    status: q.status,
    current_version_id: q.currentVersionId,
    token: q.token,
    sent_at: q.sentAt ?? null,
    viewed_at: q.viewedAt ?? null,
    decided_at: q.decidedAt ?? null,
    decline_reason: q.declineReason ?? null,
    follow_ups: jsonParam(q.followUps),
    last_email: jsonParamOrNull(q.lastEmail),
    last_send_attempt_at: q.lastSendAttemptAt ?? null,
    amount_to_pay: q.amountToPay,
    created_at: q.createdAt,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    number: num(r.number),
    customerId: str(r.customer_id),
    ...opt("jobId", strOrU(r.job_id)),
    ...opt("workLocationId", strOrU(r.work_location_id)),
    status: r.status as Quote["status"],
    currentVersionId: str(r.current_version_id),
    token: str(r.token),
    ...opt("sentAt", tsIsoOrU(r.sent_at)),
    ...opt("viewedAt", tsIsoOrU(r.viewed_at)),
    ...opt("decidedAt", tsIsoOrU(r.decided_at)),
    ...opt("declineReason", strOrU(r.decline_reason)),
    followUps: jsonVal<string[]>(r.follow_ups),
    ...opt("lastEmail", jsonOrU<NonNullable<Quote["lastEmail"]>>(r.last_email)),
    ...opt("lastSendAttemptAt", tsIsoOrU(r.last_send_attempt_at)),
    createdAt: tsIso(r.created_at),
    amountToPay: num(r.amount_to_pay),
  }),
};

/** Quote utan det denormaliserade beloppet (domänobjektet). */
export function quoteFromRow(r: SqlRow): Quote {
  const { amountToPay: _a, ...rest } = quotesSpec.fromRow(r);
  return rest as Quote;
}

/* ------------------------------ quote_versions ---------------------------- */
/**
 * payload är HELA QuoteVersion-objektet verbatim – hash-fryst yta.
 * Kolumnerna är extraherade kopior för SQL-frågor, aldrig sanningskälla.
 *
 * Läsuppgradering: äldre payloads kan bära legacy-fältet intro ("Beskrivning
 * av arbetet"). Olåsta versioner migreras vid läsning (intro → överst i
 * richText) – låsta lämnas verbatim eftersom intro ingår i contentHash.
 * Baslinjen klonas EFTER mappningen (adapter-supabase), så uppgraderingen
 * skapar aldrig falska diffar; raden skrivs om först när versionen faktiskt
 * ändras. Därför behövs ingen SQL-migrering (jfr 11_richtext.sql).
 */
export const quoteVersionsSpec: TableSpec<QuoteVersion> = {
  table: "quote_versions",
  pk: ["id"],
  columns: [
    "id", "business_id", "quote_id", "version", "title", "locked_at", "content_hash",
    "payload", "created_at",
  ],
  toRow: (v, businessId) => ({
    id: v.id,
    business_id: businessId,
    quote_id: v.quoteId,
    version: v.version,
    title: v.title,
    locked_at: v.lockedAt ?? null,
    content_hash: v.contentHash ?? null,
    payload: jsonParam(v),
    created_at: v.createdAt,
  }),
  fromRow: (r) => {
    const version = jsonVal<QuoteVersion>(r.payload);
    migrateQuoteVersionDescription(version);
    return version;
  },
};

/* ------------------------- signatures (offertgodkännanden) ------------------ */

/**
 * Godkännanderegistret. Kolumnnamnen är historiska (signer_name/signed_at);
 * domänfälten heter acceptedByName/acceptedAt. BankID-kolumnerna (order_ref,
 * signer_personal_number_masked, environment) är null för simple_accept.
 * Beviset (contentHash, statement, ip, …) ligger i evidence jsonb – migration 28.
 */
interface AcceptanceEvidenceRow {
  contentHash?: string;
  statement?: string;
  customerNameAtAccept?: string;
  acceptedByEmail?: string;
  ip?: string;
  userAgent?: string;
  linkSentTo?: string;
  note?: string;
}

function acceptanceMethodFromRow(r: SqlRow): QuoteAcceptance["method"] {
  const m = r.method;
  if (m === "simple_accept" || m === "bankid_mock" || m === "bankid") return m;
  // Rader från före migration 28: BankID-mocken (eller produktion om det fanns).
  return r.environment === "production" ? "bankid" : "bankid_mock";
}

export const signaturesSpec: TableSpec<QuoteAcceptance> = {
  table: "signatures",
  pk: ["id"],
  columns: [
    "id", "business_id", "quote_id", "quote_version_id", "method", "order_ref", "signer_name",
    "signer_personal_number_masked", "signed_at", "environment", "evidence",
  ],
  toRow: (a, businessId) => ({
    id: a.id,
    business_id: businessId,
    quote_id: a.quoteId,
    quote_version_id: a.quoteVersionId,
    method: a.method,
    order_ref: a.bankid?.orderRef ?? null,
    signer_name: a.acceptedByName,
    signer_personal_number_masked: a.bankid?.personalNumberMasked ?? null,
    signed_at: a.acceptedAt,
    environment: a.bankid?.environment ?? null,
    evidence: jsonParam({
      contentHash: a.contentHash,
      statement: a.statement,
      customerNameAtAccept: a.customerNameAtAccept,
      ...opt("acceptedByEmail", a.acceptedByEmail),
      ...opt("ip", a.ip),
      ...opt("userAgent", a.userAgent),
      ...opt("linkSentTo", a.linkSentTo),
      ...opt("note", a.bankid?.note),
    } satisfies AcceptanceEvidenceRow),
  }),
  fromRow: (r) => {
    const evidence = jsonVal<AcceptanceEvidenceRow | null>(r.evidence) ?? {};
    const method = acceptanceMethodFromRow(r);
    const acceptedByName = str(r.signer_name);
    return {
      id: str(r.id),
      quoteId: str(r.quote_id),
      quoteVersionId: str(r.quote_version_id),
      method,
      acceptedAt: tsIso(r.signed_at),
      acceptedByName,
      customerNameAtAccept: strOrU(evidence.customerNameAtAccept) ?? acceptedByName,
      ...opt("acceptedByEmail", strOrU(evidence.acceptedByEmail)),
      contentHash: strOrU(evidence.contentHash) ?? "",
      statement: strOrU(evidence.statement) ?? "",
      ...opt("ip", strOrU(evidence.ip)),
      ...opt("userAgent", strOrU(evidence.userAgent)),
      ...opt("linkSentTo", strOrU(evidence.linkSentTo)),
      ...(method === "simple_accept"
        ? {}
        : {
            bankid: {
              orderRef: str(r.order_ref),
              personalNumberMasked: str(r.signer_personal_number_masked),
              environment: (r.environment === "production" ? "production" : "mock") as BankIDEnvironment,
              note: strOrU(evidence.note) ?? "",
            },
          }),
    };
  },
};

/* ------------------------------- bankid_orders ---------------------------- */

export const bankidOrdersSpec: TableSpec<BankIDOrder> = {
  table: "bankid_orders",
  pk: ["order_ref"],
  columns: [
    "order_ref", "business_id", "quote_id", "quote_version_id", "status", "hint_code",
    "method", "created_at", "updated_at",
  ],
  toRow: (o, businessId) => ({
    order_ref: o.orderRef,
    business_id: businessId,
    quote_id: o.quoteId,
    quote_version_id: o.quoteVersionId,
    status: o.status,
    hint_code: o.hintCode,
    method: o.method,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  }),
  fromRow: (r) => ({
    orderRef: str(r.order_ref),
    quoteId: str(r.quote_id),
    quoteVersionId: str(r.quote_version_id),
    status: r.status as BankIDOrder["status"],
    hintCode: r.hint_code as BankIDOrder["hintCode"],
    method: r.method as BankIDOrder["method"],
    createdAt: tsIso(r.created_at),
    updatedAt: tsIso(r.updated_at),
  }),
};

/* ---------------------------------- jobs ---------------------------------- */

export const jobsSpec: TableSpec<Job> = {
  table: "jobs",
  pk: ["id"],
  columns: [
    "id", "business_id", "customer_id", "quote_id", "title", "description", "status",
    "start_date", "end_date", "address", "work_location_id", "checklist", "notes",
    "completed_at", "housing", "tax_reduction_application", "created_at",
    "source", "original_message", "idempotency_key", "notification",
    "archived_at",
  ],
  toRow: (j, businessId) => ({
    id: j.id,
    business_id: businessId,
    customer_id: j.customerId,
    quote_id: j.quoteId ?? null,
    title: j.title,
    description: j.description,
    status: j.status,
    start_date: j.startDate ?? null,
    end_date: j.endDate ?? null,
    address: j.address ?? null,
    work_location_id: j.workLocationId ?? null,
    checklist: jsonParam(j.checklist),
    notes: j.notes,
    completed_at: j.completedAt ?? null,
    housing: jsonParamOrNull(j.housing),
    tax_reduction_application: jsonParamOrNull(j.taxReductionApplication),
    created_at: j.createdAt,
    source: j.source ?? "manual",
    original_message: j.originalMessage ?? null,
    idempotency_key: j.idempotencyKey ?? null,
    notification: jsonParamOrNull(j.notification),
    archived_at: j.archivedAt ?? null,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    customerId: str(r.customer_id),
    ...opt("quoteId", strOrU(r.quote_id)),
    title: str(r.title),
    description: str(r.description),
    status: r.status as Job["status"],
    ...opt("startDate", strOrU(r.start_date)), // TEXT-kolumner: exakta rundresor
    ...opt("endDate", strOrU(r.end_date)),
    ...opt("address", strOrU(r.address)),
    ...opt("workLocationId", strOrU(r.work_location_id)),
    checklist: jsonVal<Job["checklist"]>(r.checklist),
    notes: str(r.notes),
    createdAt: tsIso(r.created_at),
    ...opt("completedAt", tsIsoOrU(r.completed_at)),
    ...opt("housing", jsonOrU<NonNullable<Job["housing"]>>(r.housing)),
    ...opt(
      "taxReductionApplication",
      jsonOrU<NonNullable<Job["taxReductionApplication"]>>(r.tax_reduction_application)
    ),
    ...opt("source", r.source == null ? undefined : (r.source as Job["source"])),
    ...opt("originalMessage", strOrU(r.original_message)),
    ...opt("idempotencyKey", strOrU(r.idempotency_key)),
    ...opt("notification", jsonOrU<NonNullable<Job["notification"]>>(r.notification)),
    ...opt("archivedAt", tsIsoOrU(r.archived_at)),
  }),
};

/* --------------------------- job work entries ----------------------------- */

export const jobWorkEntriesSpec: TableSpec<JobWorkEntry> = {
  table: "job_work_entries",
  pk: ["id"],
  columns: [
    "id", "business_id", "job_id", "role", "type", "description", "work_date",
    "qty", "unit", "unit_price", "vat_rate", "source", "quoted_line_item_id",
    "is_extra", "invoice_id", "created_at", "updated_at",
  ],
  toRow: (e, businessId) => ({
    id: e.id,
    business_id: businessId,
    job_id: e.jobId,
    role: e.role,
    type: e.type,
    description: e.description,
    work_date: e.date,
    qty: e.qty,
    unit: e.unit,
    unit_price: e.unitPrice,
    vat_rate: e.vatRate,
    source: e.source,
    quoted_line_item_id: e.quotedLineItemId ?? null,
    is_extra: e.isExtra,
    invoice_id: e.invoiceId ?? null,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    jobId: str(r.job_id),
    role: r.role as JobWorkEntry["role"],
    type: r.type as JobWorkEntry["type"],
    description: str(r.description),
    date: dateOnly(r.work_date),
    qty: num(r.qty),
    unit: str(r.unit),
    unitPrice: num(r.unit_price),
    vatRate: num(r.vat_rate) as JobWorkEntry["vatRate"],
    source: r.source as JobWorkEntry["source"],
    ...opt("quotedLineItemId", strOrU(r.quoted_line_item_id)),
    isExtra: Boolean(r.is_extra),
    ...opt("invoiceId", strOrU(r.invoice_id)),
    createdAt: tsIso(r.created_at),
    updatedAt: tsIso(r.updated_at),
  }),
};

/* -------------------------------- invoices -------------------------------- */

export const invoicesSpec: TableSpec<Invoice & { amountToPay: number }> = {
  table: "invoices",
  pk: ["id"],
  columns: [
    "id", "business_id", "number", "customer_id", "job_id", "quote_id", "work_location_id", "type", "status",
    "rot", "tax_reduction_terms", "tax_reduction_details", "tax_reduction_application",
    "issue_date", "due_date", "payment_terms_days", "service_date", "late_interest_rate",
    "issued_at", "sent_at", "last_sent_at", "last_email", "last_send_attempt_at", "paid_at", "reminders", "token", "ocr",
    "credits_invoice_id", "denied_reduction_of", "created_by", "amount_to_pay", "created_at",
    "refund", "overpayment_credit", "rich_text", "payment_plan_index",
  ],
  toRow: (inv, businessId) => ({
    id: inv.id,
    business_id: businessId,
    number: inv.number,
    customer_id: inv.customerId,
    job_id: inv.jobId ?? null,
    quote_id: inv.quoteId ?? null,
    work_location_id: inv.workLocationId ?? null,
    type: inv.type,
    status: inv.status,
    rot: jsonParamOrNull(inv.rot),
    rich_text: jsonParamOrNull(inv.richText),
    tax_reduction_terms: jsonParamOrNull(inv.taxReductionTerms),
    tax_reduction_details: jsonParamOrNull(inv.taxReductionDetails),
    tax_reduction_application: jsonParamOrNull(inv.taxReductionApplication),
    issue_date: inv.issueDate,
    due_date: inv.dueDate,
    payment_terms_days: inv.paymentTermsDays,
    service_date: inv.serviceDate ?? null,
    late_interest_rate: inv.lateInterestRate ?? null,
    issued_at: inv.issuedAt ?? null,
    sent_at: inv.sentAt ?? null,
    last_sent_at: inv.lastSentAt ?? null,
    last_email: jsonParamOrNull(inv.lastEmail),
    last_send_attempt_at: inv.lastSendAttemptAt ?? null,
    paid_at: inv.paidAt ?? null,
    reminders: jsonParam(inv.reminders),
    token: inv.token,
    ocr: inv.ocr,
    credits_invoice_id: inv.creditsInvoiceId ?? null,
    denied_reduction_of: inv.deniedReductionOf ?? null,
    created_by: inv.createdBy ?? null,
    amount_to_pay: inv.amountToPay,
    created_at: inv.createdAt,
    refund: jsonParamOrNull(inv.refund),
    overpayment_credit: inv.overpaymentCredit ?? null,
    payment_plan_index: inv.paymentPlanIndex ?? null,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    number: r.number == null ? null : num(r.number),
    customerId: str(r.customer_id),
    ...opt("jobId", strOrU(r.job_id)),
    ...opt("quoteId", strOrU(r.quote_id)),
    ...opt("workLocationId", strOrU(r.work_location_id)),
    type: r.type as Invoice["type"],
    status: r.status as Invoice["status"],
    lines: [], // fylls från invoice_line_items / issuedSnapshot i load
    rot: r.rot == null ? null : jsonVal<Invoice["rot"]>(r.rot),
    ...opt("richText", jsonOrU<NonNullable<Invoice["richText"]>>(r.rich_text)),
    ...opt("taxReductionTerms", jsonOrU<NonNullable<Invoice["taxReductionTerms"]>>(r.tax_reduction_terms)),
    ...opt("taxReductionDetails", jsonOrU<NonNullable<Invoice["taxReductionDetails"]>>(r.tax_reduction_details)),
    ...opt(
      "taxReductionApplication",
      jsonOrU<NonNullable<Invoice["taxReductionApplication"]>>(r.tax_reduction_application)
    ),
    issueDate: str(r.issue_date), // TEXT-kolumn: blandade strängformat rundresas exakt
    dueDate: str(r.due_date),
    paymentTermsDays: num(r.payment_terms_days),
    ...opt("serviceDate", dateOnlyOrU(r.service_date)),
    ...opt("lateInterestRate", numOrU(r.late_interest_rate)),
    ...opt("issuedAt", tsIsoOrU(r.issued_at)),
    ...opt("sentAt", tsIsoOrU(r.sent_at)),
    ...opt("lastSentAt", tsIsoOrU(r.last_sent_at)),
    ...opt("lastEmail", jsonOrU<NonNullable<Invoice["lastEmail"]>>(r.last_email)),
    ...opt("lastSendAttemptAt", tsIsoOrU(r.last_send_attempt_at)),
    ...opt("paidAt", tsIsoOrU(r.paid_at)),
    reminders: jsonVal<string[]>(r.reminders),
    token: str(r.token),
    ocr: str(r.ocr),
    ...opt("creditsInvoiceId", strOrU(r.credits_invoice_id)),
    ...opt("deniedReductionOf", strOrU(r.denied_reduction_of)),
    ...opt("createdBy", r.created_by == null ? undefined : (r.created_by as Invoice["createdBy"])),
    createdAt: tsIso(r.created_at),
    amountToPay: num(r.amount_to_pay),
    ...opt("refund", jsonOrU<NonNullable<Invoice["refund"]>>(r.refund)),
    ...opt("paymentPlanIndex", numOrU(r.payment_plan_index)),
    ...opt("overpaymentCredit", numOrU(r.overpayment_credit)),
  }),
};

export function invoiceLineToRow(
  line: DocLine,
  businessId: string,
  invoiceId: string,
  position: number
): Record<string, unknown> {
  const synced = syncDocLineClassification(line);
  return {
    id: synced.id,
    business_id: businessId,
    invoice_id: invoiceId,
    position,
    kind: synced.kind,
    description: synced.description,
    qty: synced.qty,
    unit: synced.unit,
    unit_price: synced.unitPrice,
    vat_rate: synced.vatRate,
    source_kind: synced.sourceKind ?? line.sourceKind ?? null,
    source_id: synced.sourceId ?? line.sourceId ?? null,
    source_quote_number: synced.sourceQuoteNumber ?? line.sourceQuoteNumber ?? null,
    payment_plan_index: synced.paymentPlanIndex ?? line.paymentPlanIndex ?? null,
  };
}

export const invoiceLineColumns = [
  "id", "business_id", "invoice_id", "position", "kind", "description", "qty", "unit", "unit_price", "vat_rate",
  "source_kind", "source_id", "source_quote_number", "payment_plan_index",
];

export function invoiceLineFromRow(r: SqlRow): DocLine {
  return syncDocLineClassification({
    id: str(r.id),
    kind: r.kind as DocLine["kind"],
    description: str(r.description),
    qty: num(r.qty),
    unit: str(r.unit),
    unitPrice: num(r.unit_price),
    vatRate: num(r.vat_rate) as DocLine["vatRate"],
    ...opt("sourceKind", r.source_kind == null ? undefined : (str(r.source_kind) as DocLine["sourceKind"])),
    ...opt("sourceId", strOrU(r.source_id)),
    ...opt("sourceQuoteNumber", numOrU(r.source_quote_number)),
    ...opt("paymentPlanIndex", numOrU(r.payment_plan_index)),
  });
}

/* -------------------------------- payments -------------------------------- */

export const paymentsSpec: TableSpec<Payment> = {
  table: "payments",
  pk: ["id"],
  columns: ["id", "business_id", "invoice_id", "bank_transaction_id", "amount", "date", "matched_by"],
  toRow: (p, businessId) => ({
    id: p.id,
    business_id: businessId,
    invoice_id: p.invoiceId,
    bank_transaction_id: p.bankTransactionId ?? null,
    amount: p.amount,
    date: p.date,
    matched_by: p.matchedBy,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    invoiceId: str(r.invoice_id),
    ...opt("bankTransactionId", strOrU(r.bank_transaction_id)),
    amount: num(r.amount),
    date: str(r.date), // TEXT-kolumn: blandade strängformat rundresas exakt
    matchedBy: r.matched_by as Payment["matchedBy"],
  }),
};

/* ------------------------------ bank_accounts ----------------------------- */

export const bankAccountsSpec: TableSpec<BankAccount> = {
  table: "bank_accounts",
  pk: ["id"],
  columns: ["id", "business_id", "provider", "name", "account_number", "balance", "connected_at", "external_id"],
  toRow: (a, businessId) => ({
    id: a.id,
    business_id: businessId,
    provider: a.provider,
    name: a.name,
    account_number: a.accountNumber,
    balance: a.balance,
    connected_at: a.connectedAt,
    external_id: a.externalId ?? null,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    provider: r.provider as BankAccount["provider"],
    name: str(r.name),
    accountNumber: str(r.account_number),
    balance: num(r.balance),
    connectedAt: tsIso(r.connected_at),
    ...opt("externalId", strOrU(r.external_id)),
  }),
};

/* ----------------------------- bank_connections --------------------------- */

export const bankConnectionsSpec: TableSpec<BankConnection> = {
  table: "bank_connections",
  pk: ["id"],
  columns: [
    "id", "business_id", "provider", "status", "external_user_id", "tink_user_id", "credentials_id",
    "access_token", "access_token_expires_at", "pending_state", "pending_state_expires_at",
    "bank_name", "masked_account", "last_sync_at", "last_error", "connected_at", "revoked_at",
    "created_at", "updated_at",
  ],
  toRow: (c, businessId) => ({
    id: c.id,
    business_id: businessId,
    provider: c.provider,
    status: c.status,
    external_user_id: c.externalUserId ?? null,
    tink_user_id: c.tinkUserId ?? null,
    credentials_id: c.credentialsId ?? null,
    access_token: c.accessToken ?? null,
    access_token_expires_at: c.accessTokenExpiresAt ?? null,
    pending_state: c.pendingState ?? null,
    pending_state_expires_at: c.pendingStateExpiresAt ?? null,
    bank_name: c.bankName ?? null,
    masked_account: c.maskedAccount ?? null,
    last_sync_at: c.lastSyncAt ?? null,
    last_error: c.lastError ?? null,
    connected_at: c.connectedAt ?? null,
    revoked_at: c.revokedAt ?? null,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    provider: r.provider as BankConnection["provider"],
    status: r.status as BankConnection["status"],
    ...opt("externalUserId", strOrU(r.external_user_id)),
    ...opt("tinkUserId", strOrU(r.tink_user_id)),
    ...opt("credentialsId", strOrU(r.credentials_id)),
    ...opt("accessToken", strOrU(r.access_token)),
    ...opt("accessTokenExpiresAt", tsIsoOrU(r.access_token_expires_at)),
    ...opt("pendingState", strOrU(r.pending_state)),
    ...opt("pendingStateExpiresAt", tsIsoOrU(r.pending_state_expires_at)),
    ...opt("bankName", strOrU(r.bank_name)),
    ...opt("maskedAccount", strOrU(r.masked_account)),
    ...opt("lastSyncAt", tsIsoOrU(r.last_sync_at)),
    ...opt("lastError", strOrU(r.last_error)),
    ...opt("connectedAt", tsIsoOrU(r.connected_at)),
    ...opt("revokedAt", tsIsoOrU(r.revoked_at)),
    createdAt: tsIso(r.created_at),
    updatedAt: tsIso(r.updated_at),
  }),
};

/* ---------------------------- bank_transactions --------------------------- */

export const bankTransactionsSpec: TableSpec<BankTransaction> = {
  table: "bank_transactions",
  pk: ["id"],
  columns: [
    "id", "business_id", "account_id", "external_id", "date", "amount", "counterpart", "description",
    "reference", "status", "matched_type", "matched_id", "verification_id",
  ],
  toRow: (t, businessId) => ({
    id: t.id,
    business_id: businessId,
    account_id: t.accountId,
    external_id: t.externalId ?? null,
    date: t.date,
    amount: t.amount,
    counterpart: t.counterpart,
    description: t.description,
    reference: t.reference ?? null,
    status: t.status,
    matched_type: t.matchedType ?? null,
    matched_id: t.matchedId ?? null,
    verification_id: t.verificationId ?? null,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    accountId: str(r.account_id),
    ...opt("externalId", strOrU(r.external_id)),
    date: str(r.date),
    amount: num(r.amount),
    counterpart: str(r.counterpart),
    description: str(r.description),
    ...opt("reference", strOrU(r.reference)),
    status: r.status as BankTransaction["status"],
    ...opt("matchedType", r.matched_type == null ? undefined : (r.matched_type as BankTransaction["matchedType"])),
    ...opt("matchedId", strOrU(r.matched_id)),
    ...opt("verificationId", strOrU(r.verification_id)),
  }),
};

/* -------------------------------- expenses -------------------------------- */

export const expensesSpec: TableSpec<Expense> = {
  table: "expenses",
  pk: ["id"],
  columns: [
    "id", "business_id", "supplier", "date", "amount", "vat_amount", "category",
    "description", "job_id", "receipt_id", "bank_transaction_id", "status", "question",
    "verification_id", "created_at",
  ],
  toRow: (e, businessId) => ({
    id: e.id,
    business_id: businessId,
    supplier: e.supplier,
    date: e.date,
    amount: e.amount,
    vat_amount: e.vatAmount,
    category: e.category ?? null,
    description: e.description ?? null,
    job_id: e.jobId ?? null,
    receipt_id: e.receiptId ?? null,
    bank_transaction_id: e.bankTransactionId ?? null,
    status: e.status,
    question: jsonParamOrNull(e.question),
    verification_id: e.verificationId ?? null,
    created_at: e.createdAt,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    supplier: str(r.supplier),
    date: str(r.date),
    amount: num(r.amount),
    vatAmount: num(r.vat_amount),
    ...opt("category", strOrU(r.category)),
    ...opt("description", strOrU(r.description)),
    ...opt("jobId", strOrU(r.job_id)),
    ...opt("receiptId", strOrU(r.receipt_id)),
    ...opt("bankTransactionId", strOrU(r.bank_transaction_id)),
    status: r.status as Expense["status"],
    ...opt("question", jsonOrU<NonNullable<Expense["question"]>>(r.question)),
    ...opt("verificationId", strOrU(r.verification_id)),
    createdAt: tsIso(r.created_at),
  }),
};

/* -------------------------------- receipts -------------------------------- */

export const receiptsSpec: TableSpec<Receipt> = {
  table: "receipts",
  pk: ["id"],
  columns: [
    "id",
    "business_id",
    "expense_id",
    "filename",
    "source",
    "uploaded_at",
    "extracted",
    "storage_path",
    "content_type",
    "size_bytes",
    "content_base64",
  ],
  protectedColumns: ["uploaded_by"],
  toRow: (k, businessId) => ({
    id: k.id,
    business_id: businessId,
    expense_id: k.expenseId ?? null,
    filename: k.filename,
    source: k.source,
    uploaded_at: k.uploadedAt,
    extracted: jsonParam(k.extracted),
    storage_path: k.storagePath ?? null,
    content_type: k.contentType ?? null,
    size_bytes: k.sizeBytes ?? null,
    content_base64: k.contentBase64 ?? null,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    ...opt("expenseId", strOrU(r.expense_id)),
    filename: str(r.filename),
    source: r.source as Receipt["source"],
    uploadedAt: tsIso(r.uploaded_at),
    extracted: jsonVal<Receipt["extracted"]>(r.extracted),
    ...opt("storagePath", strOrU(r.storage_path)),
    ...opt("contentType", strOrU(r.content_type)),
    ...opt("sizeBytes", numOrU(r.size_bytes)),
    ...opt("contentBase64", strOrU(r.content_base64)),
  }),
};

/* ----------------------------- supplier_invoices -------------------------- */

export const supplierInvoicesSpec: TableSpec<SupplierInvoice> = {
  table: "supplier_invoices",
  pk: ["id"],
  columns: [
    "id", "business_id", "supplier", "invoice_number", "date", "due_date", "amount",
    "vat_amount", "description", "category", "status", "accounting_status", "ocr",
    "bankgiro", "recipient_account", "payment_details", "inbox_item_id", "bank_transaction_id",
    "verification_id", "payment_verification_id", "created_at",
  ],
  toRow: (f, businessId) => ({
    id: f.id,
    business_id: businessId,
    supplier: f.supplier,
    invoice_number: f.invoiceNumber,
    date: f.date,
    due_date: f.dueDate,
    amount: f.amount,
    vat_amount: f.vatAmount,
    description: f.description,
    category: f.category,
    status: f.status,
    accounting_status: f.accountingStatus ?? (f.verificationId ? "bokford" : "obokford"),
    ocr: f.ocr ?? null,
    bankgiro: f.bankgiro ?? null,
    recipient_account: f.recipientAccount ?? null,
    // Tillstånd + proveniens för betalningsuppgifterna (jsonb – litet och läses alltid ihop).
    payment_details: f.paymentDetails ? jsonParam(f.paymentDetails) : null,
    inbox_item_id: f.inboxItemId ?? null,
    bank_transaction_id: f.bankTransactionId ?? null,
    verification_id: f.verificationId ?? null,
    payment_verification_id: f.paymentVerificationId ?? null,
    created_at: f.createdAt,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    supplier: str(r.supplier),
    invoiceNumber: str(r.invoice_number),
    date: str(r.date),
    dueDate: str(r.due_date),
    amount: num(r.amount),
    vatAmount: num(r.vat_amount),
    description: str(r.description),
    category: str(r.category),
    status: r.status as SupplierInvoice["status"],
    accountingStatus: (strOrU(r.accounting_status) as SupplierInvoice["accountingStatus"]) ?? (r.verification_id ? "bokford" : "obokford"),
    ...opt("ocr", strOrU(r.ocr)),
    ...opt("bankgiro", strOrU(r.bankgiro)),
    ...opt("recipientAccount", strOrU(r.recipient_account)),
    ...opt(
      "paymentDetails",
      r.payment_details == null ? undefined : jsonVal<SupplierInvoice["paymentDetails"]>(r.payment_details)
    ),
    ...opt("inboxItemId", strOrU(r.inbox_item_id)),
    ...opt("bankTransactionId", strOrU(r.bank_transaction_id)),
    ...opt("verificationId", strOrU(r.verification_id)),
    ...opt("paymentVerificationId", strOrU(r.payment_verification_id)),
    createdAt: tsIso(r.created_at),
  }),
};

export const supplierPaymentsSpec: TableSpec<SupplierPayment> = {
  table: "supplier_payments",
  pk: ["id"],
  columns: [
    "id", "business_id", "supplier_invoice_id", "amount", "currency", "due_date",
    "scheduled_date", "ocr", "reference", "recipient_account", "recipient_name",
    "provider_payment_id", "idempotency_key", "status", "failure_reason",
    "destination_changed", "bank_transaction_id", "payment_file_id",
    "created_at", "submitted_at", "updated_at", "paid_at",
  ],
  toRow: (p, businessId) => ({
    id: p.id,
    business_id: businessId,
    supplier_invoice_id: p.supplierInvoiceId,
    amount: p.amount,
    currency: p.currency,
    due_date: p.dueDate,
    scheduled_date: p.scheduledDate,
    ocr: p.ocr ?? null,
    reference: p.reference ?? null,
    recipient_account: p.recipientAccount,
    recipient_name: p.recipientName,
    provider_payment_id: p.providerPaymentId ?? null,
    idempotency_key: p.idempotencyKey,
    status: p.status,
    failure_reason: p.failureReason ?? null,
    destination_changed: p.destinationChanged ?? false,
    bank_transaction_id: p.bankTransactionId ?? null,
    payment_file_id: p.paymentFileId ?? null,
    created_at: p.createdAt,
    submitted_at: p.submittedAt ?? null,
    updated_at: p.updatedAt,
    paid_at: p.paidAt ?? null,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    supplierInvoiceId: str(r.supplier_invoice_id),
    amount: num(r.amount),
    currency: "SEK",
    dueDate: str(r.due_date),
    scheduledDate: str(r.scheduled_date),
    ...opt("ocr", strOrU(r.ocr)),
    ...opt("reference", strOrU(r.reference)),
    recipientAccount: str(r.recipient_account),
    recipientName: str(r.recipient_name),
    ...opt("providerPaymentId", strOrU(r.provider_payment_id)),
    idempotencyKey: str(r.idempotency_key),
    status: r.status as SupplierPayment["status"],
    ...opt("failureReason", strOrU(r.failure_reason)),
    ...opt("destinationChanged", r.destination_changed ? true : undefined),
    ...opt("bankTransactionId", strOrU(r.bank_transaction_id)),
    ...opt("paymentFileId", strOrU(r.payment_file_id)),
    createdAt: tsIso(r.created_at),
    ...opt("submittedAt", tsIsoOrU(r.submitted_at)),
    updatedAt: tsIso(r.updated_at),
    ...opt("paidAt", tsIsoOrU(r.paid_at)),
  }),
};

/* ------------------------------ payment_files ------------------------------ */

export const paymentFilesSpec: TableSpec<PaymentFile> = {
  table: "payment_files",
  pk: ["id"],
  columns: [
    "id", "business_id", "filename", "message_id", "format", "payment_ids",
    "supplier_invoice_ids", "total_amount", "currency", "xml", "status",
    "replaced_by_file_id", "created_at", "created_by",
  ],
  toRow: (f, businessId) => ({
    id: f.id,
    business_id: businessId,
    filename: f.filename,
    message_id: f.messageId,
    format: f.format,
    payment_ids: jsonParam(f.paymentIds),
    supplier_invoice_ids: jsonParam(f.supplierInvoiceIds),
    total_amount: f.totalAmount,
    currency: f.currency,
    xml: f.xml,
    status: f.status,
    replaced_by_file_id: f.replacedByFileId ?? null,
    created_at: f.createdAt,
    created_by: f.createdBy,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    filename: str(r.filename),
    messageId: str(r.message_id),
    format: r.format as PaymentFile["format"],
    paymentIds: jsonVal<string[]>(r.payment_ids ?? []),
    supplierInvoiceIds: jsonVal<string[]>(r.supplier_invoice_ids ?? []),
    totalAmount: num(r.total_amount),
    currency: "SEK",
    xml: str(r.xml),
    status: r.status as PaymentFile["status"],
    ...opt("replacedByFileId", strOrU(r.replaced_by_file_id)),
    createdAt: tsIso(r.created_at),
    createdBy: (strOrU(r.created_by) as PaymentFile["createdBy"]) ?? "anvandare",
  }),
};

/* ------------------------------ verifications ----------------------------- */
/**
 * Läses från verifications + accounting_entries (join i load).
 * Skrivs ALDRIG generiskt – endast via app.post_verification (RPC-payload
 * byggs i commit.ts med verificationRpcPayload nedan).
 */
export function verificationFromRows(head: SqlRow, entryRows: SqlRow[]): Verification {
  return {
    id: str(head.id),
    series: str(head.series),
    number: num(head.number),
    date: str(head.date), // TEXT-kolumn: blandade strängformat rundresas exakt
    description: str(head.description),
    entries: entryRows.map(
      (e): VerificationEntry => ({
        account: num(e.account),
        accountName: str(e.account_name),
        debit: num(e.debit),
        credit: num(e.credit),
        ...opt("vatCode", strOrU(e.vat_code)),
        ...opt("note", strOrU(e.note)),
      })
    ),
    source:
      head.source_id == null
        ? ({ type: "manuell" } as Verification["source"])
        : ({ type: head.source_type, id: str(head.source_id) } as Verification["source"]),
    confidence: head.confidence as Verification["confidence"],
    createdBy: head.created_by as Verification["createdBy"],
    status: "bokford",
    postedAt: tsIso(head.posted_at),
    ...opt("fiscalYearId", strOrU(head.fiscal_year_id)),
    ...opt("correctsVerificationId", strOrU(head.corrects_verification_id)),
    ...opt("correctedByVerificationId", strOrU(head.corrected_by_verification_id)),
    ...opt("explanation", strOrU(head.explanation)),
    createdAt: tsIso(head.created_at),
  };
}

export function verificationRpcPayload(v: Verification): Record<string, unknown> {
  return {
    id: v.id,
    series: v.series,
    number: v.number,
    date: v.date,
    description: v.description,
    source_type: v.source.type,
    source_id: "id" in v.source ? v.source.id : null,
    confidence: v.confidence,
    created_by: v.createdBy,
    posted_at: v.postedAt,
    fiscal_year_id: v.fiscalYearId ?? null,
    corrects_verification_id: v.correctsVerificationId ?? null,
    explanation: v.explanation ?? null,
    created_at: v.createdAt,
    entries: v.entries.map((e) => ({
      account: e.account,
      account_name: e.accountName,
      debit: e.debit,
      credit: e.credit,
      vat_code: e.vatCode ?? null,
      note: e.note ?? null,
    })),
  };
}

/* ------------------------------- fiscal_years ----------------------------- */

export const fiscalYearsSpec: TableSpec<FiscalYear> = {
  table: "fiscal_years",
  pk: ["id"],
  columns: [
    "id", "business_id", "label", "start_date", "end_date", "status",
    "opening_balances", "opening_source", "closed_at", "closing_verification_ids",
  ],
  toRow: (y, businessId) => ({
    id: y.id,
    business_id: businessId,
    label: y.label,
    start_date: y.startDate,
    end_date: y.endDate,
    status: y.status,
    opening_balances: jsonParam(y.openingBalances),
    opening_source: y.openingSource,
    closed_at: y.closedAt ?? null,
    closing_verification_ids: jsonParamOrNull(y.closingVerificationIds),
  }),
  fromRow: (r) => ({
    id: str(r.id),
    label: str(r.label),
    startDate: dateOnly(r.start_date),
    endDate: dateOnly(r.end_date),
    status: r.status as FiscalYear["status"],
    openingBalances: jsonVal<FiscalYear["openingBalances"]>(r.opening_balances),
    openingSource: r.opening_source as FiscalYear["openingSource"],
    ...opt("closedAt", tsIsoOrU(r.closed_at)),
    ...opt("closingVerificationIds", jsonOrU<string[]>(r.closing_verification_ids)),
  }),
};

/* -------------------------------- vat_reports ----------------------------- */

export const vatReportsSpec: TableSpec<VatReport> = {
  table: "vat_reports",
  pk: ["id"],
  columns: [
    "id", "business_id", "fiscal_year_id", "period_start", "period_end", "label", "status",
    "boxes", "utgaende", "ingaende", "att_betala", "generated_at", "declared_at",
    "settle_verification_id",
  ],
  toRow: (v, businessId) => ({
    id: v.id,
    business_id: businessId,
    fiscal_year_id: v.fiscalYearId,
    period_start: v.periodStart,
    period_end: v.periodEnd,
    label: v.label,
    status: v.status,
    boxes: jsonParam(v.boxes),
    utgaende: v.utgaende,
    ingaende: v.ingaende,
    att_betala: v.attBetala,
    generated_at: v.generatedAt,
    declared_at: v.declaredAt ?? null,
    settle_verification_id: v.settleVerificationId ?? null,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    fiscalYearId: str(r.fiscal_year_id),
    periodStart: dateOnly(r.period_start),
    periodEnd: dateOnly(r.period_end),
    label: str(r.label),
    status: r.status as VatReport["status"],
    boxes: jsonVal<VatReport["boxes"]>(r.boxes),
    utgaende: num(r.utgaende),
    ingaende: num(r.ingaende),
    attBetala: num(r.att_betala),
    generatedAt: tsIso(r.generated_at),
    ...opt("declaredAt", tsIsoOrU(r.declared_at)),
    ...opt("settleVerificationId", strOrU(r.settle_verification_id)),
  }),
};

/* ---------------------------------- assets -------------------------------- */

export const assetsSpec: TableSpec<Asset> = {
  table: "assets",
  pk: ["id"],
  columns: [
    "id", "business_id", "name", "acquisition_date", "acquisition_value", "asset_account",
    "depreciation_account", "accumulated_depreciation_account", "useful_life_years",
    "status", "source_expense_id", "acquisition_verification_id", "depreciations", "created_at",
  ],
  toRow: (a, businessId) => ({
    id: a.id,
    business_id: businessId,
    name: a.name,
    acquisition_date: a.acquisitionDate,
    acquisition_value: a.acquisitionValue,
    asset_account: a.assetAccount,
    depreciation_account: a.depreciationAccount,
    accumulated_depreciation_account: a.accumulatedDepreciationAccount,
    useful_life_years: a.usefulLifeYears,
    status: a.status,
    source_expense_id: a.sourceExpenseId ?? null,
    acquisition_verification_id: a.acquisitionVerificationId ?? null,
    depreciations: jsonParam(a.depreciations),
    created_at: a.createdAt,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    name: str(r.name),
    acquisitionDate: dateOnly(r.acquisition_date),
    acquisitionValue: num(r.acquisition_value),
    assetAccount: num(r.asset_account),
    depreciationAccount: num(r.depreciation_account),
    accumulatedDepreciationAccount: num(r.accumulated_depreciation_account),
    usefulLifeYears: num(r.useful_life_years),
    status: r.status as Asset["status"],
    ...opt("sourceExpenseId", strOrU(r.source_expense_id)),
    ...opt("acquisitionVerificationId", strOrU(r.acquisition_verification_id)),
    depreciations: jsonVal<Asset["depreciations"]>(r.depreciations),
    createdAt: tsIso(r.created_at),
  }),
};

/* --------------------------------- accruals ------------------------------- */

export const accrualsSpec: TableSpec<Accrual> = {
  table: "accruals",
  pk: ["id"],
  columns: [
    "id", "business_id", "kind", "description", "amount", "counter_account",
    "balance_account", "from_date", "to_date", "fiscal_year_id", "status", "source_type",
    "source_id", "book_verification_id", "reverse_verification_id", "created_at",
  ],
  toRow: (a, businessId) => ({
    id: a.id,
    business_id: businessId,
    kind: a.kind,
    description: a.description,
    amount: a.amount,
    counter_account: a.counterAccount,
    balance_account: a.balanceAccount,
    from_date: a.fromDate,
    to_date: a.toDate,
    fiscal_year_id: a.fiscalYearId,
    status: a.status,
    source_type: a.sourceType ?? null,
    source_id: a.sourceId ?? null,
    book_verification_id: a.bookVerificationId ?? null,
    reverse_verification_id: a.reverseVerificationId ?? null,
    created_at: a.createdAt,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    kind: r.kind as Accrual["kind"],
    description: str(r.description),
    amount: num(r.amount),
    counterAccount: num(r.counter_account),
    balanceAccount: num(r.balance_account),
    fromDate: dateOnly(r.from_date),
    toDate: dateOnly(r.to_date),
    fiscalYearId: str(r.fiscal_year_id),
    status: r.status as Accrual["status"],
    ...opt("sourceType", r.source_type == null ? undefined : (r.source_type as Accrual["sourceType"])),
    ...opt("sourceId", strOrU(r.source_id)),
    ...opt("bookVerificationId", strOrU(r.book_verification_id)),
    ...opt("reverseVerificationId", strOrU(r.reverse_verification_id)),
    createdAt: tsIso(r.created_at),
  }),
};

/* ------------------------------ annual_reports ---------------------------- */

export const annualReportsSpec: TableSpec<AnnualReport> = {
  table: "annual_reports",
  pk: ["id"],
  columns: [
    "id", "business_id", "fiscal_year_id", "status", "content", "generated_at",
    "reviewed_at", "signed_at", "marked_filed_at",
  ],
  toRow: (a, businessId) => ({
    id: a.id,
    business_id: businessId,
    fiscal_year_id: a.fiscalYearId,
    status: a.status,
    content: jsonParam(a.content),
    generated_at: a.generatedAt,
    reviewed_at: a.reviewedAt ?? null,
    signed_at: a.signedAt ?? null,
    marked_filed_at: a.markedFiledAt ?? null,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    fiscalYearId: str(r.fiscal_year_id),
    status: r.status as AnnualReport["status"],
    content: jsonVal<AnnualReport["content"]>(r.content),
    generatedAt: tsIso(r.generated_at),
    ...opt("reviewedAt", tsIsoOrU(r.reviewed_at)),
    ...opt("signedAt", tsIsoOrU(r.signed_at)),
    ...opt("markedFiledAt", tsIsoOrU(r.marked_filed_at)),
  }),
};

/* --------------------------------- websites ------------------------------- */

export const websitesSpec: TableSpec<Website> = {
  table: "websites",
  pk: ["id"],
  columns: [
    "id", "business_id", "slug", "business_name", "tagline", "city", "status", "theme",
    "design", "draft_design", "footer", "draft_footer", "sections", "primary_cta", "privacy_policy_supplement",
    "privacy_policy_mode", "privacy_policy_custom_body", "draft_privacy_policy",
    "published_at", "submissions", "created_at",
  ],
  toRow: (w, businessId) => ({
    id: w.id,
    business_id: businessId,
    slug: w.slug,
    business_name: w.businessName,
    tagline: w.tagline,
    city: w.city ?? null,
    status: w.status,
    theme: w.theme,
    design: jsonParamOrNull(w.design),
    draft_design: jsonParamOrNull(w.draftDesign),
    footer: jsonParamOrNull(w.footer),
    draft_footer: jsonParamOrNull(w.draftFooter),
    sections: jsonParam(w.sections),
    primary_cta: jsonParamOrNull(w.primaryCta),
    privacy_policy_supplement: w.privacyPolicySupplement ?? null,
    privacy_policy_mode: w.privacyPolicyMode ?? null,
    privacy_policy_custom_body: jsonParamOrNull(w.privacyPolicyCustomBody),
    draft_privacy_policy: jsonParamOrNull(w.draftPrivacyPolicy),
    published_at: w.publishedAt ?? null,
    submissions: w.submissions,
    created_at: w.createdAt,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    slug: str(r.slug),
    businessName: str(r.business_name),
    tagline: str(r.tagline),
    ...opt("city", strOrU(r.city)),
    status: r.status as Website["status"],
    theme: r.theme as Website["theme"],
    ...opt("design", jsonOrU<NonNullable<Website["design"]>>(r.design)),
    ...opt("draftDesign", jsonOrU<NonNullable<Website["draftDesign"]>>(r.draft_design)),
    ...opt("footer", jsonOrU<NonNullable<Website["footer"]>>(r.footer)),
    ...opt("draftFooter", jsonOrU<NonNullable<Website["draftFooter"]>>(r.draft_footer)),
    sections: withoutRetiredSections(jsonVal<Website["sections"]>(r.sections)),
    ...opt("primaryCta", jsonOrU<NonNullable<Website["primaryCta"]>>(r.primary_cta)),
    ...opt("privacyPolicySupplement", strOrU(r.privacy_policy_supplement)),
    ...opt("privacyPolicyMode", (r.privacy_policy_mode === "custom" || r.privacy_policy_mode === "standard"
      ? r.privacy_policy_mode
      : undefined) as Website["privacyPolicyMode"]),
    ...opt("privacyPolicyCustomBody", jsonOrU<NonNullable<Website["privacyPolicyCustomBody"]>>(r.privacy_policy_custom_body)),
    ...opt("draftPrivacyPolicy", jsonOrU<NonNullable<Website["draftPrivacyPolicy"]>>(r.draft_privacy_policy)),
    ...opt("publishedAt", tsIsoOrU(r.published_at)),
    createdAt: tsIso(r.created_at),
    submissions: num(r.submissions),
  }),
};

/* --------------------------------- domains -------------------------------- */

export const domainsSpec: TableSpec<Domain> = {
  table: "domains",
  pk: ["id"],
  columns: [
    "id", "business_id", "website_id", "hostname", "tld", "source", "registrar_provider",
    "registrar_domain_id", "registrar_registrant_id", "status", "is_primary", "registered_at",
    "expires_at", "auto_renew", "verification_status", "ssl_status", "billing", "provisioning",
    "idempotency_key", "created_at", "updated_at",
  ],
  toRow: (d, businessId) => ({
    id: d.id,
    business_id: businessId,
    website_id: d.websiteId ?? null,
    hostname: d.hostname,
    tld: d.tld,
    source: d.source,
    registrar_provider: d.registrarProvider,
    registrar_domain_id: d.registrarDomainId ?? null,
    registrar_registrant_id: d.registrarRegistrantId ?? null,
    status: d.status,
    is_primary: d.isPrimary,
    registered_at: d.registeredAt ?? null,
    expires_at: d.expiresAt ?? null,
    auto_renew: d.autoRenew,
    verification_status: d.verificationStatus,
    ssl_status: d.sslStatus,
    billing: jsonParam(d.billing),
    provisioning: jsonParam(d.provisioning),
    idempotency_key: d.idempotencyKey,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    businessId: str(r.business_id),
    ...opt("websiteId", strOrU(r.website_id)),
    hostname: str(r.hostname),
    tld: r.tld as Domain["tld"],
    source: r.source as Domain["source"],
    registrarProvider: r.registrar_provider as Domain["registrarProvider"],
    ...opt("registrarDomainId", strOrU(r.registrar_domain_id)),
    ...opt("registrarRegistrantId", strOrU(r.registrar_registrant_id)),
    status: r.status as Domain["status"],
    isPrimary: Boolean(r.is_primary),
    ...opt("registeredAt", tsIsoOrU(r.registered_at)),
    ...opt("expiresAt", tsIsoOrU(r.expires_at)),
    autoRenew: Boolean(r.auto_renew),
    verificationStatus: r.verification_status as Domain["verificationStatus"],
    sslStatus: r.ssl_status as Domain["sslStatus"],
    billing: jsonVal<Domain["billing"]>(r.billing),
    provisioning: jsonVal<Domain["provisioning"]>(r.provisioning),
    idempotencyKey: str(r.idempotency_key),
    createdAt: tsIso(r.created_at),
    updatedAt: tsIso(r.updated_at),
  }),
};

/* ---------------------------- assistant_messages -------------------------- */

export const assistantMessagesSpec: TableSpec<AssistantMessage> = {
  table: "assistant_messages",
  pk: ["id"],
  columns: ["id", "business_id", "role", "at", "text", "card"],
  toRow: (m, businessId) => ({
    id: m.id,
    business_id: businessId,
    role: m.role,
    at: m.at,
    text: m.text,
    card: jsonParamOrNull(m.card),
  }),
  fromRow: (r) => ({
    id: str(r.id),
    role: r.role as AssistantMessage["role"],
    at: tsIso(r.at),
    text: str(r.text),
    ...opt("card", jsonOrU<NonNullable<AssistantMessage["card"]>>(r.card)),
  }),
};

/* ----------------------------- pending_actions ---------------------------- */

export const pendingActionsSpec: TableSpec<PendingAssistantAction> = {
  table: "pending_actions",
  pk: ["id"],
  columns: ["id", "business_id", "payload"],
  toRow: (a, businessId) => ({
    id: a.id,
    business_id: businessId,
    payload: jsonParam(a),
  }),
  fromRow: (r) => jsonVal<PendingAssistantAction>(r.payload),
};

/* --------------------------------- reminders ------------------------------ */

export const remindersSpec: TableSpec<Reminder> = {
  table: "reminders",
  pk: ["id"],
  columns: [
    "id", "business_id", "user_id", "title", "description", "due_at", "timezone",
    "has_explicit_time", "status", "source", "related_entity_type", "related_entity_id",
    "recurrence_rule", "snoozed_until", "completed_at", "created_at",
  ],
  toRow: (rem, businessId) => ({
    id: rem.id,
    business_id: businessId,
    user_id: rem.userId,
    title: rem.title,
    description: rem.description ?? null,
    due_at: rem.dueAt ?? null,
    timezone: rem.timezone,
    has_explicit_time: rem.hasExplicitTime,
    status: rem.status,
    source: rem.source,
    related_entity_type: rem.relatedEntityType ?? null,
    related_entity_id: rem.relatedEntityId ?? null,
    recurrence_rule: rem.recurrenceRule ?? null,
    snoozed_until: rem.snoozedUntil ?? null,
    completed_at: rem.completedAt ?? null,
    created_at: rem.createdAt,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    userId: strOrU(r.user_id) ?? null,
    title: str(r.title),
    ...opt("description", strOrU(r.description)),
    ...opt("dueAt", tsIsoOrU(r.due_at)),
    timezone: str(r.timezone),
    hasExplicitTime: Boolean(r.has_explicit_time),
    status: r.status as Reminder["status"],
    source: r.source as Reminder["source"],
    ...opt("relatedEntityType", strOrU(r.related_entity_type) as Reminder["relatedEntityType"]),
    ...opt("relatedEntityId", strOrU(r.related_entity_id)),
    ...opt("recurrenceRule", strOrU(r.recurrence_rule)),
    ...opt("snoozedUntil", tsIsoOrU(r.snoozed_until)),
    ...opt("completedAt", tsIsoOrU(r.completed_at)),
    createdAt: tsIso(r.created_at),
  }),
};

/* ------------------------------ attention_states -------------------------- */

export const attentionStatesSpec: TableSpec<AttentionState> = {
  table: "attention_states",
  pk: ["id"],
  columns: [
    "id", "business_id", "user_id", "action_id", "snoozed_until",
    "dismissed_at", "dismissal_reason", "created_at", "updated_at",
  ],
  toRow: (s, businessId) => ({
    id: s.id,
    business_id: businessId,
    user_id: s.userId,
    action_id: s.actionId,
    snoozed_until: s.snoozedUntil ?? null,
    dismissed_at: s.dismissedAt ?? null,
    dismissal_reason: s.dismissalReason ?? null,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    userId: strOrU(r.user_id) ?? null,
    actionId: str(r.action_id),
    ...opt("snoozedUntil", tsIsoOrU(r.snoozed_until)),
    ...opt("dismissedAt", tsIsoOrU(r.dismissed_at)),
    ...opt("dismissalReason", strOrU(r.dismissal_reason)),
    createdAt: tsIso(r.created_at),
    updatedAt: tsIso(r.updated_at),
  }),
};

/* --------------------------------- inbox_items ---------------------------- */

export const inboxItemsSpec: TableSpec<InboxItem> = {
  table: "inbox_items",
  pk: ["id"],
  columns: [
    "id", "business_id", "kind", "status", "document_type", "source", "external_id",
    "from_address", "to_address", "subject", "text_body", "html_body", "attachments",
    "parsed_amount", "parsed_vat_amount", "parsed_supplier", "parsed_date",
    "parsed_invoice_number", "parsed_due_date", "parsed_ocr", "parsed_bankgiro",
    "parsed_details_confidence", "confidence", "extraction", "reviewed_at",
    "expense_id", "supplier_invoice_id", "created_at", "processed_at",
  ],
  toRow: (item, businessId) => ({
    id: item.id,
    business_id: businessId,
    kind: item.kind,
    status: item.status,
    document_type: item.documentType,
    source: item.source ?? null,
    external_id: item.externalId ?? null,
    from_address: item.fromAddress,
    to_address: item.toAddress,
    subject: item.subject,
    text_body: item.textBody,
    html_body: item.htmlBody ?? null,
    attachments: jsonParam(item.attachments),
    parsed_amount: item.parsedAmount ?? null,
    parsed_vat_amount: item.parsedVatAmount ?? null,
    parsed_supplier: item.parsedSupplier ?? null,
    parsed_date: item.parsedDate ?? null,
    parsed_invoice_number: item.parsedInvoiceNumber ?? null,
    parsed_due_date: item.parsedDueDate ?? null,
    parsed_ocr: item.parsedOcr ?? null,
    parsed_bankgiro: item.parsedBankgiro ?? null,
    parsed_details_confidence: item.parsedDetailsConfidence ?? null,
    confidence: item.confidence ?? null,
    // Per-fält-extraktion (värde + konfidens + källa) – litet och läses alltid ihop.
    extraction: item.extraction ? jsonParam(item.extraction) : null,
    reviewed_at: item.reviewedAt ?? null,
    expense_id: item.expenseId ?? null,
    supplier_invoice_id: item.supplierInvoiceId ?? null,
    created_at: item.createdAt,
    processed_at: item.processedAt ?? null,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    kind: (strOrU(r.kind) as InboxItem["kind"]) ?? "mail",
    status: r.status as InboxItem["status"],
    documentType: (strOrU(r.document_type) as InboxItem["documentType"]) ?? "ekonomiskt_dokument",
    ...opt("source", strOrU(r.source) as InboxItem["source"] | undefined),
    ...opt("externalId", strOrU(r.external_id)),
    fromAddress: str(r.from_address),
    toAddress: str(r.to_address),
    subject: str(r.subject),
    textBody: str(r.text_body),
    ...opt("htmlBody", strOrU(r.html_body)),
    attachments: jsonVal<InboxItem["attachments"]>(r.attachments ?? []),
    ...opt("parsedAmount", numOrU(r.parsed_amount)),
    ...opt("parsedVatAmount", numOrU(r.parsed_vat_amount)),
    ...opt("parsedSupplier", strOrU(r.parsed_supplier)),
    ...opt("parsedDate", r.parsed_date == null ? undefined : dateOnly(r.parsed_date)),
    ...opt("parsedInvoiceNumber", strOrU(r.parsed_invoice_number)),
    ...opt("parsedDueDate", r.parsed_due_date == null ? undefined : dateOnly(r.parsed_due_date)),
    ...opt("parsedOcr", strOrU(r.parsed_ocr)),
    ...opt("parsedBankgiro", strOrU(r.parsed_bankgiro)),
    ...opt("parsedDetailsConfidence", numOrU(r.parsed_details_confidence)),
    ...opt("confidence", numOrU(r.confidence)),
    ...opt("extraction", r.extraction == null ? undefined : jsonVal<InboxItem["extraction"]>(r.extraction)),
    ...opt("reviewedAt", tsIsoOrU(r.reviewed_at)),
    ...opt("expenseId", strOrU(r.expense_id)),
    ...opt("supplierInvoiceId", strOrU(r.supplier_invoice_id)),
    createdAt: tsIso(r.created_at),
    ...opt("processedAt", tsIsoOrU(r.processed_at)),
  }),
};

/* --------------------------------- audit_log ------------------------------ */
/**
 * EN tabell, fyra kanaler. Raderna är oföränderliga – differn får ENDAST
 * lägga till nya (insert-only), aldrig uppdatera eller ta bort. Att
 * aktivitetsflödet cappas till 2000 i minnet påverkar inte databasen –
 * historiken behålls i sin helhet.
 */
export type AuditChannel = "activity" | "accounting" | "domain" | "assistant";

export const auditLogColumns = [
  "id", "business_id", "channel", "actor_user_id", "actor_label", "event_type",
  "entity_type", "entity_id", "customer_id", "message", "metadata", "created_at",
];

export function activityToAuditRow(
  e: ActivityEvent,
  businessId: string,
  actorUserId: string | null
): Record<string, unknown> {
  return {
    id: e.id,
    business_id: businessId,
    channel: "activity",
    actor_user_id: actorUserId,
    actor_label: e.createdBy ?? "anvandare",
    event_type: e.entity?.type ?? "handelse",
    entity_type: e.entity?.type ?? null,
    entity_id: e.entity?.id ?? null,
    customer_id: e.customerId ?? null,
    message: e.text,
    metadata: jsonParam({}),
    created_at: e.at,
  };
}

export function activityFromAuditRow(r: SqlRow): ActivityEvent {
  const entityType = strOrU(r.entity_type);
  const entityId = strOrU(r.entity_id);
  return {
    id: str(r.id),
    at: tsIso(r.created_at),
    text: str(r.message),
    ...opt("customerId", strOrU(r.customer_id)),
    ...opt(
      "createdBy",
      r.actor_label === "anvandare" || r.actor_label === "assistent"
        ? (r.actor_label as ActivityEvent["createdBy"])
        : undefined
    ),
    ...(entityType && entityId
      ? { entity: { type: entityType as NonNullable<ActivityEvent["entity"]>["type"], id: entityId } }
      : {}),
  };
}

export function auditTrailToAuditRow(
  e: AuditEvent,
  businessId: string,
  actorUserId: string | null
): Record<string, unknown> {
  return {
    id: e.id,
    business_id: businessId,
    channel: "accounting",
    actor_user_id: actorUserId,
    actor_label: e.actor,
    event_type: e.action,
    entity_type: e.targetType ?? null,
    entity_id: e.targetId ?? null,
    customer_id: null,
    message: e.details,
    metadata: jsonParam({}),
    created_at: e.at,
  };
}

export function auditTrailFromAuditRow(r: SqlRow): AuditEvent {
  return {
    id: str(r.id),
    at: tsIso(r.created_at),
    actor: r.actor_label as AuditEvent["actor"],
    action: r.event_type as AuditEvent["action"],
    ...opt("targetType", strOrU(r.entity_type)),
    ...opt("targetId", strOrU(r.entity_id)),
    details: str(r.message),
  };
}

export function domainAuditToAuditRow(
  e: DomainAuditEvent,
  businessId: string,
  actorUserId: string | null
): Record<string, unknown> {
  return {
    id: e.id,
    business_id: businessId,
    channel: "domain",
    actor_user_id: actorUserId,
    actor_label: e.actor,
    event_type: e.action,
    entity_type: e.domainId ? "doman" : null,
    entity_id: e.domainId ?? null,
    customer_id: null,
    message: e.details,
    metadata: jsonParam(e.hostname ? { hostname: e.hostname } : {}),
    created_at: e.at,
  };
}

export function domainAuditFromAuditRow(r: SqlRow): DomainAuditEvent {
  const metadata = jsonVal<{ hostname?: string }>(r.metadata ?? {});
  return {
    id: str(r.id),
    at: tsIso(r.created_at),
    actor: r.actor_label as DomainAuditEvent["actor"],
    action: r.event_type as DomainAuditEvent["action"],
    ...opt("domainId", strOrU(r.entity_id)),
    ...opt("hostname", metadata.hostname),
    details: str(r.message),
  };
}

export function assistantAuditToAuditRow(
  e: AssistantAuditEntry,
  businessId: string,
  actorUserId: string | null
): Record<string, unknown> {
  return {
    id: e.id,
    business_id: businessId,
    channel: "assistant",
    actor_user_id: actorUserId,
    actor_label: "assistent",
    event_type: e.tool,
    entity_type: null,
    entity_id: null,
    customer_id: null,
    message: "",
    metadata: jsonParam({
      params: e.params ?? null,
      success: e.success,
      ms: e.ms,
      ...(e.error === undefined ? {} : { error: e.error }),
    }),
    created_at: e.at,
  };
}

export function assistantAuditFromAuditRow(r: SqlRow): AssistantAuditEntry {
  const metadata = jsonVal<{ params?: unknown; success?: boolean; ms?: number; error?: string }>(
    r.metadata ?? {}
  );
  return {
    id: str(r.id),
    at: tsIso(r.created_at),
    tool: str(r.event_type),
    params: metadata.params ?? null,
    success: Boolean(metadata.success),
    ms: num(metadata.ms ?? 0),
    ...opt("error", metadata.error),
  };
}

/* ------------------------------ business_settings ------------------------- */

export const settingsColumns = [
  "business_id", "name", "company_form", "org_number", "vat_number", "email",
  "website_notification_email", "phone", "website_url", "address", "postal_code", "city",
  "sate", "country", "bankgiro", "plusgiro", "bank_account", "iban", "bic", "logo_initials",
  "logo_data_url", "f_skatt_per_month", "payroll_reserve_per_month", "payment_terms_days",
  "late_interest_rate", "quote_validity_days", "default_vat_rate", "default_hourly_rate",
  "default_quote_terms", "inbound_mail_slug", "payer_bank_name", "payer_iban", "payer_bic",
];

export function settingsToRow(s: CompanySettings, businessId: string): Record<string, unknown> {
  return {
    business_id: businessId,
    name: s.name,
    company_form: s.companyForm ?? "ab",
    org_number: s.orgNumber,
    vat_number: s.vatNumber,
    email: s.email,
    website_notification_email: s.websiteNotificationEmail ?? null,
    phone: s.phone,
    website_url: s.websiteUrl ?? null,
    address: s.address,
    postal_code: s.postalCode,
    city: s.city,
    sate: s.sate ?? null,
    country: s.country ?? null,
    bankgiro: s.bankgiro,
    plusgiro: s.plusgiro ?? null,
    bank_account: s.bankAccount ?? null,
    iban: s.iban ?? null,
    bic: s.bic ?? null,
    logo_initials: s.logoInitials,
    logo_data_url: s.logoDataUrl ?? null,
    f_skatt_per_month: s.fSkattPerMonth,
    payroll_reserve_per_month: s.payrollReservePerMonth,
    payment_terms_days: s.paymentTermsDays,
    late_interest_rate: s.lateInterestRate,
    quote_validity_days: s.quoteValidityDays,
    default_vat_rate: s.defaultVatRate,
    default_hourly_rate: s.defaultHourlyRate ?? null,
    default_quote_terms: s.defaultQuoteTerms?.trim() || null,
    inbound_mail_slug: s.inboundMailSlug || "demo",
    payer_bank_name: s.payerBankName ?? null,
    payer_iban: s.payerIban ?? null,
    payer_bic: s.payerBic ?? null,
  };
}

export function settingsFromRow(r: SqlRow): CompanySettings {
  return {
    name: str(r.name),
    ...opt("companyForm", r.company_form == null ? undefined : (r.company_form as CompanySettings["companyForm"])),
    orgNumber: str(r.org_number),
    vatNumber: str(r.vat_number),
    email: str(r.email),
    ...opt("websiteNotificationEmail", strOrU(r.website_notification_email)),
    phone: str(r.phone),
    ...opt("websiteUrl", strOrU(r.website_url)),
    address: str(r.address),
    postalCode: str(r.postal_code),
    city: str(r.city),
    ...opt("sate", strOrU(r.sate)),
    ...opt("country", strOrU(r.country)),
    bankgiro: str(r.bankgiro),
    ...opt("plusgiro", strOrU(r.plusgiro)),
    ...opt("bankAccount", strOrU(r.bank_account)),
    ...opt("iban", strOrU(r.iban)),
    ...opt("bic", strOrU(r.bic)),
    logoInitials: str(r.logo_initials),
    ...opt("logoDataUrl", strOrU(r.logo_data_url)),
    fSkattPerMonth: num(r.f_skatt_per_month),
    payrollReservePerMonth: num(r.payroll_reserve_per_month),
    paymentTermsDays: num(r.payment_terms_days),
    lateInterestRate: num(r.late_interest_rate),
    quoteValidityDays: num(r.quote_validity_days),
    defaultVatRate: num(r.default_vat_rate) as CompanySettings["defaultVatRate"],
    ...opt("defaultHourlyRate", numOrU(r.default_hourly_rate)),
    ...opt("defaultQuoteTerms", strOrU(r.default_quote_terms)),
    ...opt("inboundMailSlug", strOrU(r.inbound_mail_slug)),
    ...opt("payerBankName", strOrU(r.payer_bank_name)),
    ...opt("payerIban", strOrU(r.payer_iban)),
    ...opt("payerBic", strOrU(r.payer_bic)),
  };
}

/* ------------------------------- DB-metadata ------------------------------ */

export function metaFromBusinessRow(r: SqlRow): DB["meta"] {
  // demo speglar ALLTID kolumnen is_demo (fryst vid insert) – aldrig jsonb-
  // innehållet, som appen kan skriva. Commit-vägen skriver aldrig tillbaka den.
  const { demo: _fromJsonb, ...meta } = jsonVal<DB["meta"]>(r.meta ?? {});
  return {
    ...meta,
    seededAt: meta.seededAt ?? tsIso(r.created_at),
    ...(r.is_demo === true ? { demo: true } : {}),
  };
}

/* ------------------------- collaboration_invitations ---------------------- */

export const collaborationInvitationsSpec: TableSpec<CollaborationInvitation> = {
  table: "collaboration_invitations",
  pk: ["id"],
  columns: [
    "id", "business_id", "email", "role", "invited_by_user_id", "invited_by_name",
    "token_hash", "expires_at", "accepted_at", "accepted_by_user_id", "revoked_at",
    "revoked_by_user_id", "status", "created_at",
  ],
  toRow: (i, businessId) => ({
    id: i.id,
    business_id: businessId,
    email: i.email,
    role: i.role,
    invited_by_user_id: i.invitedByUserId,
    invited_by_name: i.invitedByName,
    token_hash: i.tokenHash,
    expires_at: i.expiresAt,
    accepted_at: i.acceptedAt ?? null,
    accepted_by_user_id: i.acceptedByUserId ?? null,
    revoked_at: i.revokedAt ?? null,
    revoked_by_user_id: i.revokedByUserId ?? null,
    status: i.status,
    created_at: i.createdAt,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    businessId: str(r.business_id),
    email: str(r.email),
    role: r.role as CollaborationInvitation["role"],
    invitedByUserId: str(r.invited_by_user_id),
    invitedByName: str(r.invited_by_name),
    tokenHash: str(r.token_hash),
    expiresAt: tsIso(r.expires_at),
    ...opt("acceptedAt", tsIsoOrU(r.accepted_at)),
    ...opt("acceptedByUserId", strOrU(r.accepted_by_user_id)),
    ...opt("revokedAt", tsIsoOrU(r.revoked_at)),
    ...opt("revokedByUserId", strOrU(r.revoked_by_user_id)),
    status: r.status as CollaborationInvitation["status"],
    createdAt: tsIso(r.created_at),
  }),
};

/* ----------------------- client_information_requests ---------------------- */

export const clientInformationRequestsSpec: TableSpec<ClientInformationRequest> = {
  table: "client_information_requests",
  pk: ["id"],
  columns: [
    "id", "business_id", "kind", "title", "message", "expense_id", "supplier_invoice_id",
    "requested_by_user_id", "requested_by_name", "requested_by_role", "created_at",
    "resolved_at", "resolved_by_user_id",
  ],
  toRow: (c, businessId) => ({
    id: c.id,
    business_id: businessId,
    kind: c.kind,
    title: c.title,
    message: c.message,
    expense_id: c.expenseId ?? null,
    supplier_invoice_id: c.supplierInvoiceId ?? null,
    requested_by_user_id: c.requestedByUserId,
    requested_by_name: c.requestedByName,
    requested_by_role: c.requestedByRole,
    created_at: c.createdAt,
    resolved_at: c.resolvedAt ?? null,
    resolved_by_user_id: c.resolvedByUserId ?? null,
  }),
  fromRow: (r) => ({
    id: str(r.id),
    kind: r.kind as ClientInformationRequest["kind"],
    title: str(r.title),
    message: str(r.message),
    ...opt("expenseId", strOrU(r.expense_id)),
    ...opt("supplierInvoiceId", strOrU(r.supplier_invoice_id)),
    requestedByUserId: str(r.requested_by_user_id),
    requestedByName: str(r.requested_by_name),
    requestedByRole: r.requested_by_role as ClientInformationRequest["requestedByRole"],
    createdAt: tsIso(r.created_at),
    ...opt("resolvedAt", tsIsoOrU(r.resolved_at)),
    ...opt("resolvedByUserId", strOrU(r.resolved_by_user_id)),
  }),
};
