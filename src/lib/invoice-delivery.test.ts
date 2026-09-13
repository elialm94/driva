process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import {
  createInvoice,
  issueInvoice,
  issueInvoiceForPrint,
  markInvoiceSentManually,
} from "./services/invoices";
import { getInvoice, requireCustomer } from "./services/data";
import { getBusinessActions } from "./services/actions";
import { getInvoiceSendBlockers, validateInvoiceForIssue } from "./invoices/validate";
import { resolveCustomerEmail } from "./resolve-missing-requirements";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";

/**
 * Utfärdande utan e-post. "Utfärdad" är `issuedAt` (nummer, snapshot,
 * verifikation); "skickad" är leveransen. En pappersfaktura är utfärdad på
 * exakt samma sätt som en mejlad och ska bokföras likadant – e-post är ett
 * krav för mejl-utskicket, inte för fakturan.
 */

function resetWithoutEmail() {
  replaceDb(emptyTestDb({ customers: [testCustomer({ email: "" })] }));
}

function draft() {
  return createInvoice({
    customerId: "cust-1",
    type: "faktura",
    lines: [labor({ unitPrice: 2_000 })],
    rot: null,
  });
}

describe("E-post hindrar inte att fakturan utfärdas", () => {
  it("saknad e-post är en send-blocker, aldrig en issue-blocker", () => {
    resetWithoutEmail();
    const inv = draft();

    assert.equal(
      validateInvoiceForIssue(inv.id).some((b) => b.code === "buyer_email"),
      false,
      "utfärdandet får inte kräva e-post"
    );
    assert.equal(
      getInvoiceSendBlockers(inv.id).some((b) => b.code === "buyer_email"),
      true,
      "mejl-utskicket kräver fortfarande en adress"
    );
  });

  it("Ladda ner PDF går genom samma utfärdandeväg: nummer, OCR, snapshot och verifikation", () => {
    resetWithoutEmail();
    const inv = issueInvoiceForPrint(draft().id);

    assert.equal(inv.status, "skickad");
    assert.ok(inv.issuedAt, "utfärdad i händelselistan = issuedAt");
    assert.equal(inv.number, 100);
    assert.match(inv.ocr, /^\d+$/);
    assert.ok(inv.issuedSnapshot, "dokumentet måste renderas ur en fryst kopia");
    assert.equal(inv.issuedSnapshot?.number, 100);

    const verification = db().verifications.find((v) => v.source?.id === inv.id);
    assert.ok(verification, "en pappersfaktura är bokföringspliktig på samma sätt");
    assert.equal(verification.source?.type, "kundfaktura");
    assert.ok(verification.explanation.length > 0);

    // Papper är inte e-post: sentAt betyder provider-succé i hela trädet.
    assert.equal(inv.sentAt, undefined);
    assert.equal(inv.lastEmail, undefined);
    assert.equal(inv.deliveredBy, "utskrift");
  });

  it("pappersfaktura ger inget falskt ”kunde inte skickas”", () => {
    resetWithoutEmail();
    const inv = issueInvoiceForPrint(draft().id);
    const actions = getBusinessActions();
    assert.equal(
      actions.attention.some((a) => a.id === `invoice-delivery-${inv.id}`),
      false,
      "användaren valde papper – det är inget leveransfel"
    );
  });

  it("utfärdad utan vald kanal är fortfarande ett leveransfel", () => {
    resetWithoutEmail();
    const inv = issueInvoice(draft().id);
    const actions = getBusinessActions();
    assert.ok(actions.attention.some((a) => a.id === `invoice-delivery-${inv.id}`));
  });

  it("Markera som skickad utfärdar och registrerar leveransen utan mejl", () => {
    resetWithoutEmail();
    const inv = markInvoiceSentManually(draft().id);

    assert.ok(inv.issuedAt);
    assert.equal(inv.number, 100);
    assert.equal(inv.deliveredBy, "manuell");
    assert.ok(inv.deliveredAt, "”Skickad” i händelselistan behöver en tidpunkt");
    assert.equal(inv.sentAt, undefined, "inget mejl gick iväg");
    assert.equal(inv.lastEmail, undefined);

    const actions = getBusinessActions();
    assert.equal(
      actions.attention.some((a) => a.id === `invoice-delivery-${inv.id}`),
      false
    );
  });

  it("Markera som skickad på en redan utfärdad faktura utfärdar inte om", () => {
    resetWithoutEmail();
    const inv = issueInvoice(draft().id);
    const number = inv.number;
    const issuedAt = inv.issuedAt;

    const marked = markInvoiceSentManually(inv.id);
    assert.equal(marked.number, number);
    assert.equal(marked.issuedAt, issuedAt);
    assert.equal(marked.deliveredBy, "manuell");
    assert.equal(db().verifications.filter((v) => v.source?.id === inv.id).length, 1);
  });

  it("upprepad nedladdning allokerar inte ett nytt nummer", () => {
    resetWithoutEmail();
    const first = issueInvoiceForPrint(draft().id);
    const again = issueInvoiceForPrint(first.id);
    assert.equal(again.number, first.number);
    assert.equal(again.issuedAt, first.issuedAt);
    assert.equal(db().verifications.filter((v) => v.source?.id === first.id).length, 1);
  });
});

describe("E-post som anges vid utskick sparas på kunden", () => {
  it("sparas på en kund som saknade adress", () => {
    resetWithoutEmail();
    const result = resolveCustomerEmail("cust-1", " anna@test.se ");
    assert.deepEqual(result, { ok: true, email: "anna@test.se", customerId: "cust-1" });
    assert.equal(requireCustomer("cust-1").email, "anna@test.se");
  });

  it("skriver inte över en befintlig adress", () => {
    replaceDb(emptyTestDb({ customers: [testCustomer({ email: "gammal@test.se" })] }));
    const result = resolveCustomerEmail("cust-1", "ny@test.se");
    assert.equal(result.ok, true);
    assert.equal(requireCustomer("cust-1").email, "gammal@test.se", "kundkortet äger adressen");
  });

  it("skriver över bara när den som frågar säger det uttryckligen", () => {
    replaceDb(emptyTestDb({ customers: [testCustomer({ email: "gammal@test.se" })] }));
    resolveCustomerEmail("cust-1", "ny@test.se", { overwrite: true });
    assert.equal(requireCustomer("cust-1").email, "ny@test.se");
  });

  it("ogiltig adress sparas inte", () => {
    resetWithoutEmail();
    const result = resolveCustomerEmail("cust-1", "inte-en-adress");
    assert.equal(result.ok, false);
    assert.equal(requireCustomer("cust-1").email, "");
  });
});
