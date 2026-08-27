"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, CheckCircle2, PartyPopper, Plus, FileText, Pencil } from "lucide-react";
import { buttonClasses, ButtonLink } from "./ui";
import { Modal } from "./modal";
import { ActionMenu, PageActions, actionMenuItemClassName, useActionMenu } from "./action-menu";
import { EditUppdragModal } from "./uppdrag-form";
import {
  createFinalInvoiceForJobAction,
  createNextInvoiceForJobAction,
  setJobStatusAction,
} from "@/app/actions";
import { invoiceHref } from "@/lib/nav";
import type { JobPrimaryKind } from "@/lib/services/job-admin";
import type { ReactNode } from "react";

function JobMenuItem({
  onSelect,
  icon,
  label,
}: {
  onSelect: () => void;
  icon: ReactNode;
  label: string;
}) {
  const menu = useActionMenu();
  return (
    <button
      type="button"
      role="menuitem"
      className={actionMenuItemClassName()}
      onClick={() => {
        menu?.close();
        onSelect();
      }}
    >
      {icon}
      {label}
    </button>
  );
}

export function JobActions({
  jobId,
  jobTitle,
  customerId,
  customerName,
  remainingAmount,
  remainingLabel,
  primary,
  secondary,
  waitingLabel,
  doneLabel,
  canMarkDone,
  quoteHref,
  newQuoteHref,
  job,
}: {
  jobId: string;
  jobTitle: string;
  customerId: string;
  customerName: string;
  remainingAmount: number;
  remainingLabel: string | null;
  primary: JobPrimaryKind | null;
  secondary: "visa_offert" | null;
  waitingLabel: string | null;
  doneLabel: string | null;
  canMarkDone: boolean;
  quoteHref: string;
  newQuoteHref: string;
  job: {
    title: string;
    description: string;
    address?: string;
    startDate?: string;
    endDate?: string;
  };
}) {
  const [isPending, startTransition] = useTransition();
  const [showDoneDialog, setShowDoneDialog] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const router = useRouter();
  const fromHere = { href: `/uppdrag/${jobId}`, label: jobTitle };

  function startJob() {
    startTransition(async () => setJobStatusAction(jobId, "pagar"));
  }

  function markDone() {
    startTransition(async () => {
      await setJobStatusAction(jobId, "klart");
      setShowDoneDialog(true);
    });
  }

  function createInvoice(final: boolean) {
    startTransition(async () => {
      const invoiceId = final
        ? await createFinalInvoiceForJobAction(jobId)
        : await createNextInvoiceForJobAction(jobId);
      router.push(invoiceHref(invoiceId, fromHere) as never);
    });
  }

  const primaryBtn =
    primary === "skapa_offert" ? (
      <ButtonLink href={newQuoteHref}>Skapa offert</ButtonLink>
    ) : primary === "visa_offert" ? (
      <ButtonLink href={quoteHref}>
        <FileText className="size-4" /> Visa offert
      </ButtonLink>
    ) : primary === "starta" ? (
      <button className={buttonClasses("primary")} disabled={isPending} onClick={startJob}>
        <Play className="size-4" />
        {isPending ? "Startar …" : "Starta uppdrag"}
      </button>
    ) : primary === "skapa_faktura" ? (
      <button className={buttonClasses("accent")} disabled={isPending} onClick={() => createInvoice(false)}>
        <Plus className="size-4" />
        {isPending ? "Skapar …" : "Skapa faktura"}
      </button>
    ) : primary === "skapa_slutfaktura" ? (
      <button className={buttonClasses("accent")} disabled={isPending} onClick={() => createInvoice(true)}>
        <Plus className="size-4" />
        {isPending ? "Skapar …" : "Skapa slutfaktura"}
      </button>
    ) : null;

  const secondaryBtn =
    secondary === "visa_offert" && primary !== "visa_offert" ? (
      <ButtonLink href={quoteHref} variant="secondary">
        <FileText className="size-4" /> Visa offert
      </ButtonLink>
    ) : null;

  return (
    <>
      <PageActions>
        {primaryBtn}
        {secondaryBtn}
        {waitingLabel ? <p className="text-[14px] font-medium text-soft">{waitingLabel}</p> : null}
        {doneLabel ? <p className="text-[14px] font-semibold text-ok">{doneLabel}</p> : null}
        <ActionMenu>
          <JobMenuItem
            onSelect={() => setShowEdit(true)}
            icon={<Pencil className="size-4 shrink-0" />}
            label="Redigera uppdrag"
          />
          {canMarkDone ? (
            <JobMenuItem
              onSelect={markDone}
              icon={<CheckCircle2 className="size-4 shrink-0" />}
              label="Markera som klart"
            />
          ) : null}
        </ActionMenu>
      </PageActions>

      <EditUppdragModal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        jobId={jobId}
        customerId={customerId}
        customerName={customerName}
        initial={job}
      />

      <Modal open={showDoneDialog} onClose={() => setShowDoneDialog(false)} size="sm">
        <div className="flex flex-col items-center px-8 py-10 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-ok-soft">
            <PartyPopper className="size-7 text-ok" />
          </div>
          <p className="mt-4 text-[19px] font-semibold tracking-tight">Uppdraget är klart</p>
          <p className="mt-2 text-sm leading-relaxed text-soft">
            {remainingAmount > 0 && remainingLabel
              ? `${remainingLabel} återstår enligt den godkända offerten.`
              : `Uppdraget hos ${customerName} är markerat som klart.`}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button className={buttonClasses("ghost")} onClick={() => setShowDoneDialog(false)}>
              Gör det senare
            </button>
            {remainingAmount > 0 ? (
              <button
                className={buttonClasses("accent")}
                disabled={isPending}
                onClick={() => createInvoice(true)}
              >
                {isPending ? "Skapar …" : "Skapa slutfaktura"}
              </button>
            ) : null}
          </div>
        </div>
      </Modal>
    </>
  );
}

export function CreateInvoiceButton({
  jobId,
  jobTitle,
  label = "Skapa faktura",
  variant = "accent",
  size = "md",
}: {
  jobId: string;
  jobTitle?: string;
  label?: string;
  variant?: "primary" | "accent" | "secondary";
  size?: "sm" | "md";
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      className={buttonClasses(variant, size)}
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const invoiceId = await createFinalInvoiceForJobAction(jobId);
          router.push(invoiceHref(invoiceId, { href: `/uppdrag/${jobId}`, label: jobTitle }) as never);
        })
      }
    >
      <Plus className="size-3.5" />
      {isPending ? "Skapar …" : label}
    </button>
  );
}
