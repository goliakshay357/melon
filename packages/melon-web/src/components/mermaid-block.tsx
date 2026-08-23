import { useEffect, useId, useState } from 'react';

/** Renders a mermaid diagram definition to SVG, dark-themed, error-tolerant. */
export function MermaidBlock({ code }: { code: string }) {
    const reactId = useId();
    const domId = `mmd-${reactId.replace(/[^a-zA-Z0-9]/g, '')}`;
    const [svg, setSvg] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { default: mermaid } = await import('mermaid');
                mermaid.initialize({
                    startOnLoad: false,
                    theme: 'dark',
                    securityLevel: 'strict',
                });
                const { svg: out } = await mermaid.render(domId, code);
                if (!cancelled) {
                    setSvg(out);
                    setError(null);
                }
            } catch (e) {
                if (!cancelled) setError((e as Error).message ?? 'render failed');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [code, domId]);

    if (error) {
        return (
            <div className="my-2 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-red-400">
                    ⚠️ mermaid render failed
                </p>
                <pre className="mt-1 overflow-x-auto text-[10px] text-muted-foreground">{code}</pre>
                <p className="mt-1 text-[10px] text-red-300">{error}</p>
            </div>
        );
    }

    return (
        <div
            className="my-2 overflow-x-auto rounded-lg border border-border bg-background/60 px-3 py-3"
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
}
