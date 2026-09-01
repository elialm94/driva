"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { BookOpenCheck, Building2, ChevronDown, LogOut, RotateCcw } from "lucide-react";
import { resetDemoAction } from "@/app/actions";
import { endDemoAction } from "@/app/demo-actions";
import { enterLocalAccountantDemoAction } from "@/app/collaboration-actions";
import { DemoBadge } from "./demo-controls";
import { Modal } from "./modal";
import { buttonClasses, cx } from "./ui";

/**
 * Demo-menyn bakom företagsraden i navigationen.
 *
 * Demon ska se ut som vanliga Driva: primärnavigationen är identisk och de
 * demospecifika åtgärderna – redovisningsvyn, återställ och avsluta – ligger
 * samlade här i stället för som permanenta rader i sidomenyn.
 *
 * Ingen ny funktionalitet byggs: raderna anropar samma serveråtgärder som
 * tidigare (enterLocalAccountantDemoAction, resetDemoAction, endDemoAction).
 *
 * Varianter: "sidebar" öppnar en popover uppåt från foten, "sheet" fäller ut
 * raderna inuti mobilens Mer-ark så arket förblir kort tills man vill mer.
 */

function itemClasses(variant: Variant): string {
  return cx(
    "flex min-h-11 w-full items-center gap-3 text-left transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    variant === "sidebar"
      ? "rounded-lg px-2.5 py-2 text-[14px] text-ink hover:bg-canvas"
      : "rounded-2xl px-4 py-3.5 text-[15px] text-ink hover:bg-canvas"
  );
}

type Variant = "sidebar" | "sheet";

export function DemoMenu({
  title,
  variant = "sidebar",
  showAccountantView = true,
  canEndDemo = false,
  onNavigate,
}: {
  /** Företagsnamnet (ägarvyn) eller konsultens namn (redovisningsvyn). */
  title: string;
  variant?: Variant;
  /** Dölj när menyn redan visas inifrån redovisningsvyn. */
  showAccountantView?: boolean;
  /** Bara den publika demosessionen kan avslutas – lokalt JSON-läge kan inte. */
  canEndDemo?: boolean;
  /** Stäng mobilens Mer-ark när en rad navigerar bort. */
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  // Popovern stängs vid klick utanför och Escape. Bekräftelsedialogen ligger
  // utanför roten och lever vidare även när popovern stängs.
  useEffect(() => {
    if (!open || variant !== "sidebar") return;
    function onPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, variant]);

  const items = (
    <>
      <p
        className={cx(
          "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted",
          variant === "sidebar" ? "px-2.5 pt-1" : "px-4 pt-2"
        )}
      >
        Du använder demon
      </p>
      <p
        className={cx(
          "pb-1 text-[13px] leading-relaxed text-soft",
          variant === "sidebar" ? "px-2.5" : "px-4"
        )}
      >
        Utforska Driva med exempeldatan för {title}.
      </p>

      {showAccountantView ? (
        <button
          type="button"
          disabled={pending}
          className={itemClasses(variant)}
          onClick={() => {
            onNavigate?.();
            startTransition(() => enterLocalAccountantDemoAction());
          }}
        >
          <BookOpenCheck className="size-[18px] shrink-0 text-muted" strokeWidth={2} />
          Visa redovisningsvyn
        </button>
      ) : null}

      <button
        type="button"
        disabled={pending}
        className={itemClasses(variant)}
        onClick={() => {
          setOpen(false);
          setError(null);
          setConfirmReset(true);
        }}
      >
        <RotateCcw className="size-[18px] shrink-0 text-muted" strokeWidth={2} />
        Återställ demo
      </button>

      {canEndDemo ? (
        <button
          type="button"
          disabled={pending}
          className={itemClasses(variant)}
          onClick={() => {
            onNavigate?.();
            startTransition(() => endDemoAction());
          }}
        >
          <LogOut className="size-[18px] shrink-0 text-muted" strokeWidth={2} />
          Avsluta demo
        </button>
      ) : null}

      {error ? (
        <p role="alert" className={cx("pb-1 text-[13px] text-danger", variant === "sidebar" ? "px-2.5" : "px-4")}>
          {error}
        </p>
      ) : null}
    </>
  );

  const trigger = (
    <button
      type="button"
      aria-haspopup={variant === "sidebar" ? "menu" : undefined}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={() => setOpen((v) => !v)}
      className={cx(
        "flex w-full items-center gap-2 text-left transition-colors",
        variant === "sidebar"
          ? "min-h-9 rounded-lg px-3 py-1.5 text-[13px] font-medium text-soft hover:bg-ink/5 hover:text-ink"
          : "min-h-11 rounded-2xl px-4 py-3 text-[15px] font-medium text-ink hover:bg-canvas"
      )}
    >
      {variant === "sheet" ? <Building2 className="size-5 shrink-0 text-muted" strokeWidth={2} /> : null}
      <span className="truncate">{title}</span>
      <DemoBadge className="shrink-0" />
      <ChevronDown
        className={cx("ml-auto size-4 shrink-0 text-muted transition-transform", open && "rotate-180")}
        aria-hidden
      />
    </button>
  );

  return (
    <>
      <div ref={rootRef} className={variant === "sidebar" ? "relative" : undefined}>
        {trigger}
        {variant === "sidebar" ? (
          <div
            id={panelId}
            role="menu"
            aria-hidden={!open}
            className={cx(
              "absolute inset-x-0 bottom-full z-40 mb-1.5 overflow-hidden rounded-xl border border-line bg-card p-1 shadow-pop",
              !open && "hidden"
            )}
          >
            {items}
          </div>
        ) : open ? (
          <div id={panelId} className="mt-0.5 rounded-2xl bg-canvas/60 pb-1">
            {items}
          </div>
        ) : null}
      </div>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Återställa demon?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => setConfirmReset(false)}>
              Avbryt
            </button>
            <button
              type="button"
              className={buttonClasses("primary", "sm")}
              disabled={pending}
              onClick={() => {
                setConfirmReset(false);
                startTransition(async () => {
                  const result = await resetDemoAction();
                  if (!result.ok) setError(result.error);
                });
              }}
            >
              {pending ? "Återställer …" : "Återställ"}
            </button>
          </div>
        }
      >
        <p className="px-6 py-5 text-[15px] text-soft">
          Alla ändringar du gjort i den här demosessionen tas bort.
        </p>
      </Modal>
    </>
  );
}
