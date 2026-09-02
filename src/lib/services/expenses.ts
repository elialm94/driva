import { db, save } from "../store";
import { uid } from "../ids";
import type { BankTransaction, Expense, MerchantCategoryRule, Receipt, Verification } from "../types";
import { categoryByKey, entriesExpense, guessCategory, EXPENSE_CATEGORIES, KNOWN_SUPPLIERS } from "../bas";
import { kr } from "../format";
import { logActivity } from "./activity";
import { logAudit } from "../accounting/audit";
import { postVerification, createCorrection } from "../accounting/engine";
import { clampToOpenDate } from "../accounting/fiscal";
import { assetSuggestionForExpense, registerAssetFromExpense, INVENTARIE_GRANS } from "../accounting/assets";
import { assertDemoMode } from "../demo";
import { resolveClientRequestsForExpense } from "../collaboration/requests";
import { currentActor } from "../collaboration/actor";

/**
 * Kvittotolkning ("AI-extraktion") är mockad i demon: när ett kvitto laddas upp
 * mot en känd banktransaktion läses leverantör/belopp/moms därifrån, precis som
 * en riktig OCR/LLM-tjänst hade returnerat. Gränssnittet är byggt så att en
 * riktig extraktionstjänst kan kopplas in i `extractReceipt`.
 *
 * AI:n klassificerar VAD köpet var – den deterministiska motorn avgör konton,
 * moms och kontering. Inga debet/kredit-rader utan central validering.
 */

export const ASSET_QUESTION_OPTIONS = ["Registrera som inventarie", "Bokför som vanlig kostnad"] as const;

/* --------------------------- Leverantörskategorier --------------------------- */
/* Deterministiska regler: användarens egna val väger tyngst och byggs på       */
/* varje gång ett köp bokförs av en människa. Ingen ML – en enkel regelbutik.   */

export function merchantRuleKey(supplier: string): string {
  return supplier
    .toLowerCase()
    .replace(/\b(ab|hb|kb|aktiebolag)\b/g, "")
    .replace(/[^a-zåäö0-9]+/g, " ")
    .trim();
}

export interface MerchantCategoryGuess {
  key: string;
  confidence: "hog" | "medel" | "lag";
  /** Förklaring, t.ex. "Bauhaus har bokförts som Material 14 gånger". */
  reason: string;
}

/**
 * Kategorisera en leverantör: (1) användarens egna regler – 2+ bokningar ger
 * hög konfidens (autobokning), 1 ger förslag; (2) kända leverantörer;
 * (3) heuristik. Deterministiskt och förklarbart.
 */
export function categorizeMerchant(supplier: string): MerchantCategoryGuess | null {
  const rules = db().meta.merchantCategoryRules ?? {};
  const rule = rules[merchantRuleKey(supplier)];
  if (rule) {
    const label = categoryByKey(rule.category).label;
    return {
      key: rule.category,
      confidence: rule.count >= 2 ? "hog" : "medel",
      reason:
        rule.count > 1
          ? `${supplier} har bokförts som ${label} ${rule.count} gånger`
          : `${supplier} bokfördes som ${label} senast`,
    };
  }
  const known = guessCategory(supplier);
  if (known) {
    return {
      key: known.key,
      confidence: known.confidence,
      reason:
        known.confidence === "hog"
          ? `Driva känner igen ${supplier} och bokför köp där som ${categoryByKey(known.key).label.toLowerCase()}`
          : `Namnet antyder ${categoryByKey(known.key).label.toLowerCase()}`,
    };
  }
  return null;
}

/** Mänskligt val av kategori → uppdatera regeln så nästa köp föreslås/bokas rätt. */
export function recordMerchantRule(supplier: string, categoryKey: string): void {
  const key = merchantRuleKey(supplier);
  if (!key) return;
  const data = db();
  const rules: Record<string, MerchantCategoryRule> = data.meta.merchantCategoryRules ?? {};
  const existing = rules[key];
  rules[key] =
    existing && existing.category === categoryKey
      ? { category: categoryKey, count: existing.count + 1, lastUsedAt: new Date().toISOString() }
      : // Nytt val ersätter gammal regel – räknaren börjar om (kräver en
        // bekräftelse till innan autobokning).
        { category: categoryKey, count: 1, lastUsedAt: new Date().toISOString() };
  data.meta.merchantCategoryRules = rules;
}

/** Klarspråksförklaring till varför köpet konterades som det gjorde. */
function expenseExplanation(
  expense: Expense,
  categoryKey: string,
  createdBy: Verification["createdBy"],
  matchReason?: string
): string {
  const cat = categoryByKey(categoryKey);
  const known = Object.keys(KNOWN_SUPPLIERS).find((name) => expense.supplier.toLowerCase().includes(name));
  const why =
    createdBy === "auto"
      ? (matchReason ?? (known ? `Driva känner igen ${expense.supplier} och bokför köp där som ${cat.label.toLowerCase()}` : `Köpet bokfördes som ${cat.label.toLowerCase()}`))
      : createdBy === "assistent"
        ? `Assistenten valde kategorin ${cat.label.toLowerCase()} och du godkände`
        : `Du svarade att köpet gällde ${cat.label.toLowerCase()}`;
  const vatText = cat.vatFree
    ? "Kategorin saknar avdragsgill moms, så hela beloppet bokförs som kostnad."
    : `Momsen (${kr(expense.vatAmount)}) lyfts som ingående moms.`;
  return `${why}. Kostnaden hamnar på konto ${cat.account} (${cat.label}) och betalningen dras från företagskontot. ${vatText}`;
}

function bookExpense(
  expense: Expense,
  categoryKey: string,
  confidence: Verification["confidence"],
  createdBy: Verification["createdBy"],
  matchReason?: string
): Verification {
  const data = db();
  if (expense.status === "bokford") {
    // Idempotens: en utgift kan aldrig bokföras två gånger (dubbelklick/retry).
    throw new Error(`Köpet hos ${expense.supplier} är redan bokfört.`);
  }
  const cat = categoryByKey(categoryKey);
  const vat = cat.vatFree ? 0 : expense.vatAmount;
  const clamped = clampToOpenDate(expense.date);
  const ver = postVerification({
    date: clamped.date,
    description: `${expense.supplier} – ${expense.description ?? cat.label.toLowerCase()}${clamped.adjusted ? ` (avser ${clamped.originalDate})` : ""}`,
    entries: entriesExpense(categoryKey, expense.amount, vat),
    source: { type: "utgift", id: expense.id },
    confidence,
    createdBy,
    explanation:
      expenseExplanation(expense, categoryKey, createdBy, matchReason) +
      (clamped.adjusted ? ` Bokfört ${clamped.date} eftersom perioden för ${clamped.originalDate} är låst.` : ""),
  });
  expense.category = categoryKey;
  expense.status = "bokford";
  expense.verificationId = ver.id;
  expense.question = undefined;
  if (expense.bankTransactionId) {
    const tx = data.bankTransactions.find((t) => t.id === expense.bankTransactionId);
    if (tx) {
      tx.status = "bokford";
      tx.matchedType = "utgift";
      tx.matchedId = expense.id;
      tx.verificationId = ver.id;
    }
  }
  // Mänskliga val bygger regelbutiken – autobokningar gör det inte
  // (annars skulle en felgissning förstärka sig själv).
  if (createdBy !== "auto") recordMerchantRule(expense.supplier, categoryKey);
  logAudit(createdBy === "auto" ? "system" : createdBy, "utgift_bokford", `Köp hos ${expense.supplier} (${kr(expense.amount)}) bokfördes som ${cat.label}.`, {
    targetType: "utgift",
    targetId: expense.id,
  });
  return ver;
}

/** Ställ inventariefrågan i stället för att bokföra direkt – användaren avgör. */
function askAssetQuestion(expense: Expense): void {
  expense.status = "behover_svar";
  expense.question = {
    text: `Köpet på ${kr(expense.amount)} hos ${expense.supplier} ser ut som något som används i flera år (över ${kr(INVENTARIE_GRANS)}). Hur vill du bokföra det?`,
    options: [...ASSET_QUESTION_OPTIONS],
  };
}

/**
 * Ladda upp kvitto för ett köp som saknar kvitto.
 *
 * `file` är var själva filen ligger (lib/receipts/receipt-file.ts). Utan den
 * registreras bara uppgifterna – kvittoraden får då varken storagePath eller
 * contentBase64 och UI:t visar det ärligt i stället för ett "Visa kvitto".
 */
export function uploadReceiptForExpense(
  expenseId: string,
  filename: string,
  source: Receipt["source"],
  file?: Pick<Receipt, "contentType" | "sizeBytes" | "storagePath" | "contentBase64">
): { receipt: Receipt; autoBooked: boolean } {
  const data = db();
  const expense = data.expenses.find((e) => e.id === expenseId);
  if (!expense) throw new Error("Utgiften finns inte");
  if (expense.receiptId) {
    // Idempotens: ett köp har ETT kvitto – dubbel uppladdning kopplar aldrig två.
    throw new Error(`Köpet hos ${expense.supplier} har redan ett kvitto kopplat.`);
  }

  // "AI-extraktion" – i demon speglar den banktransaktionens fakta.
  const guess = categorizeMerchant(expense.supplier);
  const receipt: Receipt = {
    id: uid(),
    expenseId,
    filename: filename || `kvitto-${expense.supplier.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.jpg`,
    source,
    uploadedAt: new Date().toISOString(),
    ...(file?.contentType ? { contentType: file.contentType } : {}),
    ...(file?.sizeBytes != null ? { sizeBytes: file.sizeBytes } : {}),
    ...(file?.storagePath ? { storagePath: file.storagePath } : {}),
    ...(file?.contentBase64 ? { contentBase64: file.contentBase64 } : {}),
    extracted: {
      supplier: expense.supplier,
      date: expense.date,
      amount: expense.amount,
      vatAmount: expense.vatAmount,
      description: guess ? categoryByKey(guess.key).label : "Inköp",
      category: guess?.key ?? "",
      confidence: guess?.confidence ?? "lag",
    },
  };
  data.receipts.push(receipt);
  expense.receiptId = receipt.id;
  resolveClientRequestsForExpense(expenseId, currentActor()?.userId);

  let autoBooked = false;
  if (assetSuggestionForExpense({ ...expense, category: guess?.key ?? expense.category })) {
    // Stort köp som ser ut att användas i flera år → användaren avgör (inte AI:n).
    if (!expense.description) expense.description = receipt.extracted.description;
    askAssetQuestion(expense);
    logActivity(
      `Kvittot från ${expense.supplier} (${kr(expense.amount)}) ser ut som en inventarie – Driva frågar hur det ska bokföras.`,
      { entity: { type: "utgift", id: expenseId } }
    );
  } else if (guess && guess.confidence === "hog") {
    // Hög säkerhet (egen regel eller känd leverantör) → bokför automatiskt.
    if (!expense.description) expense.description = receipt.extracted.description;
    bookExpense(expense, guess.key, "hog", "auto", guess.reason);
    logActivity(
      `Kvitto från ${expense.supplier} (${kr(expense.amount)}) matchades mot bankköpet och bokfördes som ${categoryByKey(guess.key).label.toLowerCase()} (${guess.reason}).`,
      { entity: { type: "utgift", id: expenseId } }
    );
    autoBooked = true;
  } else {
    // Låg/medel säkerhet → ställ en enkel fråga, med ev. förslag först.
    expense.status = "behover_svar";
    const suggested = guess ? categoryByKey(guess.key).label : null;
    const baseOptions = ["Material", "Verktyg & förbrukning", "Kundrepresentation", "Annat"];
    expense.question = {
      text: `Vad gällde köpet på ${kr(expense.amount)} hos ${expense.supplier}?${suggested ? ` Driva gissar ${suggested.toLowerCase()} (${guess!.reason}).` : ""}`,
      options: suggested ? [suggested, ...baseOptions.filter((o) => o !== suggested)] : baseOptions,
    };
    logActivity(`Kvitto från ${expense.supplier} mottaget – produkten behöver veta vad köpet gällde.`, {
      entity: { type: "utgift", id: expenseId },
    });
  }
  save();
  return { receipt, autoBooked };
}

/** Svar på en bokföringsfråga – systemet sköter resten. */
export function answerExpenseQuestion(expenseId: string, answer: string, by: "anvandare" | "assistent" = "anvandare"): void {
  const data = db();
  const expense = data.expenses.find((e) => e.id === expenseId);
  if (!expense) return;

  // Inventariefrågan: användaren avgör om köpet är en tillgång eller kostnad.
  if (answer === "Registrera som inventarie") {
    const asset = registerAssetFromExpense(expenseId, { by: by === "assistent" ? "assistent" : "anvandare" });
    logActivity(
      `${asset.name} registrerades som inventarie (${kr(asset.acquisitionValue)}) och skrivs av över ${asset.usefulLifeYears} år.`,
      { entity: { type: "utgift", id: expenseId } }
    );
    save();
    return;
  }
  if (answer === "Bokför som vanlig kostnad") {
    const key = guessCategory(expense.supplier)?.key ?? expense.category ?? "verktyg";
    if (!expense.description) expense.description = categoryByKey(key).label;
    bookExpense(expense, key, "hog", by === "assistent" ? "assistent" : "anvandare");
    logActivity(
      `Köpet hos ${expense.supplier} (${kr(expense.amount)}) bokfördes som ${categoryByKey(key).label.toLowerCase()} efter ditt val.`,
      { entity: { type: "utgift", id: expenseId } }
    );
    save();
    return;
  }

  const key =
    EXPENSE_CATEGORIES.find((c) => c.label.toLowerCase() === answer.toLowerCase())?.key ??
    (answer.toLowerCase() === "hotell" ? "hotell" : answer.toLowerCase() === "annat" ? "ovrigt" : "ovrigt");

  if (!expense.description) expense.description = categoryByKey(key).label;
  bookExpense(expense, key, "hog", by === "assistent" ? "assistent" : "anvandare");
  logActivity(
    `Köpet hos ${expense.supplier} (${kr(expense.amount)}) bokfördes som ${categoryByKey(key).label.toLowerCase()}.`,
    { entity: { type: "utgift", id: expenseId } }
  );
  save();
}

/** Koppla en utgift till ett uppdrag och bokför den (t.ex. via assistenten). */
export function bookExpenseToJob(expenseId: string, categoryKey: string, jobId?: string, by: "anvandare" | "assistent" = "anvandare"): void {
  const data = db();
  const expense = data.expenses.find((e) => e.id === expenseId);
  if (!expense) return;
  if (jobId) {
    const job = data.jobs.find((j) => j.id === jobId);
    if (job) {
      expense.jobId = jobId;
      expense.description = `${categoryByKey(categoryKey).label} till ${job.title}`;
    }
  }
  if (expense.status !== "bokford") {
    bookExpense(expense, categoryKey, "hog", by === "assistent" ? "assistent" : "anvandare");
  } else {
    expense.category = categoryKey;
  }
  const jobText = expense.jobId ? ` och kopplades till uppdraget ${data.jobs.find((j) => j.id === expense.jobId)?.title}` : "";
  logActivity(`Köpet hos ${expense.supplier} (${kr(expense.amount)}) bokfördes som ${categoryByKey(categoryKey).label.toLowerCase()}${jobText}.`, {
    entity: { type: "utgift", id: expenseId },
  });
  save();
}

/**
 * Ångra en bokförd utgift. Historiken skrivs aldrig om: en rättelseverifikation
 * återför originalet, och utgiften öppnas igen så att den kan bokföras rätt.
 */
export function undoExpenseBooking(expenseId: string, by: "anvandare" | "assistent" = "anvandare"): void {
  const data = db();
  const expense = data.expenses.find((e) => e.id === expenseId);
  if (!expense || expense.status !== "bokford" || !expense.verificationId) {
    throw new Error("Utgiften är inte bokförd, så det finns inget att ångra.");
  }
  createCorrection({
    verificationId: expense.verificationId,
    reason: `Användaren ångrade bokningen av köpet hos ${expense.supplier}`,
    by: by === "assistent" ? "assistent" : "anvandare",
  });
  expense.verificationId = undefined;
  expense.status = "behover_svar";
  expense.question = {
    text: `Bokningen är ångrad. Vad gällde köpet på ${kr(expense.amount)} hos ${expense.supplier}?`,
    options: ["Material", "Verktyg & förbrukning", "Kundrepresentation", "Annat"],
  };
  if (expense.bankTransactionId) {
    const tx = data.bankTransactions.find((t) => t.id === expense.bankTransactionId);
    if (tx) {
      tx.status = "behover_atgard";
      tx.verificationId = undefined;
    }
  }
  logActivity(`Bokningen av köpet hos ${expense.supplier} (${kr(expense.amount)}) ångrades – en rättelseverifikation skapades.`, {
    entity: { type: "utgift", id: expenseId },
  });
  save();
}

/* ------------------------- Kvitto ↔ banktransaktion ------------------------- */

export interface ReceiptTxMatch {
  transactionId: string;
  confidence: "hog" | "medel";
  reason: string;
}

/**
 * Matcha ett fristående kvitto mot obokade utgående banktransaktioner:
 * exakt belopp + leverantörsnamn → hög (autolänk), exakt belopp entydigt
 * inom ±3 dagar → medel (förslag). Aldrig dubbelkoppling: transaktioner som
 * redan hör till en utgift utesluts.
 */
export function matchReceiptToTransaction(extracted: {
  supplier: string;
  amount: number;
  date: string;
}): ReceiptTxMatch | null {
  const data = db();
  const takenTx = new Set(data.expenses.filter((e) => e.bankTransactionId).map((e) => e.bankTransactionId));
  const candidates = data.bankTransactions.filter(
    (t) => t.status !== "bokford" && t.amount < 0 && -t.amount === extracted.amount && !takenTx.has(t.id)
  );
  if (candidates.length === 0) return null;
  const supplierKey = merchantRuleKey(extracted.supplier);
  const byName = candidates.filter((t) => merchantRuleKey(t.counterpart).includes(supplierKey) || supplierKey.includes(merchantRuleKey(t.counterpart)));
  if (byName.length === 1) {
    return {
      transactionId: byName[0].id,
      confidence: "hog",
      reason: `Exakt belopp ${kr(extracted.amount)} + leverantörsnamn ${extracted.supplier}`,
    };
  }
  const nearDate = candidates.filter(
    (t) => Math.abs(Date.parse(t.date) - Date.parse(extracted.date)) <= 3 * 86_400_000
  );
  if (nearDate.length === 1) {
    return {
      transactionId: nearDate[0].id,
      confidence: "medel",
      reason: `Exakt belopp ${kr(extracted.amount)}, entydigt inom ±3 dagar`,
    };
  }
  return null;
}

/**
 * Skapa utgift från kända belopp (inkommande kvitto). Hitta ALDRIG på belopp –
 * anroparen måste skicka hela kronor. Bokför bara om kategorin är högkonfident.
 */
export function createExpenseFromKnownReceipt(input: {
  supplier: string;
  amount: number;
  vatAmount: number;
  date: string;
  description?: string;
  filename?: string;
  source?: Receipt["source"];
}): { expense: Expense; autoBooked: boolean } {
  if (!Number.isInteger(input.amount) || input.amount < 1) {
    throw new Error("Belopp saknas – kan inte skapa utgift utan belopp i hela kronor.");
  }
  if (!Number.isInteger(input.vatAmount) || input.vatAmount < 0 || input.vatAmount > input.amount) {
    throw new Error("Momsbelopp är ogiltigt.");
  }
  const supplier = input.supplier.trim();
  if (!supplier) throw new Error("Leverantör saknas.");

  const data = db();
  const now = new Date().toISOString();
  const expense: Expense = {
    id: uid(),
    supplier,
    date: input.date.slice(0, 10),
    amount: input.amount,
    vatAmount: input.vatAmount,
    description: input.description,
    status: "saknar_kvitto",
    createdAt: now,
  };
  data.expenses.push(expense);

  // Kvittoflödet (fall A): matcha mot ett obokat kortköp i banken när
  // matchningen är entydig – bokföringen markerar då även transaktionen och
  // kvittot lämnar aldrig ett omatchat bankköp efter sig. Ett kvitto skapar
  // ALDRIG en utbetalning.
  const txMatch = matchReceiptToTransaction({ supplier, amount: input.amount, date: expense.date });
  if (txMatch) expense.bankTransactionId = txMatch.transactionId;

  const receipt: Receipt = {
    id: uid(),
    expenseId: expense.id,
    filename: input.filename || `kvitto-${supplier.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`,
    source: input.source ?? "email",
    uploadedAt: now,
    extracted: {
      supplier,
      date: expense.date,
      amount: input.amount,
      vatAmount: input.vatAmount,
      description: input.description ?? "Inköp",
      category: "",
      confidence: "lag",
    },
  };
  data.receipts.push(receipt);
  expense.receiptId = receipt.id;

  const guess = categorizeMerchant(supplier);
  let autoBooked = false;
  if (guess && guess.confidence === "hog" && !assetSuggestionForExpense({ ...expense, category: guess.key })) {
    if (!expense.description) expense.description = receipt.extracted.description;
    receipt.extracted.category = guess.key;
    receipt.extracted.confidence = "hog";
    bookExpense(
      expense,
      guess.key,
      "hog",
      "auto",
      txMatch ? `${guess.reason}. Kvittot matchades mot bankköpet (${txMatch.reason})` : guess.reason
    );
    autoBooked = true;
  } else if (guess) {
    expense.status = "behover_svar";
    const suggested = categoryByKey(guess.key).label;
    expense.question = {
      text: `Vad gällde köpet på ${kr(expense.amount)} hos ${expense.supplier}? Driva gissar ${suggested.toLowerCase()} (${guess.reason}).`,
      options: [suggested, "Material", "Verktyg & förbrukning", "Annat"],
    };
  } else {
    expense.status = "behover_svar";
    expense.question = {
      text: `Vad gällde köpet på ${kr(expense.amount)} hos ${expense.supplier}?`,
      options: ["Material", "Verktyg & förbrukning", "Kundrepresentation", "Annat"],
    };
  }
  save();
  return { expense, autoBooked };
}

/** Fristående kvittouppladdning utan känd banktransaktion (demo-exempel). */
const STANDALONE_TEMPLATES = [
  { supplier: "Byggmax", amount: 1240, vatAmount: 248, category: "material", description: "Reglar och skruv" },
  { supplier: "Jula", amount: 489, vatAmount: 98, category: "verktyg", description: "Borrset och bits" },
  { supplier: "OKQ8", amount: 745, vatAmount: 149, category: "drivmedel", description: "Diesel, servicebil" },
];

/**
 * Demo: skapa ett exempelkvitto. Kvittot matchas mot en obokad banktransaktion
 * om en passar; annars skapas motsvarande (demo-)kortköp i banken så att
 * huvudboken (1930) aldrig glider ifrån bankens saldo – även demodata måste
 * följa bokföringens invarianter.
 */
export function uploadStandaloneReceipt(filename: string): Expense {
  assertDemoMode("Exempelkvitto");
  const data = db();
  const tpl = STANDALONE_TEMPLATES[data.receipts.length % STANDALONE_TEMPLATES.length];
  const now = new Date().toISOString();
  const expense: Expense = {
    id: uid(),
    supplier: tpl.supplier,
    date: now,
    amount: tpl.amount,
    vatAmount: tpl.vatAmount,
    description: tpl.description,
    status: "saknar_kvitto",
    createdAt: now,
  };

  // Kvitto ↔ transaktion: återanvänd en obokad transaktion om den matchar.
  const match = matchReceiptToTransaction({ supplier: tpl.supplier, amount: tpl.amount, date: now });
  if (match) {
    expense.bankTransactionId = match.transactionId;
  } else {
    const account = data.bankAccounts[0];
    if (account) {
      const tx: BankTransaction = {
        id: uid(),
        accountId: account.id,
        externalId: `demo-${uid()}`,
        date: now,
        amount: -tpl.amount,
        counterpart: tpl.supplier,
        description: `Kortköp ${tpl.supplier.toUpperCase()}`,
        status: "ny",
      };
      data.bankTransactions.unshift(tx);
      account.balance -= tpl.amount;
      expense.bankTransactionId = tx.id;
    }
  }

  data.expenses.push(expense);
  const receipt: Receipt = {
    id: uid(),
    expenseId: expense.id,
    filename: filename || `kvitto-${tpl.supplier.toLowerCase()}.jpg`,
    source: "uppladdning",
    uploadedAt: now,
    extracted: {
      supplier: tpl.supplier,
      date: now,
      amount: tpl.amount,
      vatAmount: tpl.vatAmount,
      description: tpl.description,
      category: tpl.category,
      confidence: "hog",
    },
  };
  data.receipts.push(receipt);
  expense.receiptId = receipt.id;
  bookExpense(expense, tpl.category, "hog", "auto", match ? `Kvittot matchades mot bankköpet (${match.reason})` : undefined);
  logActivity(
    `Exempelkvitto (demo) från ${tpl.supplier} (${kr(tpl.amount)}) skapades och bokfördes som ${categoryByKey(tpl.category).label.toLowerCase()}.`,
    { entity: { type: "utgift", id: expense.id } }
  );
  save();
  return expense;
}
