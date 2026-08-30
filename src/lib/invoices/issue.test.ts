process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "../store";
import {
  createInvoice,
  creditInvoice,
  deliverInvoice,
  issueInvoice,
  markInvoicePaid,
  sendInvoice,
} from "../services/invoices";
import { collectIssueErrors, InvoiceNotReadyError } from "./validate";
import { resolveInvoiceView } from "./snapshot";
import { emptyTestDb, labor, rotReadyCustomer, testCompany, testCustomer, testWorkLocation } from "./test-db";
import { getInvoice } from "../services/data";
import { db } from "../store";

function reset(over: Parameters<typeof emptyTestDb>[0] = {}) {
  replaceDb(emptyTestDb(over));
}

function draft(over: { customerId?: string; lines?: ReturnType<typeof labor>[] } = {}) {
  return createInvoice({
    customerId: over.customerId ?? "cust-1",
    type: "faktura",
    lines: over.lines ?? [labor()],
    rot: null,
  });
}

describe("Fakturanummer och utkast", () => {
  beforeEach(() => reset());

  it("förbrukar inte löpnummer när utkast skapas", () => {
    const before = db().sequences.invoice;
    const a = draft();
    const b = draft();
    assert.equal(a.number, null);
    assert.equal(b.number, null);
    assert.equal(a.ocr, "");
    assert.equal(db().sequences.invoice, before);
  });

  it("tilldelar unika nummer vid många utfärdanden", () => {
    const ids = Array.from({ length: 12 }, () => draft().id);
    const numbers = ids.map((id) => issueInvoice(id).number);
    assert.equal(new Set(numbers).size, 12);
    assert.ok(numbers.every((n) => n != null));
  });

  it("ger aldrig samma nummer vid parallella issueInvoice", async () => {
    const a = draft();
    const b = draft();
    const [x, y] = await Promise.all([
      Promise.resolve().then(() => issueInvoice(a.id)),
      Promise.resolve().then(() => issueInvoice(b.id)),
    ]);
    assert.notEqual(x.number, y.number);
    assert.ok(x.number != null && y.number != null);
  });

  it("behåller befintligt nummer på äldre utkast", () => {
    const inv = draft();
    inv.number = 77;
    inv.ocr = "legacy";
    const issued = issueInvoice(inv.id);
    assert.equal(issued.number, 77);
    assert.equal(issued.ocr, "legacy");
  });
});

describe("Validering före utfärdande", () => {
  it("stoppar om säljaren saknar momsreg.nr", () => {
    reset({ settings: testCompany({ vatNumber: "" }) });
    const inv = draft();
    const blockers = collectIssueErrors({
      invoice: inv,
      seller: db().settings,
      buyer: testCustomer(),
    });
    assert.ok(blockers.some((b) => b.code === "seller_vat"));
    assert.throws(() => issueInvoice(inv.id), InvoiceNotReadyError);
  });

  it("stoppar om kunden saknar adress", () => {
    reset({
      customers: [testCustomer({ address: "", postalCode: "", city: "" })],
    });
    const inv = draft();
    const blockers = collectIssueErrors({
      invoice: inv,
      seller: db().settings,
      buyer: db().customers[0],
    });
    assert.ok(blockers.some((b) => b.code === "buyer_address"));
    assert.throws(() => issueInvoice(inv.id), InvoiceNotReadyError);
  });

  it("stoppar ROT-faktura utan personnummer", () => {
    reset({
      customers: [
        testCustomer({
          workLocations: [testWorkLocation()],
          defaultWorkLocationId: "loc-1",
        }),
      ],
    });
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: "loc-1",
    });
    const blockers = collectIssueErrors({
      invoice: inv,
      seller: db().settings,
      buyer: db().customers[0],
    });
    assert.ok(blockers.some((b) => b.code === "personnummer"));
    assert.match(blockers.find((b) => b.code === "personnummer")!.message, /personnummer/i);
    assert.throws(() => issueInvoice(inv.id), InvoiceNotReadyError);
  });

  it("släpper igenom ROT-faktura med personnummer och vald bostad", () => {
    reset({ customers: [rotReadyCustomer()] });
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: "loc-1",
    });
    const blockers = collectIssueErrors({
      invoice: inv,
      seller: db().settings,
      buyer: db().customers[0],
    });
    assert.ok(!blockers.some((b) => b.code === "personnummer" || b.code === "property"));
    const issued = issueInvoice(inv.id);
    assert.equal(issued.status, "skickad");
    assert.equal(issued.workLocationId, "loc-1");
  });
});

describe("Snapshot och immutabilitet", () => {
  beforeEach(() => reset());

  it("ändrad kundadress ändrar inte utfärdad faktura", () => {
    const inv = draft();
    issueInvoice(inv.id);
    const customer = db().customers[0];
    customer.address = "Ny adress 99";
    customer.city = "Göteborg";
    const stored = getInvoice(inv.id)!;
    assert.equal(stored.issuedSnapshot?.buyer.address, "Folkungagatan 1");
    assert.equal(stored.issuedSnapshot?.buyer.city, "Stockholm");
    const view = resolveInvoiceView(stored, { seller: db().settings, buyer: customer });
    assert.equal(view.buyer.address, "Folkungagatan 1");
    assert.equal(view.buyer.city, "Stockholm");
  });

  it("ändrade företagsuppgifter ändrar inte utfärdad faktura", () => {
    const inv = draft();
    issueInvoice(inv.id);
    db().settings.name = "Nytt Namn AB";
    db().settings.bankgiro = "1111-2222";
    db().settings.vatNumber = "SE000000000001";
    const stored = getInvoice(inv.id)!;
    const view = resolveInvoiceView(stored, { seller: db().settings, buyer: db().customers[0] });
    assert.equal(view.seller.name, "Test Snickeri AB");
    assert.equal(view.seller.bankgiro, "5678-1234");
    assert.equal(view.seller.vatNumber, "SE559123456701");
  });
});

describe("Kredit, omutskick och betalning", () => {
  beforeEach(() => reset());

  it("kredit refererar originalet och speglar beloppen", () => {
    const inv = draft({ lines: [labor({ unitPrice: 2000, vatRate: 25 })] });
    const issued = issueInvoice(inv.id);
    const credit = creditInvoice(issued.id);
    assert.equal(credit.type, "kredit");
    assert.notEqual(credit.number, issued.number);
    assert.equal(credit.creditsInvoiceId, issued.id);
    assert.equal(credit.issuedSnapshot?.creditsInvoiceNumber, issued.number);
    assert.equal(credit.issuedSnapshot?.totals.toPay, issued.issuedSnapshot?.totals.toPay);
    assert.equal(getInvoice(issued.id)?.status, "krediterad");
  });

  it("skicka igen allokerar inte nytt nummer", () => {
    const inv = draft();
    const sent = sendInvoice(inv.id);
    const number = sent.number;
    const ocr = sent.ocr;
    const again = deliverInvoice(sent.id);
    assert.equal(again.number, number);
    assert.equal(again.ocr, ocr);
    assert.equal(db().invoices.filter((i) => i.id === sent.id).length, 1);
  });

  it("betalning efter utfärdande bokförs", () => {
    const inv = draft();
    sendInvoice(inv.id);
    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    const paid = getInvoice(inv.id)!;
    assert.equal(paid.status, "betald");
    assert.ok(paid.paidAt);
    assert.equal(db().payments.length, 1);
    assert.equal(db().payments[0].amount, 1250);
  });
});
