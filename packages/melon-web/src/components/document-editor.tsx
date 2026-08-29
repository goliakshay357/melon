import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { history } from '@milkdown/plugin-history';
import { listener, listenerCtx, ListenerManager } from '@milkdown/plugin-listener';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { useRef } from 'react';
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
    useEditor(
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

    return <Milkdown />;
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
