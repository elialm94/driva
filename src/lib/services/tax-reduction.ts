import { db, save } from "../store";
import type {
  DwellingType,
  HousingDetails,
  Invoice,
  Job,
  TaxReductionApplication,
  TaxReductionDetails,
} from "../types";
import { currentVersion, getInvoice, getJob, invoiceTotals, jobQuote, requireCustomer } from "./data";
import { kr, datumKort } from "../format";
import { maskPersonnummer, normalizePersonnummer } from "../personnummer";
import { normalizeOrgnr } from "../invoices/formats";
import { logActivity } from "./activity";
import { docTotals } from "../calc";
import {
  taxReductionMissingFields,
  type TaxReductionMissingField,
} from "../tax-reduction-gaps";

export type {
  TaxReductionGapScope,
  TaxReductionMissingCode,
  TaxReductionMissingField,
} from "../tax-reduction-gaps";
export { taxReductionMissingFields, taxReductionMissingHint, formatWorkPeriodRange, suggestedServiceDate } from "../tax-reduction-gaps";

export interface TaxReductionPrefill {
  personalIdentityNumber: string;
  personalIdentityNumberMasked: string;
  workAddress: string;
  workPeriodStart: string;
  workPeriodEnd: string;
  housing: HousingDetails;
}

function isoDate(value?: string): string {
  return value ? value.slice(0, 10) : "";
}

export function formatWorkAddress(input: {
  address?: string;
  postalCode?: string;
  city?: string;
}): string {
  const line = [input.address, [input.postalCode, input.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return line.trim();
}

export function sanitizeHousing(housing?: HousingDetails | null): HousingDetails {
  if (!housing?.dwellingType) return {};
  if (housing.dwellingType === "smahus") {
    return {
      dwellingType: "smahus",
      propertyDesignation: housing.propertyDesignation?.trim() || undefined,
    };
  }
  return {
    dwellingType: "bostadsratt",
    brfOrgNumber: housing.brfOrgNumber?.trim() ? normalizeOrgnr(housing.brfOrgNumber) : undefined,
    apartmentNumber: housing.apartmentNumber?.trim() || undefined,
  };
}

export function mergeHousing(base?: HousingDetails | null, patch?: HousingDetails | null): HousingDetails {
  const dwellingType = patch?.dwellingType ?? base?.dwellingType;
  return sanitizeHousing({
    dwellingType,
    propertyDesignation: patch?.propertyDesignation ?? base?.propertyDesignation,
    brfOrgNumber: patch?.brfOrgNumber ?? base?.brfOrgNumber,
    apartmentNumber: patch?.apartmentNumber ?? base?.apartmentNumber,
  });
}

export function resolveTaxReductionPrefill(input: {
  customerId: string;
  jobId?: string;
  details?: TaxReductionDetails | null;
}): TaxReductionPrefill {
  const customer = requireCustomer(input.customerId);
  const job = input.jobId ? getJob(input.jobId) : undefined;
  const details = input.details;
  const pn = customer.personalIdentityNumber ?? "";
  const workAddress =
    details?.workAddress?.trim() ||
    job?.address?.trim() ||
    formatWorkAddress(customer);
  const workPeriodStart = isoDate(details?.workPeriodStart) || isoDate(job?.startDate);
  const workPeriodEnd = isoDate(details?.workPeriodEnd) || isoDate(job?.endDate) || isoDate(job?.completedAt);
  const housing = mergeHousing(job?.housing, details?.housing);
  return {
    personalIdentityNumber: pn,
    personalIdentityNumberMasked: pn ? maskPersonnummer(pn) : "",
    workAddress,
    workPeriodStart,
    workPeriodEnd,
    housing,
  };
}


export function detailsFromPrefill(prefill: TaxReductionPrefill): TaxReductionDetails {
  return {
    workAddress: prefill.workAddress || undefined,
    workPeriodStart: prefill.workPeriodStart || undefined,
    workPeriodEnd: prefill.workPeriodEnd || undefined,
    housing: sanitizeHousing(prefill.housing),
  };
}

/** Spara personnummer på kunden och bostad på uppdraget. Loggar aldrig personnummer. */
export function persistTaxReductionOwnership(input: {
  customerId: string;
  jobId?: string;
  personalIdentityNumber?: string;
  details?: TaxReductionDetails | null;
}): void {
  const customer = requireCustomer(input.customerId);
  if (input.personalIdentityNumber !== undefined) {
    const trimmed = input.personalIdentityNumber.trim();
    customer.personalIdentityNumber = trimmed ? normalizePersonnummer(trimmed) : undefined;
  }
  if (input.jobId && input.details) {
    const job = getJob(input.jobId);
    if (job) {
      if (input.details.workAddress?.trim()) job.address = input.details.workAddress.trim();
      if (input.details.workPeriodStart) job.startDate = input.details.workPeriodStart;
      if (input.details.workPeriodEnd) job.endDate = input.details.workPeriodEnd;
      if (input.details.housing && Object.keys(sanitizeHousing(input.details.housing)).length) {
        job.housing = mergeHousing(job.housing, input.details.housing);
      }
    }
  }
}

export type TaxReductionPhase =
  | "none"
  | "preliminar"
  | "waiting_payment"
  | "waiting_work"
  | "missing_fields"
  | "ready"
  | "underlag"
  | "godkant"
  | "delvis_godkant"
  | "nekat";

export interface TaxReductionCase {
  type: "rot" | "rut" | null;
  phase: TaxReductionPhase;
  nextStep: string | null;
  missing: TaxReductionMissingField[];
  application?: TaxReductionApplication;
  jobId?: string;
  invoiceId?: string;
  label: string;
  prefill: TaxReductionPrefill | null;
}

function rotInvoicesForJob(jobId: string): Invoice[] {
  return db().invoices.filter((i) => i.jobId === jobId && i.rot && i.type !== "kredit" && i.status !== "krediterad");
}

function customerSharePaid(invoices: Invoice[]): boolean {
  const relevant = invoices.filter((i) => i.status !== "utkast");
  if (relevant.length === 0) return false;
  return relevant.every((i) => i.status === "betald");
}

function workDone(job?: Job, invoice?: Invoice): boolean {
  if (job) return job.status === "klart";
  return Boolean(invoice && invoice.status !== "utkast" && (invoice.serviceDate || invoice.status === "betald"));
}

function nextStepForPhase(type: "rot" | "rut", phase: TaxReductionPhase, missing: TaxReductionMissingField[]): string | null {
  const kind = type === "rot" ? "ROT" : "RUT";
  switch (phase) {
    case "ready":
      return `${kind} redo att ansökas`;
    case "missing_fields":
      return missing[0] ? `En uppgift saknas för ${kind}` : `Uppgifter saknas för ${kind}`;
    case "underlag":
      return `Ansökningsunderlag skapat – markera ${kind}-beslut`;
    case "godkant":
      return `${kind} godkänt`;
    case "delvis_godkant":
      return `${kind} delvis godkänt`;
    case "nekat":
      return `${kind} nekat`;
    default:
      return null;
  }
}

function phaseFromApplication(
  type: "rot" | "rut",
  application: TaxReductionApplication | undefined,
  opts: { paid: boolean; done: boolean; missing: TaxReductionMissingField[]; hasIssued: boolean }
): TaxReductionPhase {
  const status = application?.status;
  if (status === "godkant" || status === "delvis_godkant" || status === "nekat" || status === "underlag_skapat") {
    return status === "underlag_skapat" ? "underlag" : status;
  }
  if (!opts.hasIssued) return "preliminar";
  if (!opts.paid) return "waiting_payment";
  if (!opts.done) return "waiting_work";
  if (opts.missing.length) return "missing_fields";
  return "ready";
}

export function taxReductionCaseForInvoice(invoice: Invoice): TaxReductionCase {
  if (!invoice.rot) {
    return {
      type: null,
      phase: "none",
      nextStep: null,
      missing: [],
      jobId: invoice.jobId,
      invoiceId: invoice.id,
      label: "",
      prefill: null,
    };
  }
  const type = invoice.rot.type;
  const job = invoice.jobId ? getJob(invoice.jobId) : undefined;
  const customer = requireCustomer(invoice.customerId);
  const prefill = resolveTaxReductionPrefill({
    customerId: invoice.customerId,
    jobId: invoice.jobId,
    details: invoice.taxReductionDetails,
  });
  const details = detailsFromPrefill(prefill);
  const missing = taxReductionMissingFields({
    type,
    personalIdentityNumber: customer.personalIdentityNumber,
    details,
    scope: "application",
  });
  const invoices = job ? rotInvoicesForJob(job.id) : [invoice];
  const application = job?.taxReductionApplication ?? invoice.taxReductionApplication;
  const paid = customerSharePaid(invoices);
  const done = workDone(job, invoice);
  const hasIssued = invoices.some((i) => i.status !== "utkast");
  const phase = phaseFromApplication(type, application, { paid, done, missing, hasIssued });
  return {
    type,
    phase,
    nextStep: nextStepForPhase(type, phase, missing),
    missing,
    application,
    jobId: job?.id,
    invoiceId: invoice.id,
    label: type === "rot" ? "ROT" : "RUT",
    prefill,
  };
}

export function taxReductionCaseForJob(job: Job): TaxReductionCase {
  const quote = jobQuote(job);
  const quoteRot = quote ? currentVersion(quote).rot : null;
  const invoices = rotInvoicesForJob(job.id);
  const type = invoices[0]?.rot?.type ?? quoteRot?.type ?? null;
  if (!type) {
    return {
      type: null,
      phase: "none",
      nextStep: null,
      missing: [],
      jobId: job.id,
      label: "",
      prefill: null,
    };
  }
  const invoice = invoices[0];
  const customer = requireCustomer(job.customerId);
  const prefill = resolveTaxReductionPrefill({
    customerId: job.customerId,
    jobId: job.id,
    details: invoice?.taxReductionDetails,
  });
  const missing = taxReductionMissingFields({
    type,
    personalIdentityNumber: customer.personalIdentityNumber,
    details: detailsFromPrefill(prefill),
    scope: "application",
  });
  const application = job.taxReductionApplication;
  const paid = customerSharePaid(invoices);
  const done = workDone(job, invoice);
  const hasIssued = invoices.some((i) => i.status !== "utkast");
  const phase = phaseFromApplication(type, application, { paid, done, missing, hasIssued });
  return {
    type,
    phase,
    nextStep: nextStepForPhase(type, phase, missing),
    missing,
    application,
    jobId: job.id,
    invoiceId: invoice?.id,
    label: type === "rot" ? "ROT" : "RUT",
    prefill,
  };
}

function applicationHost(jobId: string | undefined, invoice: Invoice | undefined): {
  set: (app: TaxReductionApplication) => void;
  get: () => TaxReductionApplication | undefined;
} {
  if (jobId) {
    const job = getJob(jobId);
    if (!job) throw new Error("Uppdraget finns inte");
    return {
      get: () => job.taxReductionApplication,
      set: (app) => {
        job.taxReductionApplication = app;
      },
    };
  }
  if (!invoice) throw new Error("Fakturan finns inte");
  return {
    get: () => invoice.taxReductionApplication,
    set: (app) => {
      invoice.taxReductionApplication = app;
    },
  };
}

function underlagText(input: {
  type: "rot" | "rut";
  customerName: string;
  personalIdentityNumber: string;
  details: TaxReductionDetails;
  laborInclVat: number;
  deduction: number;
  toPay: number;
}): string {
  const kind = input.type.toUpperCase();
  const housing = input.details.housing;
  const lines = [
    `Ansökningsunderlag ${kind}`,
    `Kund: ${input.customerName}`,
    `Personnummer: ${input.personalIdentityNumber}`,
    `Adress: ${input.details.workAddress ?? ""}`,
  ];
  if (input.type === "rot") {
    if (housing?.dwellingType === "smahus") {
      lines.push("Bostadstyp: Fastighet/småhus");
      lines.push(`Fastighetsbeteckning: ${housing.propertyDesignation ?? ""}`);
    } else if (housing?.dwellingType === "bostadsratt") {
      lines.push("Bostadstyp: Bostadsrätt");
      lines.push(`BRF organisationsnummer: ${housing.brfOrgNumber ?? ""}`);
      lines.push(`Lägenhetsnummer: ${housing.apartmentNumber ?? ""}`);
    }
  }
  const period = [input.details.workPeriodStart, input.details.workPeriodEnd]
    .filter(Boolean)
    .map((d) => datumKort(d!))
    .join(" – ");
  if (period) lines.push(`Arbetsperiod: ${period}`);
  lines.push(`Arbetskostnad inkl. moms: ${kr(input.laborInclVat)}`);
  lines.push(`Preliminärt ${kind}-avdrag: ${kr(input.deduction)}`);
  lines.push(`Kunden har betalat: ${kr(input.toPay)}`);
  lines.push("Ingen ansökan har skickats till Skatteverket – det här är underlag att använda manuellt.");
  return lines.join("\n");
}

export function createTaxReductionUnderlag(input: { jobId?: string; invoiceId?: string }): TaxReductionApplication {
  const invoice = input.invoiceId ? getInvoice(input.invoiceId) : undefined;
  const job = input.jobId ? getJob(input.jobId) : invoice?.jobId ? getJob(invoice.jobId) : undefined;
  const taxInvoice = invoice ?? (job ? rotInvoicesForJob(job.id)[0] : undefined);
  if (!taxInvoice?.rot) throw new Error("Ingen ROT/RUT-faktura att skapa underlag för.");

  const cse = taxReductionCaseForInvoice(taxInvoice);
  if (cse.phase === "waiting_payment" || cse.phase === "waiting_work" || cse.phase === "preliminar") {
    throw new Error("ROT/RUT kan inte ansökas ännu. Kunden ska ha betalat sin del och arbetet ska vara klart.");
  }
  if (cse.missing.length) {
    throw new Error(`En uppgift saknas för ${cse.label}: ${cse.missing.map((m) => m.label).join(", ")}.`);
  }

  const customer = requireCustomer(taxInvoice.customerId);
  const prefill = cse.prefill!;
  const details = detailsFromPrefill(prefill);
  const t = invoiceTotals(taxInvoice);
  const totals = job
    ? rotInvoicesForJob(job.id).reduce(
        (acc, inv) => {
          const x = docTotals(inv.issuedSnapshot?.lines ?? inv.lines, inv.rot);
          acc.laborInclVat += x.laborInclVat;
          acc.deduction += x.deduction;
          acc.toPay += x.toPay;
          return acc;
        },
        { laborInclVat: 0, deduction: 0, toPay: 0 }
      )
    : t;

  const summary = underlagText({
    type: taxInvoice.rot.type,
    customerName: customer.name,
    personalIdentityNumber: customer.personalIdentityNumber ? normalizePersonnummer(customer.personalIdentityNumber) : "",
    details,
    laborInclVat: totals.laborInclVat,
    deduction: totals.deduction,
    toPay: totals.toPay,
  });

  const app: TaxReductionApplication = {
    status: "underlag_skapat",
    underlagCreatedAt: new Date().toISOString(),
    underlagSummary: summary,
  };
  applicationHost(job?.id ?? taxInvoice.jobId, taxInvoice).set(app);
  logActivity(`Ansökningsunderlag för ${cse.label} skapades (${customer.name}, ${maskPersonnummer(customer.personalIdentityNumber ?? "")}).`, {
    customerId: customer.id,
    entity: { type: job ? "jobb" : "faktura", id: job?.id ?? taxInvoice.id },
  });
  save();
  return app;
}

export function setTaxReductionDecision(
  input: { jobId?: string; invoiceId?: string; outcome: "godkant" | "delvis_godkant" | "nekat"; deniedAmount?: number }
): TaxReductionApplication {
  const invoice = input.invoiceId ? getInvoice(input.invoiceId) : undefined;
  const job = input.jobId ? getJob(input.jobId) : invoice?.jobId ? getJob(invoice.jobId) : undefined;
  const taxInvoice = invoice ?? (job ? rotInvoicesForJob(job.id)[0] : undefined);
  if (!taxInvoice?.rot) throw new Error("Ingen ROT/RUT-faktura att besluta om.");
  const host = applicationHost(job?.id ?? taxInvoice.jobId, taxInvoice);
  const prev = host.get();
  if (!prev || prev.status === "preliminar" || prev.status === "redo_att_ansokas") {
    throw new Error("Skapa ansökningsunderlag innan du markerar beslut.");
  }
  const app: TaxReductionApplication = {
    ...prev,
    status: input.outcome,
    decision: {
      outcome: input.outcome,
      decidedAt: new Date().toISOString(),
      deniedAmount: input.deniedAmount,
    },
  };
  host.set(app);
  const customer = requireCustomer(taxInvoice.customerId);
  const kind = taxInvoice.rot.type.toUpperCase();
  const label =
    input.outcome === "godkant" ? "godkänt" : input.outcome === "delvis_godkant" ? "delvis godkänt" : "nekat";
  logActivity(`${kind} markerades som ${label} för ${customer.name}.`, {
    customerId: customer.id,
    entity: { type: job ? "jobb" : "faktura", id: job?.id ?? taxInvoice.id },
  });
  save();
  return app;
}

export function patchTaxReductionFields(input: {
  jobId?: string;
  invoiceId?: string;
  personalIdentityNumber?: string;
  details?: Partial<TaxReductionDetails>;
  dwellingType?: DwellingType;
  propertyDesignation?: string;
  brfOrgNumber?: string;
  apartmentNumber?: string;
  workAddress?: string;
  workPeriodStart?: string;
  workPeriodEnd?: string;
}): void {
  const invoice = input.invoiceId ? getInvoice(input.invoiceId) : undefined;
  const job = input.jobId ? getJob(input.jobId) : invoice?.jobId ? getJob(invoice.jobId) : undefined;
  const customerId = invoice?.customerId ?? job?.customerId;
  if (!customerId) throw new Error("Kunde inte hitta kund för ROT/RUT-uppgifterna.");

  const current = resolveTaxReductionPrefill({
    customerId,
    jobId: job?.id,
    details: invoice?.taxReductionDetails,
  });
  const housing = mergeHousing(current.housing, {
    dwellingType: input.dwellingType ?? input.details?.housing?.dwellingType,
    propertyDesignation: input.propertyDesignation ?? input.details?.housing?.propertyDesignation,
    brfOrgNumber: input.brfOrgNumber ?? input.details?.housing?.brfOrgNumber,
    apartmentNumber: input.apartmentNumber ?? input.details?.housing?.apartmentNumber,
  });
  const details: TaxReductionDetails = {
    workAddress: input.workAddress ?? input.details?.workAddress ?? current.workAddress,
    workPeriodStart: input.workPeriodStart ?? input.details?.workPeriodStart ?? current.workPeriodStart,
    workPeriodEnd: input.workPeriodEnd ?? input.details?.workPeriodEnd ?? current.workPeriodEnd,
    housing,
  };
  persistTaxReductionOwnership({
    customerId,
    jobId: job?.id,
    personalIdentityNumber: input.personalIdentityNumber,
    details,
  });
  if (invoice && invoice.status === "utkast") {
    invoice.taxReductionDetails = details;
  } else if (invoice) {
    invoice.taxReductionDetails = details;
  }
  save();
}

export function findJobsForTaxReduction(customerId: string, titleHint?: string): Job[] {
  const jobs = db().jobs.filter((j) => j.customerId === customerId);
  if (!titleHint?.trim()) return jobs;
  const n = titleHint.trim().toLowerCase();
  const matched = jobs.filter(
    (j) => j.title.toLowerCase().includes(n) || n.includes(j.title.toLowerCase())
  );
  return matched.length ? matched : jobs;
}
