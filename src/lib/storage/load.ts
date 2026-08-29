/**
 * Ladda ett företags fullständiga tillstånd till domänens DB-objekt.
 *
 * Körs i EN transaktion med tenantkontext (set local role driva_app +
 * app.business_id-GUC) så att RLS gäller hela vägen. Arrayordning speglar
 * JSON-lagrets semantik: insättningsordning (created_at asc) för de flesta
 * samlingar, nyast först för aktivitetsflödet (som är cappat i minnet men
 * INTE i databasen), verifikationer i nummerordning.
 */
import type { DB, Verification } from "@/lib/types";
import type { SqlExecutor, SqlRow } from "./executor";
import {
  accrualsSpec,
  activityFromAuditRow,
  annualReportsSpec,
  assetsSpec,
  assistantAuditFromAuditRow,
  assistantMessagesSpec,
  auditTrailFromAuditRow,
  bankAccountsSpec,
  bankidOrdersSpec,
  bankTransactionsSpec,
  customersSpec,
  dateOnly,
  domainAuditFromAuditRow,
  domainsSpec,
  expensesSpec,
  fiscalYearsSpec,
  invoiceLineFromRow,
  attentionStatesSpec,
  inboxItemsSpec,
  invoicesSpec,
  jobsSpec,
  metaFromBusinessRow,
  num,
  paymentsSpec,
  pendingActionsSpec,
  remindersSpec,
  quoteFromRow,
  quoteVersionsSpec,
  receiptsSpec,
  requestsSpec,
  settingsFromRow,
  signaturesSpec,
  supplierInvoicesSpec,
  verificationFromRows,
  vatReportsSpec,
  websitesSpec,
  workLocationFromRow,
} from "./mappers";

/** Antal aktivitetsrader som laddas till minnesmodellen (DB behåller allt). */
const ACTIVITY_LOAD_LIMIT = 2000;

export interface LoadedTenantState {
  state: DB;
  stateVersion: number;
}

/** Sätt transaktionens tenantkontext. Måste anropas först i varje tx. */
export async function bindTransaction(tx: SqlExecutor, businessId: string): Promise<void> {
  // UTC är obligatoriskt: date-semantiska strängar ('2026-08-28') kastas till
  // timestamptz med sessionens tidszon – allt annat än UTC ger dygnsdrift.
  await tx.query(`set local timezone to 'UTC'`);
  await tx.query(`set local role driva_app`);
  await tx.query(`select set_config('app.business_id', $1, true)`, [businessId]);
}

export async function loadTenantState(tx: SqlExecutor, businessId: string): Promise<LoadedTenantState> {
  const b = [businessId];

  const [businessRows, settingsRows, sequenceRows] = await Promise.all([
    tx.query(`select * from public.businesses where id = $1`, b),
    tx.query(`select * from public.business_settings where business_id = $1`, b),
    tx.query(`select * from public.business_sequences where business_id = $1`, b),
  ]);
  const business = businessRows[0];
  if (!business || !settingsRows[0] || !sequenceRows[0]) {
    throw new Error(`Företaget ${businessId} saknas eller är ofullständigt (business/settings/sequences).`);
  }

  const [
    customerRows,
    workLocationRows,
    requestRows,
    quoteRows,
    quoteVersionRows,
    signatureRows,
    bankidOrderRows,
    jobRows,
    invoiceRows,
    invoiceLineRows,
    snapshotRows,
    paymentRows,
  ] = await Promise.all([
    tx.query(`select * from public.customers where business_id = $1 order by created_at, id`, b),
    tx.query(`select * from public.work_locations where business_id = $1 order by customer_id, position, id`, b),
    tx.query(`select * from public.requests where business_id = $1 order by created_at, id`, b),
    tx.query(`select * from public.quotes where business_id = $1 order by created_at, id`, b),
    tx.query(`select * from public.quote_versions where business_id = $1 order by created_at, version, id`, b),
    tx.query(`select * from public.signatures where business_id = $1 order by signed_at, id`, b),
    tx.query(`select * from public.bankid_orders where business_id = $1 order by created_at, order_ref`, b),
    tx.query(`select * from public.jobs where business_id = $1 order by created_at, id`, b),
    tx.query(`select * from public.invoices where business_id = $1 order by created_at, id`, b),
    tx.query(`select * from public.invoice_line_items where business_id = $1 order by invoice_id, position`, b),
    tx.query(`select * from public.invoice_issued_snapshots where business_id = $1`, b),
    tx.query(`select * from public.payments where business_id = $1 order by date, id`, b),
  ]);

  const [
    bankAccountRows,
    bankTxRows,
    expenseRows,
    receiptRows,
    supplierRows,
    verificationRows,
    entryRows,
    fiscalYearRows,
    vatReportRows,
    assetRows,
    accrualRows,
    annualReportRows,
  ] = await Promise.all([
    tx.query(`select * from public.bank_accounts where business_id = $1 order by connected_at, id`, b),
    tx.query(`select * from public.bank_transactions where business_id = $1 order by date, id`, b),
    tx.query(`select * from public.expenses where business_id = $1 order by created_at, id`, b),
    tx.query(`select * from public.receipts where business_id = $1 order by uploaded_at, id`, b),
    tx.query(`select * from public.supplier_invoices where business_id = $1 order by created_at, id`, b),
    tx.query(`select * from public.verifications where business_id = $1 order by series, number`, b),
    tx.query(`select * from public.accounting_entries where business_id = $1 order by verification_id, position`, b),
    tx.query(`select * from public.fiscal_years where business_id = $1 order by start_date, id`, b),
    tx.query(`select * from public.vat_reports where business_id = $1 order by period_start, id`, b),
    tx.query(`select * from public.assets where business_id = $1 order by created_at, id`, b),
    tx.query(`select * from public.accruals where business_id = $1 order by created_at, id`, b),
    tx.query(`select * from public.annual_reports where business_id = $1 order by generated_at, id`, b),
  ]);

  const [websiteRows, domainRows, assistantMessageRows, pendingActionRows, reminderRows, attentionStateRows, inboxItemRows, activityRows, auditRows] =
    await Promise.all([
      tx.query(`select * from public.websites where business_id = $1`, b),
      tx.query(`select * from public.domains where business_id = $1 order by created_at, id`, b),
      tx.query(`select * from public.assistant_messages where business_id = $1 order by at, id`, b),
      tx.query(`select * from public.pending_actions where business_id = $1 order by created_at, id`, b),
      tx.query(`select * from public.reminders where business_id = $1 order by due_at, created_at, id`, b),
      tx.query(`select * from public.attention_states where business_id = $1 order by created_at, id`, b),
      tx.query(`select * from public.inbox_items where business_id = $1 order by created_at, id`, b),
      tx.query(
        `select * from public.audit_log where business_id = $1 and channel = 'activity'
         order by created_at desc, id desc limit ${ACTIVITY_LOAD_LIMIT}`,
        b
      ),
      tx.query(
        `select * from public.audit_log where business_id = $1 and channel in ('accounting', 'domain', 'assistant')
         order by created_at, id`,
        b
      ),
    ]);

  // Bostäder per kund (position = visningsordning).
  const locationsByCustomer = new Map<string, SqlRow[]>();
  for (const row of workLocationRows) {
    const key = String(row.customer_id);
    const list = locationsByCustomer.get(key) ?? [];
    list.push(row);
    locationsByCustomer.set(key, list);
  }
  const customers = customerRows.map((row) => {
    const customer = customersSpec.fromRow(row);
    const locations = locationsByCustomer.get(customer.id);
    if (locations && locations.length > 0) {
      customer.workLocations = locations.map(workLocationFromRow);
    }
    return customer;
  });

  // Fakturarader och juridiska snapshots per faktura.
  const linesByInvoice = new Map<string, SqlRow[]>();
  for (const row of invoiceLineRows) {
    const key = String(row.invoice_id);
    const list = linesByInvoice.get(key) ?? [];
    list.push(row);
    linesByInvoice.set(key, list);
  }
  const snapshotByInvoice = new Map<string, SqlRow>();
  for (const row of snapshotRows) snapshotByInvoice.set(String(row.invoice_id), row);

  const invoices = invoiceRows.map((row) => {
    const { amountToPay: _atp, ...invoice } = invoicesSpec.fromRow(row);
    invoice.lines = (linesByInvoice.get(invoice.id) ?? []).map(invoiceLineFromRow);
    const snapshot = snapshotByInvoice.get(invoice.id);
    if (snapshot) {
      invoice.issuedSnapshot = (
        typeof snapshot.snapshot === "string" ? JSON.parse(snapshot.snapshot) : snapshot.snapshot
      ) as NonNullable<typeof invoice.issuedSnapshot>;
    }
    return invoice;
  });

  // Verifikationer med rader i positionsordning.
  const entriesByVerification = new Map<string, SqlRow[]>();
  for (const row of entryRows) {
    const key = String(row.verification_id);
    const list = entriesByVerification.get(key) ?? [];
    list.push(row);
    entriesByVerification.set(key, list);
  }
  const verifications: Verification[] = verificationRows.map((row) =>
    verificationFromRows(row, entriesByVerification.get(String(row.id)) ?? [])
  );

  const sequences = sequenceRows[0];
  const lockedThrough = business.accounting_locked_through;

  const state: DB = {
    settings: settingsFromRow(settingsRows[0]),
    sequences: {
      quote: num(sequences.quote),
      invoice: num(sequences.invoice),
      verification: num(sequences.verification),
    },
    customers,
    requests: requestRows.map(requestsSpec.fromRow),
    quotes: quoteRows.map(quoteFromRow),
    quoteVersions: quoteVersionRows.map(quoteVersionsSpec.fromRow),
    signatures: signatureRows.map(signaturesSpec.fromRow),
    bankidOrders: bankidOrderRows.map(bankidOrdersSpec.fromRow),
    jobs: jobRows.map(jobsSpec.fromRow),
    invoices,
    payments: paymentRows.map(paymentsSpec.fromRow),
    bankAccounts: bankAccountRows.map(bankAccountsSpec.fromRow),
    bankTransactions: bankTxRows.map(bankTransactionsSpec.fromRow),
    expenses: expenseRows.map(expensesSpec.fromRow),
    receipts: receiptRows.map(receiptsSpec.fromRow),
    supplierInvoices: supplierRows.map(supplierInvoicesSpec.fromRow),
    verifications,
    fiscalYears: fiscalYearRows.map(fiscalYearsSpec.fromRow),
    accounting: lockedThrough == null ? {} : { lockedThrough: dateOnly(lockedThrough) },
    vatReports: vatReportRows.map(vatReportsSpec.fromRow),
    assets: assetRows.map(assetsSpec.fromRow),
    accruals: accrualRows.map(accrualsSpec.fromRow),
    auditTrail: auditRows.filter((r) => r.channel === "accounting").map(auditTrailFromAuditRow),
    annualReports: annualReportRows.map(annualReportsSpec.fromRow),
    activity: activityRows.map(activityFromAuditRow),
    website: websiteRows[0] ? websitesSpec.fromRow(websiteRows[0]) : null,
    domains: domainRows.map(domainsSpec.fromRow),
    domainAudit: auditRows.filter((r) => r.channel === "domain").map(domainAuditFromAuditRow),
    assistantMessages: assistantMessageRows.map(assistantMessagesSpec.fromRow),
    pendingActions: pendingActionRows.map(pendingActionsSpec.fromRow),
    assistantAudit: auditRows.filter((r) => r.channel === "assistant").map(assistantAuditFromAuditRow),
    reminders: reminderRows.map(remindersSpec.fromRow),
    attentionStates: attentionStateRows.map(attentionStatesSpec.fromRow),
    inboxItems: inboxItemRows.map(inboxItemsSpec.fromRow),
    meta: metaFromBusinessRow(business),
  };

  return { state, stateVersion: num(business.state_version) };
}
