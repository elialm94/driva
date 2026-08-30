"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListTodo, Settings } from "lucide-react";
import { ClientSwitcher } from "./client-switcher";
import { LogoutRow } from "./logout-button";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { arbetaHref, isArbetaPath, parseSelectedClientId } from "@/lib/collaboration/switch";
import { cx } from "./ui";

export function RedovisningSidebar({
  userName,
  clientCount,
  canSwitchToOwner,
  clients,
  canLogout,
}: {
  userName: string;
  clientCount: number;
  canSwitchToOwner: boolean;
  clients: { id: string; name: string }[];
  canLogout: boolean;
}) {
  const pathname = usePathname();
  const selectedId = parseSelectedClientId(pathname);
  const arbeta = arbetaHref(selectedId);

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-card/70 backdrop-blur-xl lg:flex">
      <Link href="/redovisning" className="flex items-center gap-2.5 px-6 pt-7 pb-6">
        <span className="flex size-8 items-center justify-center rounded-[10px] bg-ink text-[13px] font-bold text-white">
          R
        </span>
        <span className="text-[17px] font-semibold tracking-tight">Redovisning</span>
      </Link>

      <div className="px-3 pb-3">
        <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Klient</p>
        <div className="mt-1">
          <ClientSwitcher clients={clients} />
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        <Link
          href={arbeta as never}
          className={cx(
            "flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-[14px] transition-colors",
            isArbetaPath(pathname) ? "bg-ink text-white font-medium" : "text-soft hover:bg-ink/5 hover:text-ink"
          )}
        >
          <ListTodo className="size-[18px]" />
          Arbeta
        </Link>
      </nav>

      <div className="flex flex-col gap-1 border-t border-line px-3 py-4">
        <p className="truncate px-3 pb-1 text-[13px] font-medium text-soft">{userName}</p>
        {canSwitchToOwner ? <WorkspaceSwitcher variant="to-owner" localDemo={!canLogout} /> : null}
        <p className="px-3 text-[12px] text-muted">
          {clientCount} {clientCount === 1 ? "klient" : "klienter"}
        </p>
        <Link
          href="/redovisning/installningar"
          className={cx(
            "flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-[14px]",
            pathname.startsWith("/redovisning/installningar")
              ? "bg-ink text-white font-medium"
              : "text-soft hover:bg-ink/5"
          )}
        >
          <Settings className="size-[18px]" />
          Inställningar
        </Link>
        {canLogout ? <LogoutRow variant="sidebar" /> : null}
      </div>
    </aside>
  );
}

export function RedovisningMobileHeader({ clients }: { clients: { id: string; name: string }[] }) {
  return (
    <div className="sticky top-0 z-20 border-b border-line bg-canvas/90 px-4 py-2.5 backdrop-blur-xl lg:hidden">
      <ClientSwitcher clients={clients} />
    </div>
  );
}

export function RedovisningMobileNav() {
  const pathname = usePathname();
  const selectedId = parseSelectedClientId(pathname);
  const arbeta = arbetaHref(selectedId);
  const active = isArbetaPath(pathname);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom))] items-stretch border-t border-line bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <Link
        href={arbeta as never}
        className={cx(
          "flex min-h-11 flex-1 flex-col items-center justify-center text-[11px] font-medium",
          active ? "text-ink" : "text-muted"
        )}
      >
        Arbeta
      </Link>
    </nav>
  );
}
