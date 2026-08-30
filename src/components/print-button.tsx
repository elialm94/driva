"use client";

import { Printer } from "lucide-react";
import { buttonClasses, cx } from "./ui";

export function PrintButton({ className, label = "Skriv ut / PDF" }: { className?: string; label?: string }) {
  return (
    <button type="button" className={cx(buttonClasses("secondary", "sm"), "print:hidden", className)} onClick={() => window.print()}>
      <Printer className="size-3.5" />
      {label}
    </button>
  );
}
