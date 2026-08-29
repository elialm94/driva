"use client";

import { useCallback, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import {
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Minus,
  Redo2,
  Sparkles,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { buttonClasses, cx } from "./ui";
import { sanitizeLinkHref, sanitizeRichText, type RichTextDoc } from "@/lib/richtext";
import { shortcutFromEvent } from "@/lib/richtext-shortcuts";
import { improveRichTextAction } from "@/app/richtext-actions";

/**
 * Rik text-editor för "Övrig information" på offerter och fakturor.
 *
 *   * TipTap med en MEDVETET liten verktygsrad: Normal text/H1–H3, fet,
 *     kursiv, understruken, punktlista, numrerad lista, länk, avdelare,
 *     ångra/gör om. Inga typsnitt, färger, tabeller eller bilder.
 *   * Värdet är dokument-JSON (RichTextDoc) – aldrig HTML.
 *   * "Förbättra" anropar en dedikerad, verktygslös server action och
 *     skriver in förslaget som ett vanligt historiksteg (ett Cmd+Z ångrar).
 */

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

/** Kompakt verktygsradsknapp med ≥44px träffyta på touch-skärmar. */
function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cx(
        "flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg px-1.5 text-[13px] font-medium transition-colors max-lg:h-11 max-lg:min-w-11",
        active ? "bg-ink text-white" : "text-soft hover:bg-ink/5 hover:text-ink",
        disabled && "pointer-events-none opacity-40"
      )}
    >
      {children}
    </button>
  );
}

function ToolDivider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 self-center bg-line-strong" />;
}

/** Markeringens JSON som ett eget dokument, för urvals-AI. */
function selectionToDoc(editor: Editor): { doc: RichTextDoc; from: number; to: number } | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const slice = editor.state.doc.slice(from, to).toJSON() as { content?: unknown };
  const doc = sanitizeRichText({ type: "doc", content: slice.content ?? [] });
  if (!doc) return null;
  return { doc, from, to };
}

function applyImprovedDoc(editor: Editor, suggestion: RichTextDoc, range: { from: number; to: number } | null) {
  if (!range) {
    editor.chain().focus().setContent(suggestion).run();
    return;
  }
  const $from = editor.state.doc.resolve(range.from);
  const $to = editor.state.doc.resolve(range.to);
  const first = suggestion.content[0];
  const inlineOnly =
    $from.sameParent($to) &&
    $from.parent.isTextblock &&
    suggestion.content.length === 1 &&
    first?.type === "paragraph";
  if (inlineOnly && first.type === "paragraph") {
    editor
      .chain()
      .focus()
      .insertContentAt({ from: range.from, to: range.to }, first.content ?? [])
      .run();
    return;
  }
  editor.chain().focus().insertContentAt({ from: range.from, to: range.to }, suggestion.content).run();
}

/**
 * Egna genvägar: TipTaps inbyggda `Shift-Mod-z` matchar inte `event.key === "Z"`
 * (Shift gör tecknet versalt), så Gör om aldrig triggades. Vi normaliserar
 * till gemener och preventDefault så webbläsaren inte tar över.
 */
function handleEditorShortcut(editor: Editor, event: KeyboardEvent): boolean {
  const which = shortcutFromEvent(event);
  if (!which) return false;
  event.preventDefault();
  if (which === "bold") return editor.commands.toggleBold();
  if (which === "italic") return editor.commands.toggleItalic();
  if (which === "underline") return editor.commands.toggleUnderline();
  if (which === "undo") return editor.commands.undo();
  return editor.commands.redo();
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Skriv vad som ingår, villkor eller annan information kunden behöver se…",
  ariaLabel = "Övrig information",
  aiEnabled = false,
}: {
  /** Initialt dokument. Editorn äger tillståndet efter montering. */
  value?: RichTextDoc;
  /** Anropas med sanerad JSON (undefined när fältet är tomt). */
  onChange: (doc: RichTextDoc | undefined) => void;
  placeholder?: string;
  ariaLabel?: string;
  /** isAiConfigured() från serversidan – utan nyckel visas ingen AI-knapp. */
  aiEnabled?: boolean;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editorRef = useRef<Editor | null>(null);

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        code: false,
        codeBlock: false,
        strike: false,
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: "https",
          protocols: ["http", "https", "mailto"],
        },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: value && value.content.length > 0 ? value : EMPTY_DOC,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel,
      },
      handleKeyDown: (_view, event) => {
        const ed = editorRef.current;
        if (!ed) return false;
        return handleEditorShortcut(ed, event);
      },
    },
    onUpdate: ({ editor: e }) => {
      onChangeRef.current(sanitizeRichText(e.getJSON()));
    },
  });
  editorRef.current = editor;

  const state = useEditorState({
    editor,
    selector: ({ editor: e }: { editor: Editor | null }) => ({
      paragraph: e?.isActive("paragraph") && !e?.isActive("bulletList") && !e?.isActive("orderedList"),
      h1: e?.isActive("heading", { level: 1 }) ?? false,
      h2: e?.isActive("heading", { level: 2 }) ?? false,
      h3: e?.isActive("heading", { level: 3 }) ?? false,
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      underline: e?.isActive("underline") ?? false,
      bullet: e?.isActive("bulletList") ?? false,
      ordered: e?.isActive("orderedList") ?? false,
      link: e?.isActive("link") ?? false,
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
    }),
  });

  const openLink = useCallback(() => {
    if (!editor) return;
    const current = (editor.getAttributes("link").href as string | undefined) ?? "";
    setLinkDraft(current);
    setLinkError(false);
    setLinkOpen(true);
  }, [editor]);

  function applyLink() {
    if (!editor) return;
    const raw = linkDraft.trim();
    if (!raw) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkOpen(false);
      return;
    }
    const candidate = /^(https?:|mailto:)/i.test(raw) ? raw : `https://${raw}`;
    const href = sanitizeLinkHref(candidate);
    if (!href) {
      setLinkError(true);
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
  }

  async function runImprove() {
    if (!editor || aiBusy) return;
    setAiError(null);
    const selected = selectionToDoc(editor);
    const original = selected?.doc ?? sanitizeRichText(editor.getJSON());
    if (!original) {
      setAiError("Skriv lite text först, så kan AI:n förbättra den.");
      return;
    }
    const range = selected ? { from: selected.from, to: selected.to } : null;
    setAiBusy(true);
    try {
      const result = await improveRichTextAction("forbattra", original);
      if (result.ok) {
        applyImprovedDoc(editor, result.doc, range);
      } else {
        setAiError(result.error);
      }
    } catch {
      setAiError("AI-anropet misslyckades. Försök igen om en stund.");
    } finally {
      setAiBusy(false);
    }
  }

  if (!editor) {
    return (
      <div className="richtext-editor rounded-xl border border-line-strong bg-card">
        <div className="min-h-[136px]" />
      </div>
    );
  }

  const c = () => editor.chain().focus();

  return (
    <div className="richtext-editor overflow-visible rounded-xl border border-line-strong bg-card transition-colors focus-within:border-accent">
      <div
        className="relative flex items-center gap-0.5 overflow-x-auto border-b border-line px-1.5 py-1"
        role="toolbar"
        aria-label="Textformatering"
      >
        <ToolButton label="Normal text" active={state?.paragraph} onClick={() => c().setParagraph().run()}>
          Text
        </ToolButton>
        <ToolButton label="Rubrik 1" active={state?.h1} onClick={() => c().toggleHeading({ level: 1 }).run()}>
          H1
        </ToolButton>
        <ToolButton label="Rubrik 2" active={state?.h2} onClick={() => c().toggleHeading({ level: 2 }).run()}>
          H2
        </ToolButton>
        <ToolButton label="Rubrik 3" active={state?.h3} onClick={() => c().toggleHeading({ level: 3 }).run()}>
          H3
        </ToolButton>
        <ToolDivider />
        <ToolButton label="Fet (⌘B / Ctrl+B)" active={state?.bold} onClick={() => c().toggleBold().run()}>
          <Bold className="size-4" />
        </ToolButton>
        <ToolButton label="Kursiv (⌘I / Ctrl+I)" active={state?.italic} onClick={() => c().toggleItalic().run()}>
          <Italic className="size-4" />
        </ToolButton>
        <ToolButton
          label="Understruken (⌘U / Ctrl+U)"
          active={state?.underline}
          onClick={() => c().toggleUnderline().run()}
        >
          <UnderlineIcon className="size-4" />
        </ToolButton>
        <ToolDivider />
        <ToolButton label="Punktlista" active={state?.bullet} onClick={() => c().toggleBulletList().run()}>
          <List className="size-4" />
        </ToolButton>
        <ToolButton label="Numrerad lista" active={state?.ordered} onClick={() => c().toggleOrderedList().run()}>
          <ListOrdered className="size-4" />
        </ToolButton>
        <ToolButton label="Länk" active={state?.link} onClick={openLink}>
          <Link2 className="size-4" />
        </ToolButton>
        <ToolButton label="Avdelare" onClick={() => c().setHorizontalRule().run()}>
          <Minus className="size-4" />
        </ToolButton>
        <ToolDivider />
        <ToolButton label="Ångra (⌘Z / Ctrl+Z)" disabled={!state?.canUndo} onClick={() => c().undo().run()}>
          <Undo2 className="size-4" />
        </ToolButton>
        <ToolButton
          label="Gör om (⌘⇧Z / Ctrl+Y)"
          disabled={!state?.canRedo}
          onClick={() => c().redo().run()}
        >
          <Redo2 className="size-4" />
        </ToolButton>
        {aiEnabled ? (
          <button
            type="button"
            title="Förbättra text med AI"
            aria-label="Förbättra text med AI"
            disabled={aiBusy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void runImprove()}
            className={cx(
              "ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-accent/35 bg-accent-soft px-2.5 text-[13px] font-medium text-accent-deep shadow-sm transition-colors",
              "hover:border-accent/60 hover:bg-accent/15 hover:text-accent-deep",
              "disabled:cursor-wait disabled:opacity-70 max-lg:h-11"
            )}
          >
            {aiBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            <span className="whitespace-nowrap">{aiBusy ? "Förbättrar…" : "Förbättra"}</span>
          </button>
        ) : null}
      </div>

      {linkOpen ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/60 px-3 py-2">
          <label htmlFor="richtext-link-url" className="text-[12px] font-medium text-soft">
            Länk
          </label>
          <input
            id="richtext-link-url"
            value={linkDraft}
            onChange={(e) => {
              setLinkDraft(e.target.value);
              setLinkError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
              if (e.key === "Escape") setLinkOpen(false);
            }}
            placeholder="https://exempel.se eller mailto:namn@exempel.se"
            autoFocus
            inputMode="url"
            className="min-w-0 flex-1 rounded-lg border border-line-strong bg-card px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted focus:border-accent"
          />
          <button type="button" onClick={applyLink} className={cx(buttonClasses("secondary", "sm"), "max-lg:min-h-11")}>
            {linkDraft.trim() ? "Spara länk" : "Ta bort länk"}
          </button>
          <button type="button" onClick={() => setLinkOpen(false)} className={cx(buttonClasses("ghost", "sm"), "max-lg:min-h-11")}>
            Avbryt
          </button>
          {linkError ? (
            <p className="w-full text-[12px] font-medium text-danger">
              Ogiltig länk. Endast http://, https:// eller mailto: stöds.
            </p>
          ) : null}
        </div>
      ) : null}

      <EditorContent editor={editor} />

      {aiError ? (
        <p className="border-t border-line px-3.5 py-2 text-[12px] font-medium text-danger" role="alert">
          {aiError}
        </p>
      ) : null}
    </div>
  );
}
