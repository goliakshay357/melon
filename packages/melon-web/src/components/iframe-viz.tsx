import { useEffect, useRef, useState } from 'react';

/**
 * Renders an agent-authored, self-contained HTML visualization inline in chat.
 * Sandboxed: scripts allowed, no same-origin. Height auto-fits the scene via
 * a postMessage handshake (clamped 200–700px).
 */
export function IframeViz({ code }: { code: string }) {
    const frameRef = useRef<HTMLIFrameElement | null>(null);
    const [height, setHeight] = useState(320);

    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            if (e.source !== frameRef.current?.contentWindow) return;
            const d = e.data as { type?: string; height?: number };
            if (d?.type === 'melon-viz-height' && typeof d.height === 'number') {
                setHeight(Math.min(Math.max(Math.round(d.height), 200), 700));
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);

    const srcDoc = useMemo(() => {
        const dark = `<style>html,body{margin:0;background:#282a36;color:#f8f8f2;overflow:hidden}</style>`;
        const reporter = `<script>
            const report = () => parent.postMessage({ type: 'melon-viz-height', height: Math.ceil(document.documentElement.scrollHeight) }, '*');
            window.addEventListener('load', report);
            new ResizeObserver(report).observe(document.body);
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
    }, [code]);

    return (
        <div className="my-2 overflow-hidden rounded-lg border border-primary/40">
            <iframe
                ref={frameRef}
                title="visualization"
                sandbox="allow-scripts"
                srcDoc={srcDoc}
                style={{ height, width: '100%' }}
                className="block max-w-full border-0 bg-[#282a36]"
            />
        </div>
    );
}

import { useMemo } from 'react';
