"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { BOKFORING_DETAIL_TABS, BOKFORING_REPORT_TABS, bokforingDetailTabForPath } from "@/lib/nav";
import {
  BOKFORING_MODE_COOKIE,
  BOKFORING_MODE_COOKIE_MAX_AGE,
  simpleBookkeepingKeys,
  type BookkeepingMode,
} from "@/lib/accounting/bookkeeping-mode-keys";
import { cx } from "./ui";

/** Så länge måste pekaren vila på en flik innan vyn hämtas i förväg. */
const HOVER_INTENT_MS = 120;

/**
 * Flikrad i den delade bokföringslayouten. I enkelt läge syns bara det
 * hantverkaren behöver (översikt, moms, skattekonto – lön och bokslut när
 * de är aktuella). Avancerat visar allt.
 *
 * Två prestandaregler, båda mätta i produktionsbygget:
 *
 *   * Läget är KLIENTTILLSTÅND (+ cookie). Enkelt ↔ avancerat får bara byta
 *     vilka flikar som syns – ingen serveråtgärd, ingen revalidering och
 *     ingen router.refresh(). Den gamla vägen skrev i bokföringen och
 *     revaliderade "/" som layout, vilket tömde klientcachen och lät hela
 *     appskalet plus varje flikvy hämtas om: det var därför växlingen kändes
 *     som en helsidesladdning.
 *
 *   * Flikarna använder Next standardprefetch. prefetch={true} tvingar en
 *     FULL rendering av varje dynamisk flikvy på servern redan när raden
 *     visas – att öppna Skattekonto hämtade då Huvudbok, Verifikationer, Lön,
 *     Bokslut och Rapporter också, var och en med en full tenant-snapshot.
 *     Standardprefetch hämtar i stället skalet till loading-gränsen i
 *     bokforing/loading.tsx, så flikraden ligger kvar och bara innehållsytan
 *     byts vid ett klick. Full prefetch sker bara på avsikt (hover/fokus/
 *     touch) och då för EN flik – klicket blir omedelbart utan att de andra
 *     vyerna renderas.
 */
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
  // Klickad flik markeras direkt. Markeringen hör till sökvägen den startade
  // från, så den nollställs av sig själv när navigeringen landat.
  const [pending, setPending] = useState<{ key: string; from: string } | null>(null);
  const pendingKey = pending?.from === pathname ? pending.key : null;

  // Avsiktsprefetch: en flik som pekas ut i minst HOVER_INTENT_MS hämtas i sin
  // helhet, så klicket blir omedelbart. Att dra musen längs raden räcker inte
  // och en flik som aldrig pekas ut renderas aldrig på servern i förväg.
  const [warm, setWarm] = useState<Set<string>>(() => new Set());
  const intent = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      ? BOKFORING_DETAIL_TABS
      : BOKFORING_DETAIL_TABS.filter((t) => simpleKeys.includes(t.key) || t.key === active);

  const selected = pendingKey ?? active;

  function toggleMode() {
    const next = mode === "enkelt" ? "avancerat" : "enkelt";
    setMode(next);
    // Cookien gör att läget sitter kvar vid nästa hårda laddning. Ingen
    // serveråtgärd: sidans data är oförändrad, bara flikraden byter form.
    document.cookie = `${BOKFORING_MODE_COOKIE}=${next}; path=/; max-age=${BOKFORING_MODE_COOKIE_MAX_AGE}; samesite=lax`;
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
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={toggleMode}
          data-bokforing-mode={mode}
          className="text-[12.5px] font-medium text-muted hover:text-ink"
        >
          {mode === "enkelt" ? "Visa avancerat" : "Visa enkelt"}
        </button>
      </div>
    </div>
  );
}

function BokforingTabLabel({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={cx(pending && "bokforing-tab-pending")}>{children}</span>;
}
