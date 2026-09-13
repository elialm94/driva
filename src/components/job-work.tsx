"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { Badge, buttonClasses, cx, SectionTitle } from "./ui";
import { Modal } from "./modal";
import { DateField } from "./date-field";
import { AppLink } from "./app-link";
import { kr, datumKort } from "@/lib/format";
import { invoiceHref } from "@/lib/nav";
import {
  addJobMaterialAction,
  deleteJobWorkEntryAction,
  registerJobTimeAction,
  updateJobWorkEntryAction,
} from "@/app/actions";
import type { JobWorkEntry, VatRate } from "@/lib/types";
import type { JobWholesalerContext } from "@/lib/wholesalers/views";
import { LineDescriptionInput, LineDescriptionVocabProvider } from "./line-description-input";
import { WholesalerMaterialSheet } from "./wholesaler-material-sheet";
import { AddMaterialSheet, JobReceiptUpload } from "./add-material-sheet";
import { InvoiceReadinessBlock } from "./invoice-readiness";
import type { InvoiceReadiness } from "@/lib/services/invoice-readiness";

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
  /** Registrerad på en godkänd ändring: "Ändring 1" – faktureras via ändringen. */
  changeLabel?: string;
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
  if (entry.invoiceStatus === "draft") return <Badge tone="info">På fakturautkast</Badge>;
  return <Badge>Ej fakturerad</Badge>;
}

export function JobWorkSection({
  jobId,
  jobTitle,
  entries,
  laborPrefill,
  defaultHourlyRate,
  wholesalers,
  purchaseRef,
  inboxAddress,
  invoiceReadiness,
}: {
  jobId: string;
  jobTitle: string;
  /** Tid, material och övrigt i en enda lista - uppdraget är en logg, inte tre register. */
  entries: JobWorkViewEntry[];
  laborPrefill: JobWorkPrefill | null;
  defaultHourlyRate?: number;
  /**
   * Grossistbeställningar (valfri funktion). Saknas/avstängd eller utan
   * konfigurerad grossist → dagens manuella materialformulär, oförändrat.
   */
  wholesalers?: JobWholesalerContext;
  purchaseRef?: string;
  inboxAddress?: string;
  invoiceReadiness?: InvoiceReadiness;
}) {
  const [sheet, setSheet] = useState<"post" | "grossist" | "val" | "kvitto" | null>(null);
  const [kind, setKind] = useState<"tid" | "material">("tid");
  const wholesalerSearch = Boolean(wholesalers?.enabled && wholesalers.connections.length > 0);
  const [edit, setEdit] = useState<JobWorkViewEntry | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fromHere = { href: `/uppdrag/${jobId}`, label: jobTitle };

  function remove(id: string) {
    startTransition(async () => {
      await deleteJobWorkEntryAction(id);
      setConfirmId(null);
    });
  }

  /** Material-fliken öppnar väljaren: sök, fota kvitto eller skriv manuellt. */
  function chooseMaterial() {
    setSheet("val");
  }

  return (
    <LineDescriptionVocabProvider>
    <div className="mb-6 scroll-mt-4" id="arbete">
      <SectionTitle
        right={
          <button
            type="button"
            className={buttonClasses("secondary", "sm")}
            onClick={() => {
              setKind("tid");
              setSheet("post");
            }}
            data-job-add-entry
          >
            <Plus className="size-3.5" />
            Lägg till
          </button>
        }
      >
        Arbete och material
      </SectionTitle>

      <WorkList entries={entries} from={fromHere} onEdit={setEdit} onDelete={setConfirmId} />

      {purchaseRef ? (
        <PurchaseRefRow
          purchaseRef={purchaseRef}
          inboxAddress={inboxAddress}
          onPhoto={() => setSheet("kvitto")}
        />
      ) : null}
      {invoiceReadiness ? <InvoiceReadinessBlock readiness={invoiceReadiness} /> : null}

      <AddEntrySheet
        open={sheet === "post"}
        onClose={() => setSheet(null)}
        kind={kind}
        onKind={(next) => (next === "material" ? chooseMaterial() : setKind("tid"))}
        jobId={jobId}
        prefill={laborPrefill}
        defaultHourlyRate={defaultHourlyRate}
      />
      <AddMaterialSheet
        open={sheet === "val"}
        onClose={() => setSheet(null)}
        wholesalersEnabled={wholesalerSearch}
        onChoose={(choice) => {
          if (choice === "search") setSheet("grossist");
          else if (choice === "manual") {
            setKind("material");
            setSheet("post");
          } else setSheet("kvitto");
        }}
      />
      {wholesalerSearch && wholesalers ? (
        <WholesalerMaterialSheet
          open={sheet === "grossist"}
          onClose={() => setSheet(null)}
          jobId={jobId}
          context={wholesalers}
          onManual={() => {
            setKind("material");
            setSheet("post");
          }}
        />
      ) : null}
      <Modal open={sheet === "kvitto"} onClose={() => setSheet(null)} title="Fota kvitto" size="sm">
        <JobReceiptUpload
          jobId={jobId}
          onDone={(id) => {
            window.location.href = `/bokforing/underlag/${id}/kontrollera`;
          }}
        />
      </Modal>
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
    </LineDescriptionVocabProvider>
  );
}

function WorkList({
  entries,
  from,
  onEdit,
  onDelete,
}: {
  entries: JobWorkViewEntry[];
  from: { href: string; label: string };
  onEdit: (e: JobWorkViewEntry) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      {entries.length === 0 ? (
        <p className="text-[14px] text-muted">Inget registrerat än.</p>
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
                  {entry.changeLabel ? (
                    <span className="ml-2 text-[12px] font-medium text-info">{entry.changeLabel}</span>
                  ) : entry.isExtra ? (
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

function ratePrefill(prefill: JobWorkPrefill | null, defaultHourlyRate?: number): string {
  if (prefill) return String(prefill.unitPrice);
  if (defaultHourlyRate != null && defaultHourlyRate >= 1) return String(defaultHourlyRate);
  return "";
}

/**
 * En enda läggtill-yta för uppdraget: tid och material i samma ark, valet
 * ligger överst. Två knappar i rubriken blev en.
 */
function AddEntrySheet({
  open,
  onClose,
  kind,
  onKind,
  jobId,
  prefill,
  defaultHourlyRate,
}: {
  open: boolean;
  onClose: () => void;
  kind: "tid" | "material";
  onKind: (kind: "tid" | "material") => void;
  jobId: string;
  prefill: JobWorkPrefill | null;
  defaultHourlyRate?: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(todayISO);
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [hours, setHours] = useState("");
  const [rate, setRate] = useState(ratePrefill(prefill, defaultHourlyRate));
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("st");
  const [price, setPrice] = useState("");
  const hoursRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDate(todayISO());
    setDescription(kind === "tid" ? (prefill?.description ?? "") : "");
    setHours("");
    setRate(ratePrefill(prefill, defaultHourlyRate));
    setQty("1");
    setUnit("st");
    setPrice("");
    if (kind !== "tid") return;
    const t = window.setTimeout(() => hoursRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, kind, prefill, defaultHourlyRate]);

  function submitTime() {
    const amount = Number(hours.replace(",", "."));
    const unitPrice = Math.round(Number(rate.replace(",", ".")));
    if (!(amount > 0)) return;
    startTransition(async () => {
      await registerJobTimeAction(jobId, {
        date,
        description: description.trim() || undefined,
        hours: amount,
        unitPrice: rate.trim() === "" || !Number.isFinite(unitPrice) ? undefined : unitPrice,
        quotedLineItemId: prefill?.quotedLineItemId,
      });
      onClose();
    });
  }

  function submitMaterial() {
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

  const time = kind === "tid";
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Lägg till på uppdraget"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClasses("ghost")} onClick={onClose}>
            Avbryt
          </button>
          <button
            type="button"
            className={buttonClasses("primary")}
            disabled={isPending || (time ? !hours : !description.trim())}
            onClick={time ? submitTime : submitMaterial}
          >
            {isPending ? "Sparar …" : "Lägg till"}
          </button>
        </div>
      }
    >
      <div className="space-y-3 px-6 py-5">
        <div className="flex gap-1 rounded-xl bg-canvas p-1" role="group" aria-label="Typ av post">
          <KindTab active={time} onClick={() => onKind("tid")}>
            Tid
          </KindTab>
          <KindTab active={!time} onClick={() => onKind("material")} data-job-add-material>
            Material
          </KindTab>
        </div>

        {time ? (
          <>
            <label className="block">
              <span className="mb-1 block text-[13px] text-muted">Vad gjorde du?</span>
              <LineDescriptionInput
                className={inputCls}
                value={description}
                onChange={setDescription}
                kind="arbete"
                aria-label="Vad gjorde du?"
              />
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
          </>
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-[13px] text-muted">Beskrivning</span>
              <LineDescriptionInput
                className={inputCls}
                value={description}
                onChange={setDescription}
                kind="material"
                aria-label="Beskrivning"
                autoFocus
              />
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
          </>
        )}

        <label className="block">
          <span className="mb-1 block text-[13px] text-muted">Datum</span>
          <DateField value={date} onChange={setDate} />
        </label>
      </div>
    </Modal>
  );
}

function KindTab({
  active,
  onClick,
  children,
  ...rest
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "min-h-11 flex-1 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors",
        active ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink",
      )}
      {...rest}
    >
      {children}
    </button>
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
          <LineDescriptionInput
            className={inputCls}
            value={description}
            onChange={setDescription}
            kind={entry.type === "labor" ? "arbete" : entry.type === "travel" ? "resor" : entry.type === "material" ? "material" : "ovrigt"}
            aria-label="Beskrivning"
          />
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

function PurchaseRefRow({
  purchaseRef,
  inboxAddress,
  onPhoto,
}: {
  purchaseRef: string;
  inboxAddress?: string;
  onPhoto: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 rounded-2xl border border-line/80 px-4 py-3" data-job-purchase-ref="">
      <p className="text-[13px] text-muted">Inköpsreferens</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{purchaseRef}</span>
        <button
          type="button"
          className={buttonClasses("ghost", "sm")}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(purchaseRef);
            } catch {
              window.prompt("Kopiera referensen:", purchaseRef);
            }
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Kopierad" : "Kopiera referens"}
        </button>
        <button type="button" className={buttonClasses("ghost", "sm")} onClick={onPhoto}>
          Fota materialköp
        </button>
      </div>
      {inboxAddress ? (
        <p className="mt-2 text-[13px] text-soft">
          Vidarebefordra underlag till {inboxAddress}. Ange referensen i ämnesraden, till exempel {purchaseRef}.
        </p>
      ) : null}
    </div>
  );
}
