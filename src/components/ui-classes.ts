/**
 * Rena klassbyggare – noll imports, inga klientkomponenter.
 *
 * Ligger separat från ui.tsx (som drar in AppLink och därmed en klientgräns)
 * så att serverrenderade ytor utan interaktivitet, t.ex. landningssidans
 * produktvisual, kan använda exakt samma knapp- och tonklasser som produkten
 * utan att skicka någon JavaScript till webbläsaren.
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type ButtonVariant =
  | "primary"
  | "accent"
  | "secondary"
  | "ghost"
  | "danger"
  | "danger-outline"
  | "bankid";
export type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap rounded-xl transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-black shadow-sm",
  accent: "bg-accent text-white hover:bg-accent-deep shadow-sm",
  secondary: "bg-card text-ink border border-line-strong hover:bg-canvas hover:border-muted/60",
  ghost: "text-soft hover:bg-ink/5 hover:text-ink",
  danger: "bg-danger-soft text-danger hover:bg-danger hover:text-white",
  "danger-outline": "bg-transparent text-danger border border-danger/30 hover:bg-danger-soft hover:border-danger/50",
  bankid: "bg-bankid text-white hover:brightness-110 shadow-sm",
};

/** Under lg växer knapparna något så träffytan blir ≥ ~44px på touch. Desktop oförändrad. */
const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] max-lg:h-9",
  md: "h-10 px-4 text-sm max-lg:h-11",
  lg: "h-12 px-6 text-[15px]",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string) {
  return cx(buttonBase, buttonVariants[variant], buttonSizes[size], extra);
}

/**
 * Färgtoner för uppmärksamhetsradernas ikonbricka. En definition som både
 * åtgärdslistan och landningens produktvisual läser, så visualen följer med
 * när produktens toner ändras.
 */
export const ATTENTION_TONES = {
  inbox: "bg-info-soft text-info",
  clock: "bg-warn-soft text-warn",
  alert: "bg-danger-soft text-danger",
  receipt: "bg-warn-soft text-warn",
  question: "bg-info-soft text-info",
  invoice: "bg-accent-soft text-accent-deep",
  bank: "bg-info-soft text-info",
  calendar: "bg-warn-soft text-warn",
  percent: "bg-ok-soft text-ok",
  bell: "bg-accent-soft text-accent-deep",
} as const;

/* --------------- Delade klasser för Hem-ytan (produkt + landning) -------------- */

/** Kommandofältets input – samma höjd, radie och kanter som i produkten. */
export const COMMAND_INPUT_CLASS =
  "h-12 w-full rounded-2xl border border-line-strong bg-card pl-10 text-ink placeholder:text-muted focus:border-accent";

/** Snabbknapparna under kommandofältet. */
export const COMMAND_CHIP_CLASS =
  "shrink-0 rounded-full border border-line bg-card px-3.5 py-1.5 text-[12.5px] font-medium text-soft";

/** Rubrik över en sektion på Hem. */
export const SECTION_TITLE_CLASS = "text-[13px] font-semibold uppercase tracking-[0.08em] text-muted";

/** En rad i "Behöver din uppmärksamhet". */
export const ATTENTION_ROW_CLASS = "flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:gap-4";

/** Ikonbrickan i en uppmärksamhetsrad (kombineras med en ton ur ATTENTION_TONES). */
export const ATTENTION_ICON_CLASS =
  "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl";
