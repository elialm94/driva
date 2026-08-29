"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/auth-actions";
import { cx } from "./ui";

/**
 * Diskret utloggningsrad – renderas endast i Supabase-läge (riktiga sessioner),
 * grindat via canLogout-propen i (app)-layouten. Ingen bekräftelsedialog:
 * utloggning är ofarlig och reversibel (logga in igen).
 *
 *   variant "sidebar": rad i sidofältets fot, dämpad ton under Inställningar.
 *   variant "sheet":   rad i mobilens "Mer"-ark, sist och sekundär.
 */
export function LogoutRow({ variant = "sidebar" }: { variant?: "sidebar" | "sheet" }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => logoutAction())}
      disabled={pending}
      aria-label="Logga ut"
      className={cx(
        "flex min-h-11 w-full items-center gap-3 text-left text-[15px] transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        variant === "sidebar"
          ? "rounded-xl px-3 py-2.5 text-muted hover:bg-ink/5 hover:text-ink"
          : "rounded-2xl px-4 py-3.5 text-soft hover:bg-canvas hover:text-ink"
      )}
    >
      <LogOut className={cx("text-muted", variant === "sidebar" ? "size-[18px]" : "size-5")} strokeWidth={2} />
      {pending ? "Loggar ut …" : "Logga ut"}
    </button>
  );
}
