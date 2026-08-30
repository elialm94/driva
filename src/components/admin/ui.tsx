/**
 * Presentationskomponenter för Driva Admin (server-säkra – ingen state).
 * Mörkt, informationstätt operatörs-UI, medvetet skilt från kundappens stil.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import type { MetricPoint } from "@/lib/platform/metrics";
import type { SupportTicketPriority, SupportTicketStatus } from "@/lib/platform/types";
import { SUPPORT_TICKET_PRIORITY_LABEL, SUPPORT_TICKET_STATUS_LABEL } from "@/lib/platform/types";

/* --------------------------------- Tid ------------------------------------- */

export function tidSedan(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "nyss";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

/** Supabase ban_duration sätter banned_until – kontot är inaktiverat tills dess. */
export function isBannedNow(bannedUntil?: string, now = Date.now()): boolean {
  return Boolean(bannedUntil && new Date(bannedUntil).getTime() > now);
}

export function datumTidKort(iso?: string): string {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/* -------------------------------- Byggstenar -------------------------------- */

export function AdminCard({
  title,
  right,
  children,
  className,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-xl border border-neutral-800 bg-neutral-900", className)}>
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-2.5">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-neutral-400">{title}</h2>
          {right}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "warn" | "danger" | "ok";
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <p className="text-[12px] text-neutral-500">{label}</p>
      <p
        className={cx(
          "mt-1 text-[22px] font-semibold leading-none tabular-nums tracking-tight",
          tone === "warn" && "text-amber-300",
          tone === "danger" && "text-red-400",
          tone === "ok" && "text-emerald-400",
          tone === "neutral" && "text-neutral-100"
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-[12px] text-neutral-500">{sub}</p> : null}
    </div>
  );
}

/** Minimal stapeltrend (14 dagar) – ren SVG, inga bibliotek. */
export function TrendBars({ points, label }: { points: MetricPoint[]; label: string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((s, p) => s + p.value, 0);
  const w = 6;
  const gap = 2;
  const h = 36;
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12px] text-neutral-500">{label}</p>
        <p className="text-[12px] tabular-nums text-neutral-400">{total} / 14 d</p>
      </div>
      <svg
        className="mt-2"
        width={points.length * (w + gap)}
        height={h}
        role="img"
        aria-label={`${label}: ${points.map((p) => `${p.date} ${p.value}`).join(", ")}`}
      >
        {points.map((p, i) => {
          const bh = Math.max(2, Math.round((p.value / max) * h));
          return (
            <rect
              key={p.date}
              x={i * (w + gap)}
              y={h - bh}
              width={w}
              height={bh}
              rx={1.5}
              className={p.value > 0 ? "fill-amber-400/80" : "fill-neutral-700"}
            >
              <title>{`${p.date}: ${p.value}`}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

/* --------------------------------- Tabell ----------------------------------- */

export function AdminTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-[11.5px] uppercase tracking-wide text-neutral-500">
            {head}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/70">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("px-4 py-2 font-medium", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("px-4 py-2.5 align-middle text-neutral-300", className)}>{children}</td>;
}

/* -------------------------------- Badges ------------------------------------ */

export function AdminBadge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "danger" | "info";
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium",
        tone === "neutral" && "bg-neutral-800 text-neutral-300",
        tone === "ok" && "bg-emerald-500/15 text-emerald-300",
        tone === "warn" && "bg-amber-400/15 text-amber-300",
        tone === "danger" && "bg-red-500/15 text-red-300",
        tone === "info" && "bg-sky-500/15 text-sky-300"
      )}
    >
      {children}
    </span>
  );
}

export function TicketStatusBadge({ status }: { status: SupportTicketStatus }) {
  const tone =
    status === "open" ? "warn" : status === "in_progress" ? "info" : status === "waiting_for_customer" ? "neutral" : "ok";
  return <AdminBadge tone={tone}>{SUPPORT_TICKET_STATUS_LABEL[status]}</AdminBadge>;
}

export function TicketPriorityBadge({ priority }: { priority: SupportTicketPriority }) {
  const tone = priority === "high" ? "danger" : priority === "low" ? "neutral" : "info";
  return <AdminBadge tone={tone}>{SUPPORT_TICKET_PRIORITY_LABEL[priority]}</AdminBadge>;
}

/* ------------------------------ Nyckel/värde -------------------------------- */

export function KeyValueList({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-neutral-800/70">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-4 px-4 py-2">
          <dt className="shrink-0 text-[12.5px] text-neutral-500">{r.label}</dt>
          <dd className="min-w-0 break-words text-right text-[13px] text-neutral-200">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------- Paginering --------------------------------- */

export function PaginationLinks({
  basePath,
  params,
  offset,
  limit,
  total,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  offset: number;
  limit: number;
  total: number;
}) {
  const href = (newOffset: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (newOffset > 0) sp.set("offset", String(newOffset));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-neutral-800 px-4 py-2.5 text-[12.5px] text-neutral-500">
      <span className="tabular-nums">
        {from}–{to} av {total}
      </span>
      <span className="flex gap-2">
        {offset > 0 ? (
          <Link className="text-neutral-300 hover:underline" href={href(Math.max(0, offset - limit)) as never}>
            ← Föregående
          </Link>
        ) : null}
        {offset + limit < total ? (
          <Link className="text-neutral-300 hover:underline" href={href(offset + limit) as never}>
            Nästa →
          </Link>
        ) : null}
      </span>
    </div>
  );
}

/* ------------------------------ Maskering ----------------------------------- */

/**
 * Maskera ev. personnummer i fritext (spec §32): 10/12-siffriga sekvenser
 * med typiskt format visas som ••••. Admin-UI:t frågar aldrig aktivt efter
 * personnummer – detta är ett skyddsnät för kundskriven ärendetext.
 */
export function maskPersonnummer(text: string): string {
  return text.replace(/\b(?:19|20)?\d{6}[-+ ]?\d{4}\b/g, "••••••-••••");
}
