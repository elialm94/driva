process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb } from "../invoices/test-db";
import { postVerification } from "./engine";
import { auditTrail } from "./audit";
import { vatPeriods } from "./vat";
import { bookVatOnTaxAccount, setTaxAccountOcr, SKATTEKONTO } from "./tax-account";
import { declareVatPeriod, taxAccountTransfersSince, vatFlowFocus, vatPeriodFlow, SKATTEVERKET_BANKGIRO } from "./vat-flow";
import { bankgirotModulus10CheckDigit } from "../ids";

/**
 * Momsen i tre steg. Testerna håller fast att steget alltid följer av
 * bokföringen: blockerare i checklistan håller perioden i steg 1, en ren
 * period står i steg 2, en deklarerad i steg 3 tills momsen är bokförd på
 * skattekontot – och att ordningen mellan perioder syns innan man klickar.
 */

const THIS_YEAR = Number(new Date().toISOString().slice(0, 4));
/** Ett år vars kvartal alla är slut, oavsett när testet körs. */
const YEAR = THIS_YEAR - 1;
const TODAY = `${THIS_YEAR}-01-20`;

function reset() {
  replaceDb(emptyTestDb());
}

function bookSales(date: string, net: number, vat: number) {
  postVerification({
    date,
    description: "Försäljning",
    entries: [
      { account: 1930, debit: net + vat },
      { account: 3001, credit: net },
      { account: 2611, credit: vat },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

function bookPurchase(date: string, net: number, vat: number) {
  postVerification({
    date,
    description: "Inköp",
    entries: [
      { account: 4010, debit: net },
      { account: 2641, debit: vat },
      { account: 1930, credit: net + vat },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

function transferToTaxAccount(date: string, amount: number) {
  return postVerification({
    date,
    description: "Till skattekontot",
    entries: [
      { account: SKATTEKONTO, debit: amount },
      { account: 1930, credit: amount },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

function quarter(key: string) {
  const summary = vatPeriods(YEAR).find((p) => p.period.key === `${YEAR}-${key}`);
  assert.ok(summary, `perioden ${YEAR}-${key} finns`);
  return summary;
}

function statuses(flow: ReturnType<typeof vatPeriodFlow>) {
  return flow.steps.map((s) => `${s.key}:${s.status}`);
}

describe("steg 1 – kontrollera", () => {
  beforeEach(reset);

  it("en obokförd banktransaktion håller perioden i steg 1 med länkbar blockerare", () => {
    bookSales(`${YEAR}-02-10`, 10_000, 2_500);
    db().bankTransactions.push({
      id: "tx-1",
      date: `${YEAR}-03-05`,
      amount: -1_200,
      description: "BAUHAUS",
      status: "ny",
    } as never);

    const flow = vatPeriodFlow(quarter("K1"), TODAY);
    assert.equal(flow.current, "kontrollera");
    assert.deepEqual(statuses(flow), ["kontrollera:nu", "deklarera:vantar", "betala:vantar"]);
    const bank = flow.blockers.find((b) => b.key === "bank");
    assert.ok(bank, "banken är blockeraren");
    assert.match(flow.steps[0].summary, /1 banktransaktion väntar/);
    assert.equal(flow.done, false);
  });

  it("perioderna tas i ordning – en odeklarerad tidigare period syns som blockerare", () => {
    bookSales(`${YEAR}-02-10`, 10_000, 2_500);
    bookSales(`${YEAR}-05-10`, 4_000, 1_000);

    const k2 = vatPeriodFlow(quarter("K2"), TODAY);
    assert.equal(k2.current, "kontrollera");
    assert.deepEqual(
      k2.earlierUndeclared.map((p) => p.key),
      [`${YEAR}-K1`]
    );
    const ordning = k2.checklist.find((c) => c.key === "ordning");
    assert.ok(ordning && !ordning.ok);
    assert.match(ordning.detail ?? "", new RegExp(quarter("K1").period.label));
    assert.equal(k2.earlierUndeclared[0].fiscalYearLabel, String(YEAR));

    // Första perioden har inget före sig och står redo i steg 2.
    const k1 = vatPeriodFlow(quarter("K1"), TODAY);
    assert.equal(k1.current, "deklarera");
    assert.equal(k1.checklist.find((c) => c.key === "ordning")?.ok, true);
  });

  it("en period utan momsaktivitet före stoppar inte ordningen", () => {
    bookSales(`${YEAR}-05-10`, 4_000, 1_000);
    const k2 = vatPeriodFlow(quarter("K2"), TODAY);
    assert.equal(k2.earlierUndeclared.length, 0);
    assert.equal(k2.current, "deklarera");
  });

  it("en pågående period visar löpande läge utan checklista", () => {
    const running = vatPeriods(THIS_YEAR).find((p) => p.state === "pagaende");
    assert.ok(running, "det finns alltid en pågående period i år");
    const flow = vatPeriodFlow(running);
    assert.equal(flow.current, null);
    assert.equal(flow.done, false);
    assert.deepEqual(statuses(flow), ["kontrollera:pagaende", "deklarera:vantar", "betala:vantar"]);
    assert.equal(flow.checklist.length, 0);
  });
});

describe("steg 2 – deklarera", () => {
  beforeEach(reset);

  it("en ren period står i steg 2 med rutorna som ska fyllas i", () => {
    bookSales(`${YEAR}-02-10`, 10_000, 2_500);
    bookPurchase(`${YEAR}-02-20`, 2_000, 500);

    const flow = vatPeriodFlow(quarter("K1"), TODAY);
    assert.equal(flow.current, "deklarera");
    assert.deepEqual(statuses(flow), ["kontrollera:klar", "deklarera:nu", "betala:vantar"]);
    const codes = flow.boxesToFill.map((b) => b.code);
    assert.ok(codes.includes("49"), "ruta 49 är alltid med");
    assert.ok(codes.includes("05"), "försäljningen (ruta 05) är med");
    assert.ok(codes.includes("48"), "ingående momsen (ruta 48) är med");
    assert.ok(!flow.boxesToFill.some((b) => b.amount === 0 && b.code !== "49"), "tomma rutor visas inte");
    assert.equal(flow.payment.direction, "betala");
    assert.equal(flow.payment.amount, 2_000);
    assert.equal(flow.payment.bankgiro, SKATTEVERKET_BANKGIRO);
    assert.equal(flow.payment.dueDate, `${YEAR}-05-12`);
    assert.match(flow.steps[1].summary, /senast/);
  });

  it("dagar kvar räknas mot förfallodagen och blir negativa efteråt", () => {
    bookSales(`${YEAR}-02-10`, 10_000, 2_500);
    const due = `${YEAR}-05-12`;
    assert.equal(vatPeriodFlow(quarter("K1"), due).payment.daysLeft, 0);
    assert.equal(vatPeriodFlow(quarter("K1"), `${YEAR}-05-02`).payment.daysLeft, 10);
    assert.ok(vatPeriodFlow(quarter("K1"), TODAY).payment.daysLeft < 0);
  });

  it("declareVatPeriod skapar rapporten och markerar den deklarerad i ett steg", () => {
    bookSales(`${YEAR}-02-10`, 10_000, 2_500);
    const report = declareVatPeriod(`${YEAR}-K1`, "anvandare");
    assert.equal(report.status, "deklarerad");
    assert.equal(report.attBetala, 2_500);

    const flow = vatPeriodFlow(quarter("K1"), TODAY);
    assert.equal(flow.summary.state, "deklarerad");
    assert.equal(flow.current, "betala");
    assert.deepEqual(statuses(flow), ["kontrollera:klar", "deklarera:klar", "betala:nu"]);
    assert.match(flow.steps[1].summary, /^Deklarerad \d{1,2} \S+ \d{4}\./);
    assert.equal(flow.done, false);
    assert.equal(flow.checklist.length, 0, "checklistan behövs inte längre");
  });

  it("declareVatPeriod stoppas av samma spärrar som checklistan visar", () => {
    bookSales(`${YEAR}-02-10`, 10_000, 2_500);
    bookSales(`${YEAR}-05-10`, 4_000, 1_000);
    assert.throws(() => declareVatPeriod(`${YEAR}-K2`, "anvandare"), /i ordning/);
    assert.equal(db().vatReports.find((r) => r.periodStart === `${YEAR}-04-01`)?.status, "utkast");
  });
});

describe("steg 3 – betala", () => {
  beforeEach(reset);

  it("bokförd moms på skattekontot avslutar flödet", () => {
    bookSales(`${YEAR}-02-10`, 10_000, 2_500);
    const report = declareVatPeriod(`${YEAR}-K1`, "anvandare");
    const ver = bookVatOnTaxAccount(report.id, "anvandare");

    const flow = vatPeriodFlow(quarter("K1"), TODAY);
    assert.equal(flow.payment.bookedOnTaxAccount?.verificationId, ver.id);
    assert.equal(flow.current, null);
    assert.equal(flow.done, true);
    assert.deepEqual(statuses(flow), ["kontrollera:klar", "deklarera:klar", "betala:klar"]);
    assert.match(flow.steps[2].summary, /bokfört på skattekontot/);
  });

  it("en överföring till skattekontot efter periodens slut som täcker momsen syns som ledtråd", () => {
    bookSales(`${YEAR}-02-10`, 10_000, 2_500);
    transferToTaxAccount(`${YEAR}-03-20`, 9_000); // före periodens slut – räknas inte
    declareVatPeriod(`${YEAR}-K1`, "anvandare");
    transferToTaxAccount(`${YEAR}-04-15`, 1_000); // för liten
    const covering = transferToTaxAccount(`${YEAR}-05-10`, 2_500);

    const since = taxAccountTransfersSince(`${YEAR}-03-31`);
    assert.deepEqual(
      since.map((t) => t.amount),
      [1_000, 2_500]
    );
    const flow = vatPeriodFlow(quarter("K1"), TODAY);
    assert.equal(flow.payment.transferSeen?.verificationId, covering.id);
    assert.equal(flow.payment.bookedOnTaxAccount, undefined);
    assert.equal(flow.current, "betala", "överföringen är en ledtråd, inte ett bokfört steg");
  });

  it("moms att få tillbaka byter riktning och avslutas när tillgodohavandet bokförs", () => {
    bookPurchase(`${YEAR}-02-20`, 20_000, 5_000);
    bookSales(`${YEAR}-02-10`, 4_000, 1_000);
    const before = vatPeriodFlow(quarter("K1"), TODAY);
    assert.equal(before.payment.direction, "tillbaka");
    assert.equal(before.payment.amount, 4_000);

    const report = declareVatPeriod(`${YEAR}-K1`, "anvandare");
    const declared = vatPeriodFlow(quarter("K1"), TODAY);
    assert.equal(declared.current, "betala");
    assert.match(declared.steps[2].summary, /att få tillbaka/);
    assert.equal(declared.payment.transferSeen, undefined, "ingen betalning väntas från bolaget");

    bookVatOnTaxAccount(report.id, "anvandare");
    const after = vatPeriodFlow(quarter("K1"), TODAY);
    assert.equal(after.done, true);
    assert.match(after.steps[2].summary, /tillgodofördes skattekontot/);
  });

  it("noll i moms är klart så snart perioden är deklarerad", () => {
    bookSales(`${YEAR}-02-10`, 10_000, 0);
    const pending = vatPeriodFlow(quarter("K1"), TODAY);
    assert.equal(pending.current, "deklarera", "även noll ska deklareras");
    assert.equal(pending.payment.direction, "noll");
    declareVatPeriod(`${YEAR}-K1`, "anvandare");
    const flow = vatPeriodFlow(quarter("K1"), TODAY);
    assert.equal(flow.done, true);
    assert.equal(flow.steps[2].summary, "Ingen moms att betala för perioden.");
  });

  it("det sparade OCR-numret följer med i betalsteget", () => {
    bookSales(`${YEAR}-02-10`, 10_000, 2_500);
    assert.equal(vatPeriodFlow(quarter("K1"), TODAY).payment.ocr, undefined);
    const ocr = "5591234567" + bankgirotModulus10CheckDigit("5591234567");
    setTaxAccountOcr(ocr, "anvandare");
    assert.equal(vatPeriodFlow(quarter("K1"), TODAY).payment.ocr, ocr);
  });
});

describe("fokus på sidan", () => {
  beforeEach(reset);

  it("öppnar den period som väntar på användaren, annars den som pågår", () => {
    bookSales(`${YEAR}-02-10`, 10_000, 2_500);
    bookSales(`${YEAR}-05-10`, 4_000, 1_000);
    const flows = vatPeriods(YEAR).map((p) => vatPeriodFlow(p, TODAY));
    assert.equal(vatFlowFocus(flows), `${YEAR}-K1`, "K1 ska deklareras först");

    declareVatPeriod(`${YEAR}-K1`, "anvandare");
    const afterK1 = vatPeriods(YEAR).map((p) => vatPeriodFlow(p, TODAY));
    assert.equal(vatFlowFocus(afterK1), `${YEAR}-K1`, "K1 är deklarerad men inte betald – den står kvar först");

    const thisYear = vatPeriods(THIS_YEAR)
      .filter((p) => p.state === "pagaende")
      .map((p) => vatPeriodFlow(p));
    assert.equal(vatFlowFocus(thisYear), thisYear[0]?.summary.period.key ?? null);
    assert.equal(vatFlowFocus([]), null);
  });
});

describe("OCR-numret för skattekontot", () => {
  beforeEach(reset);

  const base = "5591234567";
  const valid = base + bankgirotModulus10CheckDigit(base);

  it("sparas med kontrollsiffran kontrollerad och loggas", () => {
    assert.equal(setTaxAccountOcr(` ${valid.slice(0, 5)} ${valid.slice(5)} `, "anvandare"), valid);
    assert.equal(db().settings.taxAccountOcr, valid);
    const events = auditTrail({ action: "skattekonto_ocr_andrad" });
    assert.equal(events.length, 1);
    assert.match(events[0].details, /sparades/);
    // Samma nummer igen ändrar ingenting.
    setTaxAccountOcr(valid, "anvandare");
    assert.equal(auditTrail({ action: "skattekonto_ocr_andrad" }).length, 1);
  });

  it("fel kontrollsiffra och annat än siffror stoppas", () => {
    const wrong = base + String((Number(valid.slice(-1)) + 1) % 10);
    assert.throws(() => setTaxAccountOcr(wrong, "anvandare"), /Kontrollsiffran stämmer inte/);
    assert.throws(() => setTaxAccountOcr("5591234567X", "anvandare"), /bara av siffror/);
    assert.throws(() => setTaxAccountOcr("12", "anvandare"), /bara av siffror/);
    assert.equal(db().settings.taxAccountOcr, undefined);
  });

  it("tomt tar bort numret", () => {
    setTaxAccountOcr(valid, "anvandare");
    assert.equal(setTaxAccountOcr("   ", "anvandare"), undefined);
    assert.equal(db().settings.taxAccountOcr, undefined);
    assert.equal(auditTrail({ action: "skattekonto_ocr_andrad" }).length, 2);
    // Inget att ta bort → ingen ny händelse.
    setTaxAccountOcr("", "anvandare");
    assert.equal(auditTrail({ action: "skattekonto_ocr_andrad" }).length, 2);
  });
});
