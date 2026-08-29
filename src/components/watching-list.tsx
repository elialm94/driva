"use client";

import { useState } from "react";
import { AppLink } from "./app-link";
import { Card } from "./ui";
import { datumKort } from "@/lib/format";
import type { WatchingItem } from "@/lib/services/actions";

/** Så många På gång-rader visas direkt – resten bakom "Visa fler". */
export const HOME_WATCHING_VISIBLE = 6;

/**
 * Enkel, skannbar lista för Hem → På gång.
 * Mobil: kompakt tvåradare, hela ytan är tryckyta. Ingen tabell.
 */
export function WatchingList({
  items,
  initialVisible = HOME_WATCHING_VISIBLE,
}: {
  items: WatchingItem[];
  initialVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const hidden = Math.max(0, items.length - initialVisible);
  const visible = expanded || hidden === 0 ? items : items.slice(0, initialVisible);

  return (
    <div>
      <Card className="divide-y divide-line/70">
        {visible.map((item) => (
          <AppLink
            key={item.id}
            href={item.href}
            className="flex min-h-11 items-start gap-3 px-5 py-3 transition-colors first:rounded-t-[calc(1.25rem-1px)] last:rounded-b-[calc(1.25rem-1px)] hover:bg-canvas/60 sm:items-center sm:gap-4"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-ink max-sm:line-clamp-2 sm:truncate">{item.title}</p>
              <p className="mt-0.5 text-[13px] text-soft max-sm:line-clamp-2 sm:truncate">{item.subtitle}</p>
            </div>
            <span className="shrink-0 pt-0.5 text-[13px] tabular text-muted sm:pt-0">{datumKort(item.date)}</span>
          </AppLink>
        ))}
      </Card>
      {hidden > 0 && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 min-h-11 text-[13px] font-medium text-soft hover:text-ink"
        >
          Visa {hidden} till
        </button>
      ) : null}
    </div>
  );
}
