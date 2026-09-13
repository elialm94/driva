process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import manifest from "../app/manifest";
import {
  FERVA_MARK_INK,
  FERVA_MARK_PATH,
  FERVA_MARK_RADIUS,
  FERVA_MARK_VIEWBOX,
  FERVA_MARK_YELLOW,
} from "../components/ferva-mark";
import {
  BRAND_DIR,
  ICON_DIR,
  ICON_TARGETS,
  checkIcons,
  compareIconToSource,
  pngSize,
  readMarkSvg,
} from "./brand-icons";

/**
 * Märket får finnas på exakt ett ställe: SVG:erna i public/brand/. PNG-ikoner,
 * webbmanifest och FervaMark-komponenten ska alla gå att härleda därifrån.
 * Testerna nedan faller så fort något av dem glider isär.
 */
describe("varumärkesmärket: SVG-källan styr ikoner, manifest och komponent", () => {
  it("varje ikon i manifestet finns på disk med rätt storlek och purpose", () => {
    const icons = manifest().icons ?? [];
    assert.ok(icons.length > 0, "manifestet listar minst en ikon");

    for (const icon of icons) {
      assert.ok(icon.src?.startsWith("/icons/"), `${icon.src} ligger i /icons/`);
      const file = path.join(process.cwd(), "public", icon.src);
      assert.ok(existsSync(file), `${icon.src} finns på disk`);

      const { width, height } = pngSize(readFileSync(file));
      assert.equal(`${width}x${height}`, icon.sizes, `${icon.src} har storleken manifestet utlovar`);
      assert.equal(icon.type, "image/png", `${icon.src} är deklarerad som PNG`);
    }

    // Installerbarhet: Android vill ha både en vanlig och en maskable 512.
    const maskable = icons.filter((i) => i.purpose === "maskable");
    assert.equal(maskable.length, 1, "exakt en maskable-ikon");
    assert.equal(maskable[0].sizes, "512x512");
    assert.ok(
      icons.some((i) => i.sizes === "512x512" && !i.purpose),
      "en 512-ikon utan purpose (any)"
    );
    assert.ok(icons.some((i) => i.sizes === "192x192"), "en 192-ikon");
  });

  it("alla PNG-ikoner är rastreringar av sin SVG-källa i public/brand/", () => {
    const failed = checkIcons().filter((r) => !r.ok);
    assert.deepEqual(
      failed.map((r) => `${r.file} (${r.source}): ${r.problem}`),
      []
    );
  });

  it("kontrollen faller när en ikon jämförs mot fel SVG-källa", () => {
    // Skyddar toleransen: den är satt för kantutjämning, inte för att släppa
    // igenom en ikon som ritats ur en annan fil. icon-16/32 kommer ur
    // favicon.svg och ska inte gå att förväxla med ferva-market.svg.
    const wrong = compareIconToSource("icon-16.png", 16, "ferva-market.svg");
    assert.equal(wrong.ok, false, "icon-16 mot ferva-market.svg ska falla");

    const alsoWrong = compareIconToSource("icon-192.png", 192, "favicon.svg");
    assert.equal(alsoWrong.ok, false, "icon-192 mot favicon.svg ska falla");
  });

  it("FervaMark-komponenten har samma geometri som SVG-filerna", () => {
    const brand = readMarkSvg("ferva-market.svg");
    assert.equal(brand.pathData, FERVA_MARK_PATH, "banan i komponenten = banan i ferva-market.svg");
    assert.equal(brand.geometry.plate?.radius, FERVA_MARK_RADIUS);
    assert.match(brand.source, new RegExp(`viewBox="${FERVA_MARK_VIEWBOX}"`));
    assert.match(brand.source, new RegExp(FERVA_MARK_YELLOW, "i"));
    assert.match(brand.source, new RegExp(FERVA_MARK_INK, "i"));

    // Mono-tonen ritar samma F men låter anroparen bestämma färgen.
    const mono = readMarkSvg("ferva-market-mono.svg");
    assert.equal(mono.pathData, FERVA_MARK_PATH, "banan i komponenten = banan i ferva-market-mono.svg");
    assert.equal(mono.geometry.plate, null, "mono har ingen platta");
    assert.equal(mono.geometry.inkAttr, "currentColor");
  });

  it("varumärkesfilerna och ikonfilerna ligger kvar på sina platser", () => {
    for (const file of ["ferva-market.svg", "ferva-market-square.svg", "ferva-market-mono.svg", "favicon.svg"]) {
      assert.ok(existsSync(path.join(BRAND_DIR, file)), `public/brand/${file}`);
    }
    for (const { file } of ICON_TARGETS) {
      assert.ok(existsSync(path.join(ICON_DIR, file)), `public/icons/${file}`);
    }
    assert.ok(existsSync(path.join(process.cwd(), "src", "app", "favicon.ico")), "src/app/favicon.ico");
  });

  it("den gula plattan är varumärkesfärgen, inte gränssnittets varningsfärg", () => {
    // --color-accent och --color-warn ägs av gränssnittet. Ferva-gult bor bara
    // i märket och får aldrig smyga in som en tema-token.
    const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
    assert.doesNotMatch(css, new RegExp(FERVA_MARK_YELLOW, "i"), "Ferva-gult ska inte finnas i globals.css");
  });
});
