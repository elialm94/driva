process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb, testCompany } from "../invoices/test-db";
import { generateSie } from "../accounting/sie";
import { saldobalans, ledgerIntegrity } from "../accounting/ledger";
import { postVerification } from "../accounting/engine";
import { buildSeed } from "../seed";
import { largeSieOptions, sieBytesPc8, sieBytesUtf8, sieText, standardSieOptions } from "../__fixtures__/sie/build";
import { decodeSieBytes, looksLikeSieBytes, parseSie, parseSieAmountOre, SieParseError, tokenizeSieLine } from "./sie-parse";
import { applySieImport, previewSie, roundOrePreservingSum } from "./sie-import";

function freshDb() {
  replaceDb(emptyTestDb({ settings: testCompany({ orgNumber: "559123-4567" }), fiscalYears: [], verifications: [] }));
  return db();
}

describe("SIE-läsaren", () => {
  it("tokeniserar citerade fält, objektlistor och klamrar", () => {
    const tokens = tokenizeSieLine('#TRANS 3001 {6 "P1"} -10000.00 20250115 "Text med \\"citat\\""');
    assert.deepEqual(
      tokens.map((t) => t.value),
      ["#TRANS", "3001", '6 "P1"', "-10000.00", "20250115", 'Text med "citat"'],
    );
    assert.equal(tokenizeSieLine("{")[0].kind, "brace");
    assert.equal(tokenizeSieLine('#VER "A" 1 20250101 "x" {').at(-1)?.kind, "brace");
  });

  it("läser belopp med punkt och komma till heltalsören", () => {
    assert.equal(parseSieAmountOre("1234.50"), 123450);
    assert.equal(parseSieAmountOre("-1234,5"), -123450);
    assert.equal(parseSieAmountOre("1234"), 123400);
    assert.equal(parseSieAmountOre("abc"), null);
  });

  it("PC8-kodade svenska tecken avkodas rätt", () => {
    const file = parseSie(sieBytesPc8());
    assert.equal(file.encoding, "pc8");
    assert.equal(file.companyName, "Ekvägens El AB");
    assert.equal(file.accounts.get(3001), "Försäljning 25 %");
    assert.equal(file.verifications[0].text, "Fakt 1001 Söderberg");
    // Tankstrecket saknas i CP437 och exporteras som bindestreck – texten läses tillbaka intakt i övrigt.
    assert.equal(file.verifications[2].text, "Elgrossisten - kabel");
  });

  it("UTF-8 med och utan BOM avkodas som UTF-8", () => {
    const plain = parseSie(sieBytesUtf8());
    assert.equal(plain.encoding, "utf-8");
    assert.equal(plain.accounts.get(1510), "Kundfordringar");
    assert.equal(plain.verifications[0].text, "Fakt 1001 Söderberg");
    const bom = parseSie(sieBytesUtf8(standardSieOptions(), true));
    assert.equal(bom.encoding, "utf-8");
    assert.equal(bom.companyName, "Ekvägens El AB");
    assert.equal(decodeSieBytes(new TextEncoder().encode("#FLAGGA 0\r\n")).encoding, "pc8");
  });

  it("läser räkenskapsår, IB, dimensioner, objekt och transaktionsrader", () => {
    const file = parseSie(sieBytesPc8());
    assert.equal(file.sieType, 4);
    assert.equal(file.orgNumber, "559123-4567");
    assert.deepEqual(
      file.years.map((y) => [y.index, y.startDate, y.endDate]),
      [
        [0, "2025-01-01", "2025-12-31"],
        [-1, "2024-01-01", "2024-12-31"],
      ],
    );
    assert.equal(file.openingBalances.length, 3);
    assert.equal(file.openingBalances[0].amountOre, 12_500_000);
    assert.equal(file.dimensions.get(6), "Projekt");
    assert.equal(file.objects.get("6:P1"), "Villa Ekbacken");
    const v1 = file.verifications[0];
    assert.equal(v1.series, "A");
    assert.equal(v1.number, 1);
    assert.equal(v1.date, "2025-01-15");
    assert.deepEqual(v1.lines[1].objects, [{ dimension: 6, code: "P1" }]);
    assert.equal(file.verifications[2].lines[0].text, "Kabel 3G1,5");
    assert.deepEqual(file.warnings, []);
  });

  it("klammer på samma rad som #VER och okända taggar hanteras", () => {
    const file = parseSie(sieBytesPc8({ ...standardSieOptions(), braceOnVerLine: true, extraLines: ["#PÅHITT 1 2 3"] }));
    assert.equal(file.verifications.length, 3);
    assert.ok(file.warnings.some((w) => /okänd post #PÅHITT/i.test(w)));
  });

  it("avhuggen fil: den ofullständiga verifikationen tas inte med, resten läses", () => {
    const text = sieText(standardSieOptions());
    const cut = text.slice(0, text.lastIndexOf("}") - 5);
    const file = parseSie(new TextEncoder().encode(cut));
    assert.equal(file.verifications.length, 2);
    assert.ok(file.warnings.some((w) => /avhuggen|avslutas inte/i.test(w)));
  });

  it("filer utan SIE-poster avvisas ärligt", () => {
    assert.throws(() => parseSie(new TextEncoder().encode("Namn;Adress\nKalle;Gatan 1\n")), SieParseError);
    assert.equal(looksLikeSieBytes(new TextEncoder().encode("#FLAGGA 0\r\n#PROGRAM x")), true);
    assert.equal(looksLikeSieBytes(new TextEncoder().encode("Namn;Adress")), false);
  });

  it("avrundning bevarar summan och ändrar aldrig en rad mer än 1 kr", () => {
    assert.deepEqual(roundOrePreservingSum([80133, 20033, -100166]), [801, 200, -1001]);
    assert.deepEqual(roundOrePreservingSum([50, 50, -100]), [1, 0, -1]);
    assert.deepEqual(roundOrePreservingSum([12500000, -5000000, -7500000]), [125000, -50000, -75000]);
    const rounded = roundOrePreservingSum([33, 33, 34, -100]);
    assert.equal(rounded.reduce((s, x) => s + x, 0), 0);
  });
});

describe("SIE-förhandsgranskning", () => {
  it("visar år, antal, datum, konton, debet/kredit och vad som tas med", () => {
    const data = freshDb();
    const preview = previewSie(parseSie(sieBytesPc8()), data);
    assert.equal(preview.orgNumberMatches, true);
    assert.equal(preview.program, "Testbok 3.1");
    const y2025 = preview.years.find((y) => y.label === "2025")!;
    assert.equal(y2025.verificationCount, 3);
    assert.equal(y2025.importableCount, 3);
    assert.equal(y2025.firstDate, "2025-01-15");
    assert.equal(y2025.lastDate, "2025-03-10");
    assert.equal(y2025.accountCount, 7);
    assert.equal(y2025.totalDebitKr, 12500 + 12500 + 1001);
    assert.equal(y2025.totalCreditKr, y2025.totalDebitKr);
    assert.equal(y2025.hasOpeningBalances, true);
    assert.equal(y2025.selectable, true);
    assert.equal(y2025.defaultSelected, true);
    assert.ok(y2025.willImport.some((w) => /3 verifikationer/.test(w)));
    // 2024 finns bara som #RAR -1 utan innehåll → inget att importera.
    const y2024 = preview.years.find((y) => y.label === "2024")!;
    assert.equal(y2024.selectable, false);
    assert.ok(preview.dimensions[0].startsWith("Projekt"));
    assert.ok(preview.unknownAccounts.length === 0 || preview.unknownAccounts.every((a) => a > 999));
  });

  it("obalanserad verifikation listas och utelämnas – aldrig importerad som korrekt", () => {
    const opts = standardSieOptions();
    opts.verifications!.push({
      number: 4,
      date: "2025-04-01",
      text: "Trasig",
      lines: [
        { account: 1930, amount: "100.00" },
        { account: 3001, amount: "-90.00" },
      ],
    });
    const data = freshDb();
    const file = parseSie(sieBytesPc8(opts));
    const preview = previewSie(file, data);
    const y = preview.years[0].label === "2025" ? preview.years[0] : preview.years[1];
    assert.equal(y.unbalanced.length, 1);
    assert.equal(y.unbalanced[0].diffOre, 1000);
    assert.equal(y.importableCount, 3);
    assert.ok(y.omitted.some((o) => /balanserar inte/.test(o)));
    const result = applySieImport(file, data, { yearIndexes: [0], importId: "imp-1" });
    assert.equal(result.verificationsCreated, 3);
    assert.equal(result.skippedUnbalanced, 1);
    assert.ok(!data.verifications.some((v) => v.description === "Trasig"));
    assert.equal(ledgerIntegrity().balanced, true);
  });

  it("dubbletter i filen tas bara med en gång", () => {
    const opts = standardSieOptions();
    opts.verifications!.push({ ...opts.verifications![1], number: 2 });
    const data = freshDb();
    const preview = previewSie(parseSie(sieBytesPc8(opts)), data);
    const y = preview.years.find((p) => p.label === "2025")!;
    assert.deepEqual(y.duplicates, [{ series: "A", number: 2, count: 2 }]);
    assert.equal(y.importableCount, 3);
  });

  it("organisationsnummer som inte stämmer ger en tydlig varning", () => {
    const data = freshDb();
    const preview = previewSie(parseSie(sieBytesPc8({ ...standardSieOptions(), orgNumber: "556677-8899" })), data);
    assert.equal(preview.orgNumberMatches, false);
    assert.ok(preview.warnings.some((w) => /inte samma som företagets/.test(w)));
  });

  it("konflikt med befintligt år: stängt år går inte, år med bokföring är avmarkerat som standard", () => {
    const data = freshDb();
    data.fiscalYears.push({
      id: "fy-2025",
      label: "2025",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      status: "oppet",
      openingBalances: {},
      openingSource: "manuell",
    });
    postVerification({
      date: "2025-05-05",
      description: "Egen bokning",
      entries: [
        { account: 1930, debit: 100 },
        { account: 3001, credit: 100 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    const file = parseSie(sieBytesPc8());
    let preview = previewSie(file, data);
    let y = preview.years.find((p) => p.label === "2025")!;
    assert.equal(y.existing, "same_year_with_verifications");
    assert.equal(y.selectable, true);
    assert.equal(y.defaultSelected, false);
    // A1 finns redan (egen bokning) → kollision hoppas över, resten läggs till.
    assert.deepEqual(y.collisions, ["A1"]);
    assert.equal(y.importableCount, 2);

    data.fiscalYears.find((f) => f.label === "2025")!.status = "stangt";
    preview = previewSie(file, data);
    y = preview.years.find((p) => p.label === "2025")!;
    assert.equal(y.existing, "closed");
    assert.equal(y.selectable, false);
    assert.throws(() => applySieImport(file, data, { yearIndexes: [0], importId: "x" }), /stängt/);
  });

  it("överlappande räkenskapsår med andra datum kan inte importeras", () => {
    const data = freshDb();
    data.fiscalYears.push({
      id: "fy-brutet",
      label: "2024/2025",
      startDate: "2024-07-01",
      endDate: "2025-06-30",
      status: "oppet",
      openingBalances: {},
      openingSource: "manuell",
    });
    const preview = previewSie(parseSie(sieBytesPc8()), data);
    const y = preview.years.find((p) => p.label === "2025")!;
    assert.equal(y.existing, "overlap");
    assert.equal(y.selectable, false);
    assert.ok(y.omitted[0].includes("överlappar"));
  });
});

describe("SIE-import", () => {
  it("skapar räkenskapsår med IB, verifikationer med filens nummer och flyttar fram nummerserien", () => {
    const data = freshDb();
    const file = parseSie(sieBytesPc8());
    const result = applySieImport(file, data, { yearIndexes: [0], importId: "imp-1" });
    assert.equal(result.fiscalYearsCreated, 1);
    assert.equal(result.verificationsCreated, 3);
    assert.equal(result.openingBalanceYears, 1);
    const fy = data.fiscalYears.find((f) => f.label === "2025")!;
    assert.equal(fy.openingSource, "migrering");
    assert.deepEqual(fy.openingBalances, { "1930": 125000, "2081": -50000, "2091": -75000 });
    const a3 = data.verifications.find((v) => v.series === "A" && v.number === 3)!;
    assert.equal(a3.source.type, "sie_import");
    assert.equal(a3.fiscalYearId, fy.id);
    assert.deepEqual(
      a3.entries.map((e) => [e.account, e.debit, e.credit]),
      [
        [4010, 801, 0],
        [2641, 200, 0],
        [2440, 0, 1001],
      ],
    );
    assert.equal(a3.entries[0].note, "Kabel 3G1,5");
    assert.equal(a3.entries[0].accountName, "Material och varor");
    const a1 = data.verifications.find((v) => v.number === 1)!;
    assert.equal(a1.entries[1].note, "Projekt: Villa Ekbacken");
    assert.equal(data.sequences.verification, 4);
    // Nästa egna verifikation kolliderar inte med filens nummer.
    const next = postVerification({
      date: "2025-06-01",
      description: "Egen",
      entries: [
        { account: 1930, debit: 10 },
        { account: 3001, credit: 10 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    assert.equal(next.number, 4);
    assert.equal(ledgerIntegrity().balanced, true);
    assert.equal(ledgerIntegrity().openingBalanced, true);
    assert.ok(data.auditTrail.some((a) => a.action === "bokforing_importerad"));
    assert.match(result.summary, /3 verifikationer · 2025 · ingående balanser/);
  });

  it("konton utanför Fervas standardkontoplan tas med med namnet från filen", () => {
    const data = freshDb();
    const opts = standardSieOptions();
    opts.accounts = { ...opts.accounts, 1910: "Kassa", 6250: "Porto" };
    opts.verifications = [
      {
        number: 1,
        date: "2025-01-10",
        text: "Frimärken",
        lines: [
          { account: 6250, amount: "60.00" },
          { account: 1910, amount: "-60.00" },
        ],
      },
    ];
    const file = parseSie(sieBytesPc8(opts));
    const preview = previewSie(file, data);
    assert.ok(preview.unknownAccounts.includes(6250));
    applySieImport(file, data, { yearIndexes: [0], importId: "imp-2" });
    const v = data.verifications[0];
    assert.equal(v.entries[0].accountName, "Porto");
    assert.equal(v.entries[1].accountName, "Kassa");
  });

  it("flera räkenskapsår importeras i ordning med egna IB och verifikationer", () => {
    const data = freshDb();
    const opts = standardSieOptions();
    opts.ib!.push({ year: -1, account: 1930, amount: "100000.00" }, { year: -1, account: 2081, amount: "-100000.00" });
    opts.verifications!.push({
      number: 1,
      date: "2024-06-01",
      text: "Fjolårets bokning",
      lines: [
        { account: 1930, amount: "25000.00" },
        { account: 2091, amount: "-25000.00" },
      ],
    });
    const file = parseSie(sieBytesPc8(opts));
    const preview = previewSie(file, data);
    const y2024 = preview.years.find((y) => y.label === "2024")!;
    assert.equal(y2024.importableCount, 1);
    // Nummer 1 finns i båda åren – olika räkenskapsår men samma serie/nummer
    // krockar i Fervas modell: det senare hoppas över och rapporteras.
    const result = applySieImport(file, data, { yearIndexes: [-1, 0], importId: "imp-3" });
    assert.equal(result.fiscalYearsCreated, 2);
    assert.equal(result.verificationsCreated, 3);
    assert.equal(result.skippedCollisions, 1);
    assert.deepEqual(result.yearLabels, ["2024", "2025"]);
    assert.deepEqual(data.fiscalYears.find((f) => f.label === "2024")!.openingBalances, { "1930": 100000, "2081": -100000 });
  });

  it("fil med bara saldon: IB + årets förändring som en samlad, tydligt märkt post", () => {
    const data = freshDb();
    const file = parseSie(
      sieBytesPc8({
        sieType: 2,
        years: [{ index: 0, start: "2025-01-01", end: "2025-12-31" }],
        ib: [
          { year: 0, account: 1930, amount: "100000.00" },
          { year: 0, account: 2081, amount: "-100000.00" },
        ],
        ub: [
          { year: 0, account: 1930, amount: "160000.00" },
          { year: 0, account: 2081, amount: "-100000.00" },
          { year: 0, account: 2611, amount: "-12000.00" },
        ],
        res: [{ year: 0, account: 3001, amount: "-48000.00" }],
        verifications: [],
      }),
    );
    const preview = previewSie(file, data);
    const y = preview.years[0];
    assert.equal(y.balancesOnly, true);
    assert.ok(y.willImport.some((w) => /samlad post/.test(w)));
    assert.ok(preview.warnings.some((w) => /SIE-typ 2/.test(w)));
    const result = applySieImport(file, data, { yearIndexes: [0], importId: "imp-4" });
    assert.equal(result.verificationsCreated, 1);
    const v = data.verifications[0];
    assert.equal(v.series, "SIE");
    assert.match(v.description, /saldon, inte enskilda verifikationer/);
    assert.deepEqual(
      v.entries.map((e) => [e.account, e.debit, e.credit]),
      [
        [1930, 60000, 0],
        [2611, 0, 12000],
        [3001, 0, 48000],
      ],
    );
    const sb = saldobalans({ from: "2025-01-01", to: "2025-12-31" });
    assert.equal(sb.rows.find((r) => r.account === 1930)!.ub, 160000);
  });

  it("onumrerade verifikationer får en egen serie – filens numrering förvanskas inte", () => {
    const data = freshDb();
    const opts = standardSieOptions();
    opts.verifications = [{ number: "", date: "2025-02-02", text: "Utan nummer", lines: [{ account: 1930, amount: "10.00" }, { account: 3001, amount: "-10.00" }] }];
    applySieImport(parseSie(sieBytesPc8(opts)), data, { yearIndexes: [0], importId: "imp-5" });
    assert.equal(data.verifications[0].series, "SIE");
    assert.equal(data.verifications[0].number, 1);
    assert.equal(data.sequences.verification, 1);
  });

  it("Fervas egen SIE 4E-export läses tillbaka till samma saldobalans (rundresa)", () => {
    replaceDb(buildSeed());
    const source = db();
    const fy = source.fiscalYears.find((f) => f.startDate <= "2026-06-01" && f.endDate >= "2026-06-01") ?? source.fiscalYears[source.fiscalYears.length - 1];
    const exported = generateSie(fy.id);
    const before = saldobalans({ from: fy.startDate, to: fy.endDate });
    const verCount = source.verifications.filter((v) => v.date.slice(0, 10) >= fy.startDate && v.date.slice(0, 10) <= fy.endDate).length;

    const target = freshDb();
    target.settings.orgNumber = source.settings.orgNumber;
    const file = parseSie(new TextEncoder().encode(exported));
    assert.equal(file.program?.startsWith("Driva"), true);
    const preview = previewSie(file, target);
    const year = preview.years.find((y) => y.startDate === fy.startDate)!;
    assert.equal(year.selectable, true);
    assert.equal(year.unbalanced.length, 0);
    const result = applySieImport(file, target, { yearIndexes: [year.index], importId: "imp-rt" });
    assert.equal(result.verificationsCreated, verCount);
    const after = saldobalans({ from: fy.startDate, to: fy.endDate });
    for (const row of before.rows) {
      const mirrored = after.rows.find((r) => r.account === row.account);
      assert.ok(mirrored, `konto ${row.account} saknas efter rundresan`);
      assert.equal(mirrored.ub, row.ub, `UB konto ${row.account}`);
    }
    assert.equal(ledgerIntegrity().balanced, true);
  });

  it("stor men rimlig fil (20 000 verifikationer) läses och importeras", () => {
    const data = freshDb();
    const started = Date.now();
    const file = parseSie(sieBytesPc8(largeSieOptions(20_000)));
    assert.equal(file.verifications.length, 20_000);
    const preview = previewSie(file, data);
    assert.equal(preview.years.find((y) => y.label === "2025")!.importableCount, 20_000);
    const result = applySieImport(file, data, { yearIndexes: [0], importId: "imp-big" });
    assert.equal(result.verificationsCreated, 20_000);
    assert.ok(Date.now() - started < 15_000, "importen ska gå på sekunder");
    assert.equal(ledgerIntegrity().balanced, true);
  });
});
