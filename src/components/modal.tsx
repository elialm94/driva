"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cx } from "./ui";

/** Topmost open modal wins Escape / z-index. Ids stay in the stack until that modal unmounts. */
const modalStack: string[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[aria-hidden='true']") && el.getClientRects().length > 0
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const id = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    modalStack.push(id);
    // Fokusfälla: tangentbordet stannar i dialogen, och fokus går tillbaka
    // till knappen som öppnade den när den stängs (annars hamnar skärmläsare
    // och Tab-navigering längst upp på sidan bakom).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFirst = window.requestAnimationFrame(() => {
      const root = dialogRef.current;
      if (!root || root.contains(document.activeElement)) return;
      // Första riktiga kontrollen i innehållet – inte stängkrysset, som annars
      // alltid skulle vinna eftersom det ligger först i DOM.
      const target =
        root.querySelector<HTMLElement>("[data-autofocus]") ??
        focusableIn(root).find((el) => !el.hasAttribute("data-modal-close")) ??
        root;
      target.focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== id) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const items = focusableIn(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(focusFirst);
      const idx = modalStack.lastIndexOf(id);
      if (idx >= 0) modalStack.splice(idx, 1);
      document.removeEventListener("keydown", onKey);
      if (modalStack.length === 0) document.body.style.overflow = "";
      if (opener && opener.isConnected && modalStack.length === 0) opener.focus({ preventScroll: true });
    };
  }, [open, id]);

  if (!open) return null;

  const sizes = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-6xl" };
  const stackedAt = modalStack.lastIndexOf(id);
  const layer = stackedAt >= 0 ? stackedAt : modalStack.length;
  const zIndex = 50 + layer * 10;

  const node = (
    <div
      className="fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-6 animate-fade-in"
      style={{ zIndex }}
    >
      {/* Blur layer is non-interactive so backdrop-filter cannot swallow clicks. */}
      <div className="pointer-events-none absolute inset-0 bg-ink/40 backdrop-blur-[3px]" aria-hidden />
      <div className="absolute inset-0" aria-hidden onClick={() => onClose()} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? `${id}-title` : undefined}
        tabIndex={-1}
        className={cx(
          // Bottensheet på mobil: safe-area-padding så knappar inte hamnar bakom hemindikatorn.
          "relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-card pb-[env(safe-area-inset-bottom)] shadow-pop outline-none sm:rounded-3xl sm:pb-0 animate-fade-up",
          sizes[size]
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined ? (
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <div id={`${id}-title`} className="text-[17px] font-semibold tracking-tight text-ink">
              {title}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Stäng"
              data-modal-close
              className="-my-2 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-ink/5 hover:text-ink"
            >
              <X className="size-4.5" />
            </button>
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer ? <div className="border-t border-line bg-canvas/60 px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  );

  if (!mounted) return node;
  return createPortal(node, document.body);
}
