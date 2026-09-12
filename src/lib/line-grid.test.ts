process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LINE_GRID_HEADER, LINE_GRID_ROW, RowActions } from "../components/lines-editor";

/**
 * Prisradernas desktop-tabell är ett rutnät med fasta kolumner. En fast
 * kolumn växer inte med sitt innehåll, så är sista kolumnen smalare än
 * radknapparna hamnar knapparna utanför kortet. Måtten går att räkna på utan
 * webbläsare: kolumnmallen står i klassnamnet och knapparnas bredd kommer ur
 * renderad markup.
 */

/** Tailwinds skala: gap-2 = 0.5rem, size-8 = 2rem. */
function spacingRem(token: string): number {
  return Number(token) * 0.25;
}

function desktopGrid(cls: string): { breakpointRem: number; tracks: string[] } {
  const match = cls.match(/@min-\[(\d+(?:\.\d+)?)rem\]:grid-cols-\[([^\]]+)\]/);
  assert.ok(match, `hittar ingen kolumnmall i klassnamnet: ${cls}`);
  return { breakpointRem: Number(match[1]), tracks: match[2].split("_") };
}

/** rem för en fast kolumn, null för en flexibel (minmax(0,1fr)). */
function trackRem(track: string): number | null {
  const fixed = track.match(/^(\d+(?:\.\d+)?)rem$/);
  if (fixed) return Number(fixed[1]);
  assert.match(track, /1fr/, `okänd kolumntyp: ${track}`);
  return null;
}

function renderedRowActionsRem(): number {
  const markup = renderToStaticMarkup(
    createElement(RowActions, {
      canUp: true,
      canDown: true,
      onUp: () => {},
      onDown: () => {},
      onDuplicate: () => {},
      // Desktop visar även spara-i-registret, så knappgruppen är som bredast.
      onSaveArticle: () => {},
      onDelete: () => {},
    })
  );
  const buttons = [...markup.matchAll(/<button[^>]*class="([^"]*)"/g)];
  assert.ok(buttons.length > 0, "RowActions renderade inga knappar");
  return buttons.reduce((sum, button) => {
    const size = button[1].match(/(?:^| )size-(\d+(?:\.\d+)?)(?: |$)/);
    assert.ok(size, `radknapp utan size-klass: ${button[1]}`);
    return sum + spacingRem(size[1]);
  }, 0);
}

describe("prisradernas kolumnmall", () => {
  it("rubrikrad och prisrad har samma kolumner och samma brytpunkt", () => {
    const header = desktopGrid(LINE_GRID_HEADER);
    const row = desktopGrid(LINE_GRID_ROW);
    assert.deepEqual(header.tracks, row.tracks);
    assert.equal(header.breakpointRem, row.breakpointRem);
  });

  it("sista kolumnen rymmer hela radknappsgruppen", () => {
    const { tracks } = desktopGrid(LINE_GRID_ROW);
    const actions = trackRem(tracks[tracks.length - 1]);
    assert.ok(actions != null, "radknapparnas kolumn måste ha en fast bredd");
    assert.ok(
      actions >= renderedRowActionsRem(),
      `radknapparna är ${renderedRowActionsRem()}rem men kolumnen bara ${actions}rem – knapparna hamnar utanför kortet`
    );
  });

  it("de fasta kolumnerna plus mellanrummen ryms inom brytpunkten", () => {
    const { breakpointRem, tracks } = desktopGrid(LINE_GRID_ROW);
    const gap = LINE_GRID_ROW.match(/@min-\[\d+(?:\.\d+)?rem\]:gap-(\d+(?:\.\d+)?)/);
    assert.ok(gap, "prisraden saknar gap på desktop");
    const fixed = tracks.reduce((sum, track) => sum + (trackRem(track) ?? 0), 0);
    const gaps = spacingRem(gap[1]) * (tracks.length - 1);
    // Beskrivningen är den flexibla kolumnen och måste vara användbar redan
    // vid brytpunkten, annars ska radkorten användas i stället.
    const descriptionRem = breakpointRem - fixed - gaps;
    assert.equal(
      tracks.filter((track) => trackRem(track) === null).length,
      1,
      "exakt en kolumn (beskrivning) ska vara flexibel"
    );
    assert.ok(
      descriptionRem >= 6,
      `beskrivningen får ${descriptionRem}rem vid brytpunkten ${breakpointRem}rem – för smal`
    );
  });

  it("hela prisradseditorn byter layout vid en och samma brytpunkt", () => {
    const source = fs.readFileSync(new URL("../components/lines-editor.tsx", import.meta.url), "utf8");
    const breakpoints = [...new Set([...source.matchAll(/@min-\[(\d+(?:\.\d+)?)rem\]/g)].map((m) => m[1]))];
    assert.deepEqual(breakpoints, [String(desktopGrid(LINE_GRID_ROW).breakpointRem)]);
  });
});
