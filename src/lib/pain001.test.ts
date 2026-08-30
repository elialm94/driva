process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PAIN001_NAMESPACE,
  isValidIban,
  pain001Amount,
  serializePain001,
  validatePain001Document,
  type Pain001Document,
} from "./banking/pain001";
import { getPaymentExportProvider } from "./banking/payment-export";

/* ------------------------- Minimal välformadhetskoll ------------------------ */

/** Stackbaserad XML-välformadhetskontroll (inga externa parsers i testmiljön). */
function assertWellFormedXml(xml: string): void {
  assert.ok(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>`), "XML-deklaration med UTF-8 krävs");
  const body = xml.slice(xml.indexOf("?>") + 2);
  const stack: string[] = [];
  const tagPattern = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(body)) !== null) {
    const between = body.slice(cursor, match.index);
    assert.ok(!/[<>]/.test(between.replace(/[\s]/g, "").replace(/&(amp|lt|gt|quot|apos);/g, "")),
      `oescapade tecken i textinnehåll: ${between.trim().slice(0, 40)}`);
    cursor = match.index + match[0].length;
    const [, closing, name, , selfClosing] = match;
    if (selfClosing) continue;
    if (closing) {
      const open = stack.pop();
      assert.equal(open, name, `sluttagg </${name}> matchar inte <${open}>`);
    } else {
      stack.push(name);
    }
  }
  assert.equal(stack.length, 0, `oavslutade taggar: ${stack.join(", ")}`);
  const rest = body.slice(cursor).trim();
  assert.equal(rest, "", `innehåll efter rotelementet: ${rest.slice(0, 40)}`);
}

/** Ordningen av (första förekomsten av) taggar måste följa schemats sekvens. */
function assertElementOrder(xml: string, tags: string[]): void {
  let last = -1;
  for (const tag of tags) {
    const index = xml.indexOf(`<${tag}>`) >= 0 ? xml.indexOf(`<${tag}>`) : xml.indexOf(`<${tag} `);
    assert.ok(index >= 0, `elementet <${tag}> saknas`);
    assert.ok(index > last, `<${tag}> ligger före föregående element i schemaordningen`);
    last = index;
  }
}

function textOf(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/* --------------------------------- Fixturer -------------------------------- */

const DEBTOR = {
  name: "Södermalms Snickeri AB",
  orgNumber: "559123-4567",
  iban: "SE2750000000054910004512",
  bic: "ESSESESS",
};

function beijerDoc(over: Partial<Pain001Document> = {}): Pain001Document {
  return {
    messageId: "DRIVA-20260830-070000-TEST01",
    createdAt: "2026-08-30T07:00:00.000Z",
    debtor: DEBTOR,
    payments: [
      {
        endToEndId: "E2E0000000000000000000000000001",
        instructionId: "E2E0000000000000000000000000001",
        amount: 18500,
        currency: "SEK",
        requestedExecutionDate: "2026-09-09",
        creditorName: "Beijer Byggmaterial AB",
        creditorAccount: { kind: "bankgiro", account: "123-4567" },
        ocr: "48211",
      },
    ],
    ...over,
  };
}

/* ----------------------------------- Test ---------------------------------- */

describe("pain.001.001.03: XML-validitet", () => {
  it("genererar välformad UTF-8-XML med rätt namnrymd", () => {
    const xml = serializePain001(beijerDoc());
    assertWellFormedXml(xml);
    assert.ok(xml.includes(`xmlns="${PAIN001_NAMESPACE}"`));
    assert.equal(PAIN001_NAMESPACE, "urn:iso:std:iso:20022:tech:xsd:pain.001.001.03");
  });

  it("följer schemats elementordning i GrpHdr och PmtInf", () => {
    const xml = serializePain001(beijerDoc());
    assertElementOrder(xml, [
      "Document", "CstmrCdtTrfInitn", "GrpHdr", "MsgId", "CreDtTm", "NbOfTxs", "CtrlSum", "InitgPty",
      "PmtInf", "PmtInfId", "PmtMtd", "BtchBookg", "ReqdExctnDt", "Dbtr", "DbtrAcct", "DbtrAgt",
      "ChrgBr", "CdtTrfTxInf", "PmtId", "EndToEndId", "Amt", "Cdtr", "CdtrAcct", "RmtInf",
    ]);
  });

  it("bär debitorns IBAN, BIC och organisationsnummer (enbart siffror)", () => {
    const xml = serializePain001(beijerDoc());
    assert.ok(xml.includes("<IBAN>SE2750000000054910004512</IBAN>"));
    assert.ok(xml.includes("<BIC>ESSESESS</BIC>"));
    assert.ok(xml.includes("<Id>5591234567</Id>"), "orgnr utan bindestreck");
    assert.ok(xml.includes("<Ccy>SEK</Ccy>"));
    assert.ok(xml.includes("<ChrgBr>SLEV</ChrgBr>"));
  });

  it("utan BIC används Othr/NOTPROVIDED (DbtrAgt är obligatoriskt i schemat)", () => {
    const xml = serializePain001(beijerDoc({ debtor: { ...DEBTOR, bic: undefined } }));
    assertWellFormedXml(xml);
    assert.ok(xml.includes("<Id>NOTPROVIDED</Id>"));
    assert.ok(!xml.includes("<BIC>"));
  });

  it("bankgiro blir Othr/Id med SchmeNm/Prtry = BGNR och enbart siffror", () => {
    const xml = serializePain001(beijerDoc());
    assert.ok(xml.includes("<Id>1234567</Id>"), "bankgiro utan bindestreck");
    assert.ok(xml.includes("<Prtry>BGNR</Prtry>"));
  });

  it("plusgiro blir PGNR och IBAN-mottagare blir CdtrAcct/Id/IBAN", () => {
    const doc = beijerDoc();
    doc.payments = [
      { ...doc.payments[0], creditorAccount: { kind: "plusgiro", account: "12 34 56-7" } },
      {
        ...doc.payments[0],
        endToEndId: "E2E0000000000000000000000000002",
        instructionId: "E2E0000000000000000000000000002",
        creditorAccount: { kind: "iban", account: "SE2750000000054910004512" },
      },
    ];
    const xml = serializePain001(doc);
    assert.ok(xml.includes("<Prtry>PGNR</Prtry>"));
    assert.ok(xml.includes("<Id>1234567</Id>"));
    // Samma betaldatum → en PmtInf: debitorns IBAN + mottagarens IBAN.
    const ibans = textOf(xml, "IBAN");
    assert.equal(ibans.length, 2);
  });

  it("OCR blir strukturerad SCOR-referens i RmtInf/Strd/CdtrRefInf", () => {
    const xml = serializePain001(beijerDoc());
    assert.ok(xml.includes("<Cd>SCOR</Cd>"));
    assert.ok(xml.includes("<Ref>48211</Ref>"));
    assert.ok(!xml.includes("<Ustrd>"));
  });

  it("utan OCR används Ustrd-meddelande i stället för SCOR", () => {
    const doc = beijerDoc();
    doc.payments[0] = { ...doc.payments[0], ocr: undefined, message: "Faktura BB-48211" };
    const xml = serializePain001(doc);
    assert.ok(xml.includes("<Ustrd>Faktura BB-48211</Ustrd>"));
    assert.ok(!xml.includes("<Cd>SCOR</Cd>"));
  });

  it("SEK-belopp har exakt två decimaler och CtrlSum stämmer", () => {
    const doc = beijerDoc();
    doc.payments = [
      doc.payments[0],
      {
        ...doc.payments[0],
        endToEndId: "E2E0000000000000000000000000002",
        instructionId: "E2E0000000000000000000000000002",
        amount: 1295,
        requestedExecutionDate: "2026-09-09",
      },
    ];
    const xml = serializePain001(doc);
    assert.ok(xml.includes(`<InstdAmt Ccy="SEK">18500.00</InstdAmt>`));
    assert.ok(xml.includes(`<InstdAmt Ccy="SEK">1295.00</InstdAmt>`));
    const sums = textOf(xml, "CtrlSum");
    assert.equal(sums[0], "19795.00", "GrpHdr/CtrlSum = summan");
    assert.equal(textOf(xml, "NbOfTxs")[0], "2");
    assert.equal(pain001Amount(875), "875.00");
  });

  it("flera betaldatum ger en PmtInf per datum, i datumordning", () => {
    const doc = beijerDoc();
    doc.payments = [
      { ...doc.payments[0], requestedExecutionDate: "2026-09-15" },
      {
        ...doc.payments[0],
        endToEndId: "E2E0000000000000000000000000002",
        instructionId: "E2E0000000000000000000000000002",
        amount: 1295,
        requestedExecutionDate: "2026-09-01",
      },
    ];
    const xml = serializePain001(doc);
    const dates = textOf(xml, "ReqdExctnDt");
    assert.deepEqual(dates, ["2026-09-01", "2026-09-15"]);
    assert.equal((xml.match(/<PmtInf>/g) ?? []).length, 2);
  });

  it("svenska tecken och specialtecken escapas korrekt", () => {
    const doc = beijerDoc();
    doc.payments[0] = { ...doc.payments[0], creditorName: "Söder & Öst <Bygg> \"AB\"" };
    const xml = serializePain001(doc);
    assertWellFormedXml(xml);
    assert.ok(xml.includes("Söder &amp; Öst &lt;Bygg&gt; &quot;AB&quot;"));
  });

  it("CreDtTm serialiseras med sekundupplösning", () => {
    const xml = serializePain001(beijerDoc());
    assert.ok(xml.includes("<CreDtTm>2026-08-30T07:00:00Z</CreDtTm>"));
  });
});

describe("pain.001: validering före serialisering (exakta fel, aldrig XML-fel)", () => {
  it("tomt dokument utan betalningar avvisas", () => {
    const problems = validatePain001Document(beijerDoc({ payments: [] }));
    assert.ok(problems.some((p) => p.includes("inga betalningar")));
  });

  it("saknat och ogiltigt debitor-IBAN ger klartextfel", () => {
    const missing = validatePain001Document(beijerDoc({ debtor: { ...DEBTOR, iban: "" } }));
    assert.ok(missing.some((p) => p.includes("betalkonto saknas")));
    const invalid = validatePain001Document(beijerDoc({ debtor: { ...DEBTOR, iban: "SE0000000000000000000000" } }));
    assert.ok(invalid.some((p) => p.includes("inte ett giltigt IBAN")));
  });

  it("ogiltigt bankgiro, OCR och belopp pekas ut med mottagarnamn", () => {
    const doc = beijerDoc();
    doc.payments[0] = { ...doc.payments[0], creditorAccount: { kind: "bankgiro", account: "12" } };
    assert.ok(validatePain001Document(doc).some((p) => p.includes("Beijer") && p.includes("ogiltigt")));

    const ocrDoc = beijerDoc();
    ocrDoc.payments[0] = { ...ocrDoc.payments[0], ocr: "ABC123" };
    assert.ok(validatePain001Document(ocrDoc).some((p) => p.includes("OCR")));

    const amountDoc = beijerDoc();
    amountDoc.payments[0] = { ...amountDoc.payments[0], amount: 10.005 };
    assert.ok(validatePain001Document(amountDoc).some((p) => p.includes("decimaler")));
  });

  it("serialisering av ogiltigt dokument kastar med problemen i meddelandet", () => {
    assert.throws(
      () => serializePain001(beijerDoc({ payments: [] })),
      /inga betalningar/
    );
  });

  it("IBAN mod-97 accepterar giltiga och avvisar manipulerade nummer", () => {
    assert.equal(isValidIban("SE27 5000 0000 0549 1000 4512"), true);
    assert.equal(isValidIban("SE2750000000054910004513"), false);
    assert.equal(isValidIban("INTE-ETT-IBAN"), false);
  });
});

describe("PaymentExportProvider-gränssnittet", () => {
  it("ISO20022_PAIN001-providern bygger fil med rätt metadata", () => {
    const provider = getPaymentExportProvider("ISO20022_PAIN001");
    assert.equal(provider.format, "ISO20022_PAIN001");
    assert.match(provider.profile, /pain\.001\.001\.03/);
    const result = provider.build({
      messageId: "DRIVA-20260830-070000-TEST02",
      createdAt: "2026-08-30T07:00:00.000Z",
      payer: { name: DEBTOR.name, orgNumber: DEBTOR.orgNumber, iban: DEBTOR.iban, bic: DEBTOR.bic },
      instructions: [
        {
          instructionId: "E2E0000000000000000000000000001",
          endToEndId: "E2E0000000000000000000000000001",
          amount: 18500,
          currency: "SEK",
          requestedExecutionDate: "2026-09-09",
          recipientName: "Beijer Byggmaterial AB",
          recipientAccount: { kind: "bankgiro", account: "123-4567" },
          ocr: "48211",
        },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.extension, "xml");
    assert.match(result.contentType, /application\/xml/);
    assertWellFormedXml(result.content);
  });

  it("validate ger samma problem som build utan att generera", () => {
    const provider = getPaymentExportProvider();
    const request = {
      messageId: "DRIVA-20260830-070000-TEST03",
      createdAt: "2026-08-30T07:00:00.000Z",
      payer: { name: DEBTOR.name, iban: "" },
      instructions: [],
    };
    const problems = provider.validate(request);
    const result = provider.build(request);
    assert.equal(result.ok, false);
    if (!result.ok) assert.deepEqual(result.problems, problems);
  });
});
