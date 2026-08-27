"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Home,
  Users,
  Hammer,
  Wallet,
  BookOpenCheck,
  Globe,
  Sparkles,
  MoreHorizontal,
  RotateCcw,
  Settings,
  X,
} from "lucide-react";
import { cx } from "./ui";
import { resetDemoAction } from "@/app/actions";
import { isSectionActive, NAV_ITEMS, type NavSection } from "@/lib/nav";

const NAV_ICONS: Record<NavSection, typeof Home> = {
  hem: Home,
  kunder: Users,
  uppdrag: Hammer,
  pengar: Wallet,
  bokforing: BookOpenCheck,
  hemsida: Globe,
  assistent: Sparkles,
};

const NAV = NAV_ITEMS.map((item) => ({
  ...item,
  icon: NAV_ICONS[item.section],
}));

export function Sidebar({ companyName }: { companyName: string }) {
  const pathname = usePathname();
  const [isResetting, startReset] = useTransition();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-card/70 backdrop-blur-xl lg:flex">
      <Link href="/" className="flex items-center gap-2.5 px-6 pt-7 pb-8">
        <span className="flex size-8 items-center justify-center rounded-[10px] bg-accent text-[15px] font-bold text-white">
          D
        </span>
        <span className="text-[19px] font-semibold tracking-tight">Driva</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isSectionActive(pathname, href);
          return (
            <Link
              key={href}
              href={href as never}
              className={cx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors",
                active
                  ? "bg-ink text-white font-medium shadow-sm"
                  : "text-soft hover:bg-ink/5 hover:text-ink"
              )}
            >
              <Icon className={cx("size-[18px]", active ? "text-white" : "text-muted")} strokeWidth={2} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line px-6 py-4">
        <p className="truncate text-[13px] font-medium text-ink">{companyName}</p>
        <Link
          href="/installningar"
          className={cx(
            "mt-1 block text-xs transition-colors",
            pathname.startsWith("/installningar") || pathname.startsWith("/foretag")
              ? "font-medium text-ink"
              : "text-muted hover:text-ink"
          )}
        >
          Inställningar
        </Link>
        <button
          onClick={() => startReset(async () => resetDemoAction())}
          disabled={isResetting}
          className="mt-1 flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-ink disabled:opacity-50"
        >
          <RotateCcw className="size-3" />
          {isResetting ? "Återställer …" : "Återställ demodata"}
        </button>
      </div>
    </aside>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = NAV.slice(0, 4);
  const more = NAV.slice(4);
  const settingsActive = pathname.startsWith("/installningar") || pathname.startsWith("/foretag");
  const moreActive = more.some((m) => isSectionActive(pathname, m.href)) || settingsActive;

  return (
    <>
      {moreOpen ? (
        <div className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px] lg:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute inset-x-3 bottom-24 rounded-3xl bg-card p-2 shadow-pop animate-fade-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <p className="text-sm font-semibold text-ink">Mer</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Stäng"
                className="rounded-lg p-1 text-muted hover:bg-ink/5"
              >
                <X className="size-4" />
              </button>
            </div>
            {more.map(({ href, label, icon: Icon }) => {
              const active = isSectionActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href as never}
                  onClick={() => setMoreOpen(false)}
                  className={cx(
                    "flex items-center gap-3 rounded-2xl px-4 py-3.5 text-[15px] hover:bg-canvas",
                    active ? "bg-ink/5 font-medium text-ink" : "text-ink"
                  )}
                >
                  <Icon className="size-5 text-muted" />
                  {label}
                </Link>
              );
            })}
            <div className="mx-4 my-1 h-px bg-line" />
            <Link
              href="/installningar"
              onClick={() => setMoreOpen(false)}
              className={cx(
                "flex items-center gap-3 rounded-2xl px-4 py-3.5 text-[15px] hover:bg-canvas",
                pathname.startsWith("/installningar") || pathname.startsWith("/foretag")
                  ? "bg-ink/5 font-medium text-ink"
                  : "text-ink"
              )}
            >
              <Settings className="size-5 text-muted" />
              Inställningar
            </Link>
          </div>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-line bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        {primary.map(({ href, label, icon: Icon }) => {
          const active = isSectionActive(pathname, href);
          return (
            <Link
              key={href}
              href={href as never}
              className={cx(
                "flex flex-1 flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-medium",
                active ? "text-ink" : "text-muted"
              )}
            >
              <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} />
              {label}
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          className={cx(
            "flex flex-1 flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-medium",
            moreActive || moreOpen ? "text-ink" : "text-muted"
          )}
        >
          <MoreHorizontal className="size-[22px]" strokeWidth={1.8} />
          Mer
        </button>
      </nav>
    </>
  );
}
