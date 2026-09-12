"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { BOKFORING_DETAIL_TABS, BOKFORING_REPORT_TABS, bokforingDetailTabForPath, matchRoute } from "@/lib/nav";
import {
  BOKFORING_MODE_COOKIE,
  BOKFORING_MODE_COOKIE_MAX_AGE,
  simpleBookkeepingKeys,
  type BookkeepingMode,
} from "@/lib/accounting/bookkeeping-mode-keys";
import { persistBookkeepingModeAction } from "@/app/bokforing-actions";
import { useToast } from "./toast";
import { cx } from "./ui";

const HOVER_INTENT_MS = 120;
const HINT_COOKIE = "driva_bokforing_lage_hint";

export function BokforingAdvancedTabs({
  initialMode,
  hasPayroll,
  showYearEnd,
}: {
  initialMode: BookkeepingMode;
  hasPayroll: boolean;
  showYearEnd: boolean;
}) {
  const pathname = usePathname();
  const active = bokforingDetailTabForPath(pathname);
  const [mode, setMode] = useState<BookkeepingMode>(initialMode);
  const reportsOpen = active === "rapporter" && mode === "avancerat";
  const [pending, setPending] = useState<{ key: string; from: string } | null>(null);
  const pendingKey = pending?.from === pathname ? pending.key : null;
  const [warm, setWarm] = useState<Set<string>>(() => new Set());
  const intent = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

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
    document.cookie = `${BOKFORING_MODE_COOKIE}=${next}; path=/; max-age=${BOKFORING_MODE_COOKIE_MAX_AGE}; samesite=lax`;
    void persistBookkeepingModeAction(next);
    if (next === "avancerat" && !document.cookie.includes(`${HINT_COOKIE}=1`)) {
      document.cookie = `${HINT_COOKIE}=1; path=/; max-age=${BOKFORING_MODE_COOKIE_MAX_AGE}; samesite=lax`;
      toast({
        title: "Redovisningsvyn visar verifikationer, huvudbok och rapporter. Bokföringen är densamma.",
      });
    }
  }

  return (
    <div className="mb-6 print:hidden" data-bokforing-tabs={mode}>
      <div className="flex gap-1 overflow-x-auto rounded-2xl bg-ink/4 p-1">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href as never}
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
              href={t.href as never}
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
          <Link href={"/bokforing" as never} className="font-medium text-accent hover:underline">
            Tillbaka till Att göra
          </Link>
        </p>
      ) : null}
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
    </div>
  );
}

function BokforingTabLabel({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={cx(pending && "bokforing-tab-pending")}>{children}</span>;
}
