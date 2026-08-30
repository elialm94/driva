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
  Handshake,
  Globe,
  LifeBuoy,
  MoreHorizontal,
  Settings,
  X,
} from "lucide-react";
import { cx } from "./ui";
import { CreateAccountRow, DemoBadge, EndDemoRow } from "./demo-controls";
import { LogoutRow } from "./logout-button";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { enterLocalAccountantDemoAction } from "@/app/collaboration-actions";
import { isSectionActive, NAV_ITEMS, type NavSection } from "@/lib/nav";

const NAV_ICONS: Record<NavSection, typeof Home> = {
  hem: Home,
  kunder: Users,
  ekonomi: Wallet,
  inbox: Inbox,
  bokforing: BookOpenCheck,
  samarbeta: Handshake,
  hemsida: Globe,
};

const NAV = NAV_ITEMS.map((item) => ({
  ...item,
  icon: NAV_ICONS[item.section],
}));

/** Tal i nav = något väntar på dig. Bara Inbox och Bokföring. 0 = ingen badge. */
function navAttentionCount(href: string, inboxCount: number, bokforingCount: number): number {
  if (href === "/inbox") return inboxCount;
  if (href === "/bokforing") return bokforingCount;
  return 0;
}

function navAttentionAriaLabel(href: string, label: string, count: number): string {
  if (count <= 0) return label;
  if (href === "/inbox") return `Inbox, ${count} öppna`;
  if (href === "/bokforing") {
    return count === 1
      ? "Bokföring, 1 bokföringsfråga att lösa"
      : `Bokföring, ${count} bokföringsfrågor att lösa`;
  }
  return label;
}

function formatNavCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** Neutral sidobadge – samma stil för Inbox och Bokföring, inte röd varning. */
function SidebarCountBadge({ count, active }: { count: number; active: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={cx(
        "rounded-full px-1.5 py-px text-[11px] font-medium tabular",
        active ? "bg-white/15 text-white/80" : "bg-ink/6 text-muted"
      )}
    >
      {formatNavCount(count)}
    </span>
  );
}

function TabCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-2.5 -top-1 min-w-4 rounded-full bg-ink px-1 text-center text-[10px] font-medium leading-4 text-white tabular">
      {formatNavCount(count)}
    </span>
  );
}

export function Sidebar({
  companyName,
  inboxCount = 0,
  bokforingCount = 0,
  canLogout = false,
  accountingClientCount = 0,
  localAccountantDemo = false,
  demoBadge = false,
  demoSession = false,
}: {
  companyName: string;
  inboxCount?: number;
  bokforingCount?: number;
  /** Logga ut visas bara i Supabase-läge – JSON-/demoläget har inga sessioner. */
  canLogout?: boolean;
  /** Visas när samma användare också är konsult på andra företag. */
  accountingClientCount?: number;
  localAccountantDemo?: boolean;
  /** Demoläge (lokala JSON-demon eller publika demosessionen): visa markören. */
  demoBadge?: boolean;
  /** Publika demosessionen: Avsluta demo/Skapa eget konto ersätter Logga ut. */
  demoSession?: boolean;
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
          const count = navAttentionCount(href, inboxCount, bokforingCount);
          return (
            <Link
              key={href}
              href={href as never}
              aria-label={navAttentionAriaLabel(href, label, count)}
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
                <SidebarCountBadge count={count} active={active} />
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Fot: företagsnamnet är ren kontext (ej klickbart); Inställningar är en
          riktig nav-rad och Logga ut en dämpad rad (endast Supabase-läge). */}
      <div className="flex flex-col gap-1 border-t border-line px-3 py-4">
        <p className="flex items-center gap-2 px-3 pb-1 text-[13px] font-medium text-soft">
          <span className="truncate">{companyName}</span>
          {demoBadge ? <DemoBadge className="shrink-0" /> : null}
        </p>
        {accountingClientCount > 0 ? (
          <WorkspaceSwitcher
            variant="to-redovisning"
            clientCount={accountingClientCount}
            localDemo={localAccountantDemo}
          />
        ) : null}
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
        <Link
          href={(`/support?fran=${encodeURIComponent(pathname)}`) as never}
          className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-soft transition-colors hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <LifeBuoy className="size-[18px] text-muted" strokeWidth={2} />
          Hjälp & support
        </Link>
        {demoSession ? (
          <>
            <CreateAccountRow variant="sidebar" />
            <EndDemoRow variant="sidebar" />
          </>
        ) : canLogout ? (
          <LogoutRow variant="sidebar" />
        ) : null}
      </div>
    </aside>
  );
}

export function BottomNav({
  canLogout = false,
  inboxCount = 0,
  bokforingCount = 0,
  localAccountantDemo = false,
  demoBadge = false,
  demoSession = false,
}: {
  canLogout?: boolean;
  inboxCount?: number;
  bokforingCount?: number;
  localAccountantDemo?: boolean;
  demoBadge?: boolean;
  demoSession?: boolean;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = NAV.slice(0, 4);
  const more = NAV.slice(4);
  const settingsActive = pathname.startsWith("/installningar") || pathname.startsWith("/foretag");
  const moreActive = more.some((m) => isSectionActive(pathname, m.href)) || settingsActive;
  const moreCount = more.reduce((n, item) => n + navAttentionCount(item.href, inboxCount, bokforingCount), 0);

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
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                Mer
                {demoBadge ? <DemoBadge /> : null}
              </p>
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
              const count = navAttentionCount(href, inboxCount, bokforingCount);
              return (
                <Link
                  key={href}
                  href={href as never}
                  onClick={() => setMoreOpen(false)}
                  aria-label={navAttentionAriaLabel(href, label, count)}
                  className={cx(
                    "flex items-center gap-3 rounded-2xl px-4 py-3.5 text-[15px] hover:bg-canvas",
                    active ? "bg-ink/5 font-medium text-ink" : "text-ink"
                  )}
                >
                  <Icon className="size-5 text-muted" />
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    {label}
                    <SidebarCountBadge count={count} active={false} />
                  </span>
                </Link>
              );
            })}
            <div className="mx-4 my-1 h-px bg-line" />
            {localAccountantDemo ? (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  void enterLocalAccountantDemoAction();
                }}
                className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-[15px] text-ink hover:bg-canvas"
              >
                <BookOpenCheck className="size-5 text-muted" />
                Redovisning
              </button>
            ) : null}
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
            <Link
              href={(`/support?fran=${encodeURIComponent(pathname)}`) as never}
              onClick={() => setMoreOpen(false)}
              className="flex items-center gap-3 rounded-2xl px-4 py-3.5 text-[15px] text-ink hover:bg-canvas"
            >
              <LifeBuoy className="size-5 text-muted" />
              Hjälp & support
            </Link>
            {demoSession ? (
              <>
                <CreateAccountRow variant="sheet" />
                <EndDemoRow variant="sheet" />
              </>
            ) : canLogout ? (
              <LogoutRow variant="sheet" />
            ) : null}
          </div>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom))] items-stretch border-t border-line bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        {primary.map(({ href, label, icon: Icon }) => {
          const active = isSectionActive(pathname, href);
          const count = navAttentionCount(href, inboxCount, bokforingCount);
          return (
            <Link
              key={href}
              href={href as never}
              aria-label={navAttentionAriaLabel(href, label, count)}
              className={cx(
                "relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                active ? "text-ink" : "text-muted"
              )}
            >
              <span className="relative">
                <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} />
                <TabCountBadge count={count} />
              </span>
              <span className="max-w-full truncate">{label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          aria-label={moreCount > 0 ? `Mer, ${moreCount} att lösa` : "Mer"}
          className={cx(
            "relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium",
            moreActive || moreOpen ? "text-ink" : "text-muted"
          )}
        >
          <span className="relative">
            <MoreHorizontal className="size-[22px]" strokeWidth={1.8} />
            <TabCountBadge count={moreCount} />
          </span>
          <span className="max-w-full truncate">Mer</span>
        </button>
      </nav>
    </>
  );
}
