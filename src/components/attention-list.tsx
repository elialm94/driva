"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { AppLink } from "./app-link";
import { useRouter } from "next/navigation";
import {
  Inbox,
  Clock,
  AlertCircle,
  Receipt,
  HelpCircle,
  FileText,
  Landmark,
  CalendarClock,
  Percent,
  Bell,
  Check,
  Download,
  Upload,
  Send,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  Trash2,
  XCircle,
} from "lucide-react";
import { DateField } from "./date-field";
import { Modal } from "./modal";
import { actionMenuItemClassName } from "./action-menu";
import { buttonClasses, Card, cx, SectionTitle } from "./ui";
import {
  answerExpenseQuestionAction,
  completeReminderAction,
  createNextInvoiceForJobAction,
  createPaymentFileAction,
  deliverInvoiceAction,
  dismissReminderAction,
  followUpQuoteAction,
  markQuoteNotRelevantAction,
  sendReminderAction,
  snoozeAttentionAction,
  snoozeReminderAction,
  uploadReceiptAction,
  prepareSupplierPaymentAction,
} from "@/app/actions";
import { requestClientInformationAction } from "@/app/collaboration-actions";
import { isPaymentDetailsCta, PaymentDetailsCta } from "./payment-details-actions";
import {
  confirmPaymentMatchAction,
  confirmRotPayoutAction,
  registerCreditRefundAction,
} from "@/app/bokforing-actions";
import { invoiceHref } from "@/lib/nav";
import type { ActionConfirm, BusinessAction } from "@/lib/services/actions";
import {
  actionResolveHref,
  ATTENTION_SNOOZE_PRESETS,
  controlsForAction,
  sourceForAction,
  type ActionControls,
  type AttentionSnoozeChoice,
} from "@/lib/services/action-issue";

/**
 * Renderar åtgärdsmotorns BusinessAction-rader med rätt knapp per CTA-typ.
 * Samma komponent på Hem och Bokföring – en enda definition av "att göra".
 *
 * Kontrollerna per rad (Visa X / Snooza / avfärdan) kommer ur den centrala
 * deklarationen i services/action-issue.ts – ingen sidspecifik hårdkodning:
 *   * Primärknappen säger exakt vad som händer ("Skicka påminnelse", aldrig
 *     "Följ upp"). Skickar den externt eller bokför pengar levererar motorn
 *     bekräftelseinnehåll (action.confirm) och dialogen visas FÖRE utförandet.
 *   * Snooze är ren presentation: raden döljs ur listan och räknaren tills
 *     tidpunkten passerat – domänstatus ändras aldrig (fakturan förblir sen).
 *   * Avfärdan är typspecifik domänövergång (t.ex. "Inte aktuell" på offert,
 *     "Inte aktuell" på offert, "Ta bort" på påminnelse) – aldrig ett
 *     universellt "dölj för alltid".
 */

const ICONS = {
  inbox: { icon: Inbox, cls: "bg-info-soft text-info" },
  clock: { icon: Clock, cls: "bg-warn-soft text-warn" },
  alert: { icon: AlertCircle, cls: "bg-danger-soft text-danger" },
  receipt: { icon: Receipt, cls: "bg-warn-soft text-warn" },
  question: { icon: HelpCircle, cls: "bg-info-soft text-info" },
  invoice: { icon: FileText, cls: "bg-accent-soft text-accent-deep" },
  bank: { icon: Landmark, cls: "bg-info-soft text-info" },
  calendar: { icon: CalendarClock, cls: "bg-warn-soft text-warn" },
  percent: { icon: Percent, cls: "bg-ok-soft text-ok" },
  bell: { icon: Bell, cls: "bg-accent-soft text-accent-deep" },
} as const;

/** Snooza-etikett → klar-text ("Uppskjuten – imorgon"). */
function snoozeDoneText(label: string): string {
  return `Uppskjuten – ${label.toLowerCase()}`;
}

/** Första giltiga snooze-dagen: valt datum blir 00:00, så idag är redan passerat. */
function minSnoozeIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* --------------------------------- Bekräftelse --------------------------------- */

/**
 * Bekräftelsedialog före externa utskick och pengabokningar. Innehållet
 * (rubrik, sammanfattningsrader, mottagare, knappetikett) kommer från motorn
 * (action.confirm) eller byggs lokalt för lätta domänavfärdanden.
 */
function ConfirmDialog({
  open,
  onClose,
  confirm,
  note,
  danger,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  confirm: ActionConfirm;
  note?: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={confirm.title}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={cx(buttonClasses("ghost", "sm"), "max-lg:min-h-11")} onClick={onClose}>
            Avbryt
          </button>
          <button
            type="button"
            className={cx(buttonClasses(danger ? "danger" : "primary", "sm"), "max-lg:min-h-11")}
            onClick={onConfirm}
          >
            {confirm.confirmLabel}
          </button>
        </div>
      }
    >
      <div className="px-6 py-4">
        <dl className="space-y-2">
          {confirm.rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-4 text-[14px]">
              <dt className="shrink-0 text-muted">{row.label}</dt>
              <dd className="min-w-0 text-right font-medium text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
        {note ? <p className="mt-3 text-[13px] leading-relaxed text-soft">{note}</p> : null}
      </div>
    </Modal>
  );
}

/* ----------------------------------- Overflow ----------------------------------- */

type RowRun = (fn: () => Promise<unknown>, doneText: string) => void;

/**
 * ⋯-menyn per rad: Visa X, Snooza (presets + Välj datum) och typspecifik
 * avfärdan. Desktop: kompakt popover. Mobil: bottensheet via Modal så
 * träffytorna blir stora. Vad som får visas styrs av controlsForAction.
 */
function RowMenu({
  item,
  controls,
  disabled,
  run,
}: {
  item: BusinessAction;
  controls: ActionControls;
  disabled: boolean;
  run: RowRun;
}) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [view, setView] = useState<"menu" | "snooze">("menu");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const dateAnchorRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const isReminder = controls.kind === "reminder";
  const source = sourceForAction(item);
  const viewHref = actionResolveHref(item);
  const showView = item.href !== "/";

  function close() {
    setOpen(false);
    setView("menu");
    setDatePickerOpen(false);
  }

  function openMenu() {
    setSheet(typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches);
    setView("menu");
    setDatePickerOpen(false);
    setOpen(true);
  }

  useEffect(() => {
    if (!open || sheet) return;
    function onPointer(e: PointerEvent) {
      const target = e.target;
      const el = target instanceof Element ? target : (target as Node | null)?.parentElement;
      if (rootRef.current?.contains(target as Node)) return;
      if (el?.closest('[role="dialog"][aria-label="Välj datum"]')) return;
      close();
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
  }, [open, sheet]);

  function snooze(choice: AttentionSnoozeChoice, doneText: string) {
    close();
    run(() => snoozeAttentionAction(item.id, choice), doneText);
  }

  function dismiss() {
    close();
    if (controls.dismissBehavior === "MARK_NOT_RELEVANT" && source?.kind === "quote") {
      run(() => markQuoteNotRelevantAction(source.id), "Markerad som inte aktuell");
    } else if (controls.dismissBehavior === "DISMISS_REMINDER" && source?.kind === "reminder") {
      run(() => dismissReminderAction(source.id), "Borttagen");
    }
  }

  // Menyalternativ – stora träffytor i sheeten, kompakta i popovern.
  const itemCls = (opts?: { danger?: boolean }) =>
    sheet
      ? cx(
          "flex w-full min-h-12 items-center gap-2.5 px-6 py-3 text-left text-[15px] font-medium transition-colors hover:bg-canvas",
          opts?.danger ? "text-danger" : "text-ink"
        )
      : actionMenuItemClassName(opts);

  const menuItems = (
    <>
      {view === "menu" ? (
        <>
          {showView ? (
            <AppLink href={viewHref} role="menuitem" className={itemCls()} onClick={() => close()}>
              {controls.viewLabel}
            </AppLink>
          ) : null}
          {controls.canSnooze && !isReminder ? (
            <button type="button" role="menuitem" className={itemCls()} onClick={() => setView("snooze")}>
              <Clock className="size-3.5 shrink-0" /> Snooza
            </button>
          ) : null}
          {controls.canDismiss && controls.dismissLabel && source ? (
            <button
              type="button"
              role="menuitem"
              className={itemCls({ danger: controls.dismissBehavior === "DISMISS_REMINDER" })}
              disabled={disabled}
              onClick={() => {
                if (controls.dismissNeedsConfirm) {
                  close();
                  setConfirmDismiss(true);
                } else {
                  dismiss();
                }
              }}
            >
              {controls.dismissBehavior === "HIDE" ? <Check className="size-3.5 shrink-0" /> : null}
              {controls.dismissBehavior === "MARK_NOT_RELEVANT" ? <XCircle className="size-3.5 shrink-0" /> : null}
              {controls.dismissBehavior === "DISMISS_REMINDER" ? <Trash2 className="size-3.5 shrink-0" /> : null}
              {controls.dismissLabel}
            </button>
          ) : null}
        </>
      ) : (
        <>
          {ATTENTION_SNOOZE_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              role="menuitem"
              className={itemCls()}
              disabled={disabled}
              onClick={() => snooze(preset.key, snoozeDoneText(preset.label))}
            >
              {preset.label}
            </button>
          ))}
          <button
            ref={dateAnchorRef}
            type="button"
            role="menuitem"
            className={itemCls()}
            aria-haspopup="dialog"
            aria-expanded={datePickerOpen}
            onClick={() => setDatePickerOpen((v) => !v)}
          >
            Välj datum …
          </button>
          <DateField
            open={datePickerOpen}
            onOpenChange={setDatePickerOpen}
            anchorRef={dateAnchorRef}
            min={minSnoozeIso()}
            onChange={(iso) => {
              if (iso) snooze({ date: iso }, "Uppskjuten");
            }}
          />
          <button
            type="button"
            role="menuitem"
            className={cx(itemCls(), "text-soft")}
            onClick={() => {
              setDatePickerOpen(false);
              setView("menu");
            }}
          >
            Tillbaka
          </button>
        </>
      )}
    </>
  );

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Fler alternativ för ${item.title}`}
        className={cx(
          "flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-ink/5 hover:text-ink max-lg:min-h-11 max-lg:min-w-11",
          open && "bg-ink/5 text-ink"
        )}
        onClick={() => (open ? close() : openMenu())}
      >
        <MoreHorizontal className="size-4.5" />
      </button>

      {/* Desktop-popover */}
      {open && !sheet ? (
        <div
          id={menuId}
          role="menu"
          aria-label={`Alternativ för ${item.title}`}
          className="absolute right-0 top-full z-30 mt-1.5 min-w-[13rem] overflow-hidden rounded-xl border border-line bg-card p-1 shadow-pop"
        >
          {view === "snooze" ? (
            <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Visa igen …
            </p>
          ) : null}
          {menuItems}
        </div>
      ) : null}

      {/* Mobil bottensheet */}
      {sheet ? (
        <Modal open={open} onClose={close} title={view === "snooze" ? "Snooza – visa igen …" : item.title}>
          <div className="py-2" role="menu" aria-label={`Alternativ för ${item.title}`}>
            {menuItems}
          </div>
        </Modal>
      ) : null}

      {/* Lätt bekräftelse för domänavfärdan som ändrar status (offert → avböjd). */}
      <ConfirmDialog
        open={confirmDismiss}
        onClose={() => setConfirmDismiss(false)}
        confirm={{
          title: "Markera som inte aktuell?",
          rows: [{ label: "Offert", value: item.title }],
          confirmLabel: "Inte aktuell",
        }}
        note="Offerten markeras som avböjd men ligger kvar i registret och kundhistoriken. Den försvinner från Behöver din uppmärksamhet."
        danger
        onConfirm={() => {
          setConfirmDismiss(false);
          dismiss();
        }}
      />
    </div>
  );
}

/* ------------------------------------ Rader ------------------------------------ */

/**
 * Klar/Snooza för påminnelser. Textknappar (aldrig bara ikoner) och ≥44px
 * träffyta på mobil. Snooza: 1 timme / Imorgon / Välj tid (samma datumväljare
 * som resten av appen; valt datum behåller påminnelsens klockslag).
 * "Ta bort" ligger i radens ⋯-meny. Snoozen här är påminnelsens EGEN
 * domänsnooze (reminders-tjänsten) – inte attention_states.
 */
function ReminderCtas({ reminderId, onDone }: { reminderId: string; onDone: (doneText: string) => void }) {
  const [isPending, startTransition] = useTransition();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [pickDate, setPickDate] = useState(false);
  const router = useRouter();

  function run(fn: () => Promise<unknown>, doneText: string) {
    startTransition(async () => {
      await fn();
      onDone(doneText);
      router.refresh();
    });
  }

  if (pickDate) {
    return (
      <div className="flex items-center gap-2">
        <DateField
          className="w-40"
          placeholder="Välj dag"
          onChange={(iso) => {
            if (iso) run(() => snoozeReminderAction(reminderId, { date: iso }), "Uppskjuten");
          }}
        />
        <button
          type="button"
          className={cx(buttonClasses("ghost", "sm"), "max-lg:min-h-11")}
          onClick={() => {
            setPickDate(false);
            setSnoozeOpen(false);
          }}
        >
          Avbryt
        </button>
      </div>
    );
  }

  if (snoozeOpen) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={cx(buttonClasses("secondary", "sm"), "max-lg:min-h-11")}
          disabled={isPending}
          onClick={() => run(() => snoozeReminderAction(reminderId, "1h"), "Uppskjuten 1 timme")}
        >
          1 timme
        </button>
        <button
          type="button"
          className={cx(buttonClasses("secondary", "sm"), "max-lg:min-h-11")}
          disabled={isPending}
          onClick={() => run(() => snoozeReminderAction(reminderId, "imorgon"), "Uppskjuten till imorgon")}
        >
          Imorgon
        </button>
        <button
          type="button"
          className={cx(buttonClasses("secondary", "sm"), "max-lg:min-h-11")}
          disabled={isPending}
          onClick={() => setPickDate(true)}
        >
          Välj tid
        </button>
        <button
          type="button"
          className={cx(buttonClasses("ghost", "sm"), "max-lg:min-h-11")}
          onClick={() => setSnoozeOpen(false)}
        >
          Avbryt
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")}
        disabled={isPending}
        onClick={() => run(() => completeReminderAction(reminderId), "Klar")}
      >
        {isPending ? "Sparar …" : "Klar"}
      </button>
      <button
        type="button"
        className={cx(buttonClasses("secondary", "sm"), "max-lg:min-h-11")}
        disabled={isPending}
        onClick={() => setSnoozeOpen(true)}
      >
        Snooza
      </button>
    </>
  );
}

function AttentionRow({
  item,
  onResolved,
  surface = "owner",
}: {
  item: BusinessAction;
  onResolved: (id: string) => void;
  surface?: "owner" | "accountant";
}) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Skapad bankfil: raden är löst men nedladdningen ska vara ett klick bort.
  const [createdFile, setCreatedFile] = useState<{ fileId: string; filename: string } | null>(null);
  const router = useRouter();
  const { icon: Icon, cls } = ICONS[item.icon];
  const cta = item.cta;
  const controls = controlsForAction(item);

  function finish(doneText: string) {
    setDone(doneText);
    onResolved(item.id);
  }

  function run(fn: () => Promise<unknown>, doneText: string) {
    startTransition(async () => {
      await fn();
      finish(doneText);
      router.refresh();
    });
  }

  /** Primärknapp som kräver bekräftelse öppnar dialogen; utan confirm körs direkt. */
  function confirmable(execute: () => void) {
    if (item.confirm) setConfirmOpen(true);
    else execute();
  }

  // Vad bekräftelseknappen faktiskt utför – per CTA-typ.
  function executePrimary() {
    if (!cta) return;
    if (cta.type === "remindInvoice") {
      startTransition(async () => {
        const result = await sendReminderAction(cta.invoiceId);
        if (result && result.ok === false) setError(result.errors.join(" "));
        else finish("Påminnelse skickad");
        router.refresh();
      });
    }
    if (cta.type === "followUpQuote") {
      startTransition(async () => {
        const result = await followUpQuoteAction(cta.quoteId);
        if (result && result.ok === false) setError(result.errors.join(" "));
        else finish("Påminnelse skickad");
        router.refresh();
      });
    }
    if (cta.type === "createPaymentFile") {
      startTransition(async () => {
        const result = await createPaymentFileAction({ supplierInvoiceIds: [cta.supplierInvoiceId] });
        if (result.ok === false) {
          setError(result.problems.join(" "));
        } else {
          setCreatedFile({ fileId: result.fileId, filename: result.filename });
          finish("Bankfil skapad – ladda upp den i internetbanken och godkänn betalningen där");
        }
        router.refresh();
      });
    }
    if (cta.type === "retryInvoiceEmail") {
      startTransition(async () => {
        const result = await deliverInvoiceAction(cta.invoiceId);
        if (result.ok === false) setError(result.errors.join(" "));
        else finish("Skickad");
        router.refresh();
      });
    }
    if (cta.type === "registerCreditRefund") {
      startTransition(async () => {
        const result = await registerCreditRefundAction(cta.invoiceId, cta.txId);
        if (result.ok === false) setError(result.error);
        else finish("Återbetalning bokförd");
        router.refresh();
      });
    }
  }

  const compact = surface === "accountant";
  const body = (
    <div className="min-w-0 flex-1">
      {item.clientName ? (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{item.clientName}</p>
      ) : null}
      <p className={cx("font-medium text-ink max-sm:line-clamp-2 sm:truncate", compact ? "text-[14px]" : "text-[15px]")}>
        {item.title}
      </p>
      <p className={cx("text-soft", compact ? "mt-0.5 text-[12px] leading-snug" : "mt-0.5 text-sm leading-relaxed")}>
        {item.subtitle}
      </p>
    </div>
  );

  const sendIcon = <Send className="size-3.5" />;

  return (
    <div
      data-action-id={item.id}
      tabIndex={-1}
      className={cx(
        "flex flex-col outline-none transition-colors first:rounded-t-[calc(1.25rem-1px)] last:rounded-b-[calc(1.25rem-1px)] hover:bg-canvas/60 focus:bg-canvas/80 sm:flex-row sm:items-start",
        compact ? "gap-2 px-3.5 py-2.5 sm:gap-3" : "gap-3 px-5 py-4 sm:gap-4"
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className={cx("mt-0.5 flex shrink-0 items-center justify-center rounded-xl", compact ? "size-7" : "size-9", cls)}>
          <Icon className="size-4.5" />
        </div>
        <AppLink href={item.href} className="min-w-0 flex-1">
          {body}
        </AppLink>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-13 sm:justify-end sm:pl-0">
        {done ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-ok">
              <Check className="size-4" /> {done}
            </span>
            {createdFile ? (
              <a href={`/api/betalfil/${createdFile.fileId}`} download className={buttonClasses("secondary", "sm")}>
                <Download className="size-3.5" /> Ladda ned bankfilen
              </a>
            ) : null}
          </span>
        ) : (
          <>
            {cta?.type === "link" ? (
              <AppLink href={cta.href} className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")} aria-label={`${cta.label} – ${item.title}`}>
                {cta.label}
              </AppLink>
            ) : null}
            {cta?.type === "pickPaymentMatch" ? (
              <AppLink href={item.href} className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")} aria-label={`Matcha betalning – ${item.title}`}>
                Matcha betalning
              </AppLink>
            ) : null}
            {cta?.type === "followUpQuote" && surface !== "accountant" ? (
              <button
                className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")}
                disabled={isPending}
                aria-label={`${cta.label} – ${item.title}`}
                onClick={() => confirmable(executePrimary)}
              >
                {sendIcon}
                {isPending ? "Skickar …" : cta.label}
              </button>
            ) : null}
            {cta?.type === "remindInvoice" && surface !== "accountant" ? (
              <button
                className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")}
                disabled={isPending}
                aria-label={`${cta.label} – ${item.title}`}
                onClick={() => confirmable(executePrimary)}
              >
                {sendIcon}
                {isPending ? "Skickar …" : cta.label}
              </button>
            ) : null}
            {cta?.type === "retryInvoiceEmail" && surface !== "accountant" ? (
              <button
                className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")}
                disabled={isPending}
                aria-label={`${cta.label} – ${item.title}`}
                onClick={() => confirmable(executePrimary)}
              >
                {sendIcon}
                {isPending ? "Skickar …" : cta.label}
              </button>
            ) : null}
            {cta?.type === "createPaymentFile" && surface === "accountant" ? (
              // Konsulten FÖRBEREDER betalningen – bankfilen skapas av ägaren
              // (kräver submit_bank_payment, se collaboration/permissions.ts).
              <button
                className={cx(buttonClasses("secondary", "sm"), "max-lg:min-h-11")}
                disabled={isPending}
                aria-label={`Förbered betalning – ${item.title}`}
                onClick={() =>
                  startTransition(async () => {
                    const result = await prepareSupplierPaymentAction({
                      supplierInvoiceId: cta.supplierInvoiceId,
                    });
                    if (result.ok === false) setError(result.error);
                    else finish("Förberedd – ägaren skapar bankfilen");
                    router.refresh();
                  })
                }
              >
                {isPending ? "Förbereder …" : "Förbered betalning"}
              </button>
            ) : null}
            {cta?.type === "createPaymentFile" && surface !== "accountant" ? (
              <button
                className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")}
                disabled={isPending}
                aria-label={`${cta.label} – ${item.title}`}
                onClick={() => confirmable(executePrimary)}
              >
                {isPending ? "Skapar …" : cta.label}
              </button>
            ) : null}
            {cta?.type === "registerCreditRefund" ? (
              <button
                className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")}
                disabled={isPending}
                aria-label={`${cta.label} – ${item.title}`}
                onClick={() => confirmable(executePrimary)}
              >
                {isPending ? "Bokför …" : cta.label}
              </button>
            ) : null}
            {cta?.type === "uploadReceipt" ? (
              <label className={cx(buttonClasses("primary", "sm"), "cursor-pointer max-lg:min-h-11")}>
                <Upload className="size-3.5" />
                {isPending ? "Läser av …" : cta.label}
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  disabled={isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    run(() => uploadReceiptAction(cta.expenseId, file?.name ?? "kvitto.jpg"), "Matchat och bokfört");
                  }}
                />
              </label>
            ) : null}
            {surface === "accountant" && cta?.type === "uploadReceipt" ? (
              <button
                type="button"
                className={cx(buttonClasses("secondary", "sm"), "max-lg:min-h-11")}
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await requestClientInformationAction({ expenseId: cta.expenseId });
                    if (result.ok === false) setError(result.error);
                    else finish("Kunden ombeds lägga till kvitto");
                    router.refresh();
                  })
                }
              >
                Be kunden
              </button>
            ) : null}
            {cta?.type === "answerQuestion"
              ? cta.options.map((opt, oi) => (
                  <button
                    key={opt}
                    data-choice-index={oi + 1}
                    className={cx(buttonClasses("secondary", "sm"), compact ? "h-8 text-[12px]" : "max-lg:min-h-11")}
                    disabled={isPending}
                    onClick={() => run(() => answerExpenseQuestionAction(cta.expenseId, opt), "Bokfört")}
                  >
                    {opt}
                  </button>
                ))
              : null}
            {cta?.type === "confirmPaymentMatch" ? (
              <button
                className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")}
                disabled={isPending}
                aria-label={`${cta.label} – ${item.title}`}
                onClick={() =>
                  startTransition(async () => {
                    const result = await confirmPaymentMatchAction(cta.txId, cta.invoiceId);
                    if (result.ok === false) setError(result.error);
                    else finish("Bokförd");
                    router.refresh();
                  })
                }
              >
                {isPending ? "Bokför …" : cta.label}
              </button>
            ) : null}
            {cta?.type === "confirmRotPayout" ? (
              <button
                className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")}
                disabled={isPending}
                aria-label={`${cta.label} – ${item.title}`}
                onClick={() =>
                  startTransition(async () => {
                    const result = await confirmRotPayoutAction(cta.txId);
                    if (result.ok === false) setError(result.error);
                    else finish("Bokförd");
                    router.refresh();
                  })
                }
              >
                {isPending ? "Bokför …" : cta.label}
              </button>
            ) : null}
            {cta && isPaymentDetailsCta(cta) ? (
              // Betalningsuppgifter: egna dialoger (formulär/bekräftelse/kö) –
              // motorns confirm-innehåll återanvänds, inga externa effekter
              // utan explicit godkännande.
              <PaymentDetailsCta cta={cta} title={item.title} confirm={item.confirm} surface={surface} onDone={finish} />
            ) : null}
            {cta?.type === "reminderActions" ? <ReminderCtas reminderId={cta.reminderId} onDone={finish} /> : null}
            {cta?.type === "createJobInvoice" && surface !== "accountant" ? (
              <button
                className={cx(buttonClasses("accent", "sm"), "max-lg:min-h-11")}
                disabled={isPending}
                aria-label={`${cta.label} – ${item.title}`}
                onClick={() =>
                  startTransition(async () => {
                    const invoiceId = await createNextInvoiceForJobAction(cta.jobId);
                    router.push(invoiceHref(invoiceId, { href: `/uppdrag/${cta.jobId}` }) as never);
                  })
                }
              >
                {isPending ? "Skapar …" : cta.label}
              </button>
            ) : null}
            {error ? <span className="text-[13px] font-medium text-danger">{error}</span> : null}
            <RowMenu item={item} controls={controls} disabled={isPending} run={run} />
          </>
        )}
      </div>

      {/* Bekräftelse före externa utskick / pengabokningar – innehåll från motorn. */}
      {item.confirm ? (
        <ConfirmDialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          confirm={item.confirm}
          onConfirm={() => {
            setConfirmOpen(false);
            executePrimary();
          }}
        />
      ) : null}
    </div>
  );
}

/* ----------------------------------- Sektionen ----------------------------------- */

/** Expansionens steg: initialt ~5 → upp till 15 → allt. Ren presentation. */
const EXPAND_CAP = 15;

/**
 * "Behöver din uppmärksamhet" som helhet: rubrik med diskret räknare (aktiva,
 * ej snoozade – snoozade är redan bortfiltrerade i motorn), kortet med rader
 * och en fullbreddsfot i kortet som expanderar listan på plats (ingen egen
 * sida, ingen paginering). Räknaren uppdateras direkt när en rad löses lokalt.
 */
export function AttentionSection({
  title,
  items,
  initialVisible,
  empty,
  surface = "owner",
}: {
  title: string;
  items: BusinessAction[];
  initialVisible?: number;
  empty?: ReactNode;
  surface?: "owner" | "accountant";
}) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [resolvedIds, setResolvedIds] = useState<readonly string[]>([]);
  const sectionRef = useRef<HTMLDivElement>(null);

  const activeCount = items.filter((i) => !resolvedIds.includes(i.id)).length;

  const initial = Math.min(initialVisible ?? items.length, items.length);
  const cap = stage === 0 ? initial : stage === 1 ? EXPAND_CAP : items.length;
  const visible = items.slice(0, cap);

  function collapse() {
    setStage(0);
    // Håll läsaren kvar vid sektionen när listan krymper.
    requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ block: "nearest" }));
  }

  let footer: ReactNode = null;
  if (items.length > initial) {
    if (stage === 0) {
      const revealed = Math.min(items.length, EXPAND_CAP) - initial;
      footer = (
        <FooterButton
          expanded={false}
          label={`Visa ${revealed} till`}
          ariaLabel={`Visa ytterligare ${revealed} saker som behöver din uppmärksamhet`}
          onClick={() => setStage(1)}
        />
      );
    } else if (stage === 1 && items.length > EXPAND_CAP) {
      footer = (
        <FooterButton
          expanded
          label={`Visa alla ${items.length}`}
          ariaLabel={`Visa alla ${items.length} saker som behöver din uppmärksamhet`}
          onClick={() => setStage(2)}
        />
      );
    } else {
      footer = <FooterButton expanded label="Visa färre" ariaLabel="Visa färre rader" onClick={collapse} />;
    }
  }

  return (
    <div ref={sectionRef}>
      <SectionTitle>
        {title}
        {activeCount > 0 ? (
          <span className="font-medium text-muted/70 tabular-nums" aria-label={`${activeCount} saker`}>
            {" "}
            · {activeCount}
          </span>
        ) : null}
      </SectionTitle>
      {items.length === 0 ? (
        (empty ?? null)
      ) : (
        <div className="card divide-y divide-line/70">
          {visible.map((item) => (
            <AttentionRow
              key={item.id}
              item={item}
              surface={surface}
              onResolved={(id) => setResolvedIds((prev) => [...prev, id])}
            />
          ))}
          {footer}
        </div>
      )}
    </div>
  );
}

function FooterButton({
  expanded,
  label,
  ariaLabel,
  onClick,
}: {
  expanded: boolean;
  label: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={ariaLabel}
      onClick={onClick}
      className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-b-[calc(1.25rem-1px)] px-5 py-3 text-[13px] font-medium text-soft transition-colors hover:bg-canvas/60 hover:text-ink"
    >
      {label}
      {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
    </button>
  );
}

/** Standardtomläge – "allt är under kontroll"-kortet från Hem. */
export function AttentionEmptyCard() {
  return (
    <Card className="px-6 py-5">
      <p className="text-[15px] font-medium text-ink">✓ Allt är under kontroll</p>
      <p className="mt-1 text-[14px] text-soft">
        Driva håller koll och säger till när något behöver din uppmärksamhet.
      </p>
    </Card>
  );
}
