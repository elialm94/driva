import { kr } from "../format";
import type { Job, Quote } from "../types";
import { jobMoneySummary, nextPaymentPlanPartForJob } from "./attention";
import { quoteSignature } from "./data";

export type JobPrimaryKind =
  | "skapa_offert"
  | "visa_offert"
  | "starta"
  | "skapa_faktura"
  | "skapa_slutfaktura";

export interface JobAdminState {
  money: ReturnType<typeof jobMoneySummary>;
  quote: Quote | undefined;
  signatureName?: string;
  signatureAt?: string;
  nextPart: ReturnType<typeof nextPaymentPlanPartForJob>;
  remaining: number;
  unpaid: boolean;
  fullyPaid: boolean;
  primary: JobPrimaryKind | null;
  secondary: "visa_offert" | null;
  waitingLabel: string | null;
  doneLabel: string | null;
  nextStep: string | null;
  canMarkDone: boolean;
  canStart: boolean;
}

export function jobAdminState(job: Job): JobAdminState {
  const money = jobMoneySummary(job.id);
  const quote = money.quote;
  const signature = quote ? quoteSignature(quote.id) : undefined;
  const nextPart = nextPaymentPlanPartForJob(job.id);
  const remaining = money.remaining;
  const unpaid = money.invoices.some((i) => i.status === "skickad" || i.status === "utkast");
  const approved = quote?.status === "godkand";
  const fullyInvoiced = approved && remaining <= 0 && money.invoiced > 0;
  const fullyPaid = fullyInvoiced && !unpaid && money.paid > 0;

  let primary: JobPrimaryKind | null = null;
  let secondary: "visa_offert" | null = null;
  let waitingLabel: string | null = null;
  let doneLabel: string | null = null;

  if (!quote) {
    primary = "skapa_offert";
  } else if (quote.status === "skickad") {
    primary = "visa_offert";
    waitingLabel = "Väntar på BankID";
  } else if (quote.status === "utkast") {
    primary = "visa_offert";
  } else if (quote.status === "avbojd" || quote.status === "utgangen") {
    primary = "skapa_offert";
    secondary = "visa_offert";
  } else if (job.status === "kommande") {
    primary = "starta";
    secondary = "visa_offert";
  } else if (job.status === "pagar") {
    if (remaining > 0) {
      primary = "skapa_faktura";
      secondary = "visa_offert";
    } else if (unpaid) {
      waitingLabel = "Väntar på betalning";
      secondary = "visa_offert";
    } else {
      secondary = "visa_offert";
    }
  } else if (job.status === "klart") {
    if (remaining > 0) {
      primary = "skapa_slutfaktura";
      secondary = quote ? "visa_offert" : null;
    } else if (unpaid) {
      waitingLabel = "Väntar på betalning";
    } else if (fullyPaid) {
      doneLabel = "Klart och betalt ✓";
    } else {
      doneLabel = "Klart";
    }
  }

  let nextStep: string | null = null;
  if (!quote) {
    nextStep = "Nästa steg: skapa en offert.";
  } else if (quote.status === "skickad") {
    nextStep = "Väntar på att kunden godkänner med BankID.";
  } else if (quote.status === "utkast") {
    nextStep = "Offerten är ett utkast – skicka den när den är klar.";
  } else if (quote.status === "avbojd") {
    nextStep = "Offerten avböjdes. Skapa en ny om ni går vidare.";
  } else if (quote.status === "utgangen") {
    nextStep = "Offerten har gått ut. Skapa en ny om ni går vidare.";
  } else if (job.status === "kommande" && nextPart) {
    nextStep = `När du startar: fakturera ${nextPart.percent} % ${nextPart.label.toLowerCase()} (${kr(nextPart.amount)}).`;
  } else if (job.status === "pagar" && nextPart) {
    nextStep = `Nästa enligt offerten: ${nextPart.percent} % ${nextPart.label.toLowerCase()} · ${kr(nextPart.amount)}.`;
  } else if (remaining > 0 && approved) {
    nextStep = `${kr(remaining)} återstår enligt den godkända offerten.`;
  } else if (unpaid) {
    nextStep = "Väntar på betalning.";
  } else if (fullyPaid) {
    nextStep = null;
  }

  return {
    money,
    quote,
    signatureName: signature?.signerName,
    signatureAt: signature?.signedAt,
    nextPart,
    remaining,
    unpaid,
    fullyPaid,
    primary,
    secondary,
    waitingLabel,
    doneLabel,
    nextStep,
    canMarkDone: job.status === "pagar",
    canStart: job.status === "kommande",
  };
}
