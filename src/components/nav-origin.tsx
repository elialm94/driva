"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { locationHref, scrollKeyForHref } from "@/lib/nav";

/** Persist scroll for the current view so in-app Back can restore it. */
export function saveScrollPosition() {
  if (typeof window === "undefined") return;
  try {
    const href = `${window.location.pathname}${window.location.search}`;
    sessionStorage.setItem(scrollKeyForHref(href), String(Math.round(window.scrollY)));
  } catch {
    /* private mode / quota */
  }
}

export function NavOriginProvider() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const key = scrollKeyForHref(locationHref(pathname, searchParams));
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(key);
    } catch {
      return;
    }
    if (raw == null) return;
    const y = Number(raw);
    if (!Number.isFinite(y)) return;
    const restore = () => window.scrollTo(0, y);
    restore();
    const t0 = window.setTimeout(restore, 0);
    const t1 = window.setTimeout(restore, 80);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
    };
  }, [pathname, searchParams]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("a[href]")) return;
      saveScrollPosition();
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener("pagehide", saveScrollPosition);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pagehide", saveScrollPosition);
    };
  }, []);

  return null;
}
