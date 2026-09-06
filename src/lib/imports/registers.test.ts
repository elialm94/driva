process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb, testCompany, testCustomer } from "../invoices/test-db";
import { csvToTable } from "../wholesalers/csv";
import { buildXlsx, CSV_SEMICOLON } from "../__fixtures__/wholesalers/build";
import { sieBytesPc8, standardSieOptions } from "../__fixtures__/sie/build";
import {
  classifyRegisterTable,
  detectRegisterMapping,
  previewCustomerImport,
  previewSupplierImport,
  sanitizeRegisterMapping,
} from "./registers";
import { parseAiTableSuggestion } from "./classify-ai";
import { analyzeImportFile, DataImportError, fileHashHex, runImport } from "../services/data-imports";
import { activateOptionalFeature } from "../features";
import { createWholesalerConnection } from "../services/wholesalers";
import { __resetCatalogCacheForTests } from "../wholesalers/catalog-store";

const CUSTOMERS_CSV = [
  "Kundnamn;Kontaktperson;Org.nr;E-post;Telefon;Adress;Postnr;Ort;Typ;Fastighetsbeteckning",
  "BRF Ekbacken;Lisa Berg;769612-3456;styrelsen@ekbacken.se;08-123 45 67;Ekvägen 1;116 24;Stockholm;Företag;",
  "Anna Andersson;;19850101-1234;anna@example.com;070-111 22 33;Björkvägen 2;11630;Stockholm;Privat;Stockholm Björken 3",
  "Fel Epost AB;;556677-8899;inte-en-mejl;;Storgatan 3;123 45;Solna;Företag;",
  ";;;;;;;;;",
  "Anna Andersson;;;anna@example.com;;;;;Privat;",
  "Karl Karlsson;;;karl@example.com;;Vägen 1;1234;Täby;Privat;",
].join("\n");

const SUPPLIERS_CSV = [
  "Leverantör,Organisationsnummer,Bankgiro,E-post,Telefon,IBAN",
  "Elgrossisten AB,556123-4567,5678-1234,order@elgrossisten.se,010-123 45 67,",
  "Rörcenter,556987-6543,123-4567,info@rorcenter.se,,SE4550000000058398257466",
  "Trasig Bankgiro HB,,12,x@y.se,,",
].join("\n");

const ODD_HEADERS_CSV = ["Företagets namn|Kundens e-postadress|Mobiltelefon|Utdelningsadress|Postnr|Postort", "Måleri Nord AB|info@malerinord.se|0701234567|Norra vägen 5|90325|Umeå"].join("\n");

function freshDb() {
  __resetCatalogCacheForTests();
  replaceDb(
    emptyTestDb({
      settings: { ...testCompany(), orgNumber: "559123-4567" },
      customers: [testCustomer({ id: "cust-1", name: "BRF Ekbacken", email: "styrelsen@ekbacken.se" })],
      fiscalYears: [],
      verifications: [],
    }),
  );
  return db();
}

describe("Registerimport – klassning och kolumnmappning", () => {
  it("känner igen kund-, leverantörs- och artikelregister på rubrikerna", () => {
    assert.equal(classifyRegisterTable(csvToTable(CUSTOMERS_CSV)).kind, "kunder");
    assert.equal(classifyRegisterTable(csvToTable(SUPPLIERS_CSV)).kind, "leverantorer");
    assert.equal(classifyRegisterTable(csvToTable(CSV_SEMICOLON)).kind, "artiklar");
    assert.equal(classifyRegisterTable(csvToTable("Kolumn A;Kolumn B\n1;2")).kind, "unknown");
  });

  it("mappar vanliga svenska rubriker och ovanliga varianter, med innehållsheuristik som stöd", () => {
    const detected = detectRegisterMapping(csvToTable(CUSTOMERS_CSV), "kunder");
    assert.equal(detected.mapping.name, "Kundnamn");
    assert.equal(detected.mapping.contactPerson, "Kontaktperson");
    assert.equal(detected.mapping.orgNumber, "Org.nr");
    assert.equal(detected.mapping.email, "E-post");
    assert.equal(detected.mapping.phone, "Telefon");
    assert.equal(detected.mapping.address, "Adress");
    assert.equal(detected.mapping.postalCode, "Postnr");
    assert.equal(detected.mapping.city, "Ort");
    assert.equal(detected.mapping.kind, "Typ");
    assert.equal(detected.mapping.propertyDesignation, "Fastighetsbeteckning");

    const odd = detectRegisterMapping(csvToTable(ODD_HEADERS_CSV), "kunder");
    assert.equal(odd.mapping.name, "Företagets namn");
    assert.equal(odd.mapping.email, "Kundens e-postadress");
    assert.equal(odd.mapping.phone, "Mobiltelefon");
    assert.equal(odd.mapping.address, "Utdelningsadress");
    assert.equal(odd.mapping.postalCode, "Postnr");
    assert.equal(odd.mapping.city, "Postort");
    // "e-postadress" får aldrig bli adress.
    assert.notEqual(odd.mapping.address, "Kundens e-postadress");

    const sup = detectRegisterMapping(csvToTable(SUPPLIERS_CSV), "leverantorer");
    assert.equal(sup.mapping.name, "Leverantör");
    assert.equal(sup.mapping.bankgiro, "Bankgiro");
    assert.equal(sup.mapping.iban, "IBAN");
  });

  it("användaren kan rätta mappningen – bara rubriker som finns i filen accepteras", () => {
    const table = csvToTable(CUSTOMERS_CSV);
    const corrected = sanitizeRegisterMapping(table, "kunder", { name: "Kontaktperson", email: "Finns inte", bankgiro: "Org.nr" });
    assert.deepEqual(corrected, { name: "Kontaktperson" });
    const preview = previewCustomerImport(table, { name: "Kontaktperson" }, []);
    assert.equal(preview.drafts[0].name, "Lisa Berg");
    // Rader utan värde i den valda namnkolumnen faller bort med radnummer.
    assert.ok(preview.invalid.some((i) => i.line === 3));
  });
});

describe("Registerimport – förhandsgranskning och dubbletter", () => {
  beforeEach(() => {
    freshDb();
  });

  it("kunder: dubbletter mot registret och i filen hoppas över, fel i frivilliga fält flaggas men raden tas med", () => {
    const table = csvToTable(CUSTOMERS_CSV);
    const preview = previewCustomerImport(table, detectRegisterMapping(table, "kunder").mapping, db().customers);
    // Den tomma raden faller bort redan i CSV-läsningen.
    assert.equal(preview.rowCount, 5);
    // BRF Ekbacken finns redan (e-post), Anna nr 2 är dubblett i filen.
    assert.deepEqual(
      preview.duplicates.map((d) => [d.line, d.matchedOn]),
      [
        [2, "e-post"],
        [5, "samma rad två gånger i filen"],
      ],
    );
    assert.deepEqual(preview.invalid, []);
    assert.equal(preview.drafts.length, 3);
    const anna = preview.drafts.find((d) => d.name === "Anna Andersson")!;
    assert.equal(anna.kind, "privat");
    assert.equal(anna.personalIdentityNumber, "19850101-1234");
    assert.equal(anna.postalCode, "116 30");
    assert.deepEqual(anna.propertyDesignations, ["Stockholm Björken 3"]);
    const fel = preview.drafts.find((d) => d.name === "Fel Epost AB")!;
    assert.equal(fel.kind, "foretag");
    assert.equal(fel.email, "");
    assert.equal(fel.orgNumber, "556677-8899");
    assert.ok(preview.review.some((r) => r.line === 4 && /e-postadressen/.test(r.message)));
    const karl = preview.drafts.find((d) => d.name === "Karl Karlsson")!;
    assert.equal(karl.postalCode, undefined);
    assert.ok(preview.review.some((r) => r.line === 6 && /postnumret/.test(r.message)));
  });

  it("leverantörer: betalningsuppgifter valideras per fält och lämnas tomma vid fel", () => {
    const table = csvToTable(SUPPLIERS_CSV);
    const preview = previewSupplierImport(table, detectRegisterMapping(table, "leverantorer").mapping, []);
    assert.equal(preview.drafts.length, 3);
    assert.equal(preview.drafts[0].bankgiro, "5678-1234");
    assert.equal(preview.drafts[1].iban, "SE4550000000058398257466");
    assert.equal(preview.drafts[2].bankgiro, undefined);
    assert.ok(preview.review.some((r) => r.line === 4 && /bankgirot/.test(r.message)));
    // Andra gången: alla finns redan.
    const again = previewSupplierImport(table, preview.mapping, [{ id: "s", name: "Elgrossisten AB", source: "import", createdAt: "", updatedAt: "" }]);
    assert.equal(again.duplicates.length, 1);
    assert.equal(again.drafts.length, 2);
  });
});

describe("Dataimport – analys, genomförande, idempotens", () => {
  beforeEach(() => {
    freshDb();
  });

  it("identifierar SIE på innehållet, register på rubrikerna, PDF som ej importerbar och okänt som val", async () => {
    const sie = await analyzeImportFile(Buffer.from(sieBytesPc8(standardSieOptions())), "export.se", { allowAi: false });
    assert.equal(sie.kind, "bokforing");
    assert.equal(sie.fileKind, "sie");
    assert.match(sie.subtitle, /SIE-fil • 3 verifikationer • 2025-01-01–2025-12-31/);
    assert.equal(sie.source, "deterministic");
    // Utan filändelse: fortfarande SIE på innehållet.
    const noExt = await analyzeImportFile(Buffer.from(sieBytesPc8(standardSieOptions())), "export", { allowAi: false });
    assert.equal(noExt.kind, "bokforing");

    const kunder = await analyzeImportFile(Buffer.from(CUSTOMERS_CSV, "utf8"), "kunder.csv", { allowAi: false });
    assert.equal(kunder.kind, "kunder");
    assert.match(kunder.subtitle, /CSV • 3 kunder • 2 finns redan • 2 rader behöver kontrolleras/);
    assert.equal(kunder.register?.mapping.name, "Kundnamn");

    const xlsx = await analyzeImportFile(buildXlsx([["Leverantör", "Bankgiro"], ["Elgrossisten AB", "5678-1234"]]), "lev.xlsx", { allowAi: false });
    assert.equal(xlsx.kind, "leverantorer");
    assert.match(xlsx.subtitle, /Excel • 1 leverantör/);

    const pdf = await analyzeImportFile(Buffer.from("%PDF-1.4 fake"), "kvitto.pdf");
    assert.equal(pdf.kind, "unsupported");
    assert.match(pdf.message ?? "", /Inboxen/);

    const unknown = await analyzeImportFile(Buffer.from("Kolumn A;Kolumn B\n1;2\n", "utf8"), "x.csv", { allowAi: false });
    assert.equal(unknown.kind, "unknown");
    assert.equal(unknown.canChooseKind, true);
    // Användaren väljer: kunder → mappningsvyn visas med kolumnerna, inget "namn" hittat.
    const chosen = await analyzeImportFile(Buffer.from("Kolumn A;Kolumn B\nKalle;kalle@x.se\n", "utf8"), "x.csv", { kindOverride: "kunder", allowAi: false });
    assert.equal(chosen.kind, "kunder");
    assert.deepEqual(chosen.register?.problems, ["Välj vilken kolumn som är namnet."]);
    // …och rättar manuellt.
    const fixed = await analyzeImportFile(Buffer.from("Kolumn A;Kolumn B\nKalle;kalle@x.se\n", "utf8"), "x.csv", {
      kindOverride: "kunder",
      mapping: { name: "Kolumn A", email: "Kolumn B" },
      allowAi: false,
    });
    assert.deepEqual(fixed.register?.problems, []);
    assert.equal(fixed.register?.created, 1);
  });

  it("AI avstängd eller trasig: analysen fungerar deterministiskt och AI-svar utanför schemat ignoreras", async () => {
    const without = await analyzeImportFile(Buffer.from("Kolumn A;Kolumn B\n1;2\n", "utf8"), "x.csv");
    assert.equal(without.aiAvailable, false);
    assert.equal(without.source, "deterministic");
    assert.equal(parseAiTableSuggestion("garbage", ["A"]), null);
    assert.equal(parseAiTableSuggestion({ kind: "bokforing" }, ["A"]), null);
    const ok = parseAiTableSuggestion({ kind: "kunder", mapping: { name: "Namn ", email: "Påhittad", bankgiro: "Namn" }, reason: "x" }, ["Namn", "Mejl"]);
    assert.deepEqual(ok, { kind: "kunder", mapping: { name: "Namn" }, reason: "x" });
  });

  it("importerar kunder, auditerar med hash och vägrar samma fil en andra gång", async () => {
    const bytes = Buffer.from(CUSTOMERS_CSV, "utf8");
    const hash = fileHashHex(bytes);
    const analysis = await analyzeImportFile(bytes, "kunder.csv", { allowAi: false });
    const outcome = await runImport(bytes, "kunder.csv", { kind: "kunder", expectedHash: hash, mapping: analysis.register!.mapping, userId: "u1" });
    assert.equal(outcome.created, 3);
    assert.equal(outcome.ignored, 2);
    assert.equal(db().customers.length, 4);
    const anna = db().customers.find((c) => c.name === "Anna Andersson")!;
    assert.equal(anna.personalIdentityNumber, "19850101-1234");
    assert.equal(anna.workLocations?.length, 1);
    assert.equal(anna.workLocations?.[0].propertyDesignation, "Stockholm Björken 3");
    const audit = db().dataImports![0];
    assert.equal(audit.kind, "kunder");
    assert.equal(audit.fileHash, hash);
    assert.equal(audit.userId, "u1");
    assert.equal(audit.status, "imported");
    assert.deepEqual((audit.choices as { mapping: unknown }).mapping, analysis.register!.mapping);

    await assert.rejects(
      () => runImport(bytes, "kunder.csv", { kind: "kunder", expectedHash: hash, mapping: analysis.register!.mapping }),
      (e: unknown) => e instanceof DataImportError && /redan importerad/.test(e.message),
    );
    const again = await analyzeImportFile(bytes, "kunder.csv", { allowAi: false });
    assert.ok(again.alreadyImported);
    // Ändrad fil mellan förhandsgranskning och bekräftelse stoppas.
    await assert.rejects(
      () => runImport(Buffer.from(CUSTOMERS_CSV + "\nNy;;;;;;;;;", "utf8"), "kunder.csv", { kind: "kunder", expectedHash: hash }),
      /har ändrats/,
    );
  });

  it("importerar leverantörer till registret", async () => {
    const bytes = Buffer.from(SUPPLIERS_CSV, "utf8");
    const outcome = await runImport(bytes, "lev.csv", { kind: "leverantorer", expectedHash: fileHashHex(bytes) });
    assert.equal(outcome.created, 3);
    assert.equal(db().suppliers!.length, 3);
    assert.equal(db().suppliers![0].source, "import");
    assert.equal(outcome.nextHref, "/ekonomi?flik=utgifter");
  });

  it("SIE: valda räkenskapsår importeras atomärt och fel lämnar bokföringen orörd", async () => {
    const bytes = Buffer.from(sieBytesPc8(standardSieOptions()));
    const hash = fileHashHex(bytes);
    await assert.rejects(() => runImport(bytes, "b.se", { kind: "bokforing", expectedHash: hash, yearIndexes: [] }), /Välj minst ett/);
    assert.equal(db().verifications.length, 0);
    assert.equal(db().dataImports?.length ?? 0, 0);
    const outcome = await runImport(bytes, "b.se", { kind: "bokforing", expectedHash: hash, yearIndexes: [0] });
    assert.equal(outcome.created, 3);
    assert.equal(db().verifications.length, 3);
    assert.equal(db().verifications[0].source.type, "sie_import");
    assert.equal((db().verifications[0].source as { id: string }).id, outcome.importId);
    assert.equal(db().dataImports![0].summary, "3 verifikationer · 2025 · ingående balanser");
    await assert.rejects(() => runImport(bytes, "b.se", { kind: "bokforing", expectedHash: hash, yearIndexes: [0] }), /redan importerad/);
  });

  it("artiklar och priser går via grossistmodulen – inga dubbla kataloger", async () => {
    const bytes = Buffer.from(CSV_SEMICOLON, "utf8");
    const hash = fileHashHex(bytes);
    // Funktionen avstängd: analysen förklarar, importen stoppas.
    const off = await analyzeImportFile(bytes, "prislista.csv", { allowAi: false });
    assert.equal(off.kind, "artiklar");
    assert.equal(off.articles?.featureEnabled, false);
    assert.match(off.message ?? "", /Grossistbeställningar/);
    await assert.rejects(
      () => runImport(bytes, "prislista.csv", { kind: "artiklar", expectedHash: hash, connectionId: "x" }, (fn) => Promise.resolve(fn())),
      /avstängd/,
    );

    activateOptionalFeature("wholesalers");
    const connection = createWholesalerConnection({
      wholesaler: "ahlsell",
      customerNumber: "123456",
      orderEmail: "order@ahlsell-test.se",
      defaultDeliveryMode: "pickup",
      defaultStore: "Ahlsell Västberga",
      customerPriceRule: { kind: "markup", percent: 30 },
    });
    const on = await analyzeImportFile(bytes, "prislista.csv", { allowAi: false });
    assert.deepEqual(on.articles?.connections.map((c) => c.id), [connection.id]);
    assert.match(on.subtitle, /4 artiklar/);
    const outcome = await runImport(bytes, "prislista.csv", { kind: "artiklar", expectedHash: hash, connectionId: connection.id }, (fn) => Promise.resolve(fn()));
    assert.equal(outcome.created, 4);
    assert.equal(outcome.nextHref, "/installningar?flik=grossister");
    const imports = db().wholesalerPriceImports ?? [];
    assert.equal(imports.filter((i) => i.status === "active").length, 1);
    assert.equal(db().dataImports!.filter((i) => i.kind === "artiklar").length, 1);
    await assert.rejects(
      () => runImport(bytes, "prislista.csv", { kind: "artiklar", expectedHash: hash, connectionId: connection.id }, (fn) => Promise.resolve(fn())),
      /redan importerad/,
    );
    assert.equal((db().wholesalerPriceImports ?? []).length, 1, "ingen andra katalogimport skapades");
  });
});
