process.env.DRIVA_TEST = "1";

/**
 * scripts/scenario.ts - båda scenarierna seedas till en temporär mapp och
 * laddas sedan genom exakt den väg lagret tar för en fil på disk
 * (JSON.parse → store.normalize via replaceDb). Testet rör aldrig
 * .data/db.json.
 *
 * Kontrollerna är "laddar utan fel" i praktisk mening: företagsuppgifter,
 * räkenskapsår, huvudbokens integritet, saldobalansen, momsperioderna och
 * bankavstämningen läses genom de riktiga tjänsterna.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SCENARIOS, STORE_FILENAME, writeScenario, type ScenarioName } from "../../scripts/scenario";
import { db, replaceDb } from "./store";
import { buildSeed } from "./seed";
import type { DB } from "./types";
import { bankConnectionView } from "./banking/connection-state";
import { ledgerIntegrity, saldobalans } from "./accounting/ledger";
import { bankReconciliation } from "./accounting/reconciliation";
import { fiscalYears } from "./accounting/fiscal";
import { vatPeriods } from "./accounting/vat";

const NYSTART_MERCHANTS = ["Bauhaus", "Beijer Bygg", "Circle K"];

/** Seeda scenariot till en temporär mapp och ladda filen som lagret gör. */
function loadScenario(name: ScenarioName): DB {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `driva-scenario-${name}-`));
  try {
    const file = writeScenario(name, dir);
    assert.equal(file, path.join(dir, STORE_FILENAME));
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as DB;
    replaceDb(parsed);
    return db();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("scenario-seed", () => {
  it("båda scenarierna seedas och laddas utan fel", () => {
    for (const name of SCENARIOS) {
      const data = loadScenario(name);
      assert.ok(data.settings.name.length > 0, `${name}: företagsnamn saknas`);
      assert.ok(data.settings.orgNumber.length > 0, `${name}: organisationsnummer saknas`);
      assert.ok(fiscalYears().length > 0, `${name}: inget räkenskapsår`);

      const integrity = ledgerIntegrity();
      assert.ok(integrity.balanced, `${name}: obalanserat ${integrity.unbalancedVerifications.join(", ")}`);
      assert.ok(integrity.openingBalanced, `${name}: ingående balans balanserar inte`);

      const sb = saldobalans();
      assert.equal(sb.sumDebit, sb.sumCredit, `${name}: saldobalansen balanserar inte`);

      assert.ok(vatPeriods().length > 0, `${name}: inga momsperioder`);
      assert.equal(bankReconciliation().unexplained, 0, `${name}: oförklarad differens i bankavstämningen`);

      const ids = data.bankTransactions.map((t) => t.id);
      assert.equal(new Set(ids).size, ids.length, `${name}: dubbla transaktions-id`);
    }
  });

  it("demo återanvänder src/lib/seed.ts", () => {
    const data = loadScenario("demo");
    const seed = buildSeed();
    assert.equal(data.settings.name, seed.settings.name);
    assert.equal(data.settings.orgNumber, seed.settings.orgNumber);
    assert.deepEqual(
      data.customers.map((c) => c.id),
      seed.customers.map((c) => c.id)
    );
    assert.equal(data.invoices.length, seed.invoices.length);
    assert.ok(data.verifications.length > 0, "demon har bokförd historik");
  });

  it("nystart: aktiebolag från 1 september 2026, helårsmoms, ingen bokföring", () => {
    const data = loadScenario("nystart");
    assert.equal(data.settings.companyForm, "ab");
    assert.equal(data.settings.vatPeriodicity, "helar");
    assert.equal(data.verifications.length, 0);
    assert.equal(data.customers.length, 0);
    assert.ok(
      fiscalYears().some((fy) => fy.startDate === "2026-09-01"),
      "räkenskapsåret börjar på bolagets första dag"
    );
    // Helårsmoms = en enda momsperiod i räkenskapsåret.
    assert.equal(vatPeriods().length, 1);
    assert.equal(bankConnectionView().status, "connected");
  });

  it("nystart: tolv månaders bankhistorik med hyra, inbetalning och tio köp", () => {
    const data = loadScenario("nystart");
    const months = [...new Set(data.bankTransactions.map((t) => t.date.slice(0, 7)))].sort();
    assert.equal(months.length, 12);
    assert.equal(months[months.length - 1], "2026-09", "historiken slutar med bolagets startmånad");
    assert.equal(data.bankTransactions.length, 12 * 12);

    for (const month of months) {
      const rows = data.bankTransactions.filter((t) => t.date.startsWith(month));
      const hyra = rows.filter((t) => t.amount === -6500);
      assert.equal(hyra.length, 1, `${month}: en hyra`);
      assert.equal(hyra[0].date.slice(8, 10), "03", `${month}: hyran dras den 3:e`);

      const inbetalning = rows.filter((t) => t.amount === 18870);
      assert.equal(inbetalning.length, 1, `${month}: en inbetalning`);
      assert.equal(inbetalning[0].date.slice(8, 10), "02", `${month}: inbetalningen kommer den 2:a`);

      const purchases = rows.filter((t) => t !== hyra[0] && t !== inbetalning[0]);
      assert.equal(purchases.length, 10, `${month}: tio köp`);
      for (const purchase of purchases) {
        assert.ok(NYSTART_MERCHANTS.includes(purchase.counterpart), `${month}: okänd leverantör ${purchase.counterpart}`);
        assert.ok(purchase.amount < 0, `${month}: köp ska vara en utbetalning`);
      }
      assert.ok(
        NYSTART_MERCHANTS.every((merchant) => purchases.some((p) => p.counterpart === merchant)),
        `${month}: köpen ska vara blandade mellan alla tre`
      );
    }

    assert.ok(
      data.bankTransactions.every((t) => t.status === "ny"),
      "ingen transaktion är hanterad ännu"
    );
    assert.equal(
      data.bankAccounts[0].balance,
      data.bankTransactions.reduce((sum, t) => sum + t.amount, 0),
      "saldot ska vara summan av transaktionerna"
    );
  });
});
