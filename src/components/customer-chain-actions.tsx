"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Hammer, ReceiptText } from "lucide-react";
import { AppLink } from "./app-link";
import { buttonClasses, ButtonLink } from "./ui";
import { createInvoiceFromQuoteAction, startJobFromQuoteAction } from "@/app/actions";
import { invoiceEditHref, jobHref, newQuoteHref, type PageOrigin } from "@/lib/nav";
import type { CustomerChainCtas, CustomerInvoiceSourceOption } from "@/lib/business-chain-model";
import { NewUppdragButton, type JobWorkLocationOption } from "./uppdrag-form";

/** Samma glyph som i nav / objektytorna: Hammer, FileText, ReceiptText. 18px, currentColor. */
const headerIconClass = "size-[18px] shrink-0";

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
        <button type="button" className={buttonClasses("ghost", "sm")} disabled={isPending} onClick={startFromQuote}>
          <Hammer className={headerIconClass} />
          {isPending ? "…" : "Starta uppdrag"}
        </button>
      ) : (
        <NewUppdragButton
          customers={[{ id: customerId, name: customerName, kind: customerKind }]}
          defaultCustomerId={customerId}
          workLocations={workLocations}
          defaultWorkLocationId={defaultWorkLocationId}
          size="sm"
          variant="ghost"
          icon={Hammer}
          iconClassName={headerIconClass}
        />
      )}
      <ButtonLink href={newQuoteHref({ kund: customerId, from })} size="sm" variant="secondary">
        <FileText className={headerIconClass} /> Ny offert
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
        <ReceiptText className={headerIconClass} /> Skapa faktura
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
  return (
    <details className="relative shrink-0 max-lg:basis-full" data-invoice-create="picker">
      <summary
        className={`${buttonClasses("primary", "sm")} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
      >
        <ReceiptText className={headerIconClass} />
        {pending ? "…" : "Skapa faktura"}
      </summary>
      <div
        role="menu"
        data-invoice-picker=""
        className="absolute left-0 top-full z-50 mt-1.5 min-w-[13rem] overflow-hidden rounded-xl border border-line bg-card p-1 shadow-pop max-lg:right-0 max-lg:min-w-0 lg:left-auto lg:right-0 lg:min-w-[15.5rem]"
      >
        {quotes.length === 1 ? (
          <button
            type="button"
            role="menuitem"
            className={pickerItemClass}
            disabled={pending}
            onClick={() => onInvoiceFromQuote(quotes[0].id)}
          >
            Från offert
          </button>
        ) : quotes.length > 1 ? (
          <details>
            <summary className={`${pickerItemClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
              Från offert
            </summary>
            {quotes.map((quote) => (
              <button
                key={quote.id}
                type="button"
                role="menuitem"
                className={`${pickerItemClass} pl-4`}
                disabled={pending}
                onClick={() => onInvoiceFromQuote(quote.id)}
              >
                {quote.label}
              </button>
            ))}
          </details>
        ) : null}
        {jobs.length === 1 && jobs[0].href ? (
          <AppLink role="menuitem" href={jobs[0].href} className={pickerItemClass} data-invoice-create="from-job">
            Från uppdrag
          </AppLink>
        ) : jobs.length > 1 ? (
          <details data-invoice-create="from-job-list">
            <summary className={`${pickerItemClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
              Från uppdrag
            </summary>
            {jobs.map((job) =>
              job.href ? (
                <AppLink key={job.id} role="menuitem" href={job.href} className={`${pickerItemClass} pl-4`}>
                  {job.label}
                </AppLink>
              ) : null
            )}
          </details>
        ) : null}
        <AppLink
          role="menuitem"
          href={standaloneHref}
          className={pickerItemClass}
          data-invoice-create="standalone-choice"
        >
          Fristående
        </AppLink>
      </div>
    </details>
  );
}

const pickerItemClass =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-canvas";
