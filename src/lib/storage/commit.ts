/**
 * Unit-of-work-commit: diffa muterat tillstånd mot baslinjen och skriv ALLT i
 * EN Postgres-transaktion.
 *
 * Invariantägda flöden går via security definer-RPC:erna:
 *   * nya verifikationer      → app.post_verification (CAS på nummerserien,
 *                               balanskontroll i SQL, immutabla rader)
 *   * fakturautfärdanden      → app.issue_invoice (CAS-nummer + frysta rader +
 *                               juridisk snapshot + bokföring, allt eller inget)
 *   * nya betalningar         → app.match_payment (vaktad statusövergång +
 *                               unik banktransaktionsmatchning + bokföring)
 *
 * Allt annat skrivs generiskt (upsert/delete per rad). Samtidighet:
 *   * pg_advisory_xact_lock per företag serialiserar commits.
 *   * state_version-CAS på businesses upptäcker att baslinjen hunnit bli
 *     inaktuell → StorageConflictError → anroparen laddar om och kör igen.
 *
 * Audit-kanalerna är insert-only: aktivitetsflödets 2000-tak i minnet
 * trunkerar ALDRIG databasen.
 */
import type { DB, DocLine, Invoice, Payment, Verification } from "@/lib/types";
import { lineKindOf } from "@/lib/economic-line-type";
import { docTotals } from "@/lib/calc";
import { issuedOcrForInvoice, ocrForInvoice } from "@/lib/ids";
import type { SqlExecutor } from "./executor";
import {
  accrualsSpec,
  activityToAuditRow,
  annualReportsSpec,
  assetsSpec,
  assistantAuditToAuditRow,
  assistantMessagesSpec,
  auditLogColumns,
  auditTrailToAuditRow,
  bankAccountsSpec,
  bankConnectionsSpec,
  chartAccountsSpec,
  bankidOrdersSpec,
  bankTransactionsSpec,
  customersSpec,
  domainAuditToAuditRow,
  domainsSpec,
  expensesSpec,
  fiscalYearsSpec,
  attentionStatesSpec,
  clientInformationRequestsSpec,
  collaborationInvitationsSpec,
  inboxItemsSpec,
  invoiceLineColumns,
  invoiceLineToRow,
  invoicesSpec,
  jobsSpec,
  jobWorkEntriesSpec,
  paymentFilesSpec,
  paymentsSpec,
  pendingActionsSpec,
  remindersSpec,
  quotesSpec,
  quoteVersionsSpec,
  receiptsSpec,
  settingsColumns,
  settingsToRow,
  signaturesSpec,
  supplierInvoicesSpec,
  supplierPaymentsSpec,
  verificationRpcPayload,
  vatReportsSpec,
  websitesSpec,
  workLocationsSpec,
  type TableSpec,
} from "./mappers";

export class StorageConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConflictError";
  }
}

/** Postgres serialiserings-/CAS-fel som ska trigga omkörning. */
export function isRetryableStorageError(err: unknown): boolean {
  if (err instanceof StorageConflictError) return true;
  const code = (err as { code?: string } | null)?.code;
  const message = err instanceof Error ? err.message : "";
  return code === "40001" || code === "40P01" || message.includes("sequence_conflict");
}

/* ------------------------------- SQL-byggare ------------------------------ */

function upsertSql(table: string, columns: string[], pk: string[], protectedColumns: string[] = []): string {
  const cols = columns.join(", ");
  const params = columns.map((_, i) => `$${i + 1}`).join(", ");
  const updatable = columns.filter((c) => !pk.includes(c) && !protectedColumns.includes(c));
  const sets = updatable.map((c) => `${c} = excluded.${c}`).join(", ");
  return `insert into public.${table} (${cols}) values (${params})
    on conflict (${pk.join(", ")}) do update set ${sets}`;
}

async function upsertRow(
  tx: SqlExecutor,
  table: string,
  columns: string[],
  pk: string[],
  row: Record<string, unknown>,
  protectedColumns: string[] = []
): Promise<void> {
  const params = columns.map((c) => row[c] ?? null) as (string | number | boolean | null)[];
  await tx.query(upsertSql(table, columns, pk, protectedColumns), params);
}

/* --------------------------------- Diffning -------------------------------- */

interface CollectionChange<T> {
  upserts: T[];
  deletes: string[];
}

function keyOf<T>(entity: T, keyField: string): string {
  return String((entity as Record<string, unknown>)[keyField]);
}

function diffCollection<T>(baseline: T[], current: T[], keyField = "id"): CollectionChange<T> {
  const baseByKey = new Map<string, string>();
  for (const e of baseline) baseByKey.set(keyOf(e, keyField), JSON.stringify(e));
  const currentKeys = new Set<string>();
  const upserts: T[] = [];
  for (const e of current) {
    const key = keyOf(e, keyField);
    currentKeys.add(key);
    if (baseByKey.get(key) !== JSON.stringify(e)) upserts.push(e);
  }
  const deletes: string[] = [];
  for (const key of baseByKey.keys()) {
    if (!currentKeys.has(key)) deletes.push(key);
  }
  return { upserts, deletes };
}

/** Nya poster (id finns inte i baslinjen) – för insert-only-kanaler. */
function newEntries<T extends { id: string }>(baseline: T[], current: T[]): T[] {
  const baseIds = new Set(baseline.map((e) => e.id));
  return current.filter((e) => !baseIds.has(e.id));
}

function amountToPayForInvoice(inv: Invoice): number {
  if (inv.issuedSnapshot) return inv.issuedSnapshot.totals.toPay;
  return docTotals(inv.lines, inv.rot).toPay;
}

function amountToPayForQuote(state: DB, quoteId: string, currentVersionId: string): number {
  const version = state.quoteVersions.find((v) => v.id === currentVersionId && v.quoteId === quoteId);
  if (!version) return 0;
  return docTotals(version.lines, version.rot).toPay;
}

/* ------------------------------ RPC-payloads ------------------------------- */

/** RPC-payload till app.issue_invoice. number/ocr/id är alltid konkreta JSON-fält. */
export function invoiceRpcPayload(inv: Invoice, businessId: string): Record<string, unknown> {
  const number =
    inv.number != null && Number.isInteger(inv.number) && inv.number >= 1 ? inv.number : null;
  const ocr = number != null ? issuedOcrForInvoice(number, inv.ocr) : "";
  return {
    id: inv.id ?? "",
    business_id: businessId,
    number,
    customer_id: inv.customerId,
    job_id: inv.jobId ?? null,
    quote_id: inv.quoteId ?? null,
    type: inv.type,
    status: inv.status,
    rot: inv.rot ?? null,
    rich_text: inv.richText ?? null,
    tax_reduction_terms: inv.taxReductionTerms ?? null,
    tax_reduction_details: inv.taxReductionDetails ?? null,
    tax_reduction_application: inv.taxReductionApplication ?? null,
    issue_date: inv.issueDate,
    due_date: inv.dueDate,
    payment_terms_days: inv.paymentTermsDays,
    service_date: inv.serviceDate ?? null,
    late_interest_rate: inv.lateInterestRate ?? null,
    issued_at: inv.issuedAt ?? null,
    sent_at: inv.sentAt ?? null,
    last_sent_at: inv.lastSentAt ?? null,
    paid_at: inv.paidAt ?? null,
    reminders: inv.reminders,
    token: inv.token,
    ocr,
    credits_invoice_id: inv.creditsInvoiceId ?? null,
    denied_reduction_of: inv.deniedReductionOf ?? null,
    created_by: inv.createdBy ?? null,
    amount_to_pay: amountToPayForInvoice(inv),
    reverse_charge: inv.reverseCharge === true,
    created_at: inv.createdAt,
  };
}

function linesRpcPayload(lines: DocLine[]): Record<string, unknown>[] {
  return lines.map((l) => ({
    id: l.id,
    kind: lineKindOf(l),
    description: l.description,
    qty: l.qty,
    unit: l.unit,
    unit_price: l.unitPrice,
    vat_rate: l.vatRate,
  }));
}

/* --------------------------------- Commit ---------------------------------- */

export interface CommitOptions {
  businessId: string;
  userId: string | null;
  baseline: DB;
  state: DB;
  stateVersion: number;
}

/**
 * Skriv diffen. Kastar StorageConflictError vid CAS-/sekvenskonflikt –
 * anroparen förväntas ladda om tillståndet och köra om domänlogiken.
 * Måste köras inne i en transaktion där bindTransaction() redan körts.
 */
export async function commitTenantState(tx: SqlExecutor, opts: CommitOptions): Promise<void> {
  const { businessId, userId, baseline, state, stateVersion } = opts;

  // Serialisera commits per företag (minskar CAS-konflikter under last).
  await tx.query(`select pg_advisory_xact_lock(hashtextextended($1, 42))`, [businessId]);

  // Optimistisk låsning: baslinjen måste fortfarande vara aktuell.
  const casRows = await tx.query(
    `update public.businesses
        set state_version = state_version + 1,
            name = $3,
            org_number = $4,
            accounting_locked_through = $5,
            meta = $6::jsonb
      where id = $1 and state_version = $2
      returning state_version`,
    [
      businessId,
      stateVersion,
      state.settings.name,
      state.settings.orgNumber,
      state.accounting.lockedThrough ?? null,
      // meta.demo speglar kolumnen is_demo och skrivs aldrig till jsonb:n.
      JSON.stringify({ ...state.meta, demo: undefined }),
    ]
  );
  if (casRows.length === 0) {
    throw new StorageConflictError(
      "Tillståndet ändrades av en annan begäran (state_version-konflikt). Ladda om och försök igen."
    );
  }

  /* ----- 1. Singletons ----- */

  if (JSON.stringify(baseline.settings) !== JSON.stringify(state.settings)) {
    await upsertRow(
      tx,
      "business_settings",
      settingsColumns,
      ["business_id"],
      settingsToRow(state.settings, businessId),
      ["logo_path", "inbound_mail_slug"]
    );
  }

  // Offertsekvensen ägs av differn (fakturor/verifikationer CAS:as av RPC:erna).
  if (baseline.sequences.quote !== state.sequences.quote) {
    await tx.query(`update public.business_sequences set quote = $2 where business_id = $1`, [
      businessId,
      state.sequences.quote,
    ]);
  }

  /* ----- 2. Generiska föräldratabeller (FK-ordning) ----- */

  const applySpec = async <T>(
    spec: TableSpec<T>,
    change: CollectionChange<T>,
    { skipDeletes = false }: { skipDeletes?: boolean } = {}
  ): Promise<void> => {
    for (const entity of change.upserts) {
      await upsertRow(
        tx,
        spec.table,
        spec.columns,
        spec.pk,
        spec.toRow(entity, businessId),
        spec.protectedColumns ?? []
      );
    }
    if (!skipDeletes) {
      for (const key of change.deletes) {
        await tx.query(`delete from public.${spec.table} where ${spec.pk[0]} = $1 and business_id = $2`, [
          key,
          businessId,
        ]);
      }
    }
  };

  // Kunder + bostäder (bostäder är inbäddade i domänen, egna rader i DB).
  await applySpec(customersSpec, diffCollection(baseline.customers, state.customers));
  const flattenLocations = (dbState: DB) =>
    dbState.customers.flatMap(
      (c) => (c.workLocations ?? []).map((w, i) => ({ ...w, customerId: c.id, position: i }))
    );
  await applySpec(workLocationsSpec, diffCollection(flattenLocations(baseline), flattenLocations(state)));

  // Uppdrag skrivs FÖRE offerter/fakturor: dokumentens job_id valideras av
  // en trigger (document_job_link) som kräver att uppdraget redan finns.
  // Gäller både seed-import och t.ex. offertacceptans som skapar uppdrag +
  // länkar offerten i samma commit. jobs.quote_id saknar FK, så ordningen
  // är säker åt andra hållet.
  await applySpec(jobsSpec, diffCollection(baseline.jobs, state.jobs));

  // Offerter: diffa på domänobjektet, komplettera med denormaliserat belopp.
  {
    const change = diffCollection(baseline.quotes, state.quotes);
    // Beloppet beror på aktuell version – fånga även rena versionsändringar.
    const versionsChanged = new Set(
      diffCollection(baseline.quoteVersions, state.quoteVersions).upserts.map((v) => v.quoteId)
    );
    const extraQuotes = state.quotes.filter(
      (q) => versionsChanged.has(q.id) && !change.upserts.some((u) => u.id === q.id)
    );
    for (const quote of [...change.upserts, ...extraQuotes]) {
      await upsertRow(
        tx,
        quotesSpec.table,
        quotesSpec.columns,
        quotesSpec.pk,
        quotesSpec.toRow(
          { ...quote, amountToPay: amountToPayForQuote(state, quote.id, quote.currentVersionId) },
          businessId
        )
      );
    }
    for (const key of change.deletes) {
      await tx.query(`delete from public.quotes where id = $1 and business_id = $2`, [key, businessId]);
    }
  }

  await applySpec(quoteVersionsSpec, diffCollection(baseline.quoteVersions, state.quoteVersions));
  await applySpec(bankidOrdersSpec, diffCollection(baseline.bankidOrders, state.bankidOrders, "orderRef"));
  await applySpec(signaturesSpec, diffCollection(baseline.signatures, state.signatures));
  await applySpec(bankAccountsSpec, diffCollection(baseline.bankAccounts, state.bankAccounts));
  await applySpec(bankTransactionsSpec, diffCollection(baseline.bankTransactions, state.bankTransactions));
  await applySpec(bankConnectionsSpec, diffCollection(baseline.bankConnections ?? [], state.bankConnections ?? []));
  // Kontoregistret före verifikationerna: ett eget konto måste finnas i
  // registret innan raderna som bokförs på det skrivs.
  await applySpec(chartAccountsSpec, diffCollection(baseline.chartAccounts ?? [], state.chartAccounts ?? []));
  await applySpec(expensesSpec, diffCollection(baseline.expenses, state.expenses));
  await applySpec(receiptsSpec, diffCollection(baseline.receipts, state.receipts));
  await applySpec(supplierInvoicesSpec, diffCollection(baseline.supplierInvoices, state.supplierInvoices));
  // Bankfiler skrivs före betalningarna: supplier_payments.payment_file_id är FK.
  await applySpec(paymentFilesSpec, diffCollection(baseline.paymentFiles ?? [], state.paymentFiles ?? []));
  await applySpec(supplierPaymentsSpec, diffCollection(baseline.supplierPayments ?? [], state.supplierPayments ?? []));
  await applySpec(fiscalYearsSpec, diffCollection(baseline.fiscalYears, state.fiscalYears));
  await applySpec(vatReportsSpec, diffCollection(baseline.vatReports, state.vatReports));
  await applySpec(assetsSpec, diffCollection(baseline.assets, state.assets));
  await applySpec(accrualsSpec, diffCollection(baseline.accruals, state.accruals));
  await applySpec(annualReportsSpec, diffCollection(baseline.annualReports, state.annualReports));
  await applySpec(
    websitesSpec,
    diffCollection(baseline.website ? [baseline.website] : [], state.website ? [state.website] : [])
  );
  await applySpec(domainsSpec, diffCollection(baseline.domains, state.domains));
  await applySpec(assistantMessagesSpec, diffCollection(baseline.assistantMessages, state.assistantMessages));
  await applySpec(pendingActionsSpec, diffCollection(baseline.pendingActions, state.pendingActions));
  await applySpec(remindersSpec, diffCollection(baseline.reminders, state.reminders));
  // Uppmärksamhetstillstånd upserttas alltid (ingen DELETE-väg i DB – mjuk filosofi).
  await applySpec(
    attentionStatesSpec,
    diffCollection(baseline.attentionStates ?? [], state.attentionStates ?? []),
    { skipDeletes: true }
  );
  await applySpec(
    inboxItemsSpec,
    diffCollection(baseline.inboxItems ?? [], state.inboxItems ?? []),
    { skipDeletes: true }
  );
  await applySpec(
    collaborationInvitationsSpec,
    diffCollection(baseline.collaborationInvitations ?? [], state.collaborationInvitations ?? [])
  );
  await applySpec(
    clientInformationRequestsSpec,
    diffCollection(baseline.clientInformationRequests ?? [], state.clientInformationRequests ?? [])
  );

  /* ----- 3. Fakturor: partitionera utfärdanden från vanliga ändringar ----- */

  const baselineInvoices = new Map(baseline.invoices.map((i) => [i.id, i]));
  const invoiceChange = diffCollection(baseline.invoices, state.invoices);

  const issueTransitions: Invoice[] = [];
  const ordinaryInvoiceUpserts: Invoice[] = [];
  for (const inv of invoiceChange.upserts) {
    const base = baselineInvoices.get(inv.id);
    const becameIssued = inv.issuedAt != null && (base == null || base.issuedAt == null);
    (becameIssued ? issueTransitions : ordinaryInvoiceUpserts).push(inv);
  }

  for (const key of invoiceChange.deletes) {
    // Endast utkast kan tas bort (trigger + domänlogik vägrar annat).
    await tx.query(`delete from public.invoice_line_items where invoice_id = $1 and business_id = $2`, [
      key,
      businessId,
    ]);
    await tx.query(`delete from public.invoices where id = $1 and business_id = $2`, [key, businessId]);
  }

  /* ----- 4. RPC-pass: verifikationer + utfärdanden + betalningar i nummerordning ----- */

  // Per serie i nummerordning: CAS:en i post_verification kräver att seriens
  // nästa lediga nummer är exakt det domänen allokerade.
  const newVerifications = newEntries(baseline.verifications, state.verifications).sort(
    (a, b) => a.series.localeCompare(b.series) || a.number - b.number
  );
  const newPayments = newEntries(baseline.payments, state.payments);

  // Verifikationer som konsumeras av issue-/betalnings-RPC:erna.
  const issueByVerificationId = new Map<string, Invoice>();
  for (const inv of issueTransitions) {
    const verification = newVerifications.find(
      (v) => v.source.type === "kundfaktura" && "id" in v.source && v.source.id === inv.id
    );
    if (verification) issueByVerificationId.set(verification.id, inv);
  }
  const paymentByVerificationId = new Map<string, Payment>();
  for (const payment of newPayments) {
    const verification = newVerifications.find(
      (v) => v.source.type === "betalning" && "id" in v.source && v.source.id === payment.id
    );
    if (verification) paymentByVerificationId.set(verification.id, payment);
  }

  const issuedViaRpc = new Set<string>();
  const paymentsViaRpc = new Set<string>();

  const runIssueRpc = async (inv: Invoice, verification: Verification | null): Promise<void> => {
    const base = baselineInvoices.get(inv.id);
    // Utkast har number = null. Domänen ska ha allokerat före commit; om
    // numret ändå saknas (NaN/undef som JSON-null) tar vi nästa lediga här
    // så RPC:n aldrig får issue_invalid. CAS + unikt index fångar kappkörning.
    if (!inv.id) {
      throw new Error("Fakturan kunde inte utfärdas. Försök igen.");
    }
    if (inv.number == null || !Number.isFinite(inv.number)) {
      const number = state.sequences.invoice;
      if (!Number.isInteger(number) || number < 1) {
        throw new Error("Fakturanummer kunde inte tilldelas. Ladda om sidan och försök igen.");
      }
      state.sequences.invoice = number + 1;
      inv.number = number;
      inv.ocr = ocrForInvoice(number);
      if (inv.issuedSnapshot) {
        inv.issuedSnapshot = { ...inv.issuedSnapshot, number, ocr: inv.ocr };
      }
    } else {
      inv.ocr = issuedOcrForInvoice(inv.number, inv.ocr);
      if (inv.issuedSnapshot && !inv.issuedSnapshot.ocr?.trim()) {
        inv.issuedSnapshot = { ...inv.issuedSnapshot, ocr: inv.ocr };
      }
    }
    const allocate = base == null || base.number == null;
    await tx.query(`select app.issue_invoice($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6)`, [
      businessId,
      JSON.stringify(invoiceRpcPayload(inv, businessId)),
      JSON.stringify(linesRpcPayload(inv.lines)),
      // SQL NULL – jsonb-skalären 'null' är "not null" och får jsonb_set att smälla.
      inv.issuedSnapshot ? JSON.stringify(inv.issuedSnapshot) : null,
      verification ? JSON.stringify(verificationRpcPayload(verification)) : null,
      allocate,
    ]);
    issuedViaRpc.add(inv.id);
  };

  const runPaymentRpc = async (payment: Payment, verification: Verification | null): Promise<void> => {
    const invoice = state.invoices.find((i) => i.id === payment.invoiceId);

    // Replay/migrering: fakturan utfärdades i SAMMA commit och bär redan sin
    // slutstatus (t.ex. "betald" från källdatat). Issue-RPC:n har alltså
    // redan skrivit statusfälten – match_payment-vakten har inget kvar att
    // göra. Betalningsraden läggs in direkt och verifikationen bokförs via
    // post_verification – fortfarande i samma transaktion.
    if (invoice && issuedViaRpc.has(invoice.id) && invoice.status !== "skickad") {
      await upsertRow(
        tx,
        paymentsSpec.table,
        paymentsSpec.columns,
        paymentsSpec.pk,
        paymentsSpec.toRow(payment, businessId)
      );
      if (verification) {
        await tx.query(`select app.post_verification($1, $2::jsonb)`, [
          businessId,
          JSON.stringify(verificationRpcPayload(verification)),
        ]);
      }
      paymentsViaRpc.add(payment.id);
      return;
    }

    // Domänen har räknat fram målstatus ('betald'/'delbetald' – öres-tolerans,
    // delbetalning, överbetalning); RPC:n vaktar övergången i SQL.
    const targetStatus = invoice?.status === "delbetald" ? "delbetald" : "betald";
    await tx.query(`select app.match_payment($1, $2::jsonb, $3::jsonb, $4::jsonb)`, [
      businessId,
      JSON.stringify({
        id: payment.id,
        invoice_id: payment.invoiceId,
        bank_transaction_id: payment.bankTransactionId ?? null,
        amount: payment.amount,
        date: payment.date,
        status: targetStatus,
        paid_at: invoice?.paidAt ?? payment.date,
        overpayment_credit: invoice?.overpaymentCredit ?? 0,
        matched_by: payment.matchedBy,
      }),
      null, // banktransaktionen uppdateras av den generiska diffen (samma tx)
      verification ? JSON.stringify(verificationRpcPayload(verification)) : null,
    ]);
    paymentsViaRpc.add(payment.id);
  };

  // Kör i verifikationsnummerordning så att CAS:en alltid ser nästa lediga nummer.
  for (const verification of newVerifications) {
    const issueInvoice = issueByVerificationId.get(verification.id);
    if (issueInvoice) {
      await runIssueRpc(issueInvoice, verification);
      continue;
    }
    const payment = paymentByVerificationId.get(verification.id);
    if (payment) {
      await runPaymentRpc(payment, verification);
      continue;
    }
    await tx.query(`select app.post_verification($1, $2::jsonb)`, [
      businessId,
      JSON.stringify(verificationRpcPayload(verification)),
    ]);
  }

  // Utfärdanden/betalningar utan egen verifikation i denna commit (ovanligt,
  // t.ex. migrerad historik) – kör efteråt.
  for (const inv of issueTransitions) {
    if (!issuedViaRpc.has(inv.id)) await runIssueRpc(inv, null);
  }
  for (const payment of newPayments) {
    if (!paymentsViaRpc.has(payment.id)) await runPaymentRpc(payment, null);
  }

  // Vanliga fakturaändringar skrivs EFTER RPC-passet: betalnings-RPC:ns
  // vaktade statusövergång (skickad→betald) måste se den ursprungliga raden.
  // Den efterföljande upserten skriver samma slutvärden (no-op för RPC-ägda
  // fält) – triggern tillåter statusfälten och ser inga frysta diffar.
  for (const inv of ordinaryInvoiceUpserts) {
    await upsertRow(
      tx,
      invoicesSpec.table,
      invoicesSpec.columns,
      invoicesSpec.pk,
      invoicesSpec.toRow({ ...inv, amountToPay: amountToPayForInvoice(inv) }, businessId)
    );
    // Rader: ersätt vid ändring. Utfärdade fakturors rader är frysta – en
    // ändring är en bugg och ska smälla högt, inte tappas tyst.
    const base = baselineInvoices.get(inv.id);
    if (!base || JSON.stringify(base.lines) !== JSON.stringify(inv.lines)) {
      if (inv.issuedAt != null) {
        throw new Error(
          `immutability: rader på utfärdad faktura ${inv.id} kan inte ändras – korrigera med kreditfaktura.`
        );
      }
      await tx.query(`delete from public.invoice_line_items where invoice_id = $1 and business_id = $2`, [
        inv.id,
        businessId,
      ]);
      for (const [position, line] of inv.lines.entries()) {
        await upsertRow(
          tx,
          "invoice_line_items",
          invoiceLineColumns,
          ["invoice_id", "id"],
          invoiceLineToRow(line, businessId, inv.id, position)
        );
      }
    }
  }

  // Efter fakturor: invoice_id på actuals pekar på rader som nu finns.
  await applySpec(
    jobWorkEntriesSpec,
    diffCollection(baseline.jobWorkEntries ?? [], state.jobWorkEntries ?? [])
  );

  // Rättelsestämpel: enda tillåtna ändringen på en bokförd verifikation.
  {
    const baseVerifications = new Map(baseline.verifications.map((v) => [v.id, v]));
    for (const v of state.verifications) {
      const base = baseVerifications.get(v.id);
      if (base && base.correctedByVerificationId == null && v.correctedByVerificationId != null) {
        await tx.query(
          `update public.verifications set corrected_by_verification_id = $2 where id = $1 and business_id = $3`,
          [v.id, v.correctedByVerificationId, businessId]
        );
      }
    }
  }

  /* ----- 5. Betalningsrader som redan finns ändras aldrig; men äldre flöden
             kan uppdatera matched_by? Nej – payments är append-only i domänen.
             Audit-kanalerna: insert-only. ----- */

  const auditRows: Record<string, unknown>[] = [
    ...newEntries(baseline.activity, state.activity).map((e) => activityToAuditRow(e, businessId, userId)),
    ...newEntries(baseline.auditTrail, state.auditTrail).map((e) => auditTrailToAuditRow(e, businessId, userId)),
    ...newEntries(baseline.domainAudit, state.domainAudit).map((e) =>
      domainAuditToAuditRow(e, businessId, userId)
    ),
    ...newEntries(baseline.assistantAudit, state.assistantAudit).map((e) =>
      assistantAuditToAuditRow(e, businessId, userId)
    ),
  ];
  for (const row of auditRows) {
    const params = auditLogColumns.map((c) => row[c] ?? null) as (string | number | boolean | null)[];
    await tx.query(
      `insert into public.audit_log (${auditLogColumns.join(", ")})
       values (${auditLogColumns.map((_, i) => `$${i + 1}`).join(", ")})
       on conflict (id) do nothing`,
      params
    );
  }
}
