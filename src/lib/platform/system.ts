/**
 * Systemvy för Ferva Admin: ENDAST verifierbar driftstatus.
 *
 * Principen är ärlighet: en leverantör vars hälsa inte kan verifieras utan
 * sidoeffekter (Resend, OpenRouter) visas som "Okänd" med konfigurations-
 * status + senaste faktiska fel – aldrig en grön fejklampa. Hemligheter
 * (nycklar) exponeras aldrig, bara OM de är satta.
 */
import { hasSupabaseEnv, isSupabaseMode, supabaseServiceRoleKey, supabaseUrl } from "../storage/config";
import { sqlClient } from "../storage/adapter-supabase";
import { aiConfig, isAiConfigured } from "../ai/provider";
import { isLiveMailConfigured, mailFromAddress } from "../mail";
import { db } from "../store";
import { platformMfaRequired } from "./auth";
import { latestOpsRecord, listEmailEvents } from "./store";
import type { EmailEvent, OpsRecord } from "./types";
import { isStripeConfigured, stripeConfigProblems, stripeModeHint } from "../billing/config";
import { billingStore } from "../billing/store";
import { isTinkConfigured } from "../banking/tink/config";
import { readFilingConfig } from "../filing/config";
import { appRelease, isSentryConfigured, sentryClientDsn, sentryServerDsn, sentrySourceMapsEnabled } from "../observability/config";
import { EXPECTED_MIGRATION_VERSION } from "../storage/schema-version";
import { backupStatus, type BackupStatus } from "./ops";

export type HealthState = "ok" | "fel" | "okand";

export interface SystemStatus {
  storageMode: "supabase" | "json";
  db: { state: HealthState; latencyMs?: number; error?: string };
  supabase: { configured: boolean; projectUrl?: string };
  resend: { configured: boolean; fromAddress: string; failures7d: number; state: HealthState };
  ai: {
    configured: boolean;
    provider: string;
    modelFast: string;
    modelSmart: string;
    errors7d: number;
    state: HealthState;
  };
  authAdmin: { serviceRoleAvailable: boolean };
  deployment: {
    vercelEnv?: string;
    commitSha?: string;
    region?: string;
    nodeEnv: string;
  };
  mfa: { required: boolean };
  /** Applikationsversion (release-sträng) och senaste migration i DB vs kod. */
  version: { release: string; expectedMigration: string };
  migrations: {
    applied?: string;
    expected: string;
    state: HealthState;
    /** Migrationer i koden som databasen saknar ⇒ kör `supabase db push`. */
    behind: boolean;
    error?: string;
  };
  sentry: { configured: boolean; server: boolean; client: boolean; sourceMaps: boolean };
  tink: { configured: boolean; state: HealthState };
  filing: { provider: "live" | "unconfigured" | "mock"; configured: boolean };
  cron: { lastRun?: OpsRecord; ageHours?: number; state: HealthState };
  inboundMail: { lastEvent?: OpsRecord; state: HealthState };
  emailTest: { last?: OpsRecord };
  backup: BackupStatus;
  webhooks: { queued: number; failed7d: number };
  stripe: {
    configured: boolean;
    mode: "test" | "live" | null;
    /** Konfigurationsproblem i klartext – aldrig värden. */
    problems: string[];
    webhookFailures7d: number;
    lastEventAt?: string;
    state: HealthState;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function dbHealth(): Promise<SystemStatus["db"]> {
  if (!isSupabaseMode()) return { state: "ok", latencyMs: 0 };
  const started = Date.now();
  try {
    const client = await sqlClient();
    await client.query(`select 1`);
    return { state: "ok", latencyMs: Date.now() - started };
  } catch (e) {
    return { state: "fel", error: e instanceof Error ? e.message : "Okänt databasfel" };
  }
}

async function aiErrorsLast7d(): Promise<number> {
  const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
  if (!isSupabaseMode()) {
    return db().assistantAudit.filter((a) => !a.success && a.at >= since).length;
  }
  const client = await sqlClient();
  const rows = await client.query(
    `select count(*)::int as n from public.audit_log
      where channel = 'assistant'
        and coalesce((metadata->>'success')::boolean, false) = false
        and created_at >= $1`,
    [since]
  );
  return Number(rows[0]?.n ?? 0);
}

async function migrationStatus(): Promise<SystemStatus["migrations"]> {
  if (!isSupabaseMode()) return { expected: EXPECTED_MIGRATION_VERSION, state: "ok", behind: false, applied: "(JSON-läge)" };
  try {
    const client = await sqlClient();
    const present = await client.query(`select to_regclass('supabase_migrations.schema_migrations') is not null as present`);
    if (!present[0]?.present) {
      return {
        expected: EXPECTED_MIGRATION_VERSION,
        state: "okand",
        behind: false,
        error: "Tabellen supabase_migrations.schema_migrations saknas – migrationer verkar inte köras via Supabase CLI.",
      };
    }
    const rows = await client.query(`select version from supabase_migrations.schema_migrations order by version desc limit 1`);
    const applied = rows[0]?.version ? String(rows[0].version) : undefined;
    const behind = !applied || applied < EXPECTED_MIGRATION_VERSION;
    return { applied, expected: EXPECTED_MIGRATION_VERSION, state: behind ? "fel" : "ok", behind };
  } catch (e) {
    return { expected: EXPECTED_MIGRATION_VERSION, state: "okand", behind: false, error: e instanceof Error ? e.message : "okänt fel" };
  }
}

export async function systemStatus(now = Date.now()): Promise<SystemStatus> {
  const since7 = new Date(now - 7 * DAY_MS).toISOString();
  const [database, failedEmails, aiErrors, stripeEvents, stripeFailures, migrations, lastCron, lastInbound, lastEmailTest, backup, queuedWebhooks] =
    await Promise.all([
      dbHealth(),
      listEmailEvents({ status: "failed", limit: 200 }),
      aiErrorsLast7d().catch(() => 0),
      billingStore()
        .listRecentWebhookEvents(1)
        .catch(() => []),
      billingStore()
        .countWebhookFailuresSince(since7)
        .catch(() => 0),
      migrationStatus(),
      latestOpsRecord("cron_run").catch(() => null),
      latestOpsRecord("email_inbound").catch(() => null),
      latestOpsRecord("email_test_outbound").catch(() => null),
      backupStatus(now),
      billingStore()
        .countWebhookQueued()
        .catch(() => 0),
    ]);
  const cronAgeHours = lastCron ? (now - new Date(lastCron.createdAt).getTime()) / (60 * 60 * 1000) : undefined;
  const filingConfigured = readFilingConfig() !== null;
  const stripeConfigured = isStripeConfigured();
  const emailFailures7d = failedEmails.filter((e) => e.createdAt >= since7).length;
  const ai = aiConfig();
  const aiConfiguredNow = isAiConfigured();
  const resendConfigured = isLiveMailConfigured();

  return {
    storageMode: isSupabaseMode() ? "supabase" : "json",
    db: database,
    supabase: { configured: hasSupabaseEnv(), projectUrl: supabaseUrl() },
    resend: {
      configured: resendConfigured,
      fromAddress: mailFromAddress(),
      failures7d: emailFailures7d,
      // Ingen ping utan sidoeffekt finns: konfigurerad + inga färska fel ⇒ Okänd (inte grön).
      state: !resendConfigured ? "okand" : emailFailures7d > 0 ? "fel" : "okand",
    },
    ai: {
      configured: aiConfiguredNow,
      provider: ai.provider,
      modelFast: ai.modelFast,
      modelSmart: ai.modelSmart,
      errors7d: aiErrors,
      state: !aiConfiguredNow ? "okand" : aiErrors > 0 ? "fel" : "okand",
    },
    authAdmin: { serviceRoleAvailable: Boolean(supabaseServiceRoleKey()) },
    deployment: {
      vercelEnv: process.env.VERCEL_ENV?.trim() || undefined,
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA?.trim()?.slice(0, 12) || undefined,
      region: process.env.VERCEL_REGION?.trim() || undefined,
      nodeEnv: process.env.NODE_ENV ?? "development",
    },
    mfa: { required: platformMfaRequired() },
    version: { release: appRelease(), expectedMigration: EXPECTED_MIGRATION_VERSION },
    migrations,
    sentry: {
      configured: isSentryConfigured(),
      server: Boolean(sentryServerDsn()),
      client: Boolean(sentryClientDsn()),
      sourceMaps: sentrySourceMapsEnabled(),
    },
    tink: { configured: isTinkConfigured(), state: "okand" },
    filing: {
      provider: filingConfigured ? "live" : isSupabaseMode() ? "unconfigured" : "mock",
      configured: filingConfigured,
    },
    cron: {
      lastRun: lastCron ?? undefined,
      ageHours: cronAgeHours === undefined ? undefined : Math.round(cronAgeHours * 10) / 10,
      // Påminnelsecronen kör dagligen: >36 h utan körning eller senaste = fel ⇒ Fel.
      state: !lastCron ? "okand" : lastCron.status === "fel" || (cronAgeHours ?? 0) > 36 ? "fel" : "ok",
    },
    inboundMail: {
      lastEvent: lastInbound ?? undefined,
      state: !lastInbound ? "okand" : lastInbound.status === "ok" ? "ok" : "fel",
    },
    emailTest: { last: lastEmailTest ?? undefined },
    backup,
    webhooks: { queued: queuedWebhooks, failed7d: stripeFailures },
    stripe: {
      configured: stripeConfigured,
      mode: stripeModeHint(),
      problems: stripeConfigProblems(),
      webhookFailures7d: stripeFailures,
      lastEventAt: stripeEvents[0]?.receivedAt,
      // Ingen ping utan sidoeffekt: konfigurerad + inga färska webhookfel ⇒ Okänd.
      state: !stripeConfigured ? "okand" : stripeFailures > 0 ? "fel" : "okand",
    },
  };
}

export interface RecentFailure {
  at: string;
  kind: "email" | "ai";
  label: string;
  detail: string;
  businessId?: string;
}

/** Senaste fel (mejl + AI) för systemvyn – riktiga händelser, ingen simulering. */
export async function recentFailures(limit = 30): Promise<RecentFailure[]> {
  const failures: RecentFailure[] = [];
  const emails = await listEmailEvents({ status: "failed", limit });
  for (const e of emails) failures.push(emailFailureRow(e));

  if (!isSupabaseMode()) {
    for (const a of db().assistantAudit.filter((x) => !x.success).slice(-limit)) {
      failures.push({
        at: a.at,
        kind: "ai",
        label: `AI-anrop misslyckades (${a.tool})`,
        detail: a.error ?? "Okänt fel",
      });
    }
  } else {
    const client = await sqlClient();
    const rows = await client.query(
      `select business_id, created_at, event_type, metadata->>'error' as error
         from public.audit_log
        where channel = 'assistant' and coalesce((metadata->>'success')::boolean, false) = false
        order by created_at desc limit $1`,
      [limit]
    );
    for (const r of rows) {
      failures.push({
        at: new Date(r.created_at as string).toISOString(),
        kind: "ai",
        label: `AI-anrop misslyckades (${String(r.event_type ?? "")})`,
        detail: String(r.error ?? "Okänt fel"),
        businessId: r.business_id ? String(r.business_id) : undefined,
      });
    }
  }
  return failures.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

function emailFailureRow(e: EmailEvent): RecentFailure {
  return {
    at: e.createdAt,
    kind: "email",
    label: `Mejl misslyckades (${e.kind || "okänt"})`,
    detail: e.error ?? "Okänt fel",
    businessId: e.businessId,
  };
}
