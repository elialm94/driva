"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, Circle, Clock } from "lucide-react";
import type { SetupTask } from "@/lib/setup/tasks";
import type { SetupTaskId, SetupTaskOverride } from "@/lib/types";
import { setSetupTaskAction } from "@/app/onboarding-actions";
import { activateOptionalFeatureAction } from "@/app/actions";
import { AppLink } from "../app-link";
import { buttonClasses, cx } from "../ui";

/** En rad i Kom igång: öppna, gör senare, behövs inte, återaktivera. */
export function SetupTaskRow({
  task,
  variant = "full",
  originLabel,
}: {
  task: SetupTask;
  /** "compact" på Hem-kortet – bara öppna + senare. */
  variant?: "full" | "compact";
  originLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isOpen = task.status === "todo" || task.status === "in_progress";

  function setState(state: SetupTaskOverride["state"] | null) {
    setError(null);
    startTransition(async () => {
      const res = await setSetupTaskAction(task.id, state);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4" data-setup-task={task.id} data-setup-status={task.status}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <StatusIcon status={task.status} />
        <div className="min-w-0">
          <p className={cx("text-[15px] font-medium", task.status === "done" ? "text-soft line-through decoration-line/80" : "text-ink")}>
            {task.title}
          </p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-soft">
            {task.status === "done" && task.doneDetail ? task.doneDetail : task.description}
          </p>
          {error ? <p className="mt-1 text-[13px] font-medium text-danger">{error}</p> : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-8 sm:pl-0">
        {isOpen ? <OpenTaskButton task={task} originLabel={originLabel} /> : null}
        {isOpen ? (
          <button type="button" className={buttonClasses("ghost", "sm")} disabled={pending} onClick={() => setState("later")}>
            Senare
          </button>
        ) : null}
        {isOpen && task.canDismiss && variant === "full" ? (
          <button type="button" className={buttonClasses("ghost", "sm")} disabled={pending} onClick={() => setState("not_needed")}>
            Behövs inte
          </button>
        ) : null}
        {task.status === "later" || task.status === "not_needed" ? (
          <button type="button" className={buttonClasses("secondary", "sm")} disabled={pending} onClick={() => setState(null)} data-setup-reactivate>
            Ta upp igen
          </button>
        ) : null}
        {task.status === "done" && task.href ? (
          <AppLink href={task.href} originLabel={originLabel} className={buttonClasses("ghost", "sm")}>
            Visa
          </AppLink>
        ) : null}
      </div>
    </li>
  );
}

/** Artiklar och priser: funktionen aktiveras först (samma väg som Funktioner), sedan Grossister. */
function OpenTaskButton({ task, originLabel }: { task: SetupTask; originLabel: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const needsActivation = task.id === ("articles_prices" as SetupTaskId) && task.href.includes("aktivera=wholesalers");
  if (!needsActivation) {
    return (
      <AppLink href={task.href} originLabel={originLabel} className={buttonClasses("primary", "sm")} data-setup-open>
        {task.cta} <ChevronRight className="size-3.5" />
      </AppLink>
    );
  }
  return (
    <>
      <button
        type="button"
        className={buttonClasses("primary", "sm")}
        disabled={pending}
        data-setup-open
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await activateOptionalFeatureAction("wholesalers");
            if (res.ok === false) {
              setError(res.error);
              return;
            }
            router.push(res.href as never);
            router.refresh();
          });
        }}
      >
        {pending ? "Öppnar …" : task.cta} <ChevronRight className="size-3.5" />
      </button>
      {error ? <span className="text-[13px] font-medium text-danger">{error}</span> : null}
    </>
  );
}

function StatusIcon({ status }: { status: SetupTask["status"] }) {
  if (status === "done") return <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" aria-label="Klar" />;
  if (status === "later") return <Clock className="mt-0.5 size-5 shrink-0 text-muted" aria-label="Gör senare" />;
  if (status === "in_progress") return <Circle className="mt-0.5 size-5 shrink-0 text-info" aria-label="Pågår" />;
  return <Circle className="mt-0.5 size-5 shrink-0 text-line-strong" aria-label="Inte påbörjad" />;
}
