/**
 * Single source of truth for every melon theme.
 *
 * Adding or changing a theme = editing this file only. Entries automatically
 * show up in Settings → Appearance, the toolbar quick-toggle, Tailwind
 * utilities (via CSS vars applied to :root), the canvas dots/minimap,
 * trajectory waterfall colors, and sandboxed viz iframes.
 */

/** Hex colors for consumers that cannot read CSS vars (canvas, iframes). */
export interface ThemeTokens {
	/** status + semantic colors */
	success: string;
	warning: string;
	danger: string;
	/** trajectory waterfall accents */
	info: string;
	purple: string;
	comment: string;
	/** react-flow canvas */
	canvasDot: string;
	minimapNode: string;
	/** sandboxed viz iframe defaults */
	vizBackground: string;
	vizForeground: string;
}

export interface Theme {
	id: string;
	label: string;
	appearance: "light" | "dark";
	/**
	 * CSS custom properties (HSL triplets, shadcn convention) written onto
	 * :root. Tailwind maps them to utilities in tailwind.config.js.
	 */
	vars: Record<string, string>;
	tokens: ThemeTokens;
}

/** Vars shared by every theme. */
const BASE_VARS: Record<string, string> = {
	"--radius": "0.625rem",
};

const LIGHT: Theme = {
	id: "light",
	label: "Day",
	appearance: "light",
	vars: {
		...BASE_VARS,
		"--background": "0 0% 100%",
		"--foreground": "0 0% 15%",
		"--card": "0 0% 100%",
		"--card-foreground": "0 0% 15%",
		"--primary": "0 0% 17%",
		"--primary-foreground": "0 0% 98.5%",
		"--secondary": "0 0% 97%",
		"--secondary-foreground": "0 0% 20.5%",
		"--muted": "0 0% 97%",
		"--muted-foreground": "0 0% 55.6%",
		"--accent": "212 92% 45%" /* functional link/blue */,
		"--accent-foreground": "0 0% 100%",
		"--border": "0 0% 92.2%",
		"--input": "0 0% 92.2%",
		"--ring": "0 0% 70.8%",
		"--success": "137 66% 30%",
		"--warning": "40 100% 30%",
		"--danger": "356 72% 47%",
		"--surface": "210 29% 97%",
		"--surface-foreground": "214 13% 14%",
	},
	tokens: {
		success: "#1a7f37",
		warning: "#9a6700",
		danger: "#cf222e",
		info: "#0969da",
		purple: "#8250df",
		comment: "#6e7781",
		canvasDot: "#d4d4d4",
		minimapNode: "#a3a3a3",
		vizBackground: "#ffffff",
		vizForeground: "#171717",
	},
};

const DRACULA: Theme = {
	id: "dracula",
	label: "Night",
	appearance: "dark",
	vars: {
		...BASE_VARS,
		"--background": "232 15% 18%" /* #282a36 */,
		"--foreground": "60 30% 96%" /* #f8f8f2 */,
		"--card": "233 14% 21%" /* #2e303e */,
		"--card-foreground": "60 30% 96%",
		"--primary": "265 89% 78%" /* #bd93f9 */,
		"--primary-foreground": "232 15% 18%",
		"--secondary": "234 13% 31%" /* #44475a */,
		"--secondary-foreground": "60 30% 96%",
		"--muted": "234 13% 26%",
		"--muted-foreground": "231 24% 72%",
		"--accent": "191 97% 77%" /* #8be9fd */,
		"--accent-foreground": "232 15% 18%",
		"--border": "233 14% 30%",
		"--input": "233 14% 30%",
		"--ring": "265 89% 78%",
		"--success": "135 94% 65%" /* #50fa7b */,
		"--warning": "65 92% 76%" /* #f1fa8c */,
		"--danger": "0 100% 67%" /* #ff5555 */,
		"--surface": "235 14% 15%" /* #21222c */,
		"--surface-foreground": "60 30% 96%",
	},
	tokens: {
		success: "#50fa7b",
		warning: "#f1fa8c",
		danger: "#ff5555",
		info: "#8be9fd",
		purple: "#bd93f9",
		comment: "#6272a4",
		canvasDot: "#44475a",
		minimapNode: "#44475a",
		vizBackground: "#282a36",
		vizForeground: "#f8f8f2",
	},
};

const DIMMED: Theme = {
	id: "dimmed",
	label: "Dusk",
	appearance: "dark",
	vars: {
		...BASE_VARS,
		"--background": "213 15% 16%" /* #22272e */,
		"--foreground": "212 26% 85%" /* #cdd9e5 */,
		"--card": "214 13% 20%" /* #2d333b */,
		"--card-foreground": "212 26% 85%",
		"--primary": "213 89% 64%" /* #539bf5 */,
		"--primary-foreground": "213 15% 16%",
		"--secondary": "214 12% 25%" /* #373e47 */,
		"--secondary-foreground": "212 26% 85%",
		"--muted": "214 13% 20%",
		"--muted-foreground": "210 11% 51%" /* #768390 */,
		"--accent": "213 89% 64%",
		"--accent-foreground": "213 15% 16%",
		"--border": "214 10% 30%" /* #444c56 */,
		"--input": "214 10% 30%",
		"--ring": "213 89% 64%",
		"--success": "122 33% 51%" /* #57ab5a */,
		"--warning": "40 58% 46%" /* #c69026 */,
		"--danger": "3 75% 60%" /* #e5534b */,
		"--surface": "214 13% 20%",
		"--surface-foreground": "212 26% 85%",
	},
	tokens: {
		success: "#57ab5a",
		warning: "#c69026",
		danger: "#e5534b",
		info: "#539bf5",
		purple: "#986ee2",
		comment: "#768390",
		canvasDot: "#444c56",
		minimapNode: "#444c56",
		vizBackground: "#22272e",
		vizForeground: "#cdd9e5",
	},
};


const GITHUB_DARK: Theme = {
	id: "github-dark",
	label: "GitHub",
	appearance: "dark",
	vars: {
		...BASE_VARS,
		"--background": "216 28% 7%" /* #0d1117 */,
		"--foreground": "210 17% 82%" /* #c9d1d9 */,
		"--card": "215 21% 11%" /* #161b22 */,
		"--card-foreground": "210 17% 82%",
		"--primary": "212 100% 67%" /* #58a6ff */,
		"--primary-foreground": "216 28% 7%",
		"--secondary": "215 15% 15%" /* #21262d */,
		"--secondary-foreground": "210 17% 82%",
		"--muted": "215 15% 15%",
		"--muted-foreground": "212 9% 58%" /* #8b949e */,
		"--accent": "212 100% 67%" /* #58a6ff */,
		"--accent-foreground": "216 28% 7%",
		"--border": "212 12% 21%" /* #30363d */,
		"--input": "215 15% 15%",
		"--ring": "212 100% 67%",
		"--success": "128 49% 49%" /* #3fb950 */,
		"--warning": "41 72% 48%" /* #d29922 */,
		"--danger": "4 100% 72%" /* #ff7b72 */,
		"--surface": "215 21% 11%",
		"--surface-foreground": "210 17% 82%",
	},
	tokens: {
		success: "#3fb950",
		warning: "#d29922",
		danger: "#ff7b72",
		info: "#58a6ff",
		purple: "#bc8cff",
		comment: "#8b949e",
		canvasDot: "#30363d",
		minimapNode: "#30363d",
		vizBackground: "#0d1117",
		vizForeground: "#c9d1d9",
	},
};


const AYU_DARK: Theme = {
	id: "ayu_dark",
	label: "Ayu",
	appearance: "dark",
	vars: {
		...BASE_VARS,
		"--background": "220 29% 6%" /* #0b0e14 */,
		"--foreground": "40 4% 69%" /* #b3b1ad */,
		"--card": "224 28% 10%" /* #131722 */,
		"--card-foreground": "40 4% 69%" /* #b3b1ad */,
		"--primary": "202 94% 65%" /* #53bdfa */,
		"--primary-foreground": "220 29% 6%" /* #0b0e14 */,
		"--secondary": "222 16% 12%" /* #1a1d24 */,
		"--secondary-foreground": "40 4% 69%" /* #b3b1ad */,
		"--muted": "222 16% 12%" /* #1a1d24 */,
		"--muted-foreground": "212 8% 42%" /* #626a73 */,
		"--accent": "202 94% 65%" /* #53bdfa */,
		"--accent-foreground": "220 29% 6%" /* #0b0e14 */,
		"--border": "222 16% 16%" /* #232730 */,
		"--input": "222 16% 12%" /* #1a1d24 */,
		"--ring": "202 94% 65%" /* #53bdfa */,
		"--success": "80 65% 57%" /* #aad94c */,
		"--warning": "34 100% 66%" /* #ffb454 */,
		"--danger": "357 75% 67%" /* #ea6c73 */,
		"--surface": "224 28% 10%" /* #131722 */,
		"--surface-foreground": "40 4% 69%" /* #b3b1ad */,
	},
	tokens: {
		success: "#aad94c",
		warning: "#ffb454",
		danger: "#ea6c73",
		info: "#53bdfa",
		purple: "#a37acc",
		comment: "#626a73",
		canvasDot: "#232730",
		minimapNode: "#232730",
		vizBackground: "#0b0e14",
		vizForeground: "#b3b1ad",
	},
};

const MOONFLY: Theme = {
	id: "moonfly",
	label: "Moonfly",
	appearance: "dark",
	vars: {
		...BASE_VARS,
		"--background": "0 0% 3%" /* #080808 */,
		"--foreground": "0 0% 70%" /* #b2b2b2 */,
		"--card": "0 0% 8%" /* #151515 */,
		"--card-foreground": "0 0% 70%" /* #b2b2b2 */,
		"--primary": "212 41% 64%" /* #7c9fc8 */,
		"--primary-foreground": "0 0% 3%" /* #080808 */,
		"--secondary": "0 0% 12%" /* #1e1e1e */,
		"--secondary-foreground": "0 0% 70%" /* #b2b2b2 */,
		"--muted": "0 0% 12%" /* #1e1e1e */,
		"--muted-foreground": "0 0% 55%" /* #8c8c8c */,
		"--accent": "165 43% 66%" /* #85cebc */,
		"--accent-foreground": "0 0% 3%" /* #080808 */,
		"--border": "0 0% 18%" /* #2e2e2e */,
		"--input": "0 0% 12%" /* #1e1e1e */,
		"--ring": "212 41% 64%" /* #7c9fc8 */,
		"--success": "94 49% 58%" /* #8cc85f */,
		"--warning": "41 61% 72%" /* #e3c78a */,
		"--danger": "0 100% 66%" /* #ff5454 */,
		"--surface": "0 0% 8%" /* #151515 */,
		"--surface-foreground": "0 0% 70%" /* #b2b2b2 */,
	},
	tokens: {
		success: "#8cc85f",
		warning: "#e3c78a",
		danger: "#ff5454",
		info: "#7c9fc8",
		purple: "#b294bb",
		comment: "#535353",
		canvasDot: "#2e2e2e",
		minimapNode: "#2e2e2e",
		vizBackground: "#080808",
		vizForeground: "#b2b2b2",
	},
};

const NOCTIS_LUX: Theme = {
	id: "noctis_lux",
	label: "Noctis",
	appearance: "light",
	vars: {
		...BASE_VARS,
		"--background": "0 0% 95%" /* #f2f2f2 */,
		"--foreground": "251 16% 39%" /* #5a5475 */,
		"--card": "0 0% 98%" /* #fbfbfb */,
		"--card-foreground": "251 16% 39%" /* #5a5475 */,
		"--primary": "219 44% 55%" /* #5b7ec0 */,
		"--primary-foreground": "0 0% 100%" /* #ffffff */,
		"--secondary": "240 19% 93%" /* #e9e9f0 */,
		"--secondary-foreground": "251 16% 39%" /* #5a5475 */,
		"--muted": "240 19% 93%" /* #e9e9f0 */,
		"--muted-foreground": "247 13% 59%" /* #8d8aa5 */,
		"--accent": "219 44% 55%" /* #5b7ec0 */,
		"--accent-foreground": "0 0% 100%" /* #ffffff */,
		"--border": "246 17% 88%" /* #dddce6 */,
		"--input": "240 19% 93%" /* #e9e9f0 */,
		"--ring": "219 44% 55%" /* #5b7ec0 */,
		"--success": "161 65% 40%" /* #24a77d */,
		"--warning": "32 72% 63%" /* #e4a35b */,
		"--danger": "351 73% 62%" /* #e5596f */,
		"--surface": "0 0% 98%" /* #fbfbfb */,
		"--surface-foreground": "251 16% 39%" /* #5a5475 */,
	},
	tokens: {
		success: "#24a77d",
		warning: "#e4a35b",
		danger: "#e5596f",
		info: "#5b7ec0",
		purple: "#8f5a99",
		comment: "#8d8aa5",
		canvasDot: "#dddce6",
		minimapNode: "#dddce6",
		vizBackground: "#f2f2f2",
		vizForeground: "#5a5475",
	},
};
/** Registry order = order shown in Settings and cycled by the toolbar toggle. */
export const THEMES: Theme[] = [DRACULA, GITHUB_DARK, AYU_DARK, MOONFLY, NOCTIS_LUX, LIGHT, DIMMED];

export const DEFAULT_THEME_ID = DRACULA.id;

export function getTheme(id: string): Theme {
	return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
