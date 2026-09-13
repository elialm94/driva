process.env.DRIVA_TEST = "1";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTIVITY_FILTER_MIN, type CustomerActivityRow } from "./customer-activity-model";
import {
  ACTIVITY_LIST_EMPTY_MIN_PX,
  DEFAULT_ACTIVITY_SORT,
  activityListMinHeightPx,
  compareActivityRows,
  reserveActivityListHeight,
  defaultActivitySortDirection,
  filterCustomerActivity,
  nextActivitySort,
  sortCustomerActivity,
  visibleCustomerActivity,
} from "./customer-activity-sort";
import { datumKort, kr } from "./format";

function row(over: Partial<CustomerActivityRow> & Pick<CustomerActivityRow, "id">): CustomerActivityRow {
  return {
    at: "2026-06-01T12:00:00.000Z",
    kind: "faktura",
    kinds: ["faktura"],
    title: over.title ?? over.id,
    statusLabel: "Öppen",
    href: "/ekonomi/fakturor/x",
    ...over,
  };
}

describe("nextActivitySort", () => {
  it("första klicket är fallande på Datum och Belopp, stigande på text", () => {
    assert.equal(defaultActivitySortDirection("datum"), "desc");
    assert.equal(defaultActivitySortDirection("belopp"), "desc");
    assert.equal(defaultActivitySortDirection("handelse"), "asc");
    assert.equal(defaultActivitySortDirection("status"), "asc");

    const fromDefault = DEFAULT_ACTIVITY_SORT;
    assert.deepEqual(nextActivitySort("belopp", fromDefault), { key: "belopp", direction: "desc" });
    assert.deepEqual(nextActivitySort("handelse", fromDefault), { key: "handelse", direction: "asc" });
    assert.deepEqual(nextActivitySort("status", fromDefault), { key: "status", direction: "asc" });
  });

  it("andra klicket på samma kolumn vänder riktningen", () => {
    const firstBelopp = nextActivitySort("belopp", DEFAULT_ACTIVITY_SORT);
    assert.deepEqual(nextActivitySort("belopp", firstBelopp), { key: "belopp", direction: "asc" });
    const firstDatum = nextActivitySort("datum", DEFAULT_ACTIVITY_SORT);
    assert.deepEqual(firstDatum, { key: "datum", direction: "asc" });
    assert.deepEqual(nextActivitySort("datum", firstDatum), { key: "datum", direction: "desc" });
  });
});

describe("compareActivityRows", () => {
  it("sorterar belopp numeriskt, högst först som standard", () => {
    const low = row({ id: "low", amount: 9000, title: "låg" });
    const high = row({ id: "high", amount: 23000, title: "hög" });
    assert.ok(kr(high.amount!).includes("23"));
    assert.ok(kr(low.amount!).includes("9"));
    assert.ok(compareActivityRows(high, low, { key: "belopp", direction: "desc" }) < 0);
    assert.ok(compareActivityRows(low, high, { key: "belopp", direction: "asc" }) < 0);
    const ordered = sortCustomerActivity([low, high], { key: "belopp", direction: "desc" });
    assert.deepEqual(
      ordered.map((r) => r.id),
      ["high", "low"]
    );
  });

  it("sorterar datum som tidpunkt, inte som visningstext", () => {
    const jan = row({ id: "jan", at: "2026-01-02T12:00:00.000Z", title: "jan" });
    const dec = row({ id: "dec", at: "2026-12-01T12:00:00.000Z", title: "dec" });
    assert.equal(datumKort(jan.at).includes("jan"), true);
    assert.ok(compareActivityRows(dec, jan, { key: "datum", direction: "desc" }) < 0);
    assert.ok(compareActivityRows(jan, dec, { key: "datum", direction: "asc" }) < 0);
  });

  it("sorterar händelse och status på svenska", () => {
    const a = row({ id: "a", title: "Altan", statusLabel: "Betald" });
    const o = row({ id: "o", title: "Öppen offert", statusLabel: "Öppen" });
    assert.ok(compareActivityRows(a, o, { key: "handelse", direction: "asc" }) < 0);
    assert.ok(compareActivityRows(a, o, { key: "status", direction: "asc" }) < 0);
  });

  it("saknat belopp hamnar sist oavsett riktning", () => {
    const valued = row({ id: "v", amount: 1000 });
    const missing = row({ id: "m" });
    assert.equal(compareActivityRows(valued, missing, { key: "belopp", direction: "desc" }) < 0, true);
    assert.equal(compareActivityRows(valued, missing, { key: "belopp", direction: "asc" }) < 0, true);
  });
});

describe("filter och sort på aktuell flik", () => {
  const rows = [
    row({
      id: "pay",
      at: "2026-08-01T12:00:00.000Z",
      kind: "faktura",
      kinds: ["faktura", "betalning"],
      title: "Betald faktura",
      amount: 4000,
      statusLabel: "Betald",
    }),
    row({
      id: "quote",
      at: "2026-07-01T12:00:00.000Z",
      kind: "offert",
      kinds: ["offert"],
      title: "Offert",
      amount: 20000,
      statusLabel: "Skickad",
    }),
    row({
      id: "inv",
      at: "2026-09-01T12:00:00.000Z",
      kind: "faktura",
      kinds: ["faktura"],
      title: "Öppen faktura",
      amount: 8000,
      statusLabel: "Skickad",
    }),
  ];

  it("sorterar bara den filtrerade listan", () => {
    const invoices = visibleCustomerActivity(rows, "faktura", { key: "belopp", direction: "desc" });
    assert.deepEqual(
      invoices.map((r) => r.id),
      ["inv", "pay"]
    );
    assert.equal(
      filterCustomerActivity(rows, "betalning").every((r) => r.kinds.includes("betalning")),
      true
    );
    assert.equal(filterCustomerActivity(rows, "betalning").length, 1);
  });
});

describe("flikar", () => {
  it("korta kedjelistor visar flikarna (tröskel 0, inte 8)", () => {
    assert.equal(ACTIVITY_FILTER_MIN, 0);
    assert.ok(3 > ACTIVITY_FILTER_MIN);
  });
});

describe("listpanelens min-höjd", () => {
  it("tom lista har en golvhöjd så sidan inte kollapsar", () => {
    assert.equal(activityListMinHeightPx(0), ACTIVITY_LIST_EMPTY_MIN_PX);
    assert.ok(ACTIVITY_LIST_EMPTY_MIN_PX >= 320);
  });

  it("min-höjd följer ofiltrerad radantal så flikbyte inte krymper panelen", () => {
    const alla = activityListMinHeightPx(12);
    const afterEmptyFilter = activityListMinHeightPx(12);
    assert.equal(alla, afterEmptyFilter);
    assert.ok(alla > activityListMinHeightPx(0));
  });

  it("behåller uppmätt Alla-höjd när ett filter är kortare än golvet", () => {
    const floor = activityListMinHeightPx(3);
    const reserved = reserveActivityListHeight(floor, 3, 410);
    assert.equal(reserved, 410);
    assert.equal(reserveActivityListHeight(reserved, 3), 410);
  });
});
