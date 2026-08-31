process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDocLine } from "./line-defaults";
import {
  LINE_DELETED_TOAST,
  LINE_EDITOR_FIELDS,
  LINE_UNDO_LIMIT,
  applyLineRedo,
  applyLineUndo,
  createFollowUpLine,
  followUpLineKind,
  insertLineAfter,
  isEditableTextTarget,
  isInsideLineEditor,
  lineFieldId,
  lineUndoShortcut,
  nextLineField,
  pushLimited,
  removeLineAt,
  shouldAdvanceOnEnter,
  shouldHandleRowUndo,
  shouldRefocusRestoredLine,
} from "./line-editor-nav";
import type { DocLine } from "./types";

function line(over: Partial<DocLine> & { id: string }): DocLine {
  return {
    kind: "material",
    type: "MATERIAL",
    description: "",
    qty: 1,
    unit: "st",
    unitPrice: 0,
    vatRate: 25,
    ...over,
  };
}

describe("Enter-flow: nästa fält åt höger", () => {
  it("går Typ → Beskrivning → Antal → Enhet → À-pris → Moms → ny rad", () => {
    assert.deepEqual(nextLineField("typ"), { kind: "field", field: "beskrivning" });
    assert.deepEqual(nextLineField("beskrivning"), { kind: "field", field: "antal" });
    assert.deepEqual(nextLineField("antal"), { kind: "field", field: "enhet" });
    assert.deepEqual(nextLineField("enhet"), { kind: "field", field: "pris" });
    assert.deepEqual(nextLineField("pris"), { kind: "field", field: "moms" });
    assert.deepEqual(nextLineField("moms"), { kind: "new-row" });
  });

  it("papperskorgen ingår inte i fältordningen", () => {
    assert.deepEqual([...LINE_EDITOR_FIELDS], ["typ", "beskrivning", "antal", "enhet", "pris", "moms"]);
  });

  it("fält-id:n matchar DOM-id:n i editorn", () => {
    assert.equal(lineFieldId("abc", "beskrivning"), "rad-abc-beskrivning");
    assert.equal(lineFieldId("abc", "pris"), "rad-abc-pris");
    assert.equal(lineFieldId("abc", "moms"), "rad-abc-moms");
  });
});

describe("Enter på Moms: ny rad med samma typ, canonical defaults", () => {
  it("ärver typ men inte beskrivning, antal, pris eller moms", () => {
    const source = line({
      id: "src",
      kind: "material",
      type: "MATERIAL",
      description: "Spikar",
      qty: 4,
      unit: "ask",
      unitPrice: 200,
      vatRate: 12,
    });
    const next = createFollowUpLine(source, { defaultVatRate: 25, defaultHourlyRate: 650 });
    assert.equal(followUpLineKind(source), "material");
    assert.equal(next.kind, "material");
    assert.equal(next.type, "MATERIAL");
    assert.equal(next.description, "");
    assert.equal(next.qty, 1);
    assert.equal(next.unit, "st");
    assert.equal(next.unitPrice, 0);
    assert.equal(next.vatRate, 25);
    assert.notEqual(next.id, source.id);
  });

  it("Arbete får samma creation logic som + Arbete (standard timpris)", () => {
    const source = line({
      id: "arb",
      kind: "arbete",
      type: "LABOR",
      description: "Montering",
      qty: 3,
      unit: "dag",
      unitPrice: 900,
      vatRate: 12,
    });
    const viaEnter = createFollowUpLine(source, { defaultVatRate: 25, defaultHourlyRate: 650 });
    const viaButton = createDocLine("arbete", { defaultVatRate: 25, defaultHourlyRate: 650 });
    assert.equal(viaEnter.kind, viaButton.kind);
    assert.equal(viaEnter.unit, viaButton.unit);
    assert.equal(viaEnter.unitPrice, viaButton.unitPrice);
    assert.equal(viaEnter.vatRate, viaButton.vatRate);
    assert.equal(viaEnter.qty, 1);
    assert.equal(viaEnter.unit, "tim");
    assert.equal(viaEnter.unitPrice, 650);
    assert.equal(viaEnter.description, "");
  });

  it("kopierar inte föregående 0 kr-pris till nästa Arbete-rad", () => {
    const source = line({
      id: "free",
      kind: "arbete",
      type: "LABOR",
      description: "Städning",
      qty: 1,
      unit: "tim",
      unitPrice: 0,
      vatRate: 25,
    });
    const next = createFollowUpLine(source, { defaultVatRate: 25, defaultHourlyRate: 650 });
    assert.equal(next.unitPrice, 650);
    assert.equal(source.unitPrice, 0);
  });

  it("Resor och Övrigt ärver typ med canonical defaults", () => {
    const travel = createFollowUpLine({ kind: "resor", type: "TRAVEL" }, { defaultVatRate: 25, defaultHourlyRate: 650 });
    assert.equal(travel.kind, "resor");
    assert.equal(travel.unit, "tim");
    assert.equal(travel.unitPrice, 0);

    const other = createFollowUpLine({ kind: "ovrigt", type: "OTHER" }, { defaultVatRate: 6 });
    assert.equal(other.kind, "ovrigt");
    assert.equal(other.unit, "st");
    assert.equal(other.vatRate, 6);
    assert.equal(other.unitPrice, 0);
  });

  it("0 kr förblir giltigt på källraden (nullish, inte ||)", () => {
    const explicitZero = 0;
    const hourly = 650;
    assert.equal(explicitZero ?? hourly, 0);
    assert.equal(explicitZero || hourly, 650);
  });
});

describe("infoga efter aktuell rad", () => {
  it("lägger den nya raden direkt efter den avslutade, inte alltid sist", () => {
    const a = line({ id: "a", description: "A" });
    const b = line({ id: "b", description: "B" });
    const c = line({ id: "c", description: "C" });
    const extra = line({ id: "x", description: "" });
    const next = insertLineAfter([a, b, c], 0, extra);
    assert.deepEqual(
      next.map((l) => l.id),
      ["a", "x", "b", "c"]
    );
  });
});

describe("delete + undo-stack", () => {
  it("toast-copy är Raden borttagen", () => {
    assert.equal(LINE_DELETED_TOAST, "Raden borttagen");
  });

  it("tar bort raden och återställer exakt på originalpositionen", () => {
    const rows = [
      line({ id: "1", description: "Luckor", unitPrice: 800 }),
      line({ id: "2", description: "Spikar", qty: 4, unit: "st", unitPrice: 200, vatRate: 25 }),
      line({ id: "3", description: "Lim", unitPrice: 50 }),
    ];
    const deleted = removeLineAt(rows, "2");
    assert.deepEqual(
      deleted.lines.map((l) => l.id),
      ["1", "3"]
    );
    assert.equal(deleted.removed?.index, 1);
    assert.equal(deleted.removed?.line.description, "Spikar");
    assert.equal(deleted.removed?.line.qty, 4);
    assert.equal(deleted.removed?.line.unitPrice, 200);

    const undone = applyLineUndo(deleted.lines, [deleted.removed!], []);
    assert.deepEqual(
      undone.lines.map((l) => l.id),
      ["1", "2", "3"]
    );
    assert.deepEqual(undone.lines[1], rows[1]);
    assert.equal(undone.undo.length, 0);
    assert.equal(undone.redo.length, 1);
  });

  it("behåller 0 kr vid delete och undo", () => {
    const rows = [line({ id: "stad", description: "Städning", unitPrice: 0, vatRate: 25 })];
    const deleted = removeLineAt(rows, "stad");
    assert.equal(deleted.removed?.line.unitPrice, 0);
    const undone = applyLineUndo([], [deleted.removed!], []);
    assert.equal(undone.lines[0]?.unitPrice, 0);
    assert.equal(undone.lines[0]?.description, "Städning");
  });

  it("återställer även metadata (sourceKind/sourceId)", () => {
    const rows = [
      line({ id: "q", description: "Från offert", unitPrice: 100, sourceKind: "QUOTE_LINE", sourceId: "ql-1" }),
    ];
    const deleted = removeLineAt(rows, "q");
    const undone = applyLineUndo([], [deleted.removed!], []);
    assert.equal(undone.lines[0]?.sourceKind, "QUOTE_LINE");
    assert.equal(undone.lines[0]?.sourceId, "ql-1");
  });

  it("flera deletes undo:as i omvänd ordning (B sen A)", () => {
    const a = line({ id: "A", description: "A", unitPrice: 10 });
    const b = line({ id: "B", description: "B", unitPrice: 20 });
    const c = line({ id: "C", description: "C", unitPrice: 30 });
    let rows = [a, b, c];
    const delA = removeLineAt(rows, "A");
    rows = delA.lines;
    const delB = removeLineAt(rows, "B");
    rows = delB.lines;
    let undo = [delA.removed!, delB.removed!];
    let redo: typeof undo = [];

    const first = applyLineUndo(rows, undo, redo);
    rows = first.lines;
    undo = first.undo;
    redo = first.redo;
    assert.deepEqual(
      rows.map((l) => l.id),
      ["B", "C"]
    );

    const second = applyLineUndo(rows, undo, redo);
    assert.deepEqual(
      second.lines.map((l) => l.id),
      ["A", "B", "C"]
    );
    assert.equal(second.lines[0]?.description, "A");
  });

  it("redo tar bort den återställda raden igen", () => {
    const rows = [line({ id: "1", description: "En" }), line({ id: "2", description: "Två" })];
    const deleted = removeLineAt(rows, "1");
    const undone = applyLineUndo(deleted.lines, [deleted.removed!], []);
    const redone = applyLineRedo(undone.lines, undone.undo, undone.redo);
    assert.deepEqual(
      redone.lines.map((l) => l.id),
      ["2"]
    );
    assert.equal(redone.undo.length, 1);
    assert.equal(redone.redo.length, 0);
  });

  it("begränsar stacken till senaste 20", () => {
    const stacked = pushLimited(
      Array.from({ length: LINE_UNDO_LIMIT }, (_, i) => i),
      LINE_UNDO_LIMIT
    );
    assert.equal(stacked.length, LINE_UNDO_LIMIT);
    assert.equal(stacked[0], 1);
    assert.equal(stacked[LINE_UNDO_LIMIT - 1], LINE_UNDO_LIMIT);
  });
});

describe("Cmd/Ctrl+Z shortcuts", () => {
  it("Mac Cmd+Z = undo, Cmd+Shift+Z = redo", () => {
    assert.equal(lineUndoShortcut({ key: "z", metaKey: true, ctrlKey: false, shiftKey: false }), "undo");
    assert.equal(lineUndoShortcut({ key: "Z", metaKey: true, ctrlKey: false, shiftKey: true }), "redo");
  });

  it("Windows/Linux Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo", () => {
    assert.equal(lineUndoShortcut({ key: "z", metaKey: false, ctrlKey: true, shiftKey: false }), "undo");
    assert.equal(lineUndoShortcut({ key: "y", metaKey: false, ctrlKey: true, shiftKey: false }), "redo");
    assert.equal(lineUndoShortcut({ key: "z", metaKey: false, ctrlKey: true, shiftKey: true }), "redo");
  });

  it("ignorerar Z utan modifier och Alt+Z", () => {
    assert.equal(lineUndoShortcut({ key: "z", metaKey: false, ctrlKey: false, shiftKey: false }), null);
    assert.equal(lineUndoShortcut({ key: "z", metaKey: true, ctrlKey: false, shiftKey: false, altKey: true }), null);
  });
});

describe("native text-undo ska inte kapas", () => {
  it("känns igen som textmål: input, textarea, contenteditable", () => {
    assert.equal(isEditableTextTarget({ tagName: "INPUT", type: "text" }), true);
    assert.equal(isEditableTextTarget({ tagName: "TEXTAREA" }), true);
    assert.equal(isEditableTextTarget({ isContentEditable: true, tagName: "DIV" }), true);
    assert.equal(isEditableTextTarget({ tagName: "SELECT" }), false);
    assert.equal(isEditableTextTarget({ tagName: "BUTTON" }), false);
    assert.equal(isEditableTextTarget({ tagName: "INPUT", type: "button" }), false);
  });

  it("stjäl inte Cmd+Z från textfält efter att user skrivit", () => {
    const input = { tagName: "INPUT", type: "text", closest: () => ({}) };
    assert.equal(
      shouldHandleRowUndo({
        shortcut: "undo",
        hasUndo: true,
        hasRedo: false,
        typedSinceDelete: true,
        target: input,
      }),
      false
    );
  });

  it("stjäl inte Cmd+Z från textfält utanför prisraderna (t.ex. rubrik eller TipTap)", () => {
    const title = { tagName: "INPUT", type: "text", closest: () => null };
    const editor = { tagName: "DIV", isContentEditable: true, closest: () => null };
    assert.equal(
      shouldHandleRowUndo({
        shortcut: "undo",
        hasUndo: true,
        hasRedo: false,
        typedSinceDelete: false,
        target: title,
      }),
      false
    );
    assert.equal(
      shouldHandleRowUndo({
        shortcut: "undo",
        hasUndo: true,
        hasRedo: false,
        typedSinceDelete: false,
        target: editor,
      }),
      false
    );
  });

  it("hanterar rad-undo i prisradfält direkt efter delete, innan någon skrivit", () => {
    const input = { tagName: "INPUT", type: "text", closest: (sel: string) => (sel === "[data-line-editor]" ? {} : null) };
    assert.equal(isInsideLineEditor(input), true);
    assert.equal(
      shouldHandleRowUndo({
        shortcut: "undo",
        hasUndo: true,
        hasRedo: false,
        typedSinceDelete: false,
        target: input,
      }),
      true
    );
  });

  it("hanterar rad-undo när focus inte är i ett textfält", () => {
    assert.equal(
      shouldHandleRowUndo({
        shortcut: "undo",
        hasUndo: true,
        hasRedo: false,
        typedSinceDelete: false,
        target: { tagName: "BUTTON" },
      }),
      true
    );
  });

  it("gör inget utan stack", () => {
    assert.equal(
      shouldHandleRowUndo({
        shortcut: "undo",
        hasUndo: false,
        hasRedo: false,
        typedSinceDelete: false,
        target: { tagName: "BODY" },
      }),
      false
    );
  });
});

describe("Enter-guard", () => {
  it("går vidare bara när dropdown inte är öppen och eventet inte redan hanterats", () => {
    assert.equal(shouldAdvanceOnEnter({ defaultPrevented: false }), true);
    assert.equal(shouldAdvanceOnEnter({ defaultPrevented: true }), false);
    assert.equal(shouldAdvanceOnEnter({ defaultPrevented: false, selectOpen: true }), false);
    assert.equal(shouldAdvanceOnEnter({ defaultPrevented: false, isComposing: true }), false);
  });
});

describe("fokus efter undo", () => {
  it("återfokuserar om user inte gått vidare till en annan rad", () => {
    assert.equal(
      shouldRefocusRestoredLine({ activeLineId: null, restoredLineId: "2", focusMovedToOtherLine: false }),
      true
    );
    assert.equal(
      shouldRefocusRestoredLine({
        activeLineId: "1",
        restoredLineId: "2",
        focusMovedToOtherLine: true,
      }),
      false
    );
  });
});
