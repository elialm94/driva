import { lineKindOf, type LineKind } from "./economic-line-type";
import { createDocLine, type LinePriceDefaults } from "./line-defaults";
import { LINE_EDITOR_FIELDS, lineFieldId, type LineEditorField } from "./form-requirements";
import type { DocLine } from "./types";

export { LINE_EDITOR_FIELDS, lineFieldId, type LineEditorField };

export const LINE_UNDO_LIMIT = 20;
export const LINE_DELETED_TOAST = "Raden borttagen";

export type LineNavResult = { kind: "field"; field: LineEditorField } | { kind: "new-row" };

/** Nästa redigerbara fält åt höger. Moms → ny rad. Papperskorgen ingår inte. */
export function nextLineField(field: LineEditorField): LineNavResult {
  if (field === "moms") return { kind: "new-row" };
  const index = LINE_EDITOR_FIELDS.indexOf(field);
  return { kind: "field", field: LINE_EDITOR_FIELDS[index + 1]! };
}

export interface LineDeleteEntry<T = DocLine> {
  line: T;
  index: number;
}

export function cloneDocLine<T extends object>(line: T): T {
  return { ...line };
}

export function removeLineAt<T extends { id: string }>(
  lines: readonly T[],
  id: string
): { lines: T[]; removed: LineDeleteEntry<T> | null } {
  const index = lines.findIndex((line) => line.id === id);
  if (index < 0) return { lines: lines.slice(), removed: null };
  const removed = { line: cloneDocLine(lines[index]!), index };
  return { lines: lines.filter((_, i) => i !== index), removed };
}

export function insertLineAt<T>(lines: readonly T[], entry: LineDeleteEntry<T>): T[] {
  const next = lines.slice();
  const index = Math.max(0, Math.min(entry.index, next.length));
  next.splice(index, 0, entry.line);
  return next;
}

export function insertLineAfter<T>(lines: readonly T[], index: number, line: T): T[] {
  const next = lines.slice();
  next.splice(index + 1, 0, line);
  return next;
}

export function pushLimited<T>(stack: readonly T[], item: T, limit = LINE_UNDO_LIMIT): T[] {
  return [...stack, item].slice(-limit);
}

export function applyLineUndo<T>(
  lines: readonly T[],
  undo: readonly LineDeleteEntry<T>[],
  redo: readonly LineDeleteEntry<T>[]
): {
  lines: T[];
  undo: LineDeleteEntry<T>[];
  redo: LineDeleteEntry<T>[];
  restored: LineDeleteEntry<T> | null;
} {
  if (undo.length === 0) {
    return { lines: lines.slice(), undo: undo.slice(), redo: redo.slice(), restored: null };
  }
  const entry = undo[undo.length - 1]!;
  return {
    lines: insertLineAt(lines, entry),
    undo: undo.slice(0, -1),
    redo: pushLimited(redo, entry),
    restored: entry,
  };
}

export function applyLineRedo<T extends { id: string }>(
  lines: readonly T[],
  undo: readonly LineDeleteEntry<T>[],
  redo: readonly LineDeleteEntry<T>[]
): {
  lines: T[];
  undo: LineDeleteEntry<T>[];
  redo: LineDeleteEntry<T>[];
  removed: LineDeleteEntry<T> | null;
} {
  if (redo.length === 0) {
    return { lines: lines.slice(), undo: undo.slice(), redo: redo.slice(), removed: null };
  }
  const entry = redo[redo.length - 1]!;
  const currentIndex = lines.findIndex((line) => line.id === entry.line.id);
  const removed = {
    line: cloneDocLine(entry.line),
    index: currentIndex >= 0 ? currentIndex : entry.index,
  };
  return {
    lines: currentIndex >= 0 ? lines.filter((_, i) => i !== currentIndex) : lines.slice(),
    undo: pushLimited(undo, removed),
    redo: redo.slice(0, -1),
    removed,
  };
}

/**
 * Ny rad efter Enter på Moms: samma typ, canonical defaults.
 * Kopierar inte beskrivning, antal, à-pris eller moms från föregående rad.
 */
export function createFollowUpLine(source: { kind?: string; type?: string }, defaults: LinePriceDefaults = {}): DocLine {
  return createDocLine(lineKindOf(source), defaults);
}

export function followUpLineKind(source: { kind?: string; type?: string }): LineKind {
  return lineKindOf(source);
}

export type LineUndoShortcut = "undo" | "redo" | null;

export function lineUndoShortcut(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}): LineUndoShortcut {
  if (e.altKey) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === "y" && e.ctrlKey && !e.metaKey && !e.shiftKey) return "redo";
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  return null;
}

type DomLike = {
  tagName?: string;
  isContentEditable?: boolean;
  type?: string;
  closest?: (selector: string) => unknown;
};

export function isEditableTextTarget(target: DomLike | EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as DomLike;
  if (el.isContentEditable) return true;
  const tag = String(el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = String(el.type ?? "text").toLowerCase();
    return !["button", "submit", "checkbox", "radio", "file", "hidden", "reset", "image"].includes(type);
  }
  return false;
}

export function isInsideLineEditor(target: DomLike | EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const closest = (target as DomLike).closest;
  if (typeof closest !== "function") return false;
  return Boolean(closest.call(target, "[data-line-editor]"));
}

/**
 * Rad-undo endast när det är säkert:
 * – utanför textfält, eller
 * – i ett prisradfält direkt efter delete (innan user börjat skriva).
 * Native text-undo i Beskrivning/Antal/À-pris och i andra formulärfält lämnas ifred.
 */
export function shouldHandleRowUndo(args: {
  shortcut: LineUndoShortcut;
  hasUndo: boolean;
  hasRedo: boolean;
  typedSinceDelete: boolean;
  target: DomLike | EventTarget | null;
}): boolean {
  if (args.shortcut === "undo" && !args.hasUndo) return false;
  if (args.shortcut === "redo" && !args.hasRedo) return false;
  if (!args.shortcut) return false;
  if (isEditableTextTarget(args.target)) {
    if (!isInsideLineEditor(args.target)) return false;
    if (args.typedSinceDelete) return false;
  }
  return true;
}

export function shouldAdvanceOnEnter(args: {
  defaultPrevented: boolean;
  isComposing?: boolean;
  selectOpen?: boolean;
}): boolean {
  if (args.defaultPrevented) return false;
  if (args.isComposing) return false;
  if (args.selectOpen) return false;
  return true;
}

/** Återfokusera Beskrivning bara om user inte redan gått vidare till en annan rad. */
export function shouldRefocusRestoredLine(args: {
  activeLineId: string | null;
  restoredLineId: string;
  focusMovedToOtherLine: boolean;
}): boolean {
  if (args.focusMovedToOtherLine) return false;
  if (args.activeLineId && args.activeLineId !== args.restoredLineId) return false;
  return true;
}
