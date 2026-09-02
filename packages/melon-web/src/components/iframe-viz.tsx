import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveTheme } from '@/theme/theme-store';

/**
 * Renders an agent-authored, self-contained HTML visualization inline in chat.
 * Sandboxed: scripts allowed, no same-origin. Height auto-fits the scene via
 * a postMessage handshake (clamped 200–700px).
 *
 * Two modes:
 * - `code`  — inline HTML (small hand-written scenes)
 * - `path`  — a file on disk written by a tool/skill (e.g. archify). Fetched
 *             from the server via GET /viz; the file never passes through the
 *             model's context. Height handshake: the server injects the
 *             reporter script into the fetched document.
 */
export const IframeViz = memo(function IframeViz({
    code,
    path,
    cwd,
}: {
    code?: string;
    path?: string;
    cwd?: string;
}) {
    const frameRef = useRef<HTMLIFrameElement | null>(null);
    const [height, setHeight] = useState(320);
    const [fetchedDoc, setFetchedDoc] = useState<string | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const theme = useActiveTheme();

    // File mode: fetch the HTML from the server (guard lives server-side).
    useEffect(() => {
        if (!path) return; // inline mode — nothing to fetch
        let alive = true;
        setFetchedDoc(null);
        setFailed(null);
        const qs = new URLSearchParams({ path });
        if (cwd) qs.set('cwd', cwd);
        fetch(`/viz?${qs}`)
            .then(async (r) => {
                if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
                return r.text();
            })
            .then((doc) => alive && setFetchedDoc(doc))
            .catch((e) => alive && setFailed(String(e.message ?? e)));
        return () => {
            alive = false;
        };
    }, [path, cwd]);

    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            if (e.source !== frameRef.current?.contentWindow) return;
            const d = e.data as { type?: string; height?: number };
            if (d?.type === 'melon-viz-height' && typeof d.height === 'number') {
                const h = Math.min(Math.max(Math.round(d.height), 200), 700);
                // Ignore sub-3px changes: the height handshake is a feedback
                // loop (report → resize → report); a threshold stops 1-2px
                // wobble from re-rendering/jumping the iframe.
                setHeight((prev) => (Math.abs(prev - h) < 3 ? prev : h));
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);

    const reporter = useMemo(
        () => `<script>
            let lastH = -1;
            const report = () => {
                const h = Math.ceil(document.documentElement.scrollHeight);
                if (h === lastH) return; // no change — don't re-announce (stops the loop)
                lastH = h;
                parent.postMessage({ type: 'melon-viz-height', height: h }, '*');
            };
            window.addEventListener('load', report);
            // Body doesn't exist yet when this runs (script is in <head>) — attach
            // the observer only once the document is ready, or observe() throws.
            window.addEventListener('DOMContentLoaded', () => {
                if (document.body) new ResizeObserver(report).observe(document.body);
            });
            setTimeout(report, 50); setTimeout(report, 500);
        </scr` + `ipt>`,
        [],
    );

    const srcDoc = useMemo(() => {
        const doc = path ? fetchedDoc : code;
        if (doc == null) return null; // still loading (or error card shown below)
        const dark = `<style>html,body{margin:0;background:${theme.tokens.vizBackground};color:${theme.tokens.vizForeground};overflow:hidden}</style>`;
        if (!/<html|<body/i.test(doc)) {
            return `<!doctype html><html><head>${dark}${reporter}</head><body>${doc}</body></html>`;
        }
        // Full document (archify): replace <head> to inject our reporter so the
        // height handshake still works. Keep the doc's own <html> attrs (theme etc).
        if (doc.includes('<head>')) {
            return doc.replace('<head>', `<head>${reporter}`);
        }
        return `${dark}${reporter}${doc}`;
    }, [path, fetchedDoc, code, theme, reporter]);

    // While loading a file-mode viz, reserve a stable frame so the chat
    // doesn't collapse/jump when the document arrives.
    if (path && failed) {
        return (
            <div className="my-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                couldn't load visualization — {failed}
            </div>
        );
    }

    return (
        <div className="my-2 overflow-hidden rounded-lg border border-primary/40">
            {srcDoc != null ? (
                <iframe
                    ref={frameRef}
                    title="visualization"
                    sandbox="allow-scripts"
                    srcDoc={srcDoc}
                    style={{
                        height,
                        width: '100%',
                        backgroundColor: theme.tokens.vizBackground,
                        transition: 'height 150ms ease',
                    }}
                    className="block max-w-full border-0"
                />
            ) : (
                <div
                    style={{ height, backgroundColor: theme.tokens.vizBackground }}
                    className="block w-full animate-pulse"
                />
            )}
        </div>
    );
});
