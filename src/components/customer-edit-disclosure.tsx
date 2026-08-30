"use client";

import type { ReactNode } from "react";
import { SectionTitle } from "./ui";

export function CustomerEditDisclosure({
  children,
  status,
}: {
  children: ReactNode;
  status?: ReactNode;
}) {
  return (
    <div className="mt-2">
      <SectionTitle right={status}>Kunduppgifter</SectionTitle>
      {children}
    </div>
  );
}
