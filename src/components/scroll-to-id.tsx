"use client";

import { useEffect } from "react";

/** App Router hoppar ofta över hash-scroll – säkerställ landning på ankarid. */
export function ScrollToId({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [id]);
  return null;
}
