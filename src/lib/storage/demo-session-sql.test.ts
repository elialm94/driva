process.env.DRIVA_TEST = "1";

/**
 * Demosessionslagret i Supabase-läge: EN jsonb-rad per session som alla
 * serverless-instanser delar (PGlite här – ingen Docker).
 *
 * Buggen som testas bort: kundens "Godkänn offert" skrevs till instans A:s
 * fil/minne medan Ekonomi-registret renderades av instans B, som klonade ett
 * färskt seed och visade #115 som "Väntar på godkännande". Med raden i
 * databasen och versionskontroll per läsning ser B alltid A:s skrivning.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pgliteClient, type SqlClient } from "./executor";
import { setSqlClientForTests } from "./adapter-supabase";
import { ensureDemoSessionsSchema } from "./apply-pending-schema";
import { runInTenantContext, type TenantContext } from "./context";
import {
  __resetDemoSessionCacheForTests,
  __useDemoSessionSqlCacheForTests,
  cleanupExpiredDemoSessions,
  deleteDemoSessionState,
  ensureDemoSessionState,
  loadDemoSessionState,
  persistDemoSessionState,
  resetDemoSessionState,
  setDemoSessionBackendForTests,
} from "./demo-session-store";
import { newDemoSessionId } from "../auth/demo-session";
import { __resetQuoteAcceptRateLimitForTests, acceptQuote } from "../services/quote-accept";
import { listQuotesForTable } from "../services/economy-list";
import { effectiveQuoteStatus, getQuoteByToken, quoteAcceptance } from "../services/data";
import { QUOTE_STATUS, QUOTE_STATUS_FILTER } from "../status-labels";
import { db } from "../store";
import type { DB } from "../types";

type InstanceCache = Map<string, { state: DB; stateVersion: number }>;

let pg: PGlite;
let client: SqlClient;

/**
 * Speglar runInDemoSession: sessionens tillstånd in i tenantkontexten,
 * fn muterar via db()/save(), och hela tillståndet skrivs ner efteråt.
 */
async function onInstance<T>(
  cache: InstanceCache,
  sessionId: string,
  access: "read" | "write",
  fn: () => T
): Promise<T> {
  __useDemoSessionSqlCacheForTests(cache);
  const state = await ensureDemoSessionState(sessionId);
  const ctx: TenantContext = {
    businessId: `demo-${sessionId}`,
    userId: null,
    writable: access === "write",
    state,
    baseline: state,
    stateVersion: 0,
    dirty: false,
  };
  try {
    return runInTenantContext(ctx, fn);
  } finally {
    if (ctx.dirty) await persistDemoSessionState(sessionId, state);
  }
}

async function rowVersion(id: string): Promise<number | null> {
  const rows = await client.query(`select state_version from public.demo_sessions where id = $1`, [id]);
  return rows[0] ? Number(rows[0].state_version) : null;
}

before(async () => {
  pg = await PGlite.create();
  client = pgliteClient(pg);
  setSqlClientForTests(client);
  setDemoSessionBackendForTests("sql");
});

after(async () => {
  setDemoSessionBackendForTests(null);
  setSqlClientForTests(null);
  await client.close();
});

beforeEach(() => {
  __resetDemoSessionCacheForTests();
  __resetQuoteAcceptRateLimitForTests();
});

afterEach(() => {
  __resetDemoSessionCacheForTests();
});

describe("demo_sessions-schemat", () => {
  it("skapas idempotent av pending-schema-vägen (produktion utan db push)", async () => {
    const first = await ensureDemoSessionsSchema(client);
    assert.deepEqual(first, ["demo_sessions"]);
    const second = await ensureDemoSessionsSchema(client);
    assert.deepEqual(second, []);
    const cols = await client.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'demo_sessions' order by ordinal_position`
    );
    assert.deepEqual(
      cols.map((c) => c.column_name),
      ["id", "state", "state_version", "created_at", "updated_at", "expires_at"]
    );
  });

  it("avvisar id:n utanför sessionsalfabetet redan i databasen", async () => {
    await assert.rejects(
      () =>
        client.query(`insert into public.demo_sessions (id, state, expires_at) values ($1, '{}'::jsonb, now())`, [
          "../../etc/passwd",
        ]),
      /demo_sessions_id_format/
    );
  });
});

describe("SQL-lagret: en rad per demosession, delad mellan instanser", () => {
  it("första träffen klonar seedet till en rad; samma instans återanvänder objektet", async () => {
    const id = newDemoSessionId();
    const state = await ensureDemoSessionState(id);
    assert.equal(state.meta.demo, true);
    assert.equal(await rowVersion(id), 1);
    // Oförändrad version = samma objektidentitet (parallella requests delar).
    assert.equal(await ensureDemoSessionState(id), state);
  });

  it("P1: godkännande på instans A syns i Ekonomi-registret på instans B", async () => {
    const id = newDemoSessionId();
    const instanceA: InstanceCache = new Map();
    const instanceB: InstanceCache = new Map();

    // B har redan renderat registret en gång (varm cache med seedet).
    await onInstance(instanceB, id, "read", () => {
      const rows = listQuotesForTable({ status: "alla" }).rows;
      const fasad = rows.find((r) => r.number === 115);
      assert.ok(fasad);
      assert.equal(fasad.statusLabel, QUOTE_STATUS.skickad.label);
    });

    // Kunden godkänner via offertlänken – requesten landar på A.
    const accepted = await onInstance(instanceA, id, "write", () =>
      acceptQuote({ token: "demo-bertil-fasad", name: "Bertil Lindqvist" })
    );
    assert.equal(accepted.outcome, "accepted");
    assert.equal(await rowVersion(id), 2);

    // Registret renderas av B: versionskontrollen upptäcker A:s skrivning.
    await onInstance(instanceB, id, "read", () => {
      const quote = getQuoteByToken("demo-bertil-fasad");
      assert.ok(quote);
      assert.equal(effectiveQuoteStatus(quote), "godkand");
      assert.ok(quoteAcceptance(quote.id), "godkännandet följer med");

      const alla = listQuotesForTable({ status: "alla" }).rows;
      const fasad = alla.find((r) => r.number === 115);
      assert.ok(fasad);
      assert.equal(fasad.statusKey, "godkand");
      assert.equal(fasad.statusLabel, QUOTE_STATUS.godkand.label);

      const godkanda = listQuotesForTable({ status: "godkand" }).rows;
      assert.deepEqual(
        godkanda.map((r) => r.number).sort((a, b) => a - b),
        [106, 110, 111, 115],
        `${QUOTE_STATUS_FILTER.godkand} ska innehålla #115`
      );
      const vantar = listQuotesForTable({ status: "skickad" }).rows;
      assert.ok(!vantar.some((r) => r.number === 115));
    });

    // Kundkedjan: Bertils uppdrag är kopplat till den godkända offerten.
    await onInstance(instanceB, id, "read", () => {
      const quote = getQuoteByToken("demo-bertil-fasad")!;
      assert.ok(quote.jobId, "offerten pekar på ett uppdrag");
      const job = db().jobs.find((j) => j.id === quote.jobId);
      assert.ok(job);
      assert.equal(job.customerId, quote.customerId);
      assert.equal(db().customers.find((c) => c.id === quote.customerId)?.name, "Bertil Lindqvist");
    });
  });

  it("två sessioner är isolerade: egna rader, egna kloner", async () => {
    const a = newDemoSessionId();
    const b = newDemoSessionId();
    const stateA = await ensureDemoSessionState(a);
    await ensureDemoSessionState(b);
    stateA.customers.push({ ...stateA.customers[0], id: "cust-a", name: "Bara hos A" });
    await persistDemoSessionState(a, stateA);
    __resetDemoSessionCacheForTests();
    assert.ok((await ensureDemoSessionState(a)).customers.some((c) => c.name === "Bara hos A"));
    assert.ok(!(await ensureDemoSessionState(b)).customers.some((c) => c.name === "Bara hos A"));
  });

  it("återställning på en instans ger färskt seed på alla instanser", async () => {
    const id = newDemoSessionId();
    const instanceA: InstanceCache = new Map();
    const instanceB: InstanceCache = new Map();
    await onInstance(instanceA, id, "write", () =>
      acceptQuote({ token: "demo-bertil-fasad", name: "Bertil Lindqvist" })
    );
    await onInstance(instanceB, id, "read", () => {
      assert.equal(getQuoteByToken("demo-bertil-fasad")!.status, "godkand");
    });
    __useDemoSessionSqlCacheForTests(instanceA);
    await resetDemoSessionState(id);
    await onInstance(instanceB, id, "read", () => {
      assert.equal(getQuoteByToken("demo-bertil-fasad")!.status, "skickad");
    });
  });

  it("avsluta tar bort sessionens rad – och bara den", async () => {
    const a = newDemoSessionId();
    const b = newDemoSessionId();
    await ensureDemoSessionState(a);
    await ensureDemoSessionState(b);
    await deleteDemoSessionState(a);
    assert.equal(await loadDemoSessionState(a), null);
    assert.equal(await rowVersion(a), null);
    assert.equal(await rowVersion(b), 1);
  });

  it("städningen tar utgångna rader men rör inte färska", async () => {
    const gammal = newDemoSessionId();
    const farsk = newDemoSessionId();
    await ensureDemoSessionState(gammal);
    await ensureDemoSessionState(farsk);
    await client.query(`update public.demo_sessions set expires_at = now() - interval '1 hour' where id = $1`, [
      gammal,
    ]);
    const removed = await cleanupExpiredDemoSessions();
    assert.equal(removed, 1);
    assert.equal(await rowVersion(gammal), null);
    assert.equal(await rowVersion(farsk), 1);
  });

  it("ogiltiga session-id:n når aldrig databasen", async () => {
    await assert.rejects(() => ensureDemoSessionState("../../../etc/passwd"), /Ogiltigt/);
    await assert.rejects(() => ensureDemoSessionState("KORT"), /Ogiltigt/);
  });
});
