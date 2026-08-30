"use client";

import { useEffect, useRef, useState } from "react";
import {
  createAutosaveLoop,
  IDLE_AUTOSAVE,
  type AutosaveLoop,
  type AutosavePersistResult,
  type AutosaveState,
} from "@/lib/autosave";
import { sanitizeReturnTo } from "@/lib/nav";

function canonicalHref(href: string): string {
  const next = sanitizeReturnTo(href);
  if (next) return next;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  return "/";
}

function here(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Debouncad autosave-loop + in-app leave that flushar i stället för
 * webbläsarens "osparade ändringar"-dialog.
 */
export function useAutosaveLoop(options?: { debounceMs?: number; savedHoldMs?: number }) {
  const [state, setState] = useState<AutosaveState>(IDLE_AUTOSAVE);
  const loopRef = useRef<AutosaveLoop | null>(null);
  const setStateRef = useRef(setState);
  setStateRef.current = setState;

  const getLoop = (): AutosaveLoop => {
    if (!loopRef.current) {
      loopRef.current = createAutosaveLoop({
        debounceMs: options?.debounceMs,
        savedHoldMs: options?.savedHoldMs,
        onState: (next) => setStateRef.current(next),
      });
    }
    return loopRef.current;
  };

  const api = useRef<AutosaveLoop>({
    notify: (key: string, persist: () => Promise<AutosavePersistResult>) => getLoop().notify(key, persist),
    flush: () => getLoop().flush(),
    dispose: () => {
      loopRef.current?.dispose();
      loopRef.current = null;
    },
    getState: () => loopRef.current?.getState() ?? IDLE_AUTOSAVE,
  }).current;

  useEffect(() => {
    getLoop();
    return () => api.dispose();
  }, [api]);

  useEffect(() => {
    function onPageHide() {
      void api.flush();
    }
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [api]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const current = api.getState();
      const busy = current.status === "dirty" || current.status === "saving";
      const failed = current.status === "error";
      if (!busy && !failed) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const hrefAttr = anchor.getAttribute("href");
      if (!hrefAttr || hrefAttr.startsWith("#") || hrefAttr.startsWith("mailto:") || hrefAttr.startsWith("tel:")) return;
      if (anchor.origin !== window.location.origin) return;
      const next = canonicalHref(`${anchor.pathname}${anchor.search}`);
      if (next === canonicalHref(here())) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      if (failed) return;
      void api.flush().then((ok) => {
        if (ok) window.location.assign(next);
      });
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [api]);

  return { state, loop: api };
}
