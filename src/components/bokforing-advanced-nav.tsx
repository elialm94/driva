"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BOKFORING_DETAIL_TABS,
  BOKFORING_REPORT_TABS,
  bokforingDetailTabForPath,
} from "@/lib/nav";
import { cx } from "./ui";

/** Flikrad för den avancerade bokföringsvyn. Återanvänds på befintliga undersidor. */
export function BokforingAdvancedTabs() {
  const pathname = usePathname();
  const active = bokforingDetailTabForPath(pathname);
  const reportsOpen = active === "rapporter";

  return (
    <div className="mb-6 print:hidden">
      <div className="flex gap-1 overflow-x-auto rounded-2xl bg-ink/4 p-1">
        {BOKFORING_DETAIL_TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href as never}
            className={cx(
              "flex-1 whitespace-nowrap rounded-xl px-4 py-2 text-center text-sm font-medium transition-all",
              active === t.key ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {reportsOpen ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {BOKFORING_REPORT_TABS.map((t) => (
            <Link
              key={t.key}
              href={t.href as never}
              className={cx(
                "rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors",
                pathname === t.href ? "bg-ink text-white" : "bg-canvas text-soft hover:bg-line/60"
              )}
            >
              {t.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
