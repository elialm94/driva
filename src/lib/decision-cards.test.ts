process.env.DRIVA_TEST = "1";

/**
 * Enkel bokföring som arbetskö: åtgärdsmotorns rader projiceras till
 * beslutskort med vardagsspråk, prioriteras (deadline → belopp → underlag →
 * resten), grupperas när de är identiska och får ett explicit "Privat"-svar
 * där det är meningsfullt. Privat-vägen bokför aldrig en kostnad.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { uid } from "./ids";
import type { BankAccount, BankTransaction } from "./types";
import type { BusinessAction } from "./services/actions";
import { getBusinessActions } from "./services/actions";
import { registerBankTransactions } from "./services/banking";
import { markExpensePrivate } from "./services/bank-booking";
import {
  decisionCards,
  decisionCopy,
  decisionTier,
  privateDecisionFor,
  recurringKey,
  SIMPLE_QUEUE_INITIAL,
  simpleQueueState,
} from "./services/decision-cards";
import { bankKindByKey } from "./banking/bank-kinds";

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

function register(over: Partial<BankTransaction> & { amount: number; counterpart: string }): BankTransaction {
  const t: BankTransaction = {
    id: uid(),
    accountId: "acc-1",
    externalId: `ext-${uid()}`,
    date: `${TODAY}T09:00:00.000Z`,
    description: "",
    status: "ny",
    ...over,
  };
  registerBankTransactions([t]);
  return db().bankTransactions.find((x) => x.id === t.id)!;
}

function action(over: Partial<BusinessAction> & { id: string }): BusinessAction {
  return {
    priority: "action",
    category: "accounting",
    icon: "bank",
    title: over.id,
    subtitle: "",
    href: "/bokforing",
    ...over,
  };
}

const JARGON = /\b(debet|kredit|verifikationsserie|BAS-konto|\b[1-8]\d{3}\b)/iu;

describe("Beslutskort – prioritering och språk", () => {
  it("nivån följer spec: deadline → stort belopp → blockerande underlag → resten", () => {
    assert.equal(decisionTier(action({ id: "vat-2025-Q1", category: "vat", dueDate: `${YEAR}-05-12` })), "deadline");
    assert.equal(decisionTier(action({ id: "period-close-2025-01" })), "deadline");
    assert.equal(decisionTier(action({ id: "bank-1", amount: 12_000 })), "belopp");
    assert.equal(decisionTier(action({ id: "receipt-1", amount: 250, cta: { type: "uploadReceipt", label: "Ladda upp", expenseId: "e1" } })), "underlag");
    assert.equal(decisionTier(action({ id: "bank-2", amount: 250 })), "ovrigt");
  });

  it("korten sorteras deadline först (närmast först), sedan belopp fallande", () => {
    const cards = decisionCards([
      action({ id: "bank-small", amount: 100, title: "Bokför Shell 100 kr som bankavgift?", cta: { type: "bookBankKind", label: "Bokför", txId: "t1", bankKind: "bankavgift" } }),
      action({ id: "vat-late", category: "vat", dueDate: `${YEAR}-06-12`, title: "Momsen för april är redo" }),
      action({ id: "bank-big", amount: 25_000, title: "Bokför Hyresvärden 25 000 kr som lokalhyra?", cta: { type: "bookBankKind", label: "Bokför", txId: "t2", bankKind: "annat" } }),
      action({ id: "vat-soon", category: "vat", dueDate: `${YEAR}-02-12`, title: "Momsen för januari är redo" }),
      action({ id: "receipt-1", amount: 250, cta: { type: "uploadReceipt", label: "Ladda upp", expenseId: "e1" } }),
    ]);
    assert.deepEqual(
      cards.map((c) => c.id),
      ["vat-soon", "vat-late", "bank-big", "receipt-1", "bank-small"]
    );
  });

  it("bara bokföringsrader blir kort – fakturor, offerter och påminnelser hör inte hit", () => {
    const cards = decisionCards([
      action({ id: "invoice-1", category: "invoices" as BusinessAction["category"] }),
      action({ id: "bank-1", category: "accounting" }),
    ]);
    assert.deepEqual(cards.map((c) => c.id), ["bank-1"]);
  });

  it("frågan är ett vardagsbeslut utan konton eller debet/kredit", () => {
    const question = decisionCopy(
      action({
        id: "question-e1",
        title: "Vad var köpet hos Shell?",
        subtitle: "Shell · 640 kr · 3 mars",
        amount: 640,
        cta: { type: "answerQuestion", expenseId: "e1", options: ["Drivmedel", "Verktyg", "Annat"] },
      })
    );
    assert.ok(question.question.endsWith("?"));
    assert.equal(question.suggestion, "Drivmedel");
    assert.ok(question.uncertainty, "osäkerheten sägs rakt ut");
    assert.equal(question.privateChoice, true);
    assert.ok(question.howBooked, "'Så bokförs det' finns bakom expandern");
    for (const text of [question.question, question.happened, question.suggestion ?? "", question.why ?? ""]) {
      assert.doesNotMatch(text, JARGON, text);
    }

    const receipt = decisionCopy(
      action({ id: "receipt-e2", title: "Kvitto saknas – McDonald's, 129 kr", subtitle: "McDonald's · 129 kr", amount: 129, cta: { type: "uploadReceipt", label: "Ladda upp kvitto", expenseId: "e2" } })
    );
    assert.equal(receipt.question, "Lägg till kvittot för McDonald's");

    const rent = decisionCopy(
      action({
        id: "bank-t3",
        title: "Bokför Hyresvärden AB 12 500 kr som överföring till eget konto?",
        subtitle: "1 mars · Mönster i beskrivningen",
        amount: 12_500,
        cta: { type: "bookBankKind", label: "Bokför som överföring", txId: "t3", bankKind: "overforing_eget_konto" },
      })
    );
    assert.equal(rent.question, "Godkänn att Hyresvärden AB bokförs som överföring till eget konto?");
    assert.equal(rent.why, "Mönster i beskrivningen");
    assert.equal(rent.privateChoice, true, "utgående bankförslag har ett privat-svar");

    const vat = decisionCopy(action({ id: "vat-q1", category: "vat", title: "Momsdeklaration januari–mars", subtitle: "januari–mars · 4 200 kr att betala", dueDate: `${YEAR}-05-12` }));
    assert.equal(vat.question, "Momsen för januari–mars är redo att lämnas in");
  });

  it("identiska återkommande banktransaktioner grupperas till ett kort med 'Godkänn alla'", () => {
    const mk = (n: number) =>
      action({
        id: `bank-t${n}`,
        title: "Bokför SEB 79 kr som bankavgift?",
        subtitle: `${n} mars · Mönster`,
        amount: 79,
        cta: { type: "bookBankKind", label: "Bokför som bankavgift", txId: `t${n}`, bankKind: "bankavgift" },
      });
    const cards = decisionCards([mk(1), mk(2), mk(3), action({ id: "bank-x", title: "Bokför Almi 4 500 kr som amortering?", amount: 4_500, cta: { type: "bookBankKind", label: "Bokför", txId: "x", bankKind: "amortering" } })]);
    assert.equal(cards.length, 2);
    const group = cards.find((c) => c.id === "bank-t1")!;
    assert.equal(group.group?.count, 3);
    assert.match(group.question, /^3 transaktioner ser likadana ut/u);
    assert.match(group.happened, /totalt 237\s?kr/u);
    assert.equal(group.privateDecision, undefined, "privat är ett beslut per transaktion");
    assert.equal(recurringKey(mk(1)), "seb|bankavgift");
  });

  it("privat-svaret pekar på rätt sak: köpet eller banktransaktionen", () => {
    const expense = action({ id: "question-e1", cta: { type: "answerQuestion", expenseId: "e1", options: ["Verktyg"] } });
    assert.deepEqual(privateDecisionFor(expense, decisionCopy(expense)), { kind: "expense", expenseId: "e1" });

    const bank = action({ id: "bank-t9", title: "Bokför ICA 340 kr som bankavgift?", cta: { type: "bookBankKind", label: "Bokför", txId: "t9", bankKind: "bankavgift" } });
    assert.deepEqual(privateDecisionFor(bank, decisionCopy(bank)), { kind: "bank", txId: "t9" });

    const unknown = action({ id: "bank-t10", title: "Utbetalning till Okänd AB – vad är det?", subtitle: "1 500 kr · 2 mars", cta: { type: "link", label: "Välj typ", href: "/bokforing/bank?tx=t10" } });
    assert.deepEqual(privateDecisionFor(unknown, decisionCopy(unknown)), { kind: "bank", txId: "t10" });

    const incoming = action({ id: "bank-t11", title: "Bokför Kund AB 5 000 kr som ägarens insättning?", cta: { type: "bookBankKind", label: "Bokför", txId: "t11", bankKind: "agartillskott" } });
    assert.equal(privateDecisionFor(incoming, decisionCopy(incoming)), undefined, "inbetalningar har inget privat-svar");

    const vat = action({ id: "vat-q1", category: "vat" });
    assert.equal(privateDecisionFor(vat, decisionCopy(vat)), undefined);
  });

  it("överst visas exakt ett tillstånd", () => {
    assert.equal(SIMPLE_QUEUE_INITIAL, 5);
    const behover = simpleQueueState({ cards: [{ question: "Var köpet på Shell till företaget?" }, { question: "x" }] });
    assert.equal(behover.kind, "behover");
    assert.equal(behover.title, "2 saker behöver dig");
    assert.equal(behover.text, "Var köpet på Shell till företaget?");

    const arbetar = simpleQueueState({ cards: [], working: { documents: 0, bankSyncing: true } });
    assert.equal(arbetar.kind, "arbetar");

    const klart = simpleQueueState({ cards: [], nextDeadline: { label: "Momsdeklaration", date: `${YEAR}-05-12` } });
    assert.equal(klart.kind, "klart");
    assert.match(klart.text, /Nästa deadline: Momsdeklaration/u);
  });
});

describe("Privat / gäller inte företaget", () => {
  beforeEach(reset);

  it("kortköp från företagskontot: platshållaren tas bort och ägaren blir skyldig bolaget (2893) – ingen kostnad, ingen moms", () => {
    const t = register({ amount: -1_250, counterpart: "Systembolaget", description: "Kortköp" });
    const expense = db().expenses.find((e) => e.bankTransactionId === t.id);
    assert.ok(expense, "kortköpsflödet skapade ett köp som väntar på kvitto");

    const result = markExpensePrivate(expense.id);
    assert.ok(result.verificationId);
    const ver = db().verifications.find((v) => v.id === result.verificationId)!;
    const byAccount = Object.fromEntries(ver.entries.map((e) => [e.account, e.debit - e.credit]));
    assert.equal(byAccount[2893], 1_250);
    assert.equal(byAccount[1930], -1_250);
    assert.ok(!ver.entries.some((e) => e.account >= 4000 && e.account < 8000), "ingen kostnad");
    assert.ok(!ver.entries.some((e) => e.account === 2640), "ingen ingående moms");
    assert.equal(db().expenses.some((e) => e.id === expense.id), false, "köpet är borta ur kön");
    assert.equal(t.status, "bokford");
    assert.equal(db().meta.bankCounterpartRules?.["systembolaget"], undefined, "privat lärs aldrig in som regel");
    assert.ok(db().auditTrail.some((a) => a.action === "banktransaktion_bokford" && a.targetId === t.id));
    assert.equal(getBusinessActions().attention.some((a) => a.id === `bank-${t.id}`), false, "raden är löst");
  });

  it("privat köp är aldrig inlärbart och bara för utbetalningar", () => {
    const def = bankKindByKey("privat_kop")!;
    assert.equal(def.learnable, false);
    assert.equal(def.direction, "ut");
  });

  it("ett redan bokfört köp kan inte markeras privat här – rättas via verifikationen", () => {
    db().expenses.push({
      id: "e-booked",
      supplier: "Bauhaus",
      amount: 900,
      date: TODAY,
      status: "bokford",
      category: "verktyg",
      createdAt: new Date().toISOString(),
    } as never);
    assert.throws(() => markExpensePrivate("e-booked"), /redan bokfört/u);
  });
});
