import { memo as ReactMemo, useEffect, useRef } from "react";
import { Editor, rootCtx, defaultValueCtx } from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { history } from "@milkdown/plugin-history";
import { listener, listenerCtx, ListenerManager } from "@milkdown/plugin-listener";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { $inputRule } from "@milkdown/utils";
import { InputRule } from "@milkdown/prose/inputrules";
import { wrapInList } from "prosemirror-schema-list";
import { useActiveTheme } from "@/theme/theme-store";
import { useCanvasStore } from "@/store/canvas-store";

// Bare `[ ]` / `[x]` → task item, even when NOT inside a list (wraps the
// line in a bulleted task list). Standard `- [ ]` still works via GFM.
const bareTaskListRule = $inputRule(
	() =>
		new InputRule(/^\[(?<checked>\s|x)\]\s$/, (state, match, start, end) => {
			const checked = Boolean(match.groups?.checked === "x");
			const pos = state.doc.resolve(start);
			let depth = 0;
			let node = pos.node(depth);
			while (node && node.type.name !== "list_item") {
				depth--;
				node = pos.node(depth);
			}
			// Already inside a list → flip the current item into a task.
			if (node && node.type.name === "list_item") {
				const tr = state.tr.deleteRange(start, end);
				return tr.setNodeMarkup(pos.before(depth), undefined, { ...node.attrs, checked });
			}
			// Not in a list → delete the checkbox text, then wrap the line in a bullet list.
			const tr = state.tr.deleteRange(start, end);
			const st = state.apply(tr);
			const bullet = st.schema.nodes.bulleted_list;
			if (!bullet) return null;
			let wrapped: any = null;
			wrapInList(bullet)(st, (t: any) => {
				wrapped = t;
			});
			if (!wrapped) return null;
			// Mark the freshly wrapped item as a task.
			const cur = wrapped.doc.resolve(wrapped.mapping.map(start));
			let d = 0;
			let n = cur.node(d);
			while (n && n.type.name !== "list_item") {
				d--;
				n = cur.node(d);
			}
			if (n && n.type.name === "list_item") {
				return wrapped.setNodeMarkup(cur.before(d), undefined, { ...n.attrs, checked });
			}
			return wrapped;
		}),
);

function EditorInner({ cardId, initialContent }: { cardId: string; initialContent: string }) {
	const boxRef = useRef<HTMLDivElement>(null);
	// Freeze the seed markdown for this editor instance. Later keystrokes live
	// in Milkdown/ProseMirror history — re-feeding store content would wipe undo.
	const seedRef = useRef(initialContent);

	const focusEditor = () => {
		setTimeout(() => {
			const pm = boxRef.current?.querySelector(".ProseMirror") as HTMLElement | null;
			pm?.focus();
		}, 0);
	};

	const { loading } = useEditor((root) => {
		return Editor.make()
			.config((ctx) => {
				ctx.set(rootCtx, root);
				ctx.set(defaultValueCtx, seedRef.current);
				ctx.set(
					listenerCtx,
					new ListenerManager().markdownUpdated((_ctx, md) => {
						useCanvasStore.getState().updateCard(cardId, { documentContent: md });
					}),
				);
			})
			.use(commonmark)
			.use(gfm)
			.use(bareTaskListRule)
			.use(history)
			.use(listener);
	}, []);

	useEffect(() => {
		if (!loading) focusEditor();
	}, [loading]);

	return (
		<div
			ref={boxRef}
			className="nodrag h-full"
			onMouseDown={focusEditor}
			// Stop bubbling to React Flow / canvas layout undo, but do not
			// preventDefault — Milkdown history owns Mod-Z / Shift-Mod-Z / Mod-Y.
			onKeyDown={(e) => {
				const key = e.key.toLowerCase();
				if ((e.metaKey || e.ctrlKey) && (key === "z" || key === "y")) {
					e.stopPropagation();
					return;
				}
				e.stopPropagation();
			}}
		>
			<Milkdown />
		</div>
	);
}

function DocumentEditorInner({ cardId, initialContent }: { cardId: string; initialContent: string }) {
	const theme = useActiveTheme();
	return (
		<div
			className="nowheel h-full overflow-y-auto bg-background px-3 py-2 text-foreground"
			style={{ background: theme.tokens.vizBackground, color: theme.tokens.vizForeground }}
			data-appearance={theme.appearance}
		>
			<MilkdownProvider>
				<EditorInner cardId={cardId} initialContent={initialContent} />
			</MilkdownProvider>
		</div>
	);
}

/**
 * Document body editor. Mount once per card (`key={cardId}` upstream).
 * Props stay stable so Milkdown's history plugin is not remounted on each keystroke.
 */
export const DocumentEditor = ReactMemo(DocumentEditorInner);
