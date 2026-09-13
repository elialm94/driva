import { test } from "node:test";
import assert from "node:assert/strict";
import { OpsError, parseRestoreDrillInput, backupStatus, recordCronRun } from "./ops";
import { insertOpsRecord, latestOpsRecord, listOpsRecords } from "./store";
import { normalizeFactorName, normalizeTotpCode } from "./mfa";
import { platformMfaRequired } from "./auth";

const base = {
  performedOn: "2026-09-01",
  targetEnvironment: "ferva-staging",
  responsible: "Anna",
  result: "ok",
  rpoMinutes: "5",
  rtoMinutes: "45",
};

test("parseRestoreDrillInput godkänner komplett staging-drill och rundar tal", () => {
  const out = parseRestoreDrillInput({ ...base, rpoMinutes: "4.6", pitrConfirmedOn: "2026-08-30", notes: " ok " });
  assert.equal(out.performedOn, "2026-09-01");
  assert.equal(out.rpoMinutes, 5);
  assert.equal(out.rtoMinutes, 45);
  assert.equal(out.pitrConfirmedOn, "2026-08-30");
  assert.equal(out.notes, "ok");
  assert.equal(out.checks, undefined);
});

test("parseRestoreDrillInput vägrar produktion, framtida datum och ofullständiga fält", () => {
  assert.throws(() => parseRestoreDrillInput({ ...base, targetEnvironment: "ferva-production" }), OpsError);
  assert.throws(() => parseRestoreDrillInput({ ...base, performedOn: "2999-01-01" }), OpsError);
  assert.throws(() => parseRestoreDrillInput({ ...base, performedOn: "1 sep" }), OpsError);
  assert.throws(() => parseRestoreDrillInput({ ...base, responsible: "" }), OpsError);
  assert.throws(() => parseRestoreDrillInput({ ...base, result: "kanske" }), OpsError);
  assert.throws(() => parseRestoreDrillInput({ ...base, rtoMinutes: "-1" }), OpsError);
});

test("parseRestoreDrillInput tar bara kända fält ur scriptets JSON", () => {
  const out = parseRestoreDrillInput({
    ...base,
    checksJson: JSON.stringify({
      schemaOk: true,
      latestMigration: "20260912150000",
      tenantCount: 12,
      immutabilityOk: true,
      balancesOk: false,
      checksum: "abc123",
      host: "db.hemligt.supabase.co",
      personnummer: "19850315-1234",
    }),
  });
  assert.deepEqual(out.checks, {
    schemaOk: true,
    latestMigration: "20260912150000",
    tenantCount: 12,
    immutabilityOk: true,
    balancesOk: false,
    checksum: "abc123",
  });
  assert.throws(() => parseRestoreDrillInput({ ...base, checksJson: "{inte json" }), OpsError);
});

test("backupStatus: Ej verifierat utan drill, förfallen efter 180 dagar eller underkänd", async () => {
  const none = await backupStatus();
  assert.equal(none.lastDrill, null);
  assert.equal(none.stale, true);

  await insertOpsRecord({
    id: "d1",
    kind: "restore_drill",
    createdAt: "2026-01-10T10:00:00.000Z",
    status: "ok",
    environment: "ferva-staging",
    summary: { performedOn: "2026-01-10", responsible: "Anna", rpoMinutes: 5, rtoMinutes: 40 },
  });
  const old = await backupStatus(new Date("2026-09-01T00:00:00Z").getTime());
  assert.equal(old.lastDrill?.id, "d1");
  assert.equal(old.stale, true);
  const fresh = await backupStatus(new Date("2026-03-01T00:00:00Z").getTime());
  assert.equal(fresh.stale, false);
  assert.equal(fresh.daysSinceDrill, 50);

  await insertOpsRecord({
    id: "d2",
    kind: "restore_drill",
    createdAt: "2026-08-10T10:00:00.000Z",
    status: "fel",
    environment: "ferva-staging",
    summary: { performedOn: "2026-08-10", responsible: "Anna", rpoMinutes: 5, rtoMinutes: 40 },
  });
  const failed = await backupStatus(new Date("2026-08-11T00:00:00Z").getTime());
  assert.equal(failed.lastDrill?.id, "d2");
  assert.equal(failed.stale, true);
});

test("recordCronRun loggar status ok/partiell/fel utan att kasta", async () => {
  await recordCronRun("reminders", { businesses: 3, errors: 0, extra: { quotes: 1, invoices: 2 } }, 120);
  await recordCronRun("reminders", { businesses: 3, errors: 1 }, 100);
  await recordCronRun("reminders", { businesses: 2, errors: 2 }, 90);
  const runs = await listOpsRecords({ kind: "cron_run" });
  assert.deepEqual(
    runs.map((r) => r.status).sort(),
    ["fel", "ok", "partiell"]
  );
  const latest = await latestOpsRecord("cron_run");
  assert.equal(latest?.summary.job, "reminders");
});

test("TOTP-kod och faktornamn normaliseras", () => {
  assert.equal(normalizeTotpCode("123 456"), "123456");
  assert.equal(normalizeTotpCode("12345"), null);
  assert.equal(normalizeTotpCode("abcdef"), null);
  assert.equal(normalizeFactorName("  Min\u0000 telefon "), "Min telefon");
  assert.equal(normalizeFactorName(""), "Autentiseringsapp");
});

test("MFA-kravet är av i JSON-läget (ingen Supabase Auth) oavsett env", () => {
  assert.equal(platformMfaRequired({ VERCEL_ENV: "production" }), false);
});
