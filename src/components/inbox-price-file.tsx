"use client";

import { useState, useTransition } from "react";
import { buttonClasses } from "./ui";
import { activateInboxPriceFileAction } from "@/app/wholesaler-actions";
import type { WholesalerConnection } from "@/lib/types";

export function InboxPriceFileCard({
  itemId,
  filename,
  identified,
  preview,
  previewError,
  connections,
  canWrite,
}: {
  itemId: string;
  filename: string;
  identified: { connectionId?: string; uncertain: boolean; reason: string };
  preview?: {
    rowCount?: number;
    priceDate?: string;
    detected?: { kind?: string };
  };
  previewError?: string;
  connections: Array<Pick<WholesalerConnection, "id" | "displayName" | "wholesaler" | "customerNumber">>;
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const [connectionId, setConnectionId] = useState(identified.connectionId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <section className="rounded-2xl border border-line bg-card p-4" data-inbox-price-file="">
      <p className="text-[15px] font-medium text-ink">Prisfil i underlaget</p>
      <p className="mt-1 text-[13px] text-soft">{filename}</p>
      <p className="mt-1 text-[13px] text-muted">{identified.reason}</p>
      {previewError ? <p className="mt-2 text-[13px] text-warn">{previewError}</p> : null}
      {preview ? (
        <p className="mt-2 text-[13px] text-soft">
          {preview.rowCount != null ? `${preview.rowCount.toLocaleString("sv-SE")} rader` : "Filen gick att läsa"}
          {preview.priceDate ? ` · prisdatum ${preview.priceDate}` : ""}
          {preview.detected?.kind ? ` · ${preview.detected.kind}` : ""}
        </p>
      ) : null}
      {identified.uncertain ? (
        <label className="mt-3 block text-[13px]">
          <span className="mb-1 block text-muted">Grossist</span>
          <select
            className="min-h-11 w-full rounded-xl border border-line-strong bg-card px-3"
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
          >
            <option value="">Välj grossist själv</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName || c.wholesaler} · {c.customerNumber}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
      {done ? <p className="mt-2 text-[13px] text-ok">Nya priser är aktiva.</p> : null}
      {canWrite ? (
        <button
          type="button"
          className={`${buttonClasses("primary")} mt-3 min-h-11`}
          disabled={pending || done || !connectionId}
          onClick={() =>
            start(async () => {
              const r = await activateInboxPriceFileAction(itemId, connectionId);
              if (!r.ok) setError(r.error);
              else setDone(true);
            })
          }
        >
          Använd nya priser
        </button>
      ) : null}
      <p className="mt-2 text-[12px] text-muted">
        Föregående prislista ligger kvar tills du godkänner. Ett skickat mejl markerar inte listan som uppdaterad.
      </p>
    </section>
  );
}
