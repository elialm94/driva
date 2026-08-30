import { db } from "../store";
import { uid } from "../ids";
import { kr, datumLang, relativ } from "../format";
import type {
  AssistantCard,
  Customer,
  Invoice,
  Job,
  PendingAssistantAction,
  Quote,
  ResumeAfterCustomer,
  SupplierInvoice,
} from "../types";
import { createCustomer } from "../services/customers";
import { createQuote, quoteDefaults } from "../services/quotes";
import { createJob, deleteOrArchiveJob, findMatchingUnquotedJob, jobRemovalPolicy, reopenJob, setJobStatus } from "../services/jobs";
import { findWorkLocationByHint, formatLocationAddress, workLocationToHousing, workLocationsForModel } from "../services/work-locations";
import { createFinalInvoiceForJob, createInvoice, createInvoiceForJob, createNextInvoiceForJob, discardInvoice, updateInvoice, type InvoiceInput, type JobInvoiceBasis } from "../services/invoices";
import { addJobMaterial, actualEntries, jobInvoiceChoice, registerJobTime } from "../services/job-work";
import { rotWithAmounts } from "../tax-reduction-amount";
import {
  classifyEconomicLineType,
  defaultUnitForLineType,
  lineKindFromType,
  syncDocLineClassification,
} from "../economic-line-type";
import { currentVersion, daysOverdue, getCustomer, getInvoice, getJob, getQuote, invoiceTotals, isOpenReceivable, isOverdue, quoteStatusLabel, quoteTotals, quoteWaitingDays, requireCustomer } from "../services/data";
import { remainingToInvoiceForJob } from "../services/attention";
import { getBusinessActions } from "../services/actions";
import { projectHomeAttention } from "../services/action-views";
import { derivedJobStatus } from "../services/job-lifecycle";
import {
  findJobsForTaxReduction,
  resolveTaxReductionPrefill,
  taxReductionMissingFields,
  detailsFromPrefill,
} from "../services/tax-reduction";
import { maskPersonnummer } from "../personnummer";
import { businessStats, financeOverview, momsForCurrentPeriod } from "../services/finance";
import {
  applyBusinessProfilePatch,
  billingReadiness,
  getBusinessProfile,
  getInvoiceDefaults,
  SETTINGS_FIELD_LABELS,
} from "../services/settings";
import { domainCardView, primaryDomain } from "../domains";
import { searchDomain } from "../domains/availability";
import {
  getSupplierInvoice,
  paymentDetailsBlockedReason,
  prepareSupplierPayment,
  supplierPaymentConfirmRows,
  supplierPayments,
} from "../services/supplier-payments";
import { paymentDetailsInfo, provenanceLabel } from "../services/payment-details";
import {
  activePaymentFileForInvoice,
  getPaymentFile,
  payerAccountLabel,
  paymentFileBlockers,
  paymentFileBlockersForInvoice,
} from "../services/payment-files";
import { updateSupplierInvoiceField } from "../services/suppliers";
import { extractionReviewForItem } from "../services/inbox";
import { supplierPaymentUiLabel } from "../inbox/workflow";

export type DomainResult = {
  text: string;
  card?: AssistantCard;
  ok: boolean;
  forModel: Record<string, unknown>;
};

export function addPending(action: PendingAssistantAction) {
  db().pendingActions.push(action);
}

export function entityCard(
  entity: "kund" | "uppdrag" | "offert" | "faktura",
  title: string,
  href: string,
  subtitle?: string
): AssistantCard {
  const openLabel =
    entity === "uppdrag"
      ? "Öppna uppdrag"
      : entity === "offert"
        ? "Öppna offert"
        : entity === "faktura"
          ? "Öppna faktura"
          : "Öppna kund";
  return { kind: "entity", entity, title, subtitle, href, openLabel };
}

export function customerListCard(customers: Customer[], title: string): AssistantCard {
  return {
    kind: "list",
    title,
    rows: customers.map((c) => ({
      label: c.name,
      value: [c.kind === "foretag" ? "Företag" : "Privat", c.city].filter(Boolean).join(" · "),
      href: `/kunder/${c.id}`,
    })),
  };
}

export function offerCreateCustomer(name: string, resume?: ResumeAfterCustomer): DomainResult {
  const action: PendingAssistantAction = { id: uid(), type: "skapa_kund", name, resume };
  addPending(action);
  return {
    ok: true,
    text: `Jag hittar ingen kund som heter ”${name}”. Vill du lägga till hen? Då kan jag fortsätta direkt efteråt.`,
    card: { kind: "create_customer", actionId: action.id, suggestedName: name, state: "vantar" },
    forModel: { missingCustomer: name, offeredCreate: true },
  };
}

export function ambiguousCustomers(query: string, customers: Customer[]): DomainResult {
  return {
    ok: true,
    text: `Jag hittar flera som matchar ”${query}” – vem menar du?`,
    card: customerListCard(customers, "Välj kund"),
    forModel: {
      ambiguous: true,
      customers: customers.map((c) => ({ id: c.id, name: c.name, city: c.city })),
    },
  };
}

export function laborLine(description: string, amountInclVat: number) {
  return classifiedLine(description, amountInclVat, "LABOR");
}

/** Samma klassning som kommandofältet – restid/mil/virke/snickeriarbete. */
export function classifiedLine(
  description: string,
  amountInclVat: number,
  forcedType?: ReturnType<typeof classifyEconomicLineType>
) {
  const vat = (db().settings.defaultVatRate ?? 25) as 0 | 6 | 12 | 25;
  const exkl = Math.round(amountInclVat / (1 + vat / 100));
  const type = forcedType ?? classifyEconomicLineType(description);
  return syncDocLineClassification({
    id: uid(),
    kind: lineKindFromType(type),
    type,
    description,
    qty: 1,
    unit: defaultUnitForLineType(type),
    unitPrice: exkl,
    vatRate: vat,
  });
}

export function createQuoteDraft(input: {
  customerId: string;
  title: string;
  amountInclVat?: number;
  intro?: string;
  percentAtStart?: number;
  rot?: "rot" | "rut" | null;
  jobId?: string;
  appliedTaxReduction?: number;
}): DomainResult {
  const customer = requireCustomer(input.customerId);
  const defaults = quoteDefaults();
  const job =
    (input.jobId ? getJob(input.jobId) : undefined) ??
    findMatchingUnquotedJob(input.customerId, input.title);
  const title = input.title.trim() || job?.title || "Offererat arbete";
  const genericIntro = !input.intro || /enligt överenskommelse/i.test(input.intro);
  const intro =
    job && genericIntro
      ? job.originalMessage || job.description || `${title} enligt överenskommelse.`
      : (input.intro ?? `${title} enligt överenskommelse.`);
  const percent = input.percentAtStart && input.percentAtStart > 0 && input.percentAtStart < 100 ? input.percentAtStart : undefined;
  const rot =
    input.rot === "rot" || input.rot === "rut"
      ? input.appliedTaxReduction != null
        ? { type: input.rot, appliedTaxReduction: Math.round(input.appliedTaxReduction), taxReductionManuallyAdjusted: true }
        : { type: input.rot }
      : null;
  let quote;
  try {
    quote = createQuote(
      {
        customerId: customer.id,
        jobId: job?.id,
        title,
        intro,
        lines: [classifiedLine(title, input.amountInclVat ?? 0)],
        rot,
        paymentPlan: percent
          ? [
              { label: "Vid arbetets start", percent },
              { label: "När arbetet är klart och godkänt", percent: 100 - percent },
            ]
          : [{ label: "Betalning när arbetet är klart", percent: 100 }],
        paymentTermsDays: defaults.paymentTermsDays,
        lateInterestRate: defaults.lateInterestRate,
        validUntil: defaults.validUntil,
        terms: defaults.terms,
      },
      "assistent"
    );
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Kunde inte skapa offerten.");
  }
  const t = quoteTotals(quote);
  const version = currentVersion(quote);
  const appliedNote =
    version.rot?.appliedTaxReduction != null
      ? ` Preliminärt ${version.rot.type.toUpperCase()}-avdrag ${kr(version.rot.appliedTaxReduction)} utifrån offerten.`
      : rot
        ? ` med preliminärt ${rot.type.toUpperCase()}-avdrag`
        : "";
  return {
    ok: true,
    text: `Klart – utkast till offert #${quote.number} för ${customer.name} på ${kr(t.total)} inkl. moms.${appliedNote}${
      percent ? ` Delbetalning ${percent} % vid start.` : ""
    }${job ? " Utifrån uppdraget." : ""} Den är inte skickad.`,
    card: entityCard(
      "offert",
      `Offert #${quote.number} · ${title}`,
      `/ekonomi/offerter/${quote.id}`,
      `${customer.name} · ${kr(t.total)} inkl. moms · utkast`
    ),
    forModel: {
      quoteId: quote.id,
      number: quote.number,
      status: quote.status,
      totalIncl: t.total,
      sent: false,
      rot: rot?.type ?? null,
      appliedTaxReduction: version.rot?.appliedTaxReduction ?? null,
      calculatedEligibleTaxReduction: version.rot?.calculatedEligibleTaxReduction ?? null,
      jobId: job?.id ?? null,
    },
  };
}

export function createJobDraft(input: {
  customerId: string;
  title: string;
  startDate?: string;
  description?: string;
  workLocationHint?: string;
  workLocationId?: string;
}): DomainResult {
  const customer = requireCustomer(input.customerId);
  const location =
    (input.workLocationId
      ? (customer.workLocations ?? []).find((l) => l.id === input.workLocationId)
      : undefined) ?? findWorkLocationByHint(customer, input.workLocationHint);
  const job = createJob({
    customerId: customer.id,
    title: input.title.trim() || "Uppdrag",
    startDate: input.startDate,
    description: input.description,
    workLocationId: location?.id,
  });
  const when = job.startDate ? ` · start ${datumLang(job.startDate)}` : "";
  return {
    ok: true,
    text: `Klart – uppdraget ${job.title} för ${customer.name} är skapat${when}.`,
    card: entityCard("uppdrag", job.title, `/uppdrag/${job.id}`, `${customer.name}${when}`),
    forModel: {
      jobId: job.id,
      title: job.title,
      status: job.status,
      startDate: job.startDate,
      workLocationId: job.workLocationId ?? null,
      workLocationLabel: location?.label ?? null,
    },
  };
}

export function createInvoiceDraft(input: {
  customerId: string;
  title?: string;
  amountInclVat?: number;
  jobId?: string;
  taxReduction?: "rot" | "rut" | null;
  appliedTaxReduction?: number;
  workLocationHint?: string;
}): DomainResult {
  if (input.taxReduction === "rot" || input.taxReduction === "rut") {
    return createTaxReductionInvoiceDraft({
      customerId: input.customerId,
      jobId: input.jobId,
      titleHint: input.title,
      amountInclVat: input.amountInclVat,
      type: input.taxReduction,
      appliedTaxReduction: input.appliedTaxReduction,
      workLocationHint: input.workLocationHint,
    });
  }
  const customer = requireCustomer(input.customerId);
  const title = input.title?.trim() || "Arbete";
  const payload: InvoiceInput = {
    customerId: customer.id,
    jobId: input.jobId,
    type: "faktura",
    lines: [classifiedLine(title, input.amountInclVat ?? 0)],
    rot: null,
  };
  const invoice = createInvoice(payload, "assistent");
  const t = invoiceTotals(invoice);
  return {
    ok: true,
    text: `Klart – utkast till faktura för ${customer.name} på ${kr(t.toPay)}. Den har inget löpnummer än och är inte skickad.`,
    card: entityCard(
      "faktura",
      "Fakturautkast",
      `/ekonomi/fakturor/${invoice.id}`,
      `${customer.name} · ${kr(t.toPay)} · utkast`
    ),
    forModel: { invoiceId: invoice.id, number: null, status: invoice.status, sent: false },
  };
}

export function createTaxReductionInvoiceDraft(input: {
  customerId: string;
  jobId?: string;
  titleHint?: string;
  amountInclVat?: number;
  type: "rot" | "rut";
  appliedTaxReduction?: number;
  workLocationHint?: string;
}): DomainResult {
  const customer = requireCustomer(input.customerId);
  const kind = input.type.toUpperCase();
  const location = findWorkLocationByHint(customer, input.workLocationHint ?? input.titleHint);
  let job = input.jobId ? getJob(input.jobId) : undefined;
  if (!job && location) {
    const atLocation = db().jobs.filter((j) => j.customerId === customer.id && j.workLocationId === location.id);
    if (atLocation.length === 1) job = atLocation[0];
  }
  if (!job) {
    const jobs = findJobsForTaxReduction(customer.id, input.titleHint);
    if (jobs.length > 1 && input.titleHint) {
      const matched = jobs.filter(
        (j) =>
          j.title.toLowerCase().includes(input.titleHint!.toLowerCase()) ||
          input.titleHint!.toLowerCase().includes(j.title.toLowerCase())
      );
      if (matched.length === 1) job = matched[0];
      else if (matched.length > 1 || jobs.length > 1) {
        return {
          ok: true,
          text: `Vilket uppdrag ska ${kind}-fakturan gälla?`,
          card: {
            kind: "list",
            rows: jobs.map((j) => ({ label: j.title, href: `/uppdrag/${j.id}` })),
          },
          forModel: {
            needsJobChoice: true,
            jobs: jobs.map((j) => ({ id: j.id, title: j.title, status: j.status })),
          },
        };
      }
    } else if (jobs.length === 1) {
      job = jobs[0];
    }
  }

  let invoice;
  try {
    if (job && remainingToInvoiceForJob(job.id) > 0) {
      invoice = createNextInvoiceForJob(job.id, "assistent");
      if (!invoice.rot || invoice.rot.type !== input.type) {
        invoice = updateInvoice(
          invoice.id,
          { lines: invoice.lines, rot: { type: input.type }, taxReductionDetails: invoice.taxReductionDetails },
          "assistent"
        );
      }
    } else {
      const title = input.titleHint?.trim() || job?.title || `${kind}-arbete`;
      const lines = [laborLine(title, input.amountInclVat ?? 0)];
      if (input.appliedTaxReduction != null) {
        rotWithAmounts(
          {
            type: input.type,
            appliedTaxReduction: Math.round(input.appliedTaxReduction),
            taxReductionManuallyAdjusted: true,
          },
          lines,
          { mode: "strict", documentKind: "faktura" }
        );
      }
      invoice = createInvoice(
        {
          customerId: customer.id,
          jobId: job?.id,
          quoteId: job?.quoteId,
          type: "faktura",
          lines,
          taxReductionDetails: location
            ? {
                workAddress: formatLocationAddress(location) || undefined,
                housing: workLocationToHousing(location),
              }
            : undefined,
          rot:
            input.appliedTaxReduction != null
              ? {
                  type: input.type,
                  appliedTaxReduction: Math.round(input.appliedTaxReduction),
                  taxReductionManuallyAdjusted: true,
                }
              : { type: input.type },
        },
        "assistent"
      );
    }

    if (input.appliedTaxReduction != null && invoice.rot?.appliedTaxReduction !== Math.round(input.appliedTaxReduction)) {
      invoice = updateInvoice(
        invoice.id,
        {
          lines: invoice.lines,
          rot: {
            type: input.type,
            appliedTaxReduction: Math.round(input.appliedTaxReduction),
            taxReductionManuallyAdjusted: true,
          },
          taxReductionDetails: invoice.taxReductionDetails,
        },
        "assistent"
      );
    }
  } catch (e) {
    if (invoice?.status === "utkast") {
      try {
        discardInvoice(invoice.id, "assistent");
      } catch {
        /* already failed */
      }
    }
    return fail(e instanceof Error ? e.message : "Kunde inte skapa fakturan.");
  }

  const prefill = resolveTaxReductionPrefill({
    customerId: customer.id,
    jobId: job?.id ?? invoice.jobId,
    details: invoice.taxReductionDetails,
  });
  const missing = taxReductionMissingFields({
    type: input.type,
    personalIdentityNumber: customer.personalIdentityNumber,
    details: detailsFromPrefill(prefill),
    scope: "invoice",
  });
  const t = invoiceTotals(invoice);
  const applied = invoice.rot?.appliedTaxReduction ?? t.deduction;
  const appliedNote = input.appliedTaxReduction != null ? ` Preliminärt ${kind}-avdrag ${kr(applied)}.` : "";
  const missingText =
    missing.length === 0
      ? ""
      : missing.length === 1
        ? ` Jag hittar inte på saknade uppgifter. ${missing[0].label} saknas för ${kind}-ansökan.`
        : ` Jag hittar inte på saknade uppgifter. ${missing[0].label} saknas.`;
  return {
    ok: true,
    text: `Klart – utkast till ${kind}-faktura för ${job ? job.title : customer.name} på ${kr(t.toPay)}. Villkoren är preliminära.${appliedNote}${missingText}`,
    card: entityCard(
      "faktura",
      `${kind}-fakturautkast`,
      `/ekonomi/fakturor/${invoice.id}`,
      `${customer.name} · ${kr(t.toPay)} · utkast`
    ),
    forModel: {
      invoiceId: invoice.id,
      number: null,
      status: invoice.status,
      sent: false,
      taxReduction: input.type,
      jobId: job?.id ?? null,
      appliedTaxReduction: applied,
      calculatedEligibleTaxReduction: t.calculatedEligibleTaxReduction,
      missingFields: missing.map((m) => m.code),
      missingLabels: missing.map((m) => m.label),
      personalIdentityNumberMasked: prefill.personalIdentityNumber
        ? maskPersonnummer(prefill.personalIdentityNumber)
        : null,
    },
  };
}

export function createFinalInvoiceDraft(jobId: string): DomainResult {
  const job = getJob(jobId);
  if (!job) return fail("Uppdraget finns inte.");
  const remaining = remainingToInvoiceForJob(jobId);
  if (remaining <= 0) {
    return {
      ok: false,
      text: "Det finns inget kvar att fakturera på uppdraget.",
      forModel: { error: "nothing_to_invoice", jobId },
    };
  }
  const invoice = createFinalInvoiceForJob(jobId, "assistent");
  const customer = requireCustomer(job.customerId);
  const t = invoiceTotals(invoice);
  return {
    ok: true,
    text: `Klart – utkast till slutfaktura för ${job.title} på ${kr(t.toPay)}. Den har inget löpnummer än och är inte skickad.`,
    card: entityCard(
      "faktura",
      "Slutfaktura (utkast)",
      `/ekonomi/fakturor/${invoice.id}`,
      `${customer.name} · ${kr(t.toPay)} · utkast`
    ),
    forModel: { invoiceId: invoice.id, number: null, status: invoice.status, sent: false },
  };
}

/**
 * Nästa fakturautkast för ett uppdrag: del enligt betalningsplanen, annars
 * resterande som slutfaktura. Samma tjänst (createNextInvoiceForJob) som
 * åtgärdsmotorns "Skapa faktura"-knapp på Hem – pengalogiken räknas aldrig om.
 */
export function createJobInvoiceDraft(jobId: string, basis?: JobInvoiceBasis): DomainResult {
  const job = getJob(jobId);
  if (!job) return fail("Uppdraget finns inte.");
  const choice = jobInvoiceChoice(jobId);
  const remaining = remainingToInvoiceForJob(jobId);
  const resolved: JobInvoiceBasis =
    basis ??
    (choice.pricingKind === "lopande" && choice.options.some((o) => o.basis === "actuals")
      ? "actuals"
      : remaining > 0 && choice.options.some((o) => o.basis === "quote")
        ? "quote"
        : choice.options.some((o) => o.basis === "actuals")
          ? "actuals"
          : "empty");
  if (resolved !== "empty" && !choice.options.some((o) => o.basis === resolved) && remaining <= 0) {
    return {
      ok: false,
      text: "Det finns inget kvar att fakturera på uppdraget.",
      forModel: { error: "nothing_to_invoice", jobId },
    };
  }
  let invoice;
  try {
    invoice = createInvoiceForJob(jobId, resolved, "assistent");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Kunde inte skapa fakturan. Inget sparades.");
  }
  const customer = requireCustomer(job.customerId);
  const t = invoiceTotals(invoice);
  const typeLabel = invoice.type === "delbetalning" ? "Delbetalning (utkast)" : "Slutfaktura (utkast)";
  const warn = choice.warning
    ? ` Varning: ${kr(choice.warning.excess)} över offerten. Du kan skapa en tilläggsoffert från uppdraget.`
    : "";
  return {
    ok: true,
    text: `Klart – utkast till ${invoice.type === "delbetalning" ? "delbetalning" : "slutfaktura"} för ${job.title} på ${kr(t.toPay)}. Den har inget löpnummer än och är inte skickad.${warn}`,
    card: entityCard(
      "faktura",
      typeLabel,
      `/ekonomi/fakturor/${invoice.id}`,
      `${customer.name} · ${kr(t.toPay)} · utkast`
    ),
    forModel: {
      invoiceId: invoice.id,
      jobId,
      number: null,
      status: invoice.status,
      type: invoice.type,
      sent: false,
      basis: resolved,
      excess: choice.warning?.excess ?? 0,
    },
  };
}

export function proposeInvoiceForCustomer(customerId: string): DomainResult {
  const customer = requireCustomer(customerId);
  const jobs = db().jobs.filter((j) => j.customerId === customerId);
  const rows = jobs
    .map((j) => ({ job: j, remaining: remainingToInvoiceForJob(j.id) }))
    .filter((x) => x.remaining > 0);
  if (rows.length === 0) {
    return {
      ok: true,
      text: `${customer.name} har inget kvar att fakturera just nu.`,
      forModel: { customerId, remainingJobs: 0 },
    };
  }
  if (rows.length === 1) {
    const { job, remaining } = rows[0];
    const invoice = createFinalInvoiceForJob(job.id, "assistent");
    const t = invoiceTotals(invoice);
    const notes = job.notes.trim();
    const extraAsk = notes
      ? ` I anteckningarna står: “${notes.length > 180 ? notes.slice(0, 177) + "…" : notes}”. Ska extraarbete läggas till? Vilket belopp? Jag hittar inte på pris.`
      : "";
    return {
      ok: true,
      text: `Jag skapade ett utkast till slutfaktura för ${job.title} (${kr(remaining)} kvar). Den har inget löpnummer än och är inte skickad.${extraAsk}`,
      card: entityCard(
        "faktura",
        "Slutfaktura (utkast)",
        `/ekonomi/fakturor/${invoice.id}`,
        `${customer.name} · ${kr(t.toPay)} · utkast`
      ),
      forModel: { invoiceId: invoice.id, jobId: job.id, remaining, sent: false, notes: notes || null },
    };
  }
  return {
    ok: true,
    text: `${customer.name} har flera uppdrag med kvar att fakturera. Vilket ska jag slutfakturera?`,
    card: {
      kind: "list",
      title: "Kvar att fakturera",
      rows: rows.map(({ job, remaining }) => ({
        label: job.title,
        value: kr(remaining),
        href: `/uppdrag/${job.id}`,
      })),
    },
    forModel: {
      jobs: rows.map(({ job, remaining }) => ({ jobId: job.id, title: job.title, remaining, notes: job.notes.trim() || null })),
    },
  };
}

/** Läs uppdragsanteckningar och fråga om extraarbete – hitta aldrig på pris. */
export function proposeExtraFromNotes(customerId: string, amountInclVat?: number): DomainResult {
  const customer = requireCustomer(customerId);
  const jobs = db()
    .jobs.filter((j) => j.customerId === customerId)
    .filter((j) => j.notes.trim());
  if (jobs.length === 0) {
    return {
      ok: true,
      text: `${customer.name} har inga uppdragsanteckningar om extraarbete. Jag hittar inte på något belopp.`,
      forModel: { customerId, notes: false },
    };
  }
  const job = jobs.length === 1 ? jobs[0] : jobs.find((j) => j.status !== "klart") ?? jobs[0];
  const note = job.notes.trim();
  if (amountInclVat == null || !(amountInclVat > 0)) {
    return {
      ok: true,
      text: `I anteckningarna på ${job.title} står: “${note}”. Ska det faktureras som extraarbete? Vilket belopp ska det vara? Jag hittar inte på pris.`,
      card: {
        kind: "list",
        title: "Anteckning",
        rows: [{ label: job.title, value: note, href: `/uppdrag/${job.id}` }],
      },
      forModel: { jobId: job.id, notes: note, needsAmount: true, remainingToInvoice: remainingToInvoiceForJob(job.id) },
    };
  }
  const action: PendingAssistantAction = {
    id: uid(),
    type: "skapa_tillaggsoffert",
    customerId,
    jobId: job.id,
    title: `Tillägg – ${job.title}`,
    amountInclVat,
  };
  addPending(action);
  return {
    ok: true,
    text: `Ska jag skapa en tilläggsoffert för extraarbetet på ${job.title}? Beloppet är det du angav – jag hittar inte på pris. Den skickas inte förrän du bekräftar.`,
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: "Tilläggsoffert som utkast, utifrån uppdragsanteckningen. Inte en slutfaktura från den godkända offerten.",
      rows: [
        { label: job.title, value: kr(amountInclVat) },
        { label: "Anteckning", value: note.length > 120 ? note.slice(0, 117) + "…" : note },
      ],
      confirmLabel: "Skapa tilläggsoffert",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, jobId: job.id, amountInclVat, sent: false },
  };
}

export function requestSendQuote(quoteId: string): DomainResult {
  const quote = getQuote(quoteId);
  if (!quote) return fail("Offerten finns inte.");
  if (quote.status !== "utkast") {
    return fail(`Offert #${quote.number} är ${quoteStatusLabel(quote).toLowerCase()} och kan inte skickas som utkast.`);
  }
  const customer = requireCustomer(quote.customerId);
  const t = quoteTotals(quote);
  const action: PendingAssistantAction = { id: uid(), type: "skicka_offert", quoteId };
  addPending(action);
  return {
    ok: true,
    text: `Ska jag skicka offert #${quote.number} till ${customer.name}? Den går inte iväg förrän du bekräftar.`,
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: "Offerten skickas till kunden med länk för BankID-godkännande.",
      rows: [
        { label: `Offert #${quote.number}`, value: kr(t.toPay) },
        { label: "Till", value: customer.name },
      ],
      confirmLabel: "Skicka offert",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, quoteId, number: quote.number, sent: false },
  };
}

export function requestSendInvoice(invoiceId: string): DomainResult {
  const invoice = getInvoice(invoiceId);
  if (!invoice) return fail("Fakturan finns inte.");
  const customer = requireCustomer(invoice.customerId);
  const t = invoiceTotals(invoice);
  const label = invoice.number == null ? "fakturautkastet" : `faktura #${invoice.number}`;
  if (invoice.status !== "utkast") {
    const action: PendingAssistantAction = { id: uid(), type: "skicka_faktura", invoiceId };
    addPending(action);
    return {
      ok: true,
      text: `${label} är redan utfärdad. Ska jag skicka den igen till ${customer.name}? Samma nummer behålls.`,
      card: {
        kind: "confirm",
        actionId: action.id,
        summary: "Samma fakturanummer skickas igen. Inget nytt nummer tilldelas.",
        rows: [
          { label: invoice.number == null ? "Fakturautkast" : `Faktura #${invoice.number}`, value: kr(t.toPay) },
          { label: "Till", value: customer.name },
        ],
        confirmLabel: "Skicka igen",
        state: "vantar",
      },
      forModel: { pendingConfirmation: true, invoiceId, number: invoice.number, resent: true },
    };
  }
  const action: PendingAssistantAction = { id: uid(), type: "skicka_faktura", invoiceId };
  addPending(action);
  return {
    ok: true,
    text: `Ska jag skicka ${label} till ${customer.name}? Löpnummer tilldelas vid utfärdandet, och den går inte iväg förrän du bekräftar.`,
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: "Fakturan utfärdas (får nummer), skickas till kunden och bokförs.",
      rows: [
        { label: invoice.number == null ? "Fakturautkast" : `Faktura #${invoice.number}`, value: kr(t.toPay) },
        { label: "Till", value: customer.name },
      ],
      confirmLabel: "Skicka faktura",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, invoiceId, number: invoice.number, sent: false },
  };
}

export function requestRemindLate(): DomainResult {
  const late = db().invoices.filter(isOverdue);
  if (late.length === 0) {
    return { ok: true, text: "Inga fakturor är försenade just nu – allt ser bra ut.", forModel: { count: 0 } };
  }
  const action: PendingAssistantAction = { id: uid(), type: "paminn_forsenade", invoiceIds: late.map((i) => i.id) };
  addPending(action);
  return {
    ok: true,
    text: `Jag hittade ${late.length === 1 ? "1 försenad faktura" : `${late.length} försenade fakturor`}. Ska jag skicka påminnelser?`,
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: "Betalningspåminnelse skickas med e-post till varje kund.",
      rows: late.map((i) => ({
        label: `Faktura #${i.number} – ${requireCustomer(i.customerId).name}`,
        value: `${kr(invoiceTotals(i).toPay)} · ${daysOverdue(i)} dagar sen`,
      })),
      confirmLabel: late.length === 1 ? "Skicka påminnelse" : "Skicka påminnelser",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, count: late.length, sent: false },
  };
}

export function requestFollowUpQuotes(minDays = 7): DomainResult {
  const waiting = db().quotes.filter((q) => q.status === "skickad" && quoteWaitingDays(q) >= minDays);
  if (waiting.length === 0) {
    return {
      ok: true,
      text: `Ingen offert har väntat på BankID i mer än ${minDays} dagar.`,
      forModel: { count: 0 },
    };
  }
  const action: PendingAssistantAction = { id: uid(), type: "folj_upp_offerter", quoteIds: waiting.map((q) => q.id) };
  addPending(action);
  return {
    ok: true,
    text: "Dessa offerter väntar fortfarande på BankID-godkännande. Ska jag skicka en vänlig påminnelse?",
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: "En påminnelse med offertlänken skickas till varje kund.",
      rows: waiting.map((q) => ({
        label: `Offert #${q.number} – ${requireCustomer(q.customerId).name}`,
        value: `${kr(quoteTotals(q).toPay)} · väntat ${quoteWaitingDays(q)} dagar`,
      })),
      confirmLabel: "Skicka påminnelser",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, count: waiting.length, sent: false },
  };
}

export function unpaidInvoicesResult(): DomainResult {
  const unpaid = db().invoices.filter(isOpenReceivable);
  if (unpaid.length === 0) {
    return { ok: true, text: "Alla fakturor är betalda. Snyggt!", forModel: { count: 0, total: 0 } };
  }
  const total = unpaid.reduce((s, i) => s + invoiceTotals(i).toPay, 0);
  return {
    ok: true,
    text: `${unpaid.length === 1 ? "1 faktura väntar" : `${unpaid.length} fakturor väntar`} på betalning – totalt ${kr(total)}.`,
    card: {
      kind: "list",
      rows: unpaid.map((i) => ({
        label: `${requireCustomer(i.customerId).name} – faktura #${i.number}`,
        value: `${kr(invoiceTotals(i).toPay)}${isOverdue(i) ? ` · ${daysOverdue(i)} dagar sen` : ` · förfaller ${relativ(i.dueDate)}`}`,
        href: `/ekonomi/fakturor/${i.id}`,
      })),
    },
    forModel: {
      count: unpaid.length,
      total,
      invoices: unpaid.map((i) => ({
        id: i.id,
        number: i.number,
        customer: requireCustomer(i.customerId).name,
        toPay: invoiceTotals(i).toPay,
        overdue: isOverdue(i),
      })),
    },
  };
}

export function spendingRoomResult(): DomainResult {
  const f = financeOverview();
  return {
    ok: true,
    text: `Du har ${kr(f.bank)} på banken. Jag reserverar ${kr(f.moms)} för moms (betalas ${datumLang(f.momsDue)}), ${kr(
      f.fSkatt
    )} för F-skatt och ${kr(f.payrollReserve)} för löneskatter. Kommande räkningar ligger på ${kr(
      f.upcoming
    )}. Ungefär ${kr(f.available)} är tryggt att spendera utan att riskera momsen.`,
    forModel: { bank: f.bank, available: f.available, reserved: f.reserved, moms: f.moms, upcoming: f.upcoming },
  };
}

export function missingReceiptsResult(): DomainResult {
  const missing = db().expenses.filter((e) => e.status === "saknar_kvitto");
  if (missing.length === 0) {
    return { ok: true, text: "Alla köp har kvitton. Bokföringen är komplett.", forModel: { count: 0 } };
  }
  return {
    ok: true,
    text: `${missing.length === 1 ? "1 köp saknar kvitto" : `${missing.length} köp saknar kvitto`}:`,
    card: {
      kind: "list",
      rows: missing.map((e) => ({
        label: `${e.supplier} – ${kr(e.amount)}`,
        value: datumLang(e.date),
      })),
      links: [{ label: "Lägg till kvitton under Ekonomi", href: "/ekonomi?flik=utgifter" }],
    },
    forModel: { count: missing.length, suppliers: missing.map((e) => e.supplier) },
  };
}

export function companyStatusResult(): DomainResult {
  const s = businessStats();
  const f = financeOverview();
  return {
    ok: true,
    text: `Det går bra. Du har fakturerat ${kr(s.revenueMonth)} den här månaden och ${kr(s.revenueYear)} i år, med en uppskattad vinst på ${kr(
      s.profitYear
    )}. ${kr(s.unpaidSum)} väntar på betalning${s.overdueCount > 0 ? ` (varav ${kr(s.overdueSum)} är försenat)` : ""} och ${kr(
      s.upcomingIncome
    )} är på väg in från godkända offerter som inte fakturerats klart. På banken finns ${kr(f.bank)}, varav ungefär ${kr(f.available)} är tillgängligt efter moms, skatt och räkningar.`,
    card: { kind: "links", links: [{ label: "Öppna Ekonomi", href: "/ekonomi" }] },
    forModel: { revenueMonth: s.revenueMonth, unpaidSum: s.unpaidSum, available: f.available },
  };
}

export function momsResult(): DomainResult {
  const m = momsForCurrentPeriod();
  return {
    ok: true,
    text: `Beräknad moms att betala för ${m.namn} är ${kr(Math.max(0, m.attBetala))} (utgående ${kr(m.utgaende)} minus ingående ${kr(
      m.ingaende
    )}). Förfallodatum: ${datumLang(m.due)}. Beloppet uppdateras löpande när fakturor och kvitton bokförs.`,
    card: { kind: "links", links: [{ label: "Öppna Bokföring", href: "/bokforing" }] },
    forModel: { period: m.namn, toPay: Math.max(0, m.attBetala), due: m.due },
  };
}

export function todayAttentionResult(): DomainResult {
  const items = projectHomeAttention(getBusinessActions().attention);
  if (items.length === 0) {
    return { ok: true, text: "Inget särskilt just nu – allt är omhändertaget.", forModel: { count: 0 } };
  }
  const rows = items.slice(0, 8).map((item) => ({
    label: item.title,
    value: item.subtitle,
    href: item.href,
  }));
  return {
    ok: true,
    text: `Du har ${items.length === 1 ? "1 sak" : `${items.length} saker`} som behöver din uppmärksamhet idag.`,
    card: { kind: "list", title: "Att göra", rows },
    forModel: { count: items.length, kinds: items.map((i) => i.category) },
  };
}

/** Samma På gång-feed som Hem – inte en separat AI-logik. */
export function watchingResult(): DomainResult {
  const items = getBusinessActions().watching;
  if (items.length === 0) {
    return {
      ok: true,
      text: "Inget särskilt är på gång just nu – Driva håller koll och säger till när något behöver din uppmärksamhet.",
      forModel: { count: 0 },
    };
  }
  const rows = items.slice(0, 8).map((item) => ({
    label: item.title,
    value: item.subtitle,
    href: item.href,
  }));
  const summary = items
    .slice(0, 5)
    .map((item) => item.title)
    .join("; ");
  return {
    ok: true,
    text:
      items.length === 1
        ? `På gång: ${items[0].title}.`
        : `${items.length} saker är på gång. ${summary}.`,
    card: { kind: "list", title: "På gång", rows },
    forModel: { count: items.length, kinds: items.map((i) => i.category) },
  };
}

export function requestGenerateWebsite(description: string): DomainResult {
  const action: PendingAssistantAction = { id: uid(), type: "generera_hemsida", description };
  addPending(action);
  const existing = db().website;
  return {
    ok: true,
    text: existing
      ? "Jag tar fram ett nytt hemsideutkast utifrån din beskrivning. Det ersätter det nuvarande innehållet under Hemsida, men inget publiceras förrän du godkänner det. Ska jag köra?"
      : "Jag tar fram ett hemsideutkast utifrån din beskrivning. Du får förhandsgranska allt innan något publiceras. Ska jag köra?",
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: "Startsida, tjänster, om oss, galleri och kontaktformulär genereras.",
      confirmLabel: "Skapa utkast",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true },
  };
}

export function requestPublishWebsite(): DomainResult {
  if (!db().website) return fail("Det finns ingen hemsida att publicera.");
  const action: PendingAssistantAction = { id: uid(), type: "publicera_hemsida" };
  addPending(action);
  return {
    ok: true,
    text: "Ska jag publicera hemsidan? Den blir synlig för kunder först när du bekräftar.",
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: "Hemsidan publiceras på den publika sajten.",
      confirmLabel: "Publicera",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, published: false },
  };
}

export function requestBookExpense(input: { expenseId: string; category: string; jobId?: string }): DomainResult {
  const expense = db().expenses.find((e) => e.id === input.expenseId);
  if (!expense) return fail("Köpet finns inte.");
  const action: PendingAssistantAction = {
    id: uid(),
    type: "bokfor_utgift",
    expenseId: expense.id,
    category: input.category,
    jobId: input.jobId,
  };
  addPending(action);
  const job = input.jobId ? db().jobs.find((j) => j.id === input.jobId) : undefined;
  return {
    ok: true,
    text: `Köpet hos ${expense.supplier} på ${kr(expense.amount)} bokförs som ${input.category}${
      job ? ` och kopplas till ${job.title}` : ""
    }. Ser det rätt ut?`,
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: expense.receiptId
        ? "Verifikation skapas automatiskt med kvittot som underlag."
        : "Verifikation skapas automatiskt. Kvitto saknas fortfarande – ladda gärna upp det i efterhand.",
      rows: [
        { label: expense.supplier, value: kr(expense.amount) },
        { label: "Kategori", value: input.category },
        ...(job ? [{ label: "Kopplas till", value: job.title }] : []),
      ],
      confirmLabel: "Bokför",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, expenseId: expense.id },
  };
}

export function createCustomerDirect(input: {
  name: string;
  email: string;
  phone?: string;
  kind?: Customer["kind"];
}): DomainResult {
  const customer = createCustomer({
    kind: input.kind ?? "privat",
    name: input.name,
    email: input.email,
    phone: input.phone ?? "",
  });
  return {
    ok: true,
    text: `Klart – ${customer.name} är tillagd.`,
    card: entityCard("kund", customer.name, `/kunder/${customer.id}`, customer.email),
    forModel: { customerId: customer.id, name: customer.name },
  };
}

export function compactCustomer(c: Customer) {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    email: c.email,
    phone: c.phone,
    city: c.city,
    hasPersonalIdentityNumber: Boolean(c.personalIdentityNumber),
    workLocations: workLocationsForModel(c),
  };
}

export function compactJob(j: Job) {
  const customer = getCustomer(j.customerId);
  const actuals = actualEntries(j.id);
  return {
    id: j.id,
    title: j.title,
    status: j.status,
    lifecycle: derivedJobStatus(j),
    customerId: j.customerId,
    customerName: customer?.name,
    startDate: j.startDate,
    address: j.address ?? null,
    workLocationId: j.workLocationId ?? null,
    remainingToInvoice: remainingToInvoiceForJob(j.id),
    archived: Boolean(j.archivedAt),
    registeredHours: actuals.filter((e) => e.type === "labor").reduce((s, e) => s + e.qty, 0),
    uninvoicedActuals: actuals.filter((e) => !e.invoiceId).length,
    notes: j.notes.trim() || null,
    dwellingType: j.housing?.dwellingType ?? null,
    hasPropertyDesignation: Boolean(j.housing?.propertyDesignation),
  };
}

export function completeJobDraft(jobId: string): DomainResult {
  const job = getJob(jobId);
  if (!job) return fail("Uppdraget finns inte.");
  try {
    const updated = setJobStatus(jobId, "klart");
    return {
      ok: true,
      text: `Uppdraget ${updated.title} är markerat som klart. Fakturor och offerter påverkas inte.`,
      card: entityCard("uppdrag", updated.title, `/uppdrag/${updated.id}`),
      forModel: compactJob(updated),
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Kunde inte markera uppdraget som klart.");
  }
}

export function reopenJobDraft(jobId: string): DomainResult {
  const job = getJob(jobId);
  if (!job) return fail("Uppdraget finns inte.");
  try {
    const updated = reopenJob(jobId);
    return {
      ok: true,
      text: `Uppdrag återöppnades. Fakturor, offerter och betalningar är oförändrade.`,
      card: entityCard("uppdrag", updated.title, `/uppdrag/${updated.id}`),
      forModel: compactJob(updated),
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Kunde inte återöppna uppdraget.");
  }
}

export function requestDeleteOrArchiveJob(jobId: string): DomainResult {
  const job = getJob(jobId);
  if (!job) return fail("Uppdraget finns inte.");
  const policy = jobRemovalPolicy(jobId);
  const customer = requireCustomer(job.customerId);
  const action: PendingAssistantAction = { id: uid(), type: "ta_bort_uppdrag", jobId };
  addPending(action);
  if (policy.kind === "delete") {
    return {
      ok: true,
      text: `Ska jag ta bort uppdraget ${job.title}? Det är tomt – ingen godkänd offert, utfärdad faktura eller bokföring. Det går inte förrän du bekräftar.`,
      card: {
        kind: "confirm",
        actionId: action.id,
        summary: "Uppdraget tas bort. Inga fakturor eller offerter påverkas.",
        rows: [
          { label: job.title, value: customer.name },
          { label: "Åtgärd", value: "Tas bort" },
        ],
        confirmLabel: "Ta bort uppdrag",
        state: "vantar",
      },
      forModel: { pendingConfirmation: true, jobId, kind: "delete" },
    };
  }
  return {
    ok: true,
    text: `Ska jag arkivera uppdraget ${job.title}? ${policy.reasons.join(", ")} raderas inte. Det går inte förrän du bekräftar.`,
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: "Uppdraget arkiveras. Fakturor, offerter, betalningar och bokföring påverkas inte.",
      rows: [
        { label: job.title, value: customer.name },
        { label: "Behålls", value: policy.reasons.join(", ") },
      ],
      confirmLabel: "Arkivera uppdrag",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, jobId, kind: "archive", reasons: policy.reasons },
  };
}

export function registerJobTimeDraft(input: {
  jobId: string;
  hours: number;
  description?: string;
  date?: string;
  unitPrice?: number;
}): DomainResult {
  const job = getJob(input.jobId);
  if (!job) return fail("Uppdraget finns inte.");
  let entry;
  try {
    entry = registerJobTime(job.id, {
      hours: input.hours,
      description: input.description,
      date: input.date,
      unitPrice: input.unitPrice,
      source: "ai",
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Kunde inte registrera tiden.");
  }
  const extra = entry.isExtra ? " Markerat som tillägg (ej i ursprunglig offert)." : "";
  return {
    ok: true,
    text: `Registrerade ${entry.qty} timmar på ${job.title}.${extra}`,
    card: entityCard("uppdrag", job.title, `/uppdrag/${job.id}`, `${entry.description} · ${entry.qty} tim · ${entry.date}`),
    forModel: { entryId: entry.id, jobId: job.id, hours: entry.qty, isExtra: entry.isExtra, source: entry.source },
  };
}

export function addJobMaterialDraft(input: {
  jobId: string;
  description: string;
  qty: number;
  unitPrice: number;
  unit?: string;
  date?: string;
}): DomainResult {
  const job = getJob(input.jobId);
  if (!job) return fail("Uppdraget finns inte.");
  let entry;
  try {
    entry = addJobMaterial(job.id, {
      description: input.description,
      qty: input.qty,
      unitPrice: input.unitPrice,
      unit: input.unit,
      date: input.date,
      source: "ai",
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Kunde inte lägga till material.");
  }
  const extra = entry.isExtra ? " Markerat som tillägg." : "";
  return {
    ok: true,
    text: `Lade till ${entry.description} på ${job.title}.${extra}`,
    card: entityCard("uppdrag", job.title, `/uppdrag/${job.id}`, `${entry.qty} ${entry.unit} · ${kr(entry.unitPrice)}`),
    forModel: { entryId: entry.id, jobId: job.id, isExtra: entry.isExtra, source: entry.source },
  };
}

export function compactQuote(q: Quote) {
  const t = quoteTotals(q);
  return {
    id: q.id,
    number: q.number,
    status: q.status,
    statusLabel: quoteStatusLabel(q),
    customerName: requireCustomer(q.customerId).name,
    title: currentVersion(q).title,
    total: t.total,
    toPay: t.toPay,
    rot: currentVersion(q).rot?.type ?? null,
  };
}

export function compactInvoice(i: Invoice) {
  const t = invoiceTotals(i);
  return {
    id: i.id,
    number: i.number,
    status: i.status,
    type: i.type,
    customerName: requireCustomer(i.customerId).name,
    toPay: t.toPay,
    dueDate: i.dueDate,
    overdue: isOverdue(i),
  };
}

export function bankIdRefuseResult(): DomainResult {
  return {
    ok: true,
    text: "Jag kan inte godkänna offerter. Det kan bara kunden göra med BankID på offertlänken. Vill du att jag skickar en påminnelse i stället?",
    forModel: { refused: "bankid_approval" },
  };
}

export function businessProfileResult(): DomainResult {
  const s = getBusinessProfile();
  const d = getInvoiceDefaults();
  const ready = billingReadiness(s);
  return {
    ok: true,
    text: `${s.name} har org.nr ${s.orgNumber || "saknas"} och momsreg.nr ${s.vatNumber || "saknas"}. ${ready.ready ? "Fakturering är redo." : `${ready.missingCount} uppgifter saknas för att kunna fakturera.`}`,
    card: {
      kind: "list",
      title: "Företagsuppgifter",
      rows: [
        { label: "Företag", value: s.name },
        { label: "Org.nr", value: s.orgNumber || "–" },
        { label: "Momsreg.nr", value: s.vatNumber || "–" },
        { label: "Adress", value: [s.address, s.postalCode, s.city].filter(Boolean).join(", ") || "–" },
        { label: "E-post", value: s.email || "–" },
        { label: "Telefon", value: s.phone || "–" },
        { label: "Bankgiro", value: s.bankgiro || "–" },
        { label: "Betalningsvillkor", value: `${d.paymentTermsDays} dagar` },
        { label: "Dröjsmålsränta", value: `${d.lateInterestRate} %` },
      ],
      links: [{ label: "Öppna Inställningar", href: "/installningar" }],
    },
    forModel: {
      name: s.name,
      orgNumber: s.orgNumber,
      vatNumber: s.vatNumber,
      email: s.email,
      phone: s.phone,
      address: s.address,
      postalCode: s.postalCode,
      city: s.city,
      bankgiro: s.bankgiro,
      readyToInvoice: ready.ready,
    },
  };
}

export function requestUpdateBusinessProfile(patch: Record<string, string | number | null>): DomainResult {
  const keys = Object.keys(patch).filter((k) => k in SETTINGS_FIELD_LABELS && patch[k] !== undefined);
  if (keys.length === 0) return fail("Inget att ändra. Säg vad som ska uppdateras, till exempel bankgiro.");
  const current = getBusinessProfile();
  const defaults = getInvoiceDefaults();
  const currentMap: Record<string, string | number | undefined> = {
    ...current,
    ...defaults,
  };
  const rows = keys.map((key) => ({
    label: SETTINGS_FIELD_LABELS[key] ?? key,
    value: `${fmt(currentMap[key])} → ${fmt(patch[key])}`,
  }));
  const action: PendingAssistantAction = { id: uid(), type: "uppdatera_foretag", patch };
  addPending(action);
  const sensitive = keys.some((k) => ["bankgiro", "plusgiro", "iban", "bic", "bankAccount", "orgNumber", "vatNumber"].includes(k));
  return {
    ok: true,
    text: sensitive
      ? "Det här ändrar betalnings- eller bolagsuppgifter. Bekräfta så sparar jag det i Inställningar. Utfärdade fakturor ändras inte."
      : "Så här blir ändringen i Inställningar. Bekräfta så sparar jag. Utfärdade fakturor och signerade offerter ändras inte.",
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: rows.map((r) => `${r.label}: ${r.value}`).join(" · "),
      rows,
      confirmLabel: "Bekräfta",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, fields: keys },
  };
}

function fmt(value: string | number | null | undefined): string {
  if (value == null || value === "") return "–";
  return String(value);
}

function fail(text: string): DomainResult {
  return { ok: false, text, forModel: { error: text } };
}

export async function checkDomainAvailabilityResult(query: string): Promise<DomainResult> {
  try {
    const result = await searchDomain(query, "assistent");
    if (result.available) {
      return {
        ok: true,
        text: `${result.hostname} är ledig${result.price ? ` för ${kr(result.price.customerPrice)}/år` : ""}. Köp sker bara om du bekräftar.`,
        card: {
          kind: "list",
          title: result.hostname,
          rows: [
            { label: "Status", value: "Ledig" },
            ...(result.price ? [{ label: "Pris", value: `${kr(result.price.customerPrice)}/år` }] : []),
          ],
          links: [{ label: "Öppna Domän", href: "/hemsida/doman" }],
        },
        forModel: { hostname: result.hostname, available: true, price: result.price?.customerPrice ?? null },
      };
    }
    return {
      ok: true,
      text: `${result.hostname} är upptagen.${result.alternatives.length ? ` Alternativ: ${result.alternatives.join(", ")}.` : ""}`,
      card: {
        kind: "list",
        title: "Upptagen",
        rows: result.alternatives.map((a) => ({ label: a })),
        links: [{ label: "Öppna Domän", href: "/hemsida/doman" }],
      },
      forModel: { hostname: result.hostname, available: false, alternatives: result.alternatives },
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Kunde inte söka.");
  }
}

export function getDomainStatusResult(): DomainResult {
  const domain = primaryDomain();
  if (!domain) {
    return {
      ok: true,
      text: "Ingen egen .se-adress är kopplad ännu.",
      card: { kind: "links", links: [{ label: "Skaffa .se-adress", href: "/hemsida/doman" }] },
      forModel: { domain: null },
    };
  }
  const view = domainCardView(domain, getBusinessProfile());
  return {
    ok: true,
    text: view.live
      ? `${view.hostname} är live.`
      : `${view.hostname} kopplas just nu.`,
    card: {
      kind: "list",
      title: view.hostname,
      rows: [{ label: "Status", value: view.live ? "Live" : "Kopplas" }],
      links: [{ label: "Öppna Domän", href: "/hemsida/doman" }],
    },
    forModel: { hostname: view.hostname, status: domain.status, live: view.live },
  };
}

export function requestPurchaseDomain(hostname: string): DomainResult {
  const action: PendingAssistantAction = { id: uid(), type: "kop_doman", hostname };
  addPending(action);
  const s = getBusinessProfile();
  return {
    ok: true,
    text: `Ska jag köpa och koppla ${hostname}? Den registreras på ${s.name} och förnyas automatiskt varje år. Inget köps förrän du bekräftar.`,
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: `Registreras på ${s.name} · ${s.orgNumber}. Förnyas automatiskt varje år.`,
      rows: [
        { label: hostname, value: "Köp och koppla" },
        { label: "Företag", value: `${s.name} · ${s.orgNumber}` },
      ],
      confirmLabel: "Köp och koppla",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, hostname, purchased: false },
  };
}

/**
 * Sanningsenlig beskrivning av betalningsuppgifternas tillstånd för AI:n:
 * orsak + klartext + eventuellt tidigare verifierade uppgifter. AI:n läser
 * ENDAST härifrån – den hittar aldrig på betalningsuppgifter.
 */
function paymentDetailsForModel(invoice: SupplierInvoice) {
  if (invoice.status === "betald") return { state: "VERIFIED" as const, blockedReason: null };
  const info = paymentDetailsInfo(invoice);
  return {
    state: info.cause,
    blockedReason: paymentDetailsBlockedReason(info.cause, invoice.supplier),
    verifiedAccount: info.cause === "VERIFIED" || info.cause === "CHANGED" ? info.account : undefined,
    candidateAccount: info.candidate?.account,
    awaitingSupplierSince: info.request?.sentAt,
    previousVerified: info.previous
      ? {
          account: info.previous.account,
          verifiedVia: `${provenanceLabel(info.previous.source)} ${info.previous.verifiedAt.slice(0, 10)}`,
        }
      : undefined,
    /** Kan kompletteras med use_verified_supplier_details (kräver bekräftelse). */
    reusable: info.reusable,
  };
}

export function listSupplierInvoicesResult(q?: string): DomainResult {
  const query = (q ?? "").trim().toLowerCase();
  const rows = db().supplierInvoices.filter((s) => {
    if (!query) return true;
    const hay = `${s.supplier} ${s.invoiceNumber} ${s.ocr ?? ""} ${s.bankgiro ?? ""} ${s.amount}`.toLowerCase();
    return hay.includes(query);
  });
  if (rows.length === 0) {
    return { ok: true, text: query ? `Inga leverantörsfakturor matchar ”${query}”.` : "Inga leverantörsfakturor.", forModel: { count: 0, invoices: [] } };
  }
  return {
    ok: true,
    text: `${rows.length} leverantörsfakturor.`,
    card: {
      kind: "list",
      title: "Leverantörsfakturor",
      rows: rows.slice(0, 20).map((s) => ({
        label: `${s.supplier} · ${s.invoiceNumber}`,
        value: kr(s.amount),
        href: s.inboxItemId ? `/inbox/${s.inboxItemId}` : "/ekonomi?flik=utgifter",
      })),
      links: [{ label: "Öppna Ekonomi", href: "/ekonomi?flik=utgifter" }],
    },
    forModel: {
      count: rows.length,
      invoices: rows.slice(0, 20).map((s) => ({
        id: s.id,
        supplier: s.supplier,
        invoiceNumber: s.invoiceNumber,
        amount: s.amount,
        dueDate: s.dueDate,
        accountingStatus: s.accountingStatus,
        paymentStatus: s.status,
        ocr: s.ocr,
        bankgiro: s.bankgiro,
        paymentDetails: paymentDetailsForModel(s),
      })),
    },
  };
}

export function getSupplierInvoiceResult(id: string): DomainResult {
  const invoice = db().supplierInvoices.find((s) => s.id === id);
  if (!invoice) return fail("Leverantörsfakturan finns inte.");
  const details = paymentDetailsForModel(invoice);
  return {
    ok: true,
    text: `${invoice.supplier} ${invoice.invoiceNumber} · ${kr(invoice.amount)} · förfaller ${invoice.dueDate.slice(0, 10)}.${details.blockedReason ? ` ${details.blockedReason}` : ""}`,
    forModel: {
      id: invoice.id,
      supplier: invoice.supplier,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      vatAmount: invoice.vatAmount,
      dueDate: invoice.dueDate,
      accountingStatus: invoice.accountingStatus,
      status: invoice.status,
      ocr: invoice.ocr,
      bankgiro: invoice.bankgiro,
      inboxItemId: invoice.inboxItemId,
      paymentDetails: details,
    },
  };
}

/**
 * "Använd samma bankgiro som förra fakturan" – bygger bekräftelsekort ur
 * leverantörens VERIFIERADE historik. Utför inget själv; människan bekräftar
 * (samma mönster som skicka_leverantorsbetalning). AI:n kan aldrig ange ett
 * eget konto här – uppgifterna hämtas ur domänen.
 */
export function requestUseVerifiedSupplierDetails(invoiceId: string): DomainResult {
  const invoice = db().supplierInvoices.find((s) => s.id === invoiceId);
  if (!invoice) return fail("Leverantörsfakturan finns inte.");
  if (invoice.status === "betald") return fail("Fakturan är redan betald.");
  const info = paymentDetailsInfo(invoice);
  if (info.cause === "VERIFIED") return fail("Fakturan har redan verifierade betalningsuppgifter.");
  if (info.cause === "CHANGED") {
    return fail(
      "Fakturan visar nya betalningsuppgifter jämfört med tidigare – ändringen måste kontrolleras mot dokumentet i stället för att gamla uppgifter återanvänds."
    );
  }
  if (!info.previous) {
    return fail(`Det finns inga tidigare verifierade betalningsuppgifter för ${invoice.supplier}.`);
  }
  const prev = info.previous;
  const action: PendingAssistantAction = { id: uid(), type: "anvand_leverantorsuppgifter", supplierInvoiceId: invoice.id };
  addPending(action);
  return {
    ok: true,
    text: `${invoice.supplier} har tidigare verifierade uppgifter: ${prev.account}. Ska jag använda dem för ${invoice.invoiceNumber}? Inget sparas förrän du bekräftar.`,
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: "Uppgifterna hämtas från leverantörens tidigare verifierade betalning – aldrig från en gissning.",
      rows: [
        { label: "Leverantör", value: invoice.supplier },
        { label: "Konto", value: prev.account },
        { label: "Verifierat via", value: `${provenanceLabel(prev.source)} ${prev.verifiedAt.slice(0, 10)}` },
        { label: "Faktura", value: `${invoice.invoiceNumber} · ${kr(invoice.amount)}` },
      ],
      confirmLabel: "Använd tidigare uppgifter",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, invoiceId: invoice.id, account: prev.account, attached: false },
  };
}

export function prepareSupplierPaymentResult(invoiceId: string, scheduledDate?: string): DomainResult {
  try {
    const payment = prepareSupplierPayment({ supplierInvoiceId: invoiceId, scheduledDate });
    const invoice = db().supplierInvoices.find((s) => s.id === invoiceId);
    return {
      ok: true,
      text: `Betalning till ${invoice?.supplier ?? "leverantören"} på ${kr(payment.amount)} är förberedd. Den skickas inte förrän du bekräftar.`,
      forModel: {
        paymentId: payment.id,
        status: payment.status,
        amount: payment.amount,
        scheduledDate: payment.scheduledDate,
        recipientAccount: payment.recipientAccount,
        destinationChanged: payment.destinationChanged ?? false,
        submitted: false,
      },
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Kunde inte förbereda betalningen.");
  }
}

export function requestSubmitSupplierPayment(paymentId: string): DomainResult {
  const payment = supplierPayments().find((p) => p.id === paymentId);
  if (!payment) return fail("Betalningen finns inte.");
  const invoice = getSupplierInvoice(payment.supplierInvoiceId);
  if (!invoice) return fail("Leverantörsfakturan finns inte.");
  const action: PendingAssistantAction = { id: uid(), type: "skicka_leverantorsbetalning", paymentId: payment.id };
  addPending(action);
  return {
    ok: true,
    text: `Ska jag skicka ${kr(payment.amount)} till ${invoice.supplier}? Pengarna går inte iväg förrän du bekräftar.`,
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: "Betalningen skickas till banken. Driva hittar aldrig på att den är betald.",
      rows: supplierPaymentConfirmRows(payment, invoice),
      confirmLabel: "Skicka till bank",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, paymentId: payment.id, submitted: false },
  };
}

export function requestCancelSupplierPayment(paymentId: string): DomainResult {
  const payment = supplierPayments().find((p) => p.id === paymentId);
  if (!payment) return fail("Betalningen finns inte.");
  const invoice = getSupplierInvoice(payment.supplierInvoiceId);
  const action: PendingAssistantAction = { id: uid(), type: "avbryt_leverantorsbetalning", paymentId: payment.id };
  addPending(action);
  return {
    ok: true,
    text: `Ska jag avbryta betalningen till ${invoice?.supplier ?? "leverantören"}?`,
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: "Instruktionen avbryts. En redan genomförd betalning kan inte avbrytas.",
      rows: [{ label: invoice?.supplier ?? "Leverantör", value: kr(payment.amount) }],
      confirmLabel: "Avbryt betalning",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, paymentId: payment.id, cancelled: false },
  };
}

/**
 * Vad Driva LÄST ur ett inkommande dokument – fält för fält med mänskliga
 * lägen ("saker"/"kontrollera"), aldrig råa sannolikheter som beslut.
 * Samma läsmodell som Kontrollera-vyn (services/inbox.ts).
 */
export function reviewDocumentExtractionResult(itemId: string): DomainResult {
  try {
    const review = extractionReviewForItem(itemId);
    const uncertain = review.fields.filter((f) => f.state === "kontrollera");
    const summary =
      uncertain.length === 0
        ? "Alla lästa fält är säkra."
        : `${uncertain.length} fält behöver kontrolleras: ${uncertain.map((f) => f.label).join(", ")}.`;
    return {
      ok: true,
      text: `${review.documentType === "kvitto" ? "Kvitto" : "Leverantörsfaktura"} – ${summary}${review.editable ? " Uppgifterna godkänns i Kontrollera-vyn." : review.blockedReason ? ` ${review.blockedReason}` : ""}`,
      forModel: {
        itemId: review.itemId,
        documentType: review.documentType,
        editable: review.editable,
        blockedReason: review.blockedReason,
        fields: review.fields.map((f) => ({ key: f.key, label: f.label, value: f.value, state: f.state })),
      },
      card: {
        kind: "list",
        title: "Det här har Driva läst",
        rows: review.fields.map((f) => ({
          label: f.label,
          value: `${f.value == null ? "—" : typeof f.value === "number" ? kr(f.value) : f.value} · ${f.state === "saker" ? "Säker" : "Kontrollera"}`,
        })),
        links: [{ label: review.editable ? "Öppna Kontrollera-vyn" : "Öppna dokumentet", href: review.editable ? `/inbox/${review.itemId}/kontrollera` : `/inbox/${review.itemId}` }],
      },
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Kunde inte läsa dokumentet.");
  }
}

/** Säker fältändring på leverantörsfaktura – aldrig belopp eller betalningsuppgifter. */
export function updateSupplierInvoiceFieldResult(
  invoiceId: string,
  field: string,
  value: string
): DomainResult {
  if (field !== "description" && field !== "dueDate" && field !== "invoiceNumber") {
    return fail(
      "Bara description (beskrivning), dueDate (förfallodatum) och invoiceNumber (fakturanummer) kan ändras här. Belopp rättas via bokföringen och betalningsuppgifter via kontrollflödet – AI:n anger aldrig konton."
    );
  }
  try {
    const sup = updateSupplierInvoiceField({ invoiceId, field, value, by: "assistent" });
    return {
      ok: true,
      text: `Klart – ${sup.supplier} ${sup.invoiceNumber} är uppdaterad.`,
      forModel: {
        id: sup.id,
        supplier: sup.supplier,
        invoiceNumber: sup.invoiceNumber,
        dueDate: sup.dueDate,
        description: sup.description,
      },
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Kunde inte uppdatera fakturan.");
  }
}

/**
 * Bekräftelsekort för [Skapa bankfil] (pain.001). Validerar ALLT innan kortet
 * visas (exakta hinder i klartext) och skapar INGEN fil förrän användaren
 * bekräftar. Filen laddas upp manuellt i internetbanken – Driva påstår aldrig
 * att banken tagit emot något.
 */
export function requestGeneratePaymentFile(invoiceIds: string[]): DomainResult {
  const ids = [...new Set(invoiceIds.filter(Boolean))];
  if (ids.length === 0) return fail("Ange vilka leverantörsfakturor som ska betalas.");
  const problems = paymentFileBlockers(ids);
  if (problems.length > 0) return fail(problems.join(" "));

  const invoices = ids.map((id) => getSupplierInvoice(id)!);
  const total = invoices.reduce((sum, s) => sum + s.amount, 0);
  const payer = payerAccountLabel();
  const action: PendingAssistantAction = { id: uid(), type: "skapa_bankfil", supplierInvoiceIds: ids };
  addPending(action);
  const who = invoices.length === 1 ? invoices[0].supplier : `${invoices.length} leverantörer`;
  return {
    ok: true,
    text: `Ska jag skapa en bankfil (pain.001) för ${who} på totalt ${kr(total)}? Filen laddar du själv upp i internetbanken – inget betalas förrän du godkänner det där.`,
    card: {
      kind: "confirm",
      actionId: action.id,
      summary: "Bankfilen skapas och laddas ned – den skickas inte till banken och inget är betalt förrän du godkänner betalningen i internetbanken.",
      rows: [
        ...invoices.map((s) => ({
          label: `${s.supplier} · ${s.invoiceNumber}`,
          value: `${kr(s.amount)} · förfaller ${s.dueDate.slice(0, 10)}`,
        })),
        ...(invoices.length > 1 ? [{ label: "Totalt", value: kr(total) }] : []),
        ...(payer ? [{ label: "Från", value: `${db().settings.name}, ${payer}` }] : []),
      ],
      confirmLabel: "Skapa bankfil",
      state: "vantar",
    },
    forModel: { pendingConfirmation: true, supplierInvoiceIds: ids, totalAmount: total, fileCreated: false },
  };
}

/** Betalningsstatus för en leverantörsfaktura: bokföring, betalning, bankfil, avstämning – separata spår. */
export function getPaymentStatusResult(invoiceId: string): DomainResult {
  const invoice = db().supplierInvoices.find((s) => s.id === invoiceId);
  if (!invoice) return fail("Leverantörsfakturan finns inte.");
  const payment = supplierPayments()
    .filter((p) => p.supplierInvoiceId === invoice.id && p.status !== "CANCELLED")
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
  const file = payment?.paymentFileId ? getPaymentFile(payment.paymentFileId) : activePaymentFileForInvoice(invoice.id);
  const paid = invoice.status === "betald" || payment?.status === "PAID";
  const reconciled = paid && Boolean(invoice.bankTransactionId ?? payment?.bankTransactionId);
  const blockers = paid ? [] : paymentFileBlockersForInvoice(invoice.id);

  const paymentLabel = paid
    ? reconciled
      ? "Betald och avstämd mot banktransaktionen"
      : "Betald"
    : payment?.status === "PAYMENT_FILE_CREATED"
      ? "Bankfil skapad – väntar på uppladdning/godkännande i internetbanken"
      : payment
        ? supplierPaymentUiLabel(payment.status)
        : blockers.length === 0
          ? "Redo att betala"
          : "Inte redo";
  return {
    ok: true,
    text: `${invoice.supplier} ${invoice.invoiceNumber}: bokföring ${invoice.accountingStatus === "bokford" ? "bokförd" : "ej bokförd"} · betalning ${paymentLabel}${blockers.length ? ` · hinder: ${blockers.join(" ")}` : ""}`,
    forModel: {
      invoiceId: invoice.id,
      supplier: invoice.supplier,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      accountingStatus: invoice.accountingStatus,
      verificationId: invoice.verificationId,
      paymentStatus: payment?.status ?? (blockers.length === 0 ? "READY_TO_PAY" : "BLOCKED"),
      paymentBlockers: blockers,
      paymentFile: file
        ? { id: file.id, filename: file.filename, status: file.status, createdAt: file.createdAt }
        : undefined,
      paid,
      reconciled,
      bankTransactionId: invoice.bankTransactionId ?? payment?.bankTransactionId,
      paymentVerificationId: invoice.paymentVerificationId,
    },
  };
}
