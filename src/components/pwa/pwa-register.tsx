"use client";

import { useEffect } from "react";
import { ensureBinding } from "@/lib/offline/client";

/**
 * Registrerar service workern och sköter tenantbindningen för offline-lagret.
 *
 *   * Registrering sker bara i produktion (eller med NEXT_PUBLIC_PWA_DEV=1) –
 *     en worker i dev-läge gör hot reload förvirrande.
 *   * `session` = inloggad användare + aktivt företag. Skiljer det sig från
 *     enhetens bindning rensas allt lokalt offlineinnehåll. `null` (inloggnings-
 *     sidan efter utloggning) rensar också om något låg kvar.
 */
export function PwaRegister({ session }: { session: { businessId: string; userId: string } | null }) {
  const businessId = session?.businessId ?? "";
  const userId = session?.userId ?? "";

  useEffect(() => {
    void ensureBinding(businessId && userId ? { businessId, userId } : null).catch(() => {});
  }, [businessId, userId]);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const enabled = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_PWA_DEV === "1";
    if (!enabled) return;
    let check: (() => void) | null = null;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        // Uppdateringskontroll när appen får fokus igen – nya versioner tar
        // över utan att användaren behöver stänga alla flikar.
        check = () => void reg.update().catch(() => {});
        window.addEventListener("focus", check);
      })
      .catch(() => {
        /* registrering är best effort – appen fungerar utan worker */
      });
    return () => {
      if (check) window.removeEventListener("focus", check);
    };
  }, []);

  return null;
}
