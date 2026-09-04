"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Home,
  Hammer,
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
import { CreateAccountRow } from "./demo-controls";
import { DemoMenu } from "./demo-menu";
import { LogoutRow } from "./logout-button";
import { WorkspaceSwitcher } from "./workspace-switcher";
import {
  isSectionActive,
  isSettingsPath,
  isSupportPath,
  moreNavItems,
  primaryNavItems,
  type NavItem,
  type NavSection,
} from "@/lib/nav";
import type { ResolvedOptionalFeatures } from "@/lib/optional-features";

const NAV_ICONS: Record<NavSection, typeof Home> = {
  hem: Home,
  uppdrag: Hammer,
  kunder: Users,
  ekonomi: Wallet,
  inbox: Inbox,
  bokforing: BookOpenCheck,
  samarbeta: Handshake,
  hemsida: Globe,
};

function withIcons(items: NavItem[]) {
  return items.map((item) => ({ ...item, icon: NAV_ICONS[item.section] }));
}

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

/** Samma valda tillstånd i sidomenyn och foten: mjuk fyllning, inte svart primärknapp. */
const SIDEBAR_LINK =
  "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const SIDEBAR_LINK_ACTIVE = "bg-ink/5 font-medium text-ink";
const SIDEBAR_LINK_IDLE = "text-soft hover:bg-ink/5 hover:text-ink";

const SHEET_LINK = "flex items-center gap-3 rounded-2xl px-4 py-3.5 text-[15px] hover:bg-canvas";
const SHEET_LINK_ACTIVE = "bg-ink/5 font-medium text-ink";
const SHEET_LINK_IDLE = "text-ink";

/** Neutral sidobadge – samma stil för Inbox och Bokföring, inte röd varning. */
function SidebarCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="rounded-full bg-ink/6 px-1.5 py-px text-[11px] font-medium tabular text-muted">
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
  demoBadge = false,
  demoSession = false,
  features,
}: {
  companyName: string;
  inboxCount?: number;
  bokforingCount?: number;
  /** Logga ut visas bara i Supabase-läge – JSON-/demoläget har inga sessioner. */
  canLogout?: boolean;
  /** Visas när samma användare också är konsult på andra företag. */
  accountingClientCount?: number;
  /** Demoläge (lokala JSON-demon eller publika demosessionen): visa markören. */
  demoBadge?: boolean;
  /** Publika demosessionen: Avsluta demo/Skapa eget konto ersätter Logga ut. */
  demoSession?: boolean;
  features: ResolvedOptionalFeatures;
}) {
  const pathname = usePathname();
  const settingsActive = isSettingsPath(pathname);
  const supportActive = isSupportPath(pathname);
  const primary = withIcons(primaryNavItems(features));
  const more = withIcons(moreNavItems(features));

  const renderItem = ({ href, label, icon: Icon }: (typeof primary)[number]) => {
    const active = isSectionActive(pathname, href);
    const count = navAttentionCount(href, inboxCount, bokforingCount);
    return (
      <Link
        key={href}
        href={href as never}
        aria-label={navAttentionAriaLabel(href, label, count)}
        aria-current={active ? "page" : undefined}
        className={cx(SIDEBAR_LINK, active ? SIDEBAR_LINK_ACTIVE : SIDEBAR_LINK_IDLE)}
      >
        <Icon className="size-[18px] text-muted" strokeWidth={2} />
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
          {label}
          <SidebarCountBadge count={count} />
        </span>
      </Link>
    );
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-card/70 backdrop-blur-xl lg:flex">
      <Link href="/" className="flex items-center gap-2.5 px-6 pt-7 pb-8">
        <span className="flex size-8 items-center justify-center rounded-[10px] bg-accent text-[15px] font-bold text-white">
          D
        </span>
        <span className="text-[19px] font-semibold tracking-tight">Driva</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
        {primary.map(renderItem)}

        {/* Mer: sekundära ytor i en tydlig men diskret grupp. Alltid utfälld på
            desktop så att Inbox/Bokförings-badgen syns utan klick. */}
        <p
          id="sidebar-mer-rubrik"
          className="mt-5 mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted"
        >
          Mer
        </p>
        <div aria-labelledby="sidebar-mer-rubrik" className="flex flex-col gap-1" data-nav-group="mer">
          {more.map(renderItem)}
          <Link
            href="/installningar"
            aria-current={settingsActive ? "page" : undefined}
            className={cx(SIDEBAR_LINK, settingsActive ? SIDEBAR_LINK_ACTIVE : SIDEBAR_LINK_IDLE)}
          >
            <Settings className="size-[18px] text-muted" strokeWidth={2} />
            Inställningar
          </Link>
          <Link
            href={(`/support?fran=${encodeURIComponent(pathname)}`) as never}
            aria-current={supportActive ? "page" : undefined}
            className={cx(SIDEBAR_LINK, supportActive ? SIDEBAR_LINK_ACTIVE : SIDEBAR_LINK_IDLE)}
          >
            <LifeBuoy className="size-[18px] text-muted" strokeWidth={2} />
            Hjälp & support
          </Link>
        </div>
      </nav>

      {/* Fot: företagsnamnet är ren kontext (ej klickbart) och Logga ut en
          dämpad rad (endast Supabase-läge). I demoläge blir raden i stället
          knappen till demo-menyn, som samlar redovisningsvyn, återställ och
          avsluta – sidomenyn hålls identisk med den en vanlig användare ser. */}
      <div className="flex flex-col gap-1 border-t border-line px-3 py-4">
        {demoBadge ? (
          <DemoMenu title={companyName} variant="sidebar" canEndDemo={demoSession} />
        ) : (
          <p className="flex items-center gap-2 px-3 pb-1 text-[13px] font-medium text-soft">
            <span className="truncate">{companyName}</span>
          </p>
        )}
        {!demoBadge && accountingClientCount > 0 ? (
          <WorkspaceSwitcher variant="to-redovisning" clientCount={accountingClientCount} />
        ) : null}
        {demoSession ? (
          <CreateAccountRow variant="sidebar" />
        ) : canLogout ? (
          <LogoutRow variant="sidebar" />
        ) : null}
      </div>
    </aside>
  );
}

export function BottomNav({
  companyName,
  canLogout = false,
  inboxCount = 0,
  bokforingCount = 0,
  demoBadge = false,
  demoSession = false,
  features,
}: {
  companyName: string;
  canLogout?: boolean;
  inboxCount?: number;
  bokforingCount?: number;
  demoBadge?: boolean;
  demoSession?: boolean;
  features: ResolvedOptionalFeatures;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = withIcons(primaryNavItems(features));
  const more = withIcons(moreNavItems(features));
  const settingsActive = isSettingsPath(pathname);
  const supportActive = isSupportPath(pathname);
  const moreActive = more.some((m) => isSectionActive(pathname, m.href)) || settingsActive || supportActive;
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
              {/* Demomarkören sitter på företagsraden nedan – inte här också. */}
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
              const count = navAttentionCount(href, inboxCount, bokforingCount);
              return (
                <Link
                  key={href}
                  href={href as never}
                  onClick={() => setMoreOpen(false)}
                  aria-label={navAttentionAriaLabel(href, label, count)}
                  className={cx(SHEET_LINK, active ? SHEET_LINK_ACTIVE : SHEET_LINK_IDLE)}
                >
                  <Icon className="size-5 text-muted" />
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    {label}
                    <SidebarCountBadge count={count} />
                  </span>
                </Link>
              );
            })}
            <div className="mx-4 my-1 h-px bg-line" />
            {/* Demoåtgärderna fälls ut bakom företagsraden så arket förblir kort. */}
            {demoBadge ? (
              <DemoMenu
                title={companyName}
                variant="sheet"
                canEndDemo={demoSession}
                onNavigate={() => setMoreOpen(false)}
              />
            ) : null}
            <Link
              href="/installningar"
              onClick={() => setMoreOpen(false)}
              aria-current={settingsActive ? "page" : undefined}
              className={cx(SHEET_LINK, settingsActive ? SHEET_LINK_ACTIVE : SHEET_LINK_IDLE)}
            >
              <Settings className="size-5 text-muted" />
              Inställningar
            </Link>
            <Link
              href={(`/support?fran=${encodeURIComponent(pathname)}`) as never}
              onClick={() => setMoreOpen(false)}
              aria-current={supportActive ? "page" : undefined}
              className={cx(SHEET_LINK, supportActive ? SHEET_LINK_ACTIVE : SHEET_LINK_IDLE)}
            >
              <LifeBuoy className="size-5 text-muted" />
              Hjälp & support
            </Link>
            {demoSession ? (
              <CreateAccountRow variant="sheet" />
            ) : canLogout ? (
              <LogoutRow variant="sheet" />
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Fem lika breda flikar (Hem · Uppdrag · Kunder · Ekonomi · Mer); varje
          flik är minst 44px hög och tar hela sin femtedel som tryckyta. */}
      <nav
        aria-label="Huvudnavigation"
        className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom))] items-stretch border-t border-line bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        {primary.map(({ href, label, icon: Icon }) => {
          const active = isSectionActive(pathname, href);
          const count = navAttentionCount(href, inboxCount, bokforingCount);
          return (
            <Link
              key={href}
              href={href as never}
              aria-label={navAttentionAriaLabel(href, label, count)}
              aria-current={active ? "page" : undefined}
              className={cx(
                "relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium",
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
            "relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium",
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
