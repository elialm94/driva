"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { buttonClasses } from "./ui";
import { sanitizeReturnTo } from "@/lib/nav";

const MESSAGE = "Du har osparade ändringar. Vill du lämna sidan?";

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
 * Protects create/edit flows: browser close, in-app links, and Avbryt.
 * Mount only on views with something to lose.
 */
export function useUnsavedLeave(dirty: boolean) {
  const router = useRouter();
  const dirtyRef = useRef(dirty);
  const leavingRef = useRef(false);
  dirtyRef.current = leavingRef.current ? false : dirty;
  const [open, setOpen] = useState(false);
  const pendingHref = useRef<string | null>(null);

  const dismiss = useCallback(() => {
    pendingHref.current = null;
    setOpen(false);
  }, []);

  const proceed = useCallback((href: string) => {
    leavingRef.current = true;
    dirtyRef.current = false;
    pendingHref.current = null;
    setOpen(false);
    const next = canonicalHref(href);
    // Defer so the confirming click cannot fall through onto a Link after the
    // modal unmounts, and so beforeunload sees leavingRef first.
    window.setTimeout(() => {
      window.location.assign(next);
    }, 0);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (leavingRef.current) return;
      e.preventDefault();
      e.returnValue = MESSAGE;
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    function onClick(e: MouseEvent) {
      if (leavingRef.current || !dirtyRef.current) return;
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
      pendingHref.current = next;
      setOpen(true);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  const confirmLeave = useCallback(
    (href: string) => {
      const next = canonicalHref(href);
      if (!dirtyRef.current || leavingRef.current) {
        router.push(next as never);
        return;
      }
      pendingHref.current = next;
      setOpen(true);
    },
    [router]
  );

  const dialog = (
    <Modal open={open} onClose={dismiss} title="Osparade ändringar" size="sm">
      <div className="px-6 py-5">
        <p className="text-[15px] leading-relaxed text-soft">{MESSAGE}</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClasses("ghost")} onClick={dismiss}>
            Stanna kvar
          </button>
          <button
            type="button"
            className={buttonClasses("primary")}
            onClick={() => {
              const href = pendingHref.current;
              if (href) proceed(href);
              else dismiss();
            }}
          >
            Lämna utan att spara
          </button>
        </div>
      </div>
    </Modal>
  );

  return { confirmLeave, dialog };
}
