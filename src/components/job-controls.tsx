"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Flag, PartyPopper, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { buttonClasses, ButtonLink } from "./ui";
import { Modal } from "./modal";
import { ActionMenu, PageActions, actionMenuItemClassName, useActionMenu } from "./action-menu";
import { EditUppdragModal } from "./uppdrag-form";
import { createInvoiceForJobAction, deleteOrArchiveJobAction, setJobStatusAction } from "@/app/actions";
import { reopenJobCloseoutAction } from "@/app/closeout-actions";
import { CloseoutFlow } from "./closeout-flow";
import { JobPhotosModal } from "./job-photos";
import type { CloseoutView } from "@/lib/services/closeout";
import { invoiceEditHref } from "@/lib/nav";
import { kr } from "@/lib/format";
import { jobHeaderPrimary } from "@/lib/job-ui-types";
import type {
  JobCompleteWarning,
  JobInvoiceAction,
  JobInvoiceChoice,
  JobInvoiceOptionBasis,
  JobQuoteAction,
  JobRemovalPolicy,
} from "@/lib/job-ui-types";
import type { JobPhoto } from "@/lib/types";
import type { ReactNode } from "react";
import { JobInvoiceModal } from "./job-invoice-choice";

function JobMenuItem({
  onSelect,
  icon,
  label,
  danger,
  disabled,
  hint,
}: {
  onSelect: () => void;
  icon: ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  hint?: string | null;
}) {
  const menu = useActionMenu();
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      aria-disabled={disabled || undefined}
      title={disabled && hint ? hint : undefined}
      className={
        disabled
          ? `${actionMenuItemClassName({ danger })} cursor-not-allowed opacity-60 hover:bg-transparent`
          : actionMenuItemClassName({ danger })
      }
      onClick={() => {
        if (disabled) return;
        menu?.close();
        onSelect();
      }}
    >
      {icon}
      <span className="min-w-0">
        <span className="block">{label}</span>
        {disabled && hint ? <span className="mt-0.5 block text-[12px] font-normal text-muted">{hint}</span> : null}
      </span>
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
  hasBillable,
  canMarkDone,
  canReopen,
  completeWarning,
  removal,
  quoteHref,
  newQuoteHref,
  invoiceChoice,
  closeout,
  photos,
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
  /** Finns något kvar enligt offerten eller registrerat men ofakturerat. */
  hasBillable: boolean;
  canMarkDone: boolean;
  canReopen: boolean;
  completeWarning: JobCompleteWarning;
  removal: JobRemovalPolicy;
  quoteHref: string;
  newQuoteHref: string;
  invoiceChoice: JobInvoiceChoice;
  /** Underlag för det guidade avslutsflödet. Saknas det faller "Avsluta uppdrag" tillbaka på den enkla dialogen. */
  closeout?: CloseoutView;
  photos: JobPhoto[];
  job: {
    title: string;
    description: string;
    address?: string;
  };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showDoneDialog, setShowDoneDialog] = useState(false);
  const [showDoneWarn, setShowDoneWarn] = useState(false);
  const [showCloseout, setShowCloseout] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [invoicePreselect, setInvoicePreselect] = useState<JobInvoiceOptionBasis | undefined>();
  const [showRemove, setShowRemove] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [photoList, setPhotoList] = useState(photos);
  useEffect(() => {
    setPhotoList(photos);
  }, [photos]);

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
    if (closeout) {
      setShowCloseout(true);
      return;
    }
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
      await reopenJobCloseoutAction(jobId);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const kind = await deleteOrArchiveJobAction(jobId);
      setShowRemove(false);
      if (kind === "deleted") router.push("/uppdrag");
    });
  }

  const invoiceLabel =
    invoiceAction === "skapa_slutfaktura"
      ? "Skapa slutfaktura"
      : invoiceAction === "skapa_delfaktura"
        ? "Skapa delfaktura"
        : "Skapa faktura";

  // Exakt en huvudknapp. Allt annat ligger i "…"-menyn.
  const primary = jobHeaderPrimary({ quoteAction, invoiceAction, hasBillable });
  const primaryBtn =
    primary === "fortsatt_offert" ? (
      <ButtonLink href={quoteHref} variant="primary">
        Fortsätt offert
      </ButtonLink>
    ) : primary === "skapa_offert" ? (
      <ButtonLink href={newQuoteHref} variant="primary">
        Skapa offert
      </ButtonLink>
    ) : primary === "visa_offert" ? (
      <ButtonLink href={quoteHref} variant="primary">
        Visa offert
      </ButtonLink>
    ) : (
      <button type="button" className={buttonClasses("primary")} onClick={() => openInvoice()} data-testid="job-primary-invoice">
        <Plus className="size-4" />
        {invoiceLabel}
      </button>
    );

  return (
    <>
      <PageActions>
        {primaryBtn}
        <ActionMenu>
          {/* Fakturaknappen får bara finnas en gång på sidan: i menyn bara när
              den inte redan är huvudknappen. */}
          {hasBillable && primary !== invoiceAction ? (
            <JobMenuItem
              onSelect={() => openInvoice()}
              icon={<Plus className="size-4 shrink-0" />}
              label={invoiceLabel}
            />
          ) : null}
          {canMarkDone ? (
            <JobMenuItem
              onSelect={markDone}
              icon={<Flag className="size-4 shrink-0" />}
              label="Avsluta uppdrag"
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
            onSelect={() => setShowEdit(true)}
            icon={<Pencil className="size-4 shrink-0" />}
            label="Redigera uppdrag"
          />
          <JobMenuItem
            onSelect={() => setShowPhotos(true)}
            icon={<Camera className="size-4 shrink-0" />}
            label={photoList.length > 0 ? `Foton (${photoList.length})` : "Foton"}
          />
          <JobMenuItem
            onSelect={() => setShowRemove(true)}
            icon={<Trash2 className="size-4 shrink-0" />}
            label="Ta bort"
            danger
            disabled={removal.kind !== "delete"}
            hint={removal.disabledReason}
          />
        </ActionMenu>
      </PageActions>

      <JobPhotosModal
        open={showPhotos}
        onClose={() => setShowPhotos(false)}
        jobId={jobId}
        photos={photoList}
        onPhotosChange={setPhotoList}
      />

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
        title="Ta bort uppdraget?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setShowRemove(false)}>
              Avbryt
            </button>
            <button type="button" className={buttonClasses("danger")} disabled={isPending} onClick={remove}>
              {isPending ? "Sparar …" : "Ta bort"}
            </button>
          </div>
        }
      >
        <p className="px-6 py-5 text-[15px] leading-relaxed text-soft">
          Uppdraget tas bort. Det finns ingen godkänd offert, utfärdad faktura, betalning eller bokföring.
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

      {closeout ? (
        <CloseoutFlow open={showCloseout} onClose={() => setShowCloseout(false)} view={closeout} jobHref={`/uppdrag/${jobId}`} />
      ) : null}
    </>
  );
}