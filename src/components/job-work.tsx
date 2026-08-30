"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge, buttonClasses, SectionTitle } from "./ui";
import { Modal } from "./modal";
import { DateField } from "./date-field";
import { AppLink } from "./app-link";
import { JobInvoiceTrigger } from "./job-controls";
import { kr, datumKort } from "@/lib/format";
import { invoiceHref } from "@/lib/nav";
import {
  addJobMaterialAction,
  deleteJobWorkEntryAction,
  registerJobTimeAction,
  updateJobWorkEntryAction,
} from "@/app/actions";
import type { JobInvoiceChoice, JobWorkComparison } from "@/lib/job-ui-types";
import type { JobWorkEntry, VatRate } from "@/lib/types";

function hoursLabel(n: number): string {
  return `${Number(n.toFixed(2)).toLocaleString("sv-SE")} tim`;
}

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";

export type JobWorkPrefill = {
  description: string;
  unitPrice: number;
  vatRate: VatRate;
  quotedLineItemId?: string;
  unit: string;
};

export type JobWorkViewEntry = Pick<
  JobWorkEntry,
  "id" | "type" | "description" | "date" | "qty" | "unit" | "unitPrice" | "vatRate" | "isExtra"
> & {
  invoiceStatus: "uninvoiced" | "draft" | "invoiced";
  locked: boolean;
  invoiceId?: string;
  invoiceNumber?: number | null;
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function invoiceBadge(entry: JobWorkViewEntry, from: { href: string; label: string }) {
  if (entry.invoiceStatus === "invoiced" && entry.invoiceId) {
    const label = entry.invoiceNumber != null ? `Fakturerad · #${entry.invoiceNumber}` : "Fakturerad";
    return (
      <AppLink href={invoiceHref(entry.invoiceId, from)} className="inline-flex">
        <Badge tone="ok">{label}</Badge>
      </AppLink>
    );
  }
  if (entry.invoiceStatus === "invoiced") return <Badge tone="ok">Fakturerad</Badge>;
  if (entry.invoiceStatus === "draft") return <Badge tone="info">På utkast</Badge>;
  return <Badge>Ej fakturerad</Badge>;
}

export function JobWorkSection({
  jobId,
  jobTitle,
  comparison,
  labor,
  material,
  other,
  laborPrefill,
  invoiceChoice,
}: {
  jobId: string;
  jobTitle: string;
  comparison: JobWorkComparison;
  labor: JobWorkViewEntry[];
  material: JobWorkViewEntry[];
  other: JobWorkViewEntry[];
  laborPrefill: JobWorkPrefill | null;
  invoiceChoice: JobInvoiceChoice;
}) {
  const [sheet, setSheet] = useState<"tid" | "material" | null>(null);
  const [edit, setEdit] = useState<JobWorkViewEntry | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fromHere = { href: `/uppdrag/${jobId}`, label: jobTitle };
  const uninvoiced = [...labor, ...material, ...other].filter((e) => e.invoiceStatus === "uninvoiced");

  function remove(id: string) {
    startTransition(async () => {
      await deleteJobWorkEntryAction(id);
      setConfirmId(null);
    });
  }

  return (
    <div className="mb-8">
      <SectionTitle
        right={
          <div className="flex gap-2">
            <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => setSheet("tid")}>
              <Plus className="size-3.5" />
              <span className="sm:hidden">Tid</span>
              <span className="hidden sm:inline">Registrera tid</span>
            </button>
            <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => setSheet("material")}>
              <Plus className="size-3.5" />
              <span className="sm:hidden">Material</span>
              <span className="hidden sm:inline">Lägg till material</span>
            </button>
          </div>
        }
      >
        Arbete & material
      </SectionTitle>

      {comparison.hasQuote ? <ComparisonBlock comparison={comparison} /> : null}

      <WorkList
        title="Arbete"
        empty="Ingen tid registrerad än."
        entries={labor}
        from={fromHere}
        onEdit={setEdit}
        onDelete={setConfirmId}
      />
      <WorkList
        title="Material"
        empty="Inget material registrerat än."
        entries={material}
        from={fromHere}
        onEdit={setEdit}
        onDelete={setConfirmId}
        className="mt-5"
      />
      {other.length > 0 ? (
        <WorkList
          title="Övrigt"
          empty=""
          entries={other}
          from={fromHere}
          onEdit={setEdit}
          onDelete={setConfirmId}
          className="mt-5"
        />
      ) : null}

      {uninvoiced.length > 0 ? (
        <div className="mt-4">
          <JobInvoiceTrigger
            jobId={jobId}
            jobTitle={jobTitle}
            invoiceChoice={invoiceChoice}
            preselect="actuals"
            label="Skapa faktura"
            variant="secondary"
            size="sm"
          />
        </div>
      ) : null}

      <TimeSheet
        open={sheet === "tid"}
        onClose={() => setSheet(null)}
        jobId={jobId}
        prefill={laborPrefill}
      />
      <MaterialSheet open={sheet === "material"} onClose={() => setSheet(null)} jobId={jobId} />
      {edit ? (
        <EditSheet
          entry={edit}
          onClose={() => setEdit(null)}
        />
      ) : null}

      <Modal
        open={Boolean(confirmId)}
        onClose={() => setConfirmId(null)}
        title="Ta bort posten?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setConfirmId(null)}>
              Avbryt
            </button>
            <button
              type="button"
              className={buttonClasses("danger")}
              disabled={isPending}
              onClick={() => confirmId && remove(confirmId)}
            >
              {isPending ? "Tar bort …" : "Ta bort"}
            </button>
          </div>
        }
      >
        <p className="px-6 py-5 text-[15px] leading-relaxed text-soft">
          Posten försvinner från uppdraget. Det som redan fakturerats ändras inte.
        </p>
      </Modal>
    </div>
  );
}

function ComparisonBlock({ comparison }: { comparison: JobWorkComparison }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 rounded-2xl border border-line/80 px-4 py-3">
      <button type="button" className="flex w-full items-baseline justify-between gap-3 text-left" onClick={() => setOpen((v) => !v)}>
        <p className="text-[14px] tabular text-ink">
          <span className="text-muted">Avtalat</span> {kr(comparison.quotedExcl)}
          {comparison.quoteNumber ? (
            <span className="text-muted"> (från offert #{comparison.quoteNumber})</span>
          ) : null}{" "}
          <span className="text-muted">· Registrerat</span> {kr(comparison.registeredExcl)}{" "}
          <span className="text-muted">· Skillnad</span>{" "}
          {comparison.deltaExcl === 0
            ? "0 kr"
            : `${comparison.deltaExcl > 0 ? "+" : ""}${kr(comparison.deltaExcl)}`}
        </p>
        <span className="text-[13px] text-muted">{open ? "Dölj" : "Visa"}</span>
      </button>
      {comparison.overageLabel ? (
        <p className="mt-1 text-[13px] font-medium text-warn">{comparison.overageLabel}</p>
      ) : null}
      {open ? (
        <div className="mt-3 space-y-1 border-t border-line/70 pt-3 text-[13px] tabular text-soft">
          <p>
            Tid: {hoursLabel(comparison.laborHoursQuoted)} avtalat · {hoursLabel(comparison.laborHoursRegistered)}{" "}
            registrerat
          </p>
          <p>
            Material: {kr(comparison.materialQuotedExcl)} avtalat · {kr(comparison.materialRegisteredExcl)} registrerat
          </p>
          {comparison.extrasCount > 0 ? (
            <p>
              {comparison.extrasCount} tillägg (ej i ursprunglig offert)
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WorkList({
  title,
  empty,
  entries,
  from,
  onEdit,
  onDelete,
  className,
}: {
  title: string;
  empty: string;
  entries: JobWorkViewEntry[];
  from: { href: string; label: string };
  onEdit: (e: JobWorkViewEntry) => void;
  onDelete: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <h3 className="mb-2 text-[13px] font-medium text-muted">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-[14px] text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line/70 rounded-2xl border border-line/80">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 px-4 py-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => !entry.locked && onEdit(entry)}
                disabled={entry.locked}
              >
                <p className="text-[14px] font-medium">
                  {entry.description}
                  {entry.isExtra ? (
                    <span className="ml-2 text-[12px] font-medium text-warn">Tillägg</span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[13px] tabular text-muted">
                  {datumKort(entry.date)} · {entry.qty.toLocaleString("sv-SE")} {entry.unit} · {kr(entry.unitPrice)}
                  {entry.type === "labor" ? "/tim" : ""}
                </p>
              </button>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {invoiceBadge(entry, from)}
                {!entry.locked ? (
                  <button
                    type="button"
                    className="text-muted hover:text-danger"
                    aria-label="Ta bort"
                    onClick={() => onDelete(entry.id)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TimeSheet({
  open,
  onClose,
  jobId,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  jobId: string;
  prefill: JobWorkPrefill | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(todayISO);
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [hours, setHours] = useState("");
  const [rate, setRate] = useState(prefill ? String(prefill.unitPrice) : "");
  const hoursRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDate(todayISO());
    setDescription(prefill?.description ?? "");
    setHours("");
    setRate(prefill ? String(prefill.unitPrice) : "");
    const t = window.setTimeout(() => hoursRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, prefill]);

  function submit() {
    const qty = Number(hours.replace(",", "."));
    const unitPrice = Math.round(Number(rate.replace(",", ".")));
    if (!(qty > 0)) return;
    startTransition(async () => {
      await registerJobTimeAction(jobId, {
        date,
        description: description.trim() || undefined,
        hours: qty,
        unitPrice: Number.isFinite(unitPrice) ? unitPrice : undefined,
        quotedLineItemId: prefill?.quotedLineItemId,
      });
      onClose();
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrera tid"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClasses("ghost")} onClick={onClose}>
            Avbryt
          </button>
          <button type="button" className={buttonClasses("primary")} disabled={isPending || !hours} onClick={submit}>
            {isPending ? "Sparar …" : "Registrera"}
          </button>
        </div>
      }
    >
      <div className="space-y-3 px-6 py-5">
        <label className="block">
          <span className="mb-1 block text-[13px] text-muted">Datum</span>
          <DateField value={date} onChange={setDate} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] text-muted">Vad gjorde du?</span>
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] text-muted">Tid (timmar)</span>
          <input
            ref={hoursRef}
            className={inputCls}
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="t.ex. 3"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] text-muted">Timpris (exkl. moms)</span>
          <input className={inputCls} inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

function MaterialSheet({ open, onClose, jobId }: { open: boolean; onClose: () => void; jobId: string }) {
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(todayISO);
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("st");
  const [price, setPrice] = useState("");

  useEffect(() => {
    if (!open) return;
    setDate(todayISO());
    setDescription("");
    setQty("1");
    setUnit("st");
    setPrice("");
  }, [open]);

  function submit() {
    const amount = Number(qty.replace(",", "."));
    const unitPrice = Math.round(Number(price.replace(",", ".")));
    if (!(amount > 0) || !description.trim() || !Number.isFinite(unitPrice)) return;
    startTransition(async () => {
      await addJobMaterialAction(jobId, {
        date,
        description: description.trim(),
        qty: amount,
        unit,
        unitPrice,
      });
      onClose();
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Lägg till material"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClasses("ghost")} onClick={onClose}>
            Avbryt
          </button>
          <button
            type="button"
            className={buttonClasses("primary")}
            disabled={isPending || !description.trim() || !price}
            onClick={submit}
          >
            {isPending ? "Sparar …" : "Lägg till"}
          </button>
        </div>
      }
    >
      <div className="space-y-3 px-6 py-5">
        <label className="block">
          <span className="mb-1 block text-[13px] text-muted">Beskrivning</span>
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[13px] text-muted">Antal</span>
            <input className={inputCls} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] text-muted">Enhet</span>
            <input className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-[13px] text-muted">Pris (exkl. moms)</span>
          <input className={inputCls} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] text-muted">Datum</span>
          <DateField value={date} onChange={setDate} />
        </label>
      </div>
    </Modal>
  );
}

function EditSheet({ entry, onClose }: { entry: JobWorkViewEntry; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [description, setDescription] = useState(entry.description);
  const [date, setDate] = useState(entry.date);
  const [qty, setQty] = useState(String(entry.qty));
  const [unit, setUnit] = useState(entry.unit);
  const [price, setPrice] = useState(String(entry.unitPrice));
  const saved = useRef(false);

  function persist() {
    if (entry.locked || saved.current) return;
    const amount = Number(qty.replace(",", "."));
    const unitPrice = Math.round(Number(price.replace(",", ".")));
    if (!(amount > 0) || !description.trim() || !Number.isFinite(unitPrice)) return;
    saved.current = true;
    startTransition(async () => {
      await updateJobWorkEntryAction(entry.id, {
        description: description.trim(),
        date,
        qty: amount,
        unit,
        unitPrice,
      });
      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={() => {
        persist();
      }}
      title={entry.type === "labor" ? "Ändra tid" : "Ändra material"}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClasses("primary")} disabled={isPending} onClick={persist}>
            {isPending ? "Sparar …" : "Klar"}
          </button>
        </div>
      }
    >
      <div className="space-y-3 px-6 py-5">
        <label className="block">
          <span className="mb-1 block text-[13px] text-muted">Beskrivning</span>
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] text-muted">Datum</span>
          <DateField value={date} onChange={setDate} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[13px] text-muted">{entry.type === "labor" ? "Tid" : "Antal"}</span>
            <input className={inputCls} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] text-muted">{entry.type === "labor" ? "Timpris" : "Pris"}</span>
            <input className={inputCls} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
        </div>
        {entry.type !== "labor" ? (
          <label className="block">
            <span className="mb-1 block text-[13px] text-muted">Enhet</span>
            <input className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)} />
          </label>
        ) : null}
      </div>
    </Modal>
  );
}
