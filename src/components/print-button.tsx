"use client";

import { Printer } from "lucide-react";
import { buttonClasses } from "./ui";

export function PrintButton() {
  return (
    <button className={buttonClasses("primary", "sm")} onClick={() => window.print()}>
      <Printer className="size-3.5" />
      Skriv ut / Spara som PDF
    </button>
  );
}
