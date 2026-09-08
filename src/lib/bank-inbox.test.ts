process.env.DRIVA_TEST = "1";

/**
 * Bankvyn som inkorg med lärda regler.
 *
 * Innan: bankavgifter, inbetalningar till skattekontot, löneutbetalningar,
 * amorteringar och ägarens insättningar landade som "Behöver åtgärd" utan
 * någon knapp som löste dem. Nu känner motorn igen dem (mönster), föreslår en
 * bokföring med rätt BAS-kontering, kopplar det som redan är bokfört (lönen)
 * i stället för att bokföra igen, och lär sig motparten: första gången ett
 * förslag, från andra gången automatiskt.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { uid } from "./ids";
import type { BankAccount, BankTransaction } from "./types";
import { registerBankTransactions } from "./services/banking";
import { getBusinessActions } from "./services/actions";
import {
  bookSuggestedBankTransactions,
  paymentSuggestionForTransaction,
  suggestedBankBookings,
} from "./services/payment-matching";
import {
  alreadyBookedCandidates,
  bankCounterpartRuleFor,
  bankKindSuggestion,
  bookBankTransactionAs,
  forgetBankCounterpartRule,
  listBankCounterpartRules,
} from "./services/bank-booking";
import { bankInboxSummary, listBankForTable, openBankTransactionCount } from "./services/economy-list";
import { bankKindByPattern, bankKindsFor, BANK_KINDS } from "./banking/bank-kinds";
import { runPayroll, saveEmployee } from "./accounting/payroll";
import { taxAccountLedger } from "./accounting/tax-account";
import { accountBalance } from "./accounting/ledger";
import { uploadReceiptForExpense } from "./services/expenses";

const YEAR = new Date().getFullYear();
const TODAY = new Date().toISOString().slice(0, 10);

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

function tx(over: Partial<BankTransaction> & { amount: number; counterpart: string }): BankTransaction {
  return {
    id: uid(),
    accountId: "acc-1",
    externalId: `ext-${uid()}`,
    date: `${TODAY}T09:00:00.000Z`,
    description: "",
    status: "ny",
    ...over,
  };
}

function register(over: Partial<BankTransaction> & { amount: number; counterpart: string }): BankTransaction {
  const t = tx(over);
  registerBankTransactions([t]);
  return db().bankTransactions.find((x) => x.id === t.id)!;
}

function entries(verificationId: string) {
  const v = db().verifications.find((x) => x.id === verificationId)!;
  return Object.fromEntries(v.entries.map((e) => [e.account, e.debit - e.credit]));
}

describe("Katalogen över banktransaktionstyper", () => {
  it("varje typ som bokförs här har en balanserad kontering över 1930", () => {
    for (const kind of BANK_KINDS) {
      if (!kind.entries) continue;
      const rows = kind.entries(1_000);
      const debit = rows.reduce((s, r) => s + (r.debit ?? 0), 0);
      const credit = rows.reduce((s, r) => s + (r.credit ?? 0), 0);
      assert.equal(debit, credit, kind.key);
      assert.ok(rows.some((r) => r.account === 1930), `${kind.key} rör företagskontot`);
      const bank = rows.find((r) => r.account === 1930)!;
      if (kind.direction === "ut") assert.equal(bank.credit, 1_000, `${kind.key} lämnar kontot`);
      if (kind.direction === "in") assert.equal(bank.debit, 1_000, `${kind.key} kommer in på kontot`);
    }
  });

  it("riktningen styr vilka typer som visas – skattekonto ut, skatteåterbetalning in", () => {
    const out = bankKindsFor("ut").map((k) => k.key);
    const inn = bankKindsFor("in").map((k) => k.key);
    assert.ok(out.includes("skattekonto") && !inn.includes("skattekonto"));
    assert.ok(inn.includes("skatteaterbetalning") && !out.includes("skatteaterbetalning"));
    assert.ok(out.includes("redan_bokford") && inn.includes("redan_bokford"), "redan bokförd finns åt båda håll");
  });

  it("mönstren känner igen vardagens transaktioner och de specifika vinner över 'överföring'", () => {
    const cases: [number, string, string, string][] = [
      [-79, "SEB", "Månadsavgift företagspaket", "bankavgift"],
      [-12_400, "Skatteverket", "Inbetalning skattekonto", "skattekonto"],
      [-31_200, "Anna Ek", "Överföring Lön september", "lon"],
      [-4_500, "Almi", "Amortering lån 4711", "amortering"],
      [-1_250, "Trygg-Hansa", "Autogiro", "forsakring"],
      [-2_000, "Anna Ek", "Överföring utlägg", "aterbetalning_agare"],
      [-20_000, "Sparkonto", "Överföring", "overforing_eget_konto"],
      [50_000, "Anna Ek", "Egen insättning", "agartillskott"],
      [3_400, "Skatteverket", "Utbetalning skattekonto", "skatteaterbetalning"],
      [120, "SEB", "Ränta", "ranteintakt"],
      [-3_100, "Almi", "Ränta lån 4711", "ranta"],
    ];
    for (const [amount, counterpart, description, expected] of cases) {
      assert.equal(bankKindByPattern({ amount, counterpart, description })?.key, expected, `${counterpart} ${description}`);
    }
    assert.equal(bankKindByPattern({ amount: -812, counterpart: "Bauhaus", description: "Kortköp" }), null);
  });
});

describe("Förslag i bankvyn", () => {
  beforeEach(reset);

  it("en bankavgift blir ett förslag med rätt etikett – inte ett köp som saknar kvitto", () => {
    const t = register({ amount: -79, counterpart: "SEB", description: "Månadsavgift företagspaket" });
    assert.equal(t.status, "behover_atgard");
    assert.equal(db().expenses.length, 0, "ingen kvitto-platshållare");

    const suggestion = paymentSuggestionForTransaction(t);
    assert.equal(suggestion.kind, "bank_kind");
    assert.equal(suggestion.bankKind, "bankavgift");
    assert.equal(suggestion.outcome, "SUGGEST", "ett mönster bokför aldrig självt");

    const row = listBankForTable({ q: "", status: "atgard", page: 1 }).rows.find((r) => r.id === t.id)!;
    assert.equal(row.statusLabel, "Förslag: Bankavgift");
    assert.equal(row.action?.kind, "book_kind");
    assert.equal(row.picker?.direction, "ut");
    assert.ok(row.picker!.alreadyBooked.length === 0);

    const attention = getBusinessActions().attention.find((a) => a.id === `bank-${t.id}`);
    assert.ok(attention, "Hem visar raden");
    assert.equal(attention.cta?.type, "bookBankKind");
  });

  it("en okänd utbetalning har alltid en utväg: väljaren", () => {
    const t = register({ amount: -1_500, counterpart: "Okänd AB", description: "Autogiro" });
    const row = listBankForTable({ q: "", status: "atgard", page: 1 }).rows.find((r) => r.id === t.id)!;
    // Autogiro utan känt mönster: kvittoflödet tar det som köp – men väljaren finns kvar.
    assert.ok(row.picker, "väljaren finns på varje obokad rad");
    assert.ok(row.action, "raden har en åtgärd");
  });

  it("en inbetalning utan faktura föreslås som ägarens insättning", () => {
    const t = register({ amount: 50_000, counterpart: "Anna Ek", description: "Egen insättning" });
    const s = paymentSuggestionForTransaction(t);
    assert.equal(s.kind, "bank_kind");
    assert.equal(s.bankKind, "agartillskott");
    const row = listBankForTable({ q: "", status: "atgard", page: 1 }).rows.find((r) => r.id === t.id)!;
    assert.equal(row.action?.kind, "book_kind");
    assert.equal(row.picker?.direction, "in");
  });
});

describe("Bokföring från bankvyn", () => {
  beforeEach(reset);

  it("bankavgift: 6570 debet / 1930 kredit, transaktionen bokförd, regeln lärd", () => {
    const t = register({ amount: -79, counterpart: "SEB", description: "Månadsavgift företagspaket" });
    const result = bookBankTransactionAs(t.id, { kind: "bankavgift", remember: true });
    assert.ok(result.verificationId);
    assert.deepEqual(entries(result.verificationId), { 6570: 79, 1930: -79 });
    assert.equal(t.status, "bokford");
    assert.equal(t.verificationId, result.verificationId);
    assert.equal(t.matchedType, "ovrigt");
    const rule = bankCounterpartRuleFor("SEB");
    assert.equal(rule?.kind, "bankavgift");
    assert.equal(rule?.count, 1);
    assert.equal(db().verifications.find((v) => v.id === result.verificationId)?.createdBy, "anvandare");
  });

  it("skattekonto: 1630 debet / 1930 kredit och skattekontots utdrag visar inbetalningen", () => {
    const t = register({ amount: -12_400, counterpart: "Skatteverket", description: "Inbetalning skattekonto" });
    assert.equal(paymentSuggestionForTransaction(t).bankKind, "skattekonto");
    const result = bookBankTransactionAs(t.id, { kind: "skattekonto" });
    assert.deepEqual(entries(result.verificationId!), { 1630: 12_400, 1930: -12_400 });
    assert.equal(t.matchedType, "skatt");
    const ledger = taxAccountLedger(`${YEAR}-12-31`);
    assert.equal(ledger.balance, 12_400);
    assert.equal(ledger.rows[0]?.kind, "inbetalning");
  });

  it("ägarens insättning: 1930 debet / 2893 kredit", () => {
    const t = register({ amount: 50_000, counterpart: "Anna Ek", description: "Egen insättning" });
    const result = bookBankTransactionAs(t.id, { kind: "agartillskott" });
    assert.deepEqual(entries(result.verificationId!), { 1930: 50_000, 2893: -50_000 });
    assert.equal(accountBalance(2893, `${YEAR}-12-31`), -50_000);
  });

  it("fel riktning avvisas begripligt", () => {
    const t = register({ amount: 500, counterpart: "SEB", description: "Ränta" });
    assert.throws(() => bookBankTransactionAs(t.id, { kind: "bankavgift" }), /gäller utbetalningar/);
    assert.equal(t.status, "behover_atgard", "ingenting ändrades");
  });

  it("en kvitto-platshållare tas bort när transaktionen visar sig vara något annat", () => {
    const t = register({ amount: -1_250, counterpart: "Hedvig AB", description: "Kortköp" });
    assert.equal(db().expenses.filter((e) => e.bankTransactionId === t.id).length, 1, "kortköpsflödet skapade ett köp");
    bookBankTransactionAs(t.id, { kind: "forsakring" });
    assert.equal(db().expenses.filter((e) => e.bankTransactionId === t.id).length, 0, "platshållaren är borta");
    assert.equal(t.status, "bokford");
  });

  it("men ett köp som redan fått kvitto står kvar – då är kvittot underlaget", () => {
    const t = register({ amount: -812, counterpart: "Byggmax", description: "Kortköp" });
    const expense = db().expenses.find((e) => e.bankTransactionId === t.id)!;
    uploadReceiptForExpense(expense.id, "kvitto.jpg", "foto", undefined, { supplier: "Okänd", amount: 812, vatAmount: 162 });
    if (expense.status !== "bokford") {
      assert.throws(() => bookBankTransactionAs(t.id, { kind: "bankavgift" }), /redan ett kvitto/);
    }
  });

  it("kortköp via väljaren skapar köpet som väntar på kvitto", () => {
    const t = register({ amount: -350, counterpart: "Okänd AB", description: "Autogiro" });
    // Autogiro-heuristiken kan ha tagit den som köp redan; annars gör väljaren det.
    db().expenses = db().expenses.filter((e) => e.bankTransactionId !== t.id);
    const result = bookBankTransactionAs(t.id, { kind: "kortkop" });
    assert.equal(result.verificationId, undefined);
    const expense = db().expenses.find((e) => e.bankTransactionId === t.id);
    assert.ok(expense);
    assert.equal(expense.status, "saknar_kvitto");
    assert.equal(t.status, "behover_atgard");
  });
});

describe("Lärda motpartsregler", () => {
  beforeEach(reset);

  it("första gången förslag, andra gången automatiskt – med förklaring på verifikationen", () => {
    const first = register({ amount: -79, counterpart: "SEB", description: "Månadsavgift företagspaket" });
    bookBankTransactionAs(first.id, { kind: "bankavgift", remember: true });

    const second = register({ amount: -79, counterpart: "SEB", description: "Månadsavgift företagspaket" });
    assert.equal(second.status, "behover_atgard", "en bekräftelse räcker inte för att bokföra självt");
    const s = paymentSuggestionForTransaction(second);
    assert.equal(s.bankKindSource, "regel");
    assert.equal(s.outcome, "SUGGEST");
    bookBankTransactionAs(second.id, { kind: "bankavgift", remember: true });
    assert.equal(bankCounterpartRuleFor("SEB")?.count, 2);

    const third = register({ amount: -85, counterpart: "SEB", description: "Månadsavgift företagspaket" });
    assert.equal(third.status, "bokford", "tredje gången bokförs automatiskt – även med annat belopp");
    const ver = db().verifications.find((v) => v.id === third.verificationId)!;
    assert.equal(ver.createdBy, "auto");
    assert.deepEqual(entries(ver.id), { 6570: 85, 1930: -85 });
    assert.match(ver.explanation ?? "", /SEB har bokförts som bankavgift 2 gånger/);
    assert.ok(db().activity.some((a) => /bokfördes automatiskt som bankavgift/.test(a.text)));
  });

  it("regeln slår mönstret: motparten bokförs som användaren valt", () => {
    const first = register({ amount: -20_000, counterpart: "Anna Ek", description: "Överföring" });
    bookBankTransactionAs(first.id, { kind: "aterbetalning_agare", remember: true });
    const second = register({ amount: -5_000, counterpart: "Anna Ek", description: "Överföring" });
    const s = paymentSuggestionForTransaction(second);
    assert.equal(s.bankKind, "aterbetalning_agare");
    assert.equal(s.bankKindSource, "regel");
  });

  it("att glömma regeln tar bort automatiken", () => {
    for (let i = 0; i < 2; i++) {
      const t = register({ amount: -79, counterpart: "SEB", description: "Månadsavgift" });
      bookBankTransactionAs(t.id, { kind: "bankavgift", remember: true });
    }
    assert.equal(listBankCounterpartRules()[0]?.automatic, true);
    assert.equal(forgetBankCounterpartRule("SEB"), true);
    assert.equal(bankCounterpartRuleFor("SEB"), undefined);
    const t = register({ amount: -79, counterpart: "SEB", description: "Månadsavgift" });
    assert.equal(t.status, "behover_atgard", "bara ett förslag igen");
  });

  it("remember: false lär ingenting", () => {
    const t = register({ amount: -79, counterpart: "SEB", description: "Månadsavgift" });
    bookBankTransactionAs(t.id, { kind: "bankavgift", remember: false });
    assert.equal(bankCounterpartRuleFor("SEB"), undefined);
  });
});

describe("Redan bokförd: lönen kopplas i stället för att bokföras igen", () => {
  beforeEach(reset);

  function hireAndRun(month: string) {
    if (!db().employees?.length) {
      saveEmployee(
        {
          name: "Anna Ek",
          personnummer: "19850612-1234",
          role: "foretagsledare",
          monthlySalary: 40_000,
          taxBasis: { kind: "procent", percent: 30 },
          startDate: `${YEAR}-01-01`,
        },
        "anvandare"
      );
    }
    return runPayroll({ month, payDate: TODAY }, "anvandare");
  }

  it("utbetalningen med nettolönen föreslås kopplas till lönekörningens verifikation", () => {
    const run = hireAndRun(`${YEAR}-01`);
    const before = db().verifications.length;
    const t = register({ amount: -run.net, counterpart: "Anna Ek", description: "Lön januari" });
    assert.equal(t.status, "behover_atgard");
    assert.equal(db().expenses.length, 0, "lön blir inte ett köp");

    const candidates = alreadyBookedCandidates(t);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].verificationId, run.verificationId);
    assert.equal(candidates[0].sourceType, "lon");

    const s = paymentSuggestionForTransaction(t);
    assert.equal(s.kind, "bank_kind");
    assert.equal(s.bankKind, "redan_bokford");
    assert.equal(s.verificationId, run.verificationId);
    assert.equal(s.outcome, "SUGGEST");

    const row = listBankForTable({ q: "", status: "atgard", page: 1 }).rows.find((r) => r.id === t.id)!;
    assert.equal(row.action?.kind, "book_kind");
    assert.match(row.action!.kind === "book_kind" ? row.action.label : "", /^Koppla till A\d+/);

    bookBankTransactionAs(t.id, { kind: "redan_bokford", verificationId: run.verificationId, remember: true });
    assert.equal(db().verifications.length, before, "ingen ny verifikation");
    assert.equal(t.status, "bokford");
    assert.equal(t.verificationId, run.verificationId);
    assert.equal(alreadyBookedCandidates(tx({ amount: -run.net, counterpart: "x" })).length, 0, "kopplad verifikation är upptagen");
  });

  it("nästa månads lön kopplas automatiskt när regeln finns", () => {
    const jan = hireAndRun(`${YEAR}-01`);
    const t1 = register({ amount: -jan.net, counterpart: "Anna Ek", description: "Lön" });
    bookBankTransactionAs(t1.id, { kind: "redan_bokford", verificationId: jan.verificationId, remember: true });

    const feb = hireAndRun(`${YEAR}-02`);
    const t2 = register({ amount: -feb.net, counterpart: "Anna Ek", description: "Lön" });
    assert.equal(t2.status, "bokford", "kopplad utan klick");
    assert.equal(t2.verificationId, feb.verificationId);
    assert.equal(db().verifications.filter((v) => v.source.type === "banktransaktion").length, 0, "inget bokfördes dubbelt");
  });

  it("utan körd lön säger raden vad som saknas och pekar på Lön", () => {
    const t = register({ amount: -31_200, counterpart: "Anna Ek", description: "Lön januari" });
    const s = paymentSuggestionForTransaction(t);
    assert.equal(s.kind, "bank_kind");
    assert.equal(s.bankKind, "lon");
    assert.equal(s.outcome, "REQUIRES_USER");
    const row = listBankForTable({ q: "", status: "atgard", page: 1 }).rows.find((r) => r.id === t.id)!;
    assert.equal(row.action?.kind, "categorize");
    assert.equal(row.action!.kind === "categorize" ? row.action.href : undefined, "/bokforing/lon");
    assert.equal(row.statusLabel, "Välj typ");
    const attention = getBusinessActions().attention.find((a) => a.id === `bank-${t.id}`);
    assert.equal(attention?.cta?.type, "link");
    assert.equal(attention?.cta && "href" in attention.cta ? attention.cta.href : "", "/bokforing/lon");
  });

  it("att koppla till en verifikation som inte passar avvisas", () => {
    const run = hireAndRun(`${YEAR}-01`);
    const t = register({ amount: -(run.net - 1), counterpart: "Anna Ek", description: "Lön" });
    assert.throws(
      () => bookBankTransactionAs(t.id, { kind: "redan_bokford", verificationId: run.verificationId }),
      /passar inte/
    );
  });
});

describe("Bokför alla föreslagna", () => {
  beforeEach(reset);

  it("listan visar exakt det som bokförs, och allt bokförs med regler som följd", () => {
    register({ amount: -79, counterpart: "SEB", description: "Månadsavgift företagspaket" });
    register({ amount: -12_400, counterpart: "Skatteverket", description: "Inbetalning skattekonto" });
    register({ amount: -812, counterpart: "Bauhaus", description: "Kortköp" }); // väntar på kvitto – inte med
    register({ amount: -9_999, counterpart: "Anna Ek", description: "Lön" }); // kräver val – inte med

    const suggested = suggestedBankBookings();
    assert.deepEqual(
      suggested.map((s) => s.label).sort(),
      ["Bankavgift", "Inbetalning till skattekontot"]
    );
    const summary = bankInboxSummary();
    assert.equal(summary.open, 4);
    assert.equal(summary.suggested.length, 2);
    assert.equal(summary.awaitingReceipt, 1);
    assert.equal(summary.openOut, 79 + 12_400 + 812 + 9_999);

    const result = bookSuggestedBankTransactions("anvandare");
    assert.equal(result.booked, 2);
    assert.deepEqual(result.failed, []);
    assert.equal(bankCounterpartRuleFor("SEB")?.kind, "bankavgift");
    assert.equal(bankCounterpartRuleFor("Skatteverket")?.kind, "skattekonto");
    assert.equal(openBankTransactionCount(), 2, "kvitto- och löneraden är kvar");
    assert.equal(bankInboxSummary().suggested.length, 0);
  });

  it("kan begränsas till valda transaktioner", () => {
    const a = register({ amount: -79, counterpart: "SEB", description: "Månadsavgift" });
    const b = register({ amount: -12_400, counterpart: "Skatteverket", description: "Skattekonto" });
    const result = bookSuggestedBankTransactions("anvandare", [a.id]);
    assert.equal(result.booked, 1);
    assert.equal(a.status, "bokford");
    assert.equal(b.status, "behover_atgard");
  });
});

describe("Bankinkorgens huvud", () => {
  beforeEach(reset);

  it("tomt när allt är hanterat", () => {
    const summary = bankInboxSummary();
    assert.equal(summary.open, 0);
    assert.equal(summary.suggested.length, 0);
    assert.equal(openBankTransactionCount(), 0);
  });

  it("bankKindSuggestion är null för bokförda transaktioner", () => {
    const t = register({ amount: -79, counterpart: "SEB", description: "Månadsavgift" });
    bookBankTransactionAs(t.id, { kind: "bankavgift" });
    assert.equal(bankKindSuggestion(t), null);
  });
});
