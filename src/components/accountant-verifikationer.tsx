"use client";

import { useMemo, useState } from "react";
import { VerifikationerView } from "./verifikationer-view";
import type { VerificationView } from "@/lib/services/verification-correction";

export function AccountantVerifikationer({
  initial,
  allowCorrection,
}: {
  initial: VerificationView[];
  allowCorrection: boolean;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"datum" | "nr" | "belopp">("datum");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle
      ? initial.filter((v) => {
          const hay = `${v.label} ${v.date} ${v.description} ${v.sourceLabel} ${v.badge.text} ${v.total}`.toLowerCase();
          return hay.includes(needle);
        })
      : initial.slice();
    rows.sort((a, b) => {
      if (sort === "nr") return a.label.localeCompare(b.label, "sv");
      if (sort === "belopp") return b.total - a.total;
      return b.date.localeCompare(a.date) || a.label.localeCompare(b.label, "sv");
    });
    return rows;
  }, [initial, q, sort]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Sök nr, datum, beskrivning, belopp, källa…"
          className="min-w-[12rem] flex-1 rounded-lg border border-line px-3 py-1.5 text-[13px]"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px]"
        >
          <option value="datum">Datum</option>
          <option value="nr">Nr</option>
          <option value="belopp">Belopp</option>
        </select>
      </div>
      <VerifikationerView
        initial={filtered}
        page={1}
        totalPages={1}
        total={filtered.length}
        allowCorrection={allowCorrection}
      />
    </div>
  );
}
