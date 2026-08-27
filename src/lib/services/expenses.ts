import { db, save } from "../store";
import { uid } from "../ids";
import type { Expense, Receipt, Verification } from "../types";
import { categoryByKey, entriesExpense, guessCategory, EXPENSE_CATEGORIES, KNOWN_SUPPLIERS } from "../bas";
import { kr } from "../format";
import { logActivity } from "./activity";
import { postVerification, createCorrection } from "../accounting/engine";
import { clampToOpenDate } from "../accounting/fiscal";
import { assetSuggestionForExpense, registerAssetFromExpense, INVENTARIE_GRANS } from "../accounting/assets";

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

/** Klarspråksförklaring till varför köpet konterades som det gjorde. */
function expenseExplanation(expense: Expense, categoryKey: string, createdBy: Verification["createdBy"]): string {
  const cat = categoryByKey(categoryKey);
  const known = Object.keys(KNOWN_SUPPLIERS).find((name) => expense.supplier.toLowerCase().includes(name));
  const why =
    createdBy === "auto" && known
      ? `Driva känner igen ${expense.supplier} och bokför köp där som ${cat.label.toLowerCase()}`
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
  createdBy: Verification["createdBy"]
): Verification {
  const data = db();
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
      expenseExplanation(expense, categoryKey, createdBy) +
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
      tx.verificationId = ver.id;
    }
  }
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

/** Ladda upp kvitto för ett köp som saknar kvitto. */
export function uploadReceiptForExpense(
  expenseId: string,
  filename: string,
  source: Receipt["source"]
): { receipt: Receipt; autoBooked: boolean } {
  const data = db();
  const expense = data.expenses.find((e) => e.id === expenseId);
  if (!expense) throw new Error("Utgiften finns inte");

  // "AI-extraktion" – i demon speglar den banktransaktionens fakta.
  const guess = guessCategory(expense.supplier);
  const receipt: Receipt = {
    id: uid(),
    expenseId,
    filename: filename || `kvitto-${expense.supplier.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.jpg`,
    source,
    uploadedAt: new Date().toISOString(),
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
    // Hög säkerhet → bokför automatiskt.
    if (!expense.description) expense.description = receipt.extracted.description;
    bookExpense(expense, guess.key, "hog", "auto");
    logActivity(
      `Kvitto från ${expense.supplier} (${kr(expense.amount)}) matchades mot bankköpet och bokfördes som ${categoryByKey(guess.key).label.toLowerCase()}.`,
      { entity: { type: "utgift", id: expenseId } }
    );
    autoBooked = true;
  } else {
    // Låg/medel säkerhet → ställ en enkel fråga.
    expense.status = "behover_svar";
    expense.question = {
      text: `Vad gällde köpet på ${kr(expense.amount)} hos ${expense.supplier}?`,
      options: ["Material", "Verktyg & förbrukning", "Kundrepresentation", "Annat"],
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

/** Fristående kvittouppladdning utan känd banktransaktion (demo-exempel). */
const STANDALONE_TEMPLATES = [
  { supplier: "Byggmax", amount: 1240, vatAmount: 248, category: "material", description: "Reglar och skruv" },
  { supplier: "Jula", amount: 489, vatAmount: 98, category: "verktyg", description: "Borrset och bits" },
  { supplier: "OKQ8", amount: 745, vatAmount: 149, category: "drivmedel", description: "Diesel, servicebil" },
];

export function uploadStandaloneReceipt(filename: string): Expense {
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
  bookExpense(expense, tpl.category, "hog", "auto");
  logActivity(
    `Kvitto från ${tpl.supplier} (${kr(tpl.amount)}) lästes av och bokfördes som ${categoryByKey(tpl.category).label.toLowerCase()}.`,
    { entity: { type: "utgift", id: expense.id } }
  );
  save();
  return expense;
}
