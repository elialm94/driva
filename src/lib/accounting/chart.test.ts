import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import { db, resetDemoData } from "../store";
import { EXPENSE_CATEGORIES } from "../bas";
import {
  accountName,
  accountSection,
  accountType,
  addCustomAccount,
  archiveAccount,
  chartAccount,
  chartAccounts,
  ChartAccountError,
  ensureAccount,
  isCostAccount,
  isFinancialAccount,
  isResultAccount,
  isRevenueAccount,
  isStandardAccount,
  renameAccount,
  sectionForAccount,
  standardAccounts,
  typeForAccount,
} from "./chart";
import { PostingError, postVerification, validateEntries } from "./engine";
import { saldobalans } from "./ledger";

/**
 * Kontoplanen som register. Det farliga med bytet är att gammal bokföring ska
 * läsa likadant efteråt – de kontrollerna står först.
 */

/** De 43 konton produkten hade innan registret infördes, med sina exakta namn. */
const KONTON_FORE_REGISTRET: Record<number, string> = {
  1220: "Inventarier och verktyg",
  1229: "Ack. avskrivningar inventarier",
  1510: "Kundfordringar",
  1513: "Kundfordringar ROT/RUT",
  1710: "Förutbetalda kostnader",
  1790: "Upplupna intäkter",
  1930: "Företagskonto",
  2010: "Eget kapital (enskild firma)",
  2013: "Egna uttag",
  2018: "Egna insättningar",
  2019: "Årets resultat (enskild firma)",
  2081: "Aktiekapital",
  2091: "Balanserad vinst eller förlust",
  2099: "Årets resultat",
  2420: "Förskott från kunder",
  2440: "Leverantörsskulder",
  2510: "Skatteskulder",
  2512: "Beräknad inkomstskatt",
  2611: "Utgående moms 25 %",
  2621: "Utgående moms 12 %",
  2631: "Utgående moms 6 %",
  2641: "Ingående moms",
  2650: "Redovisningskonto för moms",
  2970: "Förutbetalda intäkter",
  2990: "Upplupna kostnader",
  3001: "Försäljning 25 %",
  3002: "Försäljning 12 %",
  3003: "Försäljning 6 %",
  3004: "Försäljning 0 %",
  3740: "Öres- och kronutjämning",
  4010: "Material och varor",
  5010: "Lokalhyra",
  5410: "Förbrukningsinventarier",
  5420: "Programvaror och licenser",
  5611: "Drivmedel",
  5831: "Kost och logi",
  6072: "Representation",
  6310: "Företagsförsäkringar",
  6212: "Telefon och internet",
  6991: "Övriga externa kostnader",
  7832: "Avskrivningar inventarier och verktyg",
  8910: "Skatt på årets resultat",
  8999: "Årets resultat",
};

describe("kontoregistret bevarar den gamla kontoplanen", () => {
  beforeEach(() => resetDemoData());

  it("har alla 43 konton kvar med exakt samma namn", () => {
    for (const [number, name] of Object.entries(KONTON_FORE_REGISTRET)) {
      const account = Number(number);
      assert.equal(accountName(account), name, `konto ${account} bytte namn`);
      assert.ok(isStandardAccount(account), `konto ${account} saknas i standardplanen`);
    }
  });

  it("bokför fortfarande på dem", () => {
    for (const account of Object.keys(KONTON_FORE_REGISTRET).map(Number)) {
      const entries = validateEntries([
        { account, debit: 100 },
        { account: 1930, credit: 100 },
      ]);
      assert.equal(entries[0].account, account);
      assert.equal(entries[0].accountName, KONTON_FORE_REGISTRET[account]);
    }
  });

  it("läser demoseedets saldobalans med namn ur registret", () => {
    const sb = saldobalans();
    assert.ok(sb.rows.length > 0);
    for (const row of sb.rows) {
      assert.notEqual(row.name, "", `konto ${row.account} saknar namn`);
      assert.ok(!row.name.startsWith("Konto "), `konto ${row.account} finns inte i registret: ${row.name}`);
    }
  });

  it("håller alla utgiftskategoriers konton i registret", () => {
    for (const category of EXPENSE_CATEGORIES) {
      assert.ok(
        chartAccount(category.account),
        `kategorin ${category.key} pekar på konto ${category.account} som inte finns i registret`
      );
    }
  });
});

describe("kontoregistrets struktur", () => {
  beforeEach(() => resetDemoData());

  it("ger varje standardkonto en typ som stämmer med dess post", () => {
    for (const account of standardAccounts()) {
      assert.equal(account.type, typeForAccount(account.number), `konto ${account.number} har fel typ`);
      assert.equal(account.section, sectionForAccount(account.number));
    }
  });

  it("placerar balans- och resultatkonton rätt", () => {
    assert.equal(accountType(1930), "tillgang");
    assert.equal(accountType(2081), "eget_kapital");
    assert.equal(accountType(2440), "skuld");
    assert.equal(accountType(3001), "intakt");
    assert.equal(accountType(4010), "kostnad");
    assert.equal(accountSection(2081), "bundet_eget_kapital");
    assert.equal(accountSection(2091), "fritt_eget_kapital");
    assert.equal(accountSection(2110), "obeskattade_reserver");
    assert.equal(accountSection(2350), "langfristiga_skulder");
    assert.equal(accountSection(2440), "kortfristiga_skulder");
  });

  it("skiljer finansiella poster från rörelsen", () => {
    assert.ok(isFinancialAccount(8310), "ränteintäkt ska vara finansiell");
    assert.ok(isFinancialAccount(8410), "räntekostnad ska vara finansiell");
    assert.ok(!isCostAccount(8410), "räntekostnad är inte en rörelsekostnad");
    assert.ok(!isRevenueAccount(8310), "ränteintäkt är inte en rörelseintäkt");
    assert.equal(accountSection(8410), "finansiella_kostnader");
    // Nedskrivning av andelar ligger i kontogruppen för finansiella intäkter
    // men är en kostnad.
    assert.equal(accountSection(8070), "finansiella_kostnader");
  });

  it("räknar 8999 som resultatets motkonto, inte som resultatkonto", () => {
    assert.ok(isResultAccount(3001));
    assert.ok(isResultAccount(4010));
    assert.ok(isResultAccount(8910));
    assert.ok(!isResultAccount(8999), "8999 är omföringens motkonto");
    assert.ok(!isResultAccount(1930));
    assert.ok(!isResultAccount(2440));
  });

  it("har konton för det som byggs härnäst: lön, skattekonto och byggmoms", () => {
    for (const account of [1630, 2710, 2730, 2731, 2920, 2941, 7210, 7220, 7510, 7519]) {
      assert.ok(chartAccount(account), `lön/skattekonto saknar konto ${account}`);
    }
    for (const account of [2614, 2647, 3231, 4425]) {
      assert.ok(chartAccount(account), `omvänd byggmoms saknar konto ${account}`);
    }
    for (const account of [2110, 8811, 8819, 8410, 8310]) {
      assert.ok(chartAccount(account), `bokslut saknar konto ${account}`);
    }
  });

  it("är väsentligt större än de 43 konton produkten hade", () => {
    assert.ok(standardAccounts().length > 250, `bara ${standardAccounts().length} konton i standardplanen`);
  });
});

describe("egna konton", () => {
  beforeEach(() => resetDemoData());

  it("blir bokföringsbara direkt", () => {
    assert.throws(
      () => validateEntries([{ account: 4011, debit: 100 }, { account: 1930, credit: 100 }]),
      (err: unknown) => err instanceof PostingError && err.code === "okant_konto"
    );

    const created = addCustomAccount({ number: 4011, name: "Inköp virke" });
    assert.equal(created.custom, true);
    assert.equal(created.type, "kostnad");
    assert.equal(created.section, "ravaror_och_fornodenheter");

    const entries = validateEntries([{ account: 4011, debit: 100 }, { account: 1930, credit: 100 }]);
    assert.equal(entries[0].accountName, "Inköp virke");
    assert.ok(chartAccounts().some((a) => a.number === 4011));
  });

  it("lagras som avvikelse, inte som en kopia av hela planen", () => {
    addCustomAccount({ number: 4011, name: "Inköp virke" });
    assert.equal(db().chartAccounts?.length, 1);
  });

  it("vägrar nummer utanför kontoplanens rymd", () => {
    assert.throws(() => addCustomAccount({ number: 999, name: "Fel" }), ChartAccountError);
    assert.throws(() => addCustomAccount({ number: 9100, name: "Fel" }), ChartAccountError);
    assert.throws(() => addCustomAccount({ number: 4011, name: "  " }), ChartAccountError);
  });

  it("vägrar krocka med ett konto som redan finns", () => {
    assert.throws(() => addCustomAccount({ number: 1930, name: "Mitt bankkonto" }), ChartAccountError);
  });

  it("kan döpas om utan att bokförda verifikationer ändras", () => {
    const verification = postVerification({
      date: "2026-03-10",
      description: "Materialinköp",
      entries: [{ account: 4010, debit: 500 }, { account: 1930, credit: 500 }],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    assert.equal(verification.entries[0].accountName, "Material och varor");

    renameAccount(4010, "Byggmaterial");
    assert.equal(accountName(4010), "Byggmaterial");
    assert.equal(
      verification.entries[0].accountName,
      "Material och varor",
      "bokförd verifikation ska behålla kontonamnet den bokfördes med"
    );
  });

  it("arkiverade konton tar inte emot nya konteringar men behåller historiken", () => {
    postVerification({
      date: "2026-03-10",
      description: "Representation",
      entries: [{ account: 6072, debit: 200 }, { account: 1930, credit: 200 }],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });

    archiveAccount(6072);
    assert.ok(!chartAccounts().some((a) => a.number === 6072), "arkiverat konto ska inte visas som valbart");
    assert.ok(chartAccounts({ includeArchived: true }).some((a) => a.number === 6072));
    assert.throws(
      () => validateEntries([{ account: 6072, debit: 100 }, { account: 1930, credit: 100 }]),
      (err: unknown) => err instanceof PostingError && err.code === "okant_konto"
    );
    assert.ok(
      saldobalans().rows.some((r) => r.account === 6072),
      "arkiverat konto med rörelser ska ligga kvar i saldobalansen"
    );

    archiveAccount(6072, false);
    assert.doesNotThrow(() => validateEntries([{ account: 6072, debit: 100 }, { account: 1930, credit: 100 }]));
  });

  it("ensureAccount är idempotent och rör inte befintliga namn", () => {
    const first = ensureAccount(1930, "Bankkonto enligt byrån");
    assert.equal(first.name, "Företagskonto", "befintligt konto ska inte döpas om av import");
    const created = ensureAccount(4012, "Inköp spik");
    assert.equal(created.name, "Inköp spik");
    assert.equal(ensureAccount(4012, "Något annat").name, "Inköp spik");
  });
});
