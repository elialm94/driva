"use client";

import type { LabelHTMLAttributes, ReactNode } from "react";
import { cx } from "./ui";

/**
 * Stor, tryckvänlig valknapp (≥ 44 px) för radio-/checkbox-val i onboarding
 * och Kom igång. Själva inputen ligger inuti (sr-only) så tangentbord och
 * skärmläsare fungerar som för vanliga formulärfält.
 */
export function ChoiceChip({
  checked,
  children,
  className,
  ...rest
}: { checked: boolean; children: ReactNode; className?: string } & Omit<
  LabelHTMLAttributes<HTMLLabelElement>,
  "className" | "children"
>) {
  return (
    <label
      className={cx(
        "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[15px] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
        checked ? "border-ink bg-ink text-white" : "border-line-strong bg-card text-ink hover:border-muted/60",
        className,
      )}
      {...rest}
    >
      {children}
    </label>
  );
}
