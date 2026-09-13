process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createQuote } from "./services/quotes";
import { createJobFromQuote } from "./services/jobs";
import { registerJobTime } from "./services/job-work";
import { createPartInvoiceForQuote, issueInvoice, registerInvoicePayment } from "./services/invoices";
import { approveJobChange, createJobChange, sendJobChange } from "./services/job-changes";
import { completeJobCloseout, createCloseoutInvoiceDraft, setBillingDeferral } from "./services/closeout";
import { jobTimeline } from "./services/job-timeline";
import type { PaymentPlanPart } from "./types";

const PLAN: PaymentPlanPart[] = [
  { label: "Vid start", percent: 30, kind: "forskott" },
  { label: "När arbetet är klart", percent: 70, kind: "slutbetalning" },
];

function setup() {
  replaceDb(emptyTestDb({ customers: [testCustomer({ id: "cust-1", name: "Anna Andersson" })] }));
  const quote = createQuote({
    customerId: "cust-1",
    title: "Kök",
    lines: [labor({ id: "q1", qty: 40, unitPrice: 500 })],
    rot: null,
    paymentPlan: PLAN,
    paymentTermsDays: 30,
    validUntil: "2030-01-01",
    terms: "",
  });
  quote.status = "godkand";
  quote.sentAt = "2026-08-01T08:00:00.000Z";
  quote.viewedAt = "2026-08-01T09:00:00.000Z";
  quote.decidedAt = "2026-08-01T10:00:00.000Z";
  const job = createJobFromQuote(quote);
  job.startDate = "2026-08-02T07:00:00.000Z";
  return { quote, job };
}

describe("Uppdragstidslinjen", () => {
  beforeEach(() => setup());

  it("härleder poster ur fakta, nyast först, med kategori per filter", () => {
    const { job } = setup();
    const part = createPartInvoiceForQuote(job.quoteId!, 0);
    issueInvoice(part.id);
    registerInvoicePayment(part.id, { amount: 7500, matchedBy: "manuell" });
    const entry = registerJobTime(job.id, { hours: 6 });
    entry.date = "2026-08-04";
    const change = sendJobChange(
      createJobChange(job.id, { title: "Flyttat eluttag", description: "", lines: [labor({ id: "c1", qty: 2, unitPrice: 1000 })] }).id
    );
    approveJobChange({ token: change.token, name: "Anna" });

    const entries = jobTimeline(job.id);
    for (let i = 1; i < entries.length; i++) assert.ok(entries[i - 1].at >= entries[i].at, "nyast först");

    const titles = entries.map((e) => e.title);
    assert.ok(titles.includes("Kunden godkände offert #1"), titles.join("\n"));
    assert.ok(titles.includes("Offert #1 skickades till kunden"));
    assert.ok(titles.includes("Kunden öppnade offerten"));
    assert.ok(titles.includes("Arbetet startade"));
    assert.ok(titles.some((t) => t.startsWith("Registrerat: 6 tim arbete")));
    assert.ok(titles.some((t) => t.startsWith("Faktura #") && t.includes("utfärdades")));
    assert.ok(titles.some((t) => t.startsWith("Betalning mottagen")));
    assert.ok(titles.some((t) => t.startsWith("Kunden godkände ändring 1")));

    const kund = entries.filter((e) => e.category === "kund");
    const arbete = entries.filter((e) => e.category === "arbete");
    const ekonomi = entries.filter((e) => e.category === "ekonomi");
    assert.ok(kund.every((e) => /offert|kund|ändring|Uppdraget skapades|Förfrågan/i.test(e.title)));
    assert.ok(arbete.some((e) => e.title === "Arbetet startade"));
    assert.ok(ekonomi.some((e) => e.title.startsWith("Betalning mottagen")));
    // Kundens handlingar är markerade så vyn kan visa dem särskilt.
    assert.ok(entries.find((e) => e.title === "Kunden godkände offert #1")?.byCustomer);
    // Ingen databasjargong.
    for (const e of entries) assert.ok(!/status|invoice|_id|jsonb|utkast_/i.test(e.title), e.title);
  });

  it("avslutsbeslut och avslut hamnar i tidslinjen utan dubblett för utkastet", () => {
    const { job } = setup();
    const extra = registerJobTime(job.id, { hours: 1, description: "Småfix" });
    extra.isExtra = true;
    setBillingDeferral(job.id, { sourceType: "work_entry", sourceId: extra.id }, "inte_fakturerbart", "Garanti");
    const draft = createCloseoutInvoiceDraft(job.id, { mode: "slutfaktura" });
    completeJobCloseout(job.id, { mode: "slutfaktura", invoiceId: draft.id });

    const entries = jobTimeline(job.id);
    // Avslutsflödets händelse ersätter den generiska "Fakturautkast skapades"-posten.
    assert.equal(entries.filter((e) => e.title.startsWith("Fakturautkast skapades")).length, 0);
    assert.equal(entries.filter((e) => e.title.startsWith("Fakturautkast (slutfaktura) skapades")).length, 1);
    assert.ok(entries.some((e) => e.href === `/ekonomi/fakturor/${draft.id}`));
    assert.ok(entries.some((e) => e.category === "ekonomi" && /inte fakturerbart/i.test(e.title)));
    assert.ok(entries.some((e) => e.category === "arbete" && /avslutades/i.test(e.title)));
    assert.equal(entries.filter((e) => /markerades som klart/.test(e.title)).length, 0);
  });
});
