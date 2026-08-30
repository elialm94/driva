import type { ReactNode } from "react";
import { BokforingAdvancedTabs } from "@/components/bokforing-advanced-nav";

/**
 * Delat bokföringsskal. Flikraden lever här så den inte monteras om när
 * bara barnvyn byts. Ingen loading.tsx i det här segmentet: en sådan gräns
 * byter ut hela innehållet mot OverviewSkeleton vid varje flikbyte.
 * Första steget in i Bokföring täcks av (app)/loading.tsx.
 */
export default function BokforingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="animate-fade-up">
      <BokforingAdvancedTabs />
      {children}
    </div>
  );
}
