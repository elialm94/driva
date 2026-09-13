process.env.DRIVA_TEST = "1";

import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  jobEconomyDocCanDiscard,
  jobHeaderPrimary,
  jobQuoteCardHeading,
  jobRemovalDisabledReason,
  jobWorkInvoiceChipLabel,
} from "./job-ui-types";

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

  it("sidorenderingen muterar inte inköpsreferensen", () => {
    assert.equal(page.includes("ensureJobPurchaseRef("), false);
    assert.match(page, /purchaseRef=\{job\.purchaseRef\}/);
    assert.match(work, /ensureJobPurchaseRefAction/);
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

  it("huvudet visar inte betalstatus och Ta bort är sist", () => {
    assert.equal(controls.includes("waitingLabel"), false);
    assert.equal(controls.includes("Väntar på betalning"), false);
    assert.match(controls, /label="Ta bort"/);
    const avsluta = controls.indexOf('label="Avsluta uppdrag"');
    const taBort = controls.indexOf('label="Ta bort"');
    assert.ok(avsluta > 0 && taBort > avsluta, "Ta bort kommer efter Avsluta");
  });

  it("arbetsraden säger inte bara På fakturautkast", () => {
    assert.equal(work.includes("På fakturautkast"), false);
    assert.match(work, /jobWorkInvoiceChipLabel/);
  });

  it("Ekonomi-listen har inte Registrerat eller Betalt", () => {
    assert.equal(page.includes("{kr(money.registered)}"), false);
    assert.equal(page.includes("{kr(money.paid)}"), false);
    assert.equal(/Registrerat\s+</.test(page), false);
    assert.match(page, /data-job-avtalat/);
    assert.match(page, /<JobEconomyDocs/);
  });

  it("Foton-modalen bekräftar tillägg med toast", () => {
    const photos = readFileSync(new URL("../components/job-photos.tsx", import.meta.url), "utf8");
    assert.match(photos, /Foto tillagt/);
    assert.match(photos, /useToast/);
    assert.match(controls, /Foton \(\$\{photoList\.length\}\)/);
  });
});

describe("uppdragshuvud: Avtalat, papperskorg, Ta bort", () => {
  it("Avtalat-raden på utkast är Offert utkast, inte Avtalat-belopp", () => {
    assert.match(jobQuoteCardHeading({ number: 4, status: "utkast" }, 725), /Offert utkast 725\s*kr/);
    assert.match(jobQuoteCardHeading({ number: 110, status: "godkand" }, 85000), /Offert #110/);
  });

  it("papperskorg bara på utkast, inte på utfärdat eller kredit", () => {
    assert.equal(jobEconomyDocCanDiscard({ kind: "quote", status: "utkast" }), true);
    assert.equal(jobEconomyDocCanDiscard({ kind: "quote", status: "godkand" }), false);
    assert.equal(jobEconomyDocCanDiscard({ kind: "quote", status: "skickad" }), false);
    assert.equal(jobEconomyDocCanDiscard({ kind: "invoice", status: "utkast", type: "faktura" }), true);
    assert.equal(jobEconomyDocCanDiscard({ kind: "invoice", status: "skickad", type: "faktura" }), false);
    assert.equal(jobEconomyDocCanDiscard({ kind: "invoice", status: "utkast", type: "kredit" }), false);
  });

  it("arbetsradens chip namnger utkastet", () => {
    assert.match(jobWorkInvoiceChipLabel({ status: "draft", invoiceAmount: 219 }), /På utkast · 219\s*kr/);
    assert.match(jobWorkInvoiceChipLabel({ status: "draft", invoiceAmount: 0 }), /På utkast · 0\s*kr/);
    assert.equal(jobWorkInvoiceChipLabel({ status: "draft", invoiceTitle: "Luckor i ek" }), "På utkast · Luckor i ek");
    assert.equal(jobWorkInvoiceChipLabel({ status: "invoiced", invoiceNumber: 1045 }), "På faktura #1045");
    assert.equal(jobWorkInvoiceChipLabel({ status: "uninvoiced" }), "Ej fakturerad");
  });

  it("Ta bort spärras med en rad om utfärdad faktura eller godkänd offert", () => {
    assert.equal(jobRemovalDisabledReason([]), null);
    assert.equal(
      jobRemovalDisabledReason(["Godkänd offert", "Utfärdad faktura"]),
      "Uppdraget har en utfärdad faktura.",
    );
    assert.equal(jobRemovalDisabledReason(["Godkänd offert"]), "Uppdraget har en godkänd offert.");
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
