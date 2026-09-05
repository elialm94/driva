process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb } from "../invoices/test-db";
import { calendarFiscalYear } from "./dates";
import { postVerification } from "./engine";
import { chartAccount } from "./chart";
import { generateSie, encodeSieToPc8 } from "./sie";
import { decodeSie, importSieOpeningBalances, previewSieImport, SieImportError } from "./sie-import";
import { saldobalans } from "./ledger";
import { auditTrail } from "./audit";
import { closeFiscalYear } from "./close";

/**
 * SIE-import: att ta över en klient som redan har en bokföring.
 *
 * Det som ska följa med är kontoplanen och de ingående balanserna – inte
 * verifikationerna. Testerna håller fast både vad importen gör och vad den
 * vägrar göra, för det senare är det som skyddar bokföringen:
 *
 *   1. Filen tolkas utan att röra något. Ett steg till behövs för att skriva.
 *   2. Balanskonton följer med, resultatkonton gör det inte.
 *   3. En fil som inte går ihop balanseras mot balanserat resultat och
 *      differensen sägs rakt ut – den tigs inte bort.
 *   4. Ett år med bokförda verifikationer eller med IB ur ett riktigt bokslut
 *      går inte att skriva över.
 *   5. Både PC8 och UTF-8 läses, för programmen skriver olika.
 */

function fy(year: number) {
  return calendarFiscalYear(year);
}

function reset() {
  replaceDb(emptyTestDb({ fiscalYears: [fy(2026)] }));
}

/** Räkenskapsårens id bär en slumpdel, så de slås upp på label. */
function yearId(label: string): string {
  const found = db().fiscalYears.find((f) => f.label === label);
  assert.ok(found, `Räkenskapsåret ${label} saknas i testdatabasen.`);
  return found.id;
}

/** En minimal men äkta SIE 4-fil: årsslut 2025, balanser klara. */
function sieFile(over?: { ub?: [number, string][]; extra?: string[] }): Uint8Array {
  const ub = over?.ub ?? [
    [1930, "150000.00"],
    [1510, "50000.00"],
    [1688, "5000.00"],
    [2440, "-45000.00"],
    [2081, "-25000.00"],
    [2091, "-135000.00"],
  ];
  const lines = [
    "#FLAGGA 0",
    '#PROGRAM "Fortnox" 3.0',
    "#FORMAT PC8",
    "#GEN 20260115",
    "#SIETYP 4",
    '#FNAMN "Snickeri Ek AB"',
    "#ORGNR 556677-8899",
    "#RAR 0 20250101 20251231",
    "#RAR -1 20240101 20241231",
    "#KONTO 1510 \"Kundfordringar\"",
    "#KONTO 1930 \"Företagskonto\"",
    "#KONTO 2081 \"Aktiekapital\"",
    "#KONTO 2091 \"Balanserad vinst\"",
    "#KONTO 1688 \"Depositioner hos hyresvärd\"",
    "#KONTO 2440 \"Leverantörsskulder\"",
    "#KONTO 3001 \"Försäljning 25 %\"",
    "#IB 0 1930 120000.00",
    "#UB 0 3001 -800000.00",
    ...ub.map(([account, amount]) => `#UB 0 ${account} ${amount}`),
    ...(over?.extra ?? []),
  ];
  return encodeSieToPc8(lines.join("\r\n") + "\r\n");
}

describe("SIE-import", () => {
  beforeEach(reset);

  it("läser företag, år och kontoplan ur filen", () => {
    const preview = previewSieImport(sieFile());
    assert.equal(preview.companyName, "Snickeri Ek AB");
    assert.equal(preview.orgNumber, "556677-8899");
    assert.deepEqual(preview.fiscalYears[0], { startDate: "2025-01-01", endDate: "2025-12-31" });
    assert.equal(preview.fiscalYears.length, 2);
    assert.equal(preview.accounts.length, 7);
    assert.deepEqual(
      preview.accounts.find((a) => a.account === 2440),
      { account: 2440, name: "Leverantörsskulder" }
    );
  });

  it("tar med balanskonton och lämnar resultatkonton", () => {
    const preview = previewSieImport(sieFile());
    assert.equal(preview.openingBalances["1930"], 150_000);
    assert.equal(preview.openingBalances["2440"], -45_000);
    // 3001 har 800 000 kr i omsättning i filen men hör till ett avslutat år.
    assert.equal(preview.openingBalances["3001"], undefined);
    assert.equal(
      Object.values(preview.openingBalances).reduce((s, v) => s + v, 0),
      0
    );
  });

  it("förhandsvisningen rör ingenting", () => {
    previewSieImport(sieFile());
    assert.deepEqual(db().fiscalYears[0].openingBalances, {});
    assert.equal(db().auditTrail.length, 0);
  });

  it("säger att verifikationerna inte följer med", () => {
    const preview = previewSieImport(
      sieFile({
        extra: ['#VER "A" 1 20250310 "Kundfaktura"', "{", "#TRANS 1510 {} 12500.00 20250310 \"\"", "}"],
      })
    );
    assert.equal(preview.verificationCount, 1);
    assert.match(preview.warnings.join(" "), /importeras inte/);
  });

  it("skriver in kontoplan och ingående balanser på året", () => {
    const preview = previewSieImport(sieFile());
    const result = importSieOpeningBalances(preview, yearId("2026"));

    const year = db().fiscalYears[0];
    assert.equal(year.openingSource, "migrering");
    assert.equal(year.openingBalances["1930"], 150_000);
    assert.equal(result.accountsTotal, 6);
    assert.equal(result.balancedWith, undefined);

    // Konton Driva inte har kommer in med filens namn – det är namnet byrån
    // redan använder. Ett BAS-konto behåller sitt namn i registret: att döpa om
    // 2091 för att en fil sa något annat är churn utan vinst.
    assert.equal(result.accountsCreated, 1);
    assert.equal(chartAccount(1688)?.name, "Depositioner hos hyresvärd");
    assert.equal(chartAccount(2091)?.name, "Balanserad vinst eller förlust");

    // Saldobalansen utgår nu från balanserna, inte från noll.
    const sb = saldobalans({ from: "2026-01-01", to: "2026-12-31" });
    assert.equal(sb.rows.find((r) => r.account === 1930)?.ib, 150_000);
    assert.equal(sb.sumIb, 0);

    assert.equal(auditTrail().filter((e) => e.action === "sie_import").length, 1);
  });

  it("balanserar en fil som inte går ihop och säger differensen", () => {
    const preview = previewSieImport(
      sieFile({
        ub: [
          [1930, "150000.00"],
          [2081, "-25000.00"],
        ],
      })
    );
    assert.match(preview.warnings.join(" "), /summerar till 125000 kr/);

    const result = importSieOpeningBalances(preview, yearId("2026"));
    assert.equal(result.balancedWith, -125_000);
    assert.equal(db().fiscalYears[0].openingBalances["2091"], -125_000);
    assert.equal(
      Object.values(db().fiscalYears[0].openingBalances).reduce((s, v) => s + v, 0),
      0
    );
  });

  it("avrundar ören och säger det", () => {
    const preview = previewSieImport(
      sieFile({
        ub: [
          [1930, "150000.49"],
          [2081, "-150000.49"],
        ],
      })
    );
    assert.match(preview.warnings.join(" "), /ören/);
    assert.equal(preview.openingBalances["1930"], 150_000);
  });

  it("varnar när filens år inte gränsar till året balanserna läggs på", () => {
    replaceDb(emptyTestDb({ fiscalYears: [fy(2028)] }));
    const result = importSieOpeningBalances(previewSieImport(sieFile()), yearId("2028"));
    assert.match(result.warnings.join(" "), /2025-12-31/);
    assert.match(result.warnings.join(" "), /mitt i ett år/);
  });

  it("vägrar skriva över ett år där bokföringen börjat", () => {
    postVerification({
      date: "2026-02-01",
      description: "Kontorsmaterial",
      entries: [
        { account: 6110, debit: 400, credit: 0 },
        { account: 1930, debit: 0, credit: 400 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    assert.throws(
      () => importSieOpeningBalances(previewSieImport(sieFile()), yearId("2026")),
      (e: unknown) => e instanceof SieImportError && /verifikation/.test((e as Error).message)
    );
  });

  it("vägrar skriva över ingående balanser som kommer ur ett bokslut", () => {
    replaceDb(emptyTestDb({ fiscalYears: [fy(2025), fy(2026)] }));
    postVerification({
      date: "2025-03-01",
      description: "Försäljning",
      entries: [
        { account: 1930, debit: 1000, credit: 0 },
        { account: 3001, debit: 0, credit: 1000 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    closeFiscalYear(yearId("2025"), "anvandare");
    assert.equal(db().fiscalYears.find((f) => f.id === yearId("2026"))?.openingSource, "foregaende_ar");
    assert.throws(
      () => importSieOpeningBalances(previewSieImport(sieFile()), yearId("2026")),
      (e: unknown) => e instanceof SieImportError && /bokslutet/.test((e as Error).message)
    );
  });

  it("vägrar en fil utan balansposter", () => {
    const bytes = encodeSieToPc8(
      ["#FLAGGA 0", "#SIETYP 4", "#RAR 0 20250101 20251231", '#KONTO 1930 "Företagskonto"'].join("\r\n")
    );
    assert.throws(() => previewSieImport(bytes), SieImportError);
  });

  it("läser både PC8 och UTF-8", () => {
    const pc8 = previewSieImport(sieFile());
    const utf8 = previewSieImport(new TextEncoder().encode(decodeSie(sieFile())));
    assert.equal(pc8.accounts.find((a) => a.account === 2440)?.name, "Leverantörsskulder");
    assert.deepEqual(utf8.accounts, pc8.accounts);
    assert.deepEqual(utf8.openingBalances, pc8.openingBalances);
  });

  it("läser tillbaka Drivas egen export", () => {
    replaceDb(emptyTestDb({ fiscalYears: [fy(2025), fy(2026)] }));
    postVerification({
      date: "2025-04-01",
      description: "Aktiekapital",
      entries: [
        { account: 1930, debit: 25_000, credit: 0 },
        { account: 2081, debit: 0, credit: 25_000 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    const exported = encodeSieToPc8(generateSie(yearId("2025")));

    replaceDb(emptyTestDb({ fiscalYears: [fy(2026)] }));
    const preview = previewSieImport(exported);
    assert.equal(preview.openingBalances["1930"], 25_000);
    assert.equal(preview.openingBalances["2081"], -25_000);
    const result = importSieOpeningBalances(preview, yearId("2026"));
    assert.equal(result.balancedWith, undefined);
  });
});
