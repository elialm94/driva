import { db, save } from "../store";
import { uid, publicToken, ocrForInvoice } from "../ids";
import type { DocLine, Invoice, QuoteVersion, RotRut, TaxReductionDetails, TaxReductionTermsSnapshot, VatRate, Verification } from "../types";
import type { RichTextDoc } from "../richtext";
import { sanitizeRichText } from "../richtext";
import {
  currentVersion,
  getInvoice,
  getJob,
  getQuote,
  invoiceCreditedAmount,
  invoiceOutstanding,
  invoicePaidAmount,
  invoiceTotals,
  jobQuote,
  quoteSignature,
  requireCustomer,
} from "./data";
import { docTotals, vatBreakdown } from "../calc";
import {
  entriesCredit,
  entriesCustomerRefund,
  entriesDeniedReductionCredit,
  entriesDeniedReductionInvoice,
  entriesInvoicePaymentReceived,
  entriesInvoiceSent,
} from "../bas";
import { ORE_TOLERANS_KR, verificationConfidence } from "../autopilot";
import { kr, isoDaysFromNow } from "../format";
import { logActivity } from "./activity";
import { logAudit } from "../accounting/audit";
import { nextPaymentPlanPartForJob, remainingToInvoiceForJob } from "./attention";
import { buildIssuedSnapshot } from "../invoices/snapshot";
import { assertInvoiceReadyToIssue, collectIssueErrors, InvoiceNotReadyError } from "../invoices/validate";
import { invoiceNumberLabel } from "../invoices/display";
import { snapshotTaxReductionTerms } from "../tax-reduction-terms";
import { rotWithAmounts } from "../tax-reduction-amount";
import { syncDocLineClassification } from "../economic-line-type";
import { postVerification } from "../accounting/engine";
import {
  detailsFromPrefill,
  mergeHousing,
  persistTaxReductionOwnership,
  resolveTaxReductionPrefill,
} from "./tax-reduction";
import { resolvePersistedWorkLocationId } from "../tax-reduction-send";
import { getWorkLocation, workLocationsOf, workLocationToHousing } from "./work-locations";
import {
  associateEntriesWithInvoice,
  entryToDocLine,
  unlinkJobWorkEntriesFromInvoice,
  uninvoicedActuals,
} from "./job-work";
import {
  lineWithPaymentPlanProvenance,
  lineWithQuoteProvenance,
  liveInvoicesForQuote,
  nextPaymentPlanPartForQuote,
  paymentPlanPartAlreadyInvoiced,
} from "./business-chain";

export type Actor = "anvandare" | "assistent";

/**
 * All bokföring går genom den centrala motorn (accounting/engine.ts):
 * balansvalidering, atomär nummertilldelning, periodlås och audit trail.
 */
function addVerification(
  v: Pick<Verification, "date" | "description" | "entries" | "source" | "confidence" | "createdBy"> & {
    explanation?: string;
  }
): Verification {
  return postVerification({
    date: v.date,
    description: v.description,
    entries: v.entries,
    source: v.source,
    confidence: v.confidence,
    createdBy: v.createdBy,
    explanation: v.explanation,
  });
}

/**
 * Allokera nästa fakturanummer. En enda funktion – synkron read-modify-write
 * så att två sekventiella (och i Node även parallella Promise.all av synk kod)
 * anrop aldrig får samma nummer. I Supabase-läget CAS:as samma nummer sedan
 * mot business_sequences i app.issue_invoice (radlås); förloraren retrys.
 */
function allocateNextInvoiceNumber(): number {
  const data = db();
  const number = data.sequences.invoice;
  if (!Number.isInteger(number) || number < 1) {
    throw new Error("Fakturanummer kunde inte tilldelas. Ladda om sidan och försök igen.");
  }
  data.sequences.invoice = number + 1;
  return number;
}

function assignInvoiceNumberAndOcr(invoice: Invoice): { number: number; ocr: string; allocatedNew: boolean } {
  const allocatedNew = invoice.number == null || !Number.isFinite(invoice.number);
  const number = allocatedNew ? allocateNextInvoiceNumber() : invoice.number!;
  const ocr = !allocatedNew && invoice.ocr ? invoice.ocr : ocrForInvoice(number);
  if (!Number.isInteger(number) || number < 1 || !ocr) {
    throw new Error("Fakturan kunde inte utfärdas utan nummer och OCR. Försök igen.");
  }
  return { number, ocr, allocatedNew };
}

function cloneLines(lines: DocLine[]): DocLine[] {
  return lines.map((l) => syncDocLineClassification({ ...l }));
}

function signedTaxReductionTerms(quoteId: string | undefined, type: RotRut["type"]): TaxReductionTermsSnapshot | null {
  if (!quoteId) return null;
  const quote = getQuote(quoteId);
  if (!quote || quote.status !== "godkand") return null;
  const signature = quoteSignature(quote.id);
  if (!signature) return null;
  const version = db().quoteVersions.find((v) => v.id === signature.quoteVersionId);
  if (!version?.lockedAt || !version.taxReductionTerms) return null;
  if (version.taxReductionTerms.type !== type) return null;
  return { ...version.taxReductionTerms };
}

function invoiceTaxReductionFields(
  rot: RotRut | null,
  lines: DocLine[],
  quoteId?: string,
  inheritFrom?: RotRut | null,
  mode: "strict" | "clamp" = "clamp"
): { rot: RotRut | null; taxReductionTerms: TaxReductionTermsSnapshot | null } {
  if (!rot) return { rot: null, taxReductionTerms: null };
  let inherit = inheritFrom ?? null;
  if (inherit == null && quoteId && rot.appliedTaxReduction == null) {
    const quote = getQuote(quoteId);
    if (quote) inherit = currentVersion(quote).rot;
  }
  const resolved = rotWithAmounts(rot, lines, {
    inheritFrom: inherit,
    mode,
    documentKind: "faktura",
  });
  return {
    rot: resolved,
    taxReductionTerms: signedTaxReductionTerms(quoteId, rot.type) ?? snapshotTaxReductionTerms(rot.type),
  };
}

function applyTaxReductionContext(
  invoice: Invoice,
  input: {
    rot: RotRut | null;
    taxReductionDetails?: TaxReductionDetails | null;
    personalIdentityNumber?: string;
  }
): void {
  if (!input.rot) {
    invoice.taxReductionDetails = null;
    return;
  }
  const customer = requireCustomer(invoice.customerId);
  persistInvoiceWorkLocation(invoice, customer, invoice.workLocationId);
  const prefill = resolveTaxReductionPrefill({
    customerId: invoice.customerId,
    jobId: invoice.jobId,
    details: input.taxReductionDetails ?? invoice.taxReductionDetails,
  });
  // Bostaden som är vald på JUST den här fakturan är basen för dokumentets
  // fastighetsuppgifter – kundens standardbostad får aldrig frysa fel
  // fastighet i snapshoten. Explicit ifyllda fält vinner över basen.
  const selectedLocation = getWorkLocation(customer, invoice.workLocationId);
  const baseHousing = selectedLocation ? workLocationToHousing(selectedLocation) : prefill.housing;
  const details = detailsFromPrefill({
    ...prefill,
    workAddress: input.taxReductionDetails?.workAddress ?? prefill.workAddress,
    workPeriodStart: input.taxReductionDetails?.workPeriodStart ?? prefill.workPeriodStart,
    workPeriodEnd: input.taxReductionDetails?.workPeriodEnd ?? prefill.workPeriodEnd,
    housing: input.taxReductionDetails?.housing
      ? mergeHousing(baseHousing, input.taxReductionDetails.housing)
      : baseHousing,
  });
  invoice.taxReductionDetails = details;
  persistTaxReductionOwnership({
    customerId: invoice.customerId,
    jobId: invoice.jobId,
    personalIdentityNumber: input.personalIdentityNumber,
    details,
  });
  if (!invoice.serviceDate && invoice.rot) {
    invoice.serviceDate = details.workPeriodEnd || details.workPeriodStart || undefined;
  }
}

function persistInvoiceWorkLocation(
  invoice: Invoice,
  customer: ReturnType<typeof requireCustomer>,
  requested?: string | null
): void {
  const workLocationId = resolvePersistedWorkLocationId({
    taxReduction: invoice.rot,
    workLocationId: requested,
    customerWorkLocationIds: workLocationsOf(customer).map((location) => location.id),
  });
  if (workLocationId) invoice.workLocationId = workLocationId;
  else delete invoice.workLocationId;
}

function inheritedQuoteWorkLocationId(quoteId?: string): string | undefined {
  if (!quoteId) return undefined;
  return getQuote(quoteId)?.workLocationId;
}

export interface InvoiceInput {
  customerId: string;
  jobId?: string;
  quoteId?: string;
  /** Bostad som ROT/RUT på fakturan gäller. Ärvs från offerten om den redan är sparad där. */
  workLocationId?: string;
  type: Invoice["type"];
  lines: DocLine[];
  rot: RotRut | null;
  dueInDays?: number;
  lateInterestRate?: number;
  serviceDate?: string;
  taxReductionDetails?: TaxReductionDetails | null;
  personalIdentityNumber?: string;
  /** "Övrig information" – saneras alltid serverside (vitlista, se lib/richtext). */
  richText?: RichTextDoc;
  paymentPlanIndex?: number;
}

export function createInvoice(input: InvoiceInput, createdBy: Actor = "anvandare"): Invoice {
  const data = db();
  const customer = requireCustomer(input.customerId);
  if (input.jobId) {
    const job = getJob(input.jobId);
    if (!job) throw new Error("Uppdraget finns inte");
    if (job.customerId !== input.customerId) {
      throw new Error("Dokumentet kan bara kopplas till ett uppdrag för samma kund");
    }
  }
  const now = new Date().toISOString();
  const paymentTermsDays = input.dueInDays ?? data.settings.paymentTermsDays;
  const invoice: Invoice = {
    id: uid(),
    number: null,
    customerId: input.customerId,
    jobId: input.jobId,
    quoteId: input.quoteId,
    workLocationId: input.workLocationId ?? inheritedQuoteWorkLocationId(input.quoteId),
    type: input.type,
    status: "utkast",
    lines: cloneLines(input.lines),
    richText: sanitizeRichText(input.richText),
    ...invoiceTaxReductionFields(input.rot, input.lines, input.quoteId),
    taxReductionDetails: null,
    issueDate: now,
    dueDate: isoDaysFromNow(paymentTermsDays),
    paymentTermsDays,
    serviceDate: input.serviceDate,
    lateInterestRate: input.lateInterestRate ?? data.settings.lateInterestRate,
    reminders: [],
    token: publicToken(),
    ocr: "",
    createdBy,
    createdAt: now,
  };
  if (input.paymentPlanIndex != null) invoice.paymentPlanIndex = input.paymentPlanIndex;
  applyTaxReductionContext(invoice, input);
  data.invoices.push(invoice);
  logActivity(`Fakturautkast skapades för ${customer.name}.`, {
    customerId: customer.id,
    entity: { type: "faktura", id: invoice.id },
    createdBy,
  });
  save();
  return invoice;
}

export interface InvoiceUpdateInput {
  lines: DocLine[];
  rot: RotRut | null;
  workLocationId?: string | null;
  dueInDays?: number;
  lateInterestRate?: number;
  serviceDate?: string | null;
  taxReductionDetails?: TaxReductionDetails | null;
  personalIdentityNumber?: string;
  /** "Övrig information" – saneras alltid serverside (vitlista, se lib/richtext). */
  richText?: RichTextDoc;
}

/** Uppdatera ett fakturautkast. Skickade, betalda och krediterade fakturor får inte ändras. */
export function updateInvoice(invoiceId: string, input: InvoiceUpdateInput, createdBy: Actor = "anvandare"): Invoice {
  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new Error("Fakturan finns inte");
  if (invoice.status !== "utkast") {
    throw new Error("Bara utkast kan redigeras. Skickade fakturor korrigeras med kreditfaktura.");
  }

  invoice.lines = cloneLines(input.lines);
  invoice.richText = sanitizeRichText(input.richText);
  if (input.workLocationId !== undefined) {
    invoice.workLocationId = input.workLocationId || undefined;
  }
  Object.assign(
    invoice,
    invoiceTaxReductionFields(
      input.rot,
      input.lines,
      invoice.quoteId,
      invoice.rot,
      input.rot?.appliedTaxReduction != null ? "strict" : "clamp"
    )
  );
  applyTaxReductionContext(invoice, input);
  if (input.dueInDays != null) {
    invoice.paymentTermsDays = input.dueInDays;
    invoice.dueDate = isoDaysFromNow(input.dueInDays);
  }
  if (input.lateInterestRate != null) {
    invoice.lateInterestRate = input.lateInterestRate;
  }
  if (input.serviceDate !== undefined) {
    invoice.serviceDate = input.serviceDate || undefined;
  }

  const customer = requireCustomer(invoice.customerId);
  logActivity(`Fakturautkast ${invoiceNumberLabel(invoice)} uppdaterades.`, {
    customerId: customer.id,
    entity: { type: "faktura", id: invoice.id },
    createdBy,
  });
  save();
  return invoice;
}

function serviceDateFromJob(jobId: string | undefined): string | undefined {
  if (!jobId) return undefined;
  const job = getJob(jobId);
  if (!job) return undefined;
  return (job.completedAt || job.endDate || job.startDate || "").slice(0, 10) || undefined;
}

function rotFromJob(jobId: string | undefined): RotRut | null {
  if (!jobId) return null;
  const job = getJob(jobId);
  if (!job) return null;
  const quote = jobQuote(job);
  const fromQuote = quote ? currentVersion(quote).rot : null;
  if (fromQuote) return fromQuote;
  const prev = db().invoices.find(
    (i) => i.jobId === job.id && i.rot && i.type !== "kredit" && i.status !== "krediterad"
  );
  return prev?.rot ?? null;
}

/** Slutfaktura för ett uppdrag – resterande belopp enligt den godkända offerten. */
export function createFinalInvoiceForJob(jobId: string, createdBy: Actor = "anvandare"): Invoice {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const remaining = remainingToInvoiceForJob(jobId);
  const quote = jobQuote(job);
  const data = db();
  const serviceDate = serviceDateFromJob(jobId);

  if (quote?.status === "godkand") {
    const version = currentVersion(quote);
    const alreadyInvoiced = data.invoices.some(
      (i) => i.jobId === jobId && i.status !== "krediterad" && i.type !== "kredit"
    );
    if (!alreadyInvoiced) {
      return createInvoice(
        {
          customerId: job.customerId,
          jobId,
          quoteId: quote.id,
          type: "slutfaktura",
          lines: version.lines.map((l) =>
            syncDocLineClassification(lineWithQuoteProvenance({ ...l, id: uid() }, quote, l.id))
          ),
          rot: version.rot,
          dueInDays: version.paymentTermsDays,
          lateInterestRate: version.lateInterestRate,
          serviceDate,
        },
        createdBy
      );
    }
    return createInvoice(
      {
        customerId: job.customerId,
        jobId,
        quoteId: quote.id,
        type: "slutfaktura",
        lines: shareLinesFromVersion(
          version,
          remaining,
          `Slutfaktura – ${job.title} (resterande enligt offert #${quote.number})`
        ).map((l) => lineWithQuoteProvenance(l, quote)),
        rot: rotFromJob(jobId),
        dueInDays: version.paymentTermsDays,
        lateInterestRate: version.lateInterestRate,
        serviceDate,
      },
      createdBy
    );
  }

  return createInvoiceFromJobActuals(jobId, createdBy);
}

export type { JobInvoiceBasis } from "../job-ui-types";
import type { JobInvoiceBasis } from "../job-ui-types";

/** Tomt utkast: kund, uppdrag och ROT/RUT ifyllt. Inga rader. */
export function createEmptyInvoiceForJob(jobId: string, createdBy: Actor = "anvandare"): Invoice {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const quote = jobQuote(job);
  const approved = quote?.status === "godkand" ? quote : undefined;
  const version = approved ? currentVersion(approved) : undefined;
  return createInvoice(
    {
      customerId: job.customerId,
      jobId,
      quoteId: approved?.id,
      type: "faktura",
      lines: [],
      rot: rotFromJob(jobId),
      dueInDays: version?.paymentTermsDays,
      lateInterestRate: version?.lateInterestRate,
      serviceDate: serviceDateFromJob(jobId),
    },
    createdBy
  );
}

/** Utkast från ofakturerade actuals. Aldrig autoutskick. */
export function createInvoiceFromJobActuals(
  jobId: string,
  createdBy: Actor = "anvandare",
  entryIds?: string[]
): Invoice {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const quote = jobQuote(job);
  const approved = quote?.status === "godkand" ? quote : undefined;
  const available = uninvoicedActuals(jobId);
  const selected = entryIds?.length ? available.filter((e) => entryIds.includes(e.id)) : available;
  if (selected.length === 0) throw new Error("Det finns inget ofakturerat arbete att fakturera");
  const version = approved ? currentVersion(approved) : undefined;
  const invoice = createInvoice(
    {
      customerId: job.customerId,
      jobId,
      quoteId: approved?.id,
      type: "faktura",
      lines: selected.map((e) => entryToDocLine(e, approved?.number)),
      rot: rotFromJob(jobId),
      dueInDays: version?.paymentTermsDays,
      lateInterestRate: version?.lateInterestRate,
      serviceDate: serviceDateFromJob(jobId),
    },
    createdBy
  );
  associateEntriesWithInvoice(
    selected.map((e) => e.id),
    invoice.id
  );
  return invoice;
}

/** Avtalad offert (nästa del/rest) plus ofakturerade tillägg. */
export function createInvoiceFromQuotePlusExtras(jobId: string, createdBy: Actor = "anvandare"): Invoice {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const extras = uninvoicedActuals(jobId).filter((e) => e.isExtra);
  const remaining = remainingToInvoiceForJob(jobId);
  const quote = jobQuote(job);

  if (quote?.status === "godkand" && remaining > 0) {
    const invoice = createNextInvoiceForJob(jobId, createdBy);
    if (extras.length > 0) {
      invoice.lines = [...invoice.lines, ...extras.map((e) => entryToDocLine(e, quote?.number))];
      Object.assign(
        invoice,
        invoiceTaxReductionFields(invoice.rot, invoice.lines, invoice.quoteId, invoice.rot)
      );
      associateEntriesWithInvoice(
        extras.map((e) => e.id),
        invoice.id
      );
      save();
    }
    return invoice;
  }
  if (extras.length === 0) {
    const all = uninvoicedActuals(jobId);
    if (all.length === 0) throw new Error("Det finns inget att fakturera");
    return createInvoiceFromJobActuals(jobId, createdBy);
  }
  return createInvoiceFromJobActuals(
    jobId,
    createdBy,
    extras.map((e) => e.id)
  );
}

export function createInvoiceForJob(
  jobId: string,
  basis: JobInvoiceBasis,
  createdBy: Actor = "anvandare"
): Invoice {
  if (basis === "quote") {
    const job = getJob(jobId);
    const quote = job ? jobQuote(job) : undefined;
    if (!quote || quote.status !== "godkand") {
      throw new Error(
        "Offerten är inte godkänd. Fakturera registrerat arbete eller skapa en tom faktura."
      );
    }
    return createNextInvoiceForJob(jobId, createdBy);
  }
  if (basis === "quote_plus_extras") return createInvoiceFromQuotePlusExtras(jobId, createdBy);
  if (basis === "empty") return createEmptyInvoiceForJob(jobId, createdBy);
  return createInvoiceFromJobActuals(jobId, createdBy);
}

/**
 * Rader för en klumpsumma som ärver ett radsets momssats(er).
 * Enhetlig momssats → en rad med rätt sats. Blandade satser → en rad per sats,
 * proportionell mot satsens andel av underlaget, så momsredovisningen blir rätt.
 * Delas av delbetalningar (offertens rader) och delkrediter (fakturans rader).
 */
function shareLines(
  sourceLines: DocLine[],
  sourceRot: RotRut | null,
  amountInclVat: number,
  description: string,
  kind: DocLine["kind"] = "arbete"
): DocLine[] {
  const rates: VatRate[] = [...new Set(sourceLines.map((l) => l.vatRate))];
  if (rates.length <= 1) {
    const rate: VatRate = rates[0] ?? 25;
    return [
      syncDocLineClassification({
        id: uid(),
        kind,
        description,
        qty: 1,
        unit: "st",
        unitPrice: Math.round(amountInclVat / (1 + rate / 100)),
        vatRate: rate,
      }),
    ];
  }
  const totals = docTotals(sourceLines, sourceRot);
  return vatBreakdown(sourceLines)
    .filter((row) => row.base + row.vat > 0)
    .map((row) =>
      syncDocLineClassification({
        id: uid(),
        kind,
        description: `${description} – andel med ${row.rate} % moms`,
        qty: 1,
        unit: "st",
        unitPrice: Math.round((row.base * amountInclVat) / totals.total),
        // vatBreakdown grupperar på radernas momssatser, så raten är alltid en giltig VatRate.
        vatRate: row.rate as VatRate,
      })
    );
}

function shareLinesFromVersion(version: QuoteVersion, amountInclVat: number, description: string): DocLine[] {
  return shareLines(version.lines, version.rot, amountInclVat, description);
}

/** Nästa faktura för uppdraget: del enligt betalningsplanen, annars resterande som slutfaktura. */
export function createNextInvoiceForJob(jobId: string, createdBy: Actor = "anvandare"): Invoice {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  if (job.status !== "klart") {
    const quote = jobQuote(job);
    const next = nextPaymentPlanPartForJob(jobId);
    if (quote?.status === "godkand" && next && !next.isLast) {
      return createPartInvoiceForQuote(quote.id, next.index, createdBy);
    }
  }
  return createFinalInvoiceForJob(jobId, createdBy);
}

/** Delbetalning (deposition/förskott) enligt offertens betalningsplan. */
export function createPartInvoiceForQuote(quoteId: string, partIndex: number, createdBy: Actor = "anvandare"): Invoice {
  const quote = getQuote(quoteId);
  if (!quote) throw new Error("Offerten finns inte");
  const version = currentVersion(quote);
  const part = version.paymentPlan[partIndex];
  if (!part) throw new Error("Delbetalningen finns inte i betalningsplanen");
  if (paymentPlanPartAlreadyInvoiced(quoteId, partIndex)) {
    throw new Error(`Delbetalning ${partIndex + 1} är redan fakturerad`);
  }
  const totals = docTotals(version.lines, version.rot);
  const partInkl = Math.round((totals.total * part.percent) / 100);
  return createInvoice(
    {
      customerId: quote.customerId,
      jobId: quote.jobId,
      quoteId: quote.id,
      type: "delbetalning",
      lines: shareLinesFromVersion(
        version,
        partInkl,
        `Delbetalning ${partIndex + 1} av ${version.paymentPlan.length} – ${version.title} (${part.percent} % ${part.label.toLowerCase()})`
      ).map((l) => lineWithPaymentPlanProvenance(l, quote, partIndex)),
      rot: null,
      dueInDays: Math.min(version.paymentTermsDays, 14),
      lateInterestRate: version.lateInterestRate,
      serviceDate: serviceDateFromJob(quote.jobId),
      paymentPlanIndex: partIndex,
    },
    createdBy
  );
}

/**
 * Faktura direkt från godkänd offert – skapar inte uppdrag.
 * Tar nästa del i betalningsplanen om det finns en, annars hela offerten.
 */
export function createInvoiceFromQuote(quoteId: string, createdBy: Actor = "anvandare"): Invoice {
  const quote = getQuote(quoteId);
  if (!quote) throw new Error("Offerten finns inte");
  if (quote.status !== "godkand") {
    throw new Error("Bara godkända offerter kan faktureras utan uppdrag");
  }
  const next = nextPaymentPlanPartForQuote(quoteId);
  if (next && !next.isLast) {
    return createPartInvoiceForQuote(quoteId, next.index, createdBy);
  }
  const version = currentVersion(quote);
  const live = liveInvoicesForQuote(quoteId);
  const already = live.reduce((s, i) => s + invoiceTotals(i).total, 0);
  const totals = docTotals(version.lines, version.rot);
  const remaining = Math.max(0, totals.total - already);
  if (remaining <= 0 && live.length > 0) {
    throw new Error("Hela offerten är redan fakturerad");
  }
  const lines =
    already > 0
      ? shareLinesFromVersion(version, remaining, `Slutfaktura – ${version.title} (resterande enligt offert #${quote.number})`).map(
          (l) => lineWithQuoteProvenance(l, quote)
        )
      : version.lines.map((l) => lineWithQuoteProvenance({ ...l, id: uid() }, quote, l.id));
  return createInvoice(
    {
      customerId: quote.customerId,
      jobId: quote.jobId,
      quoteId: quote.id,
      type: already > 0 ? "slutfaktura" : "faktura",
      lines,
      rot: version.rot,
      dueInDays: version.paymentTermsDays,
      lateInterestRate: version.lateInterestRate,
      serviceDate: serviceDateFromJob(quote.jobId),
    },
    createdBy
  );
}

function freezeIssue(invoice: Invoice, opts: { number: number; ocr: string; issuedAt: string; creditsInvoiceNumber?: number }) {
  const data = db();
  const customer = requireCustomer(invoice.customerId);
  invoice.number = opts.number;
  invoice.ocr = opts.ocr;
  invoice.issuedAt = opts.issuedAt;
  invoice.issueDate = opts.issuedAt;
  invoice.dueDate = isoDaysFromNow(invoice.paymentTermsDays);
  invoice.lines = cloneLines(invoice.lines);
  invoice.issuedSnapshot = buildIssuedSnapshot({
    invoice,
    seller: data.settings,
    buyer: customer,
    issuedAt: opts.issuedAt,
    number: opts.number,
    ocr: opts.ocr,
    creditsInvoiceNumber: opts.creditsInvoiceNumber,
  });
}

/**
 * Utfärda fakturan: validera, tilldela nummer, frys snapshot, bokför.
 * Idempotent om den redan är utfärdad. Allokerar aldrig från klienten.
 */
export function issueInvoice(invoiceId: string, createdBy: Actor = "anvandare"): Invoice {
  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new Error("Fakturan finns inte");
  if (invoice.status !== "utkast") return invoice;

  assertInvoiceReadyToIssue(invoiceId);

  const customer = requireCustomer(invoice.customerId);
  const now = new Date().toISOString();
  const { number, ocr, allocatedNew } = assignInvoiceNumberAndOcr(invoice);

  freezeIssue(invoice, { number, ocr, issuedAt: now });
  invoice.status = "skickad";
  if (invoice.number == null || !invoice.ocr) {
    throw new Error("Fakturan kunde inte utfärdas utan nummer och OCR. Försök igen.");
  }

  addVerification({
    date: now,
    description: `Faktura #${number} – ${customer.name}`,
    // Restfaktura för nekat ROT/RUT: fordran flyttas 1513 → 1510. Intäkten och
    // momsen bokfördes redan på ursprungsfakturan och får inte bokas igen.
    entries: invoice.deniedReductionOf
      ? entriesDeniedReductionInvoice(invoiceTotals(invoice).toPay)
      : entriesInvoiceSent(invoice.lines, invoice.rot),
    source: { type: "kundfaktura", id: invoice.id },
    confidence: "hog",
    createdBy: createdBy === "assistent" ? "assistent" : "auto",
    explanation: invoice.deniedReductionOf
      ? "Skatteverket nekade (en del av) ROT/RUT-utbetalningen, så fordran flyttades från Skatteverket till kunden. Ingen ny intäkt eller moms bokförs – de redovisades när ursprungsfakturan utfärdades."
      : `Fakturan bokfördes när den utfärdades (faktureringsmetoden): kundfordran mot intäkt och utgående moms. Beloppen kommer direkt från fakturan${invoice.rot ? `, och ${invoice.rot.type.toUpperCase()}-delen ligger som fordran på Skatteverket tills den betalas ut` : ""}.`,
  });

  if (allocatedNew) {
    logActivity(`Faktura #${number} fick löpnummer och OCR ${ocr}.`, {
      customerId: customer.id,
      entity: { type: "faktura", id: invoice.id },
      createdBy,
    });
  }
  logAudit(createdBy, "faktura_utfardad", `Faktura #${number} utfärdades för ${customer.name} (${kr(invoiceTotals(invoice).toPay)}).`, {
    targetType: "faktura",
    targetId: invoice.id,
  });
  logActivity(`Faktura #${number} utfärdades för ${customer.name} (${kr(invoiceTotals(invoice).toPay)}).`, {
    customerId: customer.id,
    entity: { type: "faktura", id: invoice.id },
    createdBy,
  });
  save();
  return invoice;
}

/** Leveransutfall från e-postlagret. Produktionsvägen anropar bara hit efter provider-succé. */
export interface InvoiceDeliveryInfo {
  /** "demo": demoföretagets utskick – simulerat eller till DEMO_EMAIL_SINK. */
  mode: "mock" | "live" | "test" | "demo";
  ok: boolean;
  messageId?: string;
  sentTo?: string;
}

const MOCK_DELIVERY: InvoiceDeliveryInfo = { mode: "mock", ok: true };

/**
 * Registrera leverans av en utfärdad faktura. E-posten skickas av
 * document-mail.ts – här uppdateras tillstånd och aktivitet ärligt:
 * "skickades med e-post" bara när ett riktigt mejl gått iväg.
 * Misslyckande får inte rulla tillbaka nummer eller skapa ny faktura.
 */
export function deliverInvoice(
  invoiceId: string,
  createdBy: Actor = "anvandare",
  delivery: InvoiceDeliveryInfo = MOCK_DELIVERY
): Invoice {
  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new Error("Fakturan finns inte");
  if (invoice.status === "utkast") {
    throw new Error("Utkast kan inte skickas innan fakturan är utfärdad.");
  }
  const customer = requireCustomer(invoice.customerId);
  const now = new Date().toISOString();
  const resend = Boolean(invoice.sentAt);
  if (!invoice.sentAt) invoice.sentAt = now;
  invoice.lastSentAt = now;
  invoice.lastSendAttemptAt = now;
  if (delivery.messageId && delivery.sentTo) {
    invoice.lastEmail = { provider: "resend", messageId: delivery.messageId, sentTo: delivery.sentTo };
  }

  const number = invoice.number;
  const emailed = delivery.mode !== "mock" && delivery.ok;
  if (!resend) {
    logAudit(createdBy, "faktura_skickad", `Faktura #${number} ${emailed ? "skickades med e-post" : "markerades som skickad"}.`, {
      targetType: "faktura",
      targetId: invoice.id,
    });
  }
  logActivity(
    resend
      ? emailed
        ? `Faktura #${number} skickades igen med e-post till ${delivery.sentTo ?? customer.email}.`
        : `Faktura #${number} markerades som skickad igen.`
      : emailed
        ? `Faktura #${number} skickades med e-post till ${delivery.sentTo ?? customer.email} (${kr(invoiceTotals(invoice).toPay)}).`
        : `Faktura #${number} markerades som skickad (${kr(invoiceTotals(invoice).toPay)}).`,
    {
      customerId: customer.id,
      entity: { type: "faktura", id: invoice.id },
      createdBy,
    }
  );
  save();
  return invoice;
}

/** Skicka fakturan – utfärda om det behövs, därefter leverera. Bokförs vid utfärdandet (faktureringsmetoden). */
export function sendInvoice(invoiceId: string, createdBy: Actor = "anvandare"): Invoice {
  issueInvoice(invoiceId, createdBy);
  return deliverInvoice(invoiceId, createdBy);
}

export function sendReminder(
  invoiceId: string,
  by: Actor = "anvandare",
  delivery: InvoiceDeliveryInfo = MOCK_DELIVERY
): void {
  const invoice = getInvoice(invoiceId);
  if (!invoice || !(invoice.status === "skickad" || invoice.status === "delbetald") || invoice.type === "kredit") return;
  invoice.reminders.push(new Date().toISOString());
  const customer = requireCustomer(invoice.customerId);
  const emailed = delivery.mode !== "mock" && delivery.ok;
  const who = by === "assistent" ? "Assistenten" : "Du";
  logActivity(
    emailed
      ? `${who} skickade en betalningspåminnelse med e-post för faktura #${invoice.number} till ${delivery.sentTo ?? customer.email}.`
      : `${who} noterade en betalningspåminnelse för faktura #${invoice.number}.`,
    { customerId: customer.id, entity: { type: "faktura", id: invoice.id }, createdBy: by }
  );
  save();
}

/* --------------------------------- Betalningar --------------------------------- */

export interface RegisterPaymentInput {
  /** Faktiskt bankbelopp i kronor. Utan belopp betalas hela utestående (manuell markering). */
  amount?: number;
  bankTransactionId?: string;
  matchedBy: "auto" | "manuell";
  /** Klartext från matchningsmotorn, t.ex. "Matchad på exakt OCR + exakt belopp". */
  matchReason?: string;
  /** Numerisk matchningskonfidens (0–1) från motorn. Saknas = manuell/1.0. */
  confidence?: number;
}

export interface RegisterPaymentResult {
  invoice: Invoice;
  payment: { id: string; amount: number };
  /** Fakturans status efter betalningen. */
  status: "betald" | "delbetald";
  /** Öresdiff som bokades på 3740 (±, 0 om ingen). */
  oresDiff: number;
  /** Överbetalning som bokades som skuld till kunden (2420). */
  excess: number;
  /** Kvarvarande fordran efter betalningen. */
  outstanding: number;
}

/**
 * Registrera en kundinbetalning – ENDA vägen att boka betalning av en faktura.
 *
 * Bokar ALLTID det faktiska bankbeloppet mot 1930 (aldrig fakturans belopp
 * när de skiljer sig):
 *   * exakt belopp            → fordran bockas av, status "betald".
 *   * avvikelse ≤ öre-tolerans → fordran bockas av helt, differensen bokas på
 *                                3740 Öres- och kronutjämning, status "betald".
 *   * underbetalning därutöver → delbetalning: fordran minskas med det
 *                                inbetalda, status "delbetald" (rest kvarstår).
 *   * överbetalning därutöver  → fordran bockas av, överskottet bokas som
 *                                skuld till kunden (2420) och blir en
 *                                exception – aldrig en intäkt, aldrig tyst.
 */
export function registerInvoicePayment(invoiceId: string, input: RegisterPaymentInput): RegisterPaymentResult {
  const data = db();
  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new Error("Fakturan finns inte");
  if (invoice.status === "utkast") throw new Error("Ett utkast kan inte markeras som betalt.");
  if (invoice.status === "krediterad") throw new Error("En krediterad faktura kan inte markeras som betald.");
  if (invoice.type === "kredit") throw new Error("En kreditfaktura är ingen fordran och kan inte markeras som betald.");
  if (invoice.status === "betald") throw new Error(`Faktura #${invoice.number} är redan betald.`);

  const customer = requireCustomer(invoice.customerId);
  const outstandingBefore = invoiceOutstanding(invoice);
  const amount = input.amount ?? outstandingBefore;
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error("Betalningsbeloppet måste vara minst 1 kr (hela kronor).");
  }

  const diff = outstandingBefore - amount; // >0 = underbetalt, <0 = överbetalt
  const withinTolerance = Math.abs(diff) <= ORE_TOLERANS_KR;
  const settles = diff <= 0 || withinTolerance;
  const settleReceivable = settles ? outstandingBefore : amount;
  const oresDiff = settles && withinTolerance ? diff : 0;
  const excess = diff < 0 && !withinTolerance ? -diff : 0;

  const now = new Date().toISOString();
  const payment = {
    id: uid(),
    invoiceId,
    bankTransactionId: input.bankTransactionId,
    amount,
    date: now,
    matchedBy: input.matchedBy,
  };
  data.payments.push(payment);

  const newStatus: "betald" | "delbetald" = settles ? "betald" : "delbetald";
  invoice.status = newStatus;
  if (newStatus === "betald") invoice.paidAt = now;
  if (excess > 0) invoice.overpaymentCredit = (invoice.overpaymentCredit ?? 0) + excess;

  const matchText =
    input.matchReason ??
    (input.matchedBy === "auto" ? "Matchad automatiskt mot fakturan (OCR/belopp)" : "Matchad manuellt mot fakturan");
  const diffText =
    oresDiff !== 0
      ? ` Differensen ${kr(Math.abs(oresDiff))} bokfördes som öresavrundning (3740).`
      : excess > 0
        ? ` Överskottet ${kr(excess)} bokfördes som skuld till kunden (2420 Förskott från kunder) – återbetala eller kreditera.`
        : newStatus === "delbetald"
          ? ` Fakturan är delbetald – ${kr(outstandingBefore - amount)} återstår.`
          : "";

  const ver = addVerification({
    date: now,
    description: `Betalning faktura #${invoice.number} – ${customer.name}`,
    entries: entriesInvoicePaymentReceived({
      bankAmount: amount,
      settleReceivable,
      oresDiff,
      excessToCustomerCredit: excess,
    }),
    source: { type: "betalning", id: payment.id },
    confidence: input.confidence != null ? verificationConfidence(input.confidence) : "hog",
    createdBy: "auto",
    explanation: `${matchText}: det faktiska bankbeloppet ${kr(amount)} sattes in på företagskontot och kundfordran ${newStatus === "betald" ? "bockades av" : "minskades"}.${diffText}`,
  });

  if (input.bankTransactionId) {
    const tx = data.bankTransactions.find((x) => x.id === input.bankTransactionId);
    if (tx) {
      tx.status = "bokford";
      tx.matchedType = "faktura";
      tx.matchedId = invoiceId;
      tx.verificationId = ver.id;
    }
  }

  logAudit("system", "betalning_matchad", `Betalning ${kr(amount)} matchades mot faktura #${invoice.number} (${matchText}).`, {
    targetType: "faktura",
    targetId: invoiceId,
  });
  logActivity(
    newStatus === "betald"
      ? `Betalning på ${kr(amount)} från ${customer.name} matchades mot faktura #${invoice.number} och bokfördes.${excess > 0 ? ` Överbetalning ${kr(excess)} väntar på hantering.` : ""}`
      : `Delbetalning på ${kr(amount)} från ${customer.name} matchades mot faktura #${invoice.number} – ${kr(invoiceOutstanding(invoice))} återstår.`,
    { customerId: customer.id, entity: { type: "faktura", id: invoiceId } }
  );
  save();
  return {
    invoice,
    payment: { id: payment.id, amount },
    status: newStatus,
    oresDiff,
    excess,
    outstanding: invoiceOutstanding(invoice),
  };
}

/**
 * Bakåtkompatibel hjälpare: markera hela utestående som betalt (manuell
 * markering/assistenten). Idempotent no-op om fakturan redan är betald.
 */
export function markInvoicePaid(invoiceId: string, opts: { bankTransactionId?: string; matchedBy: "auto" | "manuell" }): void {
  const invoice = getInvoice(invoiceId);
  if (!invoice || invoice.status === "betald") return;
  registerInvoicePayment(invoiceId, { bankTransactionId: opts.bankTransactionId, matchedBy: opts.matchedBy });
}

export interface CreditInvoiceOptions {
  /** Belopp inkl. moms att kreditera (delkredit). Utan belopp krediteras hela fakturan. */
  amountInclVat?: number;
}

/** Blockerar kreditering när ROT/RUT-ärendet gått för långt för att en kredit ska vara entydig. */
function assertCreditableTaxReductionState(original: Invoice): void {
  const t = invoiceTotals(original);
  if (!original.rot || t.deduction <= 0) return;
  const application = original.jobId ? getJob(original.jobId)?.taxReductionApplication : original.taxReductionApplication;
  const status = application?.status;
  if (status === "underlag_skapat" || status === "godkant" || status === "delvis_godkant" || status === "nekat") {
    throw new Error(
      "ROT/RUT-ärendet är ansökt eller avgjort – fakturan kan inte krediteras rakt av. Hantera utfallet via restfaktura/återbetalning i ROT/RUT-flödet."
    );
  }
}

/**
 * Kreditera en faktura – helt eller delvis.
 *
 *   * Hel kredit: originalet → "krediterad", intäkt/moms/fordran återförs.
 *     Betalda och delbetalda original får krediteras – det inbetalda blir en
 *     skuld till kunden och en "återbetala"-exception tills utbetalningen bokförs.
 *   * Delkredit (amountInclVat): proportionella rader per momssats, originalet
 *     behåller sin status och utestående minskar. Delkredit av ROT/RUT-fakturor
 *     stöds inte (avdraget mot Skatteverket blir tvetydigt) – kreditera helt.
 *
 * Krediten får eget nummer, refererar originalet, fryser snapshot och bokför omvänd moms.
 */
export function creditInvoice(invoiceId: string, createdBy: Actor = "anvandare", opts: CreditInvoiceOptions = {}): Invoice {
  const data = db();
  const original = getInvoice(invoiceId);
  if (!original) throw new Error("Fakturan finns inte");
  if (original.status === "utkast") throw new Error("Ett utkast kan inte krediteras. Kasta det i stället.");
  if (original.status === "krediterad") throw new Error("Fakturan är redan krediterad.");
  if (original.type === "kredit") throw new Error("En kreditfaktura kan inte krediteras.");
  if (original.number == null) throw new Error("Originalfakturan saknar nummer.");
  assertCreditableTaxReductionState(original);

  const totals = invoiceTotals(original);
  const alreadyCredited = invoiceCreditedAmount(original.id);
  const paid = invoicePaidAmount(original.id);
  const remainingToCredit = totals.toPay - alreadyCredited;

  const partialAmount = opts.amountInclVat != null ? Math.round(opts.amountInclVat) : undefined;
  const isPartial = partialAmount != null && partialAmount < remainingToCredit;

  if (partialAmount != null) {
    if (!Number.isFinite(partialAmount) || partialAmount < 1) {
      throw new Error("Kreditbeloppet måste vara minst 1 kr.");
    }
    if (partialAmount > remainingToCredit) {
      throw new Error(`Kreditbeloppet kan inte överstiga kvarvarande belopp (${kr(remainingToCredit)}).`);
    }
    if (isPartial && original.rot && totals.deduction > 0) {
      throw new Error("Delkredit stöds inte för fakturor med ROT/RUT-avdrag – kreditera hela fakturan.");
    }
  }
  if (!isPartial && alreadyCredited > 0 && partialAmount == null) {
    throw new Error(`Fakturan är delvis krediterad – kreditera resterande ${kr(remainingToCredit)} som delkredit.`);
  }

  const customer = requireCustomer(original.customerId);
  const now = new Date().toISOString();
  const number = allocateNextInvoiceNumber();
  const ocr = ocrForInvoice(number);
  const sourceLines = original.issuedSnapshot?.lines ?? original.lines;
  const sourceRot = original.issuedSnapshot?.rot ?? original.rot;
  const credit: Invoice = {
    id: uid(),
    number,
    customerId: original.customerId,
    jobId: original.jobId,
    quoteId: original.quoteId,
    type: "kredit",
    status: "utkast",
    lines: isPartial
      ? shareLines(sourceLines, sourceRot, partialAmount!, `Delkredit av faktura #${original.number}`, "ovrigt")
      : cloneLines(sourceLines),
    rot: isPartial ? null : sourceRot,
    taxReductionTerms: isPartial ? null : (original.issuedSnapshot?.taxReductionTerms ?? original.taxReductionTerms ?? null),
    taxReductionDetails: isPartial ? null : (original.issuedSnapshot?.taxReductionDetails ?? original.taxReductionDetails ?? null),
    issueDate: now,
    dueDate: now,
    paymentTermsDays: original.paymentTermsDays,
    serviceDate: original.serviceDate,
    lateInterestRate: original.lateInterestRate,
    reminders: [],
    token: publicToken(),
    ocr,
    creditsInvoiceId: original.id,
    deniedReductionOf: original.deniedReductionOf,
    createdBy,
    createdAt: now,
  };

  const seller = original.issuedSnapshot
    ? {
        ...data.settings,
        ...original.issuedSnapshot.seller,
        sate: original.issuedSnapshot.seller.sate,
      }
    : data.settings;
  const buyer = original.issuedSnapshot
    ? {
        ...customer,
        ...original.issuedSnapshot.buyer,
      }
    : customer;
  const blockers = collectIssueErrors({ invoice: credit, seller, buyer });
  if (blockers.length) throw new InvoiceNotReadyError(blockers);

  credit.status = "skickad";
  credit.issuedAt = now;
  credit.sentAt = now;
  credit.lastSentAt = now;
  credit.issuedSnapshot = buildIssuedSnapshot({
    invoice: credit,
    seller,
    buyer,
    issuedAt: now,
    number,
    ocr,
    creditsInvoiceNumber: original.number,
  });

  data.invoices.push(credit);
  const creditToPay = invoiceTotals(credit).toPay;

  // Statusövergång härleds ur belopp – aldrig ad hoc:
  //   * hel kredit → "krediterad".
  //   * delkredit som nollställer utestående → "betald" om inbetalningar finns
  //     (fordran slutreglerad), annars "krediterad" (helt krediterad i steg).
  //   * annars: status orörd, utestående minskar.
  if (!isPartial) {
    original.status = "krediterad";
  } else {
    const outstandingAfter = totals.toPay - paid - alreadyCredited - creditToPay;
    if (outstandingAfter <= 0 && original.status !== "betald") {
      original.status = paid > 0 ? "betald" : "krediterad";
      if (paid > 0) original.paidAt = original.paidAt ?? now;
    }
  }

  addVerification({
    date: now,
    description: `Kreditfaktura #${number} (krediterar #${original.number}) – ${customer.name}`,
    // En restfaktura för nekat avdrag bokades som omflytt 1513 → 1510;
    // krediteringen flyttar tillbaka fordran i stället för att återföra intäkt.
    entries: credit.deniedReductionOf
      ? entriesDeniedReductionCredit(creditToPay)
      : entriesCredit(credit.lines, credit.rot),
    source: { type: "kundfaktura", id: credit.id },
    confidence: "hog",
    createdBy: createdBy === "assistent" ? "assistent" : "auto",
    explanation: credit.deniedReductionOf
      ? `Kreditfakturan återför restfakturan #${original.number} för nekat ROT/RUT: fordran flyttas tillbaka till Skatteverkskontot. Ingen intäkt eller moms påverkas.`
      : isPartial
        ? `Delkrediten återför ${kr(creditToPay)} av faktura #${original.number}: intäkt, moms och kundfordran minskas proportionellt. Originalverifikationen står kvar – inget skrivs över.`
        : `Kreditfakturan återför faktura #${original.number}: intäkten, momsen och kundfordran bokas bort med omvända tecken. Originalverifikationen står kvar – inget skrivs över.`,
  });

  const refundDue = creditRefundDue(original);
  logAudit(createdBy, "faktura_krediterad", `Faktura #${original.number} krediterades med #${number} (${kr(creditToPay)}${isPartial ? ", delkredit" : ""}).`, {
    targetType: "faktura",
    targetId: original.id,
  });
  logActivity(
    `Faktura #${original.number} krediterades ${isPartial ? `delvis (${kr(creditToPay)})` : "helt"} med kreditfaktura #${number}.${refundDue > 0 ? ` ${kr(refundDue)} är inbetalt och ska återbetalas till kunden.` : ""}`,
    {
      customerId: customer.id,
      entity: { type: "faktura", id: credit.id },
      createdBy,
    }
  );
  save();
  return credit;
}

/**
 * Belopp som ska återbetalas till kunden: inbetalt som inte längre motsvaras
 * av en fordran (kreditering av betald/delbetald faktura) och som ännu inte
 * återbetalats. EN härledning – actionmotorn och UI:t använder samma.
 */
export function creditRefundDue(invoice: Invoice): number {
  if (invoice.type === "kredit") return 0;
  if (invoice.refund) return 0;
  const paid = invoicePaidAmount(invoice.id);
  if (paid <= 0) return 0;
  const t = invoiceTotals(invoice);
  const credited = invoiceCreditedAmount(invoice.id);
  if (invoice.status === "krediterad") return paid;
  // Delkrediterad: återbetala det som inbetalts utöver kvarvarande fordran.
  return Math.max(0, paid + credited - t.toPay);
}

/**
 * Registrera återbetalning till kund (efter kreditering av betald faktura).
 * Bokför 1510 debet / 1930 kredit och stänger "återbetala"-exceptionen.
 * Idempotent: en faktura kan bara ha EN återbetalning.
 */
export function registerCreditRefund(
  invoiceId: string,
  input: { bankTransactionId?: string; amount?: number; by?: Actor } = {}
): Invoice {
  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new Error("Fakturan finns inte");
  if (invoice.refund) throw new Error("Återbetalningen är redan registrerad.");
  const due = creditRefundDue(invoice);
  if (due <= 0) throw new Error("Fakturan har ingen återbetalning att registrera.");
  const amount = input.amount ?? due;
  if (!Number.isInteger(amount) || amount < 1 || amount > due) {
    throw new Error(`Återbetalningsbeloppet måste vara 1–${due} kr.`);
  }
  const customer = requireCustomer(invoice.customerId);
  const now = new Date().toISOString();
  // Skulden kan sitta på 2420 (överbetalning) och/eller som negativ 1510
  // (kreditering av betald faktura) – nollställ i den ordningen.
  const fromOverpayment = Math.min(amount, invoice.overpaymentCredit ?? 0);
  const fromCredit = amount - fromOverpayment;
  const ver = addVerification({
    date: now,
    description: `Återbetalning faktura #${invoice.number} – ${customer.name}`,
    entries: entriesCustomerRefund({ fromOverpayment, fromCredit }),
    source: { type: "betalning", id: invoice.id },
    confidence: "hog",
    createdBy: input.by === "assistent" ? "assistent" : "anvandare",
    explanation:
      fromCredit > 0
        ? `Fakturan krediterades efter att kunden betalat – utbetalningen på ${kr(amount)} nollställer skulden till kunden${fromOverpayment > 0 ? " (delvis överbetalning på 2420, resten negativ kundfordran)" : " (den negativa kundfordran)"}.`
        : `Kunden betalade för mycket – utbetalningen på ${kr(amount)} nollställer skulden som bokfördes på 2420 Förskott från kunder.`,
  });
  if (fromOverpayment > 0) {
    const remainingExcess = (invoice.overpaymentCredit ?? 0) - fromOverpayment;
    invoice.overpaymentCredit = remainingExcess > 0 ? remainingExcess : undefined;
  }
  invoice.refund = { amount, at: now, verificationId: ver.id, bankTransactionId: input.bankTransactionId };
  if (input.bankTransactionId) {
    const tx = db().bankTransactions.find((t) => t.id === input.bankTransactionId);
    if (tx) {
      tx.status = "bokford";
      tx.matchedType = "aterbetalning";
      tx.matchedId = invoiceId;
      tx.verificationId = ver.id;
    }
  }
  logActivity(`${kr(amount)} återbetalades till ${customer.name} för krediterad faktura #${invoice.number}.`, {
    customerId: customer.id,
    entity: { type: "faktura", id: invoiceId },
  });
  save();
  return invoice;
}

/** Kasta ett utkast. Utfärdade fakturor får inte tas bort. */
export function discardInvoice(invoiceId: string, createdBy: Actor = "anvandare"): void {
  const data = db();
  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new Error("Fakturan finns inte");
  if (invoice.status !== "utkast") {
    throw new Error("Utfärdade fakturor kan inte tas bort. Kreditera dem i stället.");
  }
  const customer = requireCustomer(invoice.customerId);
  unlinkJobWorkEntriesFromInvoice(invoiceId);
  data.invoices = data.invoices.filter((i) => i.id !== invoiceId);
  logActivity(`Fakturautkast ${invoiceNumberLabel(invoice)} kastades.`, {
    customerId: customer.id,
    entity: { type: "faktura", id: invoice.id },
    createdBy,
  });
  save();
}

/**
 * V1: skapa utkast för den del av ROT/RUT som Skatteverket nekat.
 * Återanvänder vanligt fakturaflöde – ingen Skatteverket-integration.
 */
export function createDeniedReductionInvoice(
  invoiceId: string,
  deniedAmount: number,
  createdBy: Actor = "anvandare"
): Invoice {
  const original = getInvoice(invoiceId);
  if (!original) throw new Error("Fakturan finns inte");
  if (!original.rot) throw new Error("Fakturan har inget ROT/RUT-avdrag");
  if (original.status === "utkast") throw new Error("Utfärda fakturan innan du skapar ett utkast för nekat avdrag.");
  if (original.type === "kredit") throw new Error("En kreditfaktura har inget avdrag att följa upp.");

  const deduction = invoiceTotals(original).deduction;
  const amount = Math.round(deniedAmount);
  if (!Number.isFinite(amount) || amount < 1) {
    throw new Error("Beloppet som nekats måste vara minst 1 kr.");
  }
  if (amount > deduction) {
    throw new Error(`Beloppet kan inte överstiga det preliminära avdraget (${kr(deduction)}).`);
  }

  const kind = original.rot.type === "rot" ? "ROT" : "RUT";
  const originalLabel = original.number != null ? `faktura #${original.number}` : "tidigare faktura";

  // Restbeloppet är samma ersättning som redan fakturerats och momsredovisats
  // på ursprungsfakturan – därför 0 % moms här och omflytt av fordran i böckerna
  // (1513 → 1510) i stället för ny intäkt.
  const invoice = createInvoice(
    {
      customerId: original.customerId,
      jobId: original.jobId,
      quoteId: original.quoteId,
      type: "faktura",
      lines: [
        {
          id: uid(),
          kind: "ovrigt",
          description: `Resterande belopp efter att Skatteverket nekat ${kr(amount)} av ${kind}-avdraget (${originalLabel}). Moms redovisad på ursprungsfakturan.`,
          qty: 1,
          unit: "st",
          unitPrice: amount,
          vatRate: 0,
        },
      ],
      rot: null,
      dueInDays: original.paymentTermsDays,
      lateInterestRate: original.lateInterestRate,
      serviceDate: original.serviceDate,
    },
    createdBy
  );
  invoice.deniedReductionOf = original.id;
  save();
  return invoice;
}

export { InvoiceNotReadyError };
