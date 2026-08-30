"use client";

/**
 * Skal för Driva Admin – medvetet mörkt och tydligt SKILT från kundappen så
 * att en operatör aldrig tvekar om vilken yta hen arbetar i. Navigationen är
 * exakt: Översikt, Support, Företag, Användare, System (+ Admins för
 * super_admin). Menyvalen här är bara UI – behörigheten prövas alltid på
 * servern (layout + varje server action).
 */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import {
  Building2,
  Gauge,
  LifeBuoy,
  Search,
  ServerCog,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cx } from "@/components/ui";

const NAV: { href: string; label: string; icon: typeof Gauge; exact?: boolean }[] = [
  { href: "/admin", label: "Översikt", icon: Gauge, exact: true },
  { href: "/admin/support", label: "Support", icon: LifeBuoy },
  { href: "/admin/businesses", label: "Företag", icon: Building2 },
  { href: "/admin/users", label: "Användare", icon: Users },
  { href: "/admin/system", label: "System", icon: ServerCog },
];

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function GlobalSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const initial = pathname === "/admin/search" ? (params.get("q") ?? "") : "";
  return (
    <form
      action={(formData) => {
        const q = String(formData.get("q") ?? "").trim();
        if (q) router.push(`/admin/search?q=${encodeURIComponent(q)}`);
      }}
      className="relative w-full max-w-sm"
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
      <input
        type="search"
        name="q"
        defaultValue={initial}
        placeholder="Sök e-post, företag, orgnr, ärende …"
        className="h-9 w-full rounded-lg border border-neutral-700 bg-neutral-800/80 pl-9 pr-3 text-[13px] text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none"
      />
    </form>
  );
}

export function AdminShell({
  children,
  adminName,
  roleLabel,
  isSuperAdmin,
  openTickets,
  supportBusinessName,
}: {
  children: ReactNode;
  adminName: string;
  roleLabel: string;
  isSuperAdmin: boolean;
  openTickets: number;
  /** Namn på företaget i ev. aktiv supportsession (visas som varning i skalet). */
  supportBusinessName?: string;
}) {
  const pathname = usePathname();
  const items = isSuperAdmin
    ? [...NAV, { href: "/admin/admins", label: "Admins", icon: ShieldCheck }]
    : NAV;

  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      {/* Sidopanel (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-neutral-800 bg-neutral-900 lg:flex">
        <Link href="/admin" className="flex items-center gap-2.5 px-5 pt-6 pb-5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-amber-400 text-[13px] font-bold text-neutral-950">
            DA
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Driva Admin</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {items.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href, href === "/admin");
            return (
              <Link
                key={href}
                href={href as never}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13.5px] transition-colors",
                  active
                    ? "bg-neutral-800 font-medium text-white"
                    : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
                )}
              >
                <Icon className="size-4" strokeWidth={2} />
                {label}
                {href === "/admin/support" && openTickets > 0 ? (
                  <span className="ml-auto rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-300">
                    {openTickets}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="flex flex-col gap-1 border-t border-neutral-800 px-4 py-4 text-[12.5px]">
          <p className="truncate font-medium text-neutral-200">{adminName}</p>
          <p className="text-neutral-500">{roleLabel}</p>
          <Link href="/" className="mt-2 text-neutral-400 underline-offset-2 hover:text-neutral-100 hover:underline">
            Till Driva (kundappen) →
          </Link>
        </div>
      </aside>

      {/* Topprad: global sök + ev. supportläges-indikator */}
      <div className="lg:pl-56">
        <header className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
            <Link href="/admin" className="flex items-center gap-2 lg:hidden">
              <span className="flex size-7 items-center justify-center rounded-md bg-amber-400 text-[11px] font-bold text-neutral-950">
                DA
              </span>
            </Link>
            <Suspense fallback={<div className="h-9 w-full max-w-sm" />}>
              <GlobalSearch />
            </Suspense>
            {supportBusinessName ? (
              <Link
                href="/"
                className="ml-auto hidden shrink-0 items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-1.5 text-[12px] font-medium text-amber-300 sm:flex"
              >
                Supportläge: {supportBusinessName} →
              </Link>
            ) : null}
          </div>
          {/* Mobilnav: horisontell lista – tabellerna är desktop-först men
              ärenden/sök/system ska gå att nå från mobilen. */}
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2 lg:hidden">
            {items.map(({ href, label }) => {
              const active = isActive(pathname, href, href === "/admin");
              return (
                <Link
                  key={href}
                  href={href as never}
                  className={cx(
                    "shrink-0 rounded-lg px-3 py-1.5 text-[13px]",
                    active ? "bg-neutral-800 font-medium text-white" : "text-neutral-400"
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </header>
        <main className="min-h-dvh px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
