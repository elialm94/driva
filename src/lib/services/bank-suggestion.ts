import { db } from "../store";
import type { BankTransaction } from "../types";
import { bankKindByKey, bankKindByPattern, directionOf, type BankKindKey } from "../banking/bank-kinds";
import {
  MERCHANT_KB_VERSION,
  MERCHANT_TYPE_LABEL,
  PRIVATE_ANSWER,
  RISK_FLAG_LABEL,
  merchantRiskFlags,
  normalizeMerchant,
  type NormalizedMerchant,
  type RiskFlag,
} from "../banking/merchants";
import { bankCounterpartRuleFor, RULE_AUTO_THRESHOLD } from "./bank-booking";
import { paymentSuggestionForTransaction, type PaymentSuggestion } from "./payment-matching";
import { kr } from "../format";

/**
 * Evidence-first-bedömning av en obokad banktransaktion.
 *
 * Ingen parallell motor: faktura-/leverantörsmatchningen (payment-matching)
 * och regel-/verifikations-/mönsterförslagen (bank-booking) är källan. Det
 * här lagret gör tre saker ovanpå dem, i ordning efter bevisstyrka:
 *
 *   1. Samlar BEVISEN i klartext (faktura/OCR, leverantörsbetalning, kvitto,
 *      företagets egen regel, redan bokförd verifikation, återkommande
 *      betalning, textmönster, kunskapsbasen) – aldrig en gissning utan källa.
 *   2. Sätter separata konfidenser för matchning, kategori, moms och syfte,
 *      och därav en nivå: Säker (ett klick), Troligt (ja eller kort fråga),
 *      Osäkert (2–4 val, inget förvalt).
 *   3. Avgör om automatik ÄR TILLÅTEN: riskflaggor (privatrisk, restaurang,
 *      kontantuttag, överföring till person, utland, okänd mottagare,
 *      ovanligt belopp) kräver alltid människa, oavsett hur säker regeln är.
 *
 * Moms bokförs aldrig från en bankrad: typerna i katalogen är momsfria eller
 * kräver underlag (kortköp → kvitto, lokalhyra → hyresavi). LLM är inte en
 * beviskälla här och används aldrig för moms, kvitto eller syfte.
 */

export type SuggestionTier = "saker" | "troligt" | "osakert";
export type SuggestionConfidence = "hog" | "medel" | "lag" | "ingen";

export type EvidenceKind =
  | "faktura"
  | "leverantorsbetalning"
  | "skattereduktion"
  | "kvitto"
  | "regel"
  | "verifikation"
  | "aterkommande"
  | "monster"
  | "kunskapsbas";

export interface Evidence {
  kind: EvidenceKind;
  /** Klartext som visas för användaren: "Faktura #123 matchar OCR och belopp". */
  text: string;
}

export type SuggestionChoice =
  | { kind: "bank_kind"; bankKind: BankKindKey; label: string; hint?: string }
  | { kind: "kortkop"; label: string; hint: string }
  | { kind: "privat"; label: string; hint: string }
  | { kind: "faktura"; invoiceId: string; label: string }
  | { kind: "annat"; label: string; hint: string };

export interface RecurringPattern {
  /** Antal tidigare bokförda transaktioner med samma normaliserade motpart och riktning. */
  count: number;
  /** Medianbelopp (positivt). */
  typicalAmount: number;
  /** Ungefär en gång i månaden (medianavstånd 25–35 dagar). */
  monthly: boolean;
}

export interface BankSuggestion {
  txId: string;
  direction: "in" | "ut";
  merchant: NormalizedMerchant;
  /** Det underliggande förslaget från matchningen – oförändrat. */
  payment: PaymentSuggestion;
  /** Var det starkaste beviset kom ifrån. */
  source: string;
  evidence: Evidence[];
  confidence: {
    match: SuggestionConfidence;
    category: SuggestionConfidence;
    vat: SuggestionConfidence;
    businessPurpose: SuggestionConfidence;
  };
  tier: SuggestionTier;
  /** Flaggor som kräver mänskligt beslut – en räcker för att stoppa automatik. */
  humanRequired: RiskFlag[];
  /** Får bokföras utan människa: AUTO_EXECUTE från matchningen OCH inga riskflaggor. */
  autoAllowed: boolean;
  /** 2–4 begripliga val när nivån är Osäkert (annars tomt). Inget är förvalt. */
  choices: SuggestionChoice[];
  kbVersion: string;
  ruleVersion?: number;
  recurring?: RecurringPattern;
}

/* ------------------------------ Återkommande ------------------------------ */

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * Tidigare bokförda transaktioner från samma motpart i samma riktning. Ger
 * typiskt belopp (för "ovanligt belopp") och om betalningen är månatlig – en
 * hyra känns igen på periodiciteten, men momsen antas ändå aldrig.
 */
export function recurringPatternFor(tx: BankTransaction): RecurringPattern | undefined {
  const key = normalizeMerchant(tx.counterpart).key;
  if (!key) return undefined;
  const direction = directionOf(tx.amount);
  const data = db();
  const previous = data.bankTransactions
    .filter((t) => t.id !== tx.id && t.status === "bokford" && directionOf(t.amount) === direction && normalizeMerchant(t.counterpart).key === key)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (previous.length < 2) return undefined;

  const gaps: number[] = [];
  for (let i = 1; i < previous.length; i++) {
    gaps.push(Math.round((Date.parse(previous[i]!.date) - Date.parse(previous[i - 1]!.date)) / 86_400_000));
  }
  const gap = median(gaps);
  return {
    count: previous.length,
    typicalAmount: median(previous.map((t) => Math.abs(t.amount))),
    monthly: gap >= 25 && gap <= 35,
  };
}

/* --------------------------------- Bevis --------------------------------- */

function evidenceFor(tx: BankTransaction, payment: PaymentSuggestion, merchant: NormalizedMerchant, recurring?: RecurringPattern): Evidence[] {
  const out: Evidence[] = [];
  switch (payment.kind) {
    case "match":
      out.push({ kind: "faktura", text: `Faktura #${payment.invoiceNumber ?? "?"} till ${payment.customerName ?? "kund"} – ${lowerFirst(payment.reason)}` });
      break;
    case "supplier_payment":
      out.push({ kind: "leverantorsbetalning", text: payment.reason });
      break;
    case "tax_reduction_payout":
      out.push({ kind: "skattereduktion", text: payment.reason });
      break;
    case "credit_refund":
      out.push({ kind: "faktura", text: payment.reason });
      break;
    case "bank_kind":
      if (payment.bankKindSource === "regel") out.push({ kind: "regel", text: payment.reason });
      else if (payment.bankKindSource === "verifikation") out.push({ kind: "verifikation", text: payment.reason });
      else out.push({ kind: "monster", text: payment.reason });
      break;
    default:
      break;
  }
  if (recurring) {
    out.push({
      kind: "aterkommande",
      text: `${merchant.display} har betalats ${recurring.count} gånger tidigare${recurring.monthly ? ", ungefär en gång i månaden" : ""} – typiskt ${kr(recurring.typicalAmount)}`,
    });
  }
  if (merchant.knowledge) {
    const k = merchant.knowledge;
    out.push({
      kind: "kunskapsbas",
      text: k.followUp
        ? `${k.display} känns igen som ${MERCHANT_TYPE_LABEL[k.type]} – ${lowerFirst(k.followUp.question)}`
        : `${k.display} känns igen som ${MERCHANT_TYPE_LABEL[k.type]}`,
    });
  }
  return out;
}

/* -------------------------------- Konfidens ------------------------------- */

/** Typer som bokförs utan moms – momsen är "säker" eftersom det inte finns någon att lyfta. */
const VAT_FREE_KINDS = new Set<BankKindKey>([
  "bankavgift",
  "ranta",
  "amortering",
  "forsakring",
  "utdelning",
  "aterbetalning_agare",
  "overforing_eget_konto",
  "skattekonto",
  "privat_kop",
  "agartillskott",
  "lan_utbetalt",
  "ranteintakt",
  "skatteaterbetalning",
  "ovrig_intakt",
  "redan_bokford",
]);

function confidences(payment: PaymentSuggestion, flags: RiskFlag[], ruleCount: number | undefined): BankSuggestion["confidence"] {
  const purposeRisk = flags.includes("privat_risk") || flags.includes("restaurang") || flags.includes("kontantuttag");
  switch (payment.kind) {
    case "match":
    case "supplier_payment":
    case "tax_reduction_payout":
    case "credit_refund": {
      // Dokumentet (faktura, leverantörsfaktura, ROT-beslut) bär kategori,
      // moms och syfte – bara matchningen kan vara osäker.
      return {
        match: payment.outcome === "AUTO_EXECUTE" ? "hog" : "medel",
        category: "hog",
        vat: "hog",
        businessPurpose: "hog",
      };
    }
    case "bank_kind": {
      const kind = payment.bankKind;
      const bySource: SuggestionConfidence =
        payment.bankKindSource === "regel"
          ? (ruleCount ?? 0) >= RULE_AUTO_THRESHOLD
            ? "hog"
            : "medel"
          : payment.bankKindSource === "verifikation"
            ? "hog"
            : payment.outcome === "AUTO_EXECUTE"
              ? "hog"
              : "medel";
      const vat: SuggestionConfidence =
        kind === "kortkop" ? "ingen" : kind === "lokalhyra" ? "lag" : kind && VAT_FREE_KINDS.has(kind) ? "hog" : "lag";
      return {
        match: bySource,
        category: bySource,
        vat,
        businessPurpose: purposeRisk ? "lag" : payment.bankKindSource === "regel" ? "medel" : payment.outcome === "AUTO_EXECUTE" ? "hog" : "medel",
      };
    }
    default:
      return { match: "ingen", category: "ingen", vat: "ingen", businessPurpose: purposeRisk ? "lag" : "ingen" };
  }
}

/* ---------------------------------- Nivå ---------------------------------- */

/** Flaggor som gör att inte ens ett tydligt förslag får visas som "Troligt". */
const HARD_FLAGS: ReadonlySet<RiskFlag> = new Set(["kontantuttag", "overforing_till_person", "utland", "restaurang"]);

function tierFor(payment: PaymentSuggestion, flags: RiskFlag[]): { tier: SuggestionTier; autoAllowed: boolean } {
  const hard = flags.some((f) => HARD_FLAGS.has(f));
  if (payment.outcome === "AUTO_EXECUTE") {
    if (flags.length === 0) return { tier: "saker", autoAllowed: true };
    return { tier: hard ? "osakert" : "troligt", autoAllowed: false };
  }
  if (payment.outcome === "SUGGEST") return { tier: hard ? "osakert" : "troligt", autoAllowed: false };
  return { tier: "osakert", autoAllowed: false };
}

/* ---------------------------------- Val ---------------------------------- */

function choicesFor(tx: BankTransaction, payment: PaymentSuggestion, merchant: NormalizedMerchant, flags: RiskFlag[]): SuggestionChoice[] {
  const out: SuggestionChoice[] = [];
  const outgoing = tx.amount < 0;
  const push = (c: SuggestionChoice) => {
    if (out.length >= 4) return;
    if (out.some((o) => o.label === c.label)) return;
    out.push(c);
  };

  if (payment.kind === "match" && payment.invoiceId) {
    push({ kind: "faktura", invoiceId: payment.invoiceId, label: `Betalning av faktura #${payment.invoiceNumber ?? ""}`.trim() });
  }
  if (payment.kind === "bank_kind" && payment.bankKind && payment.bankKind !== "kortkop") {
    const def = bankKindByKey(payment.bankKind);
    if (def) push({ kind: "bank_kind", bankKind: def.key, label: def.label, hint: def.hint });
  }
  if (outgoing) {
    const k = merchant.knowledge;
    if (k?.type === "kontantuttag" || flags.includes("kontantuttag")) {
      push({ kind: "kortkop", label: "Kontanter till företagsköp – lägg till kvitton", hint: "Uttaget bokförs när kvittona för det som köptes finns" });
      push({ kind: "bank_kind", bankKind: "aterbetalning_agare", label: "Ägaren tog ut egna pengar", hint: bankKindByKey("aterbetalning_agare")!.hint });
      push({ kind: "privat", label: PRIVATE_ANSWER, hint: "Ingen kostnad – beloppet blir en skuld från dig till bolaget" });
    } else if (flags.includes("overforing_till_person")) {
      push({ kind: "bank_kind", bankKind: "aterbetalning_agare", label: "Återbetalning till ägaren", hint: bankKindByKey("aterbetalning_agare")!.hint });
      push({ kind: "bank_kind", bankKind: "lon", label: "Lön", hint: bankKindByKey("lon")!.hint });
      push({ kind: "kortkop", label: "Köp av en privatperson – lägg till kvitto", hint: "Kvitto eller avtal krävs som underlag" });
      push({ kind: "privat", label: PRIVATE_ANSWER, hint: "Ingen kostnad – beloppet blir en skuld från dig till bolaget" });
    } else {
      const byPattern = payment.kind === "bank_kind" ? null : bankKindByPattern(tx);
      if (byPattern && byPattern.entries) push({ kind: "bank_kind", bankKind: byPattern.key, label: byPattern.label, hint: byPattern.hint });
      push({
        kind: "kortkop",
        label: k?.followUp ? "Köp till företaget – kvittot avgör" : "Köp till företaget – lägg till kvitto",
        hint: k?.followUp ? `${k.followUp.question} Svaret ges när kvittot finns.` : "Blir ett köp som väntar på kvitto; momsen lyfts först då",
      });
      if (!k?.followUp && !byPattern) {
        push({ kind: "bank_kind", bankKind: "overforing_eget_konto", label: "Överföring till eget konto", hint: bankKindByKey("overforing_eget_konto")!.hint });
      }
      push({ kind: "privat", label: PRIVATE_ANSWER, hint: "Ingen kostnad – beloppet blir en skuld från dig till bolaget" });
    }
  } else {
    if (payment.kind !== "match") push({ kind: "annat", label: "Betalning av en faktura", hint: "Välj vilken faktura inbetalningen hör till" });
    push({ kind: "bank_kind", bankKind: "agartillskott", label: "Insättning från ägaren", hint: bankKindByKey("agartillskott")!.hint });
    push({ kind: "bank_kind", bankKind: "ovrig_intakt", label: "Övrig ersättning", hint: bankKindByKey("ovrig_intakt")!.hint });
  }
  if (out.length < 4) push({ kind: "annat", label: "Något annat", hint: "Bokför med egen kontering under Verifikationer" });
  return out.slice(0, 4);
}

/* -------------------------------- Bedömning ------------------------------- */

export function evaluateBankTransaction(tx: BankTransaction): BankSuggestion {
  return assess(tx, paymentSuggestionForTransaction(tx));
}

/** Samma bedömning för ett redan framräknat förslag (autopiloten har det). */
export function assessBankTransaction(tx: BankTransaction, payment: PaymentSuggestion): BankSuggestion {
  return assess(tx, payment);
}

/**
 * Kortköp och koppling till redan bokförd verifikation skapar ingen ny
 * kostnad – kvittoflödet respektive den befintliga verifikationen bär beviset.
 */
function exemptFromRiskGuard(payment: PaymentSuggestion): boolean {
  return payment.kind === "bank_kind" && (payment.bankKind === "kortkop" || payment.bankKind === "redan_bokford");
}

function assess(tx: BankTransaction, rawPayment: PaymentSuggestion): BankSuggestion {
  let payment = rawPayment;
  const merchant = normalizeMerchant(tx.counterpart);
  const rule = bankCounterpartRuleFor(tx.counterpart);
  const recurring = recurringPatternFor(tx);
  const documentBacked = payment.kind === "match" || payment.kind === "supplier_payment" || payment.kind === "tax_reduction_payout" || payment.kind === "credit_refund";

  const flags = documentBacked
    ? riskFlagsForDocumentBacked(tx, recurring)
    : merchantRiskFlags({
        amount: tx.amount,
        counterpart: tx.counterpart,
        description: tx.description,
        reference: tx.reference,
        typicalAmount: recurring?.typicalAmount,
        // Känd mottagare: företagets egen regel, en verifikation som redan
        // bär beloppet, eller ett deterministiskt AUTO-mönster (egen banks
        // avgift, exakt F-skatt) – aldrig ett vanligt textmönster.
        known:
          Boolean(rule) ||
          payment.bankKindSource === "verifikation" ||
          payment.bankKindSource === "regel" ||
          (payment.kind === "bank_kind" && payment.outcome === "AUTO_EXECUTE"),
      });

  // Vakten: hur säker matchningen än är får inget bokföras automatiskt när
  // motparten bär en riskflagga. Förslaget står kvar – som något människan
  // godkänner – och säger varför.
  if (payment.outcome === "AUTO_EXECUTE" && flags.length > 0 && !exemptFromRiskGuard(payment)) {
    payment = {
      ...payment,
      outcome: "SUGGEST",
      reason: `${payment.reason} · kräver ditt beslut: ${flags.map((f) => RISK_FLAG_LABEL[f].toLowerCase()).join(", ")}`,
    };
  }

  const { tier, autoAllowed } = tierFor(payment, flags);
  const source =
    payment.kind === "bank_kind"
      ? payment.bankKindSource ?? "monster"
      : payment.kind === "none"
        ? merchant.knowledge
          ? "kunskapsbas"
          : "ingen"
        : payment.kind;

  return {
    txId: tx.id,
    direction: directionOf(tx.amount),
    merchant,
    payment,
    source,
    evidence: evidenceFor(tx, payment, merchant, recurring),
    confidence: confidences(payment, flags, rule?.count),
    tier,
    humanRequired: flags,
    autoAllowed,
    choices: tier === "osakert" ? choicesFor(tx, payment, merchant, flags) : [],
    kbVersion: MERCHANT_KB_VERSION,
    ...(rule?.version ? { ruleVersion: rule.version } : {}),
    ...(recurring ? { recurring } : {}),
  };
}

/**
 * Faktura-/leverantörsmatchning vilar på ett dokument med belopp och referens
 * – motpartsrisken (restaurang, privat) är då irrelevant. Bara ett ovanligt
 * stort belopp mot historiken stoppar automatiken.
 */
function riskFlagsForDocumentBacked(tx: BankTransaction, recurring?: RecurringPattern): RiskFlag[] {
  if (recurring && Math.abs(tx.amount) >= 1_000 && Math.abs(tx.amount) > 3 * recurring.typicalAmount) return ["ovanligt_belopp"];
  return [];
}

export const TIER_LABEL: Record<SuggestionTier, string> = {
  saker: "Säker",
  troligt: "Troligt",
  osakert: "Osäkert",
};

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}
