"use client";

import { useState, type ReactNode } from "react";
import { SectionTitle } from "./ui";

export function CustomerEditDisclosure({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <SectionTitle
        right={
          <button
            type="button"
            className="text-[13px] font-medium text-accent hover:text-accent-deep"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Stäng" : "Redigera uppgifter"}
          </button>
        }
      >
        Kunduppgifter
      </SectionTitle>
      {open ? children : null}
    </div>
  );
}
