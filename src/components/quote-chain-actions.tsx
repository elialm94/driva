"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FileLock2, Hammer, Pencil, Plus } from "lucide-react";
import { buttonClasses } from "./ui";
import { actionMenuItemClassName, ActionMenu, ActionMenuLink, PageActions, useActionMenu } from "./action-menu";
import { QuotePdfMenuItem } from "./quote-pdf-menu-item";
import { CopyLinkButton } from "./copy-button";
import { WithdrawQuoteDialog, WithdrawQuoteMenuItem } from "./withdraw-quote-button";
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

function useQuoteChainRun(returnTo: string, returnLabel: string) {
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

  return { run, isPending };
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
  const { run, isPending } = useQuoteChainRun(returnTo, returnLabel);

  // Renderfunktion, inte en komponent: en komponent deklarerad i render får ny
  // identitet varje gång och nollställer sitt tillstånd.
  function renderButton(cta: ChainCta, variant: "accent" | "secondary", key?: string) {
    return (
      <button key={key} type="button" className={buttonClasses(variant)} disabled={isPending} onClick={() => run(cta)}>
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
      {state.primary ? renderButton(state.primary, "accent") : null}
      {state.secondary.map((cta) => renderButton(cta, "secondary", cta.kind + (cta.quoteId ?? cta.jobId ?? "")))}
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

/**
 * Ägarens åtgärdsfält: en synlig primär + en overflow.
 * Kundnamnet i underrubriken är länken till kunden – ingen Öppna kundvyn.
 * Starta uppdrag och Fakturera/Skapa faktura visas aldrig samtidigt.
 */
export function QuoteOwnerPageActions({
  status,
  quoteId,
  publicPath,
  editHref,
  returnTo,
  returnLabel,
  jobLinked,
  canInvoice,
  followUp,
}: {
  status: QuoteChainState["status"];
  quoteId: string;
  publicPath: string;
  editHref: string;
  returnTo: string;
  returnLabel: string;
  jobLinked: boolean;
  canInvoice: boolean;
  followUp?: ReactNode;
}) {
  const { run, isPending } = useQuoteChainRun(returnTo, returnLabel);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const startJob: ChainCta = { kind: "starta_uppdrag", label: "Starta uppdrag", quoteId };
  const fakturera: ChainCta = { kind: "skapa_faktura", label: "Fakturera", quoteId };

  const showStartPrimary = status === "godkand" && !jobLinked;
  const showFaktureraPrimary = status === "godkand" && jobLinked && canInvoice;
  const showVersion = status === "skickad" || status === "godkand" || status === "avbojd";
  const showWithdraw = status === "skickad";
  const showIntyg = status === "godkand";

  return (
    <div data-quote-owner-actions="">
    <PageActions>
      {followUp}
      {showStartPrimary ? (
        <button type="button" className={buttonClasses("accent")} disabled={isPending} onClick={() => run(startJob)}>
          <Hammer className="size-4" />
          {isPending ? "…" : "Starta uppdrag"}
        </button>
      ) : null}
      {showFaktureraPrimary ? (
        <button
          type="button"
          data-quote-owner-fakturera=""
          className={buttonClasses("accent")}
          disabled={isPending}
          onClick={() => run(fakturera)}
        >
          <Plus className="size-4" />
          {isPending ? "…" : "Fakturera"}
        </button>
      ) : null}
      <ActionMenu>
        <CopyLinkButton path={publicPath} appearance="menu" copiedLabel="✓ Kundlänken är kopierad" />
        <QuotePdfMenuItem href={`${publicPath}/pdf`} />
        {showVersion ? (
          <ActionMenuLink href={editHref}>
            <Pencil className="size-3.5 shrink-0" /> Ny version
          </ActionMenuLink>
        ) : null}
        {showWithdraw ? <WithdrawQuoteMenuItem onOpen={() => setWithdrawOpen(true)} /> : null}
        {showIntyg ? (
          <ActionMenuLink href={`${publicPath}/underlag`} external>
            <FileLock2 className="size-3.5 shrink-0" /> Visa intyg
          </ActionMenuLink>
        ) : null}
      </ActionMenu>
    </PageActions>
    {showWithdraw ? (
      <WithdrawQuoteDialog quoteId={quoteId} open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
    ) : null}
    </div>
  );
}
