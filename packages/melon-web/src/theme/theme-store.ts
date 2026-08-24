import { create } from "zustand";
import { DEFAULT_THEME_ID, getTheme, type Theme } from "./themes";

const STORAGE_KEY = "melon:theme";

/** Migrate legacy boolean-ish values from the old two-state toggle. */
function normalizeStored(id: string | null): string {
	if (id === "light") return "light";
	if (getTheme(id ?? "")) return id as string;
	return DEFAULT_THEME_ID;
}

interface ThemeState {
	themeId: string;
	setTheme: (id: string) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
	themeId: normalizeStored(localStorage.getItem(STORAGE_KEY)),
	setTheme: (themeId) => {
		if (!getTheme(themeId)) return;
		localStorage.setItem(STORAGE_KEY, themeId);
		set({ themeId });
	},
}));

/** Non-reactive read (event handlers, non-React code). */
export function getActiveTheme(): Theme {
	return getTheme(useThemeStore.getState().themeId);
}

/** Reactive hook — components re-render when the theme changes. */
export function useActiveTheme(): Theme {
	const themeId = useThemeStore((s) => s.themeId);
	return getTheme(themeId);
}

function applyToDom(theme: Theme) {
	const root = document.documentElement;
	for (const [name, value] of Object.entries(theme.vars)) {
		root.style.setProperty(name, value);
	}
	root.classList.toggle("dark", theme.appearance === "dark");
	root.style.colorScheme = theme.appearance;
}

/** Call once before React renders; keeps :root in sync with the store. */
export function initTheme(): void {
	applyToDom(getActiveTheme());
	useThemeStore.subscribe((state, prev) => {
		if (state.themeId !== prev.themeId) applyToDom(getTheme(state.themeId));
	});
}
