import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import { db, resetDemoData } from "../store";
import { accountPickerOptions, postManualVerification } from "../services/manual-verification";
import { chartAccounts } from "./chart";
import { PostingError, postVerification, verificationLabel } from "./engine";
import { lockPeriod } from "./fiscal";
import { MAIN_SERIES, MANUAL_SERIES, nextNumberInSeries, seriesLabel } from "./series";
import { saldobalans } from "./ledger";

/**
 * Manuellt verifikat. Det manuella verifikatet är den enda vägen in i
 * bokföringen som inte har ett underlag i systemet, så kontrollerna här handlar
 * om att motorns garantier gäller lika hårt: balans, kontoregister, periodlås
 * och egen obruten nummerföljd i serien.
 */

const HYRA = { account: 5010, debit: 12_000 };
const BANK = { account: 1930, credit: 12_000 };

describe("manuellt verifikat", () => {
  beforeEach(() => {
    resetDemoData();
  });

  it("bokförs i serie M med egen nummerföljd, utan att röra serie A", () => {
    const beforeA = nextNumberInSeries(MAIN_SERIES);

    const first = postManualVerification({
      date: "2026-03-10",
      description: "Hyra mars",
      lines: [HYRA, BANK],
    });
    const second = postManualVerification({
      date: "2026-03-11",
      description: "Hyra april",
      lines: [HYRA, BANK],
    });

    assert.equal(first.series, MANUAL_SERIES);
    assert.equal(verificationLabel(first), "M1");
    assert.equal(verificationLabel(second), "M2");
    assert.equal(nextNumberInSeries(MAIN_SERIES), beforeA, "serie A ska inte ha förbrukat nummer");
    assert.equal(seriesLabel(MANUAL_SERIES), "Manuella verifikat");

    // Nästa automatiska bokning fortsätter i A där den låg.
    const auto = postVerification({
      date: "2026-03-12",
      description: "Automatik efteråt",
      entries: [HYRA, BANK],
      source: { type: "manuell" },
      createdBy: "auto",
    });
    assert.equal(auto.series, MAIN_SERIES);
    assert.equal(auto.number, beforeA);
  });

  it("hamnar i huvudboken som all annan bokföring", () => {
    postManualVerification({ date: "2026-03-10", description: "Hyra mars", lines: [HYRA, BANK] });

    const sb = saldobalans({ from: "2026-01-01", to: "2026-12-31" });
    const hyra = sb.rows.find((r) => r.account === 5010);
    assert.ok(hyra, "kostnadskontot ska finnas i saldobalansen");
    assert.equal(hyra.debit >= 12_000, true);
    assert.equal(sb.sumDebit, sb.sumCredit, "saldobalansen ska stämma efter ett manuellt verifikat");
  });

  it("avvisar obalans, okända konton och enradiga verifikat utan att bokföra", () => {
    const before = db().verifications.length;

    assert.throws(
      () =>
        postManualVerification({
          date: "2026-03-10",
          description: "Skev bokning",
          lines: [{ account: 5010, debit: 12_000 }, { account: 1930, credit: 11_000 }],
        }),
      (e: unknown) => e instanceof PostingError && e.code === "obalanserad"
    );
    assert.throws(
      () =>
        postManualVerification({
          date: "2026-03-10",
          description: "Påhittat konto",
          lines: [{ account: 9999, debit: 100 }, BANK],
        }),
      (e: unknown) => e instanceof PostingError && e.code === "okant_konto"
    );
    assert.throws(
      () => postManualVerification({ date: "2026-03-10", description: "Bara en rad", lines: [HYRA] }),
      /minst två rader/
    );
    assert.throws(
      () => postManualVerification({ date: "2026-03-10", description: "   ", lines: [HYRA, BANK] }),
      /beskrivning/
    );

    assert.equal(db().verifications.length, before, "inget ska ha bokförts");
  });

  it("respekterar periodlåset – manuella verifikat är inga systemposter", () => {
    lockPeriod("2026-03-31", "anvandare");
    assert.throws(
      () => postManualVerification({ date: "2026-03-10", description: "Sen bokning", lines: [HYRA, BANK] }),
      (e: unknown) => e instanceof PostingError && e.code === "period_last"
    );
  });

  it("håller handelsdatum skilt från bokföringsdatum", () => {
    const v = postManualVerification({
      date: "2026-04-02",
      transactionDate: "2026-03-28",
      description: "Kvitto från mars, bokförd i april",
      lines: [HYRA, BANK],
    });
    assert.equal(v.transactionDate, "2026-03-28");
    assert.equal(v.date.slice(0, 10), "2026-04-02");

    assert.throws(
      () =>
        postManualVerification({
          date: "2026-04-02",
          transactionDate: "2026-02-30",
          description: "Datum som inte finns",
          lines: [HYRA, BANK],
        }),
      /Handelsdatum/
    );
  });

  it("bär med underlaget på verifikationen", () => {
    const v = postManualVerification({
      date: "2026-03-10",
      description: "Hyra mars",
      explanation: "Hyresavin ligger som underlag.",
      lines: [HYRA, BANK],
      attachment: {
        filename: "hyresavi.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024,
        contentBase64: Buffer.from("underlag").toString("base64"),
      },
    });
    assert.equal(v.attachment?.filename, "hyresavi.pdf");
    assert.equal(v.explanation, "Hyresavin ligger som underlag.");
  });

  it("erbjuder hela det aktiva kontoregistret i kontoväljaren", () => {
    const options = accountPickerOptions();
    assert.equal(options.length, chartAccounts().length);
    assert.deepEqual(
      options.map((o) => o.account),
      [...options.map((o) => o.account)].sort((a, b) => a - b),
      "kontona ska ligga i nummerordning"
    );
    const bank = options.find((o) => o.account === 1930);
    assert.ok(bank);
    assert.equal(bank.label, "1930 Företagskonto");
  });
});
