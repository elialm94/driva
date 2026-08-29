"use client";

import { useEffect, useState, useTransition } from "react";
import { AppLink } from "./app-link";
import { useRouter } from "next/navigation";
import { Inbox, Search } from "lucide-react";
import { Avatar, Badge, Card, EmptyState, cx } from "./ui";
import { Pagination } from "./customer-list";
import { relativ } from "@/lib/format";
import { inquiryHref } from "@/lib/nav";
import type { InquiryInboxFilter, InquiryInboxRow, PagedResult } from "@/lib/services/customers";

export interface InquiryInboxQuery {
  q: string;
  filter: InquiryInboxFilter;
  page: number;
}

export function kunderInboxHref(query: Partial<InquiryInboxQuery> = {}): string {
  const sp = new URLSearchParams();
  if (query.q) sp.set("q", query.q);
  if (query.filter && query.filter !== "oppna") sp.set("visning", query.filter);
  if (query.page && query.page > 1) sp.set("sida", String(query.page));
  const qs = sp.toString();
  return qs ? `/inbox?${qs}` : "/inbox";
}

export function InquiryInbox({
  result,
  query,
}: {
  result: PagedResult<InquiryInboxRow>;
  query: InquiryInboxQuery;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(query.q);

  useEffect(() => {
    setQ(query.q);
  }, [query.q]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (q === query.q) return;
      startTransition(() => router.replace(kunderInboxHref({ ...query, q, page: 1 }), { scroll: false }));
    }, 200);
    return () => clearTimeout(handle);
  }, [q, query, router]);

  function go(patch: Partial<InquiryInboxQuery>) {
    startTransition(() => router.replace(kunderInboxHref({ ...query, ...patch }), { scroll: false }));
  }

  return (
    <div className={cx(pending && "opacity-70")}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Sök kund, företag, text eller kontakt..."
            className="w-full rounded-2xl border border-line bg-card py-2.5 pl-10 pr-4 text-[15px] shadow-card placeholder:text-muted focus:border-accent"
          />
        </div>
        <div className="flex gap-1 rounded-2xl bg-ink/4 p-1">
          {(
            [
              ["oppna", "Öppna"],
              ["alla", "Alla"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => go({ filter: key, page: 1 })}
              className={cx(
                "rounded-xl px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                query.filter === key ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {result.total === 0 ? (
        <EmptyState
          icon={Inbox}
          title={query.q ? "Inga förfrågningar matchar" : query.filter === "oppna" ? "Inga öppna förfrågningar" : "Inga förfrågningar ännu"}
          text={
            query.q
              ? "Prova ett annat sökord."
              : query.filter === "oppna"
                ? "Nya förfrågningar från hemsidan och telefon landar här."
                : undefined
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className="overflow-hidden">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className="border-b border-line/80 text-[12px] font-medium uppercase tracking-wide text-muted">
                    <th className="px-3 py-2.5 font-medium">Kund</th>
                    <th className="px-3 py-2.5 font-medium">Förfrågan</th>
                    <th className="px-3 py-2.5 font-medium">Inkommen</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.id} className="relative border-b border-line/60 last:border-0 hover:bg-canvas/70">
                      <td className="px-3 py-2.5">
                        <AppLink href={inquiryHref(r.id)} className="absolute inset-0 z-10" aria-label={r.title}>
                          <span className="sr-only">{r.customerName}</span>
                        </AppLink>
                        <div className="pointer-events-none flex items-center gap-3">
                          <Avatar name={r.customerName} size="sm" />
                          <span className="truncate font-medium text-ink">{r.customerName}</span>
                        </div>
                      </td>
                      <td className="pointer-events-none px-3 py-2.5">
                        <span className="block truncate font-medium text-ink">{r.title}</span>
                        <span className="block truncate text-[13px] text-muted">{r.summary}</span>
                      </td>
                      <td className="pointer-events-none px-3 py-2.5 text-soft">{relativ(r.createdAt)}</td>
                      <td className="pointer-events-none px-3 py-2.5">
                        <Badge tone={r.status === "ny" ? "info" : "neutral"}>
                          {r.status === "ny" ? "Ny" : "Hanterad"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <div className="space-y-2 md:hidden">
            {result.rows.map((r) => (
              <AppLink key={r.id} href={inquiryHref(r.id)} className="card flex items-start gap-3 px-4 py-3">
                <Avatar name={r.customerName} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="truncate text-[15px] font-medium">{r.customerName}</p>
                    <Badge tone={r.status === "ny" ? "info" : "neutral"} className="shrink-0">
                      {r.status === "ny" ? "Ny" : "Hanterad"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-ink">{r.title}</p>
                  <p className="mt-0.5 text-[12px] text-muted">{relativ(r.createdAt)}</p>
                </div>
              </AppLink>
            ))}
          </div>

          <Pagination result={result} onPage={(page) => go({ page })} />
        </>
      )}
    </div>
  );
}
