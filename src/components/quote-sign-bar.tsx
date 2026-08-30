"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cx } from "./ui";

/**
 * Beständig signeringsrad medan kunden läser offerten. Den göms när dokumentets
 * egen godkännande-sektion syns, så samma knapp aldrig visas två gånger och
 * raden inte täcker villkoren. Utan JS ligger raden kvar – aldrig utan CTA.
 */
export function QuoteSignBar({ watchElementId, children }: { watchElementId: string; children: ReactNode }) {
  const [atAcceptance, setAtAcceptance] = useState(false);

  useEffect(() => {
    const target = document.getElementById(watchElementId);
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => setAtAcceptance(entries.some((e) => e.isIntersecting)), {
      // Sektionen räknas som synlig först när den är fri från raden längst ned.
      rootMargin: "0px 0px -104px 0px",
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [watchElementId]);

  return (
    <div
      aria-hidden={atAcceptance}
      // Utan inert vore knapparna tabbbara medan raden är osynlig.
      inert={atAcceptance}
      className={cx(
        "fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl transition-all duration-200 print:hidden",
        atAcceptance && "pointer-events-none translate-y-full opacity-0"
      )}
    >
      {children}
    </div>
  );
}
