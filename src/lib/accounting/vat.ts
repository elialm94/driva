import { db, save } from "../store";
import { uid } from "../ids";
import type { VatBox, VatReport } from "../types";
import { bokforingsdatum, ensureFiscalYearFor, lockPeriod, quartersOf, todayDate, vatDueDate, type Period } from "./fiscal";
import { postVerification } from "./engine";
import { logAudit } from "./audit";

/**
 * Moms från huvudboken – INTE från fakturasummor. Momsrapporten läser
 * momskontonas rörelser per period, så att rapporten alltid stämmer med
 * bokföringen (samma siffror som Skatteverket skulle granska mot).
 *
 * Central mappning BAS-konto ↔ momskod ↔ deklarationsruta. Endast rutorna
 * vanliga svenska småföretag behöver (inhemsk moms 0/6/12/25).
 */

export interface VatCodeDef {
  code: string;
  label: string;
  /** Deklarationsruta i momsdeklarationen. */
  box: string;
  boxLabel: string;
  accounts: number[];
  kind: "forsaljning" | "utgaende" | "ingaende";
}

export const VAT_CODES: VatCodeDef[] = [
  { code: "MP1", label: "Momspliktig försäljning 25 %", box: "05", boxLabel: "Momspliktig försäljning", accounts: [3001], kind: "forsaljning" },
  { code: "MP2", label: "Momspliktig försäljning 12 %", box: "05", boxLabel: "Momspliktig försäljning", accounts: [3002], kind: "forsaljning" },
  { code: "MP3", label: "Momspliktig försäljning 6 %", box: "05", boxLabel: "Momspliktig försäljning", accounts: [3003], kind: "forsaljning" },
  { code: "MF", label: "Momsfri försäljning", box: "42", boxLabel: "Övrig försäljning m.m.", accounts: [3004], kind: "forsaljning" },
  { code: "U1", label: "Utgående moms 25 %", box: "10", boxLabel: "Utgående moms 25 %", accounts: [2611], kind: "utgaende" },
  { code: "U2", label: "Utgående moms 12 %", box: "11", boxLabel: "Utgående moms 12 %", accounts: [2621], kind: "utgaende" },
  { code: "U3", label: "Utgående moms 6 %", box: "12", boxLabel: "Utgående moms 6 %", accounts: [2631], kind: "utgaende" },
  { code: "I", label: "Ingående moms", box: "48", boxLabel: "Ingående moms att dra av", accounts: [2641], kind: "ingaende" },
];

export function vatCodeForAccount(account: number): VatCodeDef | undefined {
  return VAT_CODES.find((c) => c.accounts.includes(account));
}

export interface VatPosition {
  period: Period;
  dueDate: string;
  boxes: VatBox[];
  utgaende: number;
  ingaende: number;
  /** Positivt = att betala, negativt = att få tillbaka. */
  attBetala: number;
}

/** Momsläget för en period, beräknat ur verifikationsraderna. */
export function computeVatPosition(period: Period): VatPosition {
  const perBox = new Map<string, VatBox>();
  const box = (code: string, label: string): VatBox => {
    let b = perBox.get(code);
    if (!b) {
      b = { code, label, amount: 0 };
      perBox.set(code, b);
    }
    return b;
  };

  let utgaende = 0;
  let ingaende = 0;
  for (const v of db().verifications) {
    const d = bokforingsdatum(v.date);
    if (d < period.start || d > period.end) continue;
    for (const e of v.entries) {
      const def = vatCodeForAccount(e.account);
      if (!def) continue;
      if (def.kind === "forsaljning") {
        box(def.box, def.boxLabel).amount += e.credit - e.debit;
      } else if (def.kind === "utgaende") {
        const amount = e.credit - e.debit;
        box(def.box, def.boxLabel).amount += amount;
        utgaende += amount;
      } else {
        const amount = e.debit - e.credit;
        box(def.box, def.boxLabel).amount += amount;
        ingaende += amount;
      }
    }
  }

  const attBetala = utgaende - ingaende;
  const boxes = [...perBox.values()].sort((a, b) => a.code.localeCompare(b.code));
  boxes.push({ code: "49", label: "Moms att betala eller få tillbaka", amount: attBetala });
  return { period, dueDate: vatDueDate(period), boxes, utgaende, ingaende, attBetala };
}

export function vatReportForPeriod(periodKey: string): VatReport | undefined {
  return db().vatReports.find((r) => r.id === `moms-${periodKey}` || labelKey(r) === periodKey);
}

function labelKey(report: VatReport): string {
  return `${report.periodStart.slice(0, 4)}-K${Math.floor(Number(report.periodStart.slice(5, 7)) / 3) + 1}`;
}

export interface VatPeriodSummary {
  period: Period;
  dueDate: string;
  position: VatPosition;
  report?: VatReport;
  /** kommande | pagaende | att_deklarera | deklarerad */
  state: "kommande" | "pagaende" | "att_deklarera" | "deklarerad";
}

/** Momsperioder (kvartal) för ett år med status – underlag för momssidan. */
export function vatPeriods(year?: number): VatPeriodSummary[] {
  const today = todayDate();
  const y = year ?? Number(today.slice(0, 4));
  const fy = ensureFiscalYearFor(`${y}-06-15`);
  return quartersOf(fy).map((period) => {
    const report = db().vatReports.find((r) => r.periodStart === period.start && r.periodEnd === period.end);
    const position = computeVatPosition(period);
    let state: VatPeriodSummary["state"];
    if (report?.status === "deklarerad") state = "deklarerad";
    else if (period.end < today) state = "att_deklarera";
    else if (period.start <= today) state = "pagaende";
    else state = "kommande";
    return { period, dueDate: vatDueDate(period), position, report, state };
  });
}

/** Checklista inför deklaration – bara riktiga kontroller, serversidan. */
export interface VatChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export function vatChecklist(period: Period): VatChecklistItem[] {
  const data = db();
  const unbooked = data.bankTransactions.filter(
    (t) => t.status !== "bokford" && bokforingsdatum(t.date) <= period.end
  );
  const openQuestions = data.expenses.filter(
    (e) => e.status !== "bokford" && bokforingsdatum(e.date) <= period.end
  );
  const pos = computeVatPosition(period);
  return [
    {
      key: "bank",
      label: "Banken är avstämd för perioden",
      ok: unbooked.length === 0,
      detail: unbooked.length ? `${unbooked.length} banktransaktion${unbooked.length > 1 ? "er" : ""} väntar på hantering.` : undefined,
    },
    {
      key: "underlag",
      label: "Alla köp är bokförda med underlag",
      ok: openQuestions.length === 0,
      detail: openQuestions.length ? `${openQuestions.length} köp behöver kvitto eller svar.` : undefined,
    },
    {
      key: "moms",
      label: "Momsen är avstämd mot bokföringen",
      ok: true,
      detail: `Utgående ${pos.utgaende} kr, ingående ${pos.ingaende} kr – hämtat direkt ur huvudboken.`,
    },
  ];
}

/** Generera (eller uppdatera utkast till) momsrapport för en period. */
export function generateVatReport(periodKey: string, actor: "anvandare" | "assistent" | "system" = "anvandare"): VatReport {
  const year = Number(periodKey.slice(0, 4));
  const fy = ensureFiscalYearFor(`${year}-06-15`);
  const period = quartersOf(fy).find((p) => p.key === periodKey);
  if (!period) throw new Error(`Okänd momsperiod: ${periodKey}`);

  const existing = db().vatReports.find((r) => r.periodStart === period.start && r.periodEnd === period.end);
  if (existing?.status === "deklarerad") return existing;

  const pos = computeVatPosition(period);
  const now = new Date().toISOString();
  if (existing) {
    existing.boxes = pos.boxes;
    existing.utgaende = pos.utgaende;
    existing.ingaende = pos.ingaende;
    existing.attBetala = pos.attBetala;
    existing.generatedAt = now;
    save();
    return existing;
  }
  const report: VatReport = {
    id: uid(),
    fiscalYearId: fy.id,
    periodStart: period.start,
    periodEnd: period.end,
    label: period.label,
    status: "utkast",
    boxes: pos.boxes,
    utgaende: pos.utgaende,
    ingaende: pos.ingaende,
    attBetala: pos.attBetala,
    generatedAt: now,
  };
  db().vatReports.push(report);
  logAudit(actor, "momsrapport_genererad", `Momsrapport för ${period.label} genererades (att betala ${pos.attBetala} kr).`, {
    targetType: "momsrapport",
    targetId: report.id,
  });
  save();
  return report;
}

/** Tidigare kvartal med momsaktivitet som inte deklarerats – de måste tas i ordning. */
function undeclaredEarlierPeriods(report: VatReport): Period[] {
  const data = db();
  const years = new Set<number>();
  for (const v of data.verifications) years.add(Number(bokforingsdatum(v.date).slice(0, 4)));
  const out: Period[] = [];
  for (const y of [...years].sort((a, b) => a - b)) {
    const fy = ensureFiscalYearFor(`${y}-06-15`);
    for (const p of quartersOf(fy)) {
      if (p.end >= report.periodStart) continue;
      const declared = data.vatReports.some(
        (r) => r.periodStart === p.start && r.periodEnd === p.end && r.status === "deklarerad"
      );
      if (declared) continue;
      const pos = computeVatPosition(p);
      if (pos.utgaende !== 0 || pos.ingaende !== 0) out.push(p);
    }
  }
  return out;
}

/**
 * Markera momsrapporten som deklarerad. Ingen riktig inlämning sker –
 * detta är en manuell markering med audit trail. Momskontona förs om till
 * 2650 Redovisningskonto för moms, och perioden låses.
 *
 * Servervakter (gäller alla vägar in, även assistenten):
 *   * perioden måste ha tagit slut – annars skulle en PÅGÅENDE period låsas
 *     och alla kommande köp/fakturor i den avvisas.
 *   * tidigare perioder med momsaktivitet måste deklareras först (ordning).
 *   * bank + underlag för perioden måste vara hanterade (checklistan).
 */
export function markVatReportDeclared(reportId: string, actor: "anvandare" | "assistent"): VatReport {
  const report = db().vatReports.find((r) => r.id === reportId);
  if (!report) throw new Error("Momsrapporten finns inte.");
  if (report.status === "deklarerad") return report;

  const today = todayDate();
  if (report.periodEnd >= today) {
    throw new Error(
      `Momsperioden ${report.label} pågår fortfarande (till ${report.periodEnd}) – den kan markeras som deklarerad först när den är slut.`
    );
  }
  const earlier = undeclaredEarlierPeriods(report);
  if (earlier.length) {
    throw new Error(
      `Deklarera perioderna i ordning: ${earlier.map((p) => p.label).join(", ")} har momsaktivitet men är inte deklarerad${earlier.length > 1 ? "e" : ""} ännu.`
    );
  }

  const checklist = vatChecklist({
    key: "",
    label: report.label,
    start: report.periodStart,
    end: report.periodEnd,
  });
  const blockers = checklist.filter((c) => !c.ok);
  if (blockers.length) {
    throw new Error(
      `Momsrapporten kan inte markeras som deklarerad ännu: ${blockers.map((b) => b.detail ?? b.label).join(" ")}`
    );
  }

  // Frys siffrorna vid deklarationstillfället.
  const pos = computeVatPosition({ key: "", label: report.label, start: report.periodStart, end: report.periodEnd });
  report.boxes = pos.boxes;
  report.utgaende = pos.utgaende;
  report.ingaende = pos.ingaende;
  report.attBetala = pos.attBetala;

  // Omför momskontonas saldon för perioden till 2650.
  const entries: { account: number; debit?: number; credit?: number }[] = [];
  const perAccount = new Map<number, number>();
  for (const v of db().verifications) {
    const d = bokforingsdatum(v.date);
    if (d < report.periodStart || d > report.periodEnd) continue;
    for (const e of v.entries) {
      const def = vatCodeForAccount(e.account);
      if (!def || def.kind === "forsaljning") continue;
      perAccount.set(e.account, (perAccount.get(e.account) ?? 0) + e.debit - e.credit);
    }
  }
  for (const [account, net] of perAccount) {
    if (net === 0) continue;
    // Nollställ kontot för perioden: motsatt tecken.
    if (net < 0) entries.push({ account, debit: -net });
    else entries.push({ account, credit: net });
  }
  let verificationId: string | undefined;
  if (entries.length > 0) {
    const sum = entries.reduce((s, e) => s + (e.debit ?? 0) - (e.credit ?? 0), 0);
    if (sum < 0) entries.push({ account: 2650, debit: -sum });
    else if (sum > 0) entries.push({ account: 2650, credit: sum });
    const ver = postVerification(
      {
        date: report.periodEnd,
        description: `Momsredovisning ${report.label}`,
        entries,
        source: { type: "moms", id: report.id },
        createdBy: actor,
        explanation: `Momsen för ${report.label} fördes om till redovisningskontot (2650) när deklarationen markerades som lämnad. ${report.attBetala >= 0 ? `Att betala: ${report.attBetala} kr.` : `Att få tillbaka: ${-report.attBetala} kr.`}`,
      },
      { bypassPeriodLock: true }
    );
    verificationId = ver.id;
  }

  report.status = "deklarerad";
  report.declaredAt = new Date().toISOString();
  report.settleVerificationId = verificationId;
  logAudit(actor, "momsrapport_deklarerad", `Momsrapporten för ${report.label} markerades som deklarerad (${report.attBetala} kr).`, {
    targetType: "momsrapport",
    targetId: report.id,
  });
  lockPeriod(report.periodEnd, actor);
  save();
  return report;
}

/** Momsläget just nu (innevarande period) – för Hem och Bokföring. */
export function currentVatPosition(): VatPosition {
  const today = todayDate();
  const fy = ensureFiscalYearFor(today);
  const period = quartersOf(fy).find((p) => p.start <= today && today <= p.end)!;
  return computeVatPosition(period);
}
