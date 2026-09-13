/**
 * Rapportera "säkra" fel till Sentry från serverkod (integrationer, cron,
 * webhooks). Bara metadata: route, integration, korrelations-id, release
 * och – om SENTRY_TENANT_SALT finns – en irreversibel tenant-hash.
 * Själva felet skrubbas dessutom i beforeSend (scrub.ts).
 *
 * Utan DSN görs ingenting förutom att korrelations-id:t returneras så att
 * UI/loggar ändå kan visa ett id att söka på i serverloggen.
 */
import { createHash } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { appRelease, isSentryConfigured, newCorrelationId, type Env } from "./config";

/**
 * Irreversibel tenant-hash för felkorrelation. Utan salt returneras null och
 * ingen tenant-tagg sätts – ett osaltat hash av ett UUID är inte anonymt.
 */
export function tenantHash(businessId: string | null | undefined, env: Env = process.env): string | null {
  const salt = env.SENTRY_TENANT_SALT?.trim();
  if (!businessId || !salt) return null;
  return createHash("sha256").update(`${salt}:${businessId}`).digest("hex").slice(0, 16);
}

export interface SafeErrorContext {
  route?: string;
  integration?: "stripe" | "resend" | "tink" | "filing" | "supabase" | "openrouter" | "cron" | "auth";
  businessId?: string | null;
  correlationId?: string;
  /** Extra, redan icke-känsliga nycklar (skrubbas ändå). */
  extra?: Record<string, string | number | boolean | null>;
}

export function reportSafeError(error: unknown, ctx: SafeErrorContext = {}): string {
  const correlationId = ctx.correlationId ?? newCorrelationId();
  if (!isSentryConfigured()) {
    console.error(`[ferva] fel ${correlationId}${ctx.integration ? ` (${ctx.integration})` : ""}:`, error instanceof Error ? error.message : error);
    return correlationId;
  }
  Sentry.withScope((scope) => {
    scope.setTag("correlationId", correlationId);
    scope.setTag("release", appRelease());
    if (ctx.route) scope.setTag("route", ctx.route);
    if (ctx.integration) scope.setTag("integration", ctx.integration);
    const hash = tenantHash(ctx.businessId);
    if (hash) scope.setTag("tenant", hash);
    if (ctx.extra) scope.setExtras(ctx.extra);
    Sentry.captureException(error);
  });
  return correlationId;
}
