import { db, save } from "../store";
import { uid, publicToken, ocrForInvoice } from "../ids";
import type { DocLine, Invoice, RotRut, TaxReductionTermsSnapshot, Verification } from "../types";
import { currentVersion, getInvoice, getJob, getQuote, invoiceTotals, jobQuote, quoteSignature, requireCustomer } from "./data";
import { docTotals } from "../calc";
import { entriesCredit, entriesInvoicePaid, entriesInvoiceSent } from "../bas";
import { kr, isoDaysFromNow } from "../format";
import { logActivity } from "./activity";
import { nextPaymentPlanPartForJob, remainingToInvoiceForJob } from "./attention";
import { buildIssuedSnapshot } from "../invoices/snapshot";
import { assertInvoiceReadyToIssue, collectIssueErrors, InvoiceNotReadyError } from "../invoices/validate";
import { invoiceNumberLabel } from "../invoices/display";
import { snapshotTaxReductionTerms } from "../tax-reduction-terms";
import { postVerification } from "../accounting/engine";

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
 * anrop aldrig får samma nummer.
 */
function allocateNextInvoiceNumber(): number {
  const data = db();
  const number = data.sequences.invoice;
  data.sequences.invoice = number + 1;
  return number;
}

function cloneLines(lines: DocLine[]): DocLine[] {
  return lines.map((l) => ({ ...l }));
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
  quoteId?: string
): { rot: RotRut | null; taxReductionTerms: TaxReductionTermsSnapshot | null } {
  if (!rot) return { rot: null, taxReductionTerms: null };
  return {
    rot,
    taxReductionTerms: signedTaxReductionTerms(quoteId, rot.type) ?? snapshotTaxReductionTerms(rot.type),
  };
}

/**
 * True när fakturans ROT/RUT täcks av en BankID-låst offertversion med villkoren.
 * Saknas det: varna, men blockera inte skickning.
 */
export function invoiceHasDocumentedTaxReductionAcceptance(invoice: Pick<Invoice, "rot" | "quoteId">): boolean {
  if (!invoice.rot) return true;
  return signedTaxReductionTerms(invoice.quoteId, invoice.rot.type) != null;
}

export interface InvoiceInput {
  customerId: string;
  jobId?: string;
  quoteId?: string;
  type: Invoice["type"];
  lines: DocLine[];
  rot: RotRut | null;
  dueInDays?: number;
  lateInterestRate?: number;
  serviceDate?: string;
}

export function createInvoice(input: InvoiceInput, createdBy: Actor = "anvandare"): Invoice {
  const data = db();
  const customer = requireCustomer(input.customerId);
  const now = new Date().toISOString();
  const paymentTermsDays = input.dueInDays ?? data.settings.paymentTermsDays;
  const invoice: Invoice = {
    id: uid(),
    number: null,
    customerId: input.customerId,
    jobId: input.jobId,
    quoteId: input.quoteId,
    type: input.type,
    status: "utkast",
    lines: cloneLines(input.lines),
    ...invoiceTaxReductionFields(input.rot, input.quoteId),
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
  dueInDays?: number;
  lateInterestRate?: number;
  serviceDate?: string | null;
}

/** Uppdatera ett fakturautkast. Skickade, betalda och krediterade fakturor får inte ändras. */
export function updateInvoice(invoiceId: string, input: InvoiceUpdateInput, createdBy: Actor = "anvandare"): Invoice {
  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new Error("Fakturan finns inte");
  if (invoice.status !== "utkast") {
    throw new Error("Bara utkast kan redigeras. Skickade fakturor korrigeras med kreditfaktura.");
  }

  invoice.lines = cloneLines(input.lines);
  Object.assign(invoice, invoiceTaxReductionFields(input.rot, invoice.quoteId));
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
  return job?.completedAt;
}

/** Slutfaktura för ett uppdrag – resterande belopp enligt den godkända offerten. */
export function createFinalInvoiceForJob(jobId: string, createdBy: Actor = "anvandare"): Invoice {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const remaining = remainingToInvoiceForJob(jobId);
  const quote = jobQuote(job);
  const data = db();
  const serviceDate = serviceDateFromJob(jobId);

  if (quote) {
    const version = currentVersion(quote);
    const alreadyInvoiced = data.invoices.some((i) => i.jobId === jobId && i.status !== "krediterad");
    if (!alreadyInvoiced) {
      return createInvoice(
        {
          customerId: job.customerId,
          jobId,
          quoteId: quote.id,
          type: "slutfaktura",
          lines: version.lines.map((l) => ({ ...l, id: uid() })),
          rot: version.rot,
          dueInDays: version.paymentTermsDays,
          lateInterestRate: version.lateInterestRate,
          serviceDate,
        },
        createdBy
      );
    }
    const exkl = Math.round(remaining / 1.25);
    return createInvoice(
      {
        customerId: job.customerId,
        jobId,
        quoteId: quote.id,
        type: "slutfaktura",
        lines: [
          {
            id: uid(),
            kind: "arbete",
            description: `Slutfaktura – ${job.title} (resterande enligt offert #${quote.number})`,
            qty: 1,
            unit: "st",
            unitPrice: exkl,
            vatRate: 25,
          },
        ],
        rot: null,
        dueInDays: version.paymentTermsDays,
        lateInterestRate: version.lateInterestRate,
        serviceDate,
      },
      createdBy
    );
  }

  throw new Error("Uppdraget saknar godkänd offert att fakturera från");
}

/** Nästa faktura för uppdraget: del enligt betalningsplanen, annars resterande som slutfaktura. */
export function createNextInvoiceForJob(jobId: string, createdBy: Actor = "anvandare"): Invoice {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  if (job.status !== "klart") {
    const quote = jobQuote(job);
    const next = nextPaymentPlanPartForJob(jobId);
    if (quote && next && !next.isLast) {
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
  const totals = docTotals(version.lines, version.rot);
  const partInkl = Math.round((totals.total * part.percent) / 100);
  const exkl = Math.round(partInkl / 1.25);
  return createInvoice(
    {
      customerId: quote.customerId,
      jobId: quote.jobId,
      quoteId: quote.id,
      type: "delbetalning",
      lines: [
        {
          id: uid(),
          kind: "arbete",
          description: `Delbetalning ${partIndex + 1} av ${version.paymentPlan.length} – ${version.title} (${part.percent} % ${part.label.toLowerCase()})`,
          qty: 1,
          unit: "st",
          unitPrice: exkl,
          vatRate: 25,
        },
      ],
      rot: null,
      dueInDays: Math.min(version.paymentTermsDays, 14),
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
  const allocatedNew = invoice.number == null;
  const number = invoice.number ?? allocateNextInvoiceNumber();
  const ocr = invoice.ocr && invoice.number != null ? invoice.ocr : ocrForInvoice(number);

  freezeIssue(invoice, { number, ocr, issuedAt: now });
  invoice.status = "skickad";

  addVerification({
    date: now,
    description: `Faktura #${number} – ${customer.name}`,
    entries: entriesInvoiceSent(invoice.lines, invoice.rot),
    source: { type: "kundfaktura", id: invoice.id },
    confidence: "hog",
    createdBy: createdBy === "assistent" ? "assistent" : "auto",
    explanation: `Fakturan bokfördes när den utfärdades (faktureringsmetoden): kundfordran mot intäkt och utgående moms. Beloppen kommer direkt från fakturan${invoice.rot ? `, och ${invoice.rot.type.toUpperCase()}-delen ligger som fordran på Skatteverket tills den betalas ut` : ""}.`,
  });

  if (allocatedNew) {
    logActivity(`Faktura #${number} fick löpnummer och OCR ${ocr}.`, {
      customerId: customer.id,
      entity: { type: "faktura", id: invoice.id },
      createdBy,
    });
  }
  logActivity(`Faktura #${number} utfärdades för ${customer.name} (${kr(invoiceTotals(invoice).toPay)}).`, {
    customerId: customer.id,
    entity: { type: "faktura", id: invoice.id },
    createdBy,
  });
  save();
  return invoice;
}

/** Mockad e-postleverans. Misslyckande får inte rulla tillbaka nummer eller skapa ny faktura. */
export function deliverInvoice(invoiceId: string, createdBy: Actor = "anvandare"): Invoice {
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

  const number = invoice.number;
  const to = customer.email || "(saknar e-post)";
  const from = db().settings.email || db().settings.name;
  console.info(
    `[driva:email] Från ${from}: Faktura #${number} till ${to} (${resend ? "skicka igen" : "första utskick"}). Ingen riktig e-post skickas i demon.`
  );

  logActivity(
    resend
      ? `Faktura #${number} skickades igen till ${customer.name}.`
      : `Faktura #${number} skickades till ${customer.name} (${kr(invoiceTotals(invoice).toPay)}).`,
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

export function sendReminder(invoiceId: string, by: Actor = "anvandare"): void {
  const invoice = getInvoice(invoiceId);
  if (!invoice || invoice.status !== "skickad") return;
  invoice.reminders.push(new Date().toISOString());
  const customer = requireCustomer(invoice.customerId);
  logActivity(
    `${by === "assistent" ? "Assistenten skickade" : "Du skickade"} en betalningspåminnelse för faktura #${invoice.number} till ${customer.name}.`,
    { customerId: customer.id, entity: { type: "faktura", id: invoice.id }, createdBy: by }
  );
  save();
}

/** Markera betald och bokför betalningen (används av bankmatchningen). */
export function markInvoicePaid(invoiceId: string, opts: { bankTransactionId?: string; matchedBy: "auto" | "manuell" }): void {
  const data = db();
  const invoice = getInvoice(invoiceId);
  if (!invoice || invoice.status === "betald") return;
  if (invoice.status === "utkast") throw new Error("Ett utkast kan inte markeras som betalt.");
  if (invoice.status === "krediterad") throw new Error("En krediterad faktura kan inte markeras som betald.");
  const customer = requireCustomer(invoice.customerId);
  const t = invoiceTotals(invoice);
  const now = new Date().toISOString();
  invoice.status = "betald";
  invoice.paidAt = now;

  const payment = {
    id: uid(),
    invoiceId,
    bankTransactionId: opts.bankTransactionId,
    amount: t.toPay,
    date: now,
    matchedBy: opts.matchedBy,
  };
  data.payments.push(payment);

  const ver = addVerification({
    date: now,
    description: `Betalning faktura #${invoice.number} – ${customer.name}`,
    entries: entriesInvoicePaid(t.toPay),
    source: { type: "betalning", id: payment.id },
    confidence: "hog",
    createdBy: "auto",
    explanation: `Inbetalningen ${opts.matchedBy === "auto" ? "matchades automatiskt mot fakturan (OCR/belopp)" : "matchades manuellt mot fakturan"}: pengarna sattes in på företagskontot och kundfordran bockades av.`,
  });

  if (opts.bankTransactionId) {
    const tx = data.bankTransactions.find((x) => x.id === opts.bankTransactionId);
    if (tx) {
      tx.status = "bokford";
      tx.matchedType = "faktura";
      tx.matchedId = invoiceId;
      tx.verificationId = ver.id;
    }
  }

  logActivity(
    `Betalning på ${kr(t.toPay)} från ${customer.name} matchades mot faktura #${invoice.number} och bokfördes.`,
    { customerId: customer.id, entity: { type: "faktura", id: invoiceId } }
  );
  save();
}

/**
 * Kreditera en faktura helt. Delkredit stöds inte i V1.
 * Krediten får eget nummer, refererar originalet, fryser snapshot och bokför omvänd moms.
 */
export function creditInvoice(invoiceId: string, createdBy: Actor = "anvandare"): Invoice {
  const data = db();
  const original = getInvoice(invoiceId);
  if (!original) throw new Error("Fakturan finns inte");
  if (original.status === "utkast") throw new Error("Ett utkast kan inte krediteras. Kasta det i stället.");
  if (original.status === "krediterad") throw new Error("Fakturan är redan krediterad.");
  if (original.type === "kredit") throw new Error("En kreditfaktura kan inte krediteras.");
  if (original.status === "betald") {
    throw new Error("Betald faktura kan inte krediteras i V1. Del- och återbetalning av betald faktura stöds inte ännu.");
  }
  if (original.number == null) throw new Error("Originalfakturan saknar nummer.");

  const customer = requireCustomer(original.customerId);
  const now = new Date().toISOString();
  const number = allocateNextInvoiceNumber();
  const ocr = ocrForInvoice(number);
  const credit: Invoice = {
    id: uid(),
    number,
    customerId: original.customerId,
    jobId: original.jobId,
    quoteId: original.quoteId,
    type: "kredit",
    status: "utkast",
    lines: cloneLines(original.issuedSnapshot?.lines ?? original.lines),
    rot: original.issuedSnapshot?.rot ?? original.rot,
    taxReductionTerms: original.issuedSnapshot?.taxReductionTerms ?? original.taxReductionTerms ?? null,
    issueDate: now,
    dueDate: now,
    paymentTermsDays: original.paymentTermsDays,
    serviceDate: original.serviceDate,
    lateInterestRate: original.lateInterestRate,
    reminders: [],
    token: publicToken(),
    ocr,
    creditsInvoiceId: original.id,
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

  original.status = "krediterad";
  data.invoices.push(credit);

  addVerification({
    date: now,
    description: `Kreditfaktura #${number} (krediterar #${original.number}) – ${customer.name}`,
    entries: entriesCredit(credit.lines, credit.rot),
    source: { type: "kundfaktura", id: credit.id },
    confidence: "hog",
    createdBy: createdBy === "assistent" ? "assistent" : "auto",
    explanation: `Kreditfakturan återför faktura #${original.number}: intäkten, momsen och kundfordran bokas bort med omvända tecken. Originalverifikationen står kvar – inget skrivs över.`,
  });

  logActivity(`Faktura #${original.number} krediterades med kreditfaktura #${number}.`, {
    customerId: customer.id,
    entity: { type: "faktura", id: credit.id },
    createdBy,
  });
  save();
  return credit;
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
  const exkl = Math.round(amount / 1.25);

  return createInvoice(
    {
      customerId: original.customerId,
      jobId: original.jobId,
      quoteId: original.quoteId,
      type: "faktura",
      lines: [
        {
          id: uid(),
          kind: "ovrigt",
          description: `Resterande belopp efter att Skatteverket nekat ${kr(amount)} av ${kind}-avdraget (${originalLabel})`,
          qty: 1,
          unit: "st",
          unitPrice: exkl,
          vatRate: 25,
        },
      ],
      rot: null,
      dueInDays: original.paymentTermsDays,
      lateInterestRate: original.lateInterestRate,
      serviceDate: original.serviceDate,
    },
    createdBy
  );
}

export { InvoiceNotReadyError };
