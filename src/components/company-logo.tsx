import type { CompanySettings } from "@/lib/types";
import { cx } from "./ui";

const sizes = {
  sm: "size-9 text-[12px]",
  md: "size-11 text-[15px]",
  lg: "size-16 text-[18px]",
  /** Inställningar Identitet – ~72×72. */
  xl: "size-[4.5rem] text-[20px]",
} as const;

export function CompanyLogo({
  company,
  size = "md",
  className,
}: {
  company: Pick<CompanySettings, "name" | "logoInitials" | "logoDataUrl">;
  size?: keyof typeof sizes;
  className?: string;
}) {
  if (company.logoDataUrl) {
    return (
      // Data-URL:er – next/image passar inte här.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={company.logoDataUrl}
        alt={company.name}
        className={cx("shrink-0 rounded-xl bg-white object-contain", sizes[size], className)}
      />
    );
  }
  return (
    <div
      className={cx(
        "flex shrink-0 items-center justify-center rounded-xl bg-accent font-bold text-white",
        sizes[size],
        className
      )}
    >
      {company.logoInitials}
    </div>
  );
}
