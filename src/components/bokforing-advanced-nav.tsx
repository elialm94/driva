"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BOKFORING_DETAIL_TABS,
  BOKFORING_PREFETCH_HREFS,
  BOKFORING_REPORT_TABS,
  bokforingDetailTabForPath,
} from "@/lib/nav";
import { cx } from "./ui";

/**
 * Flikrad i den delade bokföringslayouten. prefetch={true} hämtar hela
 * dynamiska RSC-sidan (inte bara loading-skalet). Klick markerar fliken
 * direkt; innehållet byts när nästa vy är klar.
 */
export function BokforingAdvancedTabs() {
  const pathname = usePathname();
  const active = bokforingDetailTabForPath(pathname);
  const reportsOpen = active === "rapporter";
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  useEffect(() => {
    setPendingKey(null);
  }, [pathname]);

  const selected = pendingKey ?? active;

  return (
    <div className="mb-6 print:hidden">
      <div className="flex gap-1 overflow-x-auto rounded-2xl bg-ink/4 p-1">
        {BOKFORING_DETAIL_TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href as never}
            prefetch={true}
            onClick={() => setPendingKey(t.key)}
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
              prefetch={true}
              onClick={() => setPendingKey("rapporter")}
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
      <BokforingRoutePrefetch />
    </div>
  );
}

/** Next.js inbyggda router.prefetch – värmer även rapportvyer som inte syns. */
function BokforingRoutePrefetch() {
  const router = useRouter();
  useEffect(() => {
    for (const href of BOKFORING_PREFETCH_HREFS) {
      router.prefetch(href);
    }
  }, [router]);
  return null;
}

function BokforingTabLabel({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={cx(pending && "bokforing-tab-pending")}>{children}</span>;
}
