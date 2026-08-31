"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const MESSAGES: Record<string, string> = {
  offert: "Offertutkast kastat",
  faktura: "Fakturautkast kastat",
};

export function DraftDiscardedToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const kind = searchParams.get("kastat");
    const next = kind ? MESSAGES[kind] : null;
    if (!next) return;
    setText(next);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("kastat");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    const timeout = window.setTimeout(() => setText(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [pathname, router, searchParams]);

  if (!text) return null;

  return (
    <div
      role="status"
      className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-ink px-4 py-2.5 text-[14px] font-medium text-white shadow-pop"
    >
      {text}
    </div>
  );
}
