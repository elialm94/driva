"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "./toast";
import { flashFromSearch, hrefWithoutFlash } from "@/lib/flash-notices";

/**
 * Läser engångsnotiser ur URL:en (se lib/flash-notices), visar dem som toast
 * och städar adressen. Monteras en gång i appskalet – sidorna behöver inte
 * veta något om vilka parametrar som finns.
 */
export function FlashToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const shown = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const flash = flashFromSearch(params);
    if (!flash) return;
    // Effekten kan köras två gånger (strict mode/omrendering innan replace slagit
    // igenom) – samma nyckel på samma sida visas bara en gång.
    const marker = `${pathname}|${flash.key}`;
    if (shown.current !== marker) {
      shown.current = marker;
      toast({ id: `flash:${flash.key}`, ...flash.notice });
    }
    router.replace(hrefWithoutFlash(pathname, params, flash.strip) as never, { scroll: false });
  }, [pathname, router, searchParams, toast]);

  return null;
}
