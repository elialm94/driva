"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, CheckCircle2, PartyPopper, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { buttonClasses, ButtonLink } from "./ui";
import { Modal } from "./modal";
import { ActionMenu, PageActions, actionMenuItemClassName, useActionMenu } from "./action-menu";
import { EditUppdragModal } from "./uppdrag-form";
import { createInvoiceForJobAction, deleteOrArchiveJobAction, reopenJobAction, setJobStatusAction } from "@/app/actions";
import { invoiceEditHref } from "@/lib/nav";
import { kr } from "@/lib/format";
import type {
  JobCompleteWarning,
  JobInvoiceAction,
  JobInvoiceChoice,
  JobInvoiceOptionBasis,
  JobQuoteAction,
  JobRemovalPolicy,
} from "@/lib/job-ui-types";
import type { ReactNode } from "react";
import { JobInvoiceModal } from "./job-invoice-choice";

function JobMenuItem({
  onSelect,
  icon,
  label,
  danger,
}: {
  onSelect: () => void;
  icon: ReactNode;
  label: string;
  danger?: boolean;
}) {
  const menu = useActionMenu();
  return (
    <button
      type="button"
      role="menuitem"
      className={actionMenuItemClassName({ danger })}
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
  quoteAction,
  invoiceAction,
  waitingLabel,
  doneLabel,
  canMarkDone,
  canReopen,
  completeWarning,
  removal,
  quoteHref,
  newQuoteHref,
  invoiceChoice,
  job,
}: {
  jobId: string;
  jobTitle: string;
  customerId: string;
  customerName: string;
  remainingAmount: number;
  remainingLabel: string | null;
  quoteAction: JobQuoteAction;
  invoiceAction: JobInvoiceAction;
  waitingLabel: string | null;
  doneLabel: string | null;
  canMarkDone: boolean;
  canReopen: boolean;
  completeWarning: JobCompleteWarning;
  removal: JobRemovalPolicy;
  quoteHref: string;
  newQuoteHref: string;
  invoiceChoice: JobInvoiceChoice;
  job: {
    title: string;
    description: string;
    address?: string;
    startDate?: string;
    endDate?: string;
  };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showDoneDialog, setShowDoneDialog] = useState(false);
  const [showDoneWarn, setShowDoneWarn] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [invoicePreselect, setInvoicePreselect] = useState<JobInvoiceOptionBasis | undefined>();
  const [showRemove, setShowRemove] = useState(false);

  function openInvoice(preselect?: JobInvoiceOptionBasis) {
    const auto = invoiceChoice.autoBasis;
    const skipPicker =
      !preselect &&
      !invoiceChoice.unapprovedQuoteNotice &&
      auto != null &&
      (auto === "empty" || invoiceChoice.options.filter((o) => o.basis !== "empty").length === 1);
    if (skipPicker && auto) {
      startTransition(async () => {
        const invoiceId = await createInvoiceForJobAction(jobId, auto);
        router.push(invoiceEditHref(invoiceId, { href: `/uppdrag/${jobId}`, label: jobTitle }) as never);
      });
      return;
    }
    setInvoicePreselect(preselect);
    setShowInvoice(true);
  }

  function markDone() {
    if (completeWarning.shouldWarn) {
      setShowDoneWarn(true);
      return;
    }
    startTransition(async () => {
      await setJobStatusAction(jobId, "klart");
      setShowDoneDialog(true);
    });
  }

  function markDoneAnyway() {
    startTransition(async () => {
      await setJobStatusAction(jobId, "klart");
      setShowDoneWarn(false);
      setShowDoneDialog(true);
    });
  }

  function reopen() {
    startTransition(async () => {
      await reopenJobAction(jobId);
    });
  }

  function remove() {
    startTransition(async () => {
      const kind = await deleteOrArchiveJobAction(jobId);
      setShowRemove(false);
      if (kind === "deleted") router.push("/kunder?flik=uppdrag");
    });
  }

  const quoteRecommended = quoteAction === "skapa_offert";
  const quoteBtn =
    quoteAction === "skapa_offert" ? (
      <ButtonLink href={newQuoteHref} variant={quoteRecommended ? "primary" : "secondary"}>
        Skapa offert
      </ButtonLink>
    ) : quoteAction === "fortsatt_offert" ? (
      <ButtonLink href={quoteHref} variant="secondary">
        Fortsätt offert
      </ButtonLink>
    ) : (
      <ButtonLink href={quoteHref} variant="secondary">
        Visa offert
      </ButtonLink>
    );

  const invoiceBtn = (
    <button
      type="button"
      className={buttonClasses(quoteRecommended ? "secondary" : "accent")}
      onClick={() => openInvoice()}
    >
      <Plus className="size-4" />
      {invoiceAction === "skapa_slutfaktura"
        ? "Skapa slutfaktura"
        : invoiceAction === "skapa_delfaktura"
          ? "Skapa delfaktura"
          : "Skapa faktura"}
    </button>
  );

  return (
    <>
      <PageActions>
        {quoteRecommended ? (
          <>
            {quoteBtn}
            {invoiceBtn}
          </>
        ) : (
          <>
            {invoiceBtn}
            {quoteBtn}
          </>
        )}
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
          {canReopen ? (
            <JobMenuItem
              onSelect={reopen}
              icon={<RotateCcw className="size-4 shrink-0" />}
              label="Återöppna uppdrag"
            />
          ) : null}
          <JobMenuItem
            onSelect={() => setShowRemove(true)}
            icon={
              removal.kind === "delete" ? (
                <Trash2 className="size-4 shrink-0" />
              ) : (
                <Archive className="size-4 shrink-0" />
              )
            }
            label="Ta bort uppdrag"
            danger
          />
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

      <Modal
        open={showDoneWarn}
        onClose={() => setShowDoneWarn(false)}
        title="Markera som klart?"
        size="sm"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setShowDoneWarn(false)}>
              Avbryt
            </button>
            <button
              type="button"
              className={buttonClasses("secondary")}
              onClick={() => {
                setShowDoneWarn(false);
                openInvoice();
              }}
            >
              Skapa faktura
            </button>
            <button type="button" className={buttonClasses("primary")} disabled={isPending} onClick={markDoneAnyway}>
              {isPending ? "Sparar …" : "Markera ändå som klart"}
            </button>
          </div>
        }
      >
        <div className="space-y-2 px-6 py-5 text-[15px] leading-relaxed text-soft">
          <p>Det finns fortfarande sådant som inte är fakturerat eller avslutat.</p>
          <ul className="space-y-1 text-[14px] tabular">
            {completeWarning.remaining > 0 ? (
              <li>Kvar enligt offert {kr(completeWarning.remaining)}</li>
            ) : null}
            {completeWarning.registeredUninvoiced > 0 ? (
              <li>Registrerat ej fakturerat {kr(completeWarning.registeredUninvoiced)}</li>
            ) : null}
            {completeWarning.openDraftCount > 0 ? (
              <li>
                {completeWarning.openDraftCount === 1 ? "Ett utkast" : `${completeWarning.openDraftCount} utkast`}
                {completeWarning.openDraftAmount > 0 ? ` · ${kr(completeWarning.openDraftAmount)}` : ""}
              </li>
            ) : null}
            {completeWarning.unresolvedActionCount > 0 ? (
              <li>
                {completeWarning.unresolvedActionCount === 1
                  ? "En öppen åtgärd"
                  : `${completeWarning.unresolvedActionCount} öppna åtgärder`}
              </li>
            ) : null}
          </ul>
        </div>
      </Modal>

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
            <button type="button" className={buttonClasses("ghost")} onClick={() => setShowDoneDialog(false)}>
              Stäng
            </button>
            <button
              type="button"
              className={buttonClasses("accent")}
              onClick={() => {
                setShowDoneDialog(false);
                openInvoice();
              }}
            >
              Skapa faktura
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showRemove}
        onClose={() => setShowRemove(false)}
        title={removal.kind === "delete" ? "Ta bort uppdraget?" : "Arkivera uppdraget?"}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setShowRemove(false)}>
              Avbryt
            </button>
            <button type="button" className={buttonClasses("danger")} disabled={isPending} onClick={remove}>
              {isPending ? "Sparar …" : removal.kind === "delete" ? "Ta bort" : "Arkivera"}
            </button>
          </div>
        }
      >
        <p className="px-6 py-5 text-[15px] leading-relaxed text-soft">
          {removal.kind === "delete"
            ? "Uppdraget tas bort. Det finns ingen godkänd offert, utfärdad faktura, betalning eller bokföring."
            : `Uppdraget arkiveras och försvinner från Aktiva. ${removal.reasons.join(", ")} påverkas inte.`}
        </p>
      </Modal>

      <JobInvoiceModal
        open={showInvoice}
        onClose={() => {
          setShowInvoice(false);
          setInvoicePreselect(undefined);
        }}
        jobId={jobId}
        jobTitle={jobTitle}
        choice={invoiceChoice}
        preselect={invoicePreselect}
      />
    </>
  );
}

export function JobInvoiceTrigger({
  jobId,
  jobTitle,
  invoiceChoice,
  preselect,
  label = "Skapa faktura",
  variant = "accent",
  size = "md",
}: {
  jobId: string;
  jobTitle: string;
  invoiceChoice: JobInvoiceChoice;
  preselect?: JobInvoiceOptionBasis;
  label?: string;
  variant?: "primary" | "accent" | "secondary";
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonClasses(variant, size)} onClick={() => setOpen(true)}>
        <Plus className="size-3.5" />
        {label}
      </button>
      <JobInvoiceModal
        open={open}
        onClose={() => setOpen(false)}
        jobId={jobId}
        jobTitle={jobTitle}
        choice={invoiceChoice}
        preselect={preselect}
      />
    </>
  );
}
