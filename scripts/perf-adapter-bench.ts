/**
 * Prestandabänk för lagringslagret (Postgres-vägen) – ingen Docker krävs.
 *
 * Kör riktiga adapterflöden mot PGlite (Postgres/WASM) med demoseeden
 * importerad via appens egen commit-väg, och rapporterar det som spelar roll
 * för navigeringskostnaden i Supabase-läge:
 *
 *   * antal SQL-frågor per sidladdning (bind + tillståndsladdning)
 *   * antal rader som läses in per samling
 *   * tid för laddning + mappning (CPU, exkl. nätverk – rundresor räknas separat)
 *   * effekten av snapshot-cachen (varm vs kall sidladdning)
 *
 * Körs med:  DRIVA_TEST=1 npx tsx scripts/perf-adapter-bench.ts
 */
import { createMigratedPglite } from "./pglite-db";
import { pgliteClient } from "../src/lib/storage/executor";
import type { SqlClient, SqlExecutor, SqlParam, SqlRow } from "../src/lib/storage/executor";
import {
  createBusinessWithOwner,
  loadStateSnapshot,
  membershipsForUser,
  setSqlClientForTests,
} from "../src/lib/storage/adapter-supabase";
import { importStateIntoBusiness } from "../src/lib/storage/import-state";
import { buildSeed } from "../src/lib/seed";
import { normalize } from "../src/lib/store";

const USER = "11111111-1111-4111-8111-111111111111";

interface Counter {
  queries: number;
  transactions: number;
  log: string[];
}

function countingClient(inner: SqlClient, counter: Counter): SqlClient {
  const wrapExecutor = (ex: SqlExecutor): SqlExecutor => ({
    async query(text: string, params?: SqlParam[]): Promise<SqlRow[]> {
      counter.queries += 1;
      counter.log.push(text.replace(/\s+/g, " ").trim().slice(0, 90));
      return ex.query(text, params);
    },
  });
  return {
    ...wrapExecutor(inner),
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      counter.transactions += 1;
      return inner.transaction(async (tx) => fn(wrapExecutor(tx)));
    },
    close: () => inner.close(),
  };
}

function reset(counter: Counter) {
  counter.queries = 0;
  counter.transactions = 0;
  counter.log = [];
}

async function main() {
  console.log("Startar PGlite + migrationer …");
  const { db: pg } = await createMigratedPglite();
  const counter: Counter = { queries: 0, transactions: 0, log: [] };
  const counted = countingClient(pgliteClient(pg), counter);
  setSqlClientForTests(counted);

  await pg.query(`insert into auth.users (id, email) values ($1, 'agare@driva.test')`, [USER]);
  const businessId = await createBusinessWithOwner({
    userId: USER,
    name: "Södermalms Snickeri AB",
    orgNumber: "556123-4567",
    email: "info@sodermalms.se",
    phone: "070-123 45 67",
  });

  console.log("Importerar demoseeden genom appens commit-väg …");
  const seed = normalize(buildSeed());
  const t0 = performance.now();
  await importStateIntoBusiness(businessId, USER, seed);
  console.log(`Import klar på ${Math.round(performance.now() - t0)} ms\n`);

  // ---------------- per-navigering: medlemskapsuppslag ----------------
  reset(counter);
  await membershipsForUser(USER);
  console.log(`membershipsForUser: ${counter.queries} frågor`);

  // ---------------- per-navigering: full tillståndsladdning ----------------
  reset(counter);
  const tLoad = performance.now();
  const state = await loadStateSnapshot(businessId);
  const loadMs = performance.now() - tLoad;
  const loadQueries = counter.queries;

  console.log(`\nloadStateSnapshot (EN sidladdning i Supabase-läge):`);
  console.log(`  SQL-frågor: ${loadQueries}`);
  console.log(`  Tid (PGlite, exkl. nätverksrundresor): ${loadMs.toFixed(1)} ms`);
  console.log(`  Payload (JSON-storlek på hela tillståndet): ${(JSON.stringify(state).length / 1024).toFixed(0)} kB`);

  const rows: Array<[string, number]> = Object.entries(state)
    .map(([k, v]): [string, number] => [k, Array.isArray(v) ? v.length : v ? 1 : 0])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  console.log(`  Rader per samling (topp 15):`);
  for (const [k, n] of rows.slice(0, 15)) console.log(`    ${k}: ${n}`);

  console.log(`\n  Frågelogg (${counter.log.length} frågor):`);
  for (const q of counter.log) console.log(`    ${q}`);

  // ---------------- simulera "Hem → Kunder"-navigering ----------------
  // En sidnavigering i Supabase-läge = requireBusiness (medlemskap) +
  // loadStateSnapshot. Mät helheten kall och varm (5 upprepningar).
  console.log(`\nSimulerad sidnavigering (medlemskap + tillståndsladdning), 5 upprepningar:`);
  for (let i = 1; i <= 5; i++) {
    reset(counter);
    const t = performance.now();
    await membershipsForUser(USER);
    await loadStateSnapshot(businessId);
    console.log(`  #${i}: ${counter.queries} frågor, ${(performance.now() - t).toFixed(1)} ms`);
  }

  await counted.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
