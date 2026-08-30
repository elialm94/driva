"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import type { CompanySettings, Website, WebsiteDesign } from "@/lib/types";
import {
  WEBSITE_ACCENTS,
  WEBSITE_ACCENT_IDS,
  WEBSITE_THEMES,
  WEBSITE_THEME_IDS,
  sameDesign,
} from "@/lib/website-design";
import { setWebsiteDesignAction } from "@/app/actions";
import { SiteRenderer } from "./site-renderer";
import { cx } from "./ui";

/**
 * Utseende-väljaren i hemsidesbyggaren.
 *
 * Val = förhandsvisning: klick byter tema/accent i vänsterpanelen DIREKT
 * (optimistiskt via context) och sparas samtidigt som UTKAST på servern –
 * ingen spara-knapp, inget "Använd tema"-steg. Den publika sajten ändras
 * först vid "Publicera ändringar".
 */

const DesignContext = createContext<{
  design: WebsiteDesign;
  setDesign: (next: WebsiteDesign | null) => void;
} | null>(null);

export function WebsiteDesignProvider({
  initial,
  children,
}: {
  /** Utkastets utseende från servern (draftWebsiteDesign). */
  initial: WebsiteDesign;
  children: ReactNode;
}) {
  const [override, setOverride] = useState<WebsiteDesign | null>(null);
  // När servern hunnit ikapp (router.refresh efter sparat val) släpps
  // överstyrningen så att senare serverändringar (t.ex. demo-återställning)
  // slår igenom i förhandsvisningen.
  useEffect(() => {
    if (override && sameDesign(override, initial)) setOverride(null);
  }, [override, initial]);
  return (
    <DesignContext.Provider value={{ design: override ?? initial, setDesign: setOverride }}>
      {children}
    </DesignContext.Provider>
  );
}

function useWebsiteDesign() {
  const ctx = useContext(DesignContext);
  if (!ctx) throw new Error("useWebsiteDesign kräver WebsiteDesignProvider.");
  return ctx;
}

/* ---------------------------- Förhandsvisningen ----------------------------- */

const VIEWPORTS = [
  { id: "mobil", label: "Mobil", width: "375px", icon: Smartphone },
  { id: "surfplatta", label: "Surfplatta", width: "768px", icon: Tablet },
  { id: "dator", label: "Dator", width: "100%", icon: Monitor },
] as const;

type ViewportId = (typeof VIEWPORTS)[number]["id"];

/**
 * Live-förhandsvisningen. Renderas på klienten så att tema-/accentbyten syns
 * omedelbart, och eftersom sajten är byggd med container queries visar
 * viewportknapparna exakt den layout en riktig enhet med samma bredd får.
 */
export function SitePreviewFrame({
  website,
  company,
}: {
  website: Website;
  company: CompanySettings;
}) {
  const { design } = useWebsiteDesign();
  const [viewport, setViewport] = useState<ViewportId>("dator");
  const active = VIEWPORTS.find((v) => v.id === viewport) ?? VIEWPORTS[2];

  return (
    <div className="overflow-hidden rounded-3xl border border-line shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-canvas px-4 py-2">
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
        </div>
        <div className="flex items-center gap-0.5" role="group" aria-label="Förhandsvisningens skärmstorlek">
          {VIEWPORTS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setViewport(v.id)}
              aria-pressed={viewport === v.id}
              aria-label={`Visa som ${v.label.toLowerCase()}`}
              title={v.label}
              className={cx(
                "inline-flex size-7 items-center justify-center rounded-lg transition-colors",
                viewport === v.id ? "bg-ink/8 text-ink" : "text-muted hover:bg-ink/5 hover:text-ink",
              )}
            >
              <v.icon className="size-3.5" />
            </button>
          ))}
        </div>
      </div>
      <div className={cx("site-preview-scroll max-h-[640px] overflow-y-auto", viewport !== "dator" && "bg-ink/6 py-4")}>
        <div
          className={cx("mx-auto min-h-full transition-[max-width] duration-200", viewport !== "dator" && "shadow-pop")}
          style={{ maxWidth: active.width }}
        >
          <SiteRenderer
            website={website}
            company={company}
            design={design}
            interactive={false}
            privacyHref="/integritetspolicy?preview=1"
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Radiogrupper -------------------------------- */

/** Piltangenter + roving tabindex för en radiogrupp av knappar. */
function radioGroupKeys(e: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const group = e.currentTarget;
  const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const current = radios.indexOf(document.activeElement as HTMLButtonElement);
  if (current === -1) return;
  e.preventDefault();
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? radios.length - 1
        : e.key === "ArrowRight" || e.key === "ArrowDown"
          ? (current + 1) % radios.length
          : (current - 1 + radios.length) % radios.length;
  radios[next]?.focus();
  radios[next]?.click();
}

/* ------------------------------ Temaväljaren -------------------------------- */

/** Miniatyr som visar temats faktiska karaktär: yta, sidhuvud, typografi, knapp. */
function ThemeSwatch({ themeId, accentId }: { themeId: (typeof WEBSITE_THEME_IDS)[number]; accentId: string }) {
  const t = WEBSITE_THEMES[themeId];
  const accent = WEBSITE_ACCENTS[accentId as keyof typeof WEBSITE_ACCENTS] ?? WEBSITE_ACCENTS.tegel;
  return (
    <span aria-hidden className="block overflow-hidden rounded-lg border" style={{ borderColor: t.line, background: t.bg }}>
      <span
        className="block h-2"
        style={
          t.header === "band"
            ? { background: t.band, borderBottom: `2px solid ${accent.color}` }
            : { background: t.bg, borderBottom: `1px solid ${t.line}` }
        }
      />
      <span className="flex items-center justify-between gap-1 px-2.5 pb-2.5 pt-1.5">
        <span
          className="text-[19px] leading-none"
          style={{
            fontFamily: t.headingFont,
            fontWeight: t.headingWeight as CSSProperties["fontWeight"],
            letterSpacing: t.headingTracking,
            color: t.ink,
          }}
        >
          Aa
        </span>
        <span
          className="block h-3.5 w-7"
          style={{ background: accent.color, borderRadius: t.radiusButton }}
        />
      </span>
    </span>
  );
}

export function UtseendePanel({
  publishedDesign,
  published,
}: {
  /** Sajtens publicerade utseende – för "opublicerade ändringar"-hinten. */
  publishedDesign: WebsiteDesign;
  /** Är sajten publicerad? Styr hur hinten formuleras. */
  published: boolean;
}) {
  const { design, setDesign } = useWebsiteDesign();
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  // Senast sparade utseende – återställningspunkt om servern säger nej.
  const savedRef = useRef(design);

  function apply(next: WebsiteDesign) {
    if (sameDesign(next, design)) return;
    const previous = savedRef.current;
    setDesign(next); // förhandsvisningen byter omedelbart
    setError(null);
    startTransition(async () => {
      const result = await setWebsiteDesignAction(next);
      if (result.ok === false) {
        setDesign(sameDesign(previous, publishedDesign) ? null : previous);
        setError(result.error);
        return;
      }
      savedRef.current = next;
      router.refresh();
    });
  }

  const unpublishedChanges = !sameDesign(design, publishedDesign);

  return (
    <div className="px-4 py-4">
      <div role="radiogroup" aria-label="Tema" className="grid grid-cols-2 gap-2" onKeyDown={radioGroupKeys}>
        {WEBSITE_THEME_IDS.map((id) => {
          const t = WEBSITE_THEMES[id];
          const selected = design.themeId === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => apply({ themeId: id, accent: design.accent })}
              className={cx(
                "rounded-xl border p-1.5 text-left transition-all",
                selected
                  ? "border-accent ring-2 ring-accent/25"
                  : "border-line hover:border-line-strong",
              )}
            >
              <ThemeSwatch themeId={id} accentId={design.accent} />
              <span className="mt-1.5 block px-1 pb-0.5">
                <span className="block text-[13px] font-semibold leading-tight">{t.namn}</span>
                <span className="block truncate text-[11px] leading-snug text-muted" title={`${t.beskrivning} – ${t.passar}`}>
                  {t.beskrivning}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        <p id="accent-label" className="mb-2 text-[12px] font-medium text-soft">
          Accentfärg
        </p>
        <div role="radiogroup" aria-labelledby="accent-label" className="flex items-center gap-2" onKeyDown={radioGroupKeys}>
          {WEBSITE_ACCENT_IDS.map((id) => {
            const a = WEBSITE_ACCENTS[id];
            const selected = design.accent === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={a.namn}
                title={a.namn}
                tabIndex={selected ? 0 : -1}
                onClick={() => apply({ themeId: design.themeId, accent: id })}
                className={cx(
                  "size-7 rounded-full border-2 transition-all",
                  selected ? "border-ink/70 ring-2 ring-accent/30" : "border-transparent hover:scale-110",
                )}
                style={{ background: a.color }}
              />
            );
          })}
          <span className="ml-1 text-[12px] text-muted">{WEBSITE_ACCENTS[design.accent].namn}</span>
        </div>
      </div>

      {error ? <p className="mt-3 text-[12.5px] font-medium text-danger">{error}</p> : null}
      <p className="mt-3 text-[12px] leading-relaxed text-muted">
        {unpublishedChanges && published
          ? "Nytt utseende i förhandsvisningen – sajten uppdateras när du klickar Publicera ändringar."
          : "Ditt innehåll följer alltid med när du byter utseende."}
      </p>
    </div>
  );
}
