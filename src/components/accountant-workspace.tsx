import Link from "next/link";
import { datumKort, kr } from "@/lib/format";
import { cx } from "./ui";

export const CLIENT_TABS = [
  { key: "arbeta", label: "Arbeta", href: "" },
  { key: "verifikationer", label: "Verifikationer", href: "/verifikationer" },
  { key: "bank", label: "Bank", href: "/bank" },
  { key: "moms", label: "Moms", href: "/moms" },
  { key: "rapporter", label: "Rapporter", href: "/rapporter" },
  { key: "bokslut", label: "Bokslut", href: "/bokslut" },
] as const;

export type ClientTabKey = (typeof CLIENT_TABS)[number]["key"];

export function accountantStatusText(input: {
  bookedThrough?: string;
  bankOk: boolean;
  bankUnexplained?: number;
  nextVatDue?: string;
}): string {
  const parts: string[] = [];
  parts.push(
    input.bookedThrough ? `Bokföring uppdaterad t.o.m. ${datumKort(input.bookedThrough)}` : "Bokföring öppen"
  );
  if (input.bankOk) parts.push("Bank avstämd ✓");
  else if (input.bankUnexplained && Math.abs(input.bankUnexplained) >= 1) {
    parts.push(`Bank differens ${kr(Math.abs(input.bankUnexplained))}`);
  } else {
    parts.push("Bank ej avstämd");
  }
  if (input.nextVatDue) parts.push(`Nästa moms ${datumKort(input.nextVatDue)}`);
  return parts.join(" · ");
}

export function AccountantClientTabs({
  businessId,
  active,
}: {
  businessId: string;
  active: ClientTabKey;
}) {
  return (
    <nav className="mb-5 flex flex-wrap gap-1 border-b border-line">
      {CLIENT_TABS.map((t) => {
        const href = `/redovisning/k/${businessId}${t.href}`;
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={href as never}
            className={cx(
              "px-3 py-2 text-[13px]",
              on ? "border-b-2 border-ink font-medium text-ink" : "text-soft hover:text-ink"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
