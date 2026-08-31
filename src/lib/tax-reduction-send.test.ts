process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { emptyTestDb, labor, rotReadyCustomer, testCustomer, testWorkLocation } from "./invoices/test-db";
import { createQuote, quoteDefaults, quoteSendBlockers, sendQuote } from "./services/quotes";
import { createInvoice, issueInvoice, updateInvoice } from "./services/invoices";
import { InvoiceNotReadyError } from "./invoices/validate";
import { getInvoice, getQuote } from "./services/data";
import { addWorkLocation } from "./services/work-locations";
import { updateCustomer } from "./services/customers";
import {
  TaxReductionNotReadyError,
  resolvePersistedWorkLocationId,
  validateTaxReductionSendReadiness,
} from "./tax-reduction-send";
import type { QuoteInput } from "./services/quotes";

function reset(over: Parameters<typeof emptyTestDb>[0] = {}) {
  replaceDb(emptyTestDb(over));
}

function quoteInput(over: Partial<QuoteInput> = {}): QuoteInput {
  const defaults = quoteDefaults();
  return {
    customerId: over.customerId ?? "cust-1",
    title: over.title ?? "Köksrenovering",
    lines: over.lines ?? [labor({ unitPrice: 20_000 })],
    rot: over.rot === undefined ? { type: "rot" } : over.rot,
    workLocationId: over.workLocationId,
    paymentPlan: over.paymentPlan ?? [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: over.paymentTermsDays ?? defaults.paymentTermsDays,
    validUntil: over.validUntil ?? defaults.validUntil,
    terms: over.terms ?? defaults.terms,
  };
}

describe("validateTaxReductionSendReadiness", () => {
  it("A: ROT-offert utan personnummer men med bostad – utkast sparas, skick blockeras", () => {
    reset({
      customers: [
        testCustomer({
          workLocations: [testWorkLocation()],
          defaultWorkLocationId: "loc-1",
        }),
      ],
    });
    const quote = createQuote(quoteInput({ workLocationId: "loc-1" }));
    assert.equal(quote.status, "utkast");
    assert.equal(getQuote(quote.id)?.workLocationId, "loc-1");

    const blockers = quoteSendBlockers(quote.id);
    assert.ok(blockers.some((b) => b.code === "personnummer"));
    assert.ok(!blockers.some((b) => b.code === "property"));
    assert.match(blockers.find((b) => b.code === "personnummer")!.message, /personnummer/i);
    assert.match(blockers.find((b) => b.code === "personnummer")!.href ?? "", /#kund-personnummer/);

    assert.throws(() => sendQuote(quote.id), TaxReductionNotReadyError);
    assert.equal(getQuote(quote.id)?.status, "utkast");
  });

  it("B: ROT-offert med giltigt personnummer men utan bostad på dokumentet – skick blockeras", () => {
    const hem = testWorkLocation({ id: "loc-hem" });
    const fritid = testWorkLocation({ id: "loc-fritid", label: "Fritidshus", propertyDesignation: "Väddö 2:2" });
    reset({
      customers: [
        rotReadyCustomer({
          workLocations: [hem, fritid],
          defaultWorkLocationId: hem.id,
        }),
      ],
    });
    const quote = createQuote(quoteInput({ workLocationId: undefined }));
    assert.equal(quote.status, "utkast");
    assert.equal(quote.workLocationId, undefined);

    const blockers = quoteSendBlockers(quote.id);
    assert.ok(blockers.some((b) => b.code === "property"));
    assert.ok(!blockers.some((b) => b.code === "personnummer"));
    assert.match(blockers.find((b) => b.code === "property")!.message, /bostad/i);
    assert.match(blockers.find((b) => b.code === "property")!.href ?? "", /#offert-rot-rut/);

    assert.throws(() => sendQuote(quote.id), TaxReductionNotReadyError);
    assert.equal(getQuote(quote.id)?.status, "utkast");
  });

  it("C: ROT-offert med giltigt personnummer och bostad – redo att skickas", () => {
    reset({ customers: [rotReadyCustomer()] });
    const quote = createQuote(quoteInput({ workLocationId: "loc-1" }));
    assert.deepEqual(
      quoteSendBlockers(quote.id).filter((b) => b.code === "personnummer" || b.code === "property"),
      []
    );
    const sent = sendQuote(quote.id);
    assert.equal(sent.status, "skickad");
  });

  it("D: vanlig offert utan personnummer och bostad påverkas inte", () => {
    reset({ customers: [testCustomer()] });
    const quote = createQuote(quoteInput({ rot: null }));
    assert.equal(quote.workLocationId, undefined);
    assert.deepEqual(
      quoteSendBlockers(quote.id).filter((b) => b.code === "personnummer" || b.code === "property"),
      []
    );
    const sent = sendQuote(quote.id);
    assert.equal(sent.status, "skickad");
  });

  it("E: ROT-faktura med personnummer och bostad behåller bostaden efter omladdning", () => {
    reset({ customers: [rotReadyCustomer()] });
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: "loc-1",
    });
    assert.equal(invoice.workLocationId, "loc-1");
    const reloaded = getInvoice(invoice.id);
    assert.equal(reloaded?.workLocationId, "loc-1");
    updateInvoice(invoice.id, {
      lines: invoice.lines,
      rot: { type: "rot" },
      workLocationId: "loc-1",
    });
    assert.equal(getInvoice(invoice.id)?.workLocationId, "loc-1");
  });

  it("F: två bostäder på kunden och ingen vald på dokumentet – kan inte skickas", () => {
    const hem = testWorkLocation({ id: "loc-hem" });
    const fritid = testWorkLocation({ id: "loc-fritid", label: "Fritidshus" });
    reset({
      customers: [rotReadyCustomer({ workLocations: [hem, fritid], defaultWorkLocationId: hem.id })],
    });
    const quote = createQuote(quoteInput());
    assert.equal(quote.workLocationId, undefined);
    assert.ok(quoteSendBlockers(quote.id).some((b) => b.code === "property"));
    assert.throws(() => sendQuote(quote.id), TaxReductionNotReadyError);

    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
    });
    assert.equal(invoice.workLocationId, undefined);
    assert.throws(() => issueInvoice(invoice.id), InvoiceNotReadyError);
  });

  it("G: en bostad auto-väljs när ROT aktiveras och sparas så omladdning behåller den", () => {
    reset({ customers: [rotReadyCustomer()] });
    const quote = createQuote(quoteInput({ workLocationId: undefined }));
    assert.equal(quote.workLocationId, "loc-1");
    assert.equal(getQuote(quote.id)?.workLocationId, "loc-1");

    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
    });
    assert.equal(invoice.workLocationId, "loc-1");
    assert.equal(getInvoice(invoice.id)?.workLocationId, "loc-1");
  });

  it("offertens bostad följer med till fakturan när den skapas från kedjan", () => {
    const hem = testWorkLocation({ id: "loc-hem" });
    const fritid = testWorkLocation({ id: "loc-fritid", label: "Fritidshus" });
    reset({
      customers: [rotReadyCustomer({ workLocations: [hem, fritid], defaultWorkLocationId: hem.id })],
    });
    const quote = createQuote(quoteInput({ workLocationId: fritid.id }));
    const invoice = createInvoice({
      customerId: "cust-1",
      quoteId: quote.id,
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
    });
    assert.equal(invoice.workLocationId, fritid.id);
  });

  it("kundens första bostad gissas inte om dokumentet saknar val", () => {
    const hem = testWorkLocation({ id: "loc-hem" });
    const fritid = testWorkLocation({ id: "loc-fritid", label: "Fritidshus" });
    const resolved = resolvePersistedWorkLocationId({
      taxReduction: { type: "rot" },
      workLocationId: undefined,
      customerWorkLocationIds: [hem.id, fritid.id],
    });
    assert.equal(resolved, undefined);
  });

  it("ogiltigt personnummer blockerar med svensk text, inte felkod", () => {
    const result = validateTaxReductionSendReadiness({
      kind: "faktura",
      taxReduction: { type: "rut" },
      personalIdentityNumber: "123",
      workLocationId: "loc-1",
      customerWorkLocationIds: ["loc-1"],
    });
    assert.equal(result.ok, false);
    assert.equal(result.issues[0]?.code, "personnummer");
    assert.match(result.issues[0]?.message ?? "", /10 eller 12 siffror/);
    assert.equal(result.issues[0]?.message.includes("personnummer"), true);
  });
});

describe("ROT-faktura skick-validering", () => {
  beforeEach(() => reset({ customers: [rotReadyCustomer()] }));

  it("utfärdande stoppas utan bostad när kunden har flera", () => {
    addWorkLocation("cust-1", {
      label: "Fritidshus",
      address: "Bryggvägen 4",
      city: "Väddö",
      propertyType: "smahus",
      propertyDesignation: "Väddö 2:2",
    });
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: "",
    });
    updateInvoice(invoice.id, {
      lines: invoice.lines,
      rot: { type: "rot" },
      workLocationId: null,
    });
    const stored = getInvoice(invoice.id)!;
    // Efter auto-val vid skapande: nollställ och kräva aktivt val.
    stored.workLocationId = undefined;
    assert.throws(() => issueInvoice(stored.id), InvoiceNotReadyError);
  });

  it("vanlig faktura utan personnummer kan fortfarande utfärdas", () => {
    updateCustomer("cust-1", { personalIdentityNumber: "" });
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    const issued = issueInvoice(invoice.id);
    assert.equal(issued.status, "skickad");
  });
});
