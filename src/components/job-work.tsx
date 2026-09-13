"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { Badge, buttonClasses, cx, SectionTitle } from "./ui";
import { Modal } from "./modal";
import { DateField } from "./date-field";
import { AppLink } from "./app-link";
import { kr, datumKort } from "@/lib/format";
import { jobWorkInputFromDocLine, jobWorkInvoiceChipLabel } from "@/lib/job-ui-types";
import { invoiceHref } from "@/lib/nav";
import { lineFieldId } from "@/lib/form-requirements";
import { syncDocLineClassification } from "@/lib/economic-line-type";
import {
  addJobWorkEntryAction,
  deleteJobWorkEntryAction,
  ensureJobPurchaseRefAction,
  updateJobWorkEntryAction,
} from "@/app/actions";
import type { DocLine, JobWorkEntry, VatRate } from "@/lib/types";
import type { JobWholesalerContext } from "@/lib/wholesalers/views";
import { LineDescriptionVocabProvider } from "./line-description-input";
import { LinesEditor, newLine } from "./lines-editor";
import { WholesalerMaterialSheet } from "./wholesaler-material-sheet";
import { AddMaterialSheet, JobReceiptUpload } from "./add-material-sheet";
import { InvoiceReadinessBlock } from "./invoice-readiness";
import type { InvoiceReadiness } from "@/lib/services/invoice-readiness";

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
  invoiceAmount?: number;
  invoiceTitle?: string;
  /** Registrerad på en godkänd ändring: "Ändring 1" – faktureras via ändringen. */
  changeLabel?: string;
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function invoiceBadge(entry: JobWorkViewEntry, from: { href: string; label: string }) {
  const label = jobWorkInvoiceChipLabel({
    status: entry.invoiceStatus,
    invoiceNumber: entry.invoiceNumber,
    invoiceAmount: entry.invoiceAmount,
    invoiceTitle: entry.invoiceTitle,
  });
  if (entry.invoiceStatus === "uninvoiced" || !entry.invoiceId) {
    return <Badge>{label}</Badge>;
  }
  return (
    <AppLink href={invoiceHref(entry.invoiceId, from)} className="inline-flex">
      <Badge tone={entry.invoiceStatus === "invoiced" ? "ok" : "info"}>{label}</Badge>
    </AppLink>
  );
}

export function JobWorkSection({
  jobId,
  jobTitle,
  entries,
  laborPrefill,
  defaultHourlyRate,
  defaultVatRate = 25,
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
  defaultVatRate?: VatRate;
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
  const [resolvedRef, setResolvedRef] = useState(purchaseRef);
  const fromHere = { href: `/uppdrag/${jobId}`, label: jobTitle };

  useEffect(() => {
    setResolvedRef(purchaseRef);
  }, [purchaseRef]);

  useEffect(() => {
    if (resolvedRef) return;
    let cancelled = false;
    void ensureJobPurchaseRefAction(jobId)
      .then((next) => {
        if (!cancelled && next) setResolvedRef(next);
      })
      .catch(() => {
        /* Referensen är extra – uppdragssidan ska gå att använda utan den. */
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, resolvedRef]);

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

      {resolvedRef ? (
        <PurchaseRefRow
          purchaseRef={resolvedRef}
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
        defaultVatRate={defaultVatRate}
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
          defaultHourlyRate={defaultHourlyRate}
          defaultVatRate={defaultVatRate}
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

function jobAddLine(kind: "tid" | "material", vat: VatRate, hourly?: number, prefill?: JobWorkPrefill | null): DocLine {
  if (kind === "tid") {
    const next = newLine("arbete", vat, "job-add-line", hourly);
    next.qty = 0;
    if (prefill) {
      next.description = prefill.description;
      next.unitPrice = prefill.unitPrice;
      next.vatRate = prefill.vatRate;
      next.unit = prefill.unit || "tim";
    }
    return next;
  }
  return newLine("material", vat, "job-add-line");
}

function viewEntryToDocLine(entry: JobWorkViewEntry): DocLine {
  return syncDocLineClassification({
    id: entry.id,
    kind:
      entry.type === "labor"
        ? "arbete"
        : entry.type === "material"
          ? "material"
          : entry.type === "travel"
            ? "resor"
            : "ovrigt",
    description: entry.description,
    qty: entry.qty,
    unit: entry.unit,
    unitPrice: entry.unitPrice,
    vatRate: entry.vatRate,
  });
}

/**
 * En enda läggtill-yta för uppdraget: tid och material i samma ark, valet
 * ligger överst. Tid och material-manuellt använder samma Prisrader-fält
 * som offert och faktura.
 */
function AddEntrySheet({
  open,
  onClose,
  kind,
  onKind,
  jobId,
  prefill,
  defaultHourlyRate,
  defaultVatRate = 25,
}: {
  open: boolean;
  onClose: () => void;
  kind: "tid" | "material";
  onKind: (kind: "tid" | "material") => void;
  jobId: string;
  prefill: JobWorkPrefill | null;
  defaultHourlyRate?: number;
  defaultVatRate?: VatRate;
}) {
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(todayISO);
  const [line, setLine] = useState<DocLine>(() => jobAddLine(kind, defaultVatRate, defaultHourlyRate, prefill));

  useEffect(() => {
    if (!open) return;
    setDate(todayISO());
    setLine(jobAddLine(kind, defaultVatRate, defaultHourlyRate, prefill));
    if (kind !== "tid") return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(lineFieldId("job-add-line", "antal"));
      if (el instanceof HTMLInputElement) el.focus();
    }, 50);
    return () => window.clearTimeout(t);
  }, [open, kind, prefill, defaultHourlyRate, defaultVatRate]);

  const draft = jobWorkInputFromDocLine(line);
  const canSubmit = draft.qty > 0 && (draft.type === "labor" || Boolean(draft.description));

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      await addJobWorkEntryAction(jobId, {
        ...draft,
        description: draft.description || undefined,
        date,
        quotedLineItemId: kind === "tid" && draft.type === "labor" ? prefill?.quotedLineItemId : undefined,
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
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClasses("ghost")} onClick={onClose}>
            Avbryt
          </button>
          <button
            type="button"
            className={buttonClasses("primary")}
            disabled={isPending || !canSubmit}
            onClick={submit}
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

        <LinesEditor
          variant="single"
          fromRegister={false}
          lines={[line]}
          onChange={(lines) => setLine(lines[0] ?? line)}
          defaultVatRate={defaultVatRate}
          defaultHourlyRate={defaultHourlyRate}
        />

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

function EditSheet({
  entry,
  onClose,
  defaultHourlyRate,
  defaultVatRate = 25,
}: {
  entry: JobWorkViewEntry;
  onClose: () => void;
  defaultHourlyRate?: number;
  defaultVatRate?: VatRate;
}) {
  const [isPending, startTransition] = useTransition();
  const [line, setLine] = useState<DocLine>(() => viewEntryToDocLine(entry));
  const [date, setDate] = useState(entry.date);
  const saved = useRef(false);

  function persist() {
    if (entry.locked || saved.current) return;
    const draft = jobWorkInputFromDocLine(line);
    if (!(draft.qty > 0) || !draft.description) return;
    saved.current = true;
    startTransition(async () => {
      await updateJobWorkEntryAction(entry.id, {
        description: draft.description,
        date,
        qty: draft.qty,
        unit: draft.unit,
        unitPrice: draft.unitPrice,
        vatRate: draft.vatRate,
        type: draft.type,
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
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClasses("primary")} disabled={isPending} onClick={persist}>
            {isPending ? "Sparar …" : "Klar"}
          </button>
        </div>
      }
    >
      <div className="space-y-3 px-6 py-5">
        <LinesEditor
          variant="single"
          fromRegister={false}
          lines={[line]}
          onChange={(lines) => setLine(lines[0] ?? line)}
          defaultVatRate={defaultVatRate}
          defaultHourlyRate={defaultHourlyRate}
        />
        <label className="block">
          <span className="mb-1 block text-[13px] text-muted">Datum</span>
          <DateField value={date} onChange={setDate} />
        </label>
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
