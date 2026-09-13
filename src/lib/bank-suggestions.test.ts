process.env.DRIVA_TEST = "1";

/**
 * Evidence-first-förslagsmotorn – svensk syntetisk testmatris.
 *
 * Kravet (go-live-spec §3): tvetydiga fall bokförs ALDRIG automatiskt. Moms
 * bokförs aldrig från en bankrad utan underlag. Privatrisk, restaurang,
 * kontantuttag, överföring till person, utland, okänd mottagare och ovanligt
 * belopp kräver alltid mänskligt beslut – oavsett hur säker regeln är.
 * Osäkra fall får 2–4 val utan förvald bokning. Beslut loggas utan motpart,
 * belopp eller dokumentinnehåll.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { uid } from "./ids";
import type { BankAccount, BankTransaction } from "./types";
import { registerBankTransactions } from "./services/banking";
import { bankCounterpartRuleFor, bookBankTransactionAs } from "./services/bank-booking";
import { evaluateBankTransaction, recurringPatternFor, type BankSuggestion } from "./services/bank-suggestion";
import { uploadReceiptForExpense, answerExpenseQuestion, recordMerchantRule } from "./services/expenses";
import { getBusinessActions } from "./services/actions";
import { decisionCards } from "./services/decision-cards";
import {
  MERCHANT_KB,
  MERCHANT_KB_VERSION,
  PRIVATE_ANSWER,
  looksLikePersonName,
  merchantRiskFlags,
  normalizeMerchant,
} from "./banking/merchants";
import { bankKindByPattern } from "./banking/bank-kinds";
import { amountBucket, buildSuggestionEvent, classifyDecision, suggestionInputHash } from "./services/suggestion-log";
import { suggestionQualityReport } from "./platform/suggestion-quality";
import type { SuggestionEvent } from "./platform/types";

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

function daysAgo(n: number): string {
  return `${new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)}T09:00:00.000Z`;
}

function assertNeverAuto(t: BankTransaction, s: BankSuggestion, label: string) {
  assert.notEqual(t.status, "bokford", `${label}: bokfördes automatiskt`);
  assert.equal(s.autoAllowed, false, `${label}: automatik tillåten`);
  assert.ok(s.humanRequired.length > 0 || s.tier !== "saker", `${label}: nivå Säker utan bevis`);
}

/* --------------------------- Normalisering & KB --------------------------- */

describe("Motpartsnormalisering", () => {
  it("terminal-id, ort och bolagsform försvinner – råtexten behålls", () => {
    const a = normalizeMerchant("MCDONALDS 1234 STOCKHOLM");
    const b = normalizeMerchant("McDonald's 5678");
    const c = normalizeMerchant("MCDONALD'S GBG");
    assert.equal(a.key, "mcdonalds");
    assert.equal(a.key, b.key);
    assert.equal(a.key, c.key);
    assert.equal(a.display, "McDonald's");
    assert.equal(a.raw, "MCDONALDS 1234 STOCKHOLM");
    assert.equal(a.knowledge?.type, "restaurang");
  });

  it("okända motparter får en stabil nyckel utan siffror och ort", () => {
    const a = normalizeMerchant("Hyresvärden i Sthlm AB 2024-03");
    const b = normalizeMerchant("HYRESVÄRDEN I STHLM AB 2024-04");
    assert.equal(a.key, b.key);
    assert.equal(a.knowledge, undefined);
    assert.ok(!/\d/u.test(a.key), a.key);
  });

  it("betydelsebärande siffror i kända namn träffas före rensningen", () => {
    assert.equal(normalizeMerchant("TELE2 SVERIGE AB").key, "tele2");
    assert.equal(normalizeMerchant("OKQ8 4711 UPPSALA").key, "okq8");
    assert.equal(normalizeMerchant("ST1 MALMÖ").key, "st1");
    assert.equal(normalizeMerchant("7-ELEVEN 0912").key, "seven_eleven");
  });

  it("falska positiver: liknande namn är inte kända motparter", () => {
    assert.equal(normalizeMerchant("Shellac Nails Sthlm").knowledge, undefined, "Shellac är inte Shell");
    assert.equal(normalizeMerchant("Ifö Sanitär AB").knowledge, undefined, "Ifö är inte If");
    assert.equal(normalizeMerchant("Trelleborg AB").knowledge, undefined);
    assert.equal(normalizeMerchant("Maximal Bygg AB").knowledge, undefined, "Maximal är inte MAX");
    assert.equal(normalizeMerchant("Julafton Snickeri").knowledge, undefined, "Julafton är inte Jula");
    assert.equal(normalizeMerchant("Preemium Design").knowledge, undefined);
  });

  it("generisk kunskap (pizzeria, hotell) ger typ men aldrig gemensam nyckel", () => {
    const a = normalizeMerchant("Pizzeria Napoli 12");
    const b = normalizeMerchant("Pizzeria Roma");
    assert.equal(a.knowledge?.type, "restaurang");
    assert.notEqual(a.key, b.key);
  });

  it("kunskapsbasen är versionerad och varje post har giltig form", () => {
    assert.match(MERCHANT_KB_VERSION, /^\d{4}\.\d{2}\.\d+$/u);
    const keys = new Set<string>();
    for (const m of MERCHANT_KB) {
      assert.ok(!keys.has(m.key), `dubbel nyckel ${m.key}`);
      keys.add(m.key);
      assert.ok(m.patterns.length > 0, m.key);
      if (m.followUp) {
        assert.ok(m.followUp.options.length >= 2 && m.followUp.options.length <= 5, m.key);
        assert.equal(m.autoBookWithReceipt, false, `${m.key}: en följdfråga och automatik går inte ihop`);
      }
      if (m.risk.includes("privat")) assert.equal(m.autoBookWithReceipt, false, `${m.key}: privatrisk får inte autobokas`);
    }
  });

  it("Shell och McDonald's har de följdfrågor spec kräver", () => {
    const shell = normalizeMerchant("SHELL 7-ELEVEN 4032 UPPSALA").knowledge!;
    assert.deepEqual(shell.followUp?.options, ["Drivmedel", "Butik/förbrukning", "Biltvätt", PRIVATE_ANSWER]);
    const mcd = normalizeMerchant("MCDONALDS 1234").knowledge!;
    assert.deepEqual(mcd.followUp?.options, [PRIVATE_ANSWER, "Kundrepresentation", "Personalmåltid", "Mat på tjänsteresa"]);
  });
});

describe("Riskflaggor", () => {
  it("personnamn känns igen, bolag och kända motparter inte", () => {
    assert.equal(looksLikePersonName("Anna Svensson"), true);
    assert.equal(looksLikePersonName("Per-Erik Lund"), true);
    assert.equal(looksLikePersonName("Anna Svensson AB"), false);
    assert.equal(looksLikePersonName("SEB"), false);
    assert.equal(looksLikePersonName("Byggmax"), false);
  });

  it("flaggorna är deterministiska ur text och kunskapsbas", () => {
    assert.deepEqual(merchantRiskFlags({ amount: -2_000, counterpart: "Uttag Bankomat", description: "Kontantuttag" }).sort(), [
      "kontantuttag",
      "privat_risk",
    ]);
    assert.ok(merchantRiskFlags({ amount: -129, counterpart: "MCDONALDS 1234", description: "Kortköp" }).includes("restaurang"));
    assert.ok(merchantRiskFlags({ amount: -5_000, counterpart: "Anna Svensson", description: "Swish" }).includes("overforing_till_person"));
    assert.ok(merchantRiskFlags({ amount: -890, counterpart: "AMAZON.DE", description: "Kortköp 79,90 EUR" }).includes("utland"));
    assert.ok(merchantRiskFlags({ amount: -1_500, counterpart: "Okänd firma", description: "" }).includes("okand_mottagare"));
    assert.ok(
      merchantRiskFlags({ amount: -6_000, counterpart: "SEB", description: "Avgift", typicalAmount: 79, known: true }).includes("ovanligt_belopp")
    );
    assert.deepEqual(merchantRiskFlags({ amount: -1_200, counterpart: "Ahlsell Sverige AB", description: "Kortköp" }), []);
    assert.deepEqual(merchantRiskFlags({ amount: -79, counterpart: "SEB", description: "Månadsavgift", known: true }), []);
  });
});

/* --------------------------- Matrisen: bankrader --------------------------- */

describe("Testmatris – tvetydiga bankrader bokförs aldrig automatiskt", () => {
  beforeEach(reset);

  it("McDonald's: restaurang → Osäkert, kvitto-/syftesfråga, aldrig moms från bankraden", () => {
    const t = register({ amount: -129, counterpart: "MCDONALDS 1234 STOCKHOLM", description: "Kortköp" });
    const s = evaluateBankTransaction(t);
    assertNeverAuto(t, s, "McDonald's");
    assert.ok(s.humanRequired.includes("restaurang"));
    assert.equal(s.tier, "osakert");
    assert.notEqual(s.confidence.vat, "hog");
    assert.equal(s.merchant.knowledge?.type, "restaurang");
    // Kortköpet ligger som köp som väntar på kvitto – ingen kostnad ännu.
    const expense = db().expenses.find((e) => e.bankTransactionId === t.id);
    assert.ok(expense);
    assert.equal(expense.status, "saknar_kvitto");
    assert.equal(db().verifications.length, 0);
  });

  it("Shell: drivmedel eller butik eller tvätt eller privat – följdfråga även med kvitto", () => {
    const t = register({ amount: -812, counterpart: "SHELL 7-ELEVEN 4032 UPPSALA", description: "Kortköp" });
    const s = evaluateBankTransaction(t);
    assertNeverAuto(t, s, "Shell");
    assert.ok(s.humanRequired.includes("privat_risk"));
    const expense = db().expenses.find((e) => e.bankTransactionId === t.id)!;
    const { autoBooked } = uploadReceiptForExpense(expense.id, "kvitto.jpg", "uppladdning");
    assert.equal(autoBooked, false, "kvitto räcker inte – syftet avgör");
    assert.equal(expense.status, "behover_svar");
    assert.deepEqual(expense.question?.options, ["Drivmedel", "Butik/förbrukning", "Biltvätt", PRIVATE_ANSWER]);
    answerExpenseQuestion(expense.id, "Drivmedel");
    assert.equal(expense.status, "bokford");
    const ver = db().verifications.find((v) => v.id === expense.verificationId)!;
    assert.ok(ver.entries.some((e) => e.account === 5611 && e.debit > 0));
  });

  it("Circle K: privat-svaret bokför ingen kostnad utan skuld till bolaget", () => {
    const t = register({ amount: -640, counterpart: "CIRCLE K 1187 LINKÖPING", description: "Kortköp" });
    const expense = db().expenses.find((e) => e.bankTransactionId === t.id)!;
    uploadReceiptForExpense(expense.id, "kvitto.jpg", "uppladdning");
    answerExpenseQuestion(expense.id, PRIVATE_ANSWER);
    assert.equal(db().expenses.some((e) => e.id === expense.id), false, "platshållaren är borta");
    assert.equal(t.status, "bokford");
    const ver = db().verifications.find((v) => v.id === t.verificationId)!;
    assert.deepEqual(
      Object.fromEntries(ver.entries.map((e) => [e.account, e.debit - e.credit])),
      { 2893: 640, 1930: -640 },
      "ingen kostnad, ingen moms"
    );
    assert.equal(bankCounterpartRuleFor("CIRCLE K 1187 LINKÖPING"), undefined, "privat lär aldrig en regel");
  });

  it("lokalhyra utan moms: mönster ger förslag på 5010 – men aldrig automatik och aldrig moms", () => {
    const t = register({ amount: -12_000, counterpart: "Fastighets AB Verkstan", description: "Hyra mars" });
    const s = evaluateBankTransaction(t);
    assert.equal(s.payment.bankKind, "lokalhyra");
    assert.equal(s.payment.outcome, "SUGGEST");
    assertNeverAuto(t, s, "hyra");
    assert.equal(s.confidence.vat, "lag", "momsen antas aldrig från bankraden");
    const booked = bookBankTransactionAs(t.id, { kind: "lokalhyra", remember: true });
    const ver = db().verifications.find((v) => v.id === booked.verificationId)!;
    assert.deepEqual(Object.fromEntries(ver.entries.map((e) => [e.account, e.debit - e.credit])), { 5010: 12_000, 1930: -12_000 });
    assert.ok(!ver.entries.some((e) => e.account === 2641), "ingen ingående moms utan hyresavi");
    assert.match(ver.explanation ?? "", /utan moms/u);
  });

  it("lokalhyra med moms: regel + återkommande gör hyran Säker efter två bekräftelser – momsen kräver ändå avi", () => {
    for (const n of [3, 2, 1]) {
      const t = register({ amount: -12_000, counterpart: "Fastighets AB Verkstan", description: "Hyra", date: daysAgo(30 * n) });
      if (t.status !== "bokford") bookBankTransactionAs(t.id, { kind: "lokalhyra", remember: true });
    }
    const next = register({ amount: -12_000, counterpart: "Fastighets AB Verkstan", description: "Hyra" });
    assert.equal(next.status, "bokford", "tredje gången: regeln bokför – hyran är återkommande och känd");
    const s = evaluateBankTransaction({ ...next, status: "ny" });
    assert.ok(s.recurring, "återkommande känns igen");
    assert.equal(s.recurring?.monthly, true);
    assert.equal(s.confidence.vat, "lag", "moms lyfts först med hyresavi som leverantörsfaktura");
    const ver = db().verifications.find((v) => v.id === next.verificationId)!;
    assert.ok(!ver.entries.some((e) => e.account === 2641));
  });

  it("Ahlsell med kvitto: grossist utan privatrisk bokförs när kvittot finns", () => {
    const t = register({ amount: -3_450, counterpart: "AHLSELL SVERIGE AB", description: "Kortköp" });
    const s = evaluateBankTransaction(t);
    assert.deepEqual(s.humanRequired, [], "grossist är känd och riskfri");
    assert.notEqual(t.status, "bokford", "utan kvitto bokförs inget");
    const expense = db().expenses.find((e) => e.bankTransactionId === t.id)!;
    const { autoBooked } = uploadReceiptForExpense(expense.id, "kvitto.jpg", "uppladdning");
    assert.equal(autoBooked, true);
    assert.equal(expense.category, "material");
  });

  it("Byggmax: bygghandel bokförs med kvitto, men aldrig utan", () => {
    const t = register({ amount: -1_899, counterpart: "BYGGMAX 55 TÄBY", description: "Kortköp" });
    assert.notEqual(t.status, "bokford");
    const expense = db().expenses.find((e) => e.bankTransactionId === t.id)!;
    assert.equal(expense.status, "saknar_kvitto");
    assert.equal(db().verifications.length, 0);
    uploadReceiptForExpense(expense.id, "kvitto.jpg", "uppladdning");
    assert.equal(expense.status, "bokford");
  });

  it("försäkring via autogiro: momsfritt mönster → förslag, inte automatik första gången", () => {
    const t = register({ amount: -1_250, counterpart: "Trygg-Hansa", description: "Autogiro företagsförsäkring" });
    const s = evaluateBankTransaction(t);
    assert.equal(s.payment.bankKind, "forsakring");
    assert.equal(s.payment.outcome, "SUGGEST");
    assert.equal(s.confidence.vat, "hog", "försäkring är momsfri – inget att lyfta");
    assertNeverAuto(t, s, "försäkring");
  });

  it("telefoni: teleoperatören är känd men fakturan är underlaget – kortköp väntar på kvitto", () => {
    const t = register({ amount: -449, counterpart: "TELIA SVERIGE AB", description: "Autogiro" });
    assert.notEqual(t.status, "bokford");
    const s = evaluateBankTransaction(t);
    assert.deepEqual(s.humanRequired, []);
    assert.equal(s.merchant.knowledge?.type, "telekom");
    assert.equal(db().verifications.length, 0, "ingen moms utan faktura");
  });

  it("bankavgift från egen bank: den enda deterministiska automatiken – momsfri, känd, liten", () => {
    db().bankConnections = [{ id: "c1", provider: "mock", bankName: "SEB", status: "connected", connectedAt: new Date().toISOString() } as never];
    const t = register({ amount: -79, counterpart: "SEB", description: "Månadsavgift företagspaket" });
    assert.equal(t.status, "bokford");
    const ver = db().verifications.find((v) => v.id === t.verificationId)!;
    assert.deepEqual(Object.fromEntries(ver.entries.map((e) => [e.account, e.debit - e.credit])), { 6570: 79, 1930: -79 });
  });

  it("bankavgift med ovanligt belopp stoppas trots regel", () => {
    for (let i = 0; i < 3; i++) {
      const t = register({ amount: -79, counterpart: "SEB", description: "Månadsavgift", date: daysAgo(30 * (3 - i)) });
      if (t.status !== "bokford") bookBankTransactionAs(t.id, { kind: "bankavgift", remember: true });
    }
    const odd = register({ amount: -6_000, counterpart: "SEB", description: "Månadsavgift" });
    assert.notEqual(odd.status, "bokford", "6 000 kr är inte en månadsavgift på 79 kr");
    const s = evaluateBankTransaction(odd);
    assert.ok(s.humanRequired.includes("ovanligt_belopp"));
    assert.equal(s.tier, "troligt");
  });

  it("Skatteverket: exakt F-skatt bokförs automatiskt, annat belopp bara förslag", () => {
    db().settings.fSkattPerMonth = 4_200;
    const exact = register({ amount: -4_200, counterpart: "Skatteverket", description: "Skattekonto" });
    assert.equal(exact.status, "bokford");
    const other = register({ amount: -9_999, counterpart: "Skatteverket", description: "Skattekonto" });
    assert.notEqual(other.status, "bokford");
    const s = evaluateBankTransaction(other);
    assert.equal(s.payment.bankKind, "skattekonto");
    assert.equal(s.autoAllowed, false);
  });

  it("lön utan lönekörning: REQUIRES_USER – aldrig en ny kostnad från bankraden", () => {
    const t = register({ amount: -24_500, counterpart: "Anna Ek", description: "Lön april" });
    const s = evaluateBankTransaction(t);
    assertNeverAuto(t, s, "lön");
    assert.equal(s.payment.bankKind, "lon");
    assert.equal(s.payment.outcome, "REQUIRES_USER");
    assert.equal(db().verifications.length, 0);
  });

  it("ägarutlägg: överföring till person kräver alltid människa – även med inlärd regel", () => {
    for (let i = 0; i < 3; i++) {
      const t = register({ amount: -1_000, counterpart: "Anna Ek", description: "Överföring utlägg", date: daysAgo(10 * (3 - i)) });
      if (t.status !== "bokford") bookBankTransactionAs(t.id, { kind: "aterbetalning_agare", remember: true });
    }
    assert.ok((bankCounterpartRuleFor("Anna Ek")?.count ?? 0) >= 2, "regeln är inlärd");
    const next = register({ amount: -1_000, counterpart: "Anna Ek", description: "Överföring utlägg" });
    assert.notEqual(next.status, "bokford", "överföring till person bokförs aldrig automatiskt");
    const s = evaluateBankTransaction(next);
    assert.ok(s.humanRequired.includes("overforing_till_person"));
    assert.equal(s.tier, "osakert");
    assert.ok(s.choices.length >= 2 && s.choices.length <= 4);
    assert.ok(s.choices.some((c) => c.kind === "privat"));
    assert.match(s.payment.reason, /kräver ditt beslut/u);
  });

  it("intern överföring till eget konto: mönster → förslag utan kostnad", () => {
    const t = register({ amount: -20_000, counterpart: "Eget sparkonto", description: "Överföring sparkonto" });
    const s = evaluateBankTransaction(t);
    assert.equal(s.payment.bankKind, "overforing_eget_konto");
    assertNeverAuto(t, s, "intern överföring");
    const booked = bookBankTransactionAs(t.id, { kind: "overforing_eget_konto" });
    const ver = db().verifications.find((v) => v.id === booked.verificationId)!;
    assert.deepEqual(Object.fromEntries(ver.entries.map((e) => [e.account, e.debit - e.credit])), { 1940: 20_000, 1930: -20_000 });
  });

  it("privatköp (Elgiganten): privatrisk – följdfråga, kvittot bokför inte självt", () => {
    const t = register({ amount: -8_990, counterpart: "ELGIGANTEN 2201 KUNGENS KURVA", description: "Kortköp" });
    const s = evaluateBankTransaction(t);
    assert.ok(s.humanRequired.includes("privat_risk"));
    const expense = db().expenses.find((e) => e.bankTransactionId === t.id)!;
    const { autoBooked } = uploadReceiptForExpense(expense.id, "kvitto.jpg", "uppladdning");
    assert.equal(autoBooked, false);
    assert.equal(expense.status, "behover_svar");
    assert.ok(expense.question?.options.includes(PRIVATE_ANSWER) || expense.question?.options.includes("Registrera som inventarie"));
  });

  it("kontantuttag: ingen kostnad, ingen moms, 2–4 val utan förvald bokning", () => {
    const t = register({ amount: -2_000, counterpart: "Uttag Bankomat 4411", description: "Kontantuttag" });
    const s = evaluateBankTransaction(t);
    assertNeverAuto(t, s, "kontantuttag");
    assert.ok(s.humanRequired.includes("kontantuttag"));
    assert.equal(s.tier, "osakert");
    assert.ok(s.choices.length >= 2 && s.choices.length <= 4, `${s.choices.length} val`);
    assert.ok(s.choices.some((c) => c.kind === "privat"));
    assert.equal(db().verifications.length, 0);
    // Beslutskortet visar inte en förvald bokning för Osäkert.
    const card = decisionCards(getBusinessActions().attention).find((c) => c.id === `bank-${t.id}`);
    assert.ok(card);
    assert.notEqual(card.action.cta?.type, "bookBankKind");
    assert.match(card.uncertainty ?? "", /kontantuttag/iu);
  });

  it("återbetalning från leverantör (inbetalning utan faktura): aldrig intäkt automatiskt", () => {
    const t = register({ amount: 1_299, counterpart: "BYGGMAX 55 TÄBY", description: "Retur" });
    assert.notEqual(t.status, "bokford");
    const s = evaluateBankTransaction(t);
    assert.equal(s.autoAllowed, false);
    assert.equal(s.tier, "osakert");
    assert.ok(s.choices.length >= 2);
  });

  it("kredit/lån utbetalt: mönster → förslag på skuld, inte intäkt", () => {
    const t = register({ amount: 150_000, counterpart: "SEB Företagslån", description: "Utbetalning lån" });
    const s = evaluateBankTransaction(t);
    assert.equal(s.payment.bankKind, "lan_utbetalt");
    assertNeverAuto(t, s, "lån");
  });

  it("utländsk motpart: utland-flaggan stoppar automatik och moms", () => {
    const t = register({ amount: -890, counterpart: "AMAZON.DE", description: "Kortköp 79,90 EUR" });
    const s = evaluateBankTransaction(t);
    assertNeverAuto(t, s, "utland");
    assert.ok(s.humanRequired.includes("utland"));
    assert.equal(s.tier, "osakert");
  });

  it("falsk positiv i motpartsnamn: Shellac Nails behandlas som okänd mottagare, inte drivmedel", () => {
    const t = register({ amount: -450, counterpart: "SHELLAC NAILS STHLM", description: "Kortköp" });
    const s = evaluateBankTransaction(t);
    assert.equal(s.merchant.knowledge, undefined);
    assert.ok(s.humanRequired.includes("okand_mottagare"));
    assertNeverAuto(t, s, "Shellac");
    const expense = db().expenses.find((e) => e.bankTransactionId === t.id)!;
    uploadReceiptForExpense(expense.id, "kvitto.jpg", "uppladdning");
    assert.equal(expense.status, "behover_svar", "okänd motpart → fråga, ingen gissning bokförs");
    assert.ok(expense.question?.options.includes(PRIVATE_ANSWER));
  });

  it("inget mönster matchar 'Hyrbil' som hyra", () => {
    assert.notEqual(bankKindByPattern({ amount: -2_400, counterpart: "Hertz Hyrbil", description: "Kortköp" })?.key, "lokalhyra");
  });
});

/* ---------------------------- Regler & versioner ---------------------------- */

describe("Regler: versionering och explicit inlärning", () => {
  beforeEach(reset);

  it("byte av typ räknar upp regelversionen; samma val ökar bara räknaren", () => {
    const a = register({ amount: -300, counterpart: "Okänd Tjänst AB", description: "Autogiro" });
    bookBankTransactionAs(a.id, { kind: "forsakring", remember: true });
    assert.equal(bankCounterpartRuleFor("Okänd Tjänst AB")?.version, 1);
    const b = register({ amount: -300, counterpart: "Okänd Tjänst AB", description: "Autogiro" });
    assert.equal(b.status, "behover_atgard", "en bekräftelse räcker inte för automatik");
    bookBankTransactionAs(b.id, { kind: "bankavgift", remember: true });
    assert.equal(bankCounterpartRuleFor("Okänd Tjänst AB")?.version, 2, "byte av typ → ny version");
    assert.equal(bankCounterpartRuleFor("Okänd Tjänst AB")?.count, 1, "nytt val börjar om");
    const c = register({ amount: -300, counterpart: "Okänd Tjänst AB", description: "Autogiro" });
    bookBankTransactionAs(c.id, { kind: "bankavgift", remember: true });
    assert.equal(bankCounterpartRuleFor("Okänd Tjänst AB")?.version, 2, "samma val behåller versionen");
    assert.equal(bankCounterpartRuleFor("Okänd Tjänst AB")?.count, 2);
    const d = register({ amount: -300, counterpart: "Okänd Tjänst AB", description: "Autogiro" });
    assert.equal(d.status, "bokford", "känd motpart utan risk: regeln bokför från andra bekräftelsen");
    assert.equal(evaluateBankTransaction({ ...d, status: "ny" }).ruleVersion, 2);
  });

  it("leverantörsregler versioneras på samma sätt", () => {
    recordMerchantRule("Snickarboa AB", "material");
    recordMerchantRule("Snickarboa AB", "material");
    assert.equal(db().meta.merchantCategoryRules?.["snickarboa"]?.version, 1);
    recordMerchantRule("Snickarboa AB", "verktyg");
    assert.equal(db().meta.merchantCategoryRules?.["snickarboa"]?.version, 2);
  });

  it("'Använd samma val nästa gång?' = nej → ingen regel sparas", () => {
    const t = register({ amount: -812, counterpart: "SHELL 4032", description: "Kortköp" });
    const expense = db().expenses.find((e) => e.bankTransactionId === t.id)!;
    uploadReceiptForExpense(expense.id, "kvitto.jpg", "uppladdning");
    answerExpenseQuestion(expense.id, "Drivmedel", "anvandare", { remember: false });
    assert.equal(expense.status, "bokford");
    assert.equal(db().meta.merchantCategoryRules?.["shell"], undefined);
  });

  it("två bekräftade svar för en riskmotpart gör nästa kvitto automatiskt – företagets egen regel vinner", () => {
    for (let i = 0; i < 2; i++) {
      const t = register({ amount: -700 + i, counterpart: "SHELL 4032", description: "Kortköp" });
      const expense = db().expenses.find((e) => e.bankTransactionId === t.id)!;
      uploadReceiptForExpense(expense.id, "kvitto.jpg", "uppladdning");
      answerExpenseQuestion(expense.id, "Drivmedel");
    }
    const t = register({ amount: -650, counterpart: "SHELL 4032", description: "Kortköp" });
    const expense = db().expenses.find((e) => e.bankTransactionId === t.id)!;
    const { autoBooked } = uploadReceiptForExpense(expense.id, "kvitto.jpg", "uppladdning");
    assert.equal(autoBooked, true);
    assert.equal(expense.category, "drivmedel");
  });
});

/* ------------------------------ Beslutslogg ------------------------------ */

describe("Beslutslogg utan känsligt innehåll", () => {
  it("händelsen innehåller varken motpart, belopp eller personnummer", () => {
    const event = buildSuggestionEvent({
      input: { amount: -129, counterpart: "MCDONALDS 1234 Anna 19850101-1234", date: `${TODAY}T09:00:00.000Z` },
      direction: "ut",
      source: "kunskapsbas",
      tier: "osakert",
      decision: "private",
      humanRequired: ["restaurang"],
      merchantType: "restaurang",
      finalChoice: "privat_kop",
      llm: null,
    });
    const json = JSON.stringify(event);
    assert.doesNotMatch(json, /mcdonald/iu);
    assert.doesNotMatch(json, /19850101/u);
    assert.doesNotMatch(json, /129/u);
    assert.equal(event.amountBucket, "under_500");
    assert.equal(event.kbVersion, MERCHANT_KB_VERSION);
    assert.equal(event.provider, null);
    assert.equal(event.inputHash.length, 32);
  });

  it("hashen är stabil för samma rad och olika för andra", () => {
    const a = suggestionInputHash({ amount: -129, counterpart: "MCDONALDS 1234", date: "2026-03-01" });
    const b = suggestionInputHash({ amount: -129, counterpart: "McDonald's 5678 GBG", date: "2026-03-01T10:00:00Z" });
    const c = suggestionInputHash({ amount: -130, counterpart: "MCDONALDS 1234", date: "2026-03-01" });
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it("beslutsklassning och beloppsspann", () => {
    assert.equal(classifyDecision("bankavgift", "bankavgift"), "accepted");
    assert.equal(classifyDecision("bankavgift", "forsakring"), "changed");
    assert.equal(classifyDecision("bankavgift", "privat_kop"), "private");
    assert.equal(classifyDecision(undefined, "forsakring"), "accepted");
    assert.equal(amountBucket(-499), "under_500");
    assert.equal(amountBucket(5_000), "500_5000");
    assert.equal(amountBucket(-5_001), "over_5000");
  });

  it("kvalitetsrapporten räknar falskt positiva per källa och nivå", () => {
    const base: Omit<SuggestionEvent, "id" | "decision" | "tier" | "source"> = {
      createdAt: new Date().toISOString(),
      direction: "ut",
      humanRequired: [],
      kbVersion: MERCHANT_KB_VERSION,
      provider: null,
      model: null,
      promptVersion: null,
      inputHash: "x",
      finalChoice: "bankavgift",
      amountBucket: "under_500",
    };
    const events: SuggestionEvent[] = [
      { ...base, id: "1", decision: "auto", tier: "saker", source: "regel" },
      { ...base, id: "2", decision: "accepted", tier: "troligt", source: "monster" },
      { ...base, id: "3", decision: "changed", tier: "troligt", source: "monster" },
      { ...base, id: "4", decision: "private", tier: "osakert", source: "kunskapsbas", humanRequired: ["restaurang"] },
      { ...base, id: "5", decision: "accepted", tier: "saker", source: "regel" },
    ];
    const r = suggestionQualityReport(events, 30);
    assert.equal(r.overall.total, 5);
    assert.equal(r.overall.auto, 1);
    // Mänskliga beslut på Säker/Troligt: 2, 3, 5 → ett ändrat av tre.
    assert.ok(Math.abs((r.overall.falsePositiveRate ?? 0) - 1 / 3) < 1e-9);
    assert.equal(r.byTier.osakert.falsePositiveRate, null, "Osäkert har inget förslag att vara fel");
    assert.equal(r.bySource.find((s) => s.source === "monster")?.counts.falsePositiveRate, 0.5);
    assert.deepEqual(r.humanRequired, [{ flag: "restaurang", count: 1 }]);
    assert.equal(r.llm.withoutLlm, 5);
  });
});

describe("Återkommande betalningar", () => {
  beforeEach(reset);

  it("kräver minst två tidigare bokförda från samma motpart", () => {
    const first = register({ amount: -12_000, counterpart: "Fastighets AB Verkstan", description: "Hyra", date: daysAgo(60) });
    bookBankTransactionAs(first.id, { kind: "lokalhyra" });
    const next = register({ amount: -12_000, counterpart: "Fastighets AB Verkstan", description: "Hyra" });
    assert.equal(recurringPatternFor(next), undefined);
  });
});
