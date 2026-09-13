/**
 * Deklarationer & inlämning – en yta för allt som ska lämnas till Skatteverket
 * och Bolagsverket: moms (eSKD), arbetsgivardeklaration (AGI), ROT/RUT-begäran
 * (HUS), inkomstdeklaration 2 (SRU) och årsredovisning (iXBRL).
 *
 * Modulen bygger ingen fil själv. Den samlar det som redan finns – momsperioder,
 * AGI-utkast, räkenskapsår, årsredovisningar, ROT/RUT-ärenden och
 * inlämningsraderna – till ärenden i tre grupper:
 *
 *   behover_goras  perioden är slut och deklarationen är inte inlämnad
 *   kommande       perioden pågår eller förfallodagen ligger längre fram
 *   inlamnat       inlämnad (rapporterad för hand, via leverantör eller
 *                  markerad på sin egen sida)
 *
 * Varje ärende bär exakt status, förfallodag, blockerare och vem som får göra
 * vad. Blockerarna är samma vakter som "markera som deklarerad" har på
 * respektive sida – ytan lovar inte något den inte kan hålla när man trycker.
 *
 * Läser bara. Anropas i tenantkontext. `today` skickas in för testbarhet.
 */
import type { FilingAuthority, FilingKind, FilingSubmission, Invoice, Job } from "../types";
import { db } from "../store";
import { datumLang } from "../format";
import { todayDate } from "../accounting/dates";
import { fiscalYears } from "../accounting/fiscal";
import { undeclaredVatPeriodsBefore, vatChecklist, vatPeriodsFor, type VatPeriodSummary } from "../accounting/vat";
import { employees, employerDeclarations, payrollRuns } from "../accounting/payroll";
import { agiDueDate, monthEnd, monthLabel, nextMonthKey } from "../accounting/payroll-model";
import { annualReportDueDate, ink2DueDate } from "../accounting/deadlines";
import { annualReportBlockers, annualReportFor } from "../accounting/annual-report";
import { ixbrlBlockers } from "../accounting/ixbrl";
import { FilingDataError } from "../accounting/filing-format";
import { husExportPreview } from "../services/hus-export";
import { buildFilingPayload, FILING_AUTHORITY, FILING_KIND_LABEL } from "./payload";
import { latestFilingSubmission, filingSubmissionsFor, openFilingSubmission, sha256Hex } from "./submission";
import { filingPanelData, type FilingPanelData } from "./view";
import { FILING_DOCUMENT_LABEL, FILING_INSTRUCTIONS_VERSION, filingInstruction, type FilingDocumentType, type FilingInstruction } from "./instructions";
import { filingCaseHref } from "./case-href";

export type FilingCaseGroup = "behover_goras" | "kommande" | "inlamnat";

export const FILING_GROUP_LABEL: Record<FilingCaseGroup, string> = {
  behover_goras: "Behöver göras",
  kommande: "Kommande",
  inlamnat: "Inlämnat",
};

export interface FilingResponsibility {
  /** Vem som får förbereda och hämta filen. */
  prepare: string;
  /** Vem som får rapportera den slutliga inlämningen. */
  submit: string;
}

export interface FilingCase {
  id: string;
  type: FilingDocumentType;
  /** Momsperiodens nyckel, AGI-månaden, räkenskapsårets id, rapportens id, HUS: jobb-/faktura-id. */
  subjectId: string;
  title: string;
  /** Perioden eller året i klartext. */
  periodLabel: string;
  authority: FilingAuthority;
  authorityName: string;
  dueDate?: string;
  group: FilingCaseGroup;
  /** Exakt läge i klartext, t.ex. "Perioden pågår till 30 september". */
  status: string;
  blockers: string[];
  responsible: FilingResponsibility;
  /** Ägaradress till ärendets sida. Konsultytan översätter. */
  href: string;
  amount?: number;
  submission?: FilingSubmission;
  /** ROT/RUT hanteras på uppdraget/fakturan; ytan länkar dit. */
  external?: boolean;
}

export interface FilingCaseFile {
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  href: string;
}

export interface FilingCaseDetail {
  case: FilingCase;
  instruction: FilingInstruction;
  instructionsVersion: string;
  files: FilingCaseFile[];
  /** Zip med alla filer när de är fler än en (INK2). */
  packageHref?: string;
  warnings: string[];
  /** Filen kunde inte byggas: vad som saknas. */
  payloadError?: string;
  history: FilingSubmission[];
  open: FilingSubmission | null;
  machine: FilingPanelData;
  /** Alla blockerare borta och filen byggd: "Jag har lämnat in" får visas. */
  canReport: boolean;
  /** Hämtades den fil som är aktuell nu? */
  downloadedCurrent: boolean;
}

const AUTHORITY_NAME: Record<FilingAuthority, string> = { skatteverket: "Skatteverket", bolagsverket: "Bolagsverket" };

const RESPONSIBLE: FilingResponsibility = {
  prepare: "Ägaren eller redovisningskonsulten förbereder och hämtar filen.",
  submit: "Bara ägaren (eller en roll med rätt att lämna in) rapporterar inlämningen.",
};

const HUS_RESPONSIBLE: FilingResponsibility = {
  prepare: "Ägaren eller redovisningskonsulten fyller i timmar och arbetsområde och hämtar filen.",
  submit: "Ägaren (eller anmält ombud) begär utbetalningen i e-tjänsten och registrerar beslutet.",
};

/* ------------------------------ Adresser ---------------------------------- */

export { filingCaseHref };

export function filingFileHrefs(kind: FilingKind, subjectId: string): { files: Record<string, string>; byIndex: string[]; packageHref?: string } {
  switch (kind) {
    case "moms": {
      const href = `/api/bokforing/deklaration?typ=moms&period=${encodeURIComponent(subjectId)}`;
      return { files: {}, byIndex: [href] };
    }
    case "agi": {
      const href = `/api/bokforing/deklaration?typ=agi&manad=${encodeURIComponent(subjectId)}`;
      return { files: {}, byIndex: [href] };
    }
    case "ink2": {
      const base = `/api/bokforing/deklaration?typ=ink2&rakenskapsar=${encodeURIComponent(subjectId)}`;
      return { files: {}, byIndex: [`${base}&fil=blanketter`, `${base}&fil=info`], packageHref: `${base}&fil=paket` };
    }
    case "arsredovisning": {
      const href = `/api/bokforing/deklaration?typ=arsredovisning&rapport=${encodeURIComponent(subjectId)}`;
      return { files: {}, byIndex: [href] };
    }
  }
}

/* -------------------------------- Status ---------------------------------- */

function submissionStatusText(s: FilingSubmission): string {
  switch (s.status) {
    case "kvitterad":
      return s.provider === "manuell"
        ? `Inlämnad för hand – rapporterad ${s.manualReceipt ? datumLang(s.manualReceipt.reportedAt) : ""} av ${s.manualReceipt?.reportedByName ?? "användaren"}`.trim()
        : `Inlämnad och kvitterad ${s.receipt ? datumLang(s.receipt.receivedAt) : ""}`.trim();
    case "inlamnad":
      return `Mottagen av ${AUTHORITY_NAME[s.authority]} – väntar på kvittens`;
    case "avvisad":
      return `Avvisad av ${AUTHORITY_NAME[s.authority]}`;
    case "signerad":
      return "Filen är signerad men inte inlämnad";
    case "genererad":
      return s.downloadedAt ? `Filen hämtades ${datumLang(s.downloadedAt)} – inlämningen är inte rapporterad` : "Filen är byggd men inte hämtad";
    case "utkast":
      return "Inte påbörjad";
  }
}

function isFiled(latest: FilingSubmission | undefined): boolean {
  return latest?.status === "kvitterad" || latest?.status === "inlamnad";
}

/* --------------------------------- Moms ----------------------------------- */

function vatCases(today: string): FilingCase[] {
  const out: FilingCase[] = [];
  const horizon = addDaysIso(today, 120);
  for (const fy of fiscalYears()) {
    if (fy.endDate < addDaysIso(today, -400)) continue;
    if (fy.startDate > horizon) continue;
    for (const p of vatPeriodsFor(fy)) {
      // Läget räknas mot `today` som skickats in (testbarhet), inte klockan.
      const state: VatPeriodSummary["state"] =
        p.report?.status === "deklarerad" ? "deklarerad" : p.period.end < today ? "att_deklarera" : p.period.start <= today ? "pagaende" : "kommande";
      if (state === "kommande") continue;
      const latest = latestFilingSubmission("moms", p.period.key);
      const declared = state === "deklarerad" || isFiled(latest);
      const empty = p.position.utgaende === 0 && p.position.ingaende === 0 && !p.report;
      if (!declared && state === "att_deklarera" && empty) continue;

      let group: FilingCaseGroup;
      let status: string;
      const blockers: string[] = [];
      if (declared) {
        group = "inlamnat";
        status = latest && isFiled(latest)
          ? submissionStatusText(latest)
          : `Markerad som deklarerad${p.report?.declaredAt ? ` ${datumLang(p.report.declaredAt)}` : ""} på momssidan`;
      } else if (state === "pagaende") {
        group = "kommande";
        status = `Perioden pågår till ${datumLang(p.period.end)} · deklareras senast ${datumLang(p.dueDate)}`;
      } else {
        group = "behover_goras";
        status = latest ? submissionStatusText(latest) : `Att deklarera senast ${datumLang(p.dueDate)}`;
        for (const earlier of undeclaredVatPeriodsBefore(p.period.start)) {
          blockers.push(`Momsperioden ${earlier.label} har momsaktivitet men är inte deklarerad – deklarera perioderna i ordning.`);
        }
        for (const item of vatChecklist(p.period)) {
          if (!item.ok) blockers.push(item.detail ?? item.label);
        }
      }
      out.push({
        id: `moms-${p.period.key}`,
        type: "moms",
        subjectId: p.period.key,
        title: FILING_KIND_LABEL.moms,
        periodLabel: p.period.label,
        authority: "skatteverket",
        authorityName: "Skatteverket",
        dueDate: p.dueDate,
        group,
        status,
        blockers,
        responsible: RESPONSIBLE,
        href: filingCaseHref("moms", p.period.key),
        amount: Math.abs(p.report?.attBetala ?? p.position.attBetala),
        submission: latest,
      });
    }
  }
  return out;
}

/* ---------------------------------- AGI ----------------------------------- */

function agiCases(today: string): FilingCase[] {
  const declarations = employerDeclarations();
  if (!employees().length && !declarations.length) return [];
  const runMonths = new Set(payrollRuns().map((r) => r.month));
  const known = new Map(declarations.map((d) => [d.month, d]));
  const out: FilingCase[] = [];

  // Tre månader bakåt räcker för "behöver göras"; äldre lämnade månader visas ändå.
  const months = new Set<string>();
  let m = today.slice(0, 7);
  for (let i = 0; i < 4; i++) {
    months.add(m);
    m = prevMonthKey(m);
  }
  months.add(nextMonthKey(today.slice(0, 7)));
  for (const d of declarations) months.add(d.month);

  for (const key of [...months].sort()) {
    const decl = known.get(key);
    const latest = latestFilingSubmission("agi", key);
    const declared = decl?.status === "deklarerad" || isFiled(latest);
    const end = monthEnd(key);
    const due = agiDueDate(key);
    if (!declared && end < today && !decl && !runMonths.has(key)) continue;
    if (!declared && end >= today && key !== today.slice(0, 7)) continue;

    let group: FilingCaseGroup;
    let status: string;
    const blockers: string[] = [];
    if (declared) {
      group = "inlamnat";
      status = latest && isFiled(latest)
        ? submissionStatusText(latest)
        : `Markerad som lämnad${decl?.declaredAt ? ` ${datumLang(decl.declaredAt)}` : ""} på lönesidan`;
    } else if (end >= today) {
      group = "kommande";
      status = `Månaden pågår till ${datumLang(end)} · lämnas senast ${datumLang(due)}`;
    } else {
      group = "behover_goras";
      status = latest ? submissionStatusText(latest) : `Lämnas senast ${datumLang(due)}`;
      if (!decl) blockers.push(`Det finns ingen arbetsgivardeklaration för ${monthLabel(key)}. Skapa utkastet på lönesidan först.`);
      const earlier = declarations
        .filter((d) => d.month < key && d.status !== "deklarerad" && runMonths.has(d.month))
        .sort((a, b) => a.month.localeCompare(b.month));
      for (const e of earlier) blockers.push(`${e.label} har lön men är inte deklarerad – lämna månaderna i ordning.`);
    }
    out.push({
      id: `agi-${key}`,
      type: "agi",
      subjectId: key,
      title: FILING_KIND_LABEL.agi,
      periodLabel: monthLabel(key),
      authority: "skatteverket",
      authorityName: "Skatteverket",
      dueDate: due,
      group,
      status,
      blockers,
      responsible: RESPONSIBLE,
      href: filingCaseHref("agi", key),
      amount: decl?.attBetala,
      submission: latest,
    });
  }
  return out;
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function prevMonthKey(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/* ----------------------------- INK2 & årsredovisning ---------------------- */

function yearEndCases(today: string): FilingCase[] {
  const isAb = (db().settings.companyForm ?? "ab") === "ab";
  if (!isAb) return [];
  const out: FilingCase[] = [];
  const horizon = addDaysIso(today, 240);
  for (const fy of fiscalYears()) {
    if (fy.endDate > horizon) continue;
    if (fy.endDate < addDaysIso(today, -800)) continue;

    // INK2
    {
      const due = ink2DueDate(fy);
      const latest = latestFilingSubmission("ink2", fy.id);
      const filed = isFiled(latest);
      const blockers: string[] = [];
      let group: FilingCaseGroup;
      let status: string;
      if (filed && latest) {
        group = "inlamnat";
        status = submissionStatusText(latest);
      } else if (fy.endDate >= today) {
        group = "kommande";
        status = `Räkenskapsåret pågår till ${datumLang(fy.endDate)} · deklareras senast ${datumLang(due)}`;
      } else {
        group = "behover_goras";
        status = latest ? submissionStatusText(latest) : `Deklareras senast ${datumLang(due)}`;
        if (fy.status !== "stangt") blockers.push(`Räkenskapsåret ${fy.label} måste stängas med bokslut innan inkomstdeklarationen lämnas.`);
      }
      out.push({
        id: `ink2-${fy.id}`,
        type: "ink2",
        subjectId: fy.id,
        title: FILING_KIND_LABEL.ink2,
        periodLabel: fy.label,
        authority: "skatteverket",
        authorityName: "Skatteverket",
        dueDate: due,
        group,
        status,
        blockers,
        responsible: RESPONSIBLE,
        href: filingCaseHref("ink2", fy.id),
        submission: latest,
      });
    }

    // Årsredovisning
    {
      const due = annualReportDueDate(fy);
      const report = annualReportFor(fy.id);
      const latest = report ? latestFilingSubmission("arsredovisning", report.id) : undefined;
      const filed = report?.status === "inlamnad_markerad" || isFiled(latest);
      const blockers: string[] = [];
      let group: FilingCaseGroup;
      let status: string;
      if (filed) {
        group = "inlamnat";
        status = latest && isFiled(latest)
          ? submissionStatusText(latest)
          : `Markerad som inlämnad${report?.markedFiledAt ? ` ${datumLang(report.markedFiledAt)}` : ""} på bokslutssidan`;
      } else if (fy.endDate >= today) {
        group = "kommande";
        status = `Räkenskapsåret pågår till ${datumLang(fy.endDate)} · Bolagsverket senast ${datumLang(due)}`;
      } else {
        group = "behover_goras";
        status = latest ? submissionStatusText(latest) : `Bolagsverket senast ${datumLang(due)}`;
        if (!report) {
          blockers.push(`Årsredovisningen för ${fy.label} är inte upprättad. Upprätta den på bokslutssidan.`);
        } else {
          blockers.push(...ixbrlBlockers(report));
          if (report.status !== "signerad") {
            blockers.push("Årsredovisningen måste granskas och markeras som underskriven på bokslutssidan innan den lämnas in.");
          }
          blockers.push(...annualReportBlockers(report, "inlamnad_markerad"));
        }
      }
      out.push({
        id: `arsredovisning-${fy.id}`,
        type: "arsredovisning",
        subjectId: report?.id ?? fy.id,
        title: FILING_KIND_LABEL.arsredovisning,
        periodLabel: fy.label,
        authority: "bolagsverket",
        authorityName: "Bolagsverket",
        dueDate: due,
        group,
        status,
        blockers: dedupe(blockers),
        responsible: RESPONSIBLE,
        href: report ? filingCaseHref("arsredovisning", report.id) : `/bokforing/bokslut`,
        submission: latest,
      });
    }
  }
  return out;
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

/* ------------------------------- ROT/RUT (HUS) ---------------------------- */

interface HusSubject {
  key: string;
  job?: Job;
  invoice?: Invoice;
  label: string;
  href: string;
}

function husSubjects(): HusSubject[] {
  const data = db();
  const out: HusSubject[] = [];
  for (const job of data.jobs) {
    if (!job.taxReductionApplication) continue;
    out.push({ key: `jobb:${job.id}`, job, label: job.title, href: `/uppdrag/${job.id}#rot-rut` });
  }
  for (const inv of data.invoices) {
    if (!inv.taxReductionApplication || inv.jobId) continue;
    out.push({
      key: `faktura:${inv.id}`,
      invoice: inv,
      label: `Faktura ${inv.number != null ? `#${inv.number}` : ""}`.trim(),
      href: `/ekonomi/fakturor/${inv.id}#faktura-rot-rut`,
    });
  }
  return out;
}

function husCases(today: string): FilingCase[] {
  const out: FilingCase[] = [];
  for (const subject of husSubjects()) {
    const app = (subject.job ?? subject.invoice)!.taxReductionApplication!;
    if (app.status !== "underlag_skapat" && !app.decision) continue;
    // Beslut äldre än ett år hör till uppdragets historik, inte till listan.
    if (app.decision && app.decision.decidedAt.slice(0, 10) < addDaysIso(today, -365)) continue;
    let preview: ReturnType<typeof husExportPreview> = null;
    try {
      preview = husExportPreview({ jobId: subject.job?.id, invoiceId: subject.invoice?.id });
    } catch {
      preview = null;
    }
    const type = preview?.type ?? subject.invoice?.rot?.type ?? "rot";
    const paymentYear = preview?.invoices.map((i) => i.paymentDate?.slice(0, 4)).filter(Boolean).sort().pop();
    const due = paymentYear ? `${Number(paymentYear) + 1}-01-31` : undefined;
    const deduction = preview?.invoices.reduce((s, r) => s + r.deduction, 0);

    let group: FilingCaseGroup;
    let status: string;
    let blockers: string[] = [];
    if (app.decision) {
      group = "inlamnat";
      status = `Begäran skickad · beslut ${app.decision.outcome === "godkant" ? "godkänt" : app.decision.outcome === "delvis_godkant" ? "delvis godkänt" : "nekat"} ${datumLang(app.decision.decidedAt)}`;
    } else {
      group = "behover_goras";
      status = app.hus?.fileDownloadedAt
        ? `Filen hämtades ${datumLang(app.hus.fileDownloadedAt)} – väntar på att begäran skickas in och beslutet registreras`
        : `Underlag klart${due ? ` · begär utbetalning senast ${datumLang(due)}` : ""}`;
      blockers = preview?.blockers.map((b) => b.label) ?? ["Ansökningsunderlaget kunde inte läsas – öppna ärendet."];
    }
    out.push({
      id: `hus-${subject.key}`,
      type: "hus",
      subjectId: subject.key,
      title: `${type.toUpperCase()} – begäran om utbetalning`,
      periodLabel: subject.label,
      authority: "skatteverket",
      authorityName: "Skatteverket",
      dueDate: due,
      group,
      status,
      blockers,
      responsible: HUS_RESPONSIBLE,
      href: subject.href,
      amount: deduction,
      external: true,
    });
  }
  return out;
}

/* --------------------------------- Samlat --------------------------------- */

export interface FilingCases {
  today: string;
  behover_goras: FilingCase[];
  kommande: FilingCase[];
  inlamnat: FilingCase[];
  all: FilingCase[];
}

function byDue(a: FilingCase, b: FilingCase): number {
  return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.id.localeCompare(b.id);
}

export function filingCases(today: string = todayDate()): FilingCases {
  const all = [...vatCases(today), ...agiCases(today), ...yearEndCases(today), ...husCases(today)];
  const behover_goras = all.filter((c) => c.group === "behover_goras").sort(byDue);
  const kommande = all.filter((c) => c.group === "kommande").sort(byDue);
  const inlamnat = all
    .filter((c) => c.group === "inlamnat")
    .sort((a, b) => (b.dueDate ?? "").localeCompare(a.dueDate ?? "") || a.id.localeCompare(b.id));
  return { today, behover_goras, kommande, inlamnat, all };
}

export function filingCaseById(type: FilingDocumentType, subjectId: string, today: string = todayDate()): FilingCase | undefined {
  return filingCases(today).all.find((c) => c.type === type && c.subjectId === subjectId);
}

/* --------------------------------- Detalj --------------------------------- */

export function isFilingKind(value: string): value is FilingKind {
  return value === "moms" || value === "agi" || value === "ink2" || value === "arsredovisning";
}

/**
 * Allt ärendets sida behöver. Filerna byggs här (samma byte som nedladdningen)
 * så att kontrollsumman kan visas innan användaren hämtar dem; kan de inte
 * byggas blir det ett fel att visa, inte ett tomt paket.
 */
export function filingCaseDetail(kind: FilingKind, subjectId: string, today: string = todayDate()): FilingCaseDetail | null {
  const found = filingCaseById(kind, subjectId, today) ?? fallbackCase(kind, subjectId, today);
  if (!found) return null;

  const hrefs = filingFileHrefs(kind, subjectId);
  const files: FilingCaseFile[] = [];
  const warnings: string[] = [];
  let payloadError: string | undefined;
  try {
    const payload = buildFilingPayload(kind, subjectId);
    payload.files.forEach((f, i) => {
      files.push({
        filename: f.filename,
        contentType: f.contentType,
        size: f.bytes.length,
        sha256: sha256Hex(f.bytes),
        href: hrefs.byIndex[i] ?? hrefs.byIndex[0],
      });
    });
    warnings.push(...payload.warnings);
  } catch (e) {
    payloadError = e instanceof FilingDataError || e instanceof Error ? e.message : "Filen kunde inte byggas.";
  }

  const history = filingSubmissionsFor(kind, subjectId);
  const open = openFilingSubmission(kind, subjectId) ?? null;
  const downloadedCurrent =
    !!open?.downloadedAt &&
    open.files.length === files.length &&
    open.files.every((f, i) => f.sha256 === files[i]?.sha256);

  return {
    case: found,
    instruction: filingInstruction(kind),
    instructionsVersion: FILING_INSTRUCTIONS_VERSION,
    files,
    packageHref: files.length > 1 ? hrefs.packageHref : undefined,
    warnings,
    payloadError,
    history,
    open,
    machine: filingPanelData(kind, subjectId),
    canReport: found.group !== "inlamnat" && found.blockers.length === 0 && !payloadError && files.length > 0,
    downloadedCurrent,
  };
}

/** Ett ärende utanför listans fönster (gammal period via länk) får ändå en sida. */
function fallbackCase(kind: FilingKind, subjectId: string, today: string): FilingCase | undefined {
  const latest = latestFilingSubmission(kind, subjectId);
  let label = subjectId;
  try {
    label = buildFilingPayload(kind, subjectId).label;
  } catch {
    if (!latest) return undefined;
    label = latest.label;
  }
  void today;
  return {
    id: `${kind}-${subjectId}`,
    type: kind,
    subjectId,
    title: FILING_KIND_LABEL[kind],
    periodLabel: label,
    authority: FILING_AUTHORITY[kind],
    authorityName: AUTHORITY_NAME[FILING_AUTHORITY[kind]],
    group: isFiled(latest) ? "inlamnat" : "behover_goras",
    status: latest ? submissionStatusText(latest) : "Utanför kalenderns fönster",
    blockers: [],
    responsible: RESPONSIBLE,
    href: filingCaseHref(kind, subjectId),
    submission: latest,
  };
}

export { FILING_DOCUMENT_LABEL };
