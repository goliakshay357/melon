import { useMemo } from 'react';

/**
 * Renders an agent-authored, self-contained HTML visualization inline in chat.
 * Sandboxed: scripts allowed, no same-origin, no cookies/localStorage access.
 */
export function IframeViz({ code }: { code: string }) {
    const srcDoc = useMemo(() => {
        // Ensure dark baseline even if the agent forgets body styling.
        const dark = `<style>html,body{margin:0;background:#282a36;color:#e6edf3;overflow:hidden}</style>`;
        if (/<html|<body/i.test(code)) {
            // inject after <head> if present, else prepend
            return code.includes('<head>')
                ? code.replace('<head>', `<head>${dark}`)
                : `${dark}${code}`;
        }
        return `<!doctype html><html><head>${dark}</head><body>${code}</body></html>`;
    }, [code]);

    return (
        <div className="my-2 overflow-hidden rounded-lg border border-primary/40">
            <iframe
                title="visualization"
                sandbox="allow-scripts"
                srcDoc={srcDoc}
                className="block w-full border-0 bg-[#282a36]"
                style={{ height: 320 }}
            />
        </div>
    );
}
