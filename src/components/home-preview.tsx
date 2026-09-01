import { AlertCircle, Clock, CornerDownLeft, Receipt, Search, Send, Upload } from "lucide-react";
import {
  ATTENTION_ICON_CLASS,
  ATTENTION_ROW_CLASS,
  ATTENTION_TONES,
  buttonClasses,
  COMMAND_CHIP_CLASS,
  COMMAND_INPUT_CLASS,
  cx,
  SECTION_TITLE_CLASS,
} from "./ui-classes";

/**
 * Stillbild av Hem för den publika landningssidan.
 *
 * Serverrenderad och helt icke-interaktiv: inga klientkomponenter, ingen
 * demo-seed och ingen JavaScript – landningssidan ska vara snabb. Strukturen
 * och klasserna kommer från ui-classes.ts, samma källa som kommandofältet och
 * åtgärdslistan använder, så visualen följer med när produktens UI ändras.
 *
 * Innehållet är Södermalms Snickeris exempeldata och visar bara ytor som
 * finns på riktigt: kommandofältet och "Behöver din uppmärksamhet".
 */

interface PreviewRow {
  tone: keyof typeof ATTENTION_TONES;
  Icon: typeof AlertCircle;
  title: string;
  subtitle: string;
  cta?: { label: string; Icon: typeof Send };
  /** Radar som ryms först från sm och uppåt – mobilen visar de två viktigaste. */
  desktopOnly?: boolean;
}

const ROWS: PreviewRow[] = [
  {
    tone: "alert",
    Icon: AlertCircle,
    title: "Faktura #1047 är 8 dagar sen",
    subtitle: "Johan Lindberg · 25 500 kr",
    cta: { label: "Skicka påminnelse", Icon: Send },
  },
  {
    tone: "clock",
    Icon: Clock,
    title: "Offert #115 · Fasadarbete",
    subtitle: "Väntar på signering med BankID · 72 375 kr",
  },
  {
    tone: "receipt",
    Icon: Receipt,
    title: "Kvitto saknas · Beijer Byggmaterial",
    subtitle: "1 249 kr · dras från kortköpet 14 juni",
    cta: { label: "Lägg till kvitto", Icon: Upload },
    desktopOnly: true,
  },
];

/** Tredje chippen ryms först från sm – mobilen håller snabbknapparna på en rad. */
const CHIPS = [
  { label: "Skapa offert" },
  { label: "Nytt uppdrag" },
  { label: "1 sen faktura", desktopOnly: true },
];

export function HomePreview() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-3xl select-none">
      <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-pop">
        <div className="flex items-center gap-2 border-b border-line bg-canvas px-4 py-2.5">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
          </span>
          <span className="mx-auto rounded-md bg-card px-3 py-0.5 text-[11px] text-muted">app.driva.se</span>
        </div>

        <div className="px-4 py-5 sm:px-7 sm:py-6">
          <p className="text-[13px] font-medium text-muted sm:text-sm">Tisdag 16 juni</p>
          <p className="mt-1 text-[22px] font-semibold tracking-tight text-ink sm:text-[26px]">God morgon</p>

          {/* Kommandofältet – produktens tydligaste yta, därför störst här. */}
          <div className="mt-5 sm:mt-6">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <div className={cx(COMMAND_INPUT_CLASS, "flex items-center pr-14 text-[14px] sm:text-[15px]")}>
                <span className="truncate">Skapa en offert till Göran på altanbygget</span>
                <span className="ml-0.5 inline-block h-[1.1em] w-px shrink-0 bg-accent" />
              </div>
              <span className="pointer-events-none absolute right-3.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-line bg-canvas px-1.5 py-0.5 text-[11px] font-medium text-muted sm:inline-block">
                ⌘K
              </span>
            </div>

            {/* Tolkningen av det skrivna – kommandofältets riktiga beteende. */}
            <div className="mt-2 flex items-center gap-3 rounded-xl border border-line bg-canvas/70 px-3.5 py-2.5">
              <span className={cx("flex size-7 items-center justify-center rounded-lg", ATTENTION_TONES.invoice)}>
                <Send className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink sm:text-sm">
                  Ny offert · Göran Eriksson
                </span>
                <span className="block truncate text-xs text-soft">Altanbygge · fyll i rader och skicka</span>
              </span>
              <CornerDownLeft className="size-3.5 shrink-0 text-muted" />
            </div>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {CHIPS.map((c) => (
                <span key={c.label} className={cx(COMMAND_CHIP_CLASS, c.desktopOnly && "max-sm:hidden")}>
                  {c.label}
                </span>
              ))}
            </div>
          </div>

          {/* Andra huvudytan: vad som faktiskt behöver göras. */}
          <div className="mt-7 sm:mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className={SECTION_TITLE_CLASS}>
                Behöver din uppmärksamhet{" "}
                {/* Räknaren döljs på mobil, där tredje raden är bortkapad. */}
                <span className="font-medium text-muted/70 tabular max-sm:hidden">· 3</span>
              </h2>
            </div>
            <div className="card divide-y divide-line/70">
              {ROWS.map((row) => (
                <div
                  key={row.title}
                  className={cx(
                    ATTENTION_ROW_CLASS,
                    "max-sm:px-4 max-sm:py-3.5",
                    row.desktopOnly && "max-sm:hidden"
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className={cx(ATTENTION_ICON_CLASS, ATTENTION_TONES[row.tone])}>
                      <row.Icon className="size-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-ink sm:text-[15px]">{row.title}</p>
                      <p className="mt-0.5 truncate text-[13px] leading-relaxed text-soft sm:text-sm">
                        {row.subtitle}
                      </p>
                    </div>
                  </div>
                  {row.cta ? (
                    <div className="flex shrink-0 items-center gap-2 pl-12 sm:justify-end sm:pl-0">
                      <span className={buttonClasses("primary", "sm")}>
                        <row.cta.Icon className="size-3.5" />
                        {row.cta.label}
                      </span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
