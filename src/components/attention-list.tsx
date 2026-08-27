"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Inbox,
  Clock,
  AlertCircle,
  Receipt,
  HelpCircle,
  FileText,
  Landmark,
  Check,
  Upload,
} from "lucide-react";
import { buttonClasses, cx } from "./ui";
import {
  answerExpenseQuestionAction,
  createFinalInvoiceForJobAction,
  createNextInvoiceForJobAction,
  followUpQuoteAction,
  sendReminderAction,
  uploadReceiptAction,
} from "@/app/actions";
import { invoiceHref } from "@/lib/nav";

export type AttentionAction =
  | { type: "link"; label: string; href: string }
  | { type: "followUpQuote"; label: string; quoteId: string }
  | { type: "remindInvoice"; label: string; invoiceId: string }
  | { type: "uploadReceipt"; label: string; expenseId: string }
  | { type: "answerQuestion"; options: string[]; expenseId: string }
  | { type: "createFinalInvoice"; label: string; jobId: string; jobTitle?: string }
  | { type: "createJobInvoice"; label: string; jobId: string; jobTitle?: string };

export interface AttentionDTO {
  id: string;
  icon: "inbox" | "clock" | "alert" | "receipt" | "question" | "invoice" | "bank";
  title: string;
  text: string;
  href?: string;
  action: AttentionAction;
  secondary?: { label: string; href: string };
}

const ICONS = {
  inbox: { icon: Inbox, cls: "bg-info-soft text-info" },
  clock: { icon: Clock, cls: "bg-warn-soft text-warn" },
  alert: { icon: AlertCircle, cls: "bg-danger-soft text-danger" },
  receipt: { icon: Receipt, cls: "bg-warn-soft text-warn" },
  question: { icon: HelpCircle, cls: "bg-info-soft text-info" },
  invoice: { icon: FileText, cls: "bg-accent-soft text-accent-deep" },
  bank: { icon: Landmark, cls: "bg-info-soft text-info" },
};

function AttentionRow({ item }: { item: AttentionDTO }) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();
  const { icon: Icon, cls } = ICONS[item.icon];

  function run(fn: () => Promise<unknown>, doneText: string) {
    startTransition(async () => {
      await fn();
      setDone(doneText);
    });
  }

  const body = (
    <div className="min-w-0 flex-1">
      <p className="truncate text-[15px] font-medium text-ink">{item.title}</p>
      <p className="mt-0.5 text-sm leading-relaxed text-soft">{item.text}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 px-5 py-4 transition-colors first:rounded-t-[calc(1.25rem-1px)] last:rounded-b-[calc(1.25rem-1px)] hover:bg-canvas/60 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <div className={cx("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl", cls)}>
          <Icon className="size-4.5" />
        </div>
        {item.href ? (
          <Link href={item.href as never} className="min-w-0 flex-1">
            {body}
          </Link>
        ) : (
          body
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-13 sm:justify-end sm:pl-0">
        {done ? (
          <span className="flex items-center gap-1.5 text-sm font-medium text-ok">
            <Check className="size-4" /> {done}
          </span>
        ) : (
          <>
            {item.action.type === "link" ? (
              <Link href={item.action.href as never} className={buttonClasses("primary", "sm")}>
                {item.action.label}
              </Link>
            ) : null}
            {item.action.type === "followUpQuote" ? (
              <button
                className={buttonClasses("primary", "sm")}
                disabled={isPending}
                onClick={() => {
                  const id = (item.action as { quoteId: string }).quoteId;
                  run(() => followUpQuoteAction(id), "Påminnelse skickad");
                }}
              >
                {isPending ? "Skickar …" : item.action.label}
              </button>
            ) : null}
            {item.action.type === "remindInvoice" ? (
              <button
                className={buttonClasses("primary", "sm")}
                disabled={isPending}
                onClick={() => {
                  const id = (item.action as { invoiceId: string }).invoiceId;
                  run(() => sendReminderAction(id), "Påminnelse skickad");
                }}
              >
                {isPending ? "Skickar …" : item.action.label}
              </button>
            ) : null}
            {item.action.type === "uploadReceipt" ? (
              <label className={cx(buttonClasses("primary", "sm"), "cursor-pointer")}>
                <Upload className="size-3.5" />
                {isPending ? "Läser av …" : item.action.label}
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  disabled={isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    const id = (item.action as { expenseId: string }).expenseId;
                    run(() => uploadReceiptAction(id, file?.name ?? "kvitto.jpg"), "Matchat och bokfört");
                  }}
                />
              </label>
            ) : null}
            {item.action.type === "answerQuestion"
              ? (item.action as { options: string[]; expenseId: string }).options.map((opt) => (
                  <button
                    key={opt}
                    className={buttonClasses("secondary", "sm")}
                    disabled={isPending}
                    onClick={() => {
                      const id = (item.action as { expenseId: string }).expenseId;
                      run(() => answerExpenseQuestionAction(id, opt), "Bokfört");
                    }}
                  >
                    {opt}
                  </button>
                ))
              : null}
            {item.action.type === "createFinalInvoice" || item.action.type === "createJobInvoice" ? (
              <button
                className={buttonClasses("accent", "sm")}
                disabled={isPending}
                onClick={() => {
                  const action = item.action as { jobId: string; jobTitle?: string; type: string };
                  startTransition(async () => {
                    const invoiceId =
                      action.type === "createJobInvoice"
                        ? await createNextInvoiceForJobAction(action.jobId)
                        : await createFinalInvoiceForJobAction(action.jobId);
                    router.push(
                      invoiceHref(invoiceId, {
                        href: `/uppdrag/${action.jobId}`,
                        label: action.jobTitle,
                      }) as never
                    );
                  });
                }}
              >
                {isPending ? "Skapar …" : item.action.label}
              </button>
            ) : null}
            {item.secondary ? (
              <Link href={item.secondary.href as never} className={buttonClasses("ghost", "sm")}>
                {item.secondary.label}
              </Link>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function AttentionList({
  items,
  initialVisible,
}: {
  items: AttentionDTO[];
  initialVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const limit = initialVisible ?? items.length;
  const hidden = Math.max(0, items.length - limit);
  const visible = expanded || hidden === 0 ? items : items.slice(0, limit);
  return (
    <div>
      <div className="card divide-y divide-line/70">
        {visible.map((item) => (
          <AttentionRow key={item.id} item={item} />
        ))}
      </div>
      {hidden > 0 && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 text-[13px] font-medium text-soft hover:text-ink"
        >
          Visa {hidden} till
        </button>
      ) : null}
    </div>
  );
}
