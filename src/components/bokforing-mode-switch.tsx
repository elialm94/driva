"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { BookOpenCheck } from "lucide-react";
import {
  BOKFORING_MODE_COOKIE,
  BOKFORING_MODE_COOKIE_MAX_AGE,
  type BookkeepingMode,
} from "@/lib/accounting/bookkeeping-mode-keys";
import { persistBookkeepingModeAction } from "@/app/bokforing-actions";
import { useToast } from "./toast";
import { cx } from "./ui";

const HINT_COOKIE = "driva_bokforing_lage_hint";

/**
 * EN väg att byta mellan enkel bokföring och redovisningsvyn: cookien skrivs
 * direkt (så nästa serverrendering ser läget), valet sparas per användare och
 * skalet renderas om. Används av flikraden, arbetsköns fot och kontomenyn.
 */
export function useBookkeepingModeSwitch() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function switchTo(next: BookkeepingMode, opts: { navigateTo?: string } = {}) {
    document.cookie = `${BOKFORING_MODE_COOKIE}=${next}; path=/; max-age=${BOKFORING_MODE_COOKIE_MAX_AGE}; samesite=lax`;
    if (next === "avancerat" && !document.cookie.includes(`${HINT_COOKIE}=1`)) {
      document.cookie = `${HINT_COOKIE}=1; path=/; max-age=${BOKFORING_MODE_COOKIE_MAX_AGE}; samesite=lax`;
      toast({
        title: "Redovisningsvyn visar verifikationer, huvudbok och rapporter. Bokföringen är densamma.",
      });
    }
    startTransition(async () => {
      await persistBookkeepingModeAction(next);
      if (opts.navigateTo) router.push(opts.navigateTo as never);
      else router.refresh();
    });
  }

  return { switchTo, pending };
}

/** Diskret rad i kontomenyn/sidomenyns fot: öppnar redovisningsvyn direkt. */
export function OpenAccountingViewLink({ className }: { className?: string }) {
  const { switchTo, pending } = useBookkeepingModeSwitch();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => switchTo("avancerat", { navigateTo: "/bokforing/verifikationer" })}
      className={cx(className)}
      data-open-accounting-view
    >
      <BookOpenCheck className="size-[18px] text-muted" strokeWidth={2} />
      Redovisningsvy
    </button>
  );
}
