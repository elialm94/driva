"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, CheckCircle2, PartyPopper, Plus } from "lucide-react";
import { buttonClasses, cx } from "./ui";
import { Modal } from "./modal";
import {
  addChecklistItemAction,
  createFinalInvoiceForJobAction,
  setJobStatusAction,
  toggleChecklistAction,
} from "@/app/actions";
import type { ChecklistItem } from "@/lib/types";

export function JobStatusControls({
  jobId,
  status,
  customerName,
  remainingAmount,
}: {
  jobId: string;
  status: "kommande" | "pagar" | "klart";
  customerName: string;
  remainingAmount: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [showDoneDialog, setShowDoneDialog] = useState(false);
  const router = useRouter();

  if (status === "klart") return null;

  return (
    <>
      {status === "kommande" ? (
        <button
          className={buttonClasses("primary")}
          disabled={isPending}
          onClick={() => startTransition(async () => setJobStatusAction(jobId, "pagar"))}
        >
          <Play className="size-4" />
          {isPending ? "Startar …" : "Starta arbetet"}
        </button>
      ) : (
        <button
          className={buttonClasses("accent")}
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await setJobStatusAction(jobId, "klart");
              setShowDoneDialog(true);
            })
          }
        >
          <CheckCircle2 className="size-4" />
          {isPending ? "Sparar …" : "Markera som klart"}
        </button>
      )}

      <Modal open={showDoneDialog} onClose={() => setShowDoneDialog(false)} size="sm">
        <div className="flex flex-col items-center px-8 py-10 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-ok-soft">
            <PartyPopper className="size-7 text-ok" />
          </div>
          <p className="mt-4 text-[19px] font-semibold tracking-tight">Uppdraget är klart</p>
          <p className="mt-2 text-sm leading-relaxed text-soft">
            Uppdraget hos {customerName} är markerat som klart.
            {remainingAmount ? ` Vill du skapa slutfakturan på ${remainingAmount}?` : ""}
          </p>
          <div className="mt-6 flex gap-2">
            <button className={buttonClasses("ghost")} onClick={() => setShowDoneDialog(false)}>
              Senare
            </button>
            {remainingAmount ? (
              <button
                className={buttonClasses("accent")}
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const invoiceId = await createFinalInvoiceForJobAction(jobId);
                    router.push(`/pengar/fakturor/${invoiceId}`);
                  })
                }
              >
                {isPending ? "Skapar …" : "Skapa faktura"}
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
  label = "Skapa faktura",
  variant = "accent",
  size = "md",
}: {
  jobId: string;
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
          router.push(`/pengar/fakturor/${invoiceId}`);
        })
      }
    >
      <Plus className="size-3.5" />
      {isPending ? "Skapar …" : label}
    </button>
  );
}

export function Checklist({ jobId, items }: { jobId: string; items: ChecklistItem[] }) {
  const [isPending, startTransition] = useTransition();
  const [newItem, setNewItem] = useState("");
  const done = items.filter((i) => i.done).length;

  return (
    <div>
      {items.length > 0 ? (
        <p className="mb-2 text-[13px] font-medium text-muted">
          {done} av {items.length} klara
        </p>
      ) : null}
      <div className="space-y-1">
        {items.map((item) => (
          <button
            key={item.id}
            disabled={isPending}
            onClick={() => startTransition(async () => toggleChecklistAction(jobId, item.id))}
            className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-canvas"
          >
            <span
              className={cx(
                "flex size-5 shrink-0 items-center justify-center rounded-md border transition-all",
                item.done ? "border-accent bg-accent text-white" : "border-line-strong bg-card group-hover:border-muted"
              )}
            >
              {item.done ? (
                <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-current stroke-2">
                  <path d="M2 6l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </span>
            <span className={cx("text-[14px]", item.done ? "text-muted line-through" : "text-ink")}>{item.text}</span>
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = newItem.trim();
          if (!text) return;
          setNewItem("");
          startTransition(async () => addChecklistItemAction(jobId, text));
        }}
      >
        <Plus className="size-4 text-muted" />
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="Lägg till punkt …"
          className="flex-1 bg-transparent py-1.5 text-[14px] placeholder:text-muted"
        />
      </form>
    </div>
  );
}
