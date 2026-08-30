/**
 * Minimal SQL-exekverare – smalt gränssnitt som både postgres.js (produktion)
 * och PGlite (integrationstester utan Docker) kan implementera. All Supabase-
 * adapterkod pratar ENBART med detta gränssnitt.
 */

import { recordQuery } from "../perf/telemetry";

export type SqlParam = string | number | boolean | null;

export interface SqlRow {
  [column: string]: unknown;
}

export interface SqlExecutor {
  /** Kör en parametriserad fråga ($1, $2, …) och returnerar raderna. */
  query(text: string, params?: SqlParam[]): Promise<SqlRow[]>;
}

export interface SqlClient extends SqlExecutor {
  /**
   * Kör `fn` i en transaktion. Kastar `fn` rullas transaktionen tillbaka.
   * Exekveraren som skickas in är bunden till transaktionen.
   */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  /** Stäng anslutningspoolen (tester/skript). */
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* postgres.js-implementation (produktion)                             */
/* ------------------------------------------------------------------ */

type PostgresSql = {
  unsafe(text: string, params?: unknown[]): Promise<unknown> & { values: unknown };
  begin<T>(fn: (sql: PostgresSql) => Promise<T>): Promise<T>;
  end(): Promise<void>;
};

class PostgresExecutor implements SqlExecutor {
  constructor(private readonly sql: PostgresSql) {}
  async query(text: string, params: SqlParam[] = []): Promise<SqlRow[]> {
    const t0 = performance.now();
    try {
      const rows = await this.sql.unsafe(text, params as unknown[]);
      return rows as unknown as SqlRow[];
    } finally {
      recordQuery(text, performance.now() - t0);
    }
  }
}

class PostgresClient extends PostgresExecutor implements SqlClient {
  constructor(private readonly root: PostgresSql) {
    super(root);
  }
  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.root.begin(async (txSql) => fn(new PostgresExecutor(txSql)));
  }
  async close(): Promise<void> {
    await this.root.end();
  }
}

let cachedClient: SqlClient | null = null;
let cachedUrl: string | null = null;

/**
 * Global postgres.js-klient mot SUPABASE_DB_URL. Kompatibel med Supavisor i
 * transaktionsläge (prepare: false). bigint → number (belopp är heltal kronor
 * och ligger långt under Number.MAX_SAFE_INTEGER).
 */
export async function getSqlClient(dbUrl: string): Promise<SqlClient> {
  if (cachedClient && cachedUrl === dbUrl) return cachedClient;
  const { default: postgres } = await import("postgres");
  const sql = postgres(dbUrl, {
    prepare: false,
    max: 10,
    idle_timeout: 30,
    connect_timeout: 15,
    // UTC på anslutningsnivå – datumsemantiska timestamptz-kolumner får
    // aldrig tolkas i serverns lokala tidszon.
    connection: { TimeZone: "UTC" },
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (v: unknown) => String(v),
        parse: (v: string) => Number(v),
      },
    },
  }) as unknown as PostgresSql;
  cachedClient = new PostgresClient(sql);
  cachedUrl = dbUrl;
  return cachedClient;
}

/* ------------------------------------------------------------------ */
/* PGlite-implementation (tester/valideringsskript)                    */
/* ------------------------------------------------------------------ */

type PgliteDb = {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  transaction<T>(fn: (tx: { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> }) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

/** Wrappa en PGlite-instans i samma gränssnitt som produktionens klient. */
export function pgliteClient(db: PgliteDb): SqlClient {
  const wrap = (q: PgliteDb["query"]): SqlExecutor => ({
    async query(text, params = []) {
      const t0 = performance.now();
      try {
        const res = await q(text, params as unknown[]);
        return res.rows as SqlRow[];
      } finally {
        recordQuery(text, performance.now() - t0);
      }
    },
  });
  return {
    ...wrap(db.query.bind(db)),
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => fn(wrap(tx.query.bind(tx))));
    },
    async close() {
      await db.close();
    },
  };
}
