"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { buttonClasses } from "./ui";

/** Verktygsrad över A4-arket – endast skärm (no-print), följer aldrig med i utskriften. */
export function PdfPrintBar({
  backHref,
  backLabel,
  printLabel = "Skriv ut eller spara som PDF",
}: {
  backHref: string;
  backLabel: string;
  printLabel?: string;
}) {
  return (
    <div className="no-print sticky top-0 z-10 border-b border-line bg-card/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[210mm] items-center justify-between gap-3 px-4 py-2.5 min-[860px]:px-0">
        <Link href={backHref} className={buttonClasses("ghost", "sm")}>
          <ArrowLeft className="size-3.5" />
          {backLabel}
        </Link>
        <button type="button" className={buttonClasses("primary", "sm")} onClick={() => window.print()}>
          <Printer className="size-3.5" />
          {printLabel}
        </button>
      </div>
    </div>
  );
}
