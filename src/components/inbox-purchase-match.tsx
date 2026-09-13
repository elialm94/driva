"use client";

import { useState, useTransition } from "react";
import { buttonClasses } from "./ui";
import {
  dismissInboxPurchaseMatchAction,
  linkInboxDocumentToPurchaseOrderAction,
} from "@/app/actions";

export function InboxPurchaseMatchCard({
  itemId,
  question,
  candidates,
  canWrite,
}: {
  itemId: string;
  question: string;
  candidates: Array<{ id: string; reference: string; label: string }>;
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const [chosen, setChosen] = useState(candidates[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  if (candidates.length === 0) return null;

  return (
    <section className="rounded-2xl border border-warn/40 bg-warn-soft/20 p-4" data-inbox-purchase-match="">
      <p className="text-[15px] font-medium text-ink">{question}</p>
      {candidates.length > 1 ? (
        <label className="mt-3 block text-[13px]">
          <span className="mb-1 block text-muted">Välj annan beställning</span>
          <select
            className="min-h-11 w-full rounded-xl border border-line-strong bg-card px-3"
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.reference} · {c.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="mt-1 text-[13px] text-soft">{candidates[0].reference}</p>
      )}
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
      {canWrite ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={`${buttonClasses("primary", "sm")} min-h-11`}
            disabled={pending || !chosen}
            onClick={() =>
              start(async () => {
                const r = await linkInboxDocumentToPurchaseOrderAction(itemId, chosen);
                if (!r.ok) setError(r.error);
              })
            }
          >
            Ja, koppla ihop
          </button>
          <button
            type="button"
            className={`${buttonClasses("ghost", "sm")} min-h-11`}
            disabled={pending}
            onClick={() => start(async () => dismissInboxPurchaseMatchAction(itemId))}
          >
            Nej
          </button>
        </div>
      ) : null}
    </section>
  );
}
