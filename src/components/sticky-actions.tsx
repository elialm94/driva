import type { ReactNode } from "react";
import { cx } from "./ui";

/**
 * Sticky CTA-rad för långa formulär på mobil/surfplatta: ligger kvar ovanför
 * bottennavet (+ safe area) medan man scrollar, och landar på sin naturliga
 * plats i flödet längst ner. Döljs på desktop (lg+) där sidosummeringen
 * har knappen. `position: sticky` gör att raden aldrig täcker innehåll –
 * ingen extra bottenmarginal behövs.
 *
 * Läggs sist i formulärkolumnen. `summary` är en kompakt rad ovanför
 * knapparna, t.ex. "Att betala · 25 500 kr".
 */
export function StickyMobileActions({
  children,
  summary,
  className,
}: {
  children: ReactNode;
  summary?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "sticky bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom))] z-20 lg:hidden",
        // Full bredd i det centrerade innehållet: bryt ut ur px-4/sm:px-8.
        "-mx-4 border-t border-line bg-card/95 px-4 pt-3 pb-3 backdrop-blur-xl sm:-mx-8 sm:px-8",
        className
      )}
    >
      {summary ? <div className="mb-2.5">{summary}</div> : null}
      <div className="flex items-center gap-2 [&>*]:min-w-0">{children}</div>
    </div>
  );
}
