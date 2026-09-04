"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Hammer, Plus } from "lucide-react";
import { buttonClasses, ButtonLink } from "./ui";
import { createInvoiceFromQuoteAction, startJobFromQuoteAction } from "@/app/actions";
import { invoiceEditHref, jobHref, newInvoiceHref, newQuoteHref, type PageOrigin } from "@/lib/nav";
import type { CustomerChainCtas } from "@/lib/business-chain-model";
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

  function invoiceFromQuote() {
    if (!ctas.approvedQuoteId) return;
    startTransition(async () => {
      const invoiceId = await createInvoiceFromQuoteAction(ctas.approvedQuoteId!);
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
      {ctas.approvedQuoteId ? (
        <button type="button" className={buttonClasses("secondary", "sm")} disabled={isPending} onClick={invoiceFromQuote}>
          <Plus className="size-3.5" /> Skapa faktura
        </button>
      ) : ctas.preferLinkedInvoice && ctas.openJobId ? (
        <>
          <ButtonLink href={jobHref(ctas.openJobId, from)} size="sm">
            <Plus className="size-3.5" /> {ctas.primary?.label ?? "Skapa faktura"}
          </ButtonLink>
          <ButtonLink href={newInvoiceHref({ kund: customerId, fristaende: true, from })} size="sm" variant="secondary">
            Fristående faktura
          </ButtonLink>
        </>
      ) : (
        <ButtonLink href={newInvoiceHref({ kund: customerId, from })} size="sm">
          <Plus className="size-3.5" /> Ny faktura
        </ButtonLink>
      )}
    </div>
  );
}
