"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  LIVE_REFRESH_CHANNEL,
  createLiveRefreshGate,
  isLiveRefreshMessage,
  type LiveRefreshReason,
} from "@/lib/live-refresh";

/**
 * Håller ägarens vyer färska när tillståndet ändras utanför fliken (kundens
 * godkännande i en annan flik/enhet). App Routern återställer Bakåt/Framåt ur
 * klientcachen och en öppen flik läser inte om av sig själv – därför
 * router.refresh() när fliken blir synlig/får fokus igen, vid popstate och
 * bfcache-pageshow, samt direkt på meddelande från kundens publika sida i
 * samma webbläsare. refresh() behåller klienttillstånd och scrolläge.
 *
 * Aldrig mitt i en editor (data-editor-shell / data-site-editor-shell): där
 * är formuläret sanningen tills det sparats.
 */
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    const gate = createLiveRefreshGate();
    const editorOpen = () =>
      document.querySelector("[data-editor-shell], [data-site-editor-shell]") !== null;

    const refresh = (reason: LiveRefreshReason) => {
      if (editorOpen()) return;
      if (!gate.shouldRefresh(reason, Date.now())) return;
      startTransition(() => router.refresh());
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") gate.away(Date.now());
      else refresh("visible");
    };
    const onBlur = () => gate.away(Date.now());
    const onFocus = () => refresh("focus");
    const onPopState = () => refresh("popstate");
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refresh("pageshow");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("pageshow", onPageShow);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(LIVE_REFRESH_CHANNEL);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (isLiveRefreshMessage(event.data)) refresh("broadcast");
      };
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pageshow", onPageShow);
      channel?.close();
    };
  }, [router]);

  return null;
}
