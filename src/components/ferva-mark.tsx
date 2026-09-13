import { cx } from "./ui";

/**
 * Fervas varumärkesmärke: ett F med 45-gradiga geringssnitt i bägge armarnas
 * ändar. Inline SVG, inte <img>, så att märket kan färgas av currentColor och
 * aldrig hinner flimra in efter resten av sidan.
 *
 * Förväxla inte med CompanyLogo (src/components/company-logo.tsx) - den visar
 * kundens egen logga. FervaMark är alltid Ferva som avsändare.
 *
 * Geometrin nedan är samma som i public/brand/ferva-market.svg respektive
 * ferva-market-mono.svg. SVG-filerna är källan; ferva-mark.test.ts faller om
 * konstanterna och filerna glider isär.
 */
export const FERVA_MARK_VIEWBOX = "0 0 64 64";
export const FERVA_MARK_PATH = "M20 16 H44 L36 24 H28 V28 H38 L30 36 H28 V48 H20 Z";
export const FERVA_MARK_RADIUS = 15;
/** Ferva-gul platta. Varumärkesfärg - inte samma sak som --color-warn. */
export const FERVA_MARK_YELLOW = "#F2B01E";
/** Bläck i märket. */
export const FERVA_MARK_INK = "#201F1B";

export function FervaMark({
  size = 32,
  tone = "brand",
  className,
  label,
}: {
  /** Sidan i kvadraten, i pixlar. Sätts som attribut så att märket har rätt
   *  storlek även där appens CSS inte är laddad (global-error.tsx). */
  size?: number;
  /** "brand" = bläck-F på gul platta. "mono" = bara F:et i currentColor. */
  tone?: "brand" | "mono";
  className?: string;
  /** Anges bara när märket står utan ordet "Ferva" bredvid sig. */
  label?: string;
}) {
  const decorative = label === undefined;
  return (
    <svg
      width={size}
      height={size}
      viewBox={FERVA_MARK_VIEWBOX}
      className={cx("shrink-0", className)}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={label}
      focusable="false"
    >
      {tone === "brand" ? (
        <rect width="64" height="64" rx={FERVA_MARK_RADIUS} fill={FERVA_MARK_YELLOW} />
      ) : null}
      <path d={FERVA_MARK_PATH} fill={tone === "brand" ? FERVA_MARK_INK : "currentColor"} />
    </svg>
  );
}
