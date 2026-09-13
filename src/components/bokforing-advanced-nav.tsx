"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { BOKFORING_DETAIL_TABS, BOKFORING_REPORT_TABS, bokforingDetailTabForPath, matchRoute } from "@/lib/nav";
import { OWNER_WORKSPACE_BASE, ownerPathFor, workspaceHref } from "@/lib/accounting-workspace/tabs";
import { simpleBookkeepingKeys, type BookkeepingMode } from "@/lib/accounting/bookkeeping-mode-keys";
import { useBookkeepingModeSwitch } from "./bokforing-mode-switch";
import { cx } from "./ui";

const HOVER_INTENT_MS = 120;

export function BokforingAdvancedTabs({
  initialMode,
  hasPayroll,
  showYearEnd,
  basePath = OWNER_WORKSPACE_BASE,
  allowModeToggle = true,
}: {
  initialMode: BookkeepingMode;
  hasPayroll: boolean;
  showYearEnd: boolean;
  /**
   * Arbetsytans basväg. Ägaren: /bokforing (standard). Konsulten:
   * /redovisning/k/<businessId> – samma flikar, samma sidor, annan adress.
   */
  basePath?: string;
  /** Enkel/avancerad-toggeln hör bara hemma på ägarens yta. */
  allowModeToggle?: boolean;
}) {
  const rawPathname = usePathname();
  // Flik- och ruttlogiken är skriven för ägarytan; översätt konsultytans
  // adress dit och tillbaka så att båda ytorna delar EN sanning om flikarna.
  const pathname = ownerPathFor(basePath, rawPathname);
  const hrefFor = (ownerHref: string) => workspaceHref(basePath, ownerHref);
  const active = bokforingDetailTabForPath(pathname);
  const [mode, setMode] = useState<BookkeepingMode>(initialMode);
  const reportsOpen = active === "rapporter" && mode === "avancerat";
  const [pending, setPending] = useState<{ key: string; from: string } | null>(null);
  const pendingKey = pending?.from === pathname ? pending.key : null;
  const [warm, setWarm] = useState<Set<string>>(() => new Set());
  const intent = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { switchTo } = useBookkeepingModeSwitch();

  function warmOn(key: string, delayMs: number) {
    if (warm.has(key)) return;
    if (intent.current) clearTimeout(intent.current);
    intent.current = setTimeout(() => setWarm((prev) => new Set(prev).add(key)), delayMs);
  }

  function warmOff() {
    if (intent.current) clearTimeout(intent.current);
    intent.current = null;
  }

  const simpleKeys = simpleBookkeepingKeys({ hasPayroll, showYearEnd });
  const tabs =
    mode === "avancerat"
      ? BOKFORING_DETAIL_TABS.filter((t) => t.key !== "skatt")
      : BOKFORING_DETAIL_TABS.filter((t) => simpleKeys.includes(t.key));

  const outsideSimple = mode === "enkelt" && active != null && !simpleKeys.includes(active);
  const outsideAnyTab = mode === "enkelt" && !active && pathname !== "/bokforing";
  const deepLink = outsideSimple || outsideAnyTab;
  const deepLabel = matchRoute(pathname)?.meta.label ?? "Sidan";

  const selected = pendingKey ?? active;

  function toggleMode() {
    const next = mode === "enkelt" ? "avancerat" : "enkelt";
    setMode(next);
    switchTo(next);
  }

  return (
    <div className="mb-6 print:hidden" data-bokforing-tabs={mode}>
      <div className="flex gap-1 overflow-x-auto rounded-2xl bg-ink/4 p-1">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={hrefFor(t.href) as never}
            prefetch={warm.has(t.key) ? true : undefined}
            onPointerEnter={() => warmOn(t.key, HOVER_INTENT_MS)}
            onPointerLeave={warmOff}
            onFocus={() => warmOn(t.key, 0)}
            onTouchStart={() => warmOn(t.key, 0)}
            onClick={() => setPending({ key: t.key, from: pathname })}
            aria-current={active === t.key ? "page" : undefined}
            className={cx(
              "flex-1 whitespace-nowrap rounded-xl px-4 py-2 text-center text-sm font-medium transition-all",
              selected === t.key ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
            )}
          >
            <BokforingTabLabel>{t.label}</BokforingTabLabel>
          </Link>
        ))}
      </div>
      {reportsOpen ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {BOKFORING_REPORT_TABS.map((t) => (
            <Link
              key={t.key}
              href={hrefFor(t.href) as never}
              onClick={() => setPending({ key: "rapporter", from: pathname })}
              aria-current={pathname === t.href ? "page" : undefined}
              className={cx(
                "rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors",
                pathname === t.href ? "bg-ink text-white" : "bg-canvas text-soft hover:bg-line/60"
              )}
            >
              <BokforingTabLabel>{t.label}</BokforingTabLabel>
            </Link>
          ))}
        </div>
      ) : null}
      {deepLink ? (
        <p className="mt-3 text-[13px] text-soft">
          {deepLabel}.{" "}
          <Link href={hrefFor("/bokforing") as never} className="font-medium text-accent hover:underline">
            Tillbaka till Att göra
          </Link>
        </p>
      ) : null}
      {allowModeToggle ? (
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={toggleMode}
          data-bokforing-mode={mode}
          className="text-[12.5px] font-medium text-muted hover:text-ink"
        >
          {mode === "enkelt" ? "Visa redovisningsvy" : "Visa enkel vy"}
        </button>
      </div>
      ) : null}
    </div>
  );
}

/**
 * Enkel bokföring har ingen flikrad: /bokforing är arbetskön och Underlag,
 * Bank och Skatt är drill-down-vyer man når från korten. Det här är det lilla
 * chromet på de vyerna – vad sidan heter, vägen tillbaka till kön och den
 * diskreta vägen in i redovisningsvyn. På själva kön visas inget alls.
 */
export function BokforingSimpleChrome() {
  const pathname = usePathname();
  const { switchTo, pending } = useBookkeepingModeSwitch();
  if (pathname === "/bokforing") return null;
  const label = matchRoute(pathname)?.meta.label ?? "Sidan";
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-2 print:hidden" data-bokforing-tabs="enkelt">
      <p className="text-[13px] text-soft">
        <Link href="/bokforing" className="font-medium text-accent hover:underline">
          ← Tillbaka till Att göra
        </Link>
        <span className="text-muted"> · {label}</span>
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => switchTo("avancerat")}
        data-bokforing-mode="enkelt"
        className="text-[12.5px] font-medium text-muted hover:text-ink"
      >
        Visa redovisningsvy
      </button>
    </div>
  );
}

function BokforingTabLabel({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={cx(pending && "bokforing-tab-pending")}>{children}</span>;
}
