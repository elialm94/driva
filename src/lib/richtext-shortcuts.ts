/**
 * Editorgenvägar – ren nyckelmatchning så att Shift+Z (event.key === "Z")
 * räknas som redo, inte som en missad binding.
 */

export type RichTextShortcut = "bold" | "italic" | "underline" | "undo" | "redo";

export function shortcutFromEvent(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}): RichTextShortcut | null {
  if (event.isComposing) return null;
  const mod = event.metaKey || event.ctrlKey;
  if (!mod || event.altKey) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === "b" && !event.shiftKey) return "bold";
  if (key === "i" && !event.shiftKey) return "italic";
  if (key === "u" && !event.shiftKey) return "underline";
  if (key === "z" && event.shiftKey) return "redo";
  if (key === "z") return "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return null;
}

type DomRange = {
  startContainer: Node;
  startOffset: number;
  endContainer: Node;
  endOffset: number;
};

/**
 * ProseMirror uppdaterar ibland manuell Shift+pil-markering i DOM:en
 * en tick senare än tangentnedslaget. Cmd+B på en synlig markering
 * ska då ändå träffa den texten, inte bara sätta stored marks.
 */
export function markRangeFromDomFallback(args: {
  empty: boolean;
  from: number;
  to: number;
  posAtDOM: (node: Node, offset: number) => number;
  contains: (node: Node) => boolean;
  domSelection: {
    isCollapsed: boolean;
    rangeCount: number;
    getRangeAt: (index: number) => DomRange;
  } | null;
}): { from: number; to: number } | null {
  if (!args.empty) return { from: args.from, to: args.to };
  const sel = args.domSelection;
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!args.contains(range.startContainer) || !args.contains(range.endContainer)) return null;
  try {
    const a = args.posAtDOM(range.startContainer, range.startOffset);
    const b = args.posAtDOM(range.endContainer, range.endOffset);
    if (a === b) return null;
    return { from: Math.min(a, b), to: Math.max(a, b) };
  } catch {
    return null;
  }
}
