process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { db, replaceDb } from "../store";
import { createInvoice, creditInvoice, issueInvoice, updateInvoice } from "../services/invoices";
import { updateCustomer } from "../services/customers";
import { getInvoice } from "../services/data";
import { docTotals } from "../calc";
import { entriesCredit, entriesInvoiceSent, deductibleVat, entriesExpense } from "../bas";
import { computeVatPosition } from "../accounting/vat";
import { collectIssueErrors } from "./validate";
import { invoiceReverseChargeView } from "./document-view";
import { buyerVatNumber, REVERSE_CHARGE_CONSTRUCTION_NOTE, reverseChargeAppliesTo } from "./reverse-charge";
import { emptyTestDb, labor, reverseChargeCustomer, testCompany, testCustomer } from "./test-db";

/**
 * Omvänd byggmoms. Reglerna är enkla att beskriva och lätta att bokföra fel:
 * säljaren fakturerar utan moms men omsättningen ska INTE hamna bland den
 * momsfria försäljningen, och köparen redovisar moms som den samtidigt drar
 * av. Testerna låser båda sidorna och att markeringen fryses vid utfärdandet.
 */

const BYGG_CUSTOMER_ID = "cust-bygg";

function reset() {
  replaceDb(
    emptyTestDb({
      settings: testCompany(),
      customers: [testCustomer(), reverseChargeCustomer()],
    })
  );
}

function byggDraft(lines = [labor({ unitPrice: 40_000 })]) {
  return createInvoice({ customerId: BYGG_CUSTOMER_ID, type: "faktura", lines, rot: null });
}

describe("omvänd byggmoms – markering på kunden", () => {
  beforeEach(reset);

  it("gäller bara företagskunder med markeringen satt", () => {
    assert.equal(reverseChargeAppliesTo(reverseChargeCustomer()), true);
    assert.equal(reverseChargeAppliesTo(testCustomer()), false);
    // En privatperson kan aldrig vara betalningsskyldig för säljarens moms.
    assert.equal(reverseChargeAppliesTo(testCustomer({ reverseChargeConstruction: true })), false);
  });

  it("kan inte sättas på en privatperson", () => {
    assert.throws(
      () => updateCustomer("cust-1", { reverseChargeConstruction: true }),
      /bara företagskunder/i
    );
  });

  it("härleder köparens momsregistreringsnummer ur organisationsnummret", () => {
    assert.equal(buyerVatNumber(reverseChargeCustomer()), "SE556677889901");
    assert.equal(buyerVatNumber(testCustomer()), "");
  });
});

describe("omvänd byggmoms – fakturautkast", () => {
  beforeEach(reset);

  it("nollar momsen på raderna och markerar fakturan", () => {
    const invoice = byggDraft();
    assert.equal(invoice.reverseCharge, true);
    assert.deepEqual(
      invoice.lines.map((l) => l.vatRate),
      [0]
    );
    assert.equal(docTotals(invoice.lines, null).vat, 0);
    assert.equal(docTotals(invoice.lines, null).toPay, 40_000);
  });

  it("faktura till en omarkerad kund behåller momsen", () => {
    const invoice = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor()], rot: null });
    assert.equal(invoice.reverseCharge, undefined);
    assert.equal(docTotals(invoice.lines, null).vat, 250);
  });

  it("nollar momsen igen när utkastet sparas med momsrader", () => {
    const invoice = byggDraft();
    const saved = updateInvoice(invoice.id, { lines: [labor({ vatRate: 25 })], rot: null });
    assert.deepEqual(
      saved.lines.map((l) => l.vatRate),
      [0]
    );
  });

  it("tar bort markeringen när kunden inte längre är markerad", () => {
    const invoice = byggDraft();
    updateCustomer(BYGG_CUSTOMER_ID, { reverseChargeConstruction: false });
    const saved = updateInvoice(invoice.id, { lines: [labor({ vatRate: 25 })], rot: null });
    assert.equal(saved.reverseCharge, undefined);
    assert.equal(docTotals(saved.lines, null).vat, 250);
  });
});

describe("omvänd byggmoms – hinder vid utfärdande", () => {
  beforeEach(reset);

  function blockers(invoiceId: string) {
    const invoice = getInvoice(invoiceId)!;
    const buyer = db().customers.find((c) => c.id === invoice.customerId)!;
    return collectIssueErrors({ invoice, seller: db().settings, buyer }).map((b) => b.code);
  }

  it("ett rent utkast har inga hinder från byggmomsen", () => {
    assert.equal(blockers(byggDraft().id).includes("reverse_charge_vat_lines"), false);
  });

  it("blockerar momsrader på en faktura med omvänd byggmoms", () => {
    const invoice = byggDraft();
    // Förbi tjänstelagret: en rad med moms får aldrig utfärdas.
    invoice.lines = [labor({ vatRate: 25 })];
    assert.ok(blockers(invoice.id).includes("reverse_charge_vat_lines"));
  });

  it("blockerar när köparens organisationsnummer saknas", () => {
    updateCustomer(BYGG_CUSTOMER_ID, { orgNumber: "" });
    assert.ok(blockers(byggDraft().id).includes("reverse_charge_buyer_vat"));
  });

  it("blockerar ROT/RUT tillsammans med omvänd byggmoms", () => {
    const invoice = byggDraft();
    invoice.rot = { type: "rot" };
    assert.ok(blockers(invoice.id).includes("reverse_charge_rot"));
  });
});

describe("omvänd byggmoms – utfärdad faktura", () => {
  beforeEach(reset);

  it("fryser markeringen och köparens momsnummer i snapshoten", () => {
    const issued = issueInvoice(byggDraft().id);
    assert.equal(issued.issuedSnapshot?.reverseCharge, true);
    assert.equal(issued.issuedSnapshot?.buyer.vatNumber, "SE556677889901");
  });

  it("fryser INTE momsnummer på en vanlig faktura", () => {
    const issued = issueInvoice(createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor()], rot: null }).id);
    assert.equal(issued.issuedSnapshot?.buyer.vatNumber, undefined);
    assert.equal(issued.issuedSnapshot?.reverseCharge, undefined);
  });

  it("markeringen följer inte kundens senare ändring", () => {
    const issued = issueInvoice(byggDraft().id);
    updateCustomer(BYGG_CUSTOMER_ID, { reverseChargeConstruction: false });
    const view = invoiceReverseChargeView(getInvoice(issued.id)!, { buyer: db().customers[1]! });
    assert.ok(view, "utfärdad faktura ska fortsätta visa omvänd byggmoms");
    assert.equal(view.note, REVERSE_CHARGE_CONSTRUCTION_NOTE);
    assert.equal(view.buyerVatNumber, "SE556677889901");
    assert.equal(view.buyerVatToReport, 10_000);
  });

  it("bokför omsättningen på 3231, utan utgående moms", () => {
    const issued = issueInvoice(byggDraft().id);
    const ver = db().verifications.find((v) => v.source?.type === "kundfaktura" && v.source.id === issued.id);
    assert.ok(ver);
    const accounts = ver.entries.map((e) => e.account).sort((a, b) => a - b);
    assert.deepEqual(accounts, [1510, 3231]);
    assert.equal(ver.entries.find((e) => e.account === 3231)?.credit, 40_000);
  });

  it("lägger omsättningen i ruta 41, inte i ruta 42", () => {
    issueInvoice(byggDraft().id);
    const ver = db().verifications[0]!;
    const day = ver.date.slice(0, 10);
    const pos = computeVatPosition({ key: "test", label: "Test", start: day, end: day });
    assert.equal(pos.boxes.find((b) => b.code === "41")?.amount, 40_000);
    assert.equal(pos.boxes.find((b) => b.code === "42"), undefined);
    assert.equal(pos.utgaende, 0);
  });

  it("krediteringen ärver markeringen och vänder 3231", () => {
    const issued = issueInvoice(byggDraft().id);
    updateCustomer(BYGG_CUSTOMER_ID, { reverseChargeConstruction: false });
    const credit = creditInvoice(issued.id);
    assert.equal(credit.reverseCharge, true);
    const ver = db().verifications.find((v) => v.source?.type === "kundfaktura" && v.source.id === credit.id);
    assert.ok(ver);
    assert.equal(ver.entries.find((e) => e.account === 3231)?.debit, 40_000);
  });
});

describe("omvänd byggmoms – konteringsmallar", () => {
  it("säljaren bokför på 3231 bara när markeringen finns", () => {
    const lines = [labor({ unitPrice: 10_000, vatRate: 0 })];
    const plain = entriesInvoiceSent(lines, null).map((e) => e.account);
    const bygg = entriesInvoiceSent(lines, null, { reverseCharge: true }).map((e) => e.account);
    // Utan markering är 0 % momsfri försäljning (ruta 42) – en annan ruta.
    assert.ok(plain.includes(3004));
    assert.ok(bygg.includes(3231));
    assert.equal(bygg.includes(3004), false);
  });

  it("krediten speglar försäljningen", () => {
    const lines = [labor({ unitPrice: 10_000, vatRate: 0 })];
    const sent = entriesInvoiceSent(lines, null, { reverseCharge: true });
    const credit = entriesCredit(lines, null, { reverseCharge: true });
    const net = (entries: typeof sent, account: number) =>
      entries.filter((e) => e.account === account).reduce((s, e) => s + e.debit - e.credit, 0);
    assert.equal(net(sent, 3231) + net(credit, 3231), 0);
    assert.equal(net(sent, 1510) + net(credit, 1510), 0);
  });

  it("köparen redovisar och drar av samma moms – nettot mot Skatteverket är noll", () => {
    const entries = entriesExpense("byggtjanster_omvand", 100_000, 0);
    const by = (account: number) =>
      entries.filter((e) => e.account === account).reduce((s, e) => s + e.debit - e.credit, 0);
    assert.equal(by(4425), 100_000);
    assert.equal(by(2647), 25_000);
    assert.equal(by(2614), -25_000);
    assert.equal(by(1930), -100_000);
    assert.equal(
      entries.reduce((s, e) => s + e.debit - e.credit, 0),
      0
    );
  });

  it("lyfter ingen moms från leverantörens faktura vid omvänd skattskyldighet", () => {
    // Fakturan har ingen moms att lyfta – momsen räknas fram ur beloppet.
    assert.equal(deductibleVat("byggtjanster_omvand", 25_000), 0);
    assert.equal(deductibleVat("material", 2_500), 2_500);
  });
});
