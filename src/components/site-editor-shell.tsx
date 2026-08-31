"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./ui";

/**
 * Hemsida-editorns skal: preview är huvudytan, redigeringen bor i en kompakt
 * panel med tre flikar – Innehåll, Design, Inställningar.
 *
 * Bred yta (container ≥ 64rem): två kolumner med sticky panel till höger.
 * Smal yta (tablet/mobil): en sak i taget – [Förhandsvisa] [Redigera] växlar
 * mellan preview och panelen i stället för att pressa ihop två kolumner.
 *
 * Alla flikpaneler är monterade hela tiden (döljs med CSS) så tabbyte är
 * omedelbart och listornas lokala state (t.ex. sektionsordning under
 * pågående sparning) inte nollställs.
 */

const TABS = [
  { id: "innehall", label: "Innehåll" },
  { id: "design", label: "Design" },
  { id: "installningar", label: "Inställningar" },
] as const;

type SiteEditorTab = (typeof TABS)[number]["id"];
type SiteEditorMode = "preview" | "edit";

/** Piltangenter + roving tabindex enligt WAI-ARIA tabs-mönstret. */
function tablistKeys(e: KeyboardEvent<HTMLDivElement>) {
  const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (current === -1) return;
  e.preventDefault();
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? tabs.length - 1
        : e.key === "ArrowRight"
          ? (current + 1) % tabs.length
          : (current - 1 + tabs.length) % tabs.length;
  tabs[next]?.focus();
  tabs[next]?.click();
}

function segmentClasses(active: boolean): string {
  return cx(
    "min-w-0 rounded-[10px] px-2 py-2 text-[13px] font-medium transition-colors",
    active ? "bg-card text-ink shadow-card" : "text-soft hover:text-ink",
  );
}

export function SiteEditorShell({
  preview,
  innehall,
  design,
  installningar,
}: {
  preview: ReactNode;
  innehall: ReactNode;
  design: ReactNode;
  installningar: ReactNode;
}) {
  const [tab, setTab] = useState<SiteEditorTab>("innehall");
  const [mode, setMode] = useState<SiteEditorMode>("preview");
  const panels: Record<SiteEditorTab, ReactNode> = { innehall, design, installningar };

  return (
    <div data-site-editor-shell className="@container w-full">
      {/* Smal yta: en sak i taget i stället för två hoppressade kolumner. */}
      <div
        role="group"
        aria-label="Växla mellan förhandsvisning och redigering"
        className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border border-line bg-canvas p-1 @min-[64rem]:hidden"
      >
        <button type="button" aria-pressed={mode === "preview"} onClick={() => setMode("preview")} className={segmentClasses(mode === "preview")}>
          Förhandsvisa
        </button>
        <button type="button" aria-pressed={mode === "edit"} onClick={() => setMode("edit")} className={segmentClasses(mode === "edit")}>
          Redigera
        </button>
      </div>

      <div className="grid min-w-0 items-start gap-6 @min-[64rem]:grid-cols-[minmax(0,1fr)_24rem]">
        <div className={cx("min-w-0", mode !== "preview" && "@max-[64rem]:hidden")}>{preview}</div>

        <aside
          className={cx(
            // Sticky inom viewporten med egen intern scroll när flikens innehåll
            // är längre – Publicera och tabbarna förblir nåbara utan lång återscroll.
            "min-w-0 @min-[64rem]:sticky @min-[64rem]:top-6 @min-[64rem]:max-h-[calc(100dvh-4rem)] @min-[64rem]:overflow-y-auto @min-[64rem]:overscroll-contain @min-[64rem]:px-0.5 @min-[64rem]:pb-2",
            mode !== "edit" && "@max-[64rem]:hidden",
          )}
        >
          <div
            role="tablist"
            aria-label="Redigera hemsidan"
            onKeyDown={tablistKeys}
            className="sticky top-0 z-10 grid grid-cols-3 gap-1 rounded-2xl border border-line bg-canvas p-1"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`sitetab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`sitepanel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                className={segmentClasses(tab === t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {TABS.map((t) => (
            <div
              key={t.id}
              id={`sitepanel-${t.id}`}
              role="tabpanel"
              aria-labelledby={`sitetab-${t.id}`}
              className={cx("mt-4", tab !== t.id && "hidden")}
            >
              {panels[t.id]}
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
