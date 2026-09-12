"use client";

import { useState, useTransition } from "react";
import { closeAllReadyMonthsAction } from "@/app/periodstangning-actions";
import { datumLang } from "@/lib/format";
import { buttonClasses } from "./ui";
import type { Period } from "@/lib/accounting/dates";

export function CloseAllReadyMonthsButton({
  months,
  businessId,
}: {
  months: Period[];
  businessId?: string;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (months.length === 0) return null;

  function confirmAndClose() {
    const list = months.map((m) => m.label).join("\n");
    if (!window.confirm(`Stäng ${months.length} månader?\n\n${list}`)) return;
    setErr(null);
    start(async () => {
      const res = await closeAllReadyMonthsAction(businessId);
      if (!res.ok) setErr(res.error);
    });
  }

  return (
    <div className="space-y-1">
      <button type="button" className={buttonClasses("primary")} onClick={confirmAndClose} disabled={pending}>
        {pending ? "Stänger …" : `Stäng ${months.length} månader`}
      </button>
      <p className="text-[12px] text-muted">
        {months.map((m) => datumLang(m.start)).join(", ")}. Stängs i tur och ordning.
      </p>
      {err && <p className="text-xs text-red-700">{err}</p>}
    </div>
  );
}
