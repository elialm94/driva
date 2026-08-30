import Link from "next/link";
import type { AccountantFilter } from "@/lib/collaboration/issues";
import { cx } from "./ui";

export const ACCOUNTANT_FILTERS: { key: AccountantFilter; label: string }[] = [
  { key: "alla", label: "Alla" },
  { key: "forsenat", label: "Försenat" },
  { key: "moms", label: "Moms" },
  { key: "bank", label: "Bank" },
  { key: "underlag", label: "Underlag" },
  { key: "granskning", label: "Granskning" },
  { key: "vantar", label: "Väntar" },
];

export function AccountantFilters({
  active,
  counts,
  hrefFor,
}: {
  active: AccountantFilter;
  counts?: Partial<Record<AccountantFilter, number>>;
  hrefFor: (key: AccountantFilter) => string;
}) {
  return (
    <div className="mb-5 flex flex-wrap gap-1.5">
      {ACCOUNTANT_FILTERS.map((f) => {
        const n = counts?.[f.key];
        return (
          <Link
            key={f.key}
            href={hrefFor(f.key) as never}
            className={cx(
              "rounded-full px-2.5 py-1 text-[12px] font-medium",
              active === f.key ? "bg-ink text-white" : "bg-ink/6 text-soft hover:bg-ink/10"
            )}
          >
            {f.label}
            {n != null && n > 0 ? <span className="tabular-nums opacity-80"> {n}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}
