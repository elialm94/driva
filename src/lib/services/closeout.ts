import { save } from "../store";
import { uid } from "../ids";
import { docTotals, lineTotal, lineVat } from "../calc";
import { kr } from "../format";
import { hasPaymentPlan } from "../payment-plan";
import { logAudit } from "../accounting/audit";
import { syncDocLineClassification } from "../economic-line-type";
import type {
  BillingDeferral,
  BillingSourceRef,
  BillingSourceType,
  CloseoutBillingMode,
  DocLine,
  Invoice,
  Job,
  JobChange,
  JobCloseoutEvent,
  JobCloseoutEventKind,
  JobCloseoutState,
  JobWorkEntry,
  Quote,
  QuoteVersion,
} from "../types";
import { currentVersion, getInvoice, getJob, invoiceTotals, invoicedTotalContribution, jobQuote, requireCustomer } from "./data";
import { invoicesForJobOrQuote } from "./job-economy";
import { nextPaymentPlanPartForQuote, lineWithPaymentPlanProvenance, lineWithQuoteProvenance } from "./business-chain";
import { actualEntries, associateEntriesWithInvoice, billsAsExtra, entryToDocLine } from "./job-work";
import { approvedJobChanges, billableChangeLines, changeLineToDocLine, jobChangesForJob } from "./job-changes";
import { BillingConflictError, sourceBillingState, syncAllocationsWithLines, type SourceBillingState } from "./billing-allocation";
import { createInvoice, createPartInvoiceForQuote } from "./invoices";
import { completeJob, reopenJob } from "./jobs";
import { logActivity } from "./activity";

/**
 * Avsluta uppdrag – det guidade flödet.
 *
 *   1. Kontrollera jobbet (checklista, väntande ändringar, öppna utkast).
 *   2. Vad ska faktureras nu? Alla fakturerbara källor med status; beslut
 *      "Inte fakturerbart" / "Hantera senare" sparas på uppdraget.
 *   3. Faktureringssätt: slutfaktura, delfaktura, löpande eller ingen.
 *   4. "Skapa fakturautkast" – ett utkast, aldrig ett utskick.
 *
 * All beräkning sker här på servern. Tidigare fakturor, krediter (hel/del),
 * avrundning, moms, ROT/RUT och omvänd byggmoms hanteras av createInvoice och
 * jobMoney; allokeringen (strict) gör dubbelfakturering omöjlig.
 */

export type CloseoutItemGroup = "avtalat" | "andringar" | "tillagg";
export type CloseoutItemState = "fakturerbar" | "utkast" | "fakturerad" | "inte_fakturerbart" | "hantera_senare";

export interface CloseoutItem {
  /** Nyckel = `${sourceType}:${sourceId}` – används av UI:t för val och beslut. */
  key: string;
  sourceType: BillingSourceType;
  sourceId: string;
  group: CloseoutItemGroup;
  label: string;
  detail?: string;
  amountExclVat: number;
  amountInclVat: number;
  state: CloseoutItemState;
  invoiceId?: string;
  invoiceNumber?: number;
  deferral?: BillingDeferral;
}

export interface CloseoutChecks {
  checklistOpen: number;
  checklistTotal: number;
  pendingChanges: JobChange[];
  draftChanges: JobChange[];
  openDrafts: Invoice[];
  photoCount: number;
  registeredWorkInclVat: number;
}

export interface CloseoutBasis {
  job: Job;
  quote?: Quote;
  version?: QuoteVersion;
  items: CloseoutItem[];
  checks: CloseoutChecks;
  totals: {
    /** Fakturerbart nu (inkl. moms), exkl. uppskjutet/ej fakturerbart. */
    billable: number;
    inDrafts: number;
    invoiced: number;
    deferred: number;
    notBillable: number;
  };
  /** Vilka faktureringssätt som är rimliga för det här uppdraget. */
  modes: { mode: CloseoutBillingMode; label: string; description: string; recommended: boolean }[];
  /** Nästa del i betalplanen om uppdraget har en och den inte är sista. */
  nextPlanPart: { index: number; label: string; amount: number; isLast: boolean } | null;
  closeout: JobCloseoutState;
}

export const CLOSEOUT_MODE_LABEL: Record<CloseoutBillingMode, string> = {
  slutfaktura: "Slutfaktura",
  delfaktura: "Delfaktura enligt betalplan",
  lopande: "Fakturera det registrerade",
  ingen: "Ingen faktura nu",
};

export function closeoutKey(ref: BillingSourceRef): string {
  return `${ref.sourceType}:${ref.sourceId}`;
}

export function parseCloseoutKey(key: string): BillingSourceRef | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const sourceType = key.slice(0, idx) as BillingSourceType;
  const sourceId = key.slice(idx + 1);
  const known: BillingSourceType[] = ["quote_line", "payment_plan_part", "quote_remainder", "work_entry", "change_line", "expense", "receipt_line", "manual"];
  if (!known.includes(sourceType) || !sourceId) return null;
  return { sourceType, sourceId };
}

/* ---------------------------------- state ----------------------------------- */

export function closeoutState(job: Job): JobCloseoutState {
  if (!job.closeout) job.closeout = { events: [] };
  if (!job.closeout.events) job.closeout.events = [];
  return job.closeout;
}

function addEvent(job: Job, kind: JobCloseoutEventKind, text: string, entity?: JobCloseoutEvent["entity"]): JobCloseoutEvent {
  const state = closeoutState(job);
  const event: JobCloseoutEvent = { id: uid(), at: new Date().toISOString(), kind, text, ...(entity ? { entity } : {}), createdBy: "anvandare" };
  state.events.push(event);
  return event;
}

function activeDeferral(job: Job, ref: BillingSourceRef): BillingDeferral | undefined {
  return (job.billingDeferrals ?? []).find((d) => !d.resolvedAt && d.sourceType === ref.sourceType && d.sourceId === ref.sourceId);
}

/* ---------------------------------- underlag -------------------------------- */

function stateFromBilling(s: SourceBillingState): CloseoutItemState {
  return s.status === "invoiced" ? "fakturerad" : s.status === "draft" ? "utkast" : "fakturerbar";
}

function applyDeferral(job: Job, item: CloseoutItem): CloseoutItem {
  if (item.state !== "fakturerbar") return item;
  const d = activeDeferral(job, item);
  if (!d) return item;
  return { ...item, state: d.kind, deferral: d };
}

function entryAmounts(e: JobWorkEntry): { excl: number; incl: number } {
  const excl = Math.round(e.qty * e.unitPrice);
  return { excl, incl: excl + Math.round(excl * (e.vatRate / 100)) };
}

function workEntryItem(job: Job, e: JobWorkEntry, quoted: boolean): CloseoutItem {
  const billing = sourceBillingState({ sourceType: "work_entry", sourceId: e.id });
  const amounts = entryAmounts(e);
  const unit = `${e.qty} ${e.unit}`;
  return applyDeferral(job, {
    key: closeoutKey({ sourceType: "work_entry", sourceId: e.id }),
    sourceType: "work_entry",
    sourceId: e.id,
    group: quoted ? "tillagg" : "avtalat",
    label: e.description,
    detail: `${unit} × ${kr(e.unitPrice)}${e.isExtra ? " · utöver offerten" : ""}`,
    amountExclVat: amounts.excl,
    amountInclVat: amounts.incl,
    state: stateFromBilling(billing),
    ...(billing.invoiceId ? { invoiceId: billing.invoiceId } : {}),
    ...(billing.invoiceNumber != null ? { invoiceNumber: billing.invoiceNumber } : {}),
  });
}

function changeLineItem(job: Job, change: JobChange, line: DocLine, registered: JobWorkEntry[]): CloseoutItem {
  const billing = sourceBillingState({ sourceType: "change_line", sourceId: line.id });
  const excl = lineTotal(line);
  // Tid registrerad på ändringen visas som upplysning på första raden – den
  // faktureras via ändringen, aldrig som egen post.
  const hours = registered.filter((e) => e.type === "labor").reduce((s, e) => s + e.qty, 0);
  const isFirst = change.lines.find((l) => !l.isHeading)?.id === line.id;
  const registeredNote = isFirst && hours > 0 ? ` · ${hours.toLocaleString("sv-SE")} tim registrerade` : "";
  return applyDeferral(job, {
    key: closeoutKey({ sourceType: "change_line", sourceId: line.id }),
    sourceType: "change_line",
    sourceId: line.id,
    group: "andringar",
    label: change.lines.length > 1 ? line.description : change.title,
    detail: `Ändring ${change.number} · godkänd av ${change.approval?.approvedByName ?? "kunden"}${registeredNote}`,
    amountExclVat: excl,
    amountInclVat: excl + lineVat(line),
    state: stateFromBilling(billing),
    ...(billing.invoiceId ? { invoiceId: billing.invoiceId } : {}),
    ...(billing.invoiceNumber != null ? { invoiceNumber: billing.invoiceNumber } : {}),
  });
}

const NON_QUOTE_SOURCES = new Set<string>(["JOB_TIME_ENTRY", "JOB_MATERIAL", "JOB_OTHER", "CHANGE_LINE"]);

/**
 * Hur stor del av en faktura som avser offerten (inte tillägg/ändringar).
 * Delkrediter följer originalets fördelning. 1 = hela fakturan.
 */
function quoteShare(inv: Invoice): number {
  const base = inv.type === "kredit" && inv.creditsInvoiceId ? getInvoice(inv.creditsInvoiceId) ?? inv : inv;
  const total = base.lines.reduce((s, l) => s + lineTotal(l) + lineVat(l), 0);
  if (total <= 0) return 1;
  const nonQuote = base.lines
    .filter((l) => l.sourceKind && NON_QUOTE_SOURCES.has(l.sourceKind))
    .reduce((s, l) => s + lineTotal(l) + lineVat(l), 0);
  return Math.max(0, (total - nonQuote) / total);
}

/**
 * Kvar att fakturera enligt offerten – inkl. moms. Tidigare fakturor (även
 * utkast), del- och helkrediter räknas in; tillägg och ändringar på samma
 * fakturor räknas inte mot offerten.
 */
export function quoteRemainderForJob(
  job: Job,
  quote: Quote,
  version: QuoteVersion
): { remaining: number; invoiced: number; inDrafts: number; total: number } {
  const total = docTotals(version.lines, version.rot).total;
  let invoiced = 0;
  let inDrafts = 0;
  for (const inv of invoicesForJobOrQuote(job.id, quote.id)) {
    const part = Math.round(invoicedTotalContribution(inv) * quoteShare(inv));
    invoiced += part;
    if (inv.status === "utkast" && inv.type !== "kredit") inDrafts += part;
  }
  return { total, invoiced, inDrafts, remaining: Math.max(0, total - invoiced) };
}

function quoteItems(job: Job, quote: Quote, version: QuoteVersion): CloseoutItem[] {
  const { remaining, invoiced, inDrafts, total } = quoteRemainderForJob(job, quote, version);
  const drafts = invoicesForJobOrQuote(job.id, quote.id).filter((i) => i.status === "utkast" && i.type !== "kredit");
  const label = hasPaymentPlan(version.paymentPlan) ? `Resterande enligt betalplan, offert #${quote.number}` : `Offert #${quote.number} – ${version.title}`;
  const ref: BillingSourceRef = { sourceType: "quote_remainder", sourceId: quote.id };
  const state: CloseoutItemState = remaining > 0 ? "fakturerbar" : inDrafts > 0 ? "utkast" : "fakturerad";
  const vatRate = version.lines.find((l) => !l.isHeading)?.vatRate ?? 25;
  const item: CloseoutItem = {
    key: closeoutKey(ref),
    ...ref,
    group: "avtalat",
    label,
    detail:
      invoiced > 0
        ? `Avtalat ${kr(total)} · fakturerat ${kr(invoiced - inDrafts)}${inDrafts > 0 ? ` · i utkast ${kr(inDrafts)}` : ""}`
        : `Avtalat ${kr(total)} inkl. moms`,
    amountExclVat: Math.round(remaining / (1 + vatRate / 100)),
    amountInclVat: remaining,
    state,
    ...(state === "utkast" && drafts[0] ? { invoiceId: drafts[0].id } : {}),
  };
  return [applyDeferral(job, item)];
}

export function closeoutBasis(jobId: string): CloseoutBasis {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const quote = jobQuote(job);
  const approved = quote?.status === "godkand" ? quote : undefined;
  const version = approved ? currentVersion(approved) : undefined;

  const items: CloseoutItem[] = [];
  if (approved && version) items.push(...quoteItems(job, approved, version));

  const actuals = actualEntries(job.id);
  for (const change of approvedJobChanges(job.id)) {
    const registered = actuals.filter((e) => e.changeId === change.id);
    for (const line of billableChangeLines(change)) items.push(changeLineItem(job, change, line, registered));
  }

  // Med godkänd offert är bara tillägg fakturerbara vid sidan av offerten;
  // utan offert är allt registrerat arbete fakturerbart. Poster registrerade
  // på en ändring följer ändringen (billsAsExtra) och listas aldrig separat.
  const billableEntries = approved ? actuals.filter(billsAsExtra) : actuals.filter((e) => !e.changeId);
  for (const e of billableEntries) items.push(workEntryItem(job, e, Boolean(approved)));

  const changes = jobChangesForJob(job.id);
  const openDrafts = invoicesForJobOrQuote(job.id, quote?.id).filter((i) => i.status === "utkast" && i.type !== "kredit");
  const checks: CloseoutChecks = {
    checklistOpen: job.checklist.filter((c) => !c.done).length,
    checklistTotal: job.checklist.length,
    pendingChanges: changes.filter((c) => c.status === "vantar_pa_kunden"),
    draftChanges: changes.filter((c) => c.status === "utkast"),
    openDrafts,
    photoCount: job.photos?.length ?? 0,
    registeredWorkInclVat: actuals.reduce((s, e) => s + entryAmounts(e).incl, 0),
  };

  const totals = { billable: 0, inDrafts: 0, invoiced: 0, deferred: 0, notBillable: 0 };
  for (const it of items) {
    if (it.state === "fakturerbar") totals.billable += it.amountInclVat;
    else if (it.state === "utkast") totals.inDrafts += it.amountInclVat;
    else if (it.state === "fakturerad") totals.invoiced += it.amountInclVat;
    else if (it.state === "hantera_senare") totals.deferred += it.amountInclVat;
    else totals.notBillable += it.amountInclVat;
  }

  const nextPlan = approved ? nextPaymentPlanPartForQuote(approved.id) : null;
  const nextPlanPart = nextPlan ? { index: nextPlan.index, label: nextPlan.label, amount: nextPlan.amount, isLast: nextPlan.isLast } : null;
  const hasBillable = items.some((i) => i.state === "fakturerbar");
  const modes: CloseoutBasis["modes"] = [];
  if (approved) {
    modes.push({
      mode: "slutfaktura",
      label: CLOSEOUT_MODE_LABEL.slutfaktura,
      description: "Resten enligt offerten, godkända ändringar och valda tillägg på en faktura.",
      recommended: hasBillable,
    });
    if (nextPlanPart && !nextPlanPart.isLast) {
      modes.push({
        mode: "delfaktura",
        label: CLOSEOUT_MODE_LABEL.delfaktura,
        description: `Nästa del: ${nextPlanPart.label} (${kr(nextPlanPart.amount)}). Resten faktureras senare.`,
        recommended: false,
      });
    }
  }
  modes.push({
    mode: "lopande",
    label: CLOSEOUT_MODE_LABEL.lopande,
    description: approved ? "Bara valda tillägg och ändringar – offertens rest lämnas till senare." : "Registrerad tid, material och övrigt som du valt.",
    recommended: !approved && hasBillable,
  });
  modes.push({
    mode: "ingen",
    label: CLOSEOUT_MODE_LABEL.ingen,
    description: hasBillable ? "Avsluta utan att skapa något utkast. Det fakturerbara ligger kvar på uppdraget." : "Allt är redan fakturerat eller hanterat.",
    recommended: !hasBillable,
  });

  return { job, quote: approved, version, items, checks, totals, modes, nextPlanPart, closeout: closeoutState(job) };
}

/* ------------------------------------ vy ------------------------------------ */

/** Serialiserbar vy för klienten (inga hela domänobjekt). */
export interface CloseoutView {
  jobId: string;
  jobTitle: string;
  customerName: string;
  isCompleted: boolean;
  quoteNumber?: number;
  items: CloseoutItem[];
  checks: {
    checklistOpen: number;
    checklistTotal: number;
    openChecklist: string[];
    pendingChanges: { id: string; number: number; title: string }[];
    draftChanges: { id: string; number: number; title: string }[];
    openDrafts: { id: string; number: number | null; amount: number }[];
    photoCount: number;
    registeredWorkInclVat: number;
  };
  totals: CloseoutBasis["totals"];
  modes: CloseoutBasis["modes"];
  nextPlanPart: CloseoutBasis["nextPlanPart"];
  existingDraft: { id: string; amount: number } | null;
}

export function closeoutView(jobId: string): CloseoutView {
  const basis = closeoutBasis(jobId);
  const customer = requireCustomer(basis.job.customerId);
  const draft = existingCloseoutDraft(jobId);
  return {
    jobId,
    jobTitle: basis.job.title,
    customerName: customer.name,
    isCompleted: basis.job.status === "klart",
    ...(basis.quote ? { quoteNumber: basis.quote.number } : {}),
    items: basis.items,
    checks: {
      checklistOpen: basis.checks.checklistOpen,
      checklistTotal: basis.checks.checklistTotal,
      openChecklist: basis.job.checklist.filter((c) => !c.done).map((c) => c.text),
      pendingChanges: basis.checks.pendingChanges.map((c) => ({ id: c.id, number: c.number, title: c.title })),
      draftChanges: basis.checks.draftChanges.map((c) => ({ id: c.id, number: c.number, title: c.title })),
      openDrafts: basis.checks.openDrafts.map((i) => ({ id: i.id, number: i.number ?? null, amount: invoiceTotals(i).toPay })),
      photoCount: basis.checks.photoCount,
      registeredWorkInclVat: basis.checks.registeredWorkInclVat,
    },
    totals: basis.totals,
    modes: basis.modes,
    nextPlanPart: basis.nextPlanPart,
    existingDraft: draft ? { id: draft.id, amount: invoiceTotals(draft).toPay } : null,
  };
}

/* ---------------------------------- beslut ---------------------------------- */

export function setBillingDeferral(
  jobId: string,
  ref: BillingSourceRef,
  kind: BillingDeferral["kind"],
  note?: string
): BillingDeferral {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  if (!job.billingDeferrals) job.billingDeferrals = [];
  const existing = activeDeferral(job, ref);
  const now = new Date().toISOString();
  const cleanNote = typeof note === "string" ? note.trim().slice(0, 500) : "";
  if (existing) {
    existing.kind = kind;
    if (cleanNote) existing.note = cleanNote;
    else delete existing.note;
    save();
    return existing;
  }
  const deferral: BillingDeferral = {
    id: uid(),
    sourceType: ref.sourceType,
    sourceId: ref.sourceId,
    kind,
    ...(cleanNote ? { note: cleanNote } : {}),
    createdAt: now,
    createdBy: "anvandare",
  };
  job.billingDeferrals.push(deferral);
  const label = itemLabelForRef(jobId, ref);
  addEvent(
    job,
    kind === "inte_fakturerbart" ? "beslut_inte_fakturerbart" : "beslut_hantera_senare",
    kind === "inte_fakturerbart" ? `${label} markerades som inte fakturerbart.${cleanNote ? ` ${cleanNote}` : ""}` : `${label} skjuts upp till senare.${cleanNote ? ` ${cleanNote}` : ""}`,
    { type: "kalla", id: closeoutKey(ref) }
  );
  save();
  return deferral;
}

export function clearBillingDeferral(jobId: string, ref: BillingSourceRef): void {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const existing = activeDeferral(job, ref);
  if (!existing) return;
  existing.resolvedAt = new Date().toISOString();
  addEvent(job, "beslut_borttaget", `${itemLabelForRef(jobId, ref)} är fakturerbart igen.`, { type: "kalla", id: closeoutKey(ref) });
  save();
}

function itemLabelForRef(jobId: string, ref: BillingSourceRef): string {
  const item = closeoutBasis(jobId).items.find((i) => i.sourceType === ref.sourceType && i.sourceId === ref.sourceId);
  return item?.label ?? "Posten";
}

/* ------------------------------- fakturautkast ------------------------------ */

export interface CloseoutDraftInput {
  mode: CloseoutBillingMode;
  /** Nycklar (closeoutKey) för de poster som ska med. Saknas = alla fakturerbara. */
  includeKeys?: string[];
}

export class CloseoutError extends Error {
  readonly code: "nothing_to_invoice" | "no_quote" | "conflict" | "mode";
  constructor(code: CloseoutError["code"], message: string) {
    super(message);
    this.name = "CloseoutError";
    this.code = code;
  }
}

function selectedItems(basis: CloseoutBasis, includeKeys?: string[]): CloseoutItem[] {
  const billable = basis.items.filter((i) => i.state === "fakturerbar");
  if (!includeKeys) return billable;
  const wanted = new Set(includeKeys);
  return billable.filter((i) => wanted.has(i.key));
}

function remainderLines(job: Job, quote: Quote, version: QuoteVersion, remaining: number): DocLine[] {
  const everInvoiced = invoicesForJobOrQuote(job.id, quote.id).some((i) => i.type !== "kredit");
  const total = docTotals(version.lines, version.rot).total;
  if (!everInvoiced && remaining >= total) {
    // Ingen faktura tidigare: offertens rader rakt av, radvis spårbara.
    return version.lines.map((l) => syncDocLineClassification(lineWithQuoteProvenance({ ...l, id: uid() }, quote, l.id)));
  }
  const lastIndex = Math.max(0, version.paymentPlan.length - 1);
  const description = hasPaymentPlan(version.paymentPlan)
    ? `Slutbetalning – ${version.title} (resterande enligt betalplan, offert #${quote.number})`
    : `Slutfaktura – ${version.title} (resterande enligt offert #${quote.number})`;
  return shareLinesForRemainder(version, remaining, description).map((l) => lineWithPaymentPlanProvenance(l, quote, lastIndex));
}

/** Klumpsumma som ärver offertens momssats(er) – en rad per sats, proportionellt. */
function shareLinesForRemainder(version: QuoteVersion, amountInclVat: number, description: string): DocLine[] {
  const rates = [...new Set(version.lines.filter((l) => !l.isHeading).map((l) => l.vatRate))];
  if (rates.length <= 1) {
    const rate = rates[0] ?? 25;
    return [
      syncDocLineClassification({
        id: uid(),
        kind: "arbete",
        description,
        qty: 1,
        unit: "st",
        unitPrice: Math.round(amountInclVat / (1 + rate / 100)),
        vatRate: rate,
      }),
    ];
  }
  const totals = rates.map((rate) => {
    const base = version.lines.filter((l) => l.vatRate === rate).reduce((s, l) => s + lineTotal(l) + lineVat(l), 0);
    return { rate, base };
  });
  const sum = totals.reduce((s, t) => s + t.base, 0) || 1;
  let allocated = 0;
  return totals.map((t, i) => {
    const incl = i === totals.length - 1 ? amountInclVat - allocated : Math.round((amountInclVat * t.base) / sum);
    allocated += incl;
    return syncDocLineClassification({
      id: uid(),
      kind: "arbete",
      description: `${description} – moms ${t.rate} %`,
      qty: 1,
      unit: "st",
      unitPrice: Math.round(incl / (1 + t.rate / 100)),
      vatRate: t.rate,
    });
  });
}

/** Öppet utkast som avslutsflödet redan skapat för uppdraget (idempotens). */
export function existingCloseoutDraft(jobId: string): Invoice | undefined {
  const job = getJob(jobId);
  if (!job) return undefined;
  const ids = new Set(
    closeoutState(job)
      .events.filter((e) => e.kind === "fakturautkast_skapat" && e.entity?.type === "faktura")
      .map((e) => e.entity!.id)
  );
  return invoicesForJobOrQuote(jobId, jobQuote(job)?.id).find((i) => ids.has(i.id) && i.status === "utkast");
}

/**
 * Skapar ETT fakturautkast för avslutet. Idempotent: finns redan ett öppet
 * utkast från flödet returneras det. Strikt allokering – en källa som redan
 * ligger på en faktura ger fel i stället för en dubblett.
 */
export function createCloseoutInvoiceDraft(jobId: string, input: CloseoutDraftInput): Invoice {
  const existing = existingCloseoutDraft(jobId);
  if (existing) return existing;
  const basis = closeoutBasis(jobId);
  const { job, quote, version } = basis;
  const customer = requireCustomer(job.customerId);
  if (input.mode === "ingen") throw new CloseoutError("mode", "Inget fakturautkast skapas med det här valet.");

  const selected = selectedItems(basis, input.includeKeys);
  const changeLines: DocLine[] = [];
  const entryIds: string[] = [];
  for (const it of selected) {
    if (it.sourceType === "change_line") {
      const change = approvedJobChanges(job.id).find((c) => c.lines.some((l) => l.id === it.sourceId));
      const line = change?.lines.find((l) => l.id === it.sourceId);
      if (change && line) {
        changeLines.push(changeLineToDocLine(change, line));
        // Tid registrerad på ändringen följer med som fakturerad via ändringen.
        for (const e of actualEntries(job.id)) if (e.changeId === change.id && !entryIds.includes(e.id)) entryIds.push(e.id);
      }
    } else if (it.sourceType === "work_entry") {
      entryIds.push(it.sourceId);
    }
  }
  const entries = actualEntries(job.id).filter((e) => entryIds.includes(e.id) && !e.changeId);
  const entryLines = entries.map((e) => entryToDocLine(e, quote?.number));

  let invoice: Invoice;
  try {
    if (input.mode === "delfaktura") {
      if (!quote || !basis.nextPlanPart) throw new CloseoutError("no_quote", "Uppdraget har ingen betalplan att delfakturera.");
      invoice = createPartInvoiceForQuote(quote.id, basis.nextPlanPart.index);
      if (changeLines.length || entryLines.length) {
        invoice.lines = [...invoice.lines, ...changeLines, ...entryLines];
        associateEntriesWithInvoice(entryIds, invoice.id);
        // Samma väg som övriga uppdateringar: allokeringen följer raderna.
        syncInvoiceAfterExtraLines(invoice);
      }
    } else {
      const lines: DocLine[] = [];
      const wantsRemainder = input.mode === "slutfaktura" && selected.some((i) => i.sourceType === "quote_remainder");
      if (wantsRemainder && quote && version) {
        const { remaining } = quoteRemainderForJob(job, quote, version);
        if (remaining > 0) lines.push(...remainderLines(job, quote, version, remaining));
      }
      lines.push(...changeLines, ...entryLines);
      if (lines.length === 0) throw new CloseoutError("nothing_to_invoice", "Det finns inget valt att fakturera.");
      invoice = createInvoice({
        customerId: customer.id,
        jobId: job.id,
        quoteId: quote?.id,
        type: input.mode === "slutfaktura" && quote ? "slutfaktura" : "faktura",
        lines,
        rot: version?.rot ?? null,
        dueInDays: version?.paymentTermsDays,
        lateInterestRate: version?.lateInterestRate,
        serviceDate: (job.completedAt || job.endDate || job.startDate || "").slice(0, 10) || undefined,
        strictAllocation: true,
      });
      associateEntriesWithInvoice(entryIds, invoice.id);
    }
  } catch (e) {
    if (e instanceof BillingConflictError) {
      throw new CloseoutError("conflict", "En av posterna ligger redan på en faktura. Ladda om sidan och försök igen.");
    }
    throw e;
  }

  addEvent(job, "fakturautkast_skapat", `Fakturautkast (${CLOSEOUT_MODE_LABEL[input.mode].toLowerCase()}) skapades: ${kr(invoiceTotals(invoice).toPay)}.`, {
    type: "faktura",
    id: invoice.id,
  });
  closeoutState(job).billingMode = input.mode;
  save();
  return invoice;
}

function syncInvoiceAfterExtraLines(invoice: Invoice): void {
  syncAllocationsWithLines(invoice, { strict: true });
}

/* --------------------------------- avsluta ---------------------------------- */

export interface CompleteCloseoutInput {
  mode: CloseoutBillingMode;
  invoiceId?: string;
}

/** Markera uppdraget som klart via avslutsflödet. Skickar aldrig något. */
export function completeJobCloseout(jobId: string, input: CompleteCloseoutInput): Job {
  const job = completeJob(jobId);
  const state = closeoutState(job);
  const now = new Date().toISOString();
  state.completedAt = now;
  state.billingMode = input.mode;
  const inv = input.invoiceId ? getInvoice(input.invoiceId) : undefined;
  const text =
    input.mode === "ingen"
      ? "Uppdraget avslutades utan ny faktura."
      : inv
        ? `Uppdraget avslutades. Fakturautkast på ${kr(invoiceTotals(inv).toPay)} väntar på att skickas.`
        : `Uppdraget avslutades (${CLOSEOUT_MODE_LABEL[input.mode].toLowerCase()}).`;
  addEvent(job, "avslutat", text, inv ? { type: "faktura", id: inv.id } : undefined);
  logAudit("anvandare", "uppdrag_avslutat", `Uppdraget “${job.title}” avslutades. Faktureringssätt: ${CLOSEOUT_MODE_LABEL[input.mode]}.`, {
    targetType: "uppdrag",
    targetId: job.id,
  });
  save();
  return job;
}

/** Öppna ett avslutat uppdrag igen. Fakturor och beslut lämnas orörda. */
export function reopenJobCloseout(jobId: string): Job {
  const job = reopenJob(jobId);
  const state = closeoutState(job);
  delete state.completedAt;
  addEvent(job, "oppnat_igen", "Uppdraget öppnades igen.");
  logAudit("anvandare", "uppdrag_oppnat_igen", `Uppdraget “${job.title}” öppnades igen.`, { targetType: "uppdrag", targetId: job.id });
  save();
  return job;
}

export function logCloseoutEvent(jobId: string, kind: JobCloseoutEventKind, text: string, entity?: JobCloseoutEvent["entity"]): void {
  const job = getJob(jobId);
  if (!job) return;
  addEvent(job, kind, text, entity);
  logActivity(text, { customerId: job.customerId, entity: { type: "jobb", id: job.id } });
  save();
}

