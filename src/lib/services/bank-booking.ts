import { db, save } from "../store";
import type { BankCounterpartRule, BankTransaction, Verification } from "../types";
import {
  bankKindByKey,
  bankKindByPattern,
  bankKindPostsHere,
  directionOf,
  type BankKind,
  type BankKindKey,
} from "../banking/bank-kinds";
import type { AutopilotOutcome } from "../autopilot";
import { postVerification, verificationLabel } from "../accounting/engine";
import { clampToOpenDate } from "../accounting/fiscal";
import { bokforingsdatum } from "../accounting/dates";
import { logAudit } from "../accounting/audit";
import { logActivity } from "./activity";
import { createExpenseFromBankPurchase, merchantRuleKey } from "./expenses";
import { datumKort, kr } from "../format";

/**
 * Bokföring av banktransaktioner som inte är kundbetalningar, leverantörs-
 * betalningar eller kortköp med kvitto – bankvyns "vad är det här?".
 *
 * Tre källor till förslag, i fallande styrka:
 *   1. Lärda motpartsregler (användarens egna val). Andra gången samma
 *      motpart bokförs likadant sker det automatiskt med förklaring.
 *   2. Redan bokförd: beloppet finns redan på 1930 i en verifikation som ingen
 *      banktransaktion pekar på (lönekörningen, F-skatt …) – då kopplas de.
 *   3. Mönster i beskrivningen ("Månadsavgift", "Amortering") – alltid bara
 *      ett förslag tills användaren bekräftat.
 *
 * Förslag lagras aldrig; de räknas om ur aktuell data. Bokföringen går genom
 * postVerification precis som allt annat.
 */

const FORETAGSKONTO = 1930;
/** Så många dagar får bank och bokföring skilja för "redan bokförd". */
const ALREADY_BOOKED_WINDOW_DAYS = 10;
/** Hur många bekräftelser en regel behöver innan den bokför själv. */
export const RULE_AUTO_THRESHOLD = 2;

/* -------------------------------- Regler --------------------------------- */

export function bankRuleKey(counterpart: string): string {
  return merchantRuleKey(counterpart);
}

export function bankCounterpartRuleFor(counterpart: string): BankCounterpartRule | undefined {
  const key = bankRuleKey(counterpart);
  if (!key) return undefined;
  const rule = db().meta.bankCounterpartRules?.[key];
  return rule && bankKindByKey(rule.kind) ? rule : undefined;
}

/** Mänskligt val → regeln räknas upp (byte av typ nollställer räknaren). */
export function recordBankCounterpartRule(counterpart: string, kind: BankKindKey): BankCounterpartRule | undefined {
  const key = bankRuleKey(counterpart);
  const def = bankKindByKey(kind);
  if (!key || !def?.learnable) return undefined;
  const data = db();
  const rules = data.meta.bankCounterpartRules ?? {};
  const existing = rules[key];
  const now = new Date().toISOString();
  const rule: BankCounterpartRule =
    existing && existing.kind === kind
      ? { ...existing, count: existing.count + 1, lastUsedAt: now, counterpart: counterpart.trim() }
      : { kind, count: 1, lastUsedAt: now, counterpart: counterpart.trim() };
  rules[key] = rule;
  data.meta.bankCounterpartRules = rules;
  return rule;
}

export function forgetBankCounterpartRule(counterpart: string): boolean {
  const key = bankRuleKey(counterpart);
  const rules = db().meta.bankCounterpartRules;
  if (!key || !rules?.[key]) return false;
  delete rules[key];
  save();
  return true;
}

export interface BankCounterpartRuleView {
  key: string;
  counterpart: string;
  kind: BankKindKey;
  kindLabel: string;
  count: number;
  lastUsedAt: string;
  /** Bokför själv nästa gång (count ≥ tröskeln, eller redan bokförd med en träff). */
  automatic: boolean;
}

/** Reglerna för inställningar/översikt – senast använda först. */
export function listBankCounterpartRules(): BankCounterpartRuleView[] {
  const rules = db().meta.bankCounterpartRules ?? {};
  return Object.entries(rules)
    .flatMap(([key, rule]) => {
      const def = bankKindByKey(rule.kind);
      if (!def) return [];
      return [
        {
          key,
          counterpart: rule.counterpart || key,
          kind: def.key,
          kindLabel: def.label,
          count: rule.count,
          lastUsedAt: rule.lastUsedAt,
          automatic: ruleIsAutomatic(rule),
        },
      ];
    })
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}

function ruleIsAutomatic(rule: BankCounterpartRule): boolean {
  // Att koppla till en befintlig verifikation skapar ingen ny bokföring, så
  // en bekräftelse räcker. Kortköp skapar bara ett köp som väntar på kvitto.
  if (rule.kind === "redan_bokford" || rule.kind === "kortkop") return rule.count >= 1;
  return rule.count >= RULE_AUTO_THRESHOLD;
}

/* ---------------------------- Redan bokförd ------------------------------ */

export interface AlreadyBookedOption {
  verificationId: string;
  /** "A123" */
  label: string;
  description: string;
  date: string;
  /** Vad verifikationen kom från – "lon", "skattekonto", "manuell" … */
  sourceType: Verification["source"]["type"];
}

function bankNetOf(v: Verification): number {
  let net = 0;
  for (const e of v.entries) if (e.account === FORETAGSKONTO) net += e.debit - e.credit;
  return net;
}

function daysApart(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(bokforingsdatum(a)) - Date.parse(bokforingsdatum(b))) / 86_400_000));
}

/**
 * Verifikationer som redan rör företagskontot med exakt transaktionens belopp,
 * inom några dagar, och som ingen banktransaktion pekar på. Lönekörningen är
 * typfallet: den krediterar 1930 på utbetalningsdagen, och när banken sedan
 * visar utbetalningen ska den kopplas – inte bokföras en gång till.
 */
export function alreadyBookedCandidates(tx: BankTransaction): AlreadyBookedOption[] {
  const data = db();
  const linked = new Set(data.bankTransactions.filter((t) => t.verificationId).map((t) => t.verificationId));
  const out: { option: AlreadyBookedOption; distance: number }[] = [];
  for (const v of data.verifications) {
    if (linked.has(v.id)) continue;
    if (v.correctedByVerificationId || v.source.type === "rattelse") continue;
    if (bankNetOf(v) !== tx.amount) continue;
    const distance = daysApart(v.date, tx.date);
    if (distance > ALREADY_BOOKED_WINDOW_DAYS) continue;
    out.push({
      distance,
      option: {
        verificationId: v.id,
        label: verificationLabel(v),
        description: v.description,
        date: bokforingsdatum(v.date),
        sourceType: v.source.type,
      },
    });
  }
  return out
    .sort((a, b) => a.distance - b.distance || b.option.date.localeCompare(a.option.date))
    .slice(0, 5)
    .map((o) => o.option);
}

/* -------------------------------- Förslag -------------------------------- */

export type BankKindSuggestionSource = "regel" | "verifikation" | "monster";

export interface BankKindSuggestion {
  kind: BankKindKey;
  label: string;
  outcome: Extract<AutopilotOutcome, "AUTO_EXECUTE" | "SUGGEST" | "REQUIRES_USER">;
  reason: string;
  source: BankKindSuggestionSource;
  /** För "redan bokförd": verifikationen som föreslås. */
  verificationId?: string;
  verificationLabel?: string;
}

function ruleReason(rule: BankCounterpartRule, def: BankKind, counterpart: string): string {
  if (rule.count > 1) return `${counterpart} har bokförts som ${def.label.toLowerCase()} ${rule.count} gånger`;
  return `${counterpart} bokfördes som ${def.label.toLowerCase()} senast`;
}

/**
 * Vad transaktionen troligen är, utöver faktura-/leverantörsmatchningen som
 * payment-matching.ts redan gjort. null = ingen aning; då får användaren välja.
 */
export function bankKindSuggestion(tx: BankTransaction): BankKindSuggestion | null {
  if (tx.status === "bokford") return null;
  const counterpart = tx.counterpart.trim() || "Okänd motpart";
  const direction = directionOf(tx.amount);
  const candidates = alreadyBookedCandidates(tx);

  const rule = bankCounterpartRuleFor(tx.counterpart);
  const ruleDef = rule ? bankKindByKey(rule.kind) : undefined;
  if (rule && ruleDef && (ruleDef.direction === "bada" || ruleDef.direction === direction)) {
    if (ruleDef.key === "redan_bokford") {
      if (candidates.length === 1) {
        return {
          kind: "redan_bokford",
          label: ruleDef.label,
          outcome: ruleIsAutomatic(rule) ? "AUTO_EXECUTE" : "SUGGEST",
          reason: `${ruleReason(rule, ruleDef, counterpart)} · ${kr(Math.abs(tx.amount))} finns redan i ${candidates[0].label} (${candidates[0].description})`,
          source: "regel",
          verificationId: candidates[0].verificationId,
          verificationLabel: candidates[0].label,
        };
      }
      // Regeln säger "redan bokförd" men inget att koppla till – lönen är
      // inte körd ännu, eller flera verifikationer passar. Människan avgör.
      if (candidates.length === 0) {
        return {
          kind: "redan_bokford",
          label: ruleDef.label,
          outcome: "REQUIRES_USER",
          reason: `${counterpart} brukar vara redan bokförd, men ingen verifikation på ${kr(Math.abs(tx.amount))} väntar på koppling`,
          source: "regel",
        };
      }
    } else if (ruleDef.key === "kortkop" || bankKindPostsHere(ruleDef)) {
      return {
        kind: ruleDef.key,
        label: ruleDef.label,
        outcome: ruleIsAutomatic(rule) ? "AUTO_EXECUTE" : "SUGGEST",
        reason: ruleReason(rule, ruleDef, counterpart),
        source: "regel",
      };
    }
  }

  if (candidates.length === 1) {
    const c = candidates[0];
    return {
      kind: "redan_bokford",
      label: "Redan bokförd",
      outcome: "SUGGEST",
      reason: `${kr(Math.abs(tx.amount))} är redan bokfört i ${c.label} (${c.description}, ${datumKort(c.date)})`,
      source: "verifikation",
      verificationId: c.verificationId,
      verificationLabel: c.label,
    };
  }

  const byPattern = bankKindByPattern(tx);
  if (byPattern) {
    if (byPattern.key === "lon") {
      return {
        kind: "lon",
        label: byPattern.label,
        outcome: "REQUIRES_USER",
        reason:
          candidates.length > 1
            ? `Ser ut som en löneutbetalning – flera verifikationer på ${kr(Math.abs(tx.amount))} passar, välj rätt`
            : "Ser ut som en löneutbetalning. Lönen bokförs av lönekörningen – kör lönen för månaden så matchas utbetalningen hit",
        source: "monster",
      };
    }
    if (bankKindPostsHere(byPattern)) {
      return {
        kind: byPattern.key,
        label: byPattern.label,
        outcome: "SUGGEST",
        reason: `"${tx.description || tx.counterpart}" ser ut som ${byPattern.label.toLowerCase()}`,
        source: "monster",
      };
    }
  }
  return null;
}

/* ------------------------------- Bokföring ------------------------------- */

export interface BookBankTransactionInput {
  kind: BankKindKey;
  /** Krävs för "redan bokförd". */
  verificationId?: string;
  /** Spara som motpartsregel så nästa transaktion från samma motpart föreslås/bokförs likadant. */
  remember?: boolean;
  by?: "anvandare" | "assistent" | "auto";
  /** Förklaringen från förslaget (regel/mönster) – hamnar på verifikationen. */
  matchReason?: string;
}

export interface BookBankTransactionResult {
  /** Verifikationen som skapades eller kopplades; saknas för kortköp (köpet väntar på kvitto). */
  verificationId?: string;
  /** Vad som hände, i klartext för toasten. */
  summary: string;
  rule?: BankCounterpartRule;
}

function requireOpenTransaction(txId: string): BankTransaction {
  const tx = db().bankTransactions.find((t) => t.id === txId);
  if (!tx) throw new Error("Banktransaktionen finns inte.");
  if (tx.status === "bokford") throw new Error("Banktransaktionen är redan bokförd.");
  return tx;
}

/**
 * Ett kortköp utan kvitto som motorn skapade ur transaktionen är bara en
 * platshållare – när användaren säger att transaktionen är något annat tas
 * det bort. Har köpet fått ett kvitto är det däremot underlag och står kvar.
 */
function dropPlaceholderExpense(tx: BankTransaction): void {
  const data = db();
  const expense = data.expenses.find((e) => e.bankTransactionId === tx.id && e.status !== "bokford");
  if (!expense) return;
  if (expense.receiptId) {
    throw new Error(
      `Köpet hos ${expense.supplier} har redan ett kvitto – bokför det via kvittot under Utgifter i stället.`
    );
  }
  data.expenses = data.expenses.filter((e) => e.id !== expense.id);
}

function actorFor(by: BookBankTransactionInput["by"]): "anvandare" | "assistent" | "system" {
  return by === "auto" ? "system" : (by ?? "anvandare");
}

/**
 * Bokför (eller koppla) en obokad banktransaktion som en typ ur katalogen.
 * Kastar begripliga fel; då ändras ingenting. Sparar själv.
 */
export function bookBankTransactionAs(txId: string, input: BookBankTransactionInput): BookBankTransactionResult {
  const data = db();
  const tx = requireOpenTransaction(txId);
  const def = bankKindByKey(input.kind);
  if (!def) throw new Error("Okänd transaktionstyp.");
  const direction = directionOf(tx.amount);
  if (def.direction !== "bada" && def.direction !== direction) {
    throw new Error(
      direction === "in"
        ? `${def.label} gäller utbetalningar – det här är en inbetalning.`
        : `${def.label} gäller inbetalningar – det här är en utbetalning.`
    );
  }
  const by = input.by ?? "anvandare";
  const actor = actorFor(by);
  const amount = Math.abs(tx.amount);
  const counterpart = tx.counterpart.trim() || "Okänd motpart";
  const remember = input.remember !== false && def.learnable;

  let result: BookBankTransactionResult;

  switch (def.key) {
    case "kortkop": {
      const existing = data.expenses.find((e) => e.bankTransactionId === tx.id && e.status !== "bokford");
      const expense = existing ?? createExpenseFromBankPurchase(tx, { force: true });
      if (!expense) throw new Error("Transaktionen kunde inte bli ett köp.");
      tx.status = "behover_atgard";
      result = { summary: `${counterpart} ligger nu som köp som väntar på kvitto.` };
      break;
    }
    case "redan_bokford": {
      if (!input.verificationId) throw new Error("Välj vilken verifikation transaktionen hör till.");
      const candidate = alreadyBookedCandidates(tx).find((c) => c.verificationId === input.verificationId);
      if (!candidate) {
        throw new Error("Verifikationen passar inte transaktionen (annat belopp, annat datum eller redan kopplad).");
      }
      const ver = data.verifications.find((v) => v.id === candidate.verificationId)!;
      dropPlaceholderExpense(tx);
      tx.status = "bokford";
      tx.matchedType = ver.source.type === "skattekonto" ? "skatt" : "ovrigt";
      tx.matchedId = "id" in ver.source ? ver.source.id : undefined;
      tx.verificationId = ver.id;
      logAudit(actor, "banktransaktion_bokford", `${kr(amount)} ${direction === "in" ? "från" : "till"} ${counterpart} kopplades till ${candidate.label} (${candidate.description}).`, {
        targetType: "banktransaktion",
        targetId: tx.id,
      });
      result = {
        verificationId: ver.id,
        summary: `${counterpart} kopplades till ${candidate.label} – ${candidate.description}.`,
      };
      break;
    }
    default: {
      if (!def.entries) {
        throw new Error(
          def.key === "kundbetalning"
            ? "Kundbetalningar matchas mot en faktura – välj fakturan i stället."
            : def.key === "lon"
              ? "Lönen bokförs via lönekörningen under Bokföring › Lön. När den är körd kan utbetalningen kopplas hit."
              : "Den typen bokförs med egen kontering under Bokföring › Verifikationer."
        );
      }
      dropPlaceholderExpense(tx);
      const clamped = clampToOpenDate(tx.date);
      const explanation = [
        input.matchReason ? `${input.matchReason}.` : null,
        def.explanation?.(amount, counterpart),
        clamped.adjusted ? `Bokfört ${clamped.date} eftersom perioden för ${clamped.originalDate} är låst.` : null,
      ]
        .filter(Boolean)
        .join(" ");
      const ver = postVerification({
        date: clamped.date,
        description: `${def.label} – ${counterpart}`,
        entries: def.entries(amount),
        source: { type: "banktransaktion", id: tx.id },
        confidence: "hog",
        createdBy: by,
        explanation,
      });
      tx.status = "bokford";
      tx.matchedType = def.matchedType;
      tx.matchedId = undefined;
      tx.verificationId = ver.id;
      logAudit(actor, "banktransaktion_bokford", `${kr(amount)} ${direction === "in" ? "från" : "till"} ${counterpart} bokfördes som ${def.label.toLowerCase()}.`, {
        targetType: "banktransaktion",
        targetId: tx.id,
      });
      result = { verificationId: ver.id, summary: `${kr(amount)} bokfördes som ${def.label.toLowerCase()}.` };
    }
  }

  if (remember) {
    result.rule = recordBankCounterpartRule(tx.counterpart, def.key);
  }

  const flow = direction === "in" ? "Inbetalningen" : "Utbetalningen";
  const prep = direction === "in" ? "från" : "till";
  if (by === "auto") {
    logActivity(
      `${flow} ${kr(amount)} ${prep} ${counterpart} bokfördes automatiskt som ${def.label.toLowerCase()}${input.matchReason ? ` (${lowerFirst(input.matchReason)})` : ""}.`
    );
  } else {
    const learned = result.rule
      ? ruleIsAutomatic(result.rule)
        ? " – nästa gång sker det automatiskt"
        : " – Driva föreslår samma sak nästa gång"
      : "";
    logActivity(`${flow} ${kr(amount)} ${prep} ${counterpart} bokfördes som ${def.label.toLowerCase()}${learned}.`, {
      createdBy: by,
    });
  }
  save();
  return result;
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}
