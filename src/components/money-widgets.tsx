"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Check, Banknote, FilePlus2, Undo2, Send } from "lucide-react";
import { actionMenuItemClassName, useActionMenu, type ActionAppearance } from "./action-menu";
import { Modal } from "./modal";
import { buttonClasses, cx, DemoTag } from "./ui";
import {
  answerExpenseQuestionAction,
  createPartInvoiceAction,
  creditInvoiceAction,
  deliverInvoiceAction,
  discardInvoiceAction,
  followUpQuoteAction,
  paySupplierInvoiceAction,
  simulatePaymentAction,
  sendReminderAction,
  uploadReceiptAction,
  uploadStandaloneReceiptAction,
} from "@/app/actions";
import { invoiceHref } from "@/lib/nav";
import { DeliveryChannelPicker } from "./delivery-channel-picker";

export function UploadReceiptButton({ expenseId, label = "Lägg till kvitto" }: { expenseId?: string; label?: string }) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-medium text-ok">
        <Check className="size-4" /> Matchat & bokfört
      </span>
    );
  }
  // Utan expenseId finns ingen banktransaktion att läsa fakta ur – i demon
  // skapas då ett exempelköp. Det får aldrig se ut som riktig kvittotolkning.
  return (
    <label
      className={cx(buttonClasses(expenseId ? "primary" : "secondary", "sm"), "cursor-pointer")}
      title={
        expenseId
          ? undefined
          : "Demo: ett exempelköp skapas och bokförs. Riktig kvittotolkning är inte inkopplad ännu."
      }
    >
      {expenseId ? <Upload className="size-3.5" /> : <DemoTag>DEMO</DemoTag>}
      {isPending ? "Läser av …" : expenseId ? label : "Läs av exempelkvitto"}
      <input
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        disabled={isPending}
        onChange={(e) => {
          const name = e.target.files?.[0]?.name ?? "kvitto.jpg";
          startTransition(async () => {
            if (expenseId) {
              await uploadReceiptAction(expenseId, name);
              setDone(true);
            } else {
              await uploadStandaloneReceiptAction(name);
            }
          });
        }}
      />
    </label>
  );
}

export function ExpenseQuestionButtons({ expenseId, options }: { expenseId: string; options: string[] }) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-medium text-ok">
        <Check className="size-4" /> Bokfört
      </span>
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          className={buttonClasses("secondary", "sm")}
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await answerExpenseQuestionAction(expenseId, opt);
              setDone(true);
            })
          }
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

export function PaySupplierButton({ supplierInvoiceId }: { supplierInvoiceId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      className={buttonClasses("secondary", "sm")}
      disabled={isPending}
      onClick={() => startTransition(async () => paySupplierInvoiceAction(supplierInvoiceId))}
      title="Demoläge: simulerar att banken redan har dragit pengarna"
    >
      <Banknote className="size-3.5" />
      {isPending ? "Betalar …" : "Simulera betald"}
      <DemoTag />
    </button>
  );
}

export function SimulatePaymentButton({
  invoiceId,
  appearance = "button",
}: {
  invoiceId: string;
  appearance?: ActionAppearance;
}) {
  const [isPending, startTransition] = useTransition();
  const menu = useActionMenu();
  const inMenu = appearance === "menu";
  return (
    <button
      type="button"
      role={inMenu ? "menuitem" : undefined}
      className={inMenu ? actionMenuItemClassName() : buttonClasses("secondary", "sm")}
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          menu?.close();
          await simulatePaymentAction(invoiceId);
        })
      }
      title="Simulerar att betalningen dyker upp på banken – matchning och bokföring körs på riktigt"
    >
      <Banknote className="size-3.5 shrink-0" />
      <span className="flex-1">{isPending ? "Betalning på väg in …" : "Simulera inbetalning"}</span>
      <DemoTag>{inMenu ? "DEMO" : "Demo"}</DemoTag>
    </button>
  );
}

/**
 * Skickar en påminnelse om offerten via e-post – etiketten säger vad som
 * händer ("Skicka påminnelse", aldrig "Följ upp") och bekräftelsedialogen
 * visas FÖRE utskicket. Inget mejl går från ett rent knappklick.
 */
export function FollowUpButton({ quoteId }: { quoteId: string }) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-medium text-ok">
        <Check className="size-4" /> Påminnelse skickad
      </span>
    );
  }
  return (
    <>
      <button
        className={buttonClasses("secondary", "sm")}
        disabled={isPending}
        onClick={() => {
          setError(null);
          setConfirmOpen(true);
        }}
      >
        <Send className="size-3.5" />
        {isPending ? "Skickar …" : "Skicka påminnelse"}
      </button>
      <Modal
        open={confirmOpen}
        onClose={() => !isPending && setConfirmOpen(false)}
        title="Skicka påminnelse?"
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className={cx(buttonClasses("ghost", "sm"), "max-lg:min-h-11")}
              disabled={isPending}
              onClick={() => setConfirmOpen(false)}
            >
              Avbryt
            </button>
            <button
              type="button"
              className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")}
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await followUpQuoteAction(quoteId);
                  if (result && result.ok === false) {
                    setError(result.errors.join(" ") || "Påminnelsen kunde inte skickas. Försök igen.");
                    return;
                  }
                  setConfirmOpen(false);
                  setDone(true);
                });
              }}
            >
              <Send className="size-3.5" /> {isPending ? "Skickar …" : error ? "Försök igen" : "Skicka påminnelse"}
            </button>
          </div>
        }
      >
        <p className="px-6 py-4 text-[14px] leading-relaxed text-soft">
          Kunden får ett mejl med en påminnelse om offerten och länken där den kan signeras eller avböjas.
        </p>
        {error ? <p className="px-6 pb-4 text-[13px] font-medium text-danger">{error}</p> : null}
      </Modal>
    </>
  );
}

export function CreatePartInvoiceButton({
  quoteId,
  partIndex,
  label,
  returnTo,
  returnLabel,
}: {
  quoteId: string;
  partIndex: number;
  label: string;
  returnTo?: string;
  returnLabel?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      className={buttonClasses("accent", "sm")}
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const id = await createPartInvoiceAction(quoteId, partIndex);
          router.push(
            invoiceHref(id, {
              href: returnTo ?? `/ekonomi/offerter/${quoteId}`,
              label: returnLabel ?? "Offert",
            }) as never
          );
        })
      }
    >
      <FilePlus2 className="size-3.5" />
      {isPending ? "Skapar …" : label}
    </button>
  );
}

export function CreditInvoiceButton({
  invoiceId,
  appearance = "button",
}: {
  invoiceId: string;
  appearance?: ActionAppearance;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menu = useActionMenu();
  const inMenu = appearance === "menu";

  function startConfirm() {
    menu?.close();
    setError(null);
    setConfirming(true);
  }

  function confirm() {
    startTransition(async () => {
      const result = await creditInvoiceAction(invoiceId);
      if (result && result.ok === false) setError(result.error);
    });
  }

  const trigger = (
    <button
      type="button"
      role={inMenu ? "menuitem" : undefined}
      className={inMenu ? actionMenuItemClassName() : buttonClasses("ghost", "sm")}
      onClick={startConfirm}
    >
      <Undo2 className="size-3.5 shrink-0" /> Kreditera
    </button>
  );

  if (inMenu) {
    return (
      <>
        {trigger}
        <Modal open={confirming} onClose={() => !isPending && setConfirming(false)} size="sm" title="Kreditera faktura?">
          <div className="px-6 py-5">
            <p className="text-[15px] leading-relaxed text-soft">Kreditera hela fakturan? Delkredit stöds inte.</p>
            {error ? <p className="mt-3 text-[13px] font-medium text-danger">{error}</p> : null}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button className={buttonClasses("secondary")} disabled={isPending} onClick={() => setConfirming(false)}>
                Avbryt
              </button>
              <button className={buttonClasses("danger")} disabled={isPending} onClick={confirm}>
                {isPending ? "Krediterar …" : "Ja, kreditera"}
              </button>
            </div>
          </div>
        </Modal>
      </>
    );
  }

  if (!confirming) return trigger;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] text-soft">Kreditera hela fakturan? Delkredit stöds inte.</span>
      <button className={buttonClasses("danger", "sm")} disabled={isPending} onClick={confirm}>
        {isPending ? "Krediterar …" : "Ja, kreditera"}
      </button>
      <button className={buttonClasses("ghost", "sm")} onClick={() => setConfirming(false)}>
        Avbryt
      </button>
      {error ? <span className="w-full text-[13px] font-medium text-danger">{error}</span> : null}
    </span>
  );
}

export function ResendInvoiceButton({
  invoiceId,
  retry = false,
  appearance = "button",
}: {
  invoiceId: string;
  retry?: boolean;
  appearance?: ActionAppearance;
}) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inMenu = appearance === "menu";
  const label = isPending ? "Skickar …" : retry ? "Försök skicka igen" : "Skicka igen";

  if (done) {
    return (
      <span
        className={cx(
          "flex items-center gap-1.5 font-medium text-ok",
          inMenu ? "px-2.5 py-2 text-[13px]" : "text-sm"
        )}
      >
        <Check className="size-4" /> Skickad igen
      </span>
    );
  }

  const button = (
    <button
      type="button"
      role={inMenu ? "menuitem" : undefined}
      className={inMenu ? actionMenuItemClassName() : buttonClasses("secondary", "sm")}
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await deliverInvoiceAction(invoiceId);
          if (result.ok === false) setError(result.errors.join(" "));
          else setDone(true);
        })
      }
    >
      <Send className="size-3.5 shrink-0" />
      {label}
    </button>
  );

  if (inMenu) {
    return (
      <span className="block">
        {button}
        {error ? <span className="block px-2.5 pb-1.5 text-[12px] font-medium text-danger">{error}</span> : null}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      {button}
      {error ? <span className="text-[13px] font-medium text-danger">{error}</span> : null}
    </span>
  );
}

export function DiscardInvoiceButton({
  invoiceId,
  appearance = "button",
}: {
  invoiceId: string;
  appearance?: ActionAppearance;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const menu = useActionMenu();
  const inMenu = appearance === "menu";

  function startConfirm() {
    menu?.close();
    setConfirming(true);
  }

  const trigger = (
    <button
      type="button"
      role={inMenu ? "menuitem" : undefined}
      className={inMenu ? actionMenuItemClassName({ danger: true }) : buttonClasses("ghost", "sm")}
      onClick={startConfirm}
    >
      Kasta utkast
    </button>
  );

  if (inMenu) {
    return (
      <>
        {trigger}
        <Modal open={confirming} onClose={() => !isPending && setConfirming(false)} size="sm" title="Kasta utkast?">
          <div className="px-6 py-5">
            <p className="text-[15px] leading-relaxed text-soft">Kasta utkastet? Det kan inte ångras.</p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button className={buttonClasses("secondary")} disabled={isPending} onClick={() => setConfirming(false)}>
                Avbryt
              </button>
              <button
                className={buttonClasses("danger")}
                disabled={isPending}
                onClick={() => startTransition(async () => discardInvoiceAction(invoiceId))}
              >
                {isPending ? "Kastar …" : "Ja, kasta"}
              </button>
            </div>
          </div>
        </Modal>
      </>
    );
  }

  if (!confirming) return trigger;
  return (
    <span className="flex items-center gap-2">
      <span className="text-[13px] text-soft">Kasta utkastet? Det kan inte ångras.</span>
      <button
        className={buttonClasses("danger", "sm")}
        disabled={isPending}
        onClick={() => startTransition(async () => discardInvoiceAction(invoiceId))}
      >
        {isPending ? "Kastar …" : "Ja, kasta"}
      </button>
      <button className={buttonClasses("ghost", "sm")} onClick={() => setConfirming(false)}>
        Avbryt
      </button>
    </span>
  );
}

export function SendReminderButton({
  invoiceId,
  variant = "secondary",
  size = "sm",
  recipientEmail,
  recipientPhone,
  defaultEmail,
  defaultSms,
}: {
  invoiceId: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
  recipientEmail?: string;
  recipientPhone?: string;
  defaultEmail?: boolean;
  defaultSms?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState({
    email: defaultEmail ?? Boolean(recipientEmail?.trim()),
    sms: defaultSms ?? false,
  });
  if (done) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-medium text-ok">
        <Check className="size-4" /> Påminnelse skickad
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        className={buttonClasses(variant, size)}
        disabled={isPending}
        onClick={() => {
          setError(null);
          setChannels({
            email: defaultEmail ?? Boolean(recipientEmail?.trim()),
            sms: defaultSms ?? false,
          });
          setConfirmOpen(true);
        }}
      >
        {isPending ? "Skickar …" : "Skicka påminnelse"}
      </button>
      <Modal
        open={confirmOpen}
        onClose={() => !isPending && setConfirmOpen(false)}
        title="Skicka betalningspåminnelse?"
        size="sm"
      >
        <div className="px-6 py-5">
          <p className="text-[14px] leading-relaxed text-soft">
            Kunden får en påminnelse om den förfallna fakturan och länken för att betala.
          </p>
          <div className="mt-4">
            <DeliveryChannelPicker
              email={recipientEmail}
              phone={recipientPhone}
              selected={channels}
              onChange={setChannels}
              disabled={isPending}
            />
          </div>
          {error ? <p className="mt-3 text-[13px] font-medium text-danger">{error}</p> : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className={buttonClasses("secondary")} disabled={isPending} onClick={() => setConfirmOpen(false)}>
              Avbryt
            </button>
            <button
              className={buttonClasses("primary")}
              disabled={isPending || (!channels.email && !channels.sms)}
              onClick={() => {
                startTransition(async () => {
                  const result = await sendReminderAction(invoiceId, channels);
                  if (result && result.ok === false) {
                    setError(result.errors.join(" ") || "Påminnelsen kunde inte skickas. Försök igen.");
                    return;
                  }
                  if (result.ok && result.warning) {
                    setError(result.warning);
                  }
                  setConfirmOpen(false);
                  setDone(true);
                });
              }}
            >
              <Send className="size-3.5" />
              {isPending ? "Skickar …" : error ? "Försök igen" : "Skicka påminnelse"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
