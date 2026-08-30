/**
 * Systemvy för Driva Admin: ENDAST verifierbar driftstatus.
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
import { listEmailEvents } from "./store";
import type { EmailEvent } from "./types";

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

export async function systemStatus(): Promise<SystemStatus> {
  const since7 = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const [database, failedEmails, aiErrors] = await Promise.all([
    dbHealth(),
    listEmailEvents({ status: "failed", limit: 200 }),
    aiErrorsLast7d().catch(() => 0),
  ]);
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
