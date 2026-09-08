import Link from "next/link";
import { cx } from "./ui";

export interface FiscalYearOption {
  id: string;
  label: string;
  status: "oppet" | "stangt";
}

/**
 * Årsväljare för Huvudbok, Rapporter, Moms och Bokslut.
 * Syns bara när företaget har mer än ett räkenskapsår.
 */
export function FiscalYearPicker({
  years,
  activeLabel,
  hrefFor,
}: {
  years: FiscalYearOption[];
  activeLabel: string;
  hrefFor: (year: FiscalYearOption) => string;
}) {
  if (years.length <= 1) return null;
  return (
    <div className="mb-5 flex flex-wrap gap-1.5 print:hidden">
      {years.map((f) => (
        <Link
          key={f.id}
          href={hrefFor(f) as never}
          className={cx(
            "rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors",
            activeLabel === f.label ? "bg-ink text-white" : "bg-canvas text-soft hover:bg-line/60"
          )}
        >
          {f.label}
          {f.status === "stangt" ? " (stängt)" : ""}
        </Link>
      ))}
    </div>
  );
}

export function fiscalYearHref(path: string, year: FiscalYearOption, extra?: Record<string, string>): string {
  const params = new URLSearchParams(extra);
  params.set("ar", year.label);
  return `${path}?${params}`;
}
