import { useEffect, useRef } from 'react';
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { history } from '@milkdown/plugin-history';
import { listener, listenerCtx, ListenerManager } from '@milkdown/plugin-listener';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { useActiveTheme } from '@/theme/theme-store';

function EditorInner({
    content,
    onChange,
}: {
    content: string;
    onChange: (md: string) => void;
}) {
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const boxRef = useRef<HTMLDivElement>(null);

    // Focus the ProseMirror contenteditable — deferred so React Flow's node
    // mousedown doesn't win; lets you type on the SAME click that creates/selects.
    const focusEditor = () => {
        setTimeout(() => {
            const pm = boxRef.current?.querySelector('.ProseMirror') as HTMLElement | null;
            pm?.focus();
        }, 0);
    };

    const { loading } = useEditor(
        (root) =>
            Editor.make()
                .config((ctx) => {
                    ctx.set(rootCtx, root);
                    ctx.set(defaultValueCtx, content);
                    ctx.set(
                        listenerCtx,
                        new ListenerManager().markdownUpdated((_ctx, md) => onChangeRef.current(md)),
                    );
                })
                .use(commonmark)
                .use(gfm)
                .use(history)
                .use(listener),
        [],
    );

    // Auto-focus once the editor is ready → type the moment the card is created.
    useEffect(() => {
        if (!loading) focusEditor();
    }, [loading]);

    return (
        <div ref={boxRef} className="nodrag h-full" onMouseDown={focusEditor}>
            <Milkdown />
        </div>
    );
}

/** Notion-like WYSIWYG markdown editor. */
export function DocumentEditor({
    content,
    onChange,
}: {
    content: string;
    onChange: (md: string) => void;
}) {
    const theme = useActiveTheme();
    return (
        <div
            className="nowheel h-full overflow-y-auto px-3 py-2"
            style={{ background: theme.tokens.vizBackground, color: theme.tokens.vizForeground }}
        >
            <MilkdownProvider>
                <EditorInner content={content} onChange={onChange} />
            </MilkdownProvider>
        </div>
    );
}
