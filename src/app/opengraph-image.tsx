import { ImageResponse } from "next/og";
import {
  FERVA_MARK_INK,
  FERVA_MARK_PATH,
  FERVA_MARK_VIEWBOX,
  FERVA_MARK_YELLOW,
} from "@/components/ferva-mark";

/**
 * Delningsbilden för länkar till Ferva (Slack, iMessage, LinkedIn, X).
 *
 * Ritas av Next ImageResponse i stället för att rastreras för hand: då sätts
 * ordet i Geist, samma typsnitt som appen. Geist är det inbyggda typsnittet i
 * next/og, så ingen fonts-lista behövs.
 *
 * Märket ligger i mono-tonen (bara F:et) eftersom bakgrunden redan är den gula
 * plattan - den vanliga tonen skulle lägga gult på gult.
 *
 * Next fyller twitter:image från og:image när twitter saknar egen bild, så
 * någon twitter-image behövs inte.
 */
export const alt = "Ferva";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
          background: FERVA_MARK_YELLOW,
          color: FERVA_MARK_INK,
        }}
      >
        {/* Märkets bläck fyller halva sin viewBox (y 16-48 av 64), så rutan
            måste vara ungefär dubbelt så hög som ordets versalhöjd. */}
        <svg width={250} height={250} viewBox={FERVA_MARK_VIEWBOX}>
          <path d={FERVA_MARK_PATH} fill={FERVA_MARK_INK} />
        </svg>
        <div style={{ fontSize: 168, letterSpacing: "-0.04em" }}>Ferva</div>
      </div>
    ),
    size,
  );
}
