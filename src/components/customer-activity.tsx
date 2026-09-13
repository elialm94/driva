"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { AppLink } from "./app-link";
import { kr, datumKort } from "@/lib/format";
import {
  ACTIVITY_FILTER_MIN,
  type CustomerActivityKind,
  type CustomerActivityRow,
  type CustomerMoneyLine,
} from "@/lib/customer-activity-model";
import {
  DEFAULT_ACTIVITY_SORT,
  activityListMinHeightPx,
  nextActivitySort,
  reserveActivityListHeight,
  visibleCustomerActivity,
  type ActivitySortKey,
  type ActivitySortState,
} from "@/lib/customer-activity-sort";
import { Card, cx } from "./ui";
import { LIST_BODY_ROW_CLASS, LIST_CARD_CLASS, LIST_HEAD_ROW_CLASS, LIST_ROW_LINK_CLASS, LIST_TABLE_CLASS } from "./table-classes";

const FILTERS: { key: "alla" | CustomerActivityKind; label: string }[] = [
  { key: "alla", label: "Alla" },
  { key: "offert", label: "Offerter" },
  { key: "faktura", label: "Fakturor" },
  { key: "uppdrag", label: "Uppdrag" },
  { key: "betalning", label: "Betalningar" },
];

export function CustomerActivity({
  rows,
  money,
  originLabel,
}: {
  rows: CustomerActivityRow[];
  money: CustomerMoneyLine | null;
  originLabel?: string;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("alla");
  const [sort, setSort] = useState<ActivitySortState>(DEFAULT_ACTIVITY_SORT);
  const showFilter = rows.length > ACTIVITY_FILTER_MIN;
  const visible = visibleCustomerActivity(rows, filter, sort);
  const panelRef = useRef<HTMLDivElement>(null);
  const [reservedPx, setReservedPx] = useState(() => activityListMinHeightPx(rows.length));

  useLayoutEffect(() => {
    const floor = activityListMinHeightPx(rows.length);
    if (filter !== "alla") {
      setReservedPx((prev) => Math.max(prev, floor));
      return;
    }
    const measured = panelRef.current?.getBoundingClientRect().height ?? 0;
    setReservedPx((prev) => reserveActivityListHeight(prev, rows.length, measured));
  }, [filter, rows.length, sort, visible.length]);

  return (
    <div>
      {money ? (
        <p className="mb-2 text-[13px] text-muted">
          {kr(money.avtalat)} avtalat · {kr(money.fakturerat)} fakturerat · {kr(money.obetalt)} obetalt
        </p>
      ) : null}
      {showFilter ? (
        <div className="mb-3 flex flex-wrap gap-1" data-activity-tabs>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cx(
                "rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
                filter === f.key ? "bg-ink text-white" : "text-muted hover:bg-ink/5 hover:text-ink"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}
      <div
        ref={panelRef}
        className="flex flex-col justify-start"
        data-activity-list
        data-activity-min-height={reservedPx}
        style={{ minHeight: reservedPx }}
      >
        <Card className={LIST_CARD_CLASS}>
          <table className={LIST_TABLE_CLASS}>
            <thead>
              <tr className={LIST_HEAD_ROW_CLASS}>
                <SortTh label="Datum" sortKey="datum" current={sort} onSort={setSort} />
                <SortTh label="Händelse" sortKey="handelse" current={sort} onSort={setSort} />
                <SortTh label="Belopp" sortKey="belopp" current={sort} onSort={setSort} align="right" />
                <SortTh label="Status" sortKey="status" current={sort} onSort={setSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-3 align-top text-[14px] text-muted">
                    Ingen aktivitet ännu.
                  </td>
                </tr>
              ) : (
                visible.map((row) => (
                  <tr key={row.id} className={LIST_BODY_ROW_CLASS}>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      <AppLink href={row.href} originLabel={originLabel} className={LIST_ROW_LINK_CLASS} aria-label={row.title}>
                        <span className="sr-only">{row.title}</span>
                      </AppLink>
                      <span className="pointer-events-none">{datumKort(row.at)}</span>
                    </td>
                    <td className="pointer-events-none px-4 py-3">
                      <span className="font-medium text-ink">{row.title}</span>
                      {row.subtitle ? (
                        <span className="mt-0.5 block text-[13px] text-muted">{row.subtitle}</span>
                      ) : null}
                    </td>
                    <td className="pointer-events-none px-4 py-3 text-right tabular text-soft">
                      {row.amount != null ? kr(row.amount) : "—"}
                    </td>
                    <td className="pointer-events-none px-4 py-3 text-right text-[13px] text-muted">{row.statusLabel}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function SortTh({
  label,
  sortKey,
  current,
  onSort,
  align,
  className,
}: {
  label: string;
  sortKey: ActivitySortKey;
  current: ActivitySortState;
  onSort: (sort: ActivitySortState) => void;
  align?: "right";
  className?: string;
}) {
  const active = current.key === sortKey;
  const direction = active ? current.direction : undefined;
  const Icon = active ? (direction === "asc" ? ChevronUp : ChevronDown) : ArrowUpDown;
  return (
    <th
      className={cx("p-0", className)}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        data-activity-sort={sortKey}
        onClick={() => onSort(nextActivitySort(sortKey, current))}
        className={cx(
          "flex w-full cursor-pointer items-center gap-1 px-4 py-2.5 font-medium transition-colors hover:text-ink",
          align === "right" && "justify-end",
          active ? "text-ink" : "text-muted"
        )}
      >
        {label}
        <Icon className="size-3 shrink-0 opacity-60" aria-hidden />
      </button>
    </th>
  );
}
