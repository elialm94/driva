"use client";

import { useTransition } from "react";
import { LogOut, UserPlus } from "lucide-react";
import { endDemoAction, endDemoToSignupAction } from "@/app/demo-actions";
import { cx } from "./ui";

/**
 * Demoläges-kontroller i navigationen.
 *
 *   DemoBadge        – diskret men tydlig markör: datat är exempeldata.
 *   EndDemoRow       – "Avsluta demo": släpper demosessionen → /login.
 *   CreateAccountRow – "Skapa eget konto": avslutar demon → registrering.
 *
 * Varianterna följer LogoutRow: "sidebar" (desktopfot) och "sheet" (mobilens
 * Mer-ark). Ingen bekräftelse – att lämna demon är ofarligt och reversibelt.
 */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      title="Demoläge – du tittar på exempeldata"
      className={cx(
        "inline-flex items-center rounded-md border border-accent/30 bg-accent/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-accent",
        className
      )}
    >
      Demo
    </span>
  );
}

function rowClasses(variant: "sidebar" | "sheet"): string {
  return cx(
    "flex min-h-11 w-full items-center gap-3 text-left text-[15px] transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    variant === "sidebar"
      ? "rounded-xl px-3 py-2.5 text-muted hover:bg-ink/5 hover:text-ink"
      : "rounded-2xl px-4 py-3.5 text-soft hover:bg-canvas hover:text-ink"
  );
}

function iconClasses(variant: "sidebar" | "sheet"): string {
  return cx("text-muted", variant === "sidebar" ? "size-[18px]" : "size-5");
}

export function EndDemoRow({ variant = "sidebar" }: { variant?: "sidebar" | "sheet" }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => endDemoAction())}
      disabled={pending}
      aria-label="Avsluta demo"
      className={rowClasses(variant)}
    >
      <LogOut className={iconClasses(variant)} strokeWidth={2} />
      {pending ? "Avslutar …" : "Avsluta demo"}
    </button>
  );
}

export function CreateAccountRow({ variant = "sidebar" }: { variant?: "sidebar" | "sheet" }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => endDemoToSignupAction())}
      disabled={pending}
      aria-label="Skapa ditt eget konto – 14 dagar gratis, inget kort krävs"
      className={rowClasses(variant)}
    >
      <UserPlus className={iconClasses(variant)} strokeWidth={2} />
      <span className="flex min-w-0 flex-col items-start">
        <span>{pending ? "Öppnar …" : "Skapa ditt eget konto"}</span>
        <span className="text-[12px] font-normal text-muted">14 dagar gratis · Inget kort krävs</span>
      </span>
    </button>
  );
}
