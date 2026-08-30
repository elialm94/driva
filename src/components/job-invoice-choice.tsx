"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClasses } from "./ui";
import { Modal } from "./modal";
import { kr } from "@/lib/format";
import { invoiceEditHref } from "@/lib/nav";
import { createInvoiceForJobAction } from "@/app/actions";
import type {
  JobInvoiceBasis,
  JobInvoiceChoice,
  JobInvoiceOption,
  JobInvoiceOptionBasis,
} from "@/lib/job-ui-types";

export function JobInvoiceModal({
  open,
  onClose,
  jobId,
  jobTitle,
  choice,
  preselect,
}: {
  open: boolean;
  onClose: () => void;
  jobId: string;
  jobTitle: string;
  choice: JobInvoiceChoice;
  preselect?: JobInvoiceOptionBasis;
}) {
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<JobInvoiceOptionBasis | null>(preselect ?? null);
  const [warn, setWarn] = useState(false);
  const router = useRouter();
  const fromHere = { href: `/uppdrag/${jobId}`, label: jobTitle };

  const defaultBasis: JobInvoiceOptionBasis | null =
    preselect && choice.options.some((o) => o.basis === preselect)
      ? preselect
      : (choice.options.find((o) => o.recommended)?.basis ??
        choice.options.find((o) => o.basis !== "empty")?.basis ??
        choice.options[0]?.basis ??
        null);
  const basis = selected ?? defaultBasis;

  useEffect(() => {
    if (!open) {
      setWarn(false);
      setSelected(preselect ?? null);
    }
  }, [open, preselect]);

  function go(next: JobInvoiceBasis) {
    startTransition(async () => {
      const invoiceId = await createInvoiceForJobAction(jobId, next);
      onClose();
      router.push(invoiceEditHref(invoiceId, fromHere) as never);
    });
  }

  function confirm() {
    if (!basis) return;
    const needsWarn = Boolean(choice.warning) && basis === "actuals";
    if (needsWarn && !warn) {
      setWarn(true);
      return;
    }
    go(basis);
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setWarn(false);
        onClose();
      }}
      title={warn ? "Högre än den godkända offerten" : "Skapa faktura"}
      size="sm"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {warn ? (
            <>
              <button
                type="button"
                className={buttonClasses("secondary")}
                onClick={() => router.push(choice.warning?.tillaggHref ?? choice.tillaggHref)}
              >
                Skapa tilläggsoffert
              </button>
              <button type="button" className={buttonClasses("primary")} disabled={isPending} onClick={confirm}>
                {isPending ? "Skapar …" : "Fortsätt till utkast"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={buttonClasses("ghost")} onClick={onClose}>
                Avbryt
              </button>
              <button
                type="button"
                className={buttonClasses("accent")}
                disabled={isPending || !basis}
                onClick={confirm}
              >
                {isPending ? "Skapar …" : "Skapa utkast"}
              </button>
            </>
          )}
        </div>
      }
    >
      <div className="px-6 py-5">
        {warn && choice.warning ? (
          <>
            <p className="text-[15px] leading-relaxed text-soft">
              Registrerat är <span className="font-semibold text-ink">{kr(choice.warning.excess)}</span> mer än
              det som är kvar enligt offerten.
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Tillägg är inte godkända av kunden. Skapa en tilläggsoffert, eller fortsätt till ett utkast.
            </p>
          </>
        ) : (
          <div className="space-y-2">
            <p className="pb-1 text-[15px] font-medium">Vad vill du fakturera?</p>
            {choice.unapprovedQuoteNotice ? (
              <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] leading-relaxed text-warn">
                {choice.unapprovedQuoteNotice}
              </p>
            ) : null}
            {choice.options.map((option) => (
              <InvoiceOptionButton
                key={option.basis}
                option={option}
                selected={basis === option.basis}
                onSelect={() => setSelected(option.basis)}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function InvoiceOptionButton({
  option,
  selected,
  onSelect,
}: {
  option: JobInvoiceOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`min-h-14 w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
        selected ? "border-accent bg-accent-soft/40" : "border-line hover:bg-canvas/60"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[15px] font-medium">
          {option.title}
          {option.recommended ? (
            <span className="ml-2 text-[12px] font-medium text-accent">Rekommenderas</span>
          ) : null}
        </p>
        {option.basis !== "empty" ? (
          <p className="shrink-0 text-[15px] font-semibold tabular">{kr(option.amount)}</p>
        ) : null}
      </div>
      <p className="mt-0.5 text-[13px] text-muted">{option.hint}</p>
      {option.extrasAmount ? (
        <p className="mt-0.5 text-[13px] text-warn">varav tillägg {kr(option.extrasAmount)}</p>
      ) : null}
    </button>
  );
}
