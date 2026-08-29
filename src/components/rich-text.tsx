import type {
  RichTextBlock,
  RichTextDoc,
  RichTextInline,
  RichTextListItem,
  RichTextMark,
} from "@/lib/richtext";
import { isRichTextEmpty } from "@/lib/richtext";
import { cx } from "./ui";
import type { ReactNode } from "react";

/**
 * Delad, ren renderare för "Övrig information" (rik text) – används av BÅDE
 * offert- och fakturadokumentet och därmed på alla ytor: appens detaljsidor,
 * kundvyerna (/offert/[token], /faktura/[token]) och print/PDF-sidorna.
 *
 * Inga hooks, ingen dangerouslySetInnerHTML – sanerad JSON renderas till
 * React-element. Typografin styrs av .richtext-doc i globals.css
 * (H1 24px / H2 20px / H3 17px / brödtext 14px) så Tailwind Preflight
 * inte kan göra rubrikerna identiska.
 */

function markWrap(node: ReactNode, marks: RichTextMark[] | undefined, key: number): ReactNode {
  let out = node;
  for (const mark of marks ?? []) {
    if (mark.type === "bold") out = <strong className="font-semibold text-ink">{out}</strong>;
    else if (mark.type === "italic") out = <em>{out}</em>;
    else if (mark.type === "underline") out = <u>{out}</u>;
    else if (mark.type === "link") {
      out = (
        <a
          href={mark.attrs.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-2 hover:text-accent-deep"
        >
          {out}
        </a>
      );
    }
  }
  return <span key={key}>{out}</span>;
}

function Inline({ content }: { content?: RichTextInline[] }) {
  if (!content || content.length === 0) return null;
  return (
    <>
      {content.map((node, i) =>
        node.type === "hardBreak" ? <br key={i} /> : markWrap(node.text, node.marks, i)
      )}
    </>
  );
}

function ListItems({ items }: { items: RichTextListItem[] }) {
  return (
    <>
      {items.map((item, i) => (
        <li key={i}>
          {item.content.map((block, j) => {
            if (block.type === "paragraph") {
              return (
                <p key={j} className="leading-relaxed">
                  <Inline content={block.content} />
                </p>
              );
            }
            const Tag = block.type === "orderedList" ? "ol" : "ul";
            return (
              <Tag
                key={j}
                className={cx(
                  "mt-1 space-y-1 pl-5",
                  block.type === "orderedList" ? "list-decimal" : "list-disc"
                )}
              >
                <ListItems items={block.content} />
              </Tag>
            );
          })}
        </li>
      ))}
    </>
  );
}

function Block({ block }: { block: RichTextBlock }) {
  switch (block.type) {
    case "heading": {
      const Tag = block.attrs.level === 1 ? "h1" : block.attrs.level === 2 ? "h2" : "h3";
      return (
        <Tag>
          <Inline content={block.content} />
        </Tag>
      );
    }
    case "paragraph":
      // Tomt stycke = medveten luft.
      if (!block.content || block.content.length === 0) return <p aria-hidden="true">{"\u00a0"}</p>;
      return (
        <p className="leading-relaxed">
          <Inline content={block.content} />
        </p>
      );
    case "bulletList":
      return (
        <ul className="list-disc space-y-1 pl-5">
          <ListItems items={block.content} />
        </ul>
      );
    case "orderedList":
      return (
        <ol className="list-decimal space-y-1 pl-5">
          <ListItems items={block.content} />
        </ol>
      );
    case "horizontalRule":
      return <hr className="my-4 border-line" />;
  }
}

/** Ren rendering av sanerad rik text. Renderar ingenting för tomt/saknat innehåll. */
export function RichTextView({ doc, className }: { doc?: RichTextDoc | null; className?: string }) {
  if (!doc || isRichTextEmpty(doc)) return null;
  return (
    <div className={cx("richtext-doc space-y-2 text-soft", className)}>
      {doc.content.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}
