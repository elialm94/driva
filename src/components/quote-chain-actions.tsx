"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Hammer, Plus } from "lucide-react";
import { buttonClasses } from "./ui";
import { actionMenuItemClassName, ActionMenu, useActionMenu } from "./action-menu";
import { createInvoiceFromQuoteAction, startJobFromQuoteAction } from "@/app/actions";
import { invoiceEditHref, jobHref } from "@/lib/nav";
import type { ChainCta, QuoteChainState } from "@/lib/business-chain-model";

function OverflowItem({ cta, onRun }: { cta: ChainCta; onRun: (cta: ChainCta) => void }) {
  const menu = useActionMenu();
  return (
    <button
      type="button"
      role="menuitem"
      className={actionMenuItemClassName()}
      onClick={() => {
        menu?.close();
        onRun(cta);
      }}
    >
      {cta.kind === "starta_uppdrag" ? <Hammer className="size-4 shrink-0" /> : <Plus className="size-4 shrink-0" />}
      {cta.label}
    </button>
  );
}

export function QuoteChainActions({
  state,
  returnTo,
  returnLabel,
}: {
  state: QuoteChainState;
  returnTo: string;
  returnLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const from = { href: returnTo, label: returnLabel };

  function run(cta: ChainCta) {
    startTransition(async () => {
      if (cta.kind === "starta_uppdrag" && cta.quoteId) {
        const jobId = await startJobFromQuoteAction(cta.quoteId);
        router.push(jobHref(jobId, from) as never);
        return;
      }
      if (cta.kind === "oppna_uppdrag" && cta.href) {
        router.push(cta.href as never);
        return;
      }
      if ((cta.kind === "skapa_faktura" || cta.kind === "skapa_delfaktura") && cta.quoteId) {
        const invoiceId = await createInvoiceFromQuoteAction(cta.quoteId);
        router.push(invoiceEditHref(invoiceId, from) as never);
      }
    });
  }

  function Button({ cta, variant }: { cta: ChainCta; variant: "accent" | "secondary" }) {
    return (
      <button type="button" className={buttonClasses(variant)} disabled={isPending} onClick={() => run(cta)}>
        {cta.kind === "starta_uppdrag" || cta.kind === "oppna_uppdrag" ? (
          <Hammer className="size-4" />
        ) : (
          <Plus className="size-4" />
        )}
        {isPending ? "…" : cta.label}
      </button>
    );
  }

  if (!state.primary && state.secondary.length === 0 && state.overflow.length === 0 && !state.waitingLabel) {
    return null;
  }

  return (
    <>
      {state.primary ? <Button cta={state.primary} variant="accent" /> : null}
      {state.secondary.map((cta) => (
        <Button key={cta.kind + (cta.quoteId ?? cta.jobId ?? "")} cta={cta} variant="secondary" />
      ))}
      {state.waitingLabel ? <p className="text-[14px] font-medium text-soft">{state.waitingLabel}</p> : null}
      {state.overflow.length > 0 ? (
        <ActionMenu>
          {state.overflow.map((cta) => (
            <OverflowItem key={cta.kind} cta={cta} onRun={run} />
          ))}
        </ActionMenu>
      ) : null}
    </>
  );
}
