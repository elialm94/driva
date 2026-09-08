import { db } from "../store";
import { datumLang, kr } from "../format";
import type { VatBox, VatReport } from "../types";
import { bokforingsdatum, fiscalYearFor, todayDate } from "./fiscal";
import {
  generateVatReport,
  markVatReportDeclared,
  undeclaredVatPeriodsBefore,
  vatChecklist,
  type VatChecklistItem,
  type VatPeriodSummary,
} from "./vat";
import { SKATTEKONTO, vatOnTaxAccountVerification } from "./tax-account";

/**
 * Momsen i tre steg – Kontrollera, Deklarera, Betala.
 *
 * Momssidan visade tidigare allt på en gång: rutor, checklista, knappar för
 * rapport, deklaration, inlämning och skattekonto i samma kort. Här räknas
 * i stället fram VAR i flödet en period befinner sig, så att sidan kan visa
 * ett steg i taget och alltid ha ett tydligt nästa klick. Ren läsning på
 * bokföringen – inget lagras om stegen; de följer av rapportens status och
 * verifikationerna.
 */

export type VatStepKey = "kontrollera" | "deklarera" | "betala";

/**
 * klar     – steget är avklarat.
 * nu       – det här är nästa sak att göra.
 * vantar   – kommer efter det som pågår.
 * pagaende – perioden är inte slut (bara steg 1 kan ha den).
 */
export type VatStepStatus = "klar" | "nu" | "vantar" | "pagaende";

export interface VatFlowStep {
  key: VatStepKey;
  title: string;
  status: VatStepStatus;
  /** En rad under rubriken – vad som är gjort eller vad som väntar. */
  summary: string;
}

export interface VatPaymentInfo {
  /** Hela kronor, alltid positivt. */
  amount: number;
  direction: "betala" | "tillbaka" | "noll";
  /** Pengarna ska finnas på skattekontot senast den här dagen (samma dag som deklarationen). */
  dueDate: string;
  /** Dagar kvar till förfallodagen; negativt = förfallen. */
  daysLeft: number;
  bankgiro: string;
  /** Sparat referensnummer för inbetalningar till skattekontot. */
  ocr?: string;
  /** Momsen är flyttad från redovisningskontot (2650) till skattekontot (1630). */
  bookedOnTaxAccount?: { verificationId: string; date: string };
  /** Överföring till skattekontot efter periodens slut som är minst lika stor som momsen. */
  transferSeen?: { verificationId: string; date: string; amount: number };
}

export interface EarlierPeriodRef {
  key: string;
  label: string;
  /** Räkenskapsåret perioden hör till – för länken när det är ett annat år än det som visas. */
  fiscalYearLabel?: string;
}

export interface VatPeriodFlow {
  summary: VatPeriodSummary;
  checklist: VatChecklistItem[];
  blockers: VatChecklistItem[];
  /** Tidigare perioder med moms som inte är deklarerade – de måste tas först. */
  earlierUndeclared: EarlierPeriodRef[];
  steps: VatFlowStep[];
  /** Steget användaren ska ta nu, eller null när allt är klart eller perioden pågår. */
  current: VatStepKey | null;
  /** Rutorna med belopp – de som fylls i hos Skatteverket. Ruta 49 är alltid med. */
  boxesToFill: VatBox[];
  payment: VatPaymentInfo;
  /** Sant när hela flödet är avklarat – kortet kan visas som en rad. */
  done: boolean;
}

/** Skatteverkets bankgiro för alla inbetalningar till skattekontot. */
export const SKATTEVERKET_BANKGIRO = "5050-1055";

const STEP_TITLES: Record<VatStepKey, string> = {
  kontrollera: "Kontrollera underlaget",
  deklarera: "Deklarera hos Skatteverket",
  betala: "Betala",
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/**
 * Överföringar från banken till skattekontot (1630 debet mot 19xx) efter
 * periodens slut. Skattekontot är gemensamt för moms, F-skatt och avgifter,
 * så det här är en ledtråd – inte ett bevis på att just momsen är betald.
 */
export function taxAccountTransfersSince(date: string): { verificationId: string; date: string; amount: number }[] {
  const out: { verificationId: string; date: string; amount: number }[] = [];
  for (const v of db().verifications) {
    if (v.correctedByVerificationId) continue;
    const d = bokforingsdatum(v.date);
    if (d < date) continue;
    const toTaxAccount = v.entries.filter((e) => e.account === SKATTEKONTO).reduce((s, e) => s + e.debit - e.credit, 0);
    const fromBank = v.entries.some((e) => e.account >= 1900 && e.account < 2000 && e.credit > 0);
    if (toTaxAccount > 0 && fromBank) out.push({ verificationId: v.id, date: d, amount: toTaxAccount });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function paymentInfo(summary: VatPeriodSummary, today: string): VatPaymentInfo {
  const attBetala = summary.report?.status === "deklarerad" ? summary.report.attBetala : summary.position.attBetala;
  const amount = Math.abs(attBetala);
  const info: VatPaymentInfo = {
    amount,
    direction: attBetala > 0 ? "betala" : attBetala < 0 ? "tillbaka" : "noll",
    dueDate: summary.dueDate,
    daysLeft: daysBetween(today, summary.dueDate),
    bankgiro: SKATTEVERKET_BANKGIRO,
  };
  const ocr = db().settings.taxAccountOcr?.trim();
  if (ocr) info.ocr = ocr;
  if (summary.report?.status === "deklarerad") {
    const booked = vatOnTaxAccountVerification(summary.report.id);
    if (booked) info.bookedOnTaxAccount = { verificationId: booked.id, date: bokforingsdatum(booked.date) };
    if (attBetala > 0) {
      const transfer = taxAccountTransfersSince(summary.period.end).find((t) => t.amount >= amount);
      if (transfer) info.transferSeen = transfer;
    }
  }
  return info;
}

/** Var perioden står i de tre stegen, med allt sidan behöver för att visa dem. */
export function vatPeriodFlow(summary: VatPeriodSummary, today: string = todayDate()): VatPeriodFlow {
  const ended = summary.period.end < today;
  const declared = summary.report?.status === "deklarerad";
  const earlierUndeclared: EarlierPeriodRef[] =
    ended && !declared
      ? undeclaredVatPeriodsBefore(summary.period.start).map((p) => ({
          key: p.key,
          label: p.label,
          fiscalYearLabel: fiscalYearFor(p.start)?.label,
        }))
      : [];
  const checklist = ended && !declared ? [...vatChecklist(summary.period), orderingCheck(earlierUndeclared)] : [];
  const blockers = checklist.filter((c) => !c.ok);
  const payment = paymentInfo(summary, today);
  const boxesToFill = summary.position.boxes.filter((b) => b.amount !== 0 || b.code === "49");
  const dueText = `senast ${datumLang(payment.dueDate)}`;

  let steps: VatFlowStep[];
  let current: VatStepKey | null;

  if (!ended) {
    steps = [
      step(
        "kontrollera",
        "pagaende",
        `Perioden pågår till ${datumLang(summary.period.end)}. Bokför löpande – underlaget kontrolleras när den är slut.`
      ),
      step("deklarera", "vantar", `Deklareras ${dueText}.`),
      step("betala", "vantar", "Betalas samma dag som deklarationen."),
    ];
    current = null;
  } else if (!declared) {
    const ready = blockers.length === 0;
    steps = [
      step(
        "kontrollera",
        ready ? "klar" : "nu",
        ready ? "Banken är avstämd och alla köp är bokförda." : blockers.map((b) => b.detail ?? b.label).join(" ")
      ),
      step(
        "deklarera",
        ready ? "nu" : "vantar",
        ready ? `Lämna in ${dueText} – fyll i rutorna eller ladda upp filen.` : `Deklareras ${dueText}.`
      ),
      step("betala", "vantar", paymentSummary(payment, false)),
    ];
    current = ready ? "deklarera" : "kontrollera";
  } else {
    const paid = payment.direction === "noll" || Boolean(payment.bookedOnTaxAccount);
    const declaredOn = summary.report?.declaredAt ? ` ${datumLang(bokforingsdatum(summary.report.declaredAt))}` : "";
    steps = [
      step("kontrollera", "klar", "Underlaget kontrollerades innan deklarationen."),
      step("deklarera", "klar", `Deklarerad${declaredOn}. Siffrorna är frysta och perioden låst.`),
      step("betala", paid ? "klar" : "nu", paymentSummary(payment, paid)),
    ];
    current = paid ? null : "betala";
  }

  return {
    summary,
    checklist,
    blockers,
    earlierUndeclared,
    steps,
    current,
    boxesToFill,
    payment,
    done: declared && current === null,
  };
}

function step(key: VatStepKey, status: VatStepStatus, summary: string): VatFlowStep {
  return { key, title: STEP_TITLES[key], status, summary };
}

/** Deklarationerna tas i ordning – samma spärr som markVatReportDeclared, men synlig innan klicket. */
function orderingCheck(earlier: EarlierPeriodRef[]): VatChecklistItem {
  return {
    key: "ordning",
    label: "Tidigare perioder är deklarerade",
    ok: earlier.length === 0,
    detail: earlier.length
      ? `Deklarera ${earlier.map((p) => p.label).join(", ")} först – perioderna tas i ordning.`
      : undefined,
  };
}

function paymentSummary(p: VatPaymentInfo, paid: boolean): string {
  if (p.direction === "noll") return "Ingen moms att betala för perioden.";
  if (p.direction === "tillbaka") {
    return paid
      ? `${kr(p.amount)} tillgodofördes skattekontot.`
      : `${kr(p.amount)} att få tillbaka – Skatteverket betalar ut efter deklarationen.`;
  }
  if (paid) {
    return p.transferSeen
      ? `${kr(p.amount)} bokfört på skattekontot · överföring ${datumLang(p.transferSeen.date)} syns i banken.`
      : `${kr(p.amount)} bokfört på skattekontot.`;
  }
  return `${kr(p.amount)} ska finnas på skattekontot senast ${datumLang(p.dueDate)}.`;
}

/**
 * Perioden sidan ska öppna: den som väntar på användaren (först att deklarera,
 * annars en deklarerad som inte är betald), annars den som pågår.
 */
export function vatFlowFocus(flows: VatPeriodFlow[]): string | null {
  const acting = flows.find((f) => f.current !== null);
  if (acting) return acting.summary.period.key;
  const running = flows.find((f) => f.summary.state === "pagaende");
  return running?.summary.period.key ?? null;
}

/**
 * Deklarera en period i ett klick: rapporten skapas (eller uppdateras) ur
 * bokföringen och markeras som deklarerad. Alla servervakter i
 * markVatReportDeclared gäller – perioden måste vara slut, tidigare perioder
 * deklarerade och checklistan grön.
 */
export function declareVatPeriod(periodKey: string, actor: "anvandare" | "assistent"): VatReport {
  const report = generateVatReport(periodKey, actor);
  return markVatReportDeclared(report.id, actor);
}
