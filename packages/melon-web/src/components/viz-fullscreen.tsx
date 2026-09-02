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
    open: (node: HTMLIFrameElement, title: string) => void;
    close: () => void;
}

export const useVizFullscreen = create<VizFullscreenState>((set) => ({
    node: null,
    title: '',
    open: (node, title) => set({ node, title }),
    close: () => set({ node: null, title: '' }),
}));
