"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Banknote, FilePlus2, Undo2, Send } from "lucide-react";
import { actionMenuItemClassName, useActionMenu, type ActionAppearance } from "./action-menu";
import { Modal } from "./modal";
import { buttonClasses, cx, DemoTag } from "./ui";
import {
  answerExpenseQuestionAction,
  createPartInvoiceAction,
  creditInvoiceAction,
  creditInvoiceContextAction,
  deliverInvoiceAction,
  followUpQuoteAction,
  paySupplierInvoiceAction,
  simulatePaymentAction,
  sendReminderAction,
  uploadInboxDocumentAction,
  uploadReceiptAction,
} from "@/app/actions";
import { invoiceHref } from "@/lib/nav";
import { kr } from "@/lib/format";
import type { CreditInvoiceContext } from "@/lib/services/invoices";
import { inboxDocumentForm, receiptUploadForm } from "@/lib/receipts/read-file";
import { ReceiptUpload } from "./receipt-upload";
import { useToast } from "./toast";

/**
 * Ladda upp ett kvitto. Med `expenseId` kopplas det till ett känt bankköp –
 * banken bär då beloppet. Utan `expenseId` går kvittot in i inboxen, tolkas av
 * kvittotolkningen och bokförs när läsningen är säker nog; annars hamnar det i
 * Kontrollera-vyn. Ingen väg hittar på uppgifter.
 */
export function UploadReceiptButton({
  expenseId,
  label = "Lägg till kvitto",
  variant,
}: {
  expenseId?: string;
  label?: string;
  variant?: "landing" | "inline" | "compact";
}) {
  const zone = variant ?? (expenseId ? "compact" : "landing");

  if (expenseId) {
    return (
      <ReceiptUpload
        variant={zone}
        multiple={false}
        title={label}
        formats="PDF, JPG, PNG, HEIC · max 8 MB"
        upload={async (file) => {
          // Filen följer med som File i en FormData – aldrig som data-URL (read-file.ts).
          const result = await uploadReceiptAction(receiptUploadForm(expenseId, file));
          if (result.ok === false) return { ok: false, error: result.error };
          return { ok: true, note: "Kvitto sparat" };
        }}
      />
    );
  }

  return (
    <ReceiptUpload
      variant={zone}
      title={label}
      subtitle="Eller tryck för att välja, fota med kameran eller klistra in en skärmdump. Kvittot läses av och bokförs när uppgifterna räcker."
      pasteAnywhere={zone === "landing"}
      upload={async (file) => {
        const result = await uploadInboxDocumentAction(inboxDocumentForm(file));
        if (result.ok === false) return { ok: false, error: result.error };
        return { ok: true, note: result.autoBooked ? "Bokfört" : "I inboxen – kontrollera uppgifterna" };
      }}
    />
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
  const { toast } = useToast();
  return (
    <button
      className={buttonClasses("secondary", "sm")}
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await paySupplierInvoiceAction(supplierInvoiceId);
          toast({ title: "Leverantörsfakturan är betald och bokförd", tone: "ok" });
        })
      }
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
  const { toast } = useToast();
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
          toast({
            title: "Inbetalningen finns på banken",
            text: "Matchningen mot fakturan och bokföringen körs som på riktigt.",
            tone: "ok",
          });
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
          Kunden får ett mejl med en påminnelse om offerten och länken där den kan godkännas eller avböjas.
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

/**
 * Kreditera hel eller del av en faktura. Delkredit får ett eget belopp inkl.
 * moms; originalet lever kvar med lägre utestående. ROT/RUT-fakturor krediteras
 * alltid i sin helhet (avdraget mot Skatteverket blir annars tvetydigt).
 * Rendera utanför overflow-menyn.
 */
export function CreditInvoiceConfirmDialog({
  invoiceId,
  open,
  onClose,
  onSuccess,
  context,
}: {
  invoiceId: string;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** Känd på fakturasidan; hämtas annars när dialogen öppnas. */
  context?: CreditInvoiceContext | null;
}) {
  const [isPending, setPending] = useState(false);
  // Formuläret monteras om varje gång dialogen öppnas – då börjar valet om från "hela".
  return (
    <Modal open={open} onClose={() => !isPending && onClose()} size="sm" title="Kreditera faktura">
      {open ? (
        <CreditInvoiceForm
          invoiceId={invoiceId}
          initialContext={context ?? null}
          onClose={onClose}
          onSuccess={onSuccess}
          onPendingChange={setPending}
        />
      ) : null}
    </Modal>
  );
}

function CreditInvoiceForm({
  invoiceId,
  initialContext,
  onClose,
  onSuccess,
  onPendingChange,
}: {
  invoiceId: string;
  initialContext: CreditInvoiceContext | null;
  onClose: () => void;
  onSuccess?: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<CreditInvoiceContext | null>(initialContext);
  const [mode, setMode] = useState<"hel" | "del">("hel");
  const [amount, setAmount] = useState("");
  const amountId = useId();

  useEffect(() => {
    onPendingChange(isPending);
  }, [isPending, onPendingChange]);

  useEffect(() => {
    if (initialContext || !invoiceId) return;
    let cancelled = false;
    creditInvoiceContextAction(invoiceId).then((res) => {
      if (cancelled) return;
      if (res.ok) setContext(res.context);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [invoiceId, initialContext]);

  const partialAllowed = context?.partialAllowed ?? true;
  const remaining = context?.remainingToCredit ?? null;
  const parsedAmount = Number(amount.replace(/\s/g, "").replace(",", "."));
  const partialValid = mode === "del" && Number.isFinite(parsedAmount) && parsedAmount >= 1;

  function confirm() {
    if (mode === "del" && !partialValid) {
      setError("Ange beloppet att kreditera i hela kronor inkl. moms.");
      return;
    }
    startTransition(async () => {
      const result = await creditInvoiceAction(
        invoiceId,
        mode === "del" ? { amountInclVat: Math.round(parsedAmount) } : undefined
      );
      if (result && result.ok === false) {
        setError(result.error);
        return;
      }
      onClose();
      onSuccess?.();
      router.refresh();
    });
  }

  const optionCls = (active: boolean) =>
    cx(
      "flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors",
      active ? "border-accent bg-accent-soft/40" : "border-line hover:border-line-strong"
    );

  return (
    <div className="px-6 py-5">
      {context?.number != null ? (
        <p className="text-[17px] font-semibold tracking-tight text-ink">Faktura #{context.number}</p>
      ) : null}
      <p className={cx("text-[14px] leading-relaxed text-soft", context?.number != null && "mt-1")}>
        Kunden får en kreditfaktura med eget nummer. Originalet och dess verifikation står kvar – krediten bokförs som en
        egen händelse.
      </p>

      <div className="mt-4 space-y-2" role="radiogroup" aria-label="Vad ska krediteras">
        <label className={optionCls(mode === "hel")}>
          <input
            type="radio"
            name="kredit-lage"
            className="mt-1 accent-accent"
            checked={mode === "hel"}
            onChange={() => setMode("hel")}
          />
          <span className="min-w-0">
            <span className="block text-[14px] font-medium text-ink">
              Hela fakturan{remaining != null ? ` · ${kr(remaining)}` : ""}
            </span>
            <span className="block text-[13px] text-soft">
              {context && context.paid > 0
                ? `Kunden har redan betalat ${kr(context.paid)} – det blir en återbetalning att bokföra.`
                : "Fakturan markeras som krediterad och räknas inte längre som en fordran."}
            </span>
          </span>
        </label>

        {partialAllowed ? (
          <label className={optionCls(mode === "del")}>
            <input
              type="radio"
              name="kredit-lage"
              className="mt-1 accent-accent"
              checked={mode === "del"}
              onChange={() => setMode("del")}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium text-ink">En del av beloppet</span>
              <span className="block text-[13px] text-soft">
                Raderna krediteras proportionellt per momssats. Fakturan fortsätter gälla för resten.
              </span>
              {mode === "del" ? (
                <span className="mt-3 block">
                  <label htmlFor={amountId} className="mb-1 block text-[12px] font-medium text-soft">
                    Belopp att kreditera, inkl. moms
                  </label>
                  <span className="relative block w-44">
                    <input
                      id={amountId}
                      type="text"
                      inputMode="numeric"
                      autoFocus
                      placeholder={remaining != null ? `högst ${remaining.toLocaleString("sv-SE")}` : "t.ex. 2 500"}
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setError(null);
                      }}
                      className="h-10 w-full rounded-xl border border-line bg-card px-3 pr-9 text-[14px] tabular outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                    <span
                      aria-hidden
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-muted"
                    >
                      kr
                    </span>
                  </span>
                </span>
              ) : null}
            </span>
          </label>
        ) : (
          <p className="px-1 text-[12px] text-muted">
            Fakturor med ROT/RUT-avdrag krediteras alltid i sin helhet – avdraget hos Skatteverket kan inte delas.
          </p>
        )}
      </div>

      {error ? <p className="mt-3 text-[13px] font-medium text-danger">{error}</p> : null}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button className={buttonClasses("secondary")} disabled={isPending} onClick={onClose}>
          Avbryt
        </button>
        <button
          className={buttonClasses("danger")}
          disabled={isPending || (mode === "del" && !partialValid)}
          onClick={confirm}
        >
          {isPending
            ? "Krediterar …"
            : mode === "del" && partialValid
              ? `Kreditera ${kr(Math.round(parsedAmount))}`
              : "Kreditera hela fakturan"}
        </button>
      </div>
    </div>
  );
}

export function CreditInvoiceButton({
  invoiceId,
  appearance = "button",
  label = "Kreditera",
  buttonVariant = "ghost",
  onSuccess,
  context,
}: {
  invoiceId: string;
  appearance?: ActionAppearance;
  label?: string;
  buttonVariant?: "ghost" | "secondary";
  onSuccess?: () => void;
  context?: CreditInvoiceContext | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const menu = useActionMenu();
  const inMenu = appearance === "menu";

  function startConfirm() {
    menu?.close();
    setConfirming(true);
  }

  return (
    <>
      <button
        type="button"
        role={inMenu ? "menuitem" : undefined}
        className={inMenu ? actionMenuItemClassName() : buttonClasses(buttonVariant, "sm")}
        onClick={startConfirm}
      >
        <Undo2 className="size-3.5 shrink-0" /> {label}
      </button>
      <CreditInvoiceConfirmDialog
        invoiceId={invoiceId}
        open={confirming}
        onClose={() => setConfirming(false)}
        onSuccess={onSuccess}
        context={context}
      />
    </>
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
  const menu = useActionMenu();
  const { toast } = useToast();
  const inMenu = appearance === "menu";
  const label = isPending ? "Skickar …" : retry ? "Försök skicka igen" : "Skicka igen";

  if (done && !inMenu) {
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
          if (result.ok === false) {
            setError(result.errors.join(" "));
            return;
          }
          setDone(true);
          // Menyn stängs – bekräftelsen syns i toasten i stället.
          if (inMenu) {
            menu?.close();
            toast({ title: retry ? "Fakturan skickades" : "Fakturan skickades igen", text: "Kunden får mejlet med länken för att betala.", tone: "ok" });
          }
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

export function SendReminderButton({
  invoiceId,
  variant = "secondary",
  size = "sm",
}: {
  invoiceId: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
}) {
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
        type="button"
        className={buttonClasses(variant, size)}
        disabled={isPending}
        onClick={() => {
          setError(null);
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
            Kunden får ett mejl med en påminnelse om den förfallna fakturan och länken för att betala.
          </p>
          {error ? <p className="mt-3 text-[13px] font-medium text-danger">{error}</p> : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className={buttonClasses("secondary")} disabled={isPending} onClick={() => setConfirmOpen(false)}>
              Avbryt
            </button>
            <button
              className={buttonClasses("primary")}
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await sendReminderAction(invoiceId);
                  if (result && result.ok === false) {
                    setError(result.errors.join(" ") || "Påminnelsen kunde inte skickas. Försök igen.");
                    return;
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
