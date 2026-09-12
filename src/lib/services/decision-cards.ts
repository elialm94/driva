/**
 * Enkel bokföring = en arbetskö med vardagsbeslut, inte ett mini-bokförings-
 * program. Det här är projektionen av åtgärdsmotorn (getBusinessActions) till
 * beslutskort för /bokforing i enkelt läge.
 *
 * Kortet uttrycker ett vardagsbeslut ("Var köpet på Shell drivmedel till
 * företaget?"), visar vad som hänt, Fervas förslag, varför, eventuell
 * osäkerhet – och lämnar själva knapparna till samma CTA:er som Hem och
 * redovisningsvyn använder. Ingen andra åtgärdsmotor, inga egna id:n.
 *
 * Prioritering: lagstadgad deadline → stora belopp → blockerande underlag →
 * resten. Identiska återkommande banktransaktioner grupperas till ETT kort.
 */
import type { BusinessAction } from "./actions";
import { actionResolveHref } from "./action-issue";
import { isBookkeepingAction } from "./action-views";
import { bankKindByKey } from "../banking/bank-kinds";
import { normalizeMerchant, type MerchantType } from "../banking/merchants";
import { datumKort, kr } from "../format";

/** Så många beslut visas direkt – resten bakom "Visa fler". */
export const SIMPLE_QUEUE_INITIAL = 5;
/** Belopp från och med detta räknas som "stort" i prioriteringen. */
export const SIMPLE_QUEUE_LARGE_AMOUNT = 5_000;

export type DecisionTier = "deadline" | "belopp" | "underlag" | "ovrigt";

export interface DecisionCopy {
  /** Vardagsfrågan/uppmaningen – aldrig kontonummer eller debet/kredit. */
  question: string;
  /** Vad som hänt, i klartext. */
  happened: string;
  /** Fervas förslag, om det finns ett. */
  suggestion?: string;
  /** Varför förslaget ges. */
  why?: string;
  /** Vad Ferva inte vet säkert. */
  uncertainty?: string;
  /** Finns ett rimligt "Privat / gäller inte företaget"-svar? */
  privateChoice?: boolean;
  /** "Så bokförs det" – klarspråk om vad som händer i bokföringen om man godkänner. */
  howBooked?: string;
}

/** Vad "Privat / gäller inte företaget" faktiskt gör – alltid ett explicit val. */
export type PrivateDecision = { kind: "expense"; expenseId: string } | { kind: "bank"; txId: string };

export interface DecisionCard extends DecisionCopy {
  id: string;
  action: BusinessAction;
  tier: DecisionTier;
  /** Identiska återkommande transaktioner bakom samma kort. */
  group?: { count: number; actions: BusinessAction[] };
  /** "Ändra"/drill-down – platsen där man ser allt och kan välja själv. */
  drilldown: { label: string; href: string };
  /** Sätt när kortet har ett "Privat"-svar med känd effekt. */
  privateDecision?: PrivateDecision;
}

const TIER_RANK: Record<DecisionTier, number> = { deadline: 0, belopp: 1, underlag: 2, ovrigt: 3 };

/** Delar av undertiteln som skiljs med " · ". */
function parts(action: Pick<BusinessAction, "subtitle">): string[] {
  return action.subtitle.split(" · ").map((s) => s.trim()).filter(Boolean);
}

function looksLikeAmount(s: string): boolean {
  return /\d\s?kr$/u.test(s) || /^[+−-]?\d[\d\s ]*kr/u.test(s);
}

function looksLikeDate(s: string): boolean {
  return /^\d{1,2}\s\p{L}+\.?(\s\d{4})?$/u.test(s) || /^\d{4}-\d{2}-\d{2}$/u.test(s);
}

/** Förklaringen i undertiteln = det som varken är belopp eller datum. */
function reasonFrom(action: Pick<BusinessAction, "subtitle">): string | undefined {
  const rest = parts(action).filter((p) => !looksLikeAmount(p) && !looksLikeDate(p));
  return rest.length > 0 ? rest.join(" · ") : undefined;
}

function factsFrom(action: Pick<BusinessAction, "subtitle" | "amount">): string {
  const facts = parts(action).filter((p) => looksLikeAmount(p) || looksLikeDate(p));
  if (facts.length > 0) return facts.join(" · ");
  return action.amount != null ? kr(action.amount) : action.subtitle;
}

export function decisionTier(action: Pick<BusinessAction, "id" | "priority" | "dueDate" | "amount" | "cta" | "category">): DecisionTier {
  const id = action.id;
  if (
    action.dueDate ||
    action.priority === "urgent" ||
    action.category === "vat" ||
    id.startsWith("period-close-") ||
    id.startsWith("year-end-") ||
    id.startsWith("agi-")
  ) {
    return "deadline";
  }
  if ((action.amount ?? 0) >= SIMPLE_QUEUE_LARGE_AMOUNT) return "belopp";
  if (
    id.startsWith("receipt-") ||
    id.startsWith("inbox-mail-") ||
    id.startsWith("client-request-") ||
    action.cta?.type === "uploadReceipt"
  ) {
    return "underlag";
  }
  return "ovrigt";
}

/**
 * Vad kunskapsbasen vet om varför ett köp hos motparten inte kan bokföras
 * utan svar – i klartext, utan konton.
 */
const MERCHANT_UNCERTAINTY: Partial<Record<MerchantType, string>> = {
  drivmedel: "kan vara drivmedel, butiksvaror, biltvätt eller privat – kvittot och ditt svar avgör momsen",
  restaurang: "kan vara privat, kundrepresentation, personalmåltid eller mat på tjänsteresa – syftet avgör avdraget",
  dagligvaror: "kan vara privat, förbrukning till företaget eller fika/representation – du avgör",
  hotell: "kan vara en tjänsteresa, en konferens eller privat – syftet avgör",
  kollektivtrafik: "kan vara en tjänsteresa eller privat pendling",
  parkering: "kan vara parkering i jobbet eller privat",
  verktyg: "kan vara till företaget eller privat – kvittot visar vad som köptes",
  kontantuttag: "ett kontantuttag är ingen kostnad i sig – vad pengarna gick till måste styrkas med kvitton",
};

function merchantUncertainty(supplier: string | undefined): string | undefined {
  if (!supplier) return undefined;
  const k = normalizeMerchant(supplier).knowledge;
  // Bara motparter med risk (privat, representation, kontant) är osäkra –
  // bygghandel och grossister bokförs med kvittot utan fråga.
  if (!k || k.risk.length === 0) return undefined;
  const text = MERCHANT_UNCERTAINTY[k.type];
  return text ? `${k.display} ${text}.` : undefined;
}

/** Bedömningens "Därför"/"Osäkert" när motorn skickat med den. */
function assessmentCopy(action: BusinessAction): { why?: string; uncertainty?: string } {
  const a = action.assessment;
  if (!a) return {};
  const why = a.evidence.length > 0 ? a.evidence.join(". ") : undefined;
  const uncertainty =
    a.humanRequired.length > 0
      ? `Kräver ditt beslut: ${a.humanRequired.map(lowerFirst).join("; ")}.`
      : a.tier === "osakert"
        ? "Ferva hittade ingen faktura, regel eller mönster som passar – du väljer typ."
        : undefined;
  return { ...(why ? { why } : {}), ...(uncertainty ? { uncertainty } : {}) };
}

/** Vardagsformuleringen av en åtgärd. Ren text – inga konton, ingen jargong. */
export function decisionCopy(action: BusinessAction): DecisionCopy {
  const cta = action.cta;
  const id = action.id;

  if (cta?.type === "answerQuestion") {
    const supplier = parts(action)[0] ?? "köpet";
    const question = action.title.endsWith("?") ? action.title : `Hur ska köpet hos ${supplier} bokföras?`;
    const kbUncertainty = merchantUncertainty(supplier);
    return {
      question,
      happened: `Köp hos ${supplier} · ${factsFrom(action)}`,
      suggestion: kbUncertainty ? undefined : cta.options[0] ? `${cta.options[0]}` : undefined,
      why: kbUncertainty ? undefined : cta.options[0] ? "Vanligast för den här typen av köp i ditt företag." : undefined,
      uncertainty: kbUncertainty ?? "Ferva vet inte säkert vad köpet gällde – du väljer.",
      privateChoice: true,
      howBooked: "Köpet blir en kostnad i den kategori du väljer och momsen lyfts bara när kvittot visar moms. Väljer du Privat bokförs ingen kostnad – beloppet blir i stället en skuld från dig till bolaget.",
    };
  }

  if (cta?.type === "uploadReceipt" || id.startsWith("receipt-")) {
    const m = action.title.match(/^Kvitto saknas –\s*(.+?),\s*(.+)$/u);
    const supplier = m?.[1] ?? parts(action)[0] ?? "köpet";
    const kbUncertainty = merchantUncertainty(supplier);
    return {
      question: `Lägg till kvittot för ${supplier}`,
      happened: `Köp hos ${supplier} · ${m?.[2] ?? factsFrom(action)}`,
      suggestion: kbUncertainty
        ? "Fota eller ladda upp kvittot – sedan får du en kort fråga om vad köpet gällde."
        : "Fota eller ladda upp kvittot så bokförs köpet automatiskt.",
      why: "Ett köp får dras av först när kvittot finns – momsen kräver underlag.",
      uncertainty: kbUncertainty,
      privateChoice: true,
      howBooked: "Med kvittot bokförs köpet som kostnad och momsen lyfts. Utan kvitto får bolaget inte dra av momsen.",
    };
  }

  if (cta?.type === "bookBankKind") {
    const def = bankKindByKey(cta.bankKind);
    const outgoing = def?.direction === "ut";
    const howBooked = def?.hint ? `${def.label}: ${lowerFirst(def.hint)}.` : undefined;
    const assessed = assessmentCopy(action);
    const m = action.title.match(/^Bokför (.+?) (\d[\d\s ]*kr) som (.+)\?$/u);
    if (m) {
      return {
        question: `Godkänn att ${m[1]} bokförs som ${m[3]}?`,
        happened: `${m[1]} · ${m[2]} · ${parts(action)[0] ?? ""}`.replace(/ · $/u, ""),
        suggestion: `${m[3][0]?.toUpperCase()}${m[3].slice(1)}`,
        why: assessed.why ?? reasonFrom(action),
        uncertainty: assessed.uncertainty,
        privateChoice: outgoing,
        howBooked,
      };
    }
    return {
      question: action.title.endsWith("?") ? action.title : `${action.title}?`,
      happened: factsFrom(action),
      suggestion: cta.label,
      why: assessed.why ?? reasonFrom(action),
      uncertainty: assessed.uncertainty,
      privateChoice: outgoing,
      howBooked,
    };
  }

  // "Utbetalning till X – vad är det?" – inget förslag, men Privat är ett svar.
  if (id.startsWith("bank-") && cta?.type === "link" && /^Utbetalning till /u.test(action.title)) {
    const assessed = assessmentCopy(action);
    return {
      question: action.title,
      happened: factsFrom(action),
      why: assessed.why ?? reasonFrom(action),
      uncertainty: assessed.uncertainty ?? "Ferva hittade ingen faktura, regel eller mönster som passar – du väljer typ.",
      privateChoice: true,
    };
  }

  if (cta?.type === "confirmPaymentMatch") {
    const m = action.title.match(/^Bekräfta betalning:\s*(.+?)\s*→\s*faktura\s*#?(\S+)/u);
    return {
      question: m ? `Är inbetalningen från ${m[1]} betalningen för faktura ${m[2]}?` : action.title,
      happened: `Inbetalning · ${factsFrom(action)}`,
      suggestion: m ? `Bokför som betald faktura ${m[2]}` : cta.label,
      why: reasonFrom(action),
    };
  }

  if (cta?.type === "confirmSupplierPayment") {
    return {
      question: action.title.replace(/^Bekräfta leverantörsbetalning:\s*/u, "Är utbetalningen till ").replace(/\s*→\s*/u, " betalningen till ") + "?",
      happened: `Utbetalning · ${factsFrom(action)}`,
      suggestion: cta.label,
      why: reasonFrom(action),
    };
  }

  if (cta?.type === "confirmRotPayout" || cta?.type === "registerCreditRefund") {
    return {
      question: action.title.endsWith("?") ? action.title : `${action.title.replace(/^Bekräfta /u, "Stämmer ")}?`,
      happened: factsFrom(action),
      suggestion: cta.label,
      why: reasonFrom(action),
    };
  }

  if (cta?.type === "declareVatPeriod") {
    return {
      question: action.title,
      happened: factsFrom(action),
      suggestion: "Markera perioden som deklarerad och betald",
      why: reasonFrom(action),
    };
  }

  if (id.startsWith("vat-")) {
    const period = parts(action)[0];
    const overdue = /skulle ha/u.test(action.title);
    return {
      question: overdue
        ? `Momsen för ${period ?? "perioden"} är försenad – lämna in den nu`
        : `Momsen för ${period ?? "perioden"} är redo att lämnas in`,
      happened: action.dueDate ? `Deklareras senast ${datumKort(action.dueDate)} · ${factsFrom(action)}` : factsFrom(action),
      suggestion: "Öppna momsöversikten, hämta filen och lämna in hos Skatteverket.",
      why: "Lagstadgad deadline – Skatteverket tar ut förseningsavgift.",
    };
  }

  if (id.startsWith("inbox-mail-")) {
    return {
      question: action.title.replace(/^Granska /u, "Titta på "),
      happened: action.subtitle,
      suggestion: "Öppna underlaget och godkänn det Ferva läst ut.",
      why: /Kontrollera belopp/u.test(action.title) ? "Beloppet kunde inte läsas säkert." : undefined,
    };
  }

  if (id.startsWith("period-close-")) {
    return {
      question: action.title,
      happened: action.subtitle,
      suggestion: "Stäng månaden så står den kvar.",
      why: "En stängd månad kan inte ändras av misstag.",
    };
  }

  if (cta?.type === "pickPaymentMatch") {
    return {
      question: action.title.endsWith("?") ? action.title : `Vilken faktura hör inbetalningen ihop med?`,
      happened: `${action.title} · ${factsFrom(action)}`,
      why: reasonFrom(action),
      uncertainty: "Ingen faktura matchar säkert på belopp och referens.",
    };
  }

  return {
    question: action.title,
    happened: action.subtitle,
    why: undefined,
  };
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** Vad Privat-knappen gör för just den här åtgärden – eller inget alls. */
export function privateDecisionFor(action: BusinessAction, copy: Pick<DecisionCopy, "privateChoice">): PrivateDecision | undefined {
  if (!copy.privateChoice) return undefined;
  const cta = action.cta;
  if (cta?.type === "answerQuestion" || cta?.type === "uploadReceipt") return { kind: "expense", expenseId: cta.expenseId };
  if (cta?.type === "bookBankKind") return { kind: "bank", txId: cta.txId };
  if (action.id.startsWith("bank-") && action.id !== "bank-unexplained") return { kind: "bank", txId: action.id.slice("bank-".length) };
  return undefined;
}

/** Nyckel för "identiska återkommande transaktioner": motpart + föreslagen typ + riktning. */
export function recurringKey(action: BusinessAction): string | null {
  if (action.cta?.type !== "bookBankKind") return null;
  const m = action.title.match(/^Bokför (.+?) \d[\d\s ]*kr som (.+)\?$/u);
  if (!m) return null;
  return `${m[1].toLowerCase()}|${action.cta.bankKind}`;
}

function drilldownFor(action: BusinessAction): { label: string; href: string } {
  const href = actionResolveHref(action);
  if (action.id.startsWith("bank-")) return { label: "Ändra i Bank", href };
  if (action.id.startsWith("vat-")) return { label: "Öppna Moms", href: action.href };
  if (action.id.startsWith("inbox-mail-")) return { label: "Öppna underlaget", href: action.href };
  if (action.id.startsWith("receipt-") || action.id.startsWith("question-") || action.id.startsWith("client-request-")) {
    return { label: "Ändra", href };
  }
  return { label: "Ändra", href };
}

/** Beslutskorten för enkel bokföring – prioriterade och grupperade. */
export function decisionCards(actions: readonly BusinessAction[]): DecisionCard[] {
  const queue = actions.filter(isBookkeepingAction);
  const cards: DecisionCard[] = [];
  const grouped = new Map<string, DecisionCard>();

  for (const action of queue) {
    const key = recurringKey(action);
    if (key) {
      const existing = grouped.get(key);
      if (existing) {
        existing.group = existing.group ?? { count: 1, actions: [existing.action] };
        existing.group.count += 1;
        existing.group.actions.push(action);
        continue;
      }
    }
    const copy = decisionCopy(action);
    const card: DecisionCard = {
      id: action.id,
      action,
      tier: decisionTier(action),
      drilldown: drilldownFor(action),
      ...copy,
      privateDecision: privateDecisionFor(action, copy),
    };
    cards.push(card);
    if (key) grouped.set(key, card);
  }

  for (const card of cards) {
    if (card.group && card.group.count > 1) {
      const total = card.group.actions.reduce((s, a) => s + (a.amount ?? 0), 0);
      card.question = `${card.group.count} transaktioner ser likadana ut – ${card.question.replace(/^Godkänn att /u, "godkänn att ").replace(/\?$/u, "")}?`;
      card.happened = `${card.group.count} betalningar · totalt ${kr(total)}`;
      card.uncertainty = "Varje rad visas innan du bekräftar.";
      // Privat är ett beslut per transaktion – aldrig för en hel grupp.
      card.privateChoice = false;
      card.privateDecision = undefined;
    }
  }

  cards.sort((a, b) => {
    const t = TIER_RANK[a.tier] - TIER_RANK[b.tier];
    if (t !== 0) return t;
    if (a.tier === "deadline") {
      const da = a.action.dueDate ?? "9999";
      const dbb = b.action.dueDate ?? "9999";
      if (da !== dbb) return da.localeCompare(dbb);
    }
    return (b.action.amount ?? 0) - (a.action.amount ?? 0);
  });
  return cards;
}

export type SimpleQueueState =
  | { kind: "klart"; title: string; text: string }
  | { kind: "behover"; title: string; text: string }
  | { kind: "arbetar"; title: string; text: string };

/**
 * Överst visas ENDAST ett av: Allt är klart (med nästa kända deadline),
 * N saker behöver dig (viktigaste först) eller Ferva arbetar (dokument läses,
 * bank synkas).
 */
export function simpleQueueState(input: {
  cards: readonly Pick<DecisionCard, "question">[];
  working?: { documents: number; bankSyncing: boolean };
  nextDeadline?: { label: string; date: string };
}): SimpleQueueState {
  const n = input.cards.length;
  if (n > 0) {
    return {
      kind: "behover",
      title: n === 1 ? "1 sak behöver dig" : `${n} saker behöver dig`,
      text: input.cards[0].question,
    };
  }
  const w = input.working;
  if (w && (w.documents > 0 || w.bankSyncing)) {
    const bits: string[] = [];
    if (w.documents > 0) bits.push(w.documents === 1 ? "1 dokument läses" : `${w.documents} dokument läses`);
    if (w.bankSyncing) bits.push("banken hämtas");
    return { kind: "arbetar", title: "Ferva arbetar", text: `${bits.join(" · ")}. Du behöver inte göra något just nu.` };
  }
  return {
    kind: "klart",
    title: "Allt är klart",
    text: input.nextDeadline
      ? `Nästa deadline: ${input.nextDeadline.label} ${datumKort(input.nextDeadline.date)}.`
      : "Ferva säger till när något behöver dig.",
  };
}
