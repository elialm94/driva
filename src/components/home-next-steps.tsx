"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { buttonClasses } from "./ui";
import { createNextInvoiceForJobAction } from "@/app/actions";
import { invoiceHref } from "@/lib/nav";

export type NextStepDTO = {
  id: string;
  title: string;
  text: string;
  href: string;
  action:
    | { type: "createJobInvoice"; label: string; jobId: string; jobTitle: string }
    | { type: "link"; label: string; href: string };
};

export function HomeNextSteps({ items }: { items: NextStepDTO[] }) {
  if (items.length === 0) return null;
  return (
    <div className="card divide-y divide-line/70">
      {items.map((item) => (
        <NextStepRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function NextStepRow({ item }: { item: NextStepDTO }) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:gap-4">
      <Link href={item.href as never} className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-ink">{item.title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-soft">{item.text}</p>
      </Link>
      <div className="flex shrink-0 items-center sm:justify-end">
        {done ? (
          <span className="flex items-center gap-1.5 text-sm font-medium text-ok">
            <Check className="size-4" /> {done}
          </span>
        ) : item.action.type === "link" ? (
          <Link href={item.action.href as never} className={buttonClasses("primary", "sm")}>
            {item.action.label}
          </Link>
        ) : (
          <button
            className={buttonClasses("accent", "sm")}
            disabled={isPending}
            onClick={() => {
              const action = item.action as { jobId: string; jobTitle: string };
              startTransition(async () => {
                const invoiceId = await createNextInvoiceForJobAction(action.jobId);
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
        )}
      </div>
    </div>
  );
}
