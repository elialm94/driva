import { db, save } from "../store";
import type { HusWorkCategory, Invoice, Job, TaxReductionApplication, TaxReductionHusDetails } from "../types";
import { getInvoice, getJob, requireCustomer } from "./data";
import { rotInvoicesForJob, resolveTaxReductionPrefill, detailsFromPrefill } from "./tax-reduction";
import { docTotals } from "../calc";
import { bokforingsdatum, todayDate } from "../accounting/dates";
import { logAudit } from "../accounting/audit";
import { logActivity } from "./activity";
import { normalizeOrgnr } from "../invoices/formats";
import {
  HUS_CATEGORY_LABELS,
  HUS_ROT_DEFAULT_CATEGORY,
  buildHusBegaranXml,
  husBegaranName,
  husCategoriesFor,
  isHusCategoryFor,
  laborHoursFromLines,
  materialCostFromLines,
  otherCostFromLines,
  personnummerTo12Digits,
  validateHusBegaran,
  type HusArende,
  type HusBostad,
} from "../hus-begaran";

/**
 * HUS-fil till Skatteverket från ett befintligt ROT/RUT-ärende.
 *
 * Bygger på samma ärende som ansökningsunderlaget (uppdragets eller den
 * fristående fakturans `taxReductionApplication`). Ett ärende i filen per
 * betald faktura: Skatteverket vill ha betalningsdatum och fakturanummer per
 * betalning. Saknas något som filen kräver blockeras exporten med en tydlig
 * lucka – inget hittas på, minst av allt arbetade timmar.
 *
 * Filen laddas ner av användaren och importeras i e-tjänsten "Rot och rut –
 * företag". Driva skickar aldrig något till Skatteverket och markerar aldrig
 * ett beslut automatiskt.
 */

export type HusExportBlockerCode = "kategori" | "timmar" | "betalningsdatum" | "personnummer" | "bostad" | "regel";

export interface HusExportBlocker {
  code: HusExportBlockerCode;
  label: string;
  href?: string;
  actionLabel?: string;
  invoiceId?: string;
}

export interface HusExportInvoiceRow {
  invoiceId: string;
  number: number | null;
  /** Timmar avlästa ur timprisade arbetsrader. null = går inte att läsa av. */
  derivedHours: number | null;
  /** Timmar användaren angett för fakturan (fast pris). */
  manualHours?: number;
  /** Timmarna som hamnar i filen. */
  hours: number | null;
  materialCost: number;
  otherCost: number;
  laborInclVat: number;
  deduction: number;
  /** Kundens betalda del av arbetskostnaden (arbete inkl. moms − avdrag). */
  paidLabor: number;
  paymentDate: string | null;
}

export interface HusExportPreview {
  type: "rot" | "rut";
  jobId?: string;
  invoiceId?: string;
  /** Arbetsområdet som används i filen (ROT: Bygg om inget valts). */
  category: HusWorkCategory | null;
  categoryExplicit: boolean;
  categories: readonly HusWorkCategory[];
  categoryLabels: Record<HusWorkCategory, string>;
  invoices: HusExportInvoiceRow[];
  blockers: HusExportBlocker[];
  fileName: string;
  downloadHref: string;
  fileDownloadedAt?: string;
}

interface HusContext {
  job?: Job;
  invoices: Invoice[];
  primary: Invoice;
  application: TaxReductionApplication;
  type: "rot" | "rut";
}

function resolveContext(input: { jobId?: string; invoiceId?: string }): HusContext | null {
  const invoice = input.invoiceId ? getInvoice(input.invoiceId) : undefined;
  const job = input.jobId ? getJob(input.jobId) : invoice?.jobId ? getJob(invoice.jobId) : undefined;
  const invoices = job ? rotInvoicesForJob(job.id) : invoice?.rot && invoice.type !== "kredit" ? [invoice] : [];
  const primary = (invoice && invoices.find((i) => i.id === invoice.id)) ?? invoices[0];
  if (!primary?.rot) return null;
  const application = job ? job.taxReductionApplication : primary.taxReductionApplication;
  if (!application) return null;
  return { job, invoices, primary, application, type: primary.rot.type };
}

function setApplication(ctx: HusContext, app: TaxReductionApplication): void {
  if (ctx.job) ctx.job.taxReductionApplication = app;
  else ctx.primary.taxReductionApplication = app;
}

/** Dagen kundens sista betalning kom in – bankmatchning eller manuell markering. */
function paymentDateFor(invoice: Invoice): string | null {
  const dates = db()
    .payments.filter((p) => p.invoiceId === invoice.id)
    .map((p) => p.date);
  if (invoice.paidAt) dates.push(invoice.paidAt);
  if (dates.length === 0) return null;
  return bokforingsdatum(dates.reduce((a, b) => (a > b ? a : b)));
}

function effectiveCategory(type: "rot" | "rut", hus?: TaxReductionHusDetails): { category: HusWorkCategory | null; explicit: boolean } {
  const chosen = hus?.workCategory;
  if (chosen && isHusCategoryFor(type, chosen)) return { category: chosen, explicit: true };
  if (type === "rot") return { category: HUS_ROT_DEFAULT_CATEGORY, explicit: false };
  return { category: null, explicit: false };
}

function invoiceRow(invoice: Invoice, hus?: TaxReductionHusDetails): HusExportInvoiceRow {
  const lines = invoice.issuedSnapshot?.lines ?? invoice.lines;
  const rot = invoice.issuedSnapshot?.rot ?? invoice.rot;
  const t = docTotals(lines, rot ?? null);
  const derived = laborHoursFromLines(lines);
  const manual = hus?.laborHoursByInvoice?.[invoice.id];
  const hours = derived ?? (typeof manual === "number" && Number.isFinite(manual) ? Math.round(manual) : null);
  return {
    invoiceId: invoice.id,
    number: invoice.number ?? null,
    derivedHours: derived,
    manualHours: typeof manual === "number" ? manual : undefined,
    hours,
    materialCost: materialCostFromLines(lines),
    otherCost: otherCostFromLines(lines),
    laborInclVat: t.laborInclVat,
    deduction: t.deduction,
    paidLabor: Math.max(0, t.laborInclVat - t.deduction),
    paymentDate: paymentDateFor(invoice),
  };
}

function bostadFor(ctx: HusContext): HusBostad | null {
  const prefill = resolveTaxReductionPrefill({
    customerId: ctx.primary.customerId,
    jobId: ctx.job?.id,
    details: ctx.primary.taxReductionDetails,
  });
  const housing = detailsFromPrefill(prefill).housing;
  if (housing?.dwellingType === "smahus" && housing.propertyDesignation?.trim()) {
    return { kind: "fastighet", fastighetsbeteckning: housing.propertyDesignation.trim() };
  }
  if (housing?.dwellingType === "bostadsratt" && housing.brfOrgNumber?.trim() && housing.apartmentNumber?.trim()) {
    return {
      kind: "bostadsratt",
      lagenhetsNr: housing.apartmentNumber.trim(),
      brfOrgNr: normalizeOrgnr(housing.brfOrgNumber),
    };
  }
  return null;
}

function fileNameFor(ctx: HusContext, today: string): string {
  const kind = ctx.type;
  if (ctx.job) {
    // Bara ASCII i filnamnet – Content-Disposition tål inte åäö rakt av.
    const slug = ctx.job.title
      .toLowerCase()
      .replace(/[åä]/g, "a")
      .replace(/ö/g, "o")
      .replace(/é/g, "e")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    return `${kind}-begaran-${slug || ctx.job.id}-${today}.xml`;
  }
  return `${kind}-begaran-faktura-${ctx.primary.number ?? ctx.primary.id}-${today}.xml`;
}

function downloadHrefFor(ctx: HusContext): string {
  return ctx.job ? `/api/skatteverket/hus?jobb=${encodeURIComponent(ctx.job.id)}` : `/api/skatteverket/hus?faktura=${encodeURIComponent(ctx.primary.id)}`;
}

function editHrefFor(ctx: HusContext): string {
  return `/ekonomi/fakturor/${ctx.primary.id}/redigera#faktura-rot-rut`;
}

/**
 * Allt kortet behöver för HUS-sektionen: vilka fakturor som hamnar i filen,
 * vilka timmar som kan läsas av, vad som saknas och var det åtgärdas.
 * null när ärendet inte har något ansökningsunderlag ännu.
 */
export function husExportPreview(input: { jobId?: string; invoiceId?: string }): HusExportPreview | null {
  const ctx = resolveContext(input);
  if (!ctx) return null;
  if (ctx.application.status !== "underlag_skapat") return null;
  const today = todayDate();
  const hus = ctx.application.hus;
  const customer = requireCustomer(ctx.primary.customerId);
  const { category, explicit } = effectiveCategory(ctx.type, hus);

  const rows = ctx.invoices
    .filter((i) => i.status !== "utkast")
    .map((i) => invoiceRow(i, hus))
    .filter((r) => r.deduction > 0);

  const blockers: HusExportBlocker[] = [];
  const kopare = personnummerTo12Digits(customer.personalIdentityNumber ?? "", today);
  if (!kopare) {
    blockers.push({
      code: "personnummer",
      label: "Kundens personnummer måste ha 10 eller 12 siffror.",
      href: `/kunder/${customer.id}#kund-personnummer`,
      actionLabel: "Öppna kunden",
    });
  }
  const bostad = bostadFor(ctx);
  if (ctx.type === "rot" && !bostad) {
    blockers.push({
      code: "bostad",
      label: "Fastighetsbeteckning eller BRF + lägenhetsnummer saknas.",
      href: editHrefFor(ctx),
      actionLabel: "Välj bostad",
    });
  }
  if (!category) {
    blockers.push({ code: "kategori", label: "Välj arbetsområde för RUT-arbetet.", href: "#hus-arbetsomrade", actionLabel: "Välj arbetsområde" });
  }
  for (const r of rows) {
    const nr = r.number != null ? `#${r.number}` : "";
    if (r.hours == null) {
      blockers.push({
        code: "timmar",
        label: `Arbetade timmar saknas för faktura ${nr}`.trim() + " – raderna är inte timprisade.",
        href: `#hus-timmar-${r.invoiceId}`,
        actionLabel: "Ange timmar",
        invoiceId: r.invoiceId,
      });
    }
    if (!r.paymentDate) {
      blockers.push({
        code: "betalningsdatum",
        label: `Betalningsdatum saknas för faktura ${nr}`.trim() + " – ingen registrerad inbetalning.",
        href: `/ekonomi/fakturor/${r.invoiceId}`,
        actionLabel: "Öppna fakturan",
        invoiceId: r.invoiceId,
      });
    }
  }
  if (rows.length === 0) {
    blockers.push({ code: "regel", label: "Ingen betald faktura med ROT/RUT-avdrag att begära utbetalning för." });
  }

  // Schemats och e-tjänstens regler på det som faktiskt skulle skrivas.
  if (blockers.length === 0 && kopare && category) {
    const arenden = rows.map((r) => arendeFromRow(r, kopare, category, ctx.type === "rot" ? bostad ?? undefined : undefined));
    for (const issue of validateHusBegaran({ type: ctx.type, namn: husBegaranName(ctx.type, today), arenden, today })) {
      blockers.push({ code: "regel", label: issue });
    }
  }

  return {
    type: ctx.type,
    jobId: ctx.job?.id,
    invoiceId: ctx.primary.id,
    category,
    categoryExplicit: explicit,
    categories: husCategoriesFor(ctx.type),
    categoryLabels: HUS_CATEGORY_LABELS,
    invoices: rows,
    blockers,
    fileName: fileNameFor(ctx, today),
    downloadHref: downloadHrefFor(ctx),
    fileDownloadedAt: hus?.fileDownloadedAt,
  };
}

function arendeFromRow(r: HusExportInvoiceRow, kopare: string, category: HusWorkCategory, bostad?: HusBostad): HusArende {
  return {
    kopare,
    betalningsDatum: r.paymentDate ?? "",
    prisForArbete: r.laborInclVat,
    betaltBelopp: r.paidLabor,
    begartBelopp: r.deduction,
    fakturaNr: r.number != null ? String(r.number) : undefined,
    ovrigKostnad: r.otherCost,
    bostad,
    utfortArbete: [{ kategori: category, antalTimmar: r.hours ?? 0, materialkostnad: r.materialCost }],
  };
}

export interface HusExportFile {
  fileName: string;
  xml: string;
  type: "rot" | "rut";
}

/**
 * Bygger själva filen. Kastar med en läsbar sammanfattning av luckorna om något
 * saknas – exporten blockeras hellre än att en ofullständig fil lämnar Driva.
 */
export function buildHusExportFile(input: { jobId?: string; invoiceId?: string }): HusExportFile {
  const preview = husExportPreview(input);
  if (!preview) throw new Error("Skapa ansökningsunderlag innan filen till Skatteverket kan laddas ner.");
  if (preview.blockers.length) {
    throw new Error(`Filen kan inte skapas ännu: ${preview.blockers.map((b) => b.label).join(" ")}`);
  }
  const ctx = resolveContext(input)!;
  const today = todayDate();
  const customer = requireCustomer(ctx.primary.customerId);
  const kopare = personnummerTo12Digits(customer.personalIdentityNumber ?? "", today)!;
  const bostad = ctx.type === "rot" ? bostadFor(ctx) ?? undefined : undefined;
  const arenden = preview.invoices.map((r) => arendeFromRow(r, kopare, preview.category!, bostad));
  const xml = buildHusBegaranXml({ type: ctx.type, namn: husBegaranName(ctx.type, today), arenden, today });
  return { fileName: preview.fileName, xml, type: ctx.type };
}

export function patchHusExportFields(input: {
  jobId?: string;
  invoiceId?: string;
  workCategory?: string;
  laborHoursByInvoice?: Record<string, number | null>;
}): TaxReductionApplication {
  const ctx = resolveContext(input);
  if (!ctx) throw new Error("Skapa ansökningsunderlag innan uppgifterna för Skatteverkets fil fylls i.");
  const prev = ctx.application;
  const hus: TaxReductionHusDetails = { ...(prev.hus ?? {}) };

  if (input.workCategory !== undefined) {
    if (input.workCategory === "") {
      delete hus.workCategory;
    } else if (isHusCategoryFor(ctx.type, input.workCategory)) {
      hus.workCategory = input.workCategory;
    } else {
      throw new Error(`Arbetsområdet ${input.workCategory} finns inte för ${ctx.type.toUpperCase()}.`);
    }
  }

  if (input.laborHoursByInvoice) {
    const next: Record<string, number> = { ...(hus.laborHoursByInvoice ?? {}) };
    for (const [invoiceId, raw] of Object.entries(input.laborHoursByInvoice)) {
      if (!ctx.invoices.some((i) => i.id === invoiceId)) throw new Error("Fakturan hör inte till det här ROT/RUT-ärendet.");
      if (raw == null || Number.isNaN(raw)) {
        delete next[invoiceId];
        continue;
      }
      const hours = Math.round(raw);
      if (!Number.isFinite(hours) || hours < 0 || hours > 999) {
        throw new Error("Arbetade timmar måste vara ett heltal mellan 0 och 999.");
      }
      next[invoiceId] = hours;
    }
    if (Object.keys(next).length) hus.laborHoursByInvoice = next;
    else delete hus.laborHoursByInvoice;
  }

  const app: TaxReductionApplication = { ...prev, hus };
  setApplication(ctx, app);
  save();
  return app;
}

/**
 * Noterar att filen hämtats. Statusen är fortfarande "Väntar på Skatteverket" –
 * nedladdning är inte inlämning, och beslutet markeras alltid av användaren.
 */
export function markHusFileDownloaded(input: { jobId?: string; invoiceId?: string; fileName: string }): TaxReductionApplication {
  const ctx = resolveContext(input);
  if (!ctx) throw new Error("Ärendet finns inte.");
  const now = new Date().toISOString();
  const app: TaxReductionApplication = { ...ctx.application, hus: { ...(ctx.application.hus ?? {}), fileDownloadedAt: now } };
  setApplication(ctx, app);
  const kind = ctx.type.toUpperCase();
  const customer = requireCustomer(ctx.primary.customerId);
  logAudit("anvandare", "rot_fil_nedladdad", `HUS-fil (${kind}) laddades ner för import i Skatteverkets e-tjänst: ${input.fileName}.`, {
    targetType: ctx.job ? "jobb" : "faktura",
    targetId: ctx.job?.id ?? ctx.primary.id,
  });
  logActivity(`Fil till Skatteverket (${kind}) laddades ner för ${customer.name} – importera den i e-tjänsten Rot och rut.`, {
    customerId: customer.id,
    entity: { type: ctx.job ? "jobb" : "faktura", id: ctx.job?.id ?? ctx.primary.id },
  });
  save();
  return app;
}
