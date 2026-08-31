import type { ReactNode } from "react";
import { LineDescriptionVocabProvider } from "./line-description-input";

/**
 * Gemensamt skal för offert- och fakturaeditorn.
 *
 * Desktop: arbetsyta max ~1240px (inte ultrawide-fullbredd), två kolumner
 * när den faktiska content-bredden räcker, sticky summering bara då.
 * Tablet/mobil: en kolumn, befintlig mobil-CTA i `footer`.
 */
export function EditorWorkspace({
  children,
  summary,
  footer,
}: {
  children: ReactNode;
  summary: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <LineDescriptionVocabProvider>
      <div data-editor-shell className="@container w-full max-w-editor">
        <div className="grid gap-6 @min-[68rem]:grid-cols-[minmax(0,1fr)_16.5rem]">
          <div className="min-w-0 space-y-6">{children}</div>
          <aside className="@min-[68rem]:sticky @min-[68rem]:top-8 @min-[68rem]:self-start">{summary}</aside>
        </div>
        {footer}
      </div>
    </LineDescriptionVocabProvider>
  );
}
