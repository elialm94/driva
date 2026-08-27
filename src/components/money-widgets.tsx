"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Check, Banknote, BellRing, FilePlus2, Undo2 } from "lucide-react";
import { buttonClasses, cx, DemoTag } from "./ui";
import {
  answerExpenseQuestionAction,
  createPartInvoiceAction,
  creditInvoiceAction,
  followUpQuoteAction,
  paySupplierInvoiceAction,
  simulatePaymentAction,
  sendReminderAction,
  uploadReceiptAction,
  uploadStandaloneReceiptAction,
} from "@/app/actions";

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
  return (
    <label className={cx(buttonClasses(expenseId ? "primary" : "secondary", "sm"), "cursor-pointer")}>
      <Upload className="size-3.5" />
      {isPending ? "Läser av …" : label}
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
      title="Simulerar en utbetalning från banken – matchas och bokförs automatiskt"
    >
      <Banknote className="size-3.5" />
      {isPending ? "Betalar …" : "Betala"}
      <DemoTag />
    </button>
  );
}

export function SimulatePaymentButton({ invoiceId }: { invoiceId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      className={buttonClasses("secondary", "sm")}
      disabled={isPending}
      onClick={() => startTransition(async () => simulatePaymentAction(invoiceId))}
      title="Simulerar att betalningen dyker upp på banken – matchning och bokföring körs på riktigt"
    >
      <Banknote className="size-3.5" />
      {isPending ? "Betalning på väg in …" : "Simulera inbetalning"}
      <DemoTag />
    </button>
  );
}

export function FollowUpButton({ quoteId }: { quoteId: string }) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-medium text-ok">
        <Check className="size-4" /> Påminnelse skickad
      </span>
    );
  }
  return (
    <button
      className={buttonClasses("secondary", "sm")}
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await followUpQuoteAction(quoteId);
          setDone(true);
        })
      }
    >
      <BellRing className="size-3.5" />
      {isPending ? "Skickar …" : "Följ upp"}
    </button>
  );
}

export function CreatePartInvoiceButton({
  quoteId,
  partIndex,
  label,
}: {
  quoteId: string;
  partIndex: number;
  label: string;
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
          router.push(`/pengar/fakturor/${id}`);
        })
      }
    >
      <FilePlus2 className="size-3.5" />
      {isPending ? "Skapar …" : label}
    </button>
  );
}

export function CreditInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button className={buttonClasses("ghost", "sm")} onClick={() => setConfirming(true)}>
        <Undo2 className="size-3.5" /> Kreditera
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-[13px] text-soft">Kreditera hela fakturan?</span>
      <button
        className={buttonClasses("danger", "sm")}
        disabled={isPending}
        onClick={() => startTransition(async () => creditInvoiceAction(invoiceId))}
      >
        {isPending ? "Krediterar …" : "Ja, kreditera"}
      </button>
      <button className={buttonClasses("ghost", "sm")} onClick={() => setConfirming(false)}>
        Avbryt
      </button>
    </span>
  );
}

export function SendReminderButton({ invoiceId }: { invoiceId: string }) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-medium text-ok">
        <Check className="size-4" /> Påminnelse skickad
      </span>
    );
  }
  return (
    <button
      className={buttonClasses("secondary", "sm")}
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await sendReminderAction(invoiceId);
          setDone(true);
        })
      }
    >
      {isPending ? "Skickar …" : "Skicka påminnelse"}
    </button>
  );
}
