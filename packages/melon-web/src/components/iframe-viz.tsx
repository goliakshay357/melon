import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveTheme } from '@/theme/theme-store';

/**
 * Renders an agent-authored, self-contained HTML visualization inline in chat.
 * Sandboxed: scripts allowed, no same-origin. Height auto-fits the scene via
 * a postMessage handshake (clamped 200–700px).
 */
export const IframeViz = memo(function IframeViz({ code }: { code: string }) {
    const frameRef = useRef<HTMLIFrameElement | null>(null);
    const [height, setHeight] = useState(320);
    const theme = useActiveTheme();

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

    const srcDoc = useMemo(() => {
        const dark = `<style>html,body{margin:0;background:${theme.tokens.vizBackground};color:${theme.tokens.vizForeground};overflow:hidden}</style>`;
        const reporter = `<script>
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
        </scr` + `ipt>`;
        let doc = code;
        if (!/<html|<body/i.test(doc)) {
            doc = `<!doctype html><html><head>${dark}${reporter}</head><body>${doc}</body></html>`;
        } else if (doc.includes('<head>')) {
            doc = doc.replace('<head>', `<head>${dark}${reporter}`);
        } else {
            doc = `${dark}${reporter}${doc}`;
        }
        return doc;
    }, [code, theme]);

    return (
        <div className="my-2 overflow-hidden rounded-lg border border-primary/40">
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
        </div>
    );
});
