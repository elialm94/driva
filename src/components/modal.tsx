"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cx } from "./ui";

/** Topmost open modal wins Escape / z-index. Ids stay in the stack until that modal unmounts. */
const modalStack: string[] = [];

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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    modalStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (modalStack[modalStack.length - 1] !== id) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      const idx = modalStack.lastIndexOf(id);
      if (idx >= 0) modalStack.splice(idx, 1);
      document.removeEventListener("keydown", onKey);
      if (modalStack.length === 0) document.body.style.overflow = "";
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
        role="dialog"
        aria-modal="true"
        className={cx(
          "relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-card shadow-pop sm:rounded-3xl animate-fade-up",
          sizes[size]
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined ? (
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <div className="text-[17px] font-semibold tracking-tight text-ink">{title}</div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Stäng"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-ink/5 hover:text-ink"
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
