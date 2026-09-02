import { memo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useActiveTheme } from '@/theme/theme-store';
import { useCanvasStore } from '@/store/canvas-store';
import { useVizFullscreen } from './viz-fullscreen';

/**
 * The fullscreen layer for viz frames. Renders the PROMOTED iframe node
 * (moved out of its inline slot via portal) at z-[1000] — one above the
 * card-maximize overlay (z-[999]) so a viz expanded from a maximized card
 * layers on top (case 2).
 *
 * Escape nesting: keydown is captured in the CAPTURE phase and stopped —
 * the card-maximize's window listener never sees it. Escape #1 closes the
 * viz; Escape #2 un-maximizes the card. One layer per press.
 *
 * The promoted iframe keeps its own document state (theme/zoom) because the
 * DOM node is reused, not remounted (case 4). When closed, React re-parents
 * it back into the inline slot.
 *
 * Auto-close when the app leaves the canvas view (case 7): a portal on
 * document.body would otherwise sit above the settings page.
 */
export const VizFullscreenLayer = memo(function VizFullscreenLayer() {
    const { node, title, url, close } = useVizFullscreen();
    const activeView = useCanvasStore((s) => s.activeView);
    const theme = useActiveTheme();
    const hostRef = useRef<HTMLDivElement | null>(null);
    const returnToRef = useRef<Element | null>(null); // where the node came from

    // Case 7: settings page opens while a viz is fullscreen — close it,
    // otherwise the portal floats over an unrelated view.
    useEffect(() => {
        if (node && activeView !== 'canvas') close();
    }, [activeView, node, close]);

    useEffect(() => {
        if (!node) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            // Capture phase + stop: this layer wins over any other Escape
            // handler (card maximize). One Escape = one layer peeled.
            e.stopPropagation();
            e.stopImmediatePropagation();
            close();
        };
        window.addEventListener('keydown', onKey, { capture: true });
        return () => window.removeEventListener('keydown', onKey, { capture: true });
    }, [node, close]);

    // DOM re-parenting (NOT React children): a raw iframe node rendered as a
    // React child would be adopted-and-destroyed by reconciliation. Instead,
    // physically move the element into our host div and put it BACK on close.
    // The iframe document (theme/zoom state) survives the move (case 4).
    useEffect(() => {
        if (!node || !hostRef.current) return;
        returnToRef.current = node.parentElement;
        hostRef.current.appendChild(node);
        node.style.width = '100%';
        node.style.height = '100%';
        return () => {
            // un-promote: restore geometry and re-parent home.
            node.style.width = '';
            node.style.height = '';
            returnToRef.current?.appendChild(node);
            returnToRef.current = null;
        };
    }, [node]);

    if (!node) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[1000] flex flex-col bg-black/85 p-4 backdrop-blur-sm"
            onMouseDown={(e) => {
                // Backdrop close — stop so the card overlay behind never sees it.
                if (e.target === e.currentTarget) {
                    e.stopPropagation();
                    close();
                }
            }}
        >
            {/* Chrome: title + actions. Backdrop-click guard via stopPropagation. */}
            <div
                className="mb-2 flex shrink-0 items-center gap-2"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/70">
                    {title || 'visualization'}
                </span>
                {url && (
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open in browser"
                        className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/80 transition-colors hover:bg-white/20 hover:text-white"
                    >
                        <Maximize2 className="size-3.5" /> browser
                    </a>
                )}
                <button
                    onClick={close}
                    title="Close (Esc)"
                    className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/80 transition-colors hover:bg-white/20 hover:text-white"
                >
                    <Minimize2 className="size-3.5" /> exit fullscreen
                </button>
            </div>
            {/* The promoted iframe — physically re-parented here by the effect
                above; the div below is its mount host. */}
            <div
                ref={hostRef}
                className="min-h-0 flex-1 overflow-hidden rounded-lg border border-white/15"
                onMouseDown={(e) => e.stopPropagation()}
            />
        </div>,
        document.body,
    );
    // theme unused visually (backdrop is black over everything) — kept for
    // potential frame tinting; suppress lint noise.
    void theme;
});
