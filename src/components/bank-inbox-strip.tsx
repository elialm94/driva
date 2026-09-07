"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Inbox, Sparkles } from "lucide-react";
import { Badge, buttonClasses, cx } from "./ui";
import { Modal } from "./modal";
import { useToast } from "./toast";
import { bookSuggestedBankTransactionsAction } from "@/app/bokforing-actions";
import { datumKort, kr } from "@/lib/format";
import type { BankInboxSummary } from "@/lib/services/economy-list";

/**
 * Bankvyns huvud: hur många transaktioner som väntar, hur många motorn redan
 * har ett förslag för, och om banken stämmer mot bokföringen. "Bokför alla
 * föreslagna" visar exakt vad som kommer att bokföras innan något sker.
 */
export function BankInboxStrip({ summary, filterHref }: { summary: BankInboxSummary; filterHref?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<{ counterpart: string; error: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const suggested = summary.suggested;
  const recon = summary.reconciliation;
  const allDone = summary.open === 0;

  function confirmAll() {
    setError(null);
    startTransition(async () => {
      const result = await bookSuggestedBankTransactionsAction(suggested.map((s) => s.txId));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.booked > 0) {
        toast({
          title: result.booked === 1 ? "1 transaktion bokfördes" : `${result.booked} transaktioner bokfördes`,
          text:
            result.failed.length > 0
              ? `${result.failed.length} gick inte – se raderna nedan.`
              : "Driva kommer ihåg valen – nästa gång föreslås samma sak, och från andra gången sker det automatiskt.",
          tone: "ok",
        });
      }
      if (result.failed.length > 0) {
        setFailed(result.failed);
      } else {
        setOpen(false);
      }
      router.refresh();
    });
  }

  return (
    <>
      <section
        className={cx(
          "card flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between",
          allDone && "border-ok/30"
        )}
        aria-label="Bankinkorgen"
        data-bank-inbox
        data-bank-open={summary.open}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cx(
              "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl",
              allDone ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent"
            )}
            aria-hidden
          >
            {allDone ? <CheckCircle2 className="size-5" /> : <Inbox className="size-5" />}
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-ink">
              {allDone
                ? "Alla banktransaktioner är hanterade"
                : summary.open === 1
                  ? "1 transaktion att hantera"
                  : `${summary.open} transaktioner att hantera`}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-soft">
              {allDone ? (
                <span>
                  {recon.ok
                    ? `Banken stämmer mot bokföringen${recon.reconciledThrough ? ` till och med ${datumKort(recon.reconciledThrough)}` : ""}.`
                    : "Alla rader är bokförda, men saldot skiljer sig – se nedan."}
                </span>
              ) : (
                <>
                  {suggested.length > 0 ? (
                    <span className="inline-flex items-center gap-1 font-medium text-accent">
                      <Sparkles className="size-3.5" />
                      {suggested.length === 1 ? "1 har ett förslag" : `${suggested.length} har förslag`}
                    </span>
                  ) : null}
                  {summary.awaitingReceipt > 0 ? (
                    <span>
                      {summary.awaitingReceipt === 1 ? "1 väntar på kvitto" : `${summary.awaitingReceipt} väntar på kvitto`}
                    </span>
                  ) : null}
                  <span className="tabular-nums">
                    {summary.openIn > 0 ? `${kr(summary.openIn)} in` : null}
                    {summary.openIn > 0 && summary.openOut > 0 ? " · " : null}
                    {summary.openOut > 0 ? `${kr(summary.openOut)} ut` : null}
                  </span>
                </>
              )}
              {recon.ok ? (
                allDone ? null : (
                  <Badge tone="ok">Banken stämmer</Badge>
                )
              ) : (
                <Badge tone={recon.unexplained === 0 ? "warn" : "danger"}>
                  {recon.unexplained === 0 ? "Obokade rader kvar" : `Oförklarad skillnad ${kr(Math.abs(recon.unexplained))}`}
                </Badge>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {suggested.length > 0 ? (
            <button
              type="button"
              className={buttonClasses("primary", "sm")}
              onClick={() => {
                setFailed([]);
                setError(null);
                setOpen(true);
              }}
              data-bank-book-all
            >
              <Sparkles className="size-3.5" />
              Bokför {suggested.length === 1 ? "förslaget" : `${suggested.length} föreslagna`}
            </button>
          ) : null}
          {!allDone && filterHref ? (
            <Link href={filterHref} className={buttonClasses("secondary", "sm")}>
              Visa bara att hantera
            </Link>
          ) : null}
        </div>
      </section>

      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={suggested.length === 1 ? "Bokför förslaget?" : `Bokför ${suggested.length} föreslagna?`}
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className={cx(buttonClasses("ghost", "sm"), "max-lg:min-h-11")}
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              {failed.length > 0 ? "Stäng" : "Avbryt"}
            </button>
            {failed.length === 0 ? (
              <button
                type="button"
                className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")}
                disabled={pending || suggested.length === 0}
                onClick={confirmAll}
                data-bank-book-all-confirm
              >
                {pending ? "Bokför …" : `Bokför ${suggested.length === 1 ? "1 transaktion" : `${suggested.length} transaktioner`}`}
              </button>
            ) : null}
          </div>
        }
      >
        <div className="px-6 py-5">
          <p className="text-[14px] leading-relaxed text-soft">
            Varje rad bokförs på samma sätt som om du klickat på den. Motparterna sparas som regler: nästa gång föreslås
            samma bokföring, och från andra gången sker den automatiskt.
          </p>
          <ul className="mt-4 divide-y divide-line/70 rounded-2xl border border-line/80" aria-label="Transaktioner som bokförs">
            {suggested.map((s) => {
              const fail = failed.find((f) => f.counterpart === s.counterpart);
              return (
                <li key={s.txId} className="flex items-start justify-between gap-3 px-3 py-2.5 text-[13px]">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">
                      {s.counterpart} <span className="font-normal text-muted">· {datumKort(s.date)}</span>
                    </p>
                    <p className="truncate text-soft">{s.label}</p>
                    {fail ? (
                      <p className="mt-1 font-medium text-danger" role="alert">
                        {fail.error}
                      </p>
                    ) : null}
                  </div>
                  <span className={cx("shrink-0 tabular-nums font-medium", s.amount > 0 ? "text-ok" : "text-ink")}>
                    {s.amount > 0 ? "+" : "−"}
                    {kr(Math.abs(s.amount))}
                  </span>
                </li>
              );
            })}
          </ul>
          {error ? (
            <p className="mt-3 text-[13px] font-medium text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
