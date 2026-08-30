/**
 * CENTRALA MÄTVÄRDESDEFINITIONER för Driva Admin – det enda stället där ett
 * plattformsmätvärde definieras. Komponenter räknar ALDRIG själva.
 *
 * Endast mätvärden som kan härledas KORREKT ur riktig data – inga påhittade
 * siffror. Fakturering/prenumerationer finns inte ⇒ ingen MRR/ARR/churn.
 * När underlag saknas visar UI:t "Okänd"/"–", aldrig en grön fejksiffra.
 *
 * Definitioner:
 *   Signup                 rad i auth.users (created_at).
 *   Nytt företag           rad i businesses (created_at), exkl. is_demo.
 *   Genomförd onboarding   användare med ≥ 1 aktivt owner-medlemskap.
 *   Aktivt företag         ≥ 1 audit_log-händelse i perioden, exkl. is_demo.
 *   Offert skapad          rad i quotes (created_at).
 *   Faktura utfärdad       invoices.issued_at satt (utkast räknas inte).
 *   Dokument processat     inbox_items.processed_at satt.
 *   Auto-bokfört           verifications.created_by = 'auto' (posted_at).
 *   AI-anrop               audit_log channel='assistant' event_type='llm_request';
 *                          kostnad = summan av metadata.params.estimatedCostUsd.
 *   Mejl skickade/fel      email_events (loggas av mail-lagret).
 *   Supportkö              support_tickets per status; äldsta öppna ålder.
 *
 * Demo-företag (businesses.is_demo) exkluderas ur förvärvs-/aktivitets-KPI:er
 * men syns i volymer där de uttryckligen markeras.
 */
import { isSupabaseMode } from "../storage/config";
import { sqlClient } from "../storage/adapter-supabase";
import { db } from "../store";
import { collaborationRegistry, activeMembershipsForUser } from "../collaboration/registry";
import { countEmailEventsSince, countSupportTicketsByStatus, listSupportTickets } from "./store";

export interface MetricPoint {
  /** YYYY-MM-DD (UTC). */
  date: string;
  value: number;
}

export interface PlatformOverview {
  today: {
    newUsers: number;
    newBusinesses: number;
    activeBusinesses: number;
    openTickets: number;
    failures24h: number;
  };
  acquisition: {
    usersTotal: number;
    businessesTotal: number;
    demoBusinesses: number;
    signups7d: number;
    signups30d: number;
    businesses7d: number;
    businesses30d: number;
    /** Andel användare med ≥1 aktivt owner-medlemskap (0–1). null = okänt. */
    onboardingConversion: number | null;
  };
  engagement: {
    activeBusinesses7d: number;
    activeBusinesses30d: number;
    quotes30d: number;
    invoicesIssued30d: number;
    jobs30d: number;
  };
  automation: {
    documentsProcessed30d: number;
    verificationsPosted30d: number;
    verificationsAuto30d: number;
    /** 0–1 andel auto av bokförda verifikationer. null när inga finns. */
    autoShare30d: number | null;
  };
  ai: {
    calls30d: number;
    errors30d: number;
    /** Summerad uppskattad kostnad i USD. null = ingen data. */
    estimatedCostUsd30d: number | null;
  };
  email: {
    sent30d: number;
    failed30d: number;
  };
  support: {
    open: number;
    inProgress: number;
    waiting: number;
    resolvedTotal: number;
    oldestOpenHours: number | null;
  };
  trends: {
    signups: MetricPoint[];
    businesses: MetricPoint[];
    quotes: MetricPoint[];
    invoicesIssued: MetricPoint[];
    documentsProcessed: MetricPoint[];
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const TREND_DAYS = 14;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function isoDaysAgo(days: number, now = Date.now()): string {
  return new Date(now - days * DAY_MS).toISOString();
}

function startOfTodayUtc(now = new Date()): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/** Bygg en komplett dagserie (nollor för dagar utan data). */
function fillTrend(counts: Map<string, number>, days = TREND_DAYS, now = Date.now()): MetricPoint[] {
  const points: MetricPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    points.push({ date, value: counts.get(date) ?? 0 });
  }
  return points;
}

function countByDay(isoDates: (string | undefined)[], sinceIso: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const iso of isoDates) {
    if (!iso || iso < sinceIso) continue;
    const key = dayKey(iso);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

async function supportBlock(): Promise<PlatformOverview["support"]> {
  const counts = await countSupportTicketsByStatus();
  const openTickets = await listSupportTickets({ statuses: ["open"], limit: 200 });
  let oldestOpenHours: number | null = null;
  if (openTickets.length > 0) {
    const oldest = openTickets[openTickets.length - 1];
    oldestOpenHours = Math.round((Date.now() - new Date(oldest.createdAt).getTime()) / 3_600_000);
  }
  return {
    open: counts.open,
    inProgress: counts.in_progress,
    waiting: counts.waiting_for_customer,
    resolvedTotal: counts.resolved,
    oldestOpenHours,
  };
}

export async function platformOverview(now = new Date()): Promise<PlatformOverview> {
  const nowMs = now.getTime();
  const since7 = isoDaysAgo(7, nowMs);
  const since30 = isoDaysAgo(30, nowMs);
  const since1 = isoDaysAgo(1, nowMs);
  const sinceTrend = isoDaysAgo(TREND_DAYS, nowMs);
  const todayStart = startOfTodayUtc(now);

  const [support, email] = await Promise.all([supportBlock(), countEmailEventsSince(since30)]);

  if (!isSupabaseMode()) {
    // JSON-läget: ETT lokalt demoföretag. Mätvärdena beräknas ur samma
    // definitioner men underlaget är demodata – ytan är dev-only.
    const state = db();
    const reg = collaborationRegistry();
    const usersTotal = reg.users.length;
    const owners = reg.users.filter((u) =>
      activeMembershipsForUser(u.id).some((m) => m.role === "owner")
    ).length;
    const quotes = state.quotes.map((q) => q.createdAt);
    const invoicesIssued = state.invoices.map((i) => i.issuedAt ?? undefined);
    const documents = state.inboxItems.map((i) => i.processedAt ?? undefined);
    const verifications30 = state.verifications.filter((v) => v.postedAt >= since30);
    const auto30 = verifications30.filter((v) => v.createdBy === "auto");
    const ai = state.assistantAudit.filter((a) => a.tool === "llm_request" && a.at >= since30);
    const aiErrors = ai.filter((a) => !a.success).length;
    const aiCost = ai.reduce((sum, a) => {
      const params = a.params as { estimatedCostUsd?: number } | null;
      return sum + (typeof params?.estimatedCostUsd === "number" ? params.estimatedCostUsd : 0);
    }, 0);
    const activityLast = (sinceIso: string) => (state.activity.some((a) => a.at >= sinceIso) ? 1 : 0);

    return {
      today: {
        newUsers: 0,
        newBusinesses: 0,
        activeBusinesses: activityLast(todayStart),
        openTickets: support.open,
        failures24h: email.failed + state.assistantAudit.filter((a) => !a.success && a.at >= since1).length,
      },
      acquisition: {
        usersTotal,
        businessesTotal: 1,
        demoBusinesses: 1,
        signups7d: 0,
        signups30d: 0,
        businesses7d: 0,
        businesses30d: 0,
        onboardingConversion: usersTotal > 0 ? owners / usersTotal : null,
      },
      engagement: {
        activeBusinesses7d: activityLast(since7),
        activeBusinesses30d: activityLast(since30),
        quotes30d: quotes.filter((d) => d >= since30).length,
        invoicesIssued30d: invoicesIssued.filter((d) => d && d >= since30).length,
        jobs30d: state.jobs.filter((j) => j.createdAt >= since30).length,
      },
      automation: {
        documentsProcessed30d: documents.filter((d) => d && d >= since30).length,
        verificationsPosted30d: verifications30.length,
        verificationsAuto30d: auto30.length,
        autoShare30d: verifications30.length > 0 ? auto30.length / verifications30.length : null,
      },
      ai: {
        calls30d: ai.length,
        errors30d: aiErrors,
        estimatedCostUsd30d: ai.length > 0 ? aiCost : null,
      },
      email: { sent30d: email.sent, failed30d: email.failed },
      support,
      trends: {
        signups: fillTrend(new Map(), TREND_DAYS, nowMs),
        businesses: fillTrend(new Map(), TREND_DAYS, nowMs),
        quotes: fillTrend(countByDay(quotes, sinceTrend), TREND_DAYS, nowMs),
        invoicesIssued: fillTrend(countByDay(invoicesIssued, sinceTrend), TREND_DAYS, nowMs),
        documentsProcessed: fillTrend(countByDay(documents, sinceTrend), TREND_DAYS, nowMs),
      },
    };
  }

  const client = await sqlClient();
  const [core, aiRows, trendRows] = await Promise.all([
    client.query(
      `select
         (select count(*)::int from auth.users) as users_total,
         (select count(*)::int from auth.users u where u.created_at >= $1) as users_today,
         (select count(*)::int from auth.users u where u.created_at >= $2) as users_7d,
         (select count(*)::int from auth.users u where u.created_at >= $3) as users_30d,
         (select count(distinct m.user_id)::int from public.business_memberships m
           where m.role = 'owner' and m.revoked_at is null) as owners_total,
         (select count(*)::int from public.businesses b where b.is_demo = false) as businesses_total,
         (select count(*)::int from public.businesses b where b.is_demo = true) as demo_businesses,
         (select count(*)::int from public.businesses b where b.is_demo = false and b.created_at >= $1) as businesses_today,
         (select count(*)::int from public.businesses b where b.is_demo = false and b.created_at >= $2) as businesses_7d,
         (select count(*)::int from public.businesses b where b.is_demo = false and b.created_at >= $3) as businesses_30d,
         (select count(distinct a.business_id)::int from public.audit_log a
           join public.businesses b on b.id = a.business_id
           where b.is_demo = false and a.created_at >= $1) as active_today,
         (select count(distinct a.business_id)::int from public.audit_log a
           join public.businesses b on b.id = a.business_id
           where b.is_demo = false and a.created_at >= $2) as active_7d,
         (select count(distinct a.business_id)::int from public.audit_log a
           join public.businesses b on b.id = a.business_id
           where b.is_demo = false and a.created_at >= $3) as active_30d,
         (select count(*)::int from public.quotes q
           join public.businesses b on b.id = q.business_id
           where b.is_demo = false and q.created_at >= $3) as quotes_30d,
         (select count(*)::int from public.invoices i
           join public.businesses b on b.id = i.business_id
           where b.is_demo = false and i.issued_at is not null and i.issued_at >= $3) as invoices_30d,
         (select count(*)::int from public.jobs j
           join public.businesses b on b.id = j.business_id
           where b.is_demo = false and j.created_at >= $3) as jobs_30d,
         (select count(*)::int from public.inbox_items x
           join public.businesses b on b.id = x.business_id
           where b.is_demo = false and x.processed_at is not null and x.processed_at >= $3) as documents_30d,
         (select count(*)::int from public.verifications v
           join public.businesses b on b.id = v.business_id
           where b.is_demo = false and v.posted_at >= $3) as verifications_30d,
         (select count(*)::int from public.verifications v
           join public.businesses b on b.id = v.business_id
           where b.is_demo = false and v.posted_at >= $3 and v.created_by = 'auto') as verifications_auto_30d`,
      [todayStart, since7, since30]
    ),
    client.query(
      `select
         count(*)::int as calls,
         count(*) filter (where coalesce((metadata->>'success')::boolean, false) = false)::int as errors,
         coalesce(sum((metadata->'params'->>'estimatedCostUsd')::numeric), 0) as cost,
         count(*) filter (where coalesce((metadata->>'success')::boolean, false) = false and created_at >= $2)::int as errors_24h
       from public.audit_log
       where channel = 'assistant' and event_type = 'llm_request' and created_at >= $1`,
      [since30, since1]
    ),
    client.query(
      `select kind, day, n from (
         select 'signup' as kind, date_trunc('day', u.created_at)::date::text as day, count(*)::int as n
           from auth.users u where u.created_at >= $1 group by 2
         union all
         select 'business', date_trunc('day', b.created_at)::date::text, count(*)::int
           from public.businesses b where b.is_demo = false and b.created_at >= $1 group by 2
         union all
         select 'quote', date_trunc('day', q.created_at)::date::text, count(*)::int
           from public.quotes q join public.businesses b on b.id = q.business_id
           where b.is_demo = false and q.created_at >= $1 group by 2
         union all
         select 'invoice', date_trunc('day', i.issued_at)::date::text, count(*)::int
           from public.invoices i join public.businesses b on b.id = i.business_id
           where b.is_demo = false and i.issued_at is not null and i.issued_at >= $1 group by 2
         union all
         select 'document', date_trunc('day', x.processed_at)::date::text, count(*)::int
           from public.inbox_items x join public.businesses b on b.id = x.business_id
           where b.is_demo = false and x.processed_at is not null and x.processed_at >= $1 group by 2
       ) t`,
      [sinceTrend]
    ),
  ]);

  const c = core[0] ?? {};
  const ai = aiRows[0] ?? {};
  const n = (v: unknown) => (v == null ? 0 : Number(v));

  const trendMaps: Record<string, Map<string, number>> = {
    signup: new Map(),
    business: new Map(),
    quote: new Map(),
    invoice: new Map(),
    document: new Map(),
  };
  for (const r of trendRows) {
    const map = trendMaps[String(r.kind)];
    if (map) map.set(String(r.day), n(r.n));
  }

  const verifications30 = n(c.verifications_30d);
  const auto30 = n(c.verifications_auto_30d);
  const aiCalls = n(ai.calls);
  const usersTotal = n(c.users_total);

  return {
    today: {
      newUsers: n(c.users_today),
      newBusinesses: n(c.businesses_today),
      activeBusinesses: n(c.active_today),
      openTickets: support.open,
      failures24h: email.failed + n(ai.errors_24h),
    },
    acquisition: {
      usersTotal,
      businessesTotal: n(c.businesses_total),
      demoBusinesses: n(c.demo_businesses),
      signups7d: n(c.users_7d),
      signups30d: n(c.users_30d),
      businesses7d: n(c.businesses_7d),
      businesses30d: n(c.businesses_30d),
      onboardingConversion: usersTotal > 0 ? n(c.owners_total) / usersTotal : null,
    },
    engagement: {
      activeBusinesses7d: n(c.active_7d),
      activeBusinesses30d: n(c.active_30d),
      quotes30d: n(c.quotes_30d),
      invoicesIssued30d: n(c.invoices_30d),
      jobs30d: n(c.jobs_30d),
    },
    automation: {
      documentsProcessed30d: n(c.documents_30d),
      verificationsPosted30d: verifications30,
      verificationsAuto30d: auto30,
      autoShare30d: verifications30 > 0 ? auto30 / verifications30 : null,
    },
    ai: {
      calls30d: aiCalls,
      errors30d: n(ai.errors),
      estimatedCostUsd30d: aiCalls > 0 ? Number(ai.cost ?? 0) : null,
    },
    email: { sent30d: email.sent, failed30d: email.failed },
    support,
    trends: {
      signups: fillTrend(trendMaps.signup, TREND_DAYS, nowMs),
      businesses: fillTrend(trendMaps.business, TREND_DAYS, nowMs),
      quotes: fillTrend(trendMaps.quote, TREND_DAYS, nowMs),
      invoicesIssued: fillTrend(trendMaps.invoice, TREND_DAYS, nowMs),
      documentsProcessed: fillTrend(trendMaps.document, TREND_DAYS, nowMs),
    },
  };
}
