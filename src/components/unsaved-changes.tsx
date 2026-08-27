"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { buttonClasses } from "./ui";

const MESSAGE = "Du har osparade ändringar. Vill du lämna sidan?";

/**
 * Protects create/edit flows: browser close, in-app links, and Avbryt.
 * Mount only on views with something to lose.
 */
export function useUnsavedLeave(dirty: boolean) {
  const router = useRouter();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const [open, setOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = MESSAGE;
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    function onClick(e: MouseEvent) {
      if (!dirtyRef.current) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const hrefAttr = anchor.getAttribute("href");
      if (!hrefAttr || hrefAttr.startsWith("#") || hrefAttr.startsWith("mailto:") || hrefAttr.startsWith("tel:")) return;
      if (anchor.origin !== window.location.origin) return;
      const next = `${anchor.pathname}${anchor.search}`;
      const current = `${window.location.pathname}${window.location.search}`;
      if (next === current) return;
      e.preventDefault();
      e.stopPropagation();
      pending.current = () => router.push(next as never);
      setOpen(true);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty, router]);

  const confirmLeave = useCallback(
    (href: string) => {
      if (!dirtyRef.current) {
        router.push(href as never);
        return;
      }
      pending.current = () => router.push(href as never);
      setOpen(true);
    },
    [router]
  );

  const dialog = (
    <Modal open={open} onClose={() => setOpen(false)} title="Osparade ändringar" size="sm">
      <div className="px-6 py-5">
        <p className="text-[15px] leading-relaxed text-soft">{MESSAGE}</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClasses("ghost")} onClick={() => setOpen(false)}>
            Stanna kvar
          </button>
          <button
            type="button"
            className={buttonClasses("primary")}
            onClick={() => {
              const go = pending.current;
              pending.current = null;
              dirtyRef.current = false;
              setOpen(false);
              go?.();
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
