process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { cloneState, runInTenantContext, type TenantContext } from "./storage/context";
import {
  hideAttention,
  resolveSnoozeUntil,
  snoozeAttention,
  snoozeAttentionUntil,
  suppressedActionIds,
} from "./services/attention-state";
import { DAYPART_TIMES, instantFromLocal, localParts } from "./reminders/when";

/**
 * Uppmärksamhetstillstånd: snooze är ren presentationspolicy.
 *   * upsert per (actionId, användare) – aldrig dubbletter
 *   * per-användare med inloggning, företagsgemensamt (null) i JSON-läget
 *   * utgången snooze → raden är synlig igen
 */

const TZ = "Europe/Stockholm";

function ctxFor(userId: string | null): TenantContext {
  const state = db();
  return {
    businessId: "biz-test",
    userId,
    writable: true,
    state,
    baseline: cloneState(state),
    stateVersion: 1,
    dirty: false,
  };
}

describe("attention-state: snooze-tidpunkter", () => {
  it("senare idag = +3 timmar; imorgon = nästa lokala morgon", () => {
    const now = new Date("2026-08-28T10:00:00.000Z");
    assert.equal(resolveSnoozeUntil("senare_idag", now).getTime(), now.getTime() + 3 * 3_600_000);

    const tomorrow = resolveSnoozeUntil("imorgon", now);
    const p = localParts(now, TZ);
    const [hour, minute] = DAYPART_TIMES.morgon.split(":").map(Number);
    const expected = instantFromLocal({ year: p.year, month: p.month, day: p.day + 1, hour, minute }, TZ);
    assert.equal(tomorrow.toISOString(), expected.toISOString());
  });

  it("nästa vecka = nästa måndag; datum = lokal dagsstart; ogiltigt datum kastas", () => {
    const now = new Date("2026-08-28T10:00:00.000Z"); // en fredag
    const nextWeek = resolveSnoozeUntil("nasta_vecka", now);
    const p = localParts(nextWeek, TZ);
    // 2026-08-31 är måndagen efter.
    assert.deepEqual([p.year, p.month, p.day], [2026, 8, 31]);

    const picked = resolveSnoozeUntil({ date: "2026-09-15" }, now);
    const pp = localParts(picked, TZ);
    assert.deepEqual([pp.year, pp.month, pp.day, pp.hour, pp.minute], [2026, 9, 15, 0, 0]);

    assert.throws(() => resolveSnoozeUntil({ date: "imorgon" }, now), /Ogiltigt datum/);
  });
});

describe("attention-state: upsert och filter", () => {
  it("JSON-läget (ingen inloggning): företagsgemensam rad, upsert utan dubbletter", () => {
    replaceDb(emptyTestDb());
    const now = new Date("2026-08-28T10:00:00.000Z");

    snoozeAttention("invoice-late-inv-1", "imorgon", now);
    assert.equal(db().attentionStates.length, 1);
    assert.equal(db().attentionStates[0].userId, null);

    // Andra snoozen på samma rad UPPDATERAR – ingen ny rad.
    snoozeAttention("invoice-late-inv-1", "nasta_vecka", now);
    assert.equal(db().attentionStates.length, 1);

    const suppressed = suppressedActionIds(now);
    assert.ok(suppressed.has("invoice-late-inv-1"));

    // Efter tidpunkten: inte längre dold – raden återvänder om motorn ännu härleder den.
    const afterExpiry = new Date("2026-09-10T10:00:00.000Z");
    assert.ok(!suppressedActionIds(afterExpiry).has("invoice-late-inv-1"));
  });

  it("med inloggning: tillståndet är per användare; företagsgemensamma null-rader gäller alla", () => {
    replaceDb(emptyTestDb());
    const now = new Date("2026-08-28T10:00:00.000Z");

    // JSON-läge (null-användare) snoozar en rad – gäller företaget.
    snoozeAttention("quote-wait-q-1", "imorgon", now);

    runInTenantContext(ctxFor("user-1"), () => {
      snoozeAttention("invoice-late-inv-1", "imorgon", now);
      const mine = suppressedActionIds(now);
      assert.ok(mine.has("invoice-late-inv-1"), "egen snooze gäller");
      assert.ok(mine.has("quote-wait-q-1"), "företagsgemensam null-rad gäller alla");
    });

    runInTenantContext(ctxFor("user-2"), () => {
      const theirs = suppressedActionIds(now);
      assert.ok(!theirs.has("invoice-late-inv-1"), "user-1:s snooze läcker inte till user-2");
      assert.ok(theirs.has("quote-wait-q-1"));
    });

    // Två användare + null på samma rad = tre separata tillståndsrader.
    runInTenantContext(ctxFor("user-2"), () => {
      snoozeAttention("invoice-late-inv-1", "imorgon", now);
    });
    assert.equal(db().attentionStates.filter((s) => s.actionId === "invoice-late-inv-1").length, 2);
  });

  it("snoozeAttentionUntil validerar tidpunkten; framtidskrav upprätthålls", () => {
    replaceDb(emptyTestDb());
    const now = new Date("2026-08-28T10:00:00.000Z");
    snoozeAttentionUntil("receipt-exp-1", "2026-08-29T08:00:00.000Z", now);
    assert.ok(suppressedActionIds(now).has("receipt-exp-1"));
    assert.throws(() => snoozeAttentionUntil("receipt-exp-2", "inte-en-tid", now), /Ogiltig tidpunkt/);
    assert.throws(() => snoozeAttentionUntil("receipt-exp-2", "2026-08-28T09:00:00.000Z", now), /framåt/);
  });

  it("rader som aldrig ska tystas kan inte snoozas; HIDE finns inte för domänsanningar", () => {
    replaceDb(emptyTestDb());
    // Oförklarad bankdifferens ska aldrig kunna döljas.
    assert.throws(() => snoozeAttention("bank-unexplained", "imorgon"), /aldrig tystas/);
    // Ingen nuvarande typ deklarerar HIDE – domänavfärdan går via tjänsterna.
    assert.throws(() => hideAttention("job-new-job-1"), /kan inte döljas permanent/);
    assert.throws(() => hideAttention("invoice-late-inv-1"), /kan inte döljas permanent/);
    assert.equal(db().attentionStates.length, 0);
  });
});
