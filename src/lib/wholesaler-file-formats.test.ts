process.env.DRIVA_TEST = "1";

/**
 * Kända grossistformat: Ahlsell avtalsfil (rabattbrev, 93-teckensrader) och
 * Ahlsell prisfil (bruttoprislista, 112-teckensrader). Fältpositionerna är
 * hårdkodade ur Ahlsells beskrivning – testerna använder beskrivningens egna
 * exempelrader ordagrant.
 *
 * Fixturen ahlsell-avtalsfil.txt är ett redigerat utdrag (kundnummer
 * 9999999) ur en riktig avtalsfil: ISO-8859-1, CRLF, 282 rader. Hela filen
 * testas när AHLSELL_AVTALSFIL pekar på den (eller den ligger i ~/Downloads).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db, replaceDb } from "./store";
import { emptyTestDb, testCompany } from "./invoices/test-db";
import { activateOptionalFeature } from "./features";
import {
  connectionOverview,
  createWholesalerConnection,
  importPriceFile,
  previewPriceFile,
  searchWholesalerProducts,
  type ImportRunner,
} from "./services/wholesalers";
import { __resetCatalogCacheForTests } from "./wholesalers/catalog-store";
import { parsePriceFile, previewImport } from "./wholesalers/import-engine";
import { PriceFileError } from "./wholesalers/file-detect";
import { decodeFixedWidthText, parseYYMMDD, splitFixedWidthLines } from "./wholesalers/formats/fixed-width";
import {
  AHLSELL_AGREEMENT_HEADER_LENGTH,
  AHLSELL_AGREEMENT_ROW_LENGTH,
  detectAhlsellAgreement,
  parseAhlsellAgreement,
} from "./wholesalers/formats/ahlsell-avtalsfil";
import { AHLSELL_PRICE_ROW_LENGTH, parseAhlsellPriceList } from "./wholesalers/formats/ahlsell-prisfil";
import { detectWholesalerFormat, KNOWN_FORMAT_THRESHOLD } from "./wholesalers/formats/registry";
import { MIN_ROWS_FOR_KNOWN_FORMAT, WholesalerFileParseError } from "./wholesalers/formats/types";
import {
  agreementCoverage,
  applyDiscountTenths,
  classPrefixes,
  indexAgreementTerms,
  pickClassTerm,
  resolvePurchasePrice,
} from "./wholesalers/agreement-pricing";
import { CSV_SEMICOLON } from "./__fixtures__/wholesalers/build";
import type { WholesalerAgreementTerm, WholesalerProduct } from "./types";

/* ------------------------------- specens rader ------------------------------ */

// Exakt ur Ahlsells beskrivning (positionerna räknas från 1).
const SPEC_HEADER = " 19999999000R87 VS WC-MALL NIVÅ 2         N                              301231";
const SPEC_CLASS_ROW = " 1N9999999                    BÄ0100042000000000000000000BANSK TVÄTT & TORK            301231";
const SPEC_SPEC_DISCOUNT_ROW = " 1N9999999100506                    000005950000000000000                              301231";
const SPEC_NET_PRICE_ROW = " 1N99999997744709                   000000000003465000000                              301231";
const SPEC_FIVE_CHAR_CLASS_ROW = " 1N9999999                    CÄÄ01 055400000000000000000CANSK ARMERINGSSTÅL OCH NÄT   301231";

const FIXTURE = path.join(__dirname, "__fixtures__", "wholesalers", "ahlsell-avtalsfil.txt");

function agreementText(...rows: string[]): string {
  return [SPEC_HEADER, ...rows].join("\r\n") + "\r\n";
}

/** En syntetisk avtalsfil med tillräckligt många rader för att kännas igen. */
function syntheticAgreement(rowCount = MIN_ROWS_FOR_KNOWN_FORMAT + 5): string {
  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const cls = `TE${String(i).padStart(4, "0")}`;
    const tenths = String(100 + i).padStart(4, "0");
    rows.push(` 1N9999999                    ${cls}${tenths}00000000000000000${"TESTKLASS".padEnd(30, " ")}301231`);
  }
  return agreementText(...rows);
}

/** En Ahlsell-prisfil (112 tecken per rad) byggd fält för fält. */
function priceRow(a: {
  articleNumber: string;
  priceOre: number;
  materialClass: string;
  unit?: string;
  stocked?: "J" | "N";
  name: string;
  multiple?: number;
}): string {
  const row =
    a.articleNumber.padEnd(20, " ") +
    String(a.priceOre).padStart(12, "0") +
    a.materialClass.padEnd(6, " ") +
    (a.unit ?? "ST").padEnd(3, " ") +
    (a.stocked ?? "J") +
    a.name.padEnd(60, " ") +
    String(Math.round((a.multiple ?? 1) * 100)).padStart(7, "0") +
    "N" +
    "N" +
    "N";
  assert.equal(row.length, AHLSELL_PRICE_ROW_LENGTH, `prisrad ${a.articleNumber} har fel längd`);
  return row;
}

function syntheticPriceList(extra: string[] = []): string {
  const rows = [
    priceRow({ articleNumber: "100506", priceOre: 100_000, materialClass: "BÄ0100", name: "TVÄTTMASKIN TEST" }),
    priceRow({ articleNumber: "7744709", priceOre: 500_000, materialClass: "CÄÄ011", name: "ARMERINGSNÄT TEST" }),
    priceRow({ articleNumber: "5550001", priceOre: 189_000, materialClass: "BÄ0100", name: "TORKTUMLARE TEST", multiple: 1 }),
    priceRow({ articleNumber: "5550002", priceOre: 12_345, materialClass: "CÄÄ011", name: "ARMERINGSSTÅL 8 MM", unit: "M" }),
    priceRow({ articleNumber: "5550003", priceOre: 0, materialClass: "ZZ9999", name: "PRIS PÅ BEGÄRAN", stocked: "N" }),
    priceRow({ articleNumber: "5550004", priceOre: 45_000, materialClass: "ZZ9999", name: "UTAN RABATT I AVTALET" }),
    ...extra,
  ];
  // Fyll upp till 50+ rader så att formatet känns igen.
  for (let i = rows.length; i < MIN_ROWS_FOR_KNOWN_FORMAT + 3; i++) {
    rows.push(priceRow({ articleNumber: `9${String(i).padStart(6, "0")}`, priceOre: 1000 + i, materialClass: "BÄ0100", name: `FYLLNAD ${i}` }));
  }
  return rows.join("\r\n") + "\r\n";
}

const run: ImportRunner = async (fn) => fn();

/** Svensk talformatering använder hårt mellanslag (U+00A0) – jämför med vanliga mellanslag. */
function plain(text: string | undefined): string {
  return (text ?? "").replace(/\u00a0/g, " ");
}

function freshDb() {
  __resetCatalogCacheForTests();
  replaceDb(emptyTestDb({ settings: { ...testCompany(), name: "Rörmokarn AB" } }));
  activateOptionalFeature("wholesalers");
}

function ahlsell(customerNumber = "9999999") {
  return createWholesalerConnection({
    wholesaler: "ahlsell",
    customerNumber,
    orderEmail: "order@ahlsell-test.se",
    defaultDeliveryMode: "pickup",
    customerPriceRule: { kind: "later" },
  });
}

/* ------------------------------------------------------------------------- */

describe("Ahlsell avtalsfil – fältpositioner ur beskrivningen", () => {
  it("huvudraden: typ, kundnummer, anläggning, benämning, kedjerabatt och körningsdatum", () => {
    assert.equal(SPEC_HEADER.length, AHLSELL_AGREEMENT_HEADER_LENGTH);
    const parsed = parseAhlsellAgreement(agreementText(SPEC_CLASS_ROW));
    assert.deepEqual(parsed.header, {
      agreementType: "1",
      customerNumber: "9999999",
      facilityNumber: "000",
      name: "R87 VS WC-MALL NIVÅ 2",
      chainDiscount: "N",
      runDate: "2030-12-31",
    });
  });

  it("materialklassrad: BÄ0100, 42,0 %, text, slutdatum, ingen artikel", () => {
    assert.equal(SPEC_CLASS_ROW.length, AHLSELL_AGREEMENT_ROW_LENGTH);
    const parsed = parseAhlsellAgreement(agreementText(SPEC_CLASS_ROW));
    assert.equal(parsed.classDiscounts.length, 1);
    assert.equal(parsed.articleTerms.length, 0);
    const c = parsed.classDiscounts[0];
    assert.equal(c.materialClass, "BÄ0100");
    assert.equal(c.discountTenths, 420);
    assert.equal(c.text, "BANSK TVÄTT & TORK");
    assert.equal(c.endDate, "2030-12-31");
    assert.equal(c.chainDiscountCode, "N");
    assert.equal(parsed.endDate, "2030-12-31");
  });

  it("artikelrad med specrabatt: 100506, 59,5 %, inget nettopris", () => {
    const parsed = parseAhlsellAgreement(agreementText(SPEC_SPEC_DISCOUNT_ROW));
    assert.equal(parsed.classDiscounts.length, 0);
    assert.equal(parsed.articleTerms.length, 1);
    const a = parsed.articleTerms[0];
    assert.equal(a.articleNumber, "100506");
    assert.equal(a.specDiscountTenths, 595);
    assert.equal(a.netPriceOre, undefined);
  });

  it("artikelrad med nettopris: 7744709, 346 500 ören = 3 465,00 kr, ingen specrabatt", () => {
    const parsed = parseAhlsellAgreement(agreementText(SPEC_NET_PRICE_ROW));
    const a = parsed.articleTerms[0];
    assert.equal(a.articleNumber, "7744709");
    assert.equal(a.netPriceOre, 346_500);
    assert.equal(a.netPriceOre / 100, 3465);
    assert.equal(a.specDiscountTenths, undefined);
  });

  it("femteckensklass: CÄÄ01 med 55,4 % – artikel i CÄÄ011 träffar via prefix när exakt klass saknas", () => {
    const parsed = parseAhlsellAgreement(agreementText(SPEC_FIVE_CHAR_CLASS_ROW, SPEC_CLASS_ROW));
    const five = parsed.classDiscounts.find((c) => c.materialClass === "CÄÄ01");
    assert.ok(five, "CÄÄ01 saknas");
    assert.equal(five.discountTenths, 554);
    assert.equal(five.text, "CANSK ARMERINGSSTÅL OCH NÄT");

    const terms: WholesalerAgreementTerm[] = parsed.classDiscounts.map((c, i) => ({
      id: `t${i}`,
      connectionId: "c1",
      agreementId: "a1",
      kind: "class",
      materialClass: c.materialClass,
      materialClassText: c.text,
      discountTenths: c.discountTenths,
    }));
    const index = indexAgreementTerms(terms);
    assert.deepEqual(classPrefixes("CÄÄ011"), ["CÄÄ011", "CÄÄ01", "CÄÄ0", "CÄÄ", "CÄ", "C"]);
    assert.equal(pickClassTerm("CÄÄ011", index.byClass)?.materialClass, "CÄÄ01");
    assert.equal(pickClassTerm("BÄ0100", index.byClass)?.materialClass, "BÄ0100");
    assert.equal(pickClassTerm("XX0000", index.byClass), undefined);

    // Exakt klass vinner över prefix när båda finns.
    const exact: WholesalerAgreementTerm = { id: "t9", connectionId: "c1", agreementId: "a1", kind: "class", materialClass: "CÄÄ011", discountTenths: 100 };
    assert.equal(pickClassTerm("CÄÄ011", indexAgreementTerms([...terms, exact]).byClass)?.discountTenths, 100);
  });

  it("YYMMDD tolkas som 20YY-MM-DD; 000000 = inget datum; skräp ger fel med radnummer", () => {
    assert.equal(parseYYMMDD("301231", "SLUTDATUM", 2), "2030-12-31");
    assert.equal(parseYYMMDD("000000", "SLUTDATUM", 2), undefined);
    assert.throws(() => parseYYMMDD("991399", "SLUTDATUM", 7), (e: unknown) => e instanceof WholesalerFileParseError && /Rad 7/.test(e.message));
  });

  it("rad med både artikelnummer och materialklass avvisas med radnummer", () => {
    // Artikelnummer i 11–30 OCH materialklass i 31–36.
    const both = " 1N9999999100506              BÄ0100042000000000000000000BANSK TVÄTT & TORK            301231";
    assert.equal(both.length, AHLSELL_AGREEMENT_ROW_LENGTH);
    assert.throws(
      () => parseAhlsellAgreement(agreementText(SPEC_CLASS_ROW, both)),
      (e: unknown) => e instanceof WholesalerFileParseError && e.row === 3 && /både/i.test(e.message),
    );
    // …och detekteringen säger nej till en sådan rad.
    assert.equal(detectAhlsellAgreement([SPEC_HEADER, both]), 0);
  });

  it("rad med varken artikelnummer eller materialklass avvisas", () => {
    const neither = " 1N9999999                          000000000000000000000                              301231";
    assert.equal(neither.length, AHLSELL_AGREEMENT_ROW_LENGTH);
    assert.throws(() => parseAhlsellAgreement(agreementText(neither)), WholesalerFileParseError);
  });

  it("rad med fel längd eller bokstäver i numeriska fält avvisas – ingen gissning", () => {
    assert.throws(() => parseAhlsellAgreement(agreementText(SPEC_CLASS_ROW.slice(0, 92))), WholesalerFileParseError);
    const letters = SPEC_CLASS_ROW.slice(0, 36) + "04X0" + SPEC_CLASS_ROW.slice(40);
    assert.throws(() => parseAhlsellAgreement(agreementText(letters)), WholesalerFileParseError);
  });

  it("KEDJERABATTKOD J parsas och räknas – men ingen rabattberäkning bygger på den", () => {
    const j = SPEC_CLASS_ROW.slice(0, 2) + "J" + SPEC_CLASS_ROW.slice(3, 53) + "0100" + SPEC_CLASS_ROW.slice(57);
    assert.equal(j.length, AHLSELL_AGREEMENT_ROW_LENGTH);
    const parsed = parseAhlsellAgreement(agreementText(j));
    assert.equal(parsed.chainDiscountRows, 1);
    assert.equal(parsed.classDiscounts[0].chainDiscountCode, "J");
    assert.equal(parsed.classDiscounts[0].chainDiscountTenths, 100);
    // Rabatten som används är materialklassrabatten, inte kedjerabatten.
    assert.equal(parsed.classDiscounts[0].discountTenths, 420);
  });
});

describe("Ahlsell avtalsfil – teckenkodning och radslut", () => {
  it("ISO-8859-1 dekodas explicit: BÄ0100 blir BÄ0100 (och är ogiltig UTF-8)", () => {
    const bytes = Buffer.from(agreementText(SPEC_CLASS_ROW), "latin1");
    assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes), "raden borde inte vara giltig UTF-8");
    const { text, encoding } = decodeFixedWidthText(bytes);
    assert.equal(encoding, "iso-8859-1");
    const parsed = parseAhlsellAgreement(text);
    assert.equal(parsed.classDiscounts[0].materialClass, "BÄ0100");
    assert.equal(parsed.classDiscounts[0].text, "BANSK TVÄTT & TORK");
    assert.equal(parsed.header.name, "R87 VS WC-MALL NIVÅ 2");
  });

  it("giltig UTF-8 dekodas som UTF-8, BOM tas bort", () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(agreementText(SPEC_CLASS_ROW), "utf8")]);
    const { text, encoding } = decodeFixedWidthText(bytes);
    assert.equal(encoding, "utf-8");
    assert.equal(parseAhlsellAgreement(text).classDiscounts[0].materialClass, "BÄ0100");
  });

  it("CRLF, LF och CR ger samma rader; tomma rader ignoreras; ingen trimning före slicing", () => {
    const crlf = splitFixedWidthLines(`${SPEC_HEADER}\r\n${SPEC_CLASS_ROW}\r\n\r\n`);
    const lf = splitFixedWidthLines(`${SPEC_HEADER}\n${SPEC_CLASS_ROW}\n`);
    const cr = splitFixedWidthLines(`${SPEC_HEADER}\r${SPEC_CLASS_ROW}\r`);
    assert.deepEqual(crlf, [SPEC_HEADER, SPEC_CLASS_ROW]);
    assert.deepEqual(lf, crlf);
    assert.deepEqual(cr, crlf);
    // Inledande blanksteg är en del av formatet (TYP = " 1").
    assert.equal(crlf[1][0], " ");
  });
});

describe("Ahlsell avtalsfil – fixturen och hela filen", () => {
  it("fixturen (redigerat utdrag) läses som ISO-8859-1 och ger rätt antal per radtyp", () => {
    const bytes = fs.readFileSync(FIXTURE);
    assert.ok(bytes.includes(Buffer.from("\r\n")), "fixturen ska ha CRLF");
    const { text, encoding } = decodeFixedWidthText(bytes);
    assert.equal(encoding, "iso-8859-1", "fixturen ska vara ISO-8859-1 – har den sparats om som UTF-8?");
    const detection = detectWholesalerFormat(text);
    assert.equal(detection.outcome, "known");
    assert.equal(detection.outcome === "known" && detection.parser.id, "ahlsell-avtalsfil");

    const parsed = parseAhlsellAgreement(text);
    assert.equal(parsed.header.customerNumber, "9999999", "fixturen får inte innehålla ett riktigt kundnummer");
    // Det riktiga kundnumret finns inte kvar i repot, så det kan inte nämnas här. I stället
    // kontrolleras positivt att varje KUNDNUMMER-fält i filen är det redigerade numret – det
    // faller om fixturen någon gång byts mot ett oredigerat utdrag.
    const fixtureLines = splitFixedWidthLines(text);
    assert.deepEqual(
      [...new Set([fixtureLines[0].slice(2, 9), ...fixtureLines.slice(1).map((l) => l.slice(3, 10))])],
      ["9999999"],
      "fixturen får inte innehålla det riktiga kundnumret",
    );
    assert.equal(parsed.rowCount, 282);
    assert.equal(parsed.classDiscounts.length, 232);
    assert.equal(parsed.articleTerms.length, 50);
    assert.equal(parsed.articleTerms.filter((t) => t.specDiscountTenths != null).length, 25);
    assert.equal(parsed.articleTerms.filter((t) => t.netPriceOre != null).length, 25);
    assert.equal(parsed.classDiscounts.filter((c) => c.materialClass.length === 5).length, 32);
    assert.equal(parsed.classDiscounts.find((c) => c.materialClass === "BÄ0100")?.discountTenths, 420);
    assert.equal(parsed.classDiscounts.find((c) => c.materialClass === "CÄÄ01")?.discountTenths, 554);
    assert.equal(parsed.articleTerms.find((t) => t.articleNumber === "100506")?.specDiscountTenths, 595);
    assert.equal(parsed.articleTerms.find((t) => t.articleNumber === "7744709")?.netPriceOre, 346_500);
    assert.equal(parsed.endDate, "2030-12-31");
    assert.equal(parsed.chainDiscountRows, 0);
    assert.deepEqual(parsed.warnings, []);
  });

  it("hela avtalsfilen: 1 huvud, 15 103 klassrader, 255 artikelrader (106 spec, 149 netto)", (t) => {
    // Ahlsells filnamn innehåller kundnumret, som inte finns i repot: filen letas upp på mönstret
    // Avtal_<sju siffror>*.txt i ~/Downloads i stället för på ett hårdkodat namn.
    const downloads = path.join(os.homedir(), "Downloads");
    const downloaded = fs.existsSync(downloads)
      ? fs
          .readdirSync(downloads)
          .filter((name) => /^Avtal_\d{7}.*\.txt$/i.test(name))
          .map((name) => path.join(downloads, name))
      : [];
    const candidates = [process.env.AHLSELL_AVTALSFIL, ...downloaded].filter((p): p is string => Boolean(p));
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) {
      t.skip("Riktiga avtalsfilen saknas (sätt AHLSELL_AVTALSFIL).");
      return;
    }
    const { text, encoding } = decodeFixedWidthText(fs.readFileSync(file));
    assert.equal(encoding, "iso-8859-1");
    const lines = splitFixedWidthLines(text);
    assert.equal(lines[0].length, AHLSELL_AGREEMENT_HEADER_LENGTH);
    assert.ok(lines.slice(1).every((l) => l.length === AHLSELL_AGREEMENT_ROW_LENGTH));
    const parsed = parseAhlsellAgreement(text);
    assert.equal(parsed.rowCount, 15_358);
    assert.equal(parsed.classDiscounts.length, 15_103);
    assert.equal(parsed.articleTerms.length, 255);
    assert.equal(parsed.articleTerms.filter((a) => a.specDiscountTenths != null).length, 106);
    assert.equal(parsed.articleTerms.filter((a) => a.netPriceOre != null).length, 149);
    assert.equal(parsed.articleTerms.filter((a) => a.specDiscountTenths != null && a.netPriceOre != null).length, 0);
    assert.equal(parsed.endDate, "2030-12-31");
  });
});

describe("Formatdetektering före kolumnmappning", () => {
  it("känt format kräver att minst 50 rader kontrollerats – alla måste stämma", () => {
    assert.equal(KNOWN_FORMAT_THRESHOLD, 1);
    const full = detectWholesalerFormat(syntheticAgreement(60));
    assert.equal(full.outcome, "known");
    const short = detectWholesalerFormat(syntheticAgreement(10));
    assert.equal(short.outcome, "too_short");
    // En enda avvikande rad bland 200 (bokstav i kundnumret) → inte känt.
    const rows = splitFixedWidthLines(syntheticAgreement(80));
    rows[40] = rows[40].slice(0, 3) + "99A9999" + rows[40].slice(10);
    assert.notEqual(detectWholesalerFormat(rows.join("\n")).outcome, "known");
    // …och en rad med båda fälten satta likaså.
    const both = splitFixedWidthLines(syntheticAgreement(80));
    both[10] = both[10].slice(0, 10) + "123".padEnd(20, " ") + both[10].slice(30);
    assert.notEqual(detectWholesalerFormat(both.join("\n")).outcome, "known");
  });

  it("filnamnet spelar ingen roll – innehållet avgör", () => {
    const bytes = Buffer.from(syntheticAgreement(), "latin1");
    for (const name of ["Avtal_9999999.txt", "prislista.csv", "export.txt"]) {
      const parsed = parsePriceFile(bytes, name);
      assert.equal(parsed.known?.parser.id, "ahlsell-avtalsfil", name);
      assert.equal(parsed.detected.encoding, "iso-8859-1");
    }
  });

  it("negativt: en vanlig CSV känns inte igen som Ahlsell och går till kolumnmappningen", () => {
    assert.equal(detectWholesalerFormat(CSV_SEMICOLON).outcome, "delimited");
    const parsed = parsePriceFile(Buffer.from(CSV_SEMICOLON, "utf8"), "prislista.csv");
    assert.equal(parsed.known, undefined);
    assert.ok(parsed.table.rows.length > 0);
    const preview = previewImport(parsed);
    assert.equal(preview.known, undefined);
    assert.ok(preview.headers.length > 0, "kolumnmappningen ska visas för CSV");
    assert.equal(preview.mapping.articleNumber !== undefined, true);
  });

  it("negativt: en prisfil på 112 tecken tolkas inte som avtalsfil, och en CSV tolkas inte som prisfil", () => {
    const priceList = syntheticPriceList();
    assert.equal(detectAhlsellAgreement(splitFixedWidthLines(priceList)), 0);
    const det = detectWholesalerFormat(priceList);
    assert.equal(det.outcome === "known" && det.parser.id, "ahlsell-prisfil");
    const csvish = ["Artikelnr;Benämning;Pris", ...Array.from({ length: 60 }, (_, i) => `${1000 + i};Kabel ${i};12,50`)].join("\n");
    assert.equal(detectWholesalerFormat(csvish).outcome, "delimited");
  });

  it("okänt fastbreddsformat ger ett ärligt fel – ingen mappningsdialog", () => {
    const rows = Array.from({ length: 60 }, (_, i) => `${String(i).padStart(8, "0")}${"X".repeat(52)}`);
    const text = rows.join("\r\n");
    assert.deepEqual(detectWholesalerFormat(text), { outcome: "fixed_width", lineLength: 60 });
    assert.throws(
      () => parsePriceFile(Buffer.from(text, "latin1"), "okand.txt"),
      (e: unknown) => e instanceof PriceFileError && /fast kolumnbredd/.test(e.message) && /60 tecken/.test(e.message),
    );
  });

  it("för kort fil i känt format ger ett ärligt fel som nämner formatet och antalet rader", () => {
    assert.throws(
      () => parsePriceFile(Buffer.from(syntheticAgreement(10), "latin1"), "avtal.txt"),
      (e: unknown) => e instanceof PriceFileError && /Ahlsell avtalsfil/.test(e.message) && /10 datarader/.test(e.message),
    );
  });

  it("trasig rad i en fil som känns igen ger fel med radnummer i stället för en halv import", () => {
    const rows = splitFixedWidthLines(syntheticAgreement(60));
    // Rad 30 får båda fälten satta – detekteringen faller, men parsern ska aldrig gissa.
    rows[30] = rows[30].slice(0, 10) + "123".padEnd(20, " ") + rows[30].slice(30);
    assert.throws(() => parseAhlsellAgreement(rows.join("\r\n")), (e: unknown) => e instanceof WholesalerFileParseError && e.row === 31);
  });
});

describe("Ahlsell prisfil – bruttoprislista", () => {
  it("fälten läses på position: pris i ören, materialklass, enhet, lagerförd, multipel med två decimaler", () => {
    const parsed = parseAhlsellPriceList(syntheticPriceList());
    const a = parsed.articles.find((x) => x.articleNumber === "100506");
    assert.ok(a);
    assert.equal(a.listPriceOre, 100_000);
    assert.equal(a.materialClass, "BÄ0100");
    assert.equal(a.unit, "ST");
    assert.equal(a.stocked, true);
    assert.equal(a.name, "TVÄTTMASKIN TEST");
    assert.equal(a.orderMultiple, 1);
    const m = parsed.articles.find((x) => x.articleNumber === "5550002");
    assert.equal(m?.unit, "M");
    const por = parsed.articles.find((x) => x.articleNumber === "5550003");
    assert.equal(por?.priceOnRequest, true);
    assert.equal(por?.listPriceOre, undefined);
    assert.equal(por?.stocked, false);
    assert.equal(parsed.priceOnRequestCount, 1);
  });
});

describe("Prisberäkning ur avtal – vid läsning, i rätt ordning, alltid förklarad", () => {
  const agreement = {
    id: "a1",
    format: "ahlsell-avtalsfil" as const,
    filename: "avtal.txt",
    agreementType: "1" as const,
    customerNumber: "9999999",
    facilityNumber: "000",
    name: "R87 VS WC-MALL NIVÅ 2",
    chainDiscountCode: "N" as const,
    endDate: "2030-12-31",
    classDiscountCount: 2,
    articleTermCount: 2,
    specDiscountCount: 1,
    netPriceCount: 1,
    chainDiscountRows: 0,
    importedAt: "2026-09-12T10:00:00.000Z",
  };
  const parsed = parseAhlsellAgreement(agreementText(SPEC_CLASS_ROW, SPEC_FIVE_CHAR_CLASS_ROW, SPEC_SPEC_DISCOUNT_ROW, SPEC_NET_PRICE_ROW));
  const terms: WholesalerAgreementTerm[] = [
    ...parsed.classDiscounts.map((c, i): WholesalerAgreementTerm => ({ id: `c${i}`, connectionId: "c1", agreementId: "a1", kind: "class", materialClass: c.materialClass, materialClassText: c.text, discountTenths: c.discountTenths, endDate: c.endDate })),
    ...parsed.articleTerms.map((a, i): WholesalerAgreementTerm => ({ id: `a${i}`, connectionId: "c1", agreementId: "a1", kind: "article", articleNumber: a.articleNumber, discountTenths: a.specDiscountTenths, netPriceOre: a.netPriceOre, endDate: a.endDate })),
  ];
  const index = indexAgreementTerms(terms);
  const product = (over: Partial<WholesalerProduct>): WholesalerProduct => ({
    id: "p", connectionId: "c1", importId: "i1", articleNumber: "X", name: "Test", unit: "st", ...over,
  });

  it("1. nettopris på artikeln vinner – även över klassrabatten", () => {
    const r = resolvePurchasePrice(product({ articleNumber: "7744709", listPriceOre: 500_000, discountGroup: "CÄÄ011" }), agreement, index);
    assert.equal(r.netPriceOre, 346_500);
    assert.equal(r.netPriceSource, "agreement_net_price");
    assert.equal(r.explanation.rule, "agreement_net_price");
    assert.match(plain(r.explanation.text), /3 465,00 kr/);
    assert.match(plain(r.explanation.text), /R87 VS WC-MALL NIVÅ 2/);
    assert.match(plain(r.explanation.text), /31 december 2030/);
  });

  it("2. specrabatt på artikeln × listpris, i ören utan avrundning till kronor", () => {
    const r = resolvePurchasePrice(product({ articleNumber: "100506", listPriceOre: 100_000, discountGroup: "BÄ0100" }), agreement, index);
    assert.equal(r.netPriceOre, 40_500); // 1 000,00 − 59,5 % = 405,00
    assert.equal(r.netPriceSource, "agreement_spec_discount");
    assert.match(plain(r.explanation.text), /59,5 %/);
    assert.match(plain(r.explanation.text), /specrabatt/);
    // Öresupplösning behålls: 12 345 öre − 59,5 % = 4 999,725 → 5 000 öre (avrundat till heltalsöre, inte kronor)
    assert.equal(applyDiscountTenths(12_345, 595), 5000);
    assert.equal(applyDiscountTenths(12_301, 595), 4982);
  });

  it("3a. materialklass exakt: BÄ0100 −42 %", () => {
    const r = resolvePurchasePrice(product({ articleNumber: "5550001", listPriceOre: 189_000, discountGroup: "BÄ0100" }), agreement, index);
    assert.equal(r.netPriceOre, 109_620);
    assert.equal(r.netPriceSource, "agreement_class_discount");
    assert.equal(r.explanation.matchedClass, "BÄ0100");
    assert.match(plain(r.explanation.text), /1 890,00 kr/);
    assert.match(plain(r.explanation.text), /42 %/);
    assert.match(plain(r.explanation.text), /BÄ0100/);
    assert.match(plain(r.explanation.text), /BANSK TVÄTT & TORK/);
    assert.match(plain(r.explanation.text), /1 096,20 kr/);
  });

  it("3b. materialklass via längsta prefix: CÄÄ011 → CÄÄ01 −55,4 %", () => {
    const r = resolvePurchasePrice(product({ articleNumber: "5550002", listPriceOre: 12_345, discountGroup: "CÄÄ011" }), agreement, index);
    assert.equal(r.netPriceOre, applyDiscountTenths(12_345, 554));
    assert.equal(r.explanation.matchedClass, "CÄÄ01");
    assert.equal(r.explanation.materialClass, "CÄÄ011");
    assert.match(plain(r.explanation.text), /CÄÄ011 via huvudgrupp CÄÄ01/);
    assert.match(plain(r.explanation.text), /55,4 %/);
  });

  it("4. listpris utan rabatt när avtalet saknar klassen – förklaringen säger varför", () => {
    const r = resolvePurchasePrice(product({ articleNumber: "5550004", listPriceOre: 45_000, discountGroup: "ZZ9999" }), agreement, index);
    assert.equal(r.netPriceOre, undefined);
    assert.equal(r.explanation.rule, "list_price");
    assert.match(plain(r.explanation.text), /Ingen rabatt i avtalet .* för materialklass ZZ9999/);
  });

  it("pris på begäran: varken listpris eller nettopris → ingen gissning", () => {
    const r = resolvePurchasePrice(product({ articleNumber: "5550003", discountGroup: "ZZ9999" }), agreement, index);
    assert.equal(r.netPriceOre, undefined);
    assert.equal(r.explanation.rule, "none");
  });

  it("uttryckligt nettopris i prislistan (kundunik lista) rabatteras inte igen", () => {
    const r = resolvePurchasePrice(product({ articleNumber: "5550001", listPriceOre: 189_000, netPriceOre: 150_000, netPriceSource: "file", discountGroup: "BÄ0100" }), agreement, index);
    assert.equal(r.netPriceOre, 150_000);
    assert.equal(r.explanation.rule, "file");
  });

  it("utan avtal: listpris med förklaring att inget avtal är inläst", () => {
    const r = resolvePurchasePrice(product({ articleNumber: "5550001", listPriceOre: 189_000, discountGroup: "BÄ0100" }), undefined, undefined);
    assert.equal(r.netPriceOre, undefined);
    assert.match(plain(r.explanation.text), /Inget rabattavtal/);
  });

  it("täckning: artiklar utan artikelvillkor och utan klassträff (inte ens via prefix) räknas", () => {
    const cov = agreementCoverage(
      [
        { articleNumber: "7744709", materialClass: "QQ1" },
        { articleNumber: "5550001", materialClass: "BÄ0100" },
        { articleNumber: "5550002", materialClass: "CÄÄ011" },
        { articleNumber: "5550004", materialClass: "ZZ9999" },
        { articleNumber: "5550005" },
      ],
      index,
    );
    assert.deepEqual(cov, { articleCount: 5, withoutTermsCount: 2 });
  });
});

describe("Import av avtalsfil och prisfil – tjänstelagret", () => {
  beforeEach(freshDb);

  it("förhandsgranskningen visar en sammanfattning, inte kolumnmappning, och säger att prislistan saknas", () => {
    // Anslutningen får ett annat kundnummer än fixturen så att avvikelsen nedan verkligen prövas.
    const c = ahlsell("1234567");
    const preview = previewPriceFile({ connectionId: c.id, filename: "Avtal_9999999.txt", bytes: fs.readFileSync(FIXTURE) });
    assert.ok(preview.known, "känt format förväntas");
    assert.equal(preview.known.parserId, "ahlsell-avtalsfil");
    assert.equal(preview.known.kind, "discount_agreement");
    assert.equal(preview.known.encoding, "iso-8859-1");
    assert.equal(preview.known.header?.customerNumber, "9999999");
    assert.equal(preview.known.header?.name, "R87 VS WC-MALL NIVÅ 2");
    assert.equal(preview.known.endDate, "2030-12-31");
    assert.deepEqual(
      preview.known.counts.map((x) => x.count),
      [232, 50, 25, 25],
    );
    assert.equal(preview.known.priceListMissing, true);
    assert.deepEqual(preview.known.customerNumberMismatch, { file: "9999999", connection: "1234567" });
    assert.deepEqual(preview.headers, []);
    assert.deepEqual(preview.problems, []);
    assert.equal(preview.rowCount, 282);
  });

  it("avtalet sparas separat från prislistan; kortet visar avtal utan prislista", async () => {
    const c = ahlsell("9999999");
    const outcome = await importPriceFile({ connectionId: c.id, filename: "Avtal_9999999.txt", bytes: fs.readFileSync(FIXTURE) }, run);
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);
    assert.ok(outcome.ok && outcome.agreement);
    assert.match(outcome.ok ? outcome.message : "", /Prislistan saknas ännu/);

    const conn = db().wholesalerConnections!.find((x) => x.id === c.id)!;
    assert.equal(conn.discountAgreement?.customerNumber, "9999999");
    assert.equal(conn.discountAgreement?.classDiscountCount, 232);
    assert.equal(conn.discountAgreement?.articleTermCount, 50);
    assert.equal(conn.discountAgreement?.specDiscountCount, 25);
    assert.equal(conn.discountAgreement?.netPriceCount, 25);
    assert.equal(conn.discountAgreement?.endDate, "2030-12-31");
    assert.equal(conn.activeImportId, undefined, "avtalet får inte bli den aktiva prislistan");
    assert.equal(conn.columnMapping, undefined, "ingen kolumnmappning sparas för ett känt format");

    const imports = db().wholesalerPriceImports!.filter((i) => i.connectionId === c.id);
    assert.equal(imports.length, 1);
    assert.equal(imports[0].format, "ahlsell-avtalsfil");
    assert.equal(imports[0].status, "superseded");
    assert.equal(imports[0].priceDate, "2030-12-31");

    const overview = connectionOverview(conn);
    assert.equal(overview.priceList, null);
    assert.equal(overview.agreement?.priceListMissing, true);
    assert.equal(overview.agreement?.expired, false);
    assert.equal(overview.agreement?.customerNumberMismatch, false);
  });

  it("gammalt slutdatum visas men stoppar inte importen", async () => {
    const c = ahlsell();
    const old = syntheticAgreement(60).replaceAll("301231", "190630");
    const outcome = await importPriceFile({ connectionId: c.id, filename: "avtal.txt", bytes: Buffer.from(old, "latin1") }, run);
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);
    const overview = connectionOverview(db().wholesalerConnections![0]);
    assert.equal(overview.agreement?.endDate, "2019-06-30");
    assert.equal(overview.agreement?.expired, true);
  });

  it("prisfil + avtal: priser räknas vid läsning, förklaras, och täckningen räknas om", async () => {
    const c = ahlsell();
    const agreementBytes = Buffer.from(
      agreementText(
        SPEC_CLASS_ROW,
        SPEC_FIVE_CHAR_CLASS_ROW,
        SPEC_SPEC_DISCOUNT_ROW,
        SPEC_NET_PRICE_ROW,
        ...splitFixedWidthLines(syntheticAgreement(60)).slice(1),
      ),
      "latin1",
    );
    const a = await importPriceFile({ connectionId: c.id, filename: "avtal.txt", bytes: agreementBytes }, run);
    assert.equal(a.ok, true, a.ok ? "" : a.error);

    const p = await importPriceFile({ connectionId: c.id, filename: "prisfil.txt", bytes: Buffer.from(syntheticPriceList(), "latin1") }, run);
    assert.equal(p.ok, true, p.ok ? "" : p.error);
    assert.match(p.ok ? p.message : "", /artiklar importerades/);
    assert.match(p.ok ? p.message : "", /saknar rabatt i avtalet/);

    const conn = db().wholesalerConnections!.find((x) => x.id === c.id)!;
    const active = db().wholesalerPriceImports!.find((i) => i.id === conn.activeImportId)!;
    assert.equal(active.format, "ahlsell-prisfil");
    assert.equal(active.status, "active");
    // 5550003 (ZZ9999, pris på begäran) och 5550004 (ZZ9999) saknar rabatt.
    assert.deepEqual(
      { ...conn.discountAgreement?.coverage, computedAt: undefined },
      { importId: active.id, articleCount: 53, withoutTermsCount: 2, computedAt: undefined },
    );
    const overview = connectionOverview(conn);
    assert.equal(overview.agreement?.coverageCurrent, true);
    assert.equal(overview.agreement?.priceListMissing, false);

    const find = async (q: string) => {
      const res = await searchWholesalerProducts({ connectionId: c.id, query: q });
      const row = res.rows.find((r) => r.articleNumber === q);
      assert.ok(row, `${q} saknas`);
      return row;
    };
    const net = await find("7744709");
    assert.equal(net.netPriceOre, 346_500);
    assert.match(plain(net.priceExplanation), /Nettopris 3 465,00 kr/);
    const spec = await find("100506");
    assert.equal(spec.netPriceOre, 40_500);
    assert.match(plain(spec.priceExplanation), /59,5 %/);
    const cls = await find("5550001");
    assert.equal(cls.netPriceOre, 109_620);
    assert.equal(cls.listPriceOre, 189_000);
    assert.match(plain(cls.priceExplanation), /BÄ0100/);
    const prefix = await find("5550002");
    assert.equal(prefix.netPriceOre, applyDiscountTenths(12_345, 554));
    assert.match(plain(prefix.priceExplanation), /via huvudgrupp CÄÄ01/);
    const listOnly = await find("5550004");
    assert.equal(listOnly.netPriceOre, undefined);
    assert.equal(listOnly.listPriceOre, 45_000);
    assert.match(plain(listOnly.priceExplanation), /Ingen rabatt i avtalet/);
    const por = await find("5550003");
    assert.equal(por.listPriceOre, undefined);
    assert.equal(por.stocked, false);
    assert.match(plain(por.priceExplanation), /Pris på begäran/);
  });

  it("nytt avtal ersätter det gamla; villkoren i katalogstoren följer med", async () => {
    const c = ahlsell();
    const first = await importPriceFile({ connectionId: c.id, filename: "avtal-1.txt", bytes: Buffer.from(syntheticAgreement(60), "latin1") }, run);
    assert.equal(first.ok, true);
    const firstId = db().wholesalerConnections![0].discountAgreement!.id;
    const second = await importPriceFile({ connectionId: c.id, filename: "avtal-2.txt", bytes: fs.readFileSync(FIXTURE) }, run);
    assert.equal(second.ok, true);
    const conn = db().wholesalerConnections![0];
    assert.notEqual(conn.discountAgreement!.id, firstId);
    assert.equal(conn.discountAgreement!.classDiscountCount, 232);
    const { fileCatalogStore } = await import("./wholesalers/catalog-store");
    const { currentBusinessId } = await import("./wholesalers/catalog");
    const store = fileCatalogStore();
    assert.equal(await store.countAgreementTerms(currentBusinessId(), firstId), 0);
    assert.equal(await store.countAgreementTerms(currentBusinessId(), conn.discountAgreement!.id), 282);
  });

  it("en Ahlsell-fil på en annan grossists anslutning avvisas", async () => {
    const dahl = createWholesalerConnection({
      wholesaler: "dahl",
      customerNumber: "1",
      orderEmail: "order@dahl-test.se",
      defaultDeliveryMode: "pickup",
      customerPriceRule: { kind: "later" },
    });
    const outcome = await importPriceFile({ connectionId: dahl.id, filename: "avtal.txt", bytes: fs.readFileSync(FIXTURE) }, run);
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? "" : outcome.error, /rätt grossist/);
  });
});
