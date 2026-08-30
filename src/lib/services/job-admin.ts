import { kr } from "../format";
import { QUOTE_STATUS } from "../status-labels";
import type { Job, Quote } from "../types";
import { jobMoneySummary, nextPaymentPlanPartForJob } from "./attention";
import { quoteSignature } from "./data";
import { derivedJobStatus, isPaymentPlanPartDue } from "./job-lifecycle";
import { taxReductionCaseForJob } from "./tax-reduction";
import { uninvoicedActuals } from "./job-work";
import {
  jobCompleteWarning,
  jobRemovalPolicy,
  type JobCompleteWarning,
  type JobRemovalPolicy,
} from "./jobs";
import { getBusinessActions } from "./actions";

export type { JobInvoiceAction, JobPrimaryKind, JobQuoteAction, JobSecondaryKind } from "../job-ui-types";
import type { JobInvoiceAction, JobPrimaryKind, JobQuoteAction, JobSecondaryKind } from "../job-ui-types";

export interface JobAdminState {
  money: ReturnType<typeof jobMoneySummary>;
  quote: Quote | undefined;
  signatureName?: string;
  signatureAt?: string;
  nextPart: ReturnType<typeof nextPaymentPlanPartForJob>;
  remaining: number;
  unpaid: boolean;
  fullyPaid: boolean;
  /** Alltid satt – offert är aldrig ett krav för faktura. */
  quoteAction: JobQuoteAction;
  invoiceAction: JobInvoiceAction;
  /** Rekommenderad knapp när ingen offert finns: offert. Annars faktura om något är fakturerbart. */
  primary: JobPrimaryKind | null;
  secondary: JobSecondaryKind | null;
  waitingLabel: string | null;
  doneLabel: string | null;
  nextStep: string | null;
  canMarkDone: boolean;
  canReopen: boolean;
  hasBillable: boolean;
  completeWarning: JobCompleteWarning;
  removal: JobRemovalPolicy;
  lifecycle: ReturnType<typeof derivedJobStatus>;
}

function installmentDue(
  nextPart: ReturnType<typeof nextPaymentPlanPartForJob>,
  lifecycle: ReturnType<typeof derivedJobStatus>
): boolean {
  return Boolean(nextPart && isPaymentPlanPartDue(nextPart, lifecycle));
}

function unresolvedActionCountForJob(jobId: string): number {
  const href = `/uppdrag/${jobId}`;
  return getBusinessActions().attention.filter(
    (a) =>
      a.href === href ||
      a.href.startsWith(`${href}?`) ||
      (a.cta?.type === "createJobInvoice" && a.cta.jobId === jobId)
  ).length;
}

export function jobAdminState(job: Job): JobAdminState {
  const money = jobMoneySummary(job.id);
  const quote = money.quote;
  const signature = quote ? quoteSignature(quote.id) : undefined;
  const nextPart = nextPaymentPlanPartForJob(job.id);
  const remaining = money.remaining;
  const unpaid = money.invoices.some(
    (i) => i.status === "skickad" || i.status === "delbetald" || i.status === "utkast"
  );
  const approved = quote?.status === "godkand";
  const fullyInvoiced = approved && remaining <= 0 && money.invoiced > 0;
  const fullyPaid = fullyInvoiced && !unpaid && money.paid > 0;
  const lifecycle = derivedJobStatus(job);
  const dueNow = installmentDue(nextPart, lifecycle);

  let waitingLabel: string | null = null;
  let doneLabel: string | null = null;

  const hasUninvoicedActuals = uninvoicedActuals(job.id).length > 0;
  const hasBillable = remaining > 0 || hasUninvoicedActuals;

  const quoteAction: JobQuoteAction = !quote
    ? "skapa_offert"
    : quote.status === "utkast"
      ? "fortsatt_offert"
      : quote.status === "avbojd" || quote.status === "utgangen"
        ? "skapa_offert"
        : "visa_offert";

  const invoiceAction: JobInvoiceAction =
    lifecycle === "klart" && remaining > 0 && approved ? "skapa_slutfaktura" : "skapa_faktura";

  if (quote?.status === "skickad") {
    waitingLabel = QUOTE_STATUS.skickad.label;
  } else if (lifecycle === "klart") {
    if (!hasBillable && unpaid) waitingLabel = "Väntar på betalning";
    else if (fullyPaid) doneLabel = "Klart och betalt ✓";
    else if (!hasBillable) doneLabel = "Klart";
  } else if (!hasBillable && unpaid) {
    waitingLabel = "Väntar på betalning";
  }

  const primary: JobPrimaryKind | null = !quote && !hasUninvoicedActuals ? quoteAction : invoiceAction;
  const secondary: JobSecondaryKind | null = primary === quoteAction ? invoiceAction : quoteAction;

  let nextStep: string | null = null;
  if (!quote && hasUninvoicedActuals) {
    nextStep = `${kr(money.registeredUninvoiced)} registrerat, inte fakturerat än.`;
  } else if (quote?.status === "skickad") {
    nextStep = "Väntar på att kunden ska signera offerten.";
  } else if (quote?.status === "utkast") {
    nextStep = "Offerten är ett utkast – skicka den när den är klar.";
  } else if (quote?.status === "avbojd") {
    nextStep = "Offerten avböjdes. Skapa en ny om ni går vidare.";
  } else if (quote?.status === "utgangen") {
    nextStep = "Offerten har gått ut. Skapa en ny om ni går vidare.";
  } else if (lifecycle === "planerat" && nextPart && !dueNow) {
    nextStep = `När startdatumet infaller: fakturera ${nextPart.percent} % ${nextPart.label.toLowerCase()} (${kr(nextPart.amount)}).`;
  } else if (dueNow && nextPart && remaining > 0) {
    nextStep = `${kr(nextPart.amount)} kan faktureras enligt offerten.`;
  } else if (remaining > 0 && approved) {
    nextStep = `${kr(remaining)} återstår enligt den godkända offerten.`;
  } else if (unpaid) {
    nextStep = "Väntar på betalning.";
  } else if (fullyPaid) {
    nextStep = null;
  }

  const tax = taxReductionCaseForJob(job);
  if (
    remaining <= 0 &&
    !unpaid &&
    tax.nextStep &&
    (tax.phase === "ready" || tax.phase === "missing_fields" || tax.phase === "underlag")
  ) {
    nextStep = tax.nextStep;
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
    quoteAction,
    invoiceAction,
    primary,
    secondary,
    waitingLabel,
    doneLabel,
    nextStep,
    canMarkDone: lifecycle === "pagar",
    canReopen: lifecycle === "klart",
    hasBillable,
    completeWarning: jobCompleteWarning(job.id, {
      remaining,
      registeredUninvoiced: money.registeredUninvoiced,
      unresolvedActionCount: unresolvedActionCountForJob(job.id),
    }),
    removal: jobRemovalPolicy(job.id),
    lifecycle,
  };
}
