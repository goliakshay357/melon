import { describe, expect, it } from "vitest";
import { normalizeStored } from "../src/theme/theme-store.ts";
import { DEFAULT_THEME_ID, getTheme, isThemeId, THEMES } from "../src/theme/themes.ts";

describe("theme defaults", () => {
	it("defaults to moonfly for new installs", () => {
		expect(DEFAULT_THEME_ID).toBe("moonfly");
		expect(THEMES[0]?.id).toBe("moonfly");
		expect(normalizeStored(null)).toBe("moonfly");
		expect(normalizeStored("")).toBe("moonfly");
		expect(normalizeStored("not-a-theme")).toBe("moonfly");
	});

	it("keeps a valid chosen theme id", () => {
		expect(normalizeStored("dracula")).toBe("dracula");
		expect(normalizeStored("github-dark")).toBe("github-dark");
		expect(normalizeStored("moonfly")).toBe("moonfly");
		expect(isThemeId("noctis_lux")).toBe(true);
		expect(isThemeId("nope")).toBe(false);
	});

	it("getTheme falls back to moonfly, not an accidental registry entry", () => {
		expect(getTheme("missing").id).toBe("moonfly");
		expect(getTheme("").id).toBe("moonfly");
	});
});
