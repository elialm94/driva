import type { CompanySettings, Customer, DB, DocLine } from "../types";

export function testCompany(over: Partial<CompanySettings> = {}): CompanySettings {
  return {
    name: "Test Snickeri AB",
    orgNumber: "559123-4567",
    vatNumber: "SE559123456701",
    email: "info@test.se",
    phone: "08-123 45 67",
    address: "Gatan 1",
    postalCode: "111 22",
    city: "Stockholm",
    sate: "Stockholm",
    bankgiro: "5678-1234",
    logoInitials: "TS",
    fSkattPerMonth: 0,
    payrollReservePerMonth: 0,
    paymentTermsDays: 30,
    lateInterestRate: 10,
    quoteValidityDays: 30,
    defaultVatRate: 25,
    ...over,
  };
}

export function testCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: over.id ?? "cust-1",
    kind: over.kind ?? "privat",
    name: over.name ?? "Anna Andersson",
    email: over.email ?? "anna@test.se",
    phone: over.phone ?? "070-123 45 67",
    address: over.address ?? "Folkungagatan 1",
    postalCode: over.postalCode ?? "116 30",
    city: over.city ?? "Stockholm",
    notes: over.notes ?? "",
    createdAt: over.createdAt ?? new Date().toISOString(),
    orgNumber: over.orgNumber,
    contactPerson: over.contactPerson,
  };
}

export function labor(over: Partial<DocLine> = {}): DocLine {
  return {
    id: over.id ?? `line-${Math.random().toString(36).slice(2, 8)}`,
    kind: "arbete",
    description: "Snickeriarbete",
    qty: 1,
    unit: "st",
    unitPrice: 1000,
    vatRate: 25,
    ...over,
  };
}

export function emptyTestDb(over: Partial<DB> = {}): DB {
  return {
    settings: over.settings ?? testCompany(),
    sequences: over.sequences ?? { quote: 1, invoice: 100, verification: 1 },
    customers: over.customers ?? [testCustomer()],
    quotes: over.quotes ?? [],
    quoteVersions: over.quoteVersions ?? [],
    signatures: over.signatures ?? [],
    bankidOrders: over.bankidOrders ?? [],
    jobs: over.jobs ?? [],
    jobWorkEntries: over.jobWorkEntries ?? [],
    invoices: over.invoices ?? [],
    payments: over.payments ?? [],
    bankAccounts: over.bankAccounts ?? [],
    bankTransactions: over.bankTransactions ?? [],
    expenses: over.expenses ?? [],
    receipts: over.receipts ?? [],
    supplierInvoices: over.supplierInvoices ?? [],
    supplierPayments: over.supplierPayments ?? [],
    verifications: over.verifications ?? [],
    fiscalYears: over.fiscalYears ?? [],
    accounting: over.accounting ?? {},
    vatReports: over.vatReports ?? [],
    assets: over.assets ?? [],
    accruals: over.accruals ?? [],
    auditTrail: over.auditTrail ?? [],
    annualReports: over.annualReports ?? [],
    activity: over.activity ?? [],
    website: over.website ?? null,
    domains: over.domains ?? [],
    domainAudit: over.domainAudit ?? [],
    assistantMessages: over.assistantMessages ?? [],
    pendingActions: over.pendingActions ?? [],
    assistantAudit: over.assistantAudit ?? [],
    reminders: over.reminders ?? [],
    attentionStates: over.attentionStates ?? [],
    inboxItems: over.inboxItems ?? [],
    collaborationInvitations: over.collaborationInvitations ?? [],
    clientInformationRequests: over.clientInformationRequests ?? [],
    meta: over.meta ?? { seededAt: new Date().toISOString() },
  };
}
