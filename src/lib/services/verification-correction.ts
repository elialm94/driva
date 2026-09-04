import { db, save } from "../store";
import {
  BAS,
  EXPENSE_CATEGORIES,
  categoryByKey,
  entriesExpense,
  entriesSupplierInvoiceReceived,
  isCostAccount,
} from "../bas";
import type { PostLineInput } from "../accounting/engine";
import {
  createCorrection,
  getVerification,
  PostingError,
  verificationLabel,
  type CorrectionResult,
} from "../accounting/engine";
import { clampToOpenDate, isDateLocked, lockedThrough } from "../accounting/fiscal";
import { kr } from "../format";
import type { Expense, Invoice, SupplierInvoice, Verification, VerificationEntry } from "../types";
import { getInvoice, invoiceOutstanding, invoiceTotals } from "./data";
import { recordMerchantRule } from "./expenses";
import { logActivity } from "./activity";

/**
 * Domänmedveten rättelse av bokförda verifikationer.
 *
 * Motorn är alltid `createCorrection` (omvänd verifikation + ev. ny bokning).
 * Originalet muteras aldrig utöver rättelsestämpeln. AI, UI och server actions
 * går samma väg – inga råa debet/kredit-rader utanför den här tjänsten.
 */

export const SOURCE_LABEL: Record<string, string> = {
  kundfaktura: "kundfaktura",
  betalning: "inbetalning",
  utgift: "kvitto/utgift",
  leverantorsfaktura: "leverantörsfaktura",
  banktransaktion: "banktransaktion",
  rattelse: "rättelse",
  avskrivning: "avskrivning",
  periodisering: "periodisering",
  moms: "momsredovisning",
  bokslut: "bokslut",
  ingaende_balans: "ingående balans",
  manuell: "manuell",
};

export const CONFIDENCE_LABEL: Record<Verification["confidence"], string> = {
  hog: "Hög",
  medel: "Medel",
  lag: "Låg",
};

export type CorrectionActor = "anvandare" | "assistent";

export type CorrectionFlowKind =
  | "konto"
  | "kreditfaktura"
  | "omatcha"
  | "moms"
  | "avancerad"
  | "redan_rattad"
  | "rattelse"
  | "krediterad";

export interface KontoOption {
  key: string;
  account: number;
  label: string;
  vatFree?: boolean;
}

export interface CorrectionFlow {
  kind: CorrectionFlowKind;
  title: string;
  hint: string;
  href?: string;
  hrefLabel?: string;
  /** Kundfaktura att kreditera – bara när kind är kreditfaktura. */
  invoiceId?: string;
  currentCategory?: string;
  currentAccount?: number;
  /** Sökbar lista – inte hela BAS-registret. */
  accountOptions?: KontoOption[];
  allowAdvanced: boolean;
  periodLocked: boolean;
  periodLockMessage?: string;
}

export { verificationOverflowItems, type VerificationOverflowItem } from "./verification-overflow";

export interface CorrectionPreviewLine {
  account: number;
  accountName: string;
  debit: number;
  credit: number;
}

export interface CorrectionPreview {
  flow: CorrectionFlow;
  original: Verification;
  originalLabel: string;
  current: CorrectionPreviewLine[];
  next?: CorrectionPreviewLine[];
  nextDescription?: string;
  warning?: string;
}

export type CorrectionIntent =
  | { kind: "konto"; category: string; reason?: string }
  | { kind: "avancerad"; entries: PostLineInput[]; description?: string; reason?: string }
  | { kind: "omatcha"; reason?: string };

export interface PostedCorrection {
  original: Verification;
  reversal: Verification;
  replacement?: Verification;
  originalLabel: string;
  reversalLabel: string;
  replacementLabel?: string;
  idempotent: boolean;
}

const inFlight = new Set<string>();

export function isPaymentLive(paymentId: string, verifications: Verification[] = db().verifications): boolean {
  const ver = verifications.find((v) => v.source.type === "betalning" && "id" in v.source && v.source.id === paymentId);
  if (!ver) return true;
  return !ver.correctedByVerificationId;
}

export function findVerificationQuery(query: string): Verification | undefined {
  const data = db();
  const q = query.trim();
  if (!q) return undefined;
  const upper = q.toUpperCase();
  const byLabel = data.verifications.find(
    (v) => verificationLabel(v).toUpperCase() === upper || String(v.number) === q || v.id === q
  );
  if (byLabel) return byLabel;
  const needle = q.toLowerCase();
  return [...data.verifications].reverse().find((v) => v.description.toLowerCase().includes(needle));
}

export function replacementOf(original: Verification): Verification | undefined {
  if (!original.correctedByVerificationId) return undefined;
  return db().verifications.find((v) => {
    const src = v.source;
    return (
      src.type === "rattelse" &&
      src.id === original.id &&
      v.id !== original.correctedByVerificationId &&
      !v.correctsVerificationId
    );
  });
}

export function correctionChain(v: Verification): { id: string; label: string; role: "original" | "rattelse" | "ny" }[] {
  const data = db();
  const byId = new Map(data.verifications.map((x) => [x.id, x]));
  const src = v.source;
  const original = v.correctsVerificationId
    ? byId.get(v.correctsVerificationId)
    : src.type === "rattelse" && !v.correctsVerificationId
      ? byId.get(src.id)
      : v;
  const root = original ?? v;
  const reversal = root.correctedByVerificationId ? byId.get(root.correctedByVerificationId) : undefined;
  const replacement = replacementOf(root);
  const chain: { id: string; label: string; role: "original" | "rattelse" | "ny" }[] = [
    { id: root.id, label: verificationLabel(root), role: "original" },
  ];
  if (reversal) chain.push({ id: reversal.id, label: verificationLabel(reversal), role: "rattelse" });
  if (replacement) chain.push({ id: replacement.id, label: verificationLabel(replacement), role: "ny" });
  return chain;
}

function periodNote(date: string): { periodLocked: boolean; periodLockMessage?: string } {
  if (!isDateLocked(date)) return { periodLocked: false };
  const lock = lockedThrough();
  const open = clampToOpenDate(date);
  return {
    periodLocked: true,
    periodLockMessage: `Perioden är låst${lock ? ` till och med ${lock}` : ""}. Rättelsen bokförs på första öppna dag (${open.date}) – originalet ändras inte.`,
  };
}

function expenseFor(v: Verification): Expense | undefined {
  const src = v.source;
  if (src.type !== "utgift") return undefined;
  return db().expenses.find((e) => e.id === src.id);
}

function supplierFor(v: Verification): SupplierInvoice | undefined {
  const src = v.source;
  if (src.type !== "leverantorsfaktura") return undefined;
  return db().supplierInvoices.find((s) => s.id === src.id);
}

function invoiceFor(v: Verification): Invoice | undefined {
  const src = v.source;
  if (src.type === "kundfaktura") return getInvoice(src.id);
  if (src.type === "betalning") {
    const payment = db().payments.find((p) => p.id === src.id);
    return payment ? getInvoice(payment.invoiceId) : undefined;
  }
  return undefined;
}

/** Leverantörsbetalning (2440/1930) – inte mottagningen. */
export function isSupplierPaymentVerification(v: Verification): boolean {
  if (v.source.type !== "leverantorsfaktura") return false;
  const sup = supplierFor(v);
  if (sup?.paymentVerificationId === v.id) return true;
  const paysDebt = v.entries.some((e) => e.account === 2440 && e.debit > 0);
  const fromBank = v.entries.some((e) => e.account === 1930 && e.credit > 0);
  const hasCost = v.entries.some((e) => isCostAccount(e.account) && e.debit > 0);
  return paysDebt && fromBank && !hasCost;
}

function currentCostAccount(v: Verification): number | undefined {
  return v.entries.find((e) => isCostAccount(e.account) && e.debit > 0)?.account;
}

function categoryForAccount(account: number): string | undefined {
  return EXPENSE_CATEGORIES.find((c) => c.account === account)?.key;
}

export function expenseAccountOptions(): KontoOption[] {
  const seen = new Set<number>();
  const out: KontoOption[] = [];
  for (const c of EXPENSE_CATEGORIES) {
    if (seen.has(c.account) && c.key !== "ovrigt") continue;
    if (c.key === "ovrigt" && seen.has(c.account)) continue;
    seen.add(c.account);
    out.push({
      key: c.key,
      account: c.account,
      label: `${c.account} ${BAS[c.account] ?? c.label}`,
      vatFree: c.vatFree,
    });
  }
  return out;
}

export function inspectCorrectionFlow(verificationId: string): CorrectionFlow {
  const v = getVerification(verificationId);
  if (!v) throw new Error("Verifikationen finns inte.");
  const period = periodNote(v.date);

  if (v.correctedByVerificationId) {
    const by = getVerification(v.correctedByVerificationId);
    return {
      kind: "redan_rattad",
      title: "Redan rättad",
      hint: by
        ? `${verificationLabel(v)} är redan rättad genom ${verificationLabel(by)}. Originalet ändras aldrig.`
        : `${verificationLabel(v)} är redan rättad.`,
      href: by ? `/bokforing/verifikationer?v=${by.id}` : undefined,
      hrefLabel: by ? `Öppna ${verificationLabel(by)}` : undefined,
      allowAdvanced: false,
      ...period,
    };
  }

  if (v.correctsVerificationId) {
    const original = getVerification(v.correctsVerificationId);
    return {
      kind: "rattelse",
      title: "Det här är en rättelse",
      hint: original
        ? `Rättelse av ${verificationLabel(original)}. Om den nya bokningen blev fel öppnar du den – inte den här återföringen.`
        : "Det här är en rättelseverifikation.",
      href: original ? `/bokforing/verifikationer?v=${original.id}` : undefined,
      hrefLabel: original ? `Öppna ${verificationLabel(original)}` : undefined,
      allowAdvanced: false,
      ...period,
    };
  }

  if (v.source.type === "kundfaktura") {
    const inv = invoiceFor(v);
    if (!inv || inv.type === "kredit" || inv.status === "krediterad") {
      const creditNote = inv?.type === "kredit";
      return {
        kind: "krediterad",
        title: creditNote ? "Kreditfaktura" : "Fakturan är krediterad",
        hint: creditNote
          ? "Det här är en kreditfaktura. Den krediteras inte igen – originalverifikationen och krediten står kvar."
          : "Fakturan är redan krediterad. Belopp rättas inte genom att ändra konteringen. Originalverifikationen står kvar.",
        href: inv ? `/ekonomi/fakturor/${inv.id}` : undefined,
        hrefLabel: inv ? `Öppna faktura #${inv.number}` : undefined,
        allowAdvanced: false,
        ...period,
      };
    }
    return {
      kind: "kreditfaktura",
      title: "Fakturan är fel",
      hint: "Belopp, moms eller kund rättas genom kreditfaktura – inte genom att ändra konteringen. Originalverifikationen står kvar.",
      href: `/ekonomi/fakturor/${inv.id}`,
      hrefLabel: `Öppna faktura #${inv.number}`,
      invoiceId: inv.id,
      allowAdvanced: false,
      ...period,
    };
  }

  if (v.source.type === "betalning" || isSupplierPaymentVerification(v)) {
    const inv = invoiceFor(v);
    const tx = db().bankTransactions.find((t) => t.verificationId === v.id);
    const href = tx
      ? `/ekonomi?flik=bank&atgard=${encodeURIComponent(`bank-${tx.id}`)}`
      : inv
        ? `/ekonomi/fakturor/${inv.id}`
        : "/ekonomi?flik=bank";
    return {
      kind: "omatcha",
      title: "Matchningen är fel",
      hint: "En inbetalning rättas genom att koppla om den – inte genom att skriva debet och kredit. Driva återför bokningen och öppnar matchningen igen.",
      href,
      hrefLabel: "Öppna matchningen",
      allowAdvanced: false,
      ...period,
    };
  }

  if (v.source.type === "moms") {
    return {
      kind: "moms",
      title: "Momsredovisning",
      hint: "Momsrättelser går via momsrapporten så huvudbok, verifikation och momsdeklaration hålls ihop.",
      href: "/bokforing/moms",
      hrefLabel: "Öppna momsöversikten",
      allowAdvanced: false,
      ...period,
    };
  }

  const src = underlyingSource(v);
  const supplierReceive =
    src.source.type === "leverantorsfaktura" && !isSupplierPaymentVerification(src) && !isSupplierPaymentVerification(v);
  if (src.source.type === "utgift" || supplierReceive) {
    const account = currentCostAccount(v);
    const expense = expenseFor(src);
    const sup = supplierFor(src);
    const category = expense?.category ?? sup?.category ?? (account ? categoryForAccount(account) : undefined);
    return {
      kind: "konto",
      title: "Vad ska ändras?",
      hint: supplierReceive
        ? "Byt kostnadskonto. Leverantörsskulden (2440) och momsen sköter Driva."
        : "Byt kostnadskonto. Motkonto och moms sköter Driva.",
      currentCategory: category,
      currentAccount: account,
      accountOptions: expenseAccountOptions(),
      allowAdvanced: true,
      ...period,
    };
  }

  return {
    kind: "avancerad",
    title: "Avancerad rättelse",
    hint: "Den här verifikationen har ingen enkel kategori att byta. Full kontering finns bakom avancerad rättelse.",
    allowAdvanced: true,
    ...period,
  };
}

function toPreview(entries: VerificationEntry[] | PostLineInput[]): CorrectionPreviewLine[] {
  return entries
    .map((e) => ({
      account: e.account,
      accountName: "accountName" in e && e.accountName ? e.accountName : (BAS[e.account] ?? `Konto ${e.account}`),
      debit: e.debit ?? 0,
      credit: e.credit ?? 0,
    }))
    .filter((e) => e.debit > 0 || e.credit > 0);
}

function underlyingSource(v: Verification): Verification {
  const src = v.source;
  if (src.type === "rattelse") {
    const original = getVerification(src.id);
    if (original) return original;
  }
  return v;
}

function replacementForKonto(v: Verification, category: string): { entries: PostLineInput[]; description: string; warning?: string } {
  const cat = categoryByKey(category);
  const src = underlyingSource(v);
  if (src.source.type === "utgift") {
    const expense = expenseFor(src);
    if (!expense) throw new Error("Utgiften som hör till verifikationen finns inte.");
    const vat = cat.vatFree ? 0 : expense.vatAmount;
    const hadVat = src.entries.some((e) => e.account === 2641 && e.debit > 0);
    const warning =
      cat.vatFree && (expense.vatAmount > 0 || hadVat)
        ? `Kategorin ${cat.label} saknar avdragsgill moms – ${kr(hadVat ? src.entries.find((e) => e.account === 2641)!.debit : expense.vatAmount)} bokas som kostnad i stället för ingående moms.`
        : !cat.vatFree && vat > 0 && !hadVat
          ? `Moms ${kr(vat)} lyfts som ingående moms på 2641 – originalet var momsfritt.`
          : !cat.vatFree && expense.vatAmount === 0
            ? `Köpet saknar momsbelopp. Hela ${kr(expense.amount)} bokas som kostnad på ${cat.account}.`
            : undefined;
    return {
      entries: entriesExpense(category, expense.amount, vat),
      description: `${expense.supplier} – ${expense.description ?? cat.label.toLowerCase()}`,
      warning,
    };
  }
  if (src.source.type === "leverantorsfaktura") {
    const sup = supplierFor(src);
    if (!sup) throw new Error("Leverantörsfakturan som hör till verifikationen finns inte.");
    const vat = cat.vatFree ? 0 : sup.vatAmount;
    const warning =
      cat.vatFree && sup.vatAmount > 0
        ? `Kategorin ${cat.label} saknar avdragsgill moms – ${kr(sup.vatAmount)} bokas som kostnad. Skulden på 2440 är oförändrad.`
        : undefined;
    return {
      entries: entriesSupplierInvoiceReceived(category, sup.amount, vat),
      description: `Leverantörsfaktura ${sup.supplier} ${sup.invoiceNumber}`,
      warning,
    };
  }
  throw new Error("Den här verifikationen kan inte rättas genom att byta kostnadskonto.");
}

export function previewCorrection(verificationId: string, intent?: CorrectionIntent): CorrectionPreview {
  const original = getVerification(verificationId);
  if (!original) throw new Error("Verifikationen finns inte.");
  const flow = inspectCorrectionFlow(verificationId);
  const preview: CorrectionPreview = {
    flow,
    original,
    originalLabel: verificationLabel(original),
    current: toPreview(original.entries),
  };
  if (!intent) return preview;
  if (intent.kind === "konto") {
    if (flow.kind !== "konto") throw new Error(flow.hint);
    const next = replacementForKonto(original, intent.category);
    preview.next = toPreview(next.entries);
    preview.nextDescription = next.description;
    preview.warning = next.warning;
  } else if (intent.kind === "avancerad") {
    if (!flow.allowAdvanced) throw new Error(flow.hint);
    preview.next = toPreview(intent.entries);
    preview.nextDescription = intent.description ?? `Omföring efter rättelse av ${verificationLabel(original)}`;
  }
  return preview;
}

function sameEntries(a: VerificationEntry[], b: PostLineInput[]): boolean {
  const compact = (rows: { account: number; debit?: number; credit?: number }[]) =>
    JSON.stringify(
      rows
        .map((e) => ({ a: e.account, d: e.debit ?? 0, c: e.credit ?? 0 }))
        .filter((e) => e.d || e.c)
        .sort((x, y) => x.a - y.a || x.d - y.d)
    );
  return compact(a) === compact(b);
}

function existingPosted(original: Verification): PostedCorrection | undefined {
  if (!original.correctedByVerificationId) return undefined;
  const reversal = getVerification(original.correctedByVerificationId);
  if (!reversal) return undefined;
  const replacement = replacementOf(original);
  return {
    original,
    reversal,
    replacement,
    originalLabel: verificationLabel(original),
    reversalLabel: verificationLabel(reversal),
    replacementLabel: replacement ? verificationLabel(replacement) : undefined,
    idempotent: true,
  };
}

function applySourceAfterKonto(original: Verification, replacement: Verification | undefined, category: string): void {
  const src = underlyingSource(original);
  if (src.source.type === "utgift") {
    const expense = expenseFor(src);
    if (!expense) return;
    expense.category = category;
    expense.status = "bokford";
    expense.question = undefined;
    if (replacement) expense.verificationId = replacement.id;
    if (expense.bankTransactionId) {
      const tx = db().bankTransactions.find((t) => t.id === expense.bankTransactionId);
      if (tx && replacement) tx.verificationId = replacement.id;
    }
    recordMerchantRule(expense.supplier, category);
  } else if (src.source.type === "leverantorsfaktura") {
    const sup = supplierFor(src);
    if (!sup) return;
    sup.category = category;
    if (replacement) sup.verificationId = replacement.id;
  }
}

function unmatchPayment(original: Verification, by: CorrectionActor, reason: string): PostedCorrection {
  const existing = existingPosted(original);
  if (existing) return existing;

  const { reversal } = createCorrection({
    verificationId: original.id,
    reason,
    by,
  });

  if (original.source.type === "betalning") {
    const src = original.source;
    const payment = db().payments.find((p) => p.id === src.id);
    const invoice = payment ? getInvoice(payment.invoiceId) : undefined;
    if (payment && invoice) {
      const livePaid = db().payments.filter((p) => p.invoiceId === invoice.id && isPaymentLive(p.id)).reduce((s, p) => s + p.amount, 0);
      const toPay = invoiceTotals(invoice).toPay;
      if (livePaid <= 0) {
        invoice.status = "skickad";
        invoice.paidAt = undefined;
      } else if (livePaid < toPay) {
        invoice.status = "delbetald";
        invoice.paidAt = undefined;
      }
      const excessLine = original.entries.find((e) => e.account === 2420 && e.credit > 0);
      if (excessLine && invoice.overpaymentCredit) {
        invoice.overpaymentCredit = Math.max(0, invoice.overpaymentCredit - excessLine.credit);
        if (invoice.overpaymentCredit === 0) invoice.overpaymentCredit = undefined;
      }
      const tx = payment.bankTransactionId
        ? db().bankTransactions.find((t) => t.id === payment.bankTransactionId)
        : db().bankTransactions.find((t) => t.verificationId === original.id);
      if (tx) {
        tx.status = "behover_atgard";
        tx.matchedType = undefined;
        tx.matchedId = undefined;
        tx.verificationId = undefined;
      }
      logActivity(`Matchningen av ${kr(payment.amount)} mot faktura #${invoice.number} ångrades – ${verificationLabel(reversal)} återför bokningen.`, {
        entity: { type: "faktura", id: invoice.id },
      });
    }
  } else if (original.source.type === "leverantorsfaktura") {
    const sup = supplierFor(original);
    if (sup) {
      sup.status = "obetald";
      const tx = sup.bankTransactionId ? db().bankTransactions.find((t) => t.id === sup.bankTransactionId) : undefined;
      if (tx) {
        tx.status = "behover_atgard";
        tx.matchedType = undefined;
        tx.matchedId = undefined;
        tx.verificationId = undefined;
      }
      sup.bankTransactionId = undefined;
      sup.paymentVerificationId = undefined;
      logActivity(`Betalningen av ${sup.supplier} ${sup.invoiceNumber} ångrades – ${verificationLabel(reversal)} återför bokningen.`, {});
    }
  }

  save();
  return {
    original,
    reversal,
    originalLabel: verificationLabel(original),
    reversalLabel: verificationLabel(reversal),
    idempotent: false,
  };
}

/**
 * Bokför en rättelse. Idempotent: samma avsikt mot en redan rättad
 * verifikation återger den befintliga rättelsen – aldrig en andra.
 */
export function postVerificationCorrection(
  verificationId: string,
  intent: CorrectionIntent,
  by: CorrectionActor = "anvandare"
): PostedCorrection {
  const original = getVerification(verificationId);
  if (!original) throw new Error("Verifikationen finns inte.");

  const flow = inspectCorrectionFlow(verificationId);
  if (flow.kind === "kreditfaktura") {
    throw new Error("Kundfakturan rättas med en kreditfaktura – inte genom att ändra konteringen.");
  }
  if (flow.kind === "krediterad") {
    throw new Error(flow.hint);
  }
  if (flow.kind === "moms") {
    throw new Error("Momsrättelser går via momsrapporten, inte via verifikationens kontering.");
  }
  if (flow.kind === "rattelse") {
    throw new Error(flow.hint);
  }

  if (intent.kind === "omatcha") {
    if (flow.kind !== "omatcha" && flow.kind !== "redan_rattad") {
      throw new Error("Den här verifikationen är inte en betalningsmatchning.");
    }
    if (inFlight.has(verificationId)) {
      const again = getVerification(verificationId);
      const posted = again ? existingPosted(again) : undefined;
      if (posted) return posted;
    }
    inFlight.add(verificationId);
    try {
      return unmatchPayment(original, by, intent.reason?.trim() || "Felaktig betalningsmatchning");
    } finally {
      inFlight.delete(verificationId);
    }
  }

  if (flow.kind === "redan_rattad") {
    const posted = existingPosted(original);
    if (!posted) throw new PostingError("redan_rattad", `${verificationLabel(original)} är redan rättad.`);
    if (intent.kind === "konto") {
      const wanted = replacementForKonto(original, intent.category);
      if (posted.replacement && sameEntries(posted.replacement.entries, wanted.entries)) return posted;
    }
    if (intent.kind === "avancerad" && posted.replacement && sameEntries(posted.replacement.entries, intent.entries)) {
      return posted;
    }
    throw new PostingError("redan_rattad", `${verificationLabel(original)} är redan rättad.`);
  }

  if (intent.kind === "konto" && flow.kind !== "konto") {
    throw new Error(flow.hint);
  }
  if (intent.kind === "avancerad" && !flow.allowAdvanced) {
    throw new Error(flow.hint);
  }

  if (inFlight.has(verificationId)) {
    const again = getVerification(verificationId);
    const posted = again ? existingPosted(again) : undefined;
    if (posted) return posted;
  }
  inFlight.add(verificationId);
  try {
    const again = getVerification(verificationId)!;
    const already = existingPosted(again);
    if (already) {
      if (intent.kind === "konto") {
        const wanted = replacementForKonto(again, intent.category);
        if (already.replacement && sameEntries(already.replacement.entries, wanted.entries)) return already;
      }
      throw new PostingError("redan_rattad", `${verificationLabel(again)} är redan rättad.`);
    }

    if (intent.kind === "konto") {
      const next = replacementForKonto(again, intent.category);
      const reason = intent.reason?.trim() || "Fel kostnadskonto";
      const result = createCorrection({
        verificationId: again.id,
        reason,
        replacementEntries: next.entries,
        replacementDescription: next.description,
        by,
      });
      applySourceAfterKonto(again, result.replacement, intent.category);
      save();
      return toPosted(again, result, false);
    }

    const reason = intent.reason?.trim() || "Avancerad rättelse";
    const result = createCorrection({
      verificationId: again.id,
      reason,
      replacementEntries: intent.entries,
      replacementDescription: intent.description,
      by,
    });
    save();
    return toPosted(again, result, false);
  } finally {
    inFlight.delete(verificationId);
  }
}

function toPosted(original: Verification, result: CorrectionResult, idempotent: boolean): PostedCorrection {
  return {
    original,
    reversal: result.reversal,
    replacement: result.replacement,
    originalLabel: verificationLabel(original),
    reversalLabel: verificationLabel(result.reversal),
    replacementLabel: result.replacement ? verificationLabel(result.replacement) : undefined,
    idempotent,
  };
}

export function creatorPhrase(v: Verification): string {
  if (v.createdBy === "auto") return "Bokförd automatiskt av Driva";
  if (v.createdBy === "assistent") return "Bokförd av assistenten";
  return "Bokförd av dig";
}

export function listBadge(v: Verification): { text: string; tone: "accent" | "warn" | "neutral" } {
  if (v.correctedByVerificationId) {
    return { text: v.createdBy === "auto" ? "Auto · Rättad" : "Rättad", tone: "warn" };
  }
  if (v.source.type === "rattelse" || v.correctsVerificationId) {
    return { text: "Rättelse", tone: "warn" };
  }
  if (v.createdBy === "auto") {
    return { text: `Auto · ${CONFIDENCE_LABEL[v.confidence]} säkerhet`, tone: "accent" };
  }
  if (v.createdBy === "assistent") return { text: "Assistent", tone: "neutral" };
  return { text: "Manuell", tone: "neutral" };
}

/** Utestående efter ev. omatchning – används av tester och UI. */
export function invoiceOutstandingAfterCorrections(invoiceId: string): number {
  const inv = getInvoice(invoiceId);
  return inv ? invoiceOutstanding(inv) : 0;
}

export interface VerificationView {
  id: string;
  label: string;
  date: string;
  postedAt: string;
  description: string;
  explanation?: string;
  createdBy: Verification["createdBy"];
  confidence: Verification["confidence"];
  confidenceLabel: string;
  sourceType: string;
  sourceLabel: string;
  total: number;
  entries: CorrectionPreviewLine[];
  correctsId?: string;
  correctsLabel?: string;
  correctedById?: string;
  correctedByLabel?: string;
  replacementId?: string;
  replacementLabel?: string;
  badge: { text: string; tone: "accent" | "warn" | "neutral" };
  creatorPhrase: string;
  flow: CorrectionFlow;
  chain: { id: string; label: string; role: "original" | "rattelse" | "ny" }[];
}

export function toVerificationView(v: Verification, byId: Map<string, Verification>): VerificationView {
  const corrects = v.correctsVerificationId ? byId.get(v.correctsVerificationId) : undefined;
  const correctedBy = v.correctedByVerificationId ? byId.get(v.correctedByVerificationId) : undefined;
  const replacement = replacementOf(v);
  return {
    id: v.id,
    label: verificationLabel(v),
    date: v.date,
    postedAt: v.postedAt ?? v.createdAt,
    description: v.description,
    explanation: v.explanation,
    createdBy: v.createdBy,
    confidence: v.confidence,
    confidenceLabel: CONFIDENCE_LABEL[v.confidence],
    sourceType: v.source.type,
    sourceLabel: SOURCE_LABEL[v.source.type] ?? v.source.type,
    total: v.entries.reduce((s, e) => s + e.debit, 0),
    entries: toPreview(v.entries),
    correctsId: corrects?.id,
    correctsLabel: corrects ? verificationLabel(corrects) : undefined,
    correctedById: correctedBy?.id,
    correctedByLabel: correctedBy ? verificationLabel(correctedBy) : undefined,
    replacementId: replacement?.id,
    replacementLabel: replacement ? verificationLabel(replacement) : undefined,
    badge: listBadge(v),
    creatorPhrase: creatorPhrase(v),
    flow: inspectCorrectionFlow(v.id),
    chain: correctionChain(v),
  };
}

export function listVerificationViews(): VerificationView[] {
  const all = [...db().verifications].sort((a, b) => b.number - a.number);
  const byId = new Map(all.map((v) => [v.id, v]));
  return all.map((v) => toVerificationView(v, byId));
}
