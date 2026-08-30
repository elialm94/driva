/**
 * Avdelare (horizontalRule) ska alltid landa som syskon till toppnivåblock –
 * aldrig inuti listItem. TipTaps standardkommando gör insertContent vid
 * markören, och listItem-schemat (`paragraph block*`) tillåter hr som barn.
 * Följande stycke hamnar då kvar i listan och ärver indraget.
 */

import { InputRule, Node, mergeAttributes } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

export function applyInsertDividerAtRoot(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  tr?: Transaction
): boolean {
  const hrType = state.schema.nodes.horizontalRule;
  const paraType = state.schema.nodes.paragraph;
  if (!hrType || !paraType) return false;

  const transaction = tr ?? state.tr;
  const $from = transaction.selection.$from;
  // Efter det toppnivåblock som innehåller markören (listan, stycket, rubriken).
  // depth 0 = mellan toppnivåblock (t.ex. gapcursor precis efter en lista).
  const insertPos = $from.depth >= 1 ? $from.after(1) : $from.pos;
  const $insert = transaction.doc.resolve(insertPos);
  const index = $insert.index();
  const hr = hrType.create();
  const para = paraType.create();
  const fragment = Fragment.from([hr, para]);
  if (!$insert.parent.canReplace(index, index, fragment)) return false;

  if (dispatch) {
    transaction.insert(insertPos, fragment);
    transaction.setSelection(TextSelection.create(transaction.doc, insertPos + hr.nodeSize + 1));
    transaction.scrollIntoView();
    dispatch(transaction);
  }
  return true;
}

/** Ersätter StarterKits HorizontalRule så att setHorizontalRule / --- lämnar listor. */
export const rootHorizontalRule = Node.create({
  name: "horizontalRule",
  group: "block",

  parseHTML() {
    return [{ tag: "hr" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["hr", mergeAttributes(HTMLAttributes)];
  },

  addCommands() {
    return {
      setHorizontalRule:
        () =>
        ({ state, dispatch, tr }) =>
          applyInsertDividerAtRoot(state, dispatch, tr),
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^(?:---|—-|___\s|\*\*\*\s)$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).setHorizontalRule().run();
        },
      }),
    ];
  },
});
