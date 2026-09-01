"use client";

import { useState } from "react";
import { AppLink } from "./app-link";
import { kr, datumKort } from "@/lib/format";
import {
  ACTIVITY_FILTER_MIN,
  type CustomerActivityKind,
  type CustomerActivityRow,
  type CustomerMoneyLine,
} from "@/lib/customer-activity-model";
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
  const showFilter = rows.length > ACTIVITY_FILTER_MIN;
  const visible = filter === "alla" ? rows : rows.filter((r) => (r.kinds ?? [r.kind]).includes(filter));

  return (
    <div>
      {money ? (
        <p className="mb-2 text-[13px] text-muted">
          {kr(money.avtalat)} avtalat · {kr(money.fakturerat)} fakturerat · {kr(money.obetalt)} obetalt
        </p>
      ) : null}
      {showFilter ? (
        <div className="mb-3 flex flex-wrap gap-1">
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
      {visible.length === 0 ? (
        <p className="text-[14px] text-muted">Ingen aktivitet ännu.</p>
      ) : (
        <Card className={LIST_CARD_CLASS}>
          <table className={LIST_TABLE_CLASS}>
            <thead>
              <tr className={LIST_HEAD_ROW_CLASS}>
                <th className="px-4 py-2.5 font-medium">Datum</th>
                <th className="px-4 py-2.5 font-medium">Händelse</th>
                <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Belopp</th>
                <th className="px-4 py-2.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
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
                    {row.amount != null ? (
                      <span className="mt-0.5 block text-[13px] text-muted sm:hidden">{kr(row.amount)}</span>
                    ) : null}
                  </td>
                  <td className="pointer-events-none hidden px-4 py-3 text-right tabular text-soft sm:table-cell">
                    {row.amount != null ? kr(row.amount) : "—"}
                  </td>
                  <td className="pointer-events-none px-4 py-3 text-right text-[13px] text-muted">{row.statusLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
