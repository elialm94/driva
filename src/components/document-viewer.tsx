"use client";

import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import { buttonClasses, cx } from "./ui";

/**
 * Dokumentvisare för inboxbilagor. Innehållet hämtas alltid från den
 * auktoriserade routen /api/inbox/bilaga/… – aldrig publika URL:er.
 * Desktop: stор modal-panel. Mobil: helskärm. "Öppna i ny flik" som fallback.
 */
export function DocumentViewerButton({
  href,
  filename,
  label = "Visa PDF",
  variant = "secondary",
  size = "sm",
}: {
  href: string;
  filename: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button type="button" className={buttonClasses(variant, size)} onClick={() => setOpen(true)}>
        <FileText className="size-4" />
        {label}
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink/50 p-0 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={filename}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex w-full flex-col overflow-hidden bg-card shadow-pop sm:h-[min(88vh,900px)] sm:max-w-4xl sm:rounded-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <p className="truncate text-[14px] font-medium text-ink">{filename}</p>
              <div className="flex items-center gap-2">
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className={cx(buttonClasses("secondary", "sm"), "max-sm:hidden")}
                >
                  Öppna i ny flik
                </a>
                <button
                  type="button"
                  className={buttonClasses("ghost", "sm")}
                  aria-label="Stäng"
                  onClick={() => setOpen(false)}
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <iframe src={href} title={filename} className="h-full min-h-0 w-full flex-1 bg-canvas" />
            <div className="border-t border-line px-4 py-2 sm:hidden">
              <a href={href} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-ink underline">
                Öppnas inte dokumentet? Öppna i ny flik.
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Inbäddad dokumentruta för sida-vid-sida-granskning (Kontrollera-vyn). */
export function DocumentPane({ href, filename }: { href: string; filename: string }) {
  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-card lg:min-h-[640px]">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <p className="truncate text-[13px] font-medium text-muted">{filename}</p>
        <a href={href} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-ink underline">
          Öppna i ny flik
        </a>
      </div>
      <iframe src={href} title={filename} className="h-full min-h-0 w-full flex-1 bg-canvas" />
    </div>
  );
}
