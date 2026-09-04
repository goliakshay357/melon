import { create } from "zustand";
import { DEFAULT_THEME_ID, getTheme, isThemeId, type Theme } from "./themes";

const STORAGE_KEY = "melon:theme";

function readLocalRaw(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

function writeLocalTheme(themeId: string): void {
	try {
		localStorage.setItem(STORAGE_KEY, themeId);
	} catch {
		/* private mode / locked storage */
	}
}

/** Resolve a stored id to a known theme; unknown/missing → Moonfly. */
export function normalizeStored(id: string | null): string {
	if (id && isThemeId(id)) return id;
	return DEFAULT_THEME_ID;
}

interface ThemeState {
	themeId: string;
	setTheme: (id: string) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
	themeId: normalizeStored(readLocalRaw()),
	setTheme: (themeId) => {
		if (!isThemeId(themeId)) return;
		writeLocalTheme(themeId);
		set({ themeId });
		void persistThemeToServer(themeId);
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

async function persistThemeToServer(themeId: string): Promise<void> {
	try {
		await fetch("/settings", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ theme: themeId }),
		});
	} catch {
		/* offline — localStorage still has it; hydrate will re-seed disk later */
	}
}

/**
 * Disk settings survive Electron/webview storage resets.
 * Re-reads localStorage when the fetch returns so a mid-flight setTheme wins
 * the race against hydrate.
 *
 * - local present → keep it, seed/update disk if needed
 * - local missing → restore from disk, or Moonfly on first install
 */
export async function hydrateThemeFromServer(): Promise<void> {
	try {
		const res = await fetch("/settings", { cache: "no-store" });
		if (!res.ok) return;
		const data = (await res.json()) as { settings?: { theme?: unknown } };
		const diskTheme = data.settings?.theme;

		// Prefer whatever is local *now* (may have changed while we awaited).
		const localRaw = readLocalRaw();
		if (typeof localRaw === "string" && isThemeId(localRaw)) {
			if (useThemeStore.getState().themeId !== localRaw) {
				useThemeStore.setState({ themeId: localRaw });
			}
			if (diskTheme !== localRaw) {
				await persistThemeToServer(localRaw);
			}
			return;
		}

		if (typeof diskTheme === "string" && isThemeId(diskTheme)) {
			writeLocalTheme(diskTheme);
			useThemeStore.setState({ themeId: diskTheme });
			return;
		}

		// First install / empty disk: Moonfly, and write it so relaunches agree.
		writeLocalTheme(DEFAULT_THEME_ID);
		useThemeStore.setState({ themeId: DEFAULT_THEME_ID });
		await persistThemeToServer(DEFAULT_THEME_ID);
	} catch {
		/* server down — local (or Moonfly default) stays */
	}
}

/** Call once before React renders; keeps :root in sync with the store. */
export function initTheme(): void {
	applyToDom(getActiveTheme());
	useThemeStore.subscribe((state, prev) => {
		if (state.themeId !== prev.themeId) applyToDom(getTheme(state.themeId));
	});
	void hydrateThemeFromServer();
}
