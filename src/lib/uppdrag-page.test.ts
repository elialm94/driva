process.env.DRIVA_TEST = "1";

import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { jobHeaderPrimary } from "./job-ui-types";

const page = readFileSync(new URL("../app/(app)/uppdrag/[id]/page.tsx", import.meta.url), "utf8");
const controls = readFileSync(new URL("../components/job-controls.tsx", import.meta.url), "utf8");
const work = readFileSync(new URL("../components/job-work.tsx", import.meta.url), "utf8");

describe("uppdragssidan är en ekonomilogg", () => {
  it("ingen timer, ingen dagsrapport, ingen tidslinje, ingen kundvy på sidan", () => {
    for (const gone of [
      "JobTimeline",
      "jobTimeline",
      "CustomerShareSection",
      "JobChangesSection",
      "JobPhotosSection",
    ]) {
      assert.equal(page.includes(gone), false, `${gone} ska inte finnas kvar på uppdragssidan`);
    }
    for (const gone of ["JobTimerButton", "Starta timer", "DayReportButton", "+1 tim"]) {
      assert.equal(work.includes(gone), false, `${gone} ska inte finnas kvar i arbetsytan`);
    }
  });

  it("Skapa faktura finns på sin höjd en gång i arbetsytan", () => {
    assert.equal(work.includes("JobInvoiceTrigger"), false);
  });

  it("en enda läggtill-kontroll täcker både tid och material", () => {
    assert.equal((work.match(/data-job-add-entry/g) ?? []).length, 1);
  });

  it("sidan har en enda huvudåtgärd, och den ligger i sidhuvudet", () => {
    assert.equal((page.match(/<JobActions/g) ?? []).length, 1);
    // Förfrågningskortet hade en egen primärknapp "Skapa offert" - samma
    // åtgärd som sidhuvudet redan visar för ett uppdrag utan offert.
    assert.equal(page.includes('buttonClasses("primary"'), false);
  });

  it("beskrivningen är en underrubrik, inte en egen sektion", () => {
    assert.equal(page.includes("<SectionTitle>Beskrivning</SectionTitle>"), false);
    assert.match(page, /showDescription \?/);
  });

  it("Avsluta uppdrag bor bara i …-menyn", () => {
    assert.equal(controls.includes("closeoutBtn"), false);
    assert.match(controls, /label="Avsluta uppdrag"/);
  });

  it("utkastraden använder bindestreck, inte tankstreck", () => {
    const admin = readFileSync(new URL("./services/job-admin.ts", import.meta.url), "utf8");
    assert.match(admin, /Offerten är ett utkast - skicka den när den är klar\./);
  });
});

describe("jobHeaderPrimary", () => {
  it("offertutkast vinner över allt annat", () => {
    assert.equal(
      jobHeaderPrimary({ quoteAction: "fortsatt_offert", invoiceAction: "skapa_faktura", hasBillable: true }),
      "fortsatt_offert",
    );
  });

  it("annars faktura när något är kvar att fakturera", () => {
    assert.equal(
      jobHeaderPrimary({ quoteAction: "visa_offert", invoiceAction: "skapa_slutfaktura", hasBillable: true }),
      "skapa_slutfaktura",
    );
    assert.equal(
      jobHeaderPrimary({ quoteAction: "skapa_offert", invoiceAction: "skapa_faktura", hasBillable: true }),
      "skapa_faktura",
    );
  });

  it("utan offert och utan fakturerbart föreslås offerten", () => {
    assert.equal(
      jobHeaderPrimary({ quoteAction: "skapa_offert", invoiceAction: "skapa_faktura", hasBillable: false }),
      "skapa_offert",
    );
  });

  it("skickad offert utan fakturerbart landar på Visa offert", () => {
    assert.equal(
      jobHeaderPrimary({ quoteAction: "visa_offert", invoiceAction: "skapa_faktura", hasBillable: false }),
      "visa_offert",
    );
  });
});
