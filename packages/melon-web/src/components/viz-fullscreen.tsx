import { create } from 'zustand';

/**
 * Fullscreen viz coordination — tiny cross-instance store.
 * Case 3 from the design: only ONE fullscreen viz at a time. Opening a new
 * one closes any existing one (two portals would z-fight / stack Escape
 * handlers unpredictably).
 */
interface VizFullscreenState {
    /** The iframe DOM node currently promoted to fullscreen. */
    node: HTMLIFrameElement | null;
    /** Header info for the fullscreen chrome (title). */
    title: string;
    /** Server URL to "open in browser" (file mode only). */
    url: string | null;
    open: (node: HTMLIFrameElement, title: string, url: string | null) => void;
    close: () => void;
}

export const useVizFullscreen = create<VizFullscreenState>((set) => ({
    node: null,
    title: '',
    url: null,
    open: (node, title, url) => set({ node, title, url }),
    close: () => set({ node: null, title: '', url: null }),
}));
