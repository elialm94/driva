/**
 * Lätt prestandatelemetri för datalagret (§ prestandapasset).
 *
 * Mäter per OPERATION i lagringslagret – tillståndsladdning, commit,
 * medlemskapsuppslag, versionskontroll – med antal SQL-frågor, total tid
 * och långsammaste fråga. En sidnavigering i Supabase-läge motsvarar
 * exakt en "load"-operation, så loggen läses som per-navigeringskostnad.
 *
 * AV som standard i produktion. Slås på med DRIVA_PERF=1 (server-miljö)
 * eller automatiskt i utveckling. Ingen loggning, ingen overhead annars:
 * skrivvägen är två villkorskontroller när telemetrin är av.
 *
 * Läsning: raderna skrivs till serverloggen som
 *   [driva:perf] load business=<id> queries=43 total=38ms slowest=9ms(select * from public.verifications …)
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface PerfSpan {
  name: string;
  startedAt: number;
  queries: number;
  slowestMs: number;
  slowestSql: string;
  cacheHit?: boolean;
}

const spans = new AsyncLocalStorage<PerfSpan>();

export function perfEnabled(): boolean {
  if (process.env.DRIVA_PERF === "1") return true;
  if (process.env.DRIVA_PERF === "0") return false;
  return process.env.NODE_ENV === "development";
}

/** Kör fn i ett mätspann och logga resultatet (no-op när telemetrin är av). */
export async function withPerfSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!perfEnabled()) return fn();
  const span: PerfSpan = { name, startedAt: performance.now(), queries: 0, slowestMs: 0, slowestSql: "" };
  try {
    return await spans.run(span, fn);
  } finally {
    logSpan(span);
  }
}

/** Registrera en SQL-fråga i det aktiva spannet (anropas av exekveraren). */
export function recordQuery(sql: string, ms: number): void {
  const span = spans.getStore();
  if (!span) return;
  span.queries += 1;
  if (ms > span.slowestMs) {
    span.slowestMs = ms;
    span.slowestSql = sql.replace(/\s+/g, " ").trim().slice(0, 80);
  }
}

/** Markera att spannet betjänades från snapshot-cachen. */
export function markCacheHit(): void {
  const span = spans.getStore();
  if (span) span.cacheHit = true;
}

function logSpan(span: PerfSpan): void {
  const total = Math.round(performance.now() - span.startedAt);
  const slow =
    span.slowestMs > 0 ? ` slowest=${span.slowestMs.toFixed(1)}ms(${span.slowestSql})` : "";
  const hit = span.cacheHit ? " cache=HIT" : "";
  console.info(`[driva:perf] ${span.name} queries=${span.queries} total=${total}ms${hit}${slow}`);
}
