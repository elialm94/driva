process.env.DRIVA_TEST = "1";

/**
 * Representation har EN motor: `representationSplit`.
 *
 * Innan: samma restaurangnota fick två olika konteringar. Ny utgift →
 * Representation frågade efter antal personer och alkohol och delade upp
 * notan i avdragsgill kostnad (6071/7631), ej avdragsgill kostnad
 * (6072/7632) och avdragsgill moms enligt schablonen. En bankhändelse som
 * kategoriserades som Kundrepresentation bokfördes i stället platt på 6072
 * med ett generiskt momsavdrag - ingen fråga om personer, ingen fråga om
 * alkohol, 6071 aldrig använt.
 *
 * Nu går båda vägarna genom samma motor, och bankvägen frågar efter de två
 * uppgifter som inte går att härleda ur en transaktion innan något bokförs.
 *
 * Regeln och källan: måltider vid representation är inte avdragsgilla, men
 * momsen får lyftas på ett underlag om högst 300 kr per person - schablonen
 * är 36 kr per person (46 kr när alkohol ingår). Enklare förtäring är
 * avdragsgill upp till 60 kr per person. Se SUPPORT_MATRIX-posten
 * `representation_deduction` för primärkällan.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { uid } from "./ids";
import type { BankAccount, BankTransaction, RepresentationKind, VerificationEntry } from "./types";
import { REPRESENTATION_ANSWER, categoryByKey, entriesExpense } from "./bas";
import { expenseCategoryOutcome } from "./autopilot";
import { registerBankTransactions } from "./services/banking";
import {
  answerExpenseQuestion,
  answerRepresentationQuestion,
  expenseCategoryLabel,
  recordMerchantRule,
  uploadReceiptForExpense,
  type RepresentationAnswer,
} from "./services/expenses";
import { createManualExpense } from "./services/manual-expense";
import { requestBookExpense } from "./ai/domain";
import { ASSISTANT_TOOL_NAMES, toolRequiresConfirmation, toolRisk } from "./ai/tools";
import {
  REPRESENTATION_LABELS,
  planIsBalanced,
  planManualExpense,
  type ManualExpenseDraft,
} from "./expenses/manual-expense";
import { todayDate } from "./accounting/dates";
import { kr } from "./format";

const TODAY = todayDate();
const YEAR = Number(TODAY.slice(0, 4));
/** Ett datum i år som säkert inte ligger i framtiden - samma dag i båda vägarna. */
const DATE = TODAY < `${YEAR}-02-01` ? `${YEAR}-01-01` : `${YEAR}-01-15`;
/** Bolagsnamn, inte ett personnamn: annars blir kortköpet ett beslut i bankvyn i stället för en utgift. */
const SUPPLIER = "Restaurang Prinsen AB";

function reset() {
  replaceDb(
    emptyTestDb({
      bankAccounts: [
        {
          id: "acc-1",
          provider: "mock",
          name: "Företagskonto",
          accountNumber: "1234-5678",
          balance: 0,
          connectedAt: new Date().toISOString(),
        } satisfies BankAccount,
      ],
    })
  );
  db().fiscalYears.push({
    id: "fy",
    label: String(YEAR),
    startDate: `${YEAR}-01-01`,
    endDate: `${YEAR}-12-31`,
    status: "oppet",
    openingBalances: {},
    openingSource: "migrering",
  });
}

/** Nettoställning per konto: positivt = debet. */
function net(entries: readonly VerificationEntry[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const e of entries) out[e.account] = (out[e.account] ?? 0) + e.debit - e.credit;
  return out;
}

function verificationFor(expenseId: string) {
  const expense = db().expenses.find((e) => e.id === expenseId);
  const ver = db().verifications.find((v) => v.id === expense?.verificationId);
  assert.ok(ver, "verifikationen finns");
  return ver;
}

function outgoingTx(over: Partial<BankTransaction> & { amount: number }): BankTransaction {
  return {
    id: uid(),
    accountId: "acc-1",
    externalId: `ext-${uid()}`,
    date: DATE,
    counterpart: SUPPLIER,
    description: "Kortköp",
    status: "ny",
    ...over,
  };
}

/**
 * Bankvägen fram till bekräftelsesteget: kortköpet blir en utgift utan
 * kvitto, kvittot ger momsen, och användaren svarar att notan var
 * representation.
 */
function bankExpenseAwaitingRepresentation(input: { amount: number; vatAmount: number; supplier?: string }) {
  const supplier = input.supplier ?? SUPPLIER;
  registerBankTransactions([outgoingTx({ amount: -input.amount, counterpart: supplier })]);
  const tx = db().bankTransactions[0];
  const expense = db().expenses.find((e) => e.bankTransactionId === tx.id);
  assert.ok(expense, "kortköpet blev en utgift som väntar på kvitto");
  uploadReceiptForExpense(expense.id, "kvitto.jpg", "foto", undefined, {
    supplier,
    amount: input.amount,
    vatAmount: input.vatAmount,
  });
  assert.equal(expense.vatAmount, input.vatAmount, "momsen kom från kvittot");
  answerExpenseQuestion(expense.id, REPRESENTATION_ANSWER);
  return { tx, expense };
}

/** Hela bankvägen: fråga + svar, och verifikationen som blev av det. */
function bookViaBank(input: { amount: number; vatAmount: number; supplier?: string } & RepresentationAnswer) {
  const { expense, tx } = bankExpenseAwaitingRepresentation(input);
  answerRepresentationQuestion(expense.id, {
    kind: input.kind,
    persons: input.persons,
    alcohol: input.alcohol,
    ...(input.participants ? { participants: input.participants } : {}),
    ...(input.purpose ? { purpose: input.purpose } : {}),
  });
  return { expense, tx, ver: verificationFor(expense.id) };
}

/** Samma nota registrerad för hand (Ny utgift → Representation). */
function bookViaManualExpense(input: { amount: number; vatAmount: number; supplier?: string } & RepresentationAnswer) {
  const r = createManualExpense({
    kind: "representation",
    date: DATE,
    paidBy: "foretagskonto",
    supplier: input.supplier ?? SUPPLIER,
    amount: input.amount,
    vatAmount: input.vatAmount,
    representation: {
      kind: input.kind,
      persons: input.persons,
      alcohol: input.alcohol,
      ...(input.participants ? { participants: input.participants } : {}),
      ...(input.purpose ? { purpose: input.purpose } : {}),
    },
  });
  return { expense: r.expense, ver: verificationFor(r.expense.id) };
}

/* ------------------------- Den platta vägen är stängd ------------------------- */

describe("Kundrepresentation kan inte konteras generiskt", () => {
  beforeEach(() => reset());

  it("entriesExpense vägrar kontera kategorin - avdraget kräver uppgifter den inte har", () => {
    assert.throws(
      () => entriesExpense("representation", 1_500, 161, 1930),
      /antal personer/,
      "en restaurangnota får aldrig bokföras platt på 6072"
    );
  });

  it("kategorin finns kvar med sin etikett, men är märkt som bekräftelsekrävande", () => {
    const cat = categoryByKey("representation");
    assert.equal(cat.label, REPRESENTATION_ANSWER, "etiketten och svaret i frågan är samma text");
    assert.equal(cat.requiresConfirmedDetails, true);
    assert.notEqual(categoryByKey("representation").key, "ovrigt", "nyckeln faller inte tillbaka på Övrigt");
  });

  it("representation blir aldrig AUTO_EXECUTE - inte ens med företagets egen regel", () => {
    assert.equal(expenseCategoryOutcome("representation", "hog"), "REQUIRES_USER");
    assert.equal(expenseCategoryOutcome("representation", "medel"), "REQUIRES_USER");
    assert.equal(expenseCategoryOutcome("material", "hog"), "AUTO_EXECUTE");
    assert.equal(expenseCategoryOutcome("material", "medel"), "SUGGEST");
  });
});

/* ------------------------------ Bekräftelsesteget ----------------------------- */

describe("Bankhändelse som kategoriseras som representation", () => {
  beforeEach(() => reset());

  it("bokförs inte på svaret - den frågar efter slag, personer och alkohol", () => {
    const { expense, tx } = bankExpenseAwaitingRepresentation({ amount: 1_500, vatAmount: 161 });
    assert.equal(expense.status, "behover_svar", "ingenting bokfördes på ordet Kundrepresentation");
    assert.equal(expense.verificationId, undefined);
    assert.equal(db().verifications.length, 0, "ingen verifikation skapades");
    assert.equal(tx.status, "behover_atgard", "banktransaktionen är kvar som ohanterad");
    assert.equal(expense.question?.form, "representation");
    assert.deepEqual(
      expense.question?.options,
      (["kundmaltid", "kundfika", "personalmaltid", "personalfika"] as RepresentationKind[]).map(
        (k) => REPRESENTATION_LABELS[k].label
      )
    );
  });

  it("en obesvarad fråga lämnar bokföringen tom - även efter att frågan ställts om", () => {
    const { expense } = bankExpenseAwaitingRepresentation({ amount: 900, vatAmount: 96 });
    answerExpenseQuestion(expense.id, REPRESENTATION_ANSWER);
    assert.equal(db().verifications.length, 0, "upprepade svar bokför fortfarande ingenting");
    assert.equal(expense.status, "behover_svar");
  });

  it("ett ensamt val på representationsfrågan bokför inte - inte ens slaget", () => {
    const { expense } = bankExpenseAwaitingRepresentation({ amount: 900, vatAmount: 96 });
    // Slaget räcker inte: antal personer och alkohol saknas fortfarande. Utan
    // vakten hade svaret fallit ned i kategorimatchningen och hamnat på 6991.
    answerExpenseQuestion(expense.id, REPRESENTATION_LABELS.kundmaltid.label);
    assert.equal(db().verifications.length, 0, "ingen kontering på ett halvt svar");
    assert.equal(expense.status, "behover_svar");
    assert.equal(expense.question?.form, "representation", "frågan står kvar");
  });

  it("en inlärd representationsregel bokför inte heller automatiskt", () => {
    recordMerchantRule(SUPPLIER, "representation");
    recordMerchantRule(SUPPLIER, "representation");
    registerBankTransactions([outgoingTx({ amount: -1_500 })]);
    const expense = db().expenses[0];
    const { autoBooked } = uploadReceiptForExpense(expense.id, "kvitto.jpg", "foto", undefined, {
      supplier: SUPPLIER,
      amount: 1_500,
      vatAmount: 161,
    });
    assert.equal(autoBooked, false, "regeln gör kategorin säker, inte uppgifterna");
    assert.equal(expense.question?.form, "representation");
    assert.equal(db().verifications.length, 0);
  });

  it("svaret bokför uppdelningen och sparar uppgifterna på utgiften", () => {
    const { expense, tx, ver } = bookViaBank({
      amount: 1_500,
      vatAmount: 161,
      kind: "kundmaltid",
      persons: 4,
      alcohol: false,
      participants: "Anna (Bygg AB), Erik",
    });
    // Netto 1 339. Moms 161, varav 4 × 36 = 144 får lyftas; resten (17) blir kostnad.
    assert.deepEqual(net(ver.entries), { 6072: 1_339 + 17, 2641: 144, 1930: -1_500 });
    assert.equal(expense.status, "bokford");
    assert.equal(expense.kind, "representation");
    assert.equal(expense.paidBy, "foretagskonto", "kortköpet betalades av företagskontot");
    assert.deepEqual(expense.details?.representation, {
      kind: "kundmaltid",
      persons: 4,
      alcohol: false,
      participants: "Anna (Bygg AB), Erik",
    });
    assert.equal(expenseCategoryLabel(expense), "Måltid med kund");
    assert.equal(tx.status, "bokford", "banktransaktionen är avbockad");
    assert.equal(tx.verificationId, ver.id);
  });

  it("verifikationen bär samma klarspråksförklaring som Ny utgift ger", () => {
    const { ver } = bookViaBank({ amount: 1_500, vatAmount: 161, kind: "kundmaltid", persons: 4, alcohol: false });
    const text = ver.explanation ?? "";
    assert.match(text, /inte avdragsgill \(6072\)/);
    assert.match(text, /36 kr per person/);
    assert.ok(text.includes(`här ${kr(144)}`), `schablonen står i förklaringen: ${text}`);
    assert.ok(text.includes(`Resten av momsen (${kr(17)}) blir kostnad`), `momsresten står i förklaringen: ${text}`);
    assert.match(text, /företagskontot \(1930\)/);
  });

  it("en utgift med tidsstämpel i datumet bokförs också", () => {
    const { expense } = bankExpenseAwaitingRepresentation({ amount: 1_500, vatAmount: 161 });
    // Äldre rader och seeddata bär en full tidsstämpel i date. Planen kräver
    // en dag, så dagen plockas ut i stället för att svaret vägras.
    expense.date = `${DATE}T10:00:00.000Z`;
    const ver = answerRepresentationQuestion(expense.id, { kind: "kundmaltid", persons: 4, alcohol: false });
    assert.deepEqual(net(ver.entries), { 6072: 1_356, 2641: 144, 1930: -1_500 });
    assert.equal(expense.status, "bokford");
  });

  it("nekar ett svar utan slag eller utan personer", () => {
    const { expense } = bankExpenseAwaitingRepresentation({ amount: 1_500, vatAmount: 161 });
    assert.throws(
      () => answerRepresentationQuestion(expense.id, { kind: "middag" as RepresentationKind, persons: 2, alcohol: false }),
      /Välj vilken sorts representation/
    );
    assert.throws(
      () => answerRepresentationQuestion(expense.id, { kind: "kundmaltid", persons: 0, alcohol: false }),
      /Ange hur många personer/
    );
    assert.equal(db().verifications.length, 0);
  });
});

/* --------------------- Samma nota, båda vägarna, samma rader -------------------- */

describe("Samma nota genom båda vägarna ger identiska verifikationsrader", () => {
  beforeEach(() => reset());

  const cases: { name: string; amount: number; vatAmount: number; answer: RepresentationAnswer }[] = [
    {
      name: "måltid utan alkohol",
      amount: 1_500,
      vatAmount: 161,
      answer: { kind: "kundmaltid", persons: 4, alcohol: false },
    },
    {
      name: "måltid med alkohol",
      amount: 1_500,
      vatAmount: 161,
      answer: { kind: "kundmaltid", persons: 4, alcohol: true },
    },
    {
      name: "enklare förtäring under 60 kr per person",
      amount: 100,
      vatAmount: 11,
      answer: { kind: "kundfika", persons: 2, alcohol: false },
    },
    {
      name: "enklare förtäring över 60 kr per person",
      amount: 500,
      vatAmount: 54,
      answer: { kind: "kundfika", persons: 2, alcohol: false },
    },
    {
      name: "momsen på kvittot är lägre än schablonen",
      amount: 1_200,
      vatAmount: 60,
      answer: { kind: "kundmaltid", persons: 4, alcohol: true },
    },
    {
      name: "personalfest med alkohol",
      amount: 3_000,
      vatAmount: 321,
      answer: { kind: "personalmaltid", persons: 3, alcohol: true },
    },
  ];

  for (const c of cases) {
    it(`${c.name}: rad för rad lika`, () => {
      reset();
      const manual = bookViaManualExpense({ amount: c.amount, vatAmount: c.vatAmount, ...c.answer });
      reset();
      const bank = bookViaBank({ amount: c.amount, vatAmount: c.vatAmount, ...c.answer });

      assert.equal(bank.ver.entries.length, manual.ver.entries.length, "lika många rader");
      for (let i = 0; i < manual.ver.entries.length; i++) {
        const a = manual.ver.entries[i];
        const b = bank.ver.entries[i];
        assert.deepEqual(
          { account: b.account, debit: b.debit, credit: b.credit },
          { account: a.account, debit: a.debit, credit: a.credit },
          `rad ${i + 1}`
        );
      }
      assert.equal(bank.ver.explanation, manual.ver.explanation, "samma förklaring");
      assert.equal(bank.ver.description, manual.ver.description, "samma verifikationstext");

      const debit = bank.ver.entries.reduce((s, e) => s + e.debit, 0);
      const credit = bank.ver.entries.reduce((s, e) => s + e.credit, 0);
      assert.equal(debit, credit, "konteringen är i balans");
      assert.equal(credit, c.amount, "hela notan är betald");

      const draft: ManualExpenseDraft = {
        kind: "representation",
        date: DATE,
        paidBy: "foretagskonto",
        supplier: SUPPLIER,
        amount: c.amount,
        vatAmount: c.vatAmount,
        representation: c.answer,
      };
      const planned = planManualExpense(draft);
      assert.ok(planned.ok && planIsBalanced(planned.plan), "planen är i balans");
    });
  }

  it("måltid med alkohol lyfter mer moms än utan - samma nota, olika svar", () => {
    reset();
    const utan = bookViaBank({ amount: 1_500, vatAmount: 161, kind: "kundmaltid", persons: 4, alcohol: false });
    reset();
    const med = bookViaBank({ amount: 1_500, vatAmount: 161, kind: "kundmaltid", persons: 4, alcohol: true });
    assert.deepEqual(net(utan.ver.entries), { 6072: 1_356, 2641: 144, 1930: -1_500 });
    // 4 × 46 = 184 > 161 → hela momsen får lyftas.
    assert.deepEqual(net(med.ver.entries), { 6072: 1_339, 2641: 161, 1930: -1_500 });
  });

  it("enklare förtäring använder 6071 - kontot den platta vägen aldrig kom åt", () => {
    reset();
    const under = bookViaBank({ amount: 100, vatAmount: 11, kind: "kundfika", persons: 2, alcohol: false });
    assert.deepEqual(net(under.ver.entries), { 6071: 89, 2641: 11, 1930: -100 });
    reset();
    const over = bookViaBank({ amount: 500, vatAmount: 54, kind: "kundfika", persons: 2, alcohol: false });
    // Netto 446: 2 × 60 = 120 avdragsgillt, 326 ej. Underlag 446 < 600 → all moms lyfts.
    assert.deepEqual(net(over.ver.entries), { 6071: 120, 6072: 326, 2641: 54, 1930: -500 });
  });

  it("momsen på kvittot är taket - schablonen lyfter aldrig mer än det som betalats", () => {
    const { ver } = bookViaBank({ amount: 1_200, vatAmount: 60, kind: "kundmaltid", persons: 4, alcohol: true });
    // Schablonen tillåter 4 × 46 = 184, men kvittot bär bara 60 kr moms.
    assert.deepEqual(net(ver.entries), { 6072: 1_140, 2641: 60, 1930: -1_200 });
  });
});

/* ------------------------------ AI-verktygsregistret ---------------------------- */

describe("Assistenten får aldrig gissa uppgifterna", () => {
  beforeEach(() => reset());

  it("book_expense vägrar kategorin representation, både som nyckel och etikett", () => {
    const { expense } = bankExpenseAwaitingRepresentation({ amount: 1_500, vatAmount: 161 });
    for (const category of ["representation", REPRESENTATION_ANSWER]) {
      const result = requestBookExpense({ expenseId: expense.id, category });
      assert.equal(result.ok, false, category);
      assert.match(result.text, /antal personer/i);
    }
    assert.equal(db().pendingActions.length, 0, "inget bekräftelsekort skapades");
    assert.equal(db().verifications.length, 0);
  });

  it("verktygen som rör utgiftsbokföring har kvar sina riskklasser", () => {
    assert.equal(toolRisk("book_expense"), "CONFIRM_REQUIRED");
    assert.equal(toolRequiresConfirmation("book_expense"), true);
    assert.equal(toolRisk("answer_expense_question"), "FORBIDDEN_FOR_AI");
    assert.equal(
      ASSISTANT_TOOL_NAMES.some((name) => /representation/i.test(name)),
      false,
      "det finns inget eget representationsverktyg för modellen"
    );
  });
});
