"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Home,
  Users,
  Wallet,
  Inbox,
  BookOpenCheck,
  Globe,
  MoreHorizontal,
  Settings,
  X,
} from "lucide-react";
import { cx } from "./ui";
import { LogoutRow } from "./logout-button";
import { isSectionActive, NAV_ITEMS, type NavSection } from "@/lib/nav";

const NAV_ICONS: Record<NavSection, typeof Home> = {
  hem: Home,
  kunder: Users,
  ekonomi: Wallet,
  inbox: Inbox,
  bokforing: BookOpenCheck,
  hemsida: Globe,
};

const NAV = NAV_ITEMS.map((item) => ({
  ...item,
  icon: NAV_ICONS[item.section],
}));

export function Sidebar({
  companyName,
  inboxCount = 0,
  canLogout = false,
}: {
  companyName: string;
  inboxCount?: number;
  /** Logga ut visas bara i Supabase-läge – JSON-/demoläget har inga sessioner. */
  canLogout?: boolean;
}) {
  const pathname = usePathname();
  const settingsActive = pathname.startsWith("/installningar") || pathname.startsWith("/foretag");

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
              aria-label={href === "/inbox" && inboxCount > 0 ? `Inbox, ${inboxCount} öppna` : label}
              className={cx(
                "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors",
                active
                  ? "bg-ink text-white font-medium shadow-sm"
                  : "text-soft hover:bg-ink/5 hover:text-ink"
              )}
            >
              <Icon className={cx("size-[18px]", active ? "text-white" : "text-muted")} strokeWidth={2} />
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                {label}
                {href === "/inbox" && inboxCount > 0 ? (
                  <span
                    className={cx(
                      "rounded-full px-1.5 py-px text-[11px] font-medium tabular",
                      active ? "bg-white/15 text-white/80" : "bg-ink/6 text-muted"
                    )}
                  >
                    {inboxCount}
                  </span>
                ) : null}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Fot: företagsnamnet är ren kontext (ej klickbart); Inställningar är en
          riktig nav-rad och Logga ut en dämpad rad (endast Supabase-läge). */}
      <div className="flex flex-col gap-1 border-t border-line px-3 py-4">
        <p className="truncate px-3 pb-1 text-[13px] font-medium text-soft">{companyName}</p>
        <Link
          href="/installningar"
          aria-current={settingsActive ? "page" : undefined}
          className={cx(
            "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            settingsActive
              ? "bg-ink text-white font-medium shadow-sm"
              : "text-soft hover:bg-ink/5 hover:text-ink"
          )}
        >
          <Settings className={cx("size-[18px]", settingsActive ? "text-white" : "text-muted")} strokeWidth={2} />
          Inställningar
        </Link>
        {canLogout ? <LogoutRow variant="sidebar" /> : null}
      </div>
    </aside>
  );
}

export function BottomNav({ canLogout = false, inboxCount = 0 }: { canLogout?: boolean; inboxCount?: number }) {
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
            role="dialog"
            aria-label="Mer"
            className="absolute inset-x-3 bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+0.75rem)] rounded-3xl bg-card p-2 shadow-pop animate-fade-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <p className="text-sm font-semibold text-ink">Mer</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Stäng"
                className="-my-2 flex size-10 items-center justify-center rounded-lg text-muted hover:bg-ink/5"
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
            {canLogout ? <LogoutRow variant="sheet" /> : null}
          </div>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom))] items-stretch border-t border-line bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        {primary.map(({ href, label, icon: Icon }) => {
          const active = isSectionActive(pathname, href);
          return (
            <Link
              key={href}
              href={href as never}
              aria-label={href === "/inbox" && inboxCount > 0 ? `Inbox, ${inboxCount} öppna` : label}
              className={cx(
                "relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                active ? "text-ink" : "text-muted"
              )}
            >
              <span className="relative">
                <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} />
                {href === "/inbox" && inboxCount > 0 ? (
                  <span className="absolute -right-2.5 -top-1 min-w-4 rounded-full bg-ink px-1 text-center text-[10px] font-medium leading-4 text-white tabular">
                    {inboxCount > 99 ? "99+" : inboxCount}
                  </span>
                ) : null}
              </span>
              <span className="max-w-full truncate">{label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className={cx(
            "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium",
            moreActive || moreOpen ? "text-ink" : "text-muted"
          )}
        >
          <MoreHorizontal className="size-[22px]" strokeWidth={1.8} />
          <span className="max-w-full truncate">Mer</span>
        </button>
      </nav>
    </>
  );
}
