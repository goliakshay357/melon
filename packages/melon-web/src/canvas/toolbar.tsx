import { useState } from 'react';
import { useOnViewportChange, useReactFlow } from '@xyflow/react';
import { Maximize, Moon, Sun, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect as useReactEffect } from 'react';
import { useCanvasStore } from '@/store/canvas-store';

export function Toolbar() {
    const { zoomIn, zoomOut, fitView, getZoom } = useReactFlow();
    const [zoom, setZoom] = useState(Math.round(getZoom() * 100));
    const scrollAction = useCanvasStore((s) => s.scrollAction);
    const setScrollAction = useCanvasStore((s) => s.setScrollAction);
    const [theme, setTheme] = useState<'light' | 'dark'>(() =>
        (localStorage.getItem('melon:theme') as 'light' | 'dark') || 'light',
    );

    // Apply + persist theme (GitHub light/dark palettes via .dark class)
    useReactEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        localStorage.setItem('melon:theme', theme);
        window.dispatchEvent(new CustomEvent('melon:theme', { detail: theme }));
    }, [theme]);

    useOnViewportChange({
        onChange: (v) => setZoom(Math.round(v.zoom * 100)),
    });

    const btn =
        'rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground';

    return (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card/90 px-2 py-1 shadow-sm backdrop-blur">
            <button className={btn} onClick={() => zoomOut({ duration: 200 })} title="Zoom out">
                <ZoomOut className="size-4" />
            </button>
            <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
                {zoom}%
            </span>
            <button className={btn} onClick={() => zoomIn({ duration: 200 })} title="Zoom in">
                <ZoomIn className="size-4" />
            </button>
            <button
                className={btn}
                onClick={() => fitView({ padding: 0.2, duration: 300 })}
                title="Fit view"
            >
                <Maximize className="size-4" />
            </button>
            <div className="mx-1 h-5 w-px bg-border" />
            <button
                className={btn}
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                title={theme === 'light' ? 'Night mode' : 'Day mode'}
            >
                {theme === 'light' ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </button>
            <div className="mx-1 h-5 w-px bg-border" />
            <select
                className="cursor-pointer rounded-md bg-transparent px-1 py-0.5 text-xs text-muted-foreground outline-none hover:bg-secondary"
                value={scrollAction}
                onChange={(e) =>
                    setScrollAction(e.target.value as 'pan' | 'zoom')
                }
                title="What two-finger scroll does"
            >
                <option value="pan">scroll = pan</option>
                <option value="zoom">scroll = zoom</option>
            </select>
        </div>
    );
}
