"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Hammer, Plus } from "lucide-react";
import { AppLink } from "./app-link";
import { buttonClasses, ButtonLink } from "./ui";
import { createInvoiceFromQuoteAction, startJobFromQuoteAction } from "@/app/actions";
import { invoiceEditHref, jobHref, newQuoteHref, type PageOrigin } from "@/lib/nav";
import type { CustomerChainCtas, CustomerInvoiceSourceOption } from "@/lib/business-chain-model";
import { NewUppdragButton, type JobWorkLocationOption } from "./uppdrag-form";

export function CustomerChainActions({
  customerId,
  customerName,
  customerKind,
  workLocations,
  defaultWorkLocationId,
  ctas,
  from,
}: {
  customerId: string;
  customerName: string;
  customerKind: "privat" | "foretag";
  workLocations: JobWorkLocationOption[];
  defaultWorkLocationId?: string;
  ctas: CustomerChainCtas;
  from: PageOrigin;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function startFromQuote() {
    if (!ctas.approvedQuoteId) return;
    startTransition(async () => {
      const jobId = await startJobFromQuoteAction(ctas.approvedQuoteId!);
      router.push(jobHref(jobId, from) as never);
    });
  }

  function invoiceFromQuote(quoteId: string) {
    startTransition(async () => {
      const invoiceId = await createInvoiceFromQuoteAction(quoteId);
      router.push(invoiceEditHref(invoiceId, from) as never);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {ctas.approvedQuoteId ? (
        <button type="button" className={buttonClasses("accent", "sm")} disabled={isPending} onClick={startFromQuote}>
          <Hammer className="size-3.5" />
          {isPending ? "…" : "Starta uppdrag"}
        </button>
      ) : (
        <NewUppdragButton
          customers={[{ id: customerId, name: customerName, kind: customerKind }]}
          defaultCustomerId={customerId}
          workLocations={workLocations}
          defaultWorkLocationId={defaultWorkLocationId}
          size="sm"
          variant="secondary"
        />
      )}
      <ButtonLink href={newQuoteHref({ kund: customerId, from })} size="sm" variant="secondary">
        <Plus className="size-3.5" /> Ny offert
      </ButtonLink>
      <CustomerInvoiceCreate
        ctas={ctas}
        pending={isPending}
        onInvoiceFromQuote={invoiceFromQuote}
      />
    </div>
  );
}

function CustomerInvoiceCreate({
  ctas,
  pending,
  onInvoiceFromQuote,
}: {
  ctas: CustomerChainCtas;
  pending: boolean;
  onInvoiceFromQuote: (quoteId: string) => void;
}) {
  if (!ctas.showInvoicePicker) {
    return (
      <AppLink
        href={ctas.standaloneInvoiceHref}
        className={buttonClasses("primary", "sm")}
        data-invoice-create="standalone"
      >
        <Plus className="size-3.5" /> Skapa faktura
      </AppLink>
    );
  }

  return (
    <InvoiceSourcePicker
      quotes={ctas.invoiceQuotes}
      jobs={ctas.invoiceJobs}
      standaloneHref={ctas.standaloneInvoiceHref}
      pending={pending}
      onInvoiceFromQuote={onInvoiceFromQuote}
    />
  );
}

function InvoiceSourcePicker({
  quotes,
  jobs,
  standaloneHref,
  pending,
  onInvoiceFromQuote,
}: {
  quotes: CustomerInvoiceSourceOption[];
  jobs: CustomerInvoiceSourceOption[];
  standaloneHref: string;
  pending: boolean;
  onInvoiceFromQuote: (quoteId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"root" | "quotes" | "jobs">("root");
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    setView("root");
  }

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pickQuote(quote: CustomerInvoiceSourceOption) {
    close();
    onInvoiceFromQuote(quote.id);
  }

  function onFromQuote() {
    if (quotes.length === 1) {
      pickQuote(quotes[0]);
      return;
    }
    setView("quotes");
  }

  function onFromJob() {
    if (jobs.length === 1 && jobs[0].href) {
      close();
      return;
    }
    setView("jobs");
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className={buttonClasses("primary", "sm")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        disabled={pending}
        data-invoice-create="picker"
        onClick={() => {
          if (open) close();
          else {
            setView("root");
            setOpen(true);
          }
        }}
      >
        <Plus className="size-3.5" />
        {pending ? "…" : "Skapa faktura"}
      </button>
      <div
        id={id}
        role="menu"
        aria-hidden={!open}
        data-invoice-picker=""
        className={`absolute right-0 top-full z-30 mt-1.5 min-w-[15.5rem] overflow-hidden rounded-xl border border-line bg-card p-1 shadow-pop ${open ? "" : "hidden"}`}
      >
        {view !== "root" ? (
          <button
            type="button"
            className={pickerItemClass}
            onClick={() => setView("root")}
          >
            <ChevronLeft className="size-3.5 shrink-0" />
            Tillbaka
          </button>
        ) : null}
        {view === "root" ? (
          <>
            {quotes.length > 0 ? (
              <button type="button" role="menuitem" className={pickerItemClass} onClick={onFromQuote}>
                Från offert
              </button>
            ) : null}
            {jobs.length > 0 ? (
              jobs.length === 1 && jobs[0].href ? (
                <AppLink role="menuitem" href={jobs[0].href} className={pickerItemClass} onClick={close}>
                  Från uppdrag
                </AppLink>
              ) : (
                <button type="button" role="menuitem" className={pickerItemClass} onClick={onFromJob}>
                  Från uppdrag
                </button>
              )
            ) : null}
            <AppLink
              role="menuitem"
              href={standaloneHref}
              className={pickerItemClass}
              onClick={close}
              data-invoice-create="standalone-choice"
            >
              Fristående
            </AppLink>
          </>
        ) : null}
        {view === "quotes"
          ? quotes.map((quote) => (
              <button
                key={quote.id}
                type="button"
                role="menuitem"
                className={pickerItemClass}
                onClick={() => pickQuote(quote)}
              >
                {quote.label}
              </button>
            ))
          : null}
        {view === "jobs"
          ? jobs.map((job) =>
              job.href ? (
                <AppLink key={job.id} role="menuitem" href={job.href} className={pickerItemClass} onClick={close}>
                  {job.label}
                </AppLink>
              ) : null
            )
          : null}
      </div>
    </div>
  );
}

const pickerItemClass =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-canvas";
