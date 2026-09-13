"use client";

import { useState, useTransition } from "react";
import { buttonClasses } from "./ui";
import type { DocumentLine, DocumentLineDisposition, Job } from "@/lib/types";
import {
  applyAllDocumentLinesToJobAction,
  confirmDocumentLinesAction,
  markDocumentAsCompanyCostAction,
  markDocumentAsPrivateAction,
  setDocumentLineAllocationsAction,
  setDocumentLineCustomerPriceAction,
  setDocumentLineDispositionAction,
} from "@/app/actions";

export function DocumentLineReview({
  source,
  sourceDocumentId,
  lines,
  headline,
  question,
  mathMessage,
  mathOk,
  jobs,
  startedJobId,
}: {
  source: "receipt" | "supplier_invoice" | "order_confirmation" | "manual";
  sourceDocumentId: string;
  lines: DocumentLine[];
  headline: string;
  question?: string;
  mathMessage: string;
  mathOk: boolean;
  jobs: Array<Pick<Job, "id" | "title">>;
  startedJobId?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (lines.length === 0) return null;

  return (
    <section className="mt-6 rounded-2xl border border-line bg-card p-4" data-document-line-review="">
      <p className="text-[15px] font-medium text-ink">{headline}</p>
      {question ? <p className="mt-1 text-[14px] text-soft">{question}</p> : null}
      {!mathOk ? (
        <p className="mt-2 text-[13px] font-medium text-warn" role="status">
          {mathMessage} Hela kvittot kan ändå bokföras.
        </p>
      ) : (
        <p className="mt-2 text-[13px] text-muted">{mathMessage}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {startedJobId ? (
          <button
            type="button"
            className={buttonClasses("secondary", "sm")}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await applyAllDocumentLinesToJobAction(source, sourceDocumentId, startedJobId);
                if (!r.ok) setError(r.error);
              })
            }
          >
            Lägg allt på uppdraget
          </button>
        ) : null}
        <button
          type="button"
          className={buttonClasses("ghost", "sm")}
          disabled={pending}
          onClick={() =>
            start(async () => {
              await markDocumentAsCompanyCostAction(source, sourceDocumentId);
            })
          }
        >
          Hela kvittot är företagskostnad
        </button>
        <button
          type="button"
          className={buttonClasses("ghost", "sm")}
          disabled={pending}
          onClick={() =>
            start(async () => {
              await markDocumentAsPrivateAction(source, sourceDocumentId);
            })
          }
        >
          Hela kvittot är privat
        </button>
      </div>

      <ul className="mt-4 space-y-3">
        {lines.map((line) => (
          <LineRow key={line.id} line={line} jobs={jobs} startedJobId={startedJobId} onError={setError} />
        ))}
      </ul>

      {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}

      <button
        type="button"
        className={`${buttonClasses("primary")} mt-4 min-h-11`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await confirmDocumentLinesAction(lines.map((l) => l.id));
            if (!r.ok) setError(r.error);
          })
        }
      >
        Bekräfta rader
      </button>
    </section>
  );
}

function LineRow({
  line,
  jobs,
  startedJobId,
  onError,
}: {
  line: DocumentLine;
  jobs: Array<Pick<Job, "id" | "title">>;
  startedJobId?: string;
  onError: (s: string | null) => void;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const name = line.confirmed?.name ?? line.raw.name ?? "Rad";
  const qty = line.confirmed?.qty ?? line.qty ?? line.raw.qty ?? 1;
  const toCustomer = line.disposition === "customer";
  const jobId = line.allocations[0]?.jobId ?? startedJobId ?? "";

  return (
    <li className="rounded-xl border border-line/80 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-ink">
            {name}
            {line.raw.unreadable ? <span className="ml-2 text-warn">Kontrollera raden</span> : null}
          </p>
          <p className="text-[13px] text-muted">
            {qty} {line.unit ?? "st"}
            {line.raw.lineAmount != null ? ` · ${line.raw.lineAmount.toLocaleString("sv-SE")} kr` : ""}
          </p>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-[14px]">
          <input
            type="checkbox"
            checked={toCustomer}
            disabled={pending || line.status === "confirmed"}
            onChange={(e) =>
              start(async () => {
                const next: DocumentLineDisposition = e.target.checked ? "customer" : "company";
                const r = await setDocumentLineDispositionAction(line.id, next);
                if (!r.ok) onError(r.error);
                if (e.target.checked && jobId) {
                  const a = await setDocumentLineAllocationsAction(line.id, [{ jobId, qty }]);
                  if (!a.ok) onError(a.error);
                }
              })
            }
          />
          Till kunden
        </label>
      </div>

      {toCustomer ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="block text-[13px]">
            <span className="mb-1 block text-muted">Uppdrag</span>
            <select
              className="min-h-11 w-full rounded-xl border border-line-strong bg-card px-3"
              value={jobId}
              disabled={pending}
              onChange={(e) =>
                start(async () => {
                  const r = await setDocumentLineAllocationsAction(line.id, [{ jobId: e.target.value, qty }]);
                  if (!r.ok) onError(r.error);
                })
              }
            >
              <option value="">Välj uppdrag</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[13px]">
            <span className="mb-1 block text-muted">Kundpris</span>
            <input
              className="min-h-11 w-full rounded-xl border border-line-strong bg-card px-3"
              inputMode="numeric"
              defaultValue={line.customerPrice ?? ""}
              placeholder="Saknas"
              onBlur={(e) => {
                const raw = e.target.value.trim();
                start(async () => {
                  const r = await setDocumentLineCustomerPriceAction(line.id, raw === "" ? null : Number(raw.replace(",", ".")));
                  if (!r.ok) onError(r.error);
                });
              }}
            />
          </label>
        </div>
      ) : null}

      <button type="button" className="mt-2 text-[13px] text-accent" onClick={() => setOpen(!open)}>
        {open ? "Färre val" : "Fler val"}
      </button>
      {open ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {(["company", "private", "ignored"] as const).map((d) => (
            <button
              key={d}
              type="button"
              className={buttonClasses("ghost", "sm")}
              onClick={() =>
                start(async () => {
                  await setDocumentLineDispositionAction(line.id, d);
                })
              }
            >
              {d === "company" ? "Företagskostnad - inte till kund" : d === "private" ? "Privat" : "Ignorera"}
            </button>
          ))}
          <SplitJobs line={line} jobs={jobs} qty={qty} onError={onError} />
        </div>
      ) : null}
      {line.customerPriceExplanation ? (
        <p className="mt-2 text-[12px] text-muted">{line.customerPriceExplanation}</p>
      ) : null}
    </li>
  );
}

function SplitJobs({
  line,
  jobs,
  qty,
  onError,
}: {
  line: DocumentLine;
  jobs: Array<Pick<Job, "id" | "title">>;
  qty: number;
  onError: (s: string | null) => void;
}) {
  const [pending, start] = useTransition();
  const [jobA, setJobA] = useState(line.allocations[0]?.jobId ?? "");
  const [jobB, setJobB] = useState(line.allocations[1]?.jobId ?? "");
  const [qtyA, setQtyA] = useState(String(line.allocations[0]?.qty ?? Math.ceil(qty / 2)));
  return (
    <div className="w-full rounded-xl bg-canvas px-3 py-2" data-split-jobs="">
      <p className="text-[13px] text-muted">Dela mellan uppdrag</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <select className="min-h-11 rounded-xl border border-line-strong bg-card px-3" value={jobA} onChange={(e) => setJobA(e.target.value)}>
          <option value="">Uppdrag 1</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>{j.title}</option>
          ))}
        </select>
        <select className="min-h-11 rounded-xl border border-line-strong bg-card px-3" value={jobB} onChange={(e) => setJobB(e.target.value)}>
          <option value="">Uppdrag 2</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>{j.title}</option>
          ))}
        </select>
      </div>
      <label className="mt-2 block text-[13px]">
        <span className="mb-1 block text-muted">Antal på uppdrag 1</span>
        <input
          className="min-h-11 w-full rounded-xl border border-line-strong bg-card px-3"
          inputMode="decimal"
          value={qtyA}
          onChange={(e) => setQtyA(e.target.value)}
        />
      </label>
      <button
        type="button"
        className={`${buttonClasses("secondary", "sm")} mt-2 min-h-11`}
        disabled={pending || !jobA || !jobB}
        onClick={() =>
          start(async () => {
            const a = Number(qtyA.replace(",", "."));
            const b = qty - a;
            const r = await setDocumentLineAllocationsAction(line.id, [
              { jobId: jobA, qty: a },
              { jobId: jobB, qty: b },
            ]);
            if (!r.ok) onError(r.error);
          })
        }
      >
        Dela raden
      </button>
    </div>
  );
}
