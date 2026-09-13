process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createQuote } from "./services/quotes";
import { createJobFromQuote } from "./services/jobs";
import { parseDayReport, parseSwedishNumber } from "./day-report";
import { saveDayReport } from "./services/day-report";
import { jobChangesForJob } from "./services/job-changes";
import { actualEntries } from "./services/job-work";
import { jobTimeline } from "./services/job-timeline";

const SPEC_EXAMPLE =
  "Tre timmar arbete, fyrtiofem minuter resa, jag köpte skruv och reglar på Beijer och kunden ville även att vi byter två lister.";

describe("Rapportera dagens jobb: tolkning av text", () => {
  it("tolkar svenska tal i ord och siffror", () => {
    assert.equal(parseSwedishNumber("tre"), 3);
    assert.equal(parseSwedishNumber("fyrtiofem"), 45);
    assert.equal(parseSwedishNumber("två och en halv"), 2.5);
    assert.equal(parseSwedishNumber("en halv"), 0.5);
    assert.equal(parseSwedishNumber("1,5"), 1.5);
    assert.equal(parseSwedishNumber("120"), 120);
    assert.equal(parseSwedishNumber("hundratjugo"), 120);
    assert.equal(parseSwedishNumber("skruv"), null);
  });

  it("delar spec-exemplet i tid, resa, material och ändring utan att hitta på pris", () => {
    const items = parseDayReport(SPEC_EXAMPLE);
    assert.deepEqual(
      items.map((i) => i.kind),
      ["tid", "resa", "material", "andring"]
    );
    const [tid, resa, material, andring] = items;
    assert.equal(tid.qty, 3);
    assert.equal(tid.unit, "tim");
    assert.equal(resa.qty, 45);
    assert.equal(resa.unit, "min");
    assert.equal(material.description, "Skruv och reglar");
    assert.equal(material.supplier, "Beijer");
    assert.match(andring.description, /byter två lister/i);
    for (const item of items) {
      assert.equal("unitPrice" in item, false, "tolkaren föreslår aldrig ett pris");
      assert.ok(item.source.length > 0, "ursprungsfrasen följer med för granskning");
    }
  });

  it("hanterar decimalkomma, kilometer och fri anteckning", () => {
    const items = parseDayReport(
      "Jobbade 2,5 timmar med köksmontering. Körde 30 km. Hämtade spackel hos Bauhaus. Glöm inte nyckeln."
    );
    assert.deepEqual(
      items.map((i) => [i.kind, i.qty ?? null, i.unit ?? null]),
      [
        ["tid", 2.5, "tim"],
        ["resa", 30, "km"],
        ["material", null, null],
        ["anteckning", null, null],
      ]
    );
    assert.equal(items[0].description, "Köksmontering");
    assert.equal(items[3].description, "Glöm inte nyckeln");
  });

  it("tom text ger inga förslag", () => {
    assert.deepEqual(parseDayReport("   "), []);
  });
});

describe("Rapportera dagens jobb: spara valda poster", () => {
  let jobId = "";
  beforeEach(() => {
    replaceDb(emptyTestDb({ customers: [testCustomer({ id: "cust-1", name: "Anna Andersson" })] }));
    db().settings.defaultHourlyRate = 650;
    const quote = createQuote({
      customerId: "cust-1",
      title: "Kök",
      lines: [labor({ id: "q1", qty: 40, unitPrice: 500 })],
      rot: null,
      paymentPlan: [],
      paymentTermsDays: 30,
      validUntil: "2030-01-01",
      terms: "",
    });
    quote.status = "godkand";
    jobId = createJobFromQuote(quote).id;
  });

  it("sparar bara det användaren valt och går genom de vanliga tjänsterna", () => {
    const items = parseDayReport(SPEC_EXAMPLE);
    const chosen = items.filter((i) => i.kind !== "resa").map((i) => (i.kind === "material" ? { ...i, unitPrice: 480 } : i));
    const result = saveDayReport(jobId, chosen, "2026-09-10");

    const actuals = actualEntries(jobId);
    assert.equal(actuals.length, 2, "tid + material, ingen resa");
    const time = actuals.find((e) => e.type === "labor")!;
    assert.equal(time.qty, 3);
    assert.equal(time.date, "2026-09-10");
    assert.equal(time.unitPrice, 500, "timpriset kommer från offerten, inte från texten");
    const material = actuals.find((e) => e.type === "material")!;
    assert.equal(material.description, "Skruv och reglar (Beijer)");
    assert.equal(material.unitPrice, 480, "materialpriset är det användaren skrev");

    const changes = jobChangesForJob(jobId);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].status, "utkast");
    assert.match(changes[0].title, /byter två lister/i);
    assert.deepEqual(changes[0].lines, [], "ändringen prissätts av användaren, inte av tolkningen");
    assert.equal(result.changes[0].id, changes[0].id);

    const events = db().jobs.find((j) => j.id === jobId)!.closeout?.events ?? [];
    assert.equal(events.filter((e) => e.kind === "dagsrapport").length, 1);
    assert.ok(jobTimeline(jobId).some((t) => /Dagsrapport sparad/.test(t.title)));
  });

  it("resa sparas som resa (inte övrigt) med tid omräknad till timmar och pris 0 tills användaren sätter det", () => {
    const [resa] = parseDayReport("fyrtiofem minuter resa");
    saveDayReport(jobId, [resa]);
    const entry = actualEntries(jobId).find((e) => e.type === "travel")!;
    assert.ok(entry, "resan finns som egen typ");
    assert.equal(entry.qty, 0.75);
    assert.equal(entry.unit, "tim");
    assert.equal(entry.unitPrice, 0);
  });

  it("anteckning hamnar i uppdragets anteckningar utan att något registreras", () => {
    saveDayReport(jobId, parseDayReport("Glöm inte nyckeln"));
    assert.equal(actualEntries(jobId).length, 0);
    assert.equal(jobChangesForJob(jobId).length, 0);
    assert.match(db().jobs.find((j) => j.id === jobId)!.notes, /Glöm inte nyckeln/);
  });

  it("vägrar tom rapport, okänt uppdrag och tid utan timmar", () => {
    assert.throws(() => saveDayReport(jobId, []), /minst en post/);
    assert.throws(() => saveDayReport("finns-inte", parseDayReport("två timmar")), /finns inte/);
    assert.throws(
      () => saveDayReport(jobId, [{ id: "x", kind: "tid", description: "Arbete", source: "arbete" }]),
      /antal timmar/
    );
    assert.equal(actualEntries(jobId).length, 0, "ingenting sparades");
  });
});
