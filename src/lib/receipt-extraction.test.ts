process.env.DRIVA_TEST = "1";

/**
 * Kvittotolkning: modellen läser, bevisen avgör.
 *
 * HTTP-transporten mockas – det är transportmockning i TESTER, ingen fejkad AI
 * i produkten. Parsningen, konfidenstaket, bevisreglerna, ingest-pipelinen och
 * bokföringen körs på riktigt mot den seedade databasen.
 */

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { buildSeed } from "./seed";
import { __setAiTransportForTests } from "./ai/provider";
import {
  extractReceipt,
  hintFromModelJson,
  isInterpretableDocument,
  MODEL_CONFIDENCE_CEILING,
} from "./ai/extract-document";
import { corroborateHint, vatArithmeticHolds } from "./inbox/corroborate";
import { CONFIDENCE_THRESHOLDS } from "./autopilot";
import { getInboxMail, ingestUploadedDocument, interpretDocumentFile, interpretInboundPayload } from "./services/inbox";
import type { InboundMailPayload } from "./inbox/inbound-mail";

const PNG_BASE64 = Buffer.from("inte-en-riktig-bild-transporten-ar-mockad").toString("base64");

function configureAi() {
  process.env.AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-nyckel-anvands-aldrig-transporten-ar-mockad";
  delete process.env.AI_MODEL_FAST;
  delete process.env.AI_MODEL_SMART;
}

/** Svara med ett modellsvar och spara begäran, så vi kan granska den. */
function respondWith(content: string) {
  const bodies: string[] = [];
  __setAiTransportForTests(async (_url, init) => {
    bodies.push(String(init.body));
    return new Response(
      JSON.stringify({
        model: "google/gemini-3.7-flash",
        choices: [{ message: { content, tool_calls: [] } }],
        usage: { prompt_tokens: 900, completion_tokens: 60 },
      }),
      { status: 200 }
    );
  });
  return bodies;
}

/** Ett läsbart kvitto: 1 240 kr varav 248 kr moms – 25 % går jämnt upp. */
function receiptJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    documentType: "kvitto",
    supplier: "Byggmax",
    amount: 1240,
    vatAmount: 248,
    date: "2026-03-04",
    invoiceNumber: null,
    dueDate: null,
    ocr: null,
    bankgiro: null,
    confidence: { supplier: 1, amount: 1, vatAmount: 1, date: 1 },
    ...over,
  });
}

beforeEach(() => {
  replaceDb(buildSeed());
  configureAi();
  __setAiTransportForTests(null);
});

describe("modellsvar → uppgifter", () => {
  it("läser kvittots fält och håller sig under autopilotens tröskel", () => {
    const hint = hintFromModelJson(receiptJson());
    assert.ok(hint);
    assert.equal(hint.supplier, "Byggmax");
    assert.equal(hint.amount, 1240);
    assert.equal(hint.vatAmount, 248);
    assert.equal(hint.date, "2026-03-04");
    assert.equal(hint.documentType, "kvitto");
    assert.equal(
      hint.confidence! < CONFIDENCE_THRESHOLDS.AUTO,
      true,
      "modellens eget ord får aldrig räcka till automatisk bokföring"
    );
    assert.equal(hint.fieldConfidence?.amount, MODEL_CONFIDENCE_CEILING);
  });

  it("hittar inte på fält som saknas och struntar i skräpvärden", () => {
    const hint = hintFromModelJson(
      receiptJson({ invoiceNumber: "null", ocr: "ej läsbart", bankgiro: "  ", date: "4 mars" })
    );
    assert.ok(hint);
    assert.equal(hint.invoiceNumber, undefined);
    assert.equal(hint.ocr, undefined);
    assert.equal(hint.bankgiro, undefined);
    assert.equal(hint.date, undefined, "ett datum som inte är YYYY-MM-DD är ingen läsning");
  });

  it("dokumentkonfidensen är det svagaste fältet en bokföring vilar på", () => {
    const hint = hintFromModelJson(receiptJson({ confidence: { supplier: 1, amount: 0.4, vatAmount: 1 } }));
    assert.ok(hint);
    assert.equal(hint.confidence, 0.4, "ett osäkert belopp döljs inte bakom ett säkert leverantörsnamn");
  });

  it("saknat belopp ger konfidens noll, inte en gissning", () => {
    const hint = hintFromModelJson(receiptJson({ amount: null, vatAmount: null }));
    assert.ok(hint);
    assert.equal(hint.amount, undefined);
    assert.equal(hint.confidence, 0);
  });

  it("moms större än totalen är en felläsning, inte en osäkerhet", () => {
    const hint = hintFromModelJson(receiptJson({ amount: 200, vatAmount: 900 }));
    assert.ok(hint);
    assert.equal(hint.vatAmount, undefined);
  });

  it("avrundar öre till hela kronor och avvisar belopp som text", () => {
    assert.equal(hintFromModelJson(receiptJson({ amount: 1240.5 }))?.amount, 1241);
    assert.equal(hintFromModelJson(receiptJson({ amount: "1240" }))?.amount, undefined);
  });

  it("tål kodstaket och inledande prat runt JSON:en", () => {
    const wrapped = "Här är resultatet:\n```json\n" + receiptJson() + "\n```";
    assert.equal(hintFromModelJson(wrapped)?.amount, 1240);
    assert.equal(hintFromModelJson("inte json alls"), undefined);
    assert.equal(hintFromModelJson(null), undefined);
  });
});

describe("bevis utanför modellen", () => {
  it("känner igen momsen på 25, 12 och 6 procent och avvisar resten", () => {
    assert.equal(vatArithmeticHolds(1240, 248), true);
    assert.equal(vatArithmeticHolds(1120, 120), true);
    assert.equal(vatArithmeticHolds(1060, 60), true);
    assert.equal(vatArithmeticHolds(1000, 137), false);
    assert.equal(vatArithmeticHolds(1000, 0), false, "momsfritt går inte att bekräfta med räkning");
    assert.equal(vatArithmeticHolds(500, 500), false);
  });

  it("momsräkningen lyfter till förslag, banken lyfter till bokföring", () => {
    const hint = hintFromModelJson(receiptJson())!;
    const räknad = corroborateHint(hint);
    assert.equal(räknad.hint.confidence! >= CONFIDENCE_THRESHOLDS.SUGGEST, true);
    assert.equal(
      räknad.hint.confidence! < CONFIDENCE_THRESHOLDS.AUTO,
      true,
      "totalen kan fortfarande vara delsumman – räkningen ensam räcker inte"
    );

    const bekräftad = corroborateHint(hint, { bankMatch: "hog" });
    assert.equal(bekräftad.hint.confidence! >= CONFIDENCE_THRESHOLDS.AUTO, true);
    assert.equal(bekräftad.reasons.length, 2);
  });

  it("en bankträff på bara beloppet bekräftar inte vem som fick pengarna", () => {
    const hint = hintFromModelJson(receiptJson())!;
    const result = corroborateHint(hint, { bankMatch: "medel" });
    assert.equal(
      result.hint.confidence! < CONFIDENCE_THRESHOLDS.AUTO,
      true,
      "kategorin hänger på leverantören, och den är fortfarande bara modellens läsning"
    );
    assert.equal(result.hint.fieldConfidence?.amount, 0.95);
  });

  it("bekräftar inte en läsning modellen själv kallade osäker", () => {
    const osäker = hintFromModelJson(receiptJson({ confidence: { supplier: 1, amount: 0.3, vatAmount: 0.3 } }))!;
    const result = corroborateHint(osäker, { bankMatch: "hog" });
    assert.equal(result.reasons.length, 0);
    assert.equal(result.hint.confidence, 0.3, "räkningen som råkar stämma gör inte en osäker läsning säker");
  });

  it("ett osäkert leverantörsnamn håller kvar dokumentet när banken inte styrker det", () => {
    const hint = hintFromModelJson(receiptJson({ confidence: { supplier: 0.4, amount: 1, vatAmount: 1 } }))!;
    assert.equal(corroborateHint(hint, { bankMatch: "medel" }).hint.confidence, 0.4);
    assert.equal(
      corroborateHint(hint, { bankMatch: "hog" }).hint.confidence! >= CONFIDENCE_THRESHOLDS.AUTO,
      true,
      "med bankens motpart är leverantören inte längre bara en gissning"
    );
  });
});

describe("tolkning genom transporten", () => {
  it("skickar bilden som bild och PDF:en som fil", async () => {
    const bilder = respondWith(receiptJson());
    await extractReceipt({ filename: "kvitto.png", contentType: "image/png", contentBase64: PNG_BASE64 });
    assert.match(bilder[0], /"type":"image_url"/);
    assert.equal(bilder[0].includes('"tools"'), false, "tolkningen exponerar aldrig affärsverktygen");

    const pdfer = respondWith(receiptJson());
    await extractReceipt({ filename: "faktura.pdf", contentType: "application/pdf", contentBase64: PNG_BASE64 });
    assert.match(pdfer[0], /"type":"file"/);
    assert.match(pdfer[0], /faktura\.pdf/);
  });

  it("tolkar bara filer som går att läsa", async () => {
    assert.equal(isInterpretableDocument("image/jpeg"), true);
    assert.equal(isInterpretableDocument("application/pdf"), true);
    assert.equal(isInterpretableDocument("application/zip"), false);
    respondWith(receiptJson());
    assert.equal(
      await extractReceipt({ filename: "arkiv.zip", contentType: "application/zip", contentBase64: PNG_BASE64 }),
      undefined
    );
  });

  it("loggar användningen så kostnaden syns", async () => {
    respondWith(receiptJson());
    await extractReceipt({ filename: "kvitto.png", contentType: "image/png", contentBase64: PNG_BASE64 });
    const entry = db().assistantAudit.find((a) => a.tool === "llm_document_extract");
    assert.ok(entry, "tolkningen ska hamna i användningsloggen");
    assert.equal(entry.success, true);
    assert.equal((entry.params as { filename?: string }).filename, "kvitto.png");
  });

  it("ett trasigt AI-anrop fäller inte dokumentet", async () => {
    __setAiTransportForTests(async () => new Response("fel", { status: 500 }));
    assert.equal(
      await extractReceipt({ filename: "kvitto.png", contentType: "image/png", contentBase64: PNG_BASE64 }),
      undefined
    );
    const entry = db().assistantAudit.find((a) => a.tool === "llm_document_extract");
    assert.equal(entry?.success, false);
  });

  it("utan AI-nyckel tolkas ingenting", async () => {
    delete process.env.OPENROUTER_API_KEY;
    respondWith(receiptJson());
    assert.equal(
      await extractReceipt({ filename: "kvitto.png", contentType: "image/png", contentBase64: PNG_BASE64 }),
      undefined
    );
  });
});

describe("tolkningen i inkorgens pipeline", () => {
  const payload = (over: Partial<InboundMailPayload> = {}): InboundMailPayload => ({
    externalId: `mail-${Math.random().toString(36).slice(2)}`,
    to: `${db().settings.inboundMailSlug}@in.ferva.se`,
    from: "kassa@byggmax.se",
    subject: "Kvitto",
    text: "Tack för ditt köp.",
    attachments: [{ filename: "kvitto.png", contentType: "image/png", contentBase64: PNG_BASE64 }],
    ...over,
  });

  it("fyller uppgifterna ur bilagan så avsändaren inte behöver skicka dem", async () => {
    respondWith(receiptJson());
    const interpreted = await interpretInboundPayload(payload());
    assert.equal(interpreted.parsed?.supplier, "Byggmax");
    assert.equal(interpreted.parsed?.amount, 1240);
    assert.equal(interpreted.parsed?.documentType, "kvitto");
  });

  it("rör inte uppgifter avsändaren redan skickat", async () => {
    const bodies = respondWith(receiptJson());
    const given = payload({ parsed: { supplier: "Jula", amount: 489, vatAmount: 98, confidence: 1 } });
    const interpreted = await interpretInboundPayload(given);
    assert.equal(interpreted.parsed?.supplier, "Jula");
    assert.equal(bodies.length, 0, "en känd läsning tolkas aldrig om");
  });

  it("utan bilaga att läsa lämnas posten orörd", async () => {
    respondWith(receiptJson());
    const interpreted = await interpretInboundPayload(payload({ attachments: [] }));
    assert.equal(interpreted.parsed, undefined);
  });

  it("ett tolkat kvitto utan bankstöd hamnar i Kontrollera i stället för i bokföringen", async () => {
    respondWith(receiptJson());
    const parsed = await interpretDocumentFile({
      filename: "kvitto.png",
      contentType: "image/png",
      contentBase64: PNG_BASE64,
    });
    const result = ingestUploadedDocument({
      filename: "kvitto.png",
      contentType: "image/png",
      contentBase64: PNG_BASE64,
      sizeBytes: 40,
      parsed,
    });
    assert.equal(result.ok, true);
    assert.equal(result.autoBooked, false, "en tolkning utan bevis bokförs inte");
    const item = getInboxMail(result.item.id)!;
    assert.equal(item.documentType, "kvitto");
    assert.equal(item.status, "ny");
    assert.equal(item.parsedAmount, 1240);
    assert.equal(item.expenseId, undefined);
    assert.equal(item.attachments[0]?.contentBase64, PNG_BASE64, "underlaget bevaras");
    // Granskningsvyn har fälten redo, med Drivas läsning per fält.
    assert.equal(item.extraction?.amount?.confidence, 0.95);
  });

  it("bankens bekräftelse gör kvittot bokfört hela vägen", async () => {
    // Ett obokat kortköp i banken på exakt beloppet: banken, inte modellen,
    // säger att bolaget betalat 1 240 kr hos Byggmax.
    const data = db();
    data.bankTransactions.unshift({
      id: "tx-byggmax-kvitto",
      accountId: data.bankAccounts[0]!.id,
      externalId: "tx-byggmax-kvitto",
      date: "2026-03-04",
      amount: -1240,
      counterpart: "Byggmax",
      description: "Kortköp BYGGMAX",
      status: "ny",
    });

    respondWith(receiptJson());
    const parsed = await interpretDocumentFile({
      filename: "kvitto.png",
      contentType: "image/png",
      contentBase64: PNG_BASE64,
    });
    assert.equal(parsed!.confidence! >= CONFIDENCE_THRESHOLDS.AUTO, true);

    const result = ingestUploadedDocument({
      filename: "kvitto.png",
      contentType: "image/png",
      contentBase64: PNG_BASE64,
      parsed,
    });
    assert.equal(result.ok, true);
    const item = getInboxMail(result.item.id)!;
    assert.ok(item.expenseId, "kvittot blev en utgift");
    const expense = db().expenses.find((e) => e.id === item.expenseId)!;
    assert.equal(expense.amount, 1240);
    assert.equal(expense.bankTransactionId, "tx-byggmax-kvitto", "utgiften matchades mot kortköpet");
    assert.equal(expense.status, "bokford");
    const ver = db().verifications.find((v) => v.id === expense.verificationId)!;
    assert.equal(
      ver.entries.reduce((s, e) => s + e.debit, 0),
      ver.entries.reduce((s, e) => s + e.credit, 0),
      "verifikationen balanserar som all annan bokföring"
    );
  });

  it("en leverantörsfaktura tolkas som faktura och blir aldrig en utbetalning", async () => {
    respondWith(
      JSON.stringify({
        documentType: "leverantorsfaktura",
        supplier: "Beijer Byggmaterial",
        amount: 12_500,
        vatAmount: 2_500,
        date: "2026-03-01",
        invoiceNumber: "F-99120",
        dueDate: "2026-03-31",
        ocr: "1234567890",
        bankgiro: "1234567",
        confidence: { supplier: 1, amount: 1, vatAmount: 1, date: 1, invoiceNumber: 1, dueDate: 1, ocr: 1, bankgiro: 1 },
      })
    );
    const interpreted = await interpretInboundPayload(payload({ subject: "Faktura F-99120" }));
    assert.equal(interpreted.parsed?.documentType, "leverantorsfaktura");
    assert.equal(interpreted.parsed?.invoiceNumber, "F-99120");
    assert.equal(interpreted.parsed?.bankgiro, "1234567");
    const details = interpreted.parsed?.detailsConfidence ?? 1;
    assert.equal(
      details < CONFIDENCE_THRESHOLDS.AUTO,
      true,
      "betalningsuppgifter ur en modell blir en kontrollkandidat, inte betalbara fält"
    );
  });
});
