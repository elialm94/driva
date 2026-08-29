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
