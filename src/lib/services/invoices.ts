import { db, save } from "../store";
import { uid, publicToken, ocrForInvoice } from "../ids";
import type { DocLine, Invoice, RotRut, Verification } from "../types";
import { currentVersion, getInvoice, getJob, getQuote, invoiceTotals, jobQuote, requireCustomer } from "./data";
import { docTotals } from "../calc";
import { entriesCredit, entriesInvoicePaid, entriesInvoiceSent } from "../bas";
import { kr, isoDaysFromNow } from "../format";
import { logActivity } from "./activity";
import { remainingToInvoiceForJob } from "./attention";

function addVerification(v: Omit<Verification, "id" | "series" | "number" | "createdAt">): Verification {
  const data = db();
  const ver: Verification = {
    ...v,
    id: uid(),
    series: "A",
    number: data.sequences.verification++,
    createdAt: new Date().toISOString(),
  };
  data.verifications.push(ver);
  return ver;
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
}

export function createInvoice(input: InvoiceInput): Invoice {
  const data = db();
  const customer = requireCustomer(input.customerId);
  const number = data.sequences.invoice++;
  const now = new Date().toISOString();
  const invoice: Invoice = {
    id: uid(),
    number,
    customerId: input.customerId,
    jobId: input.jobId,
    quoteId: input.quoteId,
    type: input.type,
    status: "utkast",
    lines: input.lines,
    rot: input.rot,
    issueDate: now,
    dueDate: isoDaysFromNow(input.dueInDays ?? data.settings.paymentTermsDays),
    lateInterestRate: input.lateInterestRate ?? data.settings.lateInterestRate,
    reminders: [],
    token: publicToken(),
    ocr: ocrForInvoice(number),
    createdAt: now,
  };
  data.invoices.push(invoice);
  logActivity(`Faktura #${number} skapades för ${customer.name} (utkast).`, {
    customerId: customer.id,
    entity: { type: "faktura", id: invoice.id },
  });
  save();
  return invoice;
}

export interface InvoiceUpdateInput {
  lines: DocLine[];
  rot: RotRut | null;
  dueInDays?: number;
  lateInterestRate?: number;
}

/** Uppdatera ett fakturautkast. Skickade, betalda och krediterade fakturor får inte ändras. */
export function updateInvoice(invoiceId: string, input: InvoiceUpdateInput): Invoice {
  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new Error("Fakturan finns inte");
  if (invoice.status !== "utkast") {
    throw new Error("Bara utkast kan redigeras. Skickade fakturor korrigeras med kreditfaktura.");
  }

  invoice.lines = input.lines;
  invoice.rot = input.rot;
  if (input.dueInDays != null) {
    invoice.dueDate = isoDaysFromNow(input.dueInDays);
  }
  if (input.lateInterestRate != null) {
    invoice.lateInterestRate = input.lateInterestRate;
  }

  const customer = requireCustomer(invoice.customerId);
  logActivity(`Faktura #${invoice.number} uppdaterades (utkast).`, {
    customerId: customer.id,
    entity: { type: "faktura", id: invoice.id },
  });
  save();
  return invoice;
}

/** Slutfaktura för ett uppdrag – resterande belopp enligt den godkända offerten. */
export function createFinalInvoiceForJob(jobId: string): Invoice {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const remaining = remainingToInvoiceForJob(jobId);
  const quote = jobQuote(job);
  const data = db();

  if (quote) {
    const version = currentVersion(quote);
    const alreadyInvoiced = data.invoices.some((i) => i.jobId === jobId && i.status !== "krediterad");
    if (!alreadyInvoiced) {
      // Inget fakturerat ännu → slutfakturan speglar offertens rader (inkl. ev. ROT).
      return createInvoice({
        customerId: job.customerId,
        jobId,
        quoteId: quote.id,
        type: "slutfaktura",
        lines: version.lines.map((l) => ({ ...l, id: uid() })),
        rot: version.rot,
        dueInDays: version.paymentTermsDays,
        lateInterestRate: version.lateInterestRate,
      });
    }
    // Delbetalning finns → resterande som en tydlig rad.
    const exkl = Math.round(remaining / 1.25);
    return createInvoice({
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
    });
  }

  throw new Error("Uppdraget saknar godkänd offert att fakturera från");
}

/** Delbetalning (deposition/förskott) enligt offertens betalningsplan. */
export function createPartInvoiceForQuote(quoteId: string, partIndex: number): Invoice {
  const quote = getQuote(quoteId);
  if (!quote) throw new Error("Offerten finns inte");
  const version = currentVersion(quote);
  const part = version.paymentPlan[partIndex];
  if (!part) throw new Error("Delbetalningen finns inte i betalningsplanen");
  const totals = docTotals(version.lines, version.rot);
  const partInkl = Math.round((totals.total * part.percent) / 100);
  const exkl = Math.round(partInkl / 1.25);
  return createInvoice({
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
  });
}

/** Skicka fakturan – bokförs samtidigt (faktureringsmetoden). */
export function sendInvoice(invoiceId: string): Invoice {
  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new Error("Fakturan finns inte");
  if (invoice.status !== "utkast") return invoice;
  const customer = requireCustomer(invoice.customerId);
  invoice.status = "skickad";
  invoice.sentAt = new Date().toISOString();
  invoice.issueDate = invoice.sentAt;

  const ver = addVerification({
    date: invoice.sentAt,
    description: `Faktura #${invoice.number} – ${customer.name}`,
    entries: entriesInvoiceSent(invoice.lines, invoice.rot),
    source: { type: "kundfaktura", id: invoice.id },
    confidence: "hog",
    createdBy: "auto",
  });
  void ver;

  const t = invoiceTotals(invoice);
  logActivity(`Faktura #${invoice.number} skickades till ${customer.name} (${kr(t.toPay)}).`, {
    customerId: customer.id,
    entity: { type: "faktura", id: invoice.id },
  });
  save();
  return invoice;
}

export function sendReminder(invoiceId: string, by: "anvandare" | "assistent" = "anvandare"): void {
  const invoice = getInvoice(invoiceId);
  if (!invoice || invoice.status !== "skickad") return;
  invoice.reminders.push(new Date().toISOString());
  const customer = requireCustomer(invoice.customerId);
  logActivity(
    `${by === "assistent" ? "Assistenten skickade" : "Du skickade"} en betalningspåminnelse för faktura #${invoice.number} till ${customer.name}.`,
    { customerId: customer.id, entity: { type: "faktura", id: invoice.id } }
  );
  save();
}

/** Markera betald och bokför betalningen (används av bankmatchningen). */
export function markInvoicePaid(invoiceId: string, opts: { bankTransactionId?: string; matchedBy: "auto" | "manuell" }): void {
  const data = db();
  const invoice = getInvoice(invoiceId);
  if (!invoice || invoice.status === "betald") return;
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

/** Kreditera en faktura helt. */
export function creditInvoice(invoiceId: string): Invoice {
  const data = db();
  const original = getInvoice(invoiceId);
  if (!original) throw new Error("Fakturan finns inte");
  const customer = requireCustomer(original.customerId);
  const number = data.sequences.invoice++;
  const now = new Date().toISOString();
  const credit: Invoice = {
    id: uid(),
    number,
    customerId: original.customerId,
    jobId: original.jobId,
    quoteId: original.quoteId,
    type: "kredit",
    status: "skickad",
    lines: original.lines.map((l) => ({ ...l, id: uid() })),
    rot: original.rot,
    issueDate: now,
    dueDate: now,
    sentAt: now,
    reminders: [],
    token: publicToken(),
    ocr: ocrForInvoice(number),
    creditsInvoiceId: original.id,
    createdAt: now,
  };
  original.status = "krediterad";
  data.invoices.push(credit);

  addVerification({
    date: now,
    description: `Kreditfaktura #${number} (krediterar #${original.number}) – ${customer.name}`,
    entries: entriesCredit(original.lines, original.rot),
    source: { type: "kundfaktura", id: credit.id },
    confidence: "hog",
    createdBy: "auto",
  });

  logActivity(`Faktura #${original.number} krediterades med kreditfaktura #${number}.`, {
    customerId: customer.id,
    entity: { type: "faktura", id: credit.id },
  });
  save();
  return credit;
}
