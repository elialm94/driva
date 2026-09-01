"use client";

import { useEffect, useState, useTransition } from "react";
import { AppLink } from "./app-link";
import { useRouter } from "next/navigation";
import { Inbox, Search } from "lucide-react";
import { Avatar, Badge, Card, EmptyState, cx } from "./ui";
import { Pagination } from "./customer-list";
import { datumKort, relativ } from "@/lib/format";
import type { InboxListFilter, InboxListRow, PagedResult } from "@/lib/services/inbox";
import { LIST_BODY_ROW_CLASS, LIST_CARD_CLASS, LIST_HEAD_ROW_CLASS, LIST_ROW_LINK_CLASS, LIST_TABLE_CLASS } from "./table-classes";

export interface InboxListQuery {
  q: string;
  filter: InboxListFilter;
  page: number;
}

export function inboxListHref(query: Partial<InboxListQuery> = {}): string {
  const sp = new URLSearchParams();
  if (query.q) sp.set("q", query.q);
  if (query.filter && query.filter !== "oppna") sp.set("visning", query.filter);
  if (query.page && query.page > 1) sp.set("sida", String(query.page));
  const qs = sp.toString();
  return qs ? `/inbox?${qs}` : "/inbox";
}

function statusTone(tone: InboxListRow["statusTone"]): "neutral" | "info" | "ok" | "warn" | "danger" {
  return tone;
}

export function InboxList({
  result,
  query,
}: {
  result: PagedResult<InboxListRow>;
  query: InboxListQuery;
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
      startTransition(() => router.replace(inboxListHref({ ...query, q, page: 1 }), { scroll: false }));
    }, 200);
    return () => clearTimeout(handle);
  }, [q, query, router]);

  function go(patch: Partial<InboxListQuery>) {
    startTransition(() => router.replace(inboxListHref({ ...query, ...patch }), { scroll: false }));
  }

  return (
    <div className={cx(pending && "opacity-70")}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Sök leverantör, faktura eller dokument..."
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
                "min-h-11 rounded-xl px-3.5 py-1.5 text-[13px] font-medium transition-colors",
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
          title={query.q ? "Inget matchar" : query.filter === "oppna" ? "Inget öppet i inboxen" : "Inboxen är tom"}
          text={
            query.q
              ? "Prova leverantör, fakturanummer, belopp eller OCR."
              : query.filter === "oppna"
                ? "Leverantörsfakturor och kvitton som behöver kompletteras eller godkännas landar här."
                : "När någon skickar eller vidarebefordrar fakturor och kvitton till er inkommande adress syns det här."
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className={LIST_CARD_CLASS}>
              <table className={LIST_TABLE_CLASS}>
                <thead>
                  <tr className={LIST_HEAD_ROW_CLASS}>
                    <th className="px-3 py-2.5 font-medium">Från</th>
                    <th className="px-3 py-2.5 font-medium">Dokument</th>
                    <th className="px-3 py-2.5 font-medium">Förfaller</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.id} className={LIST_BODY_ROW_CLASS}>
                      <td className="px-3 py-2.5">
                        <AppLink href={`/inbox/${r.id}`} className={LIST_ROW_LINK_CLASS} aria-label={r.documentLabel}>
                          <span className="sr-only">{r.fromLabel}</span>
                        </AppLink>
                        <div className="pointer-events-none flex items-center gap-3">
                          <Avatar name={r.fromLabel} size="sm" />
                          <span className="truncate font-medium text-ink">{r.fromLabel}</span>
                        </div>
                      </td>
                      <td className="pointer-events-none px-3 py-2.5">
                        <span className="block truncate font-medium text-ink">{r.documentLabel}</span>
                      </td>
                      <td className="pointer-events-none px-3 py-2.5 text-soft">
                        {r.dueDate ? datumKort(r.dueDate) : relativ(r.createdAt)}
                      </td>
                      <td className="pointer-events-none px-3 py-2.5">
                        <Badge tone={statusTone(r.statusTone)}>{r.statusLabel}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <div className="space-y-2 md:hidden">
            {result.rows.map((r) => (
              <AppLink key={r.id} href={`/inbox/${r.id}`} className="card flex items-start gap-3 px-4 py-3">
                <Avatar name={r.fromLabel} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="truncate text-[15px] font-medium">{r.fromLabel}</p>
                    <Badge tone={statusTone(r.statusTone)} className="shrink-0">
                      {r.statusLabel}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-ink">{r.documentLabel}</p>
                  <p className="mt-0.5 text-[12px] text-muted">{r.dueDate ? `Förfaller ${datumKort(r.dueDate)}` : relativ(r.createdAt)}</p>
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
