import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyScore } from "../src/fuzzy.ts";

describe("fuzzyMatch", () => {
	it("matches subsequences and ranks consecutive better", () => {
		expect(fuzzyMatch("brd", "board").matches).toBe(true);
		expect(fuzzyMatch("abd", "Alpha board").matches).toBe(true);
		expect(fuzzyMatch("xyz", "Alpha board").matches).toBe(false);

		const consecutive = fuzzyMatch("foo", "foobar");
		const scattered = fuzzyMatch("foo", "f_o_o_bar");
		expect(consecutive.matches && scattered.matches).toBe(true);
		expect(consecutive.score).toBeLessThan(scattered.score);
	});

	it("fuzzyScore requires every token", () => {
		expect(fuzzyScore("alpha board", "Alpha board")).not.toBeNull();
		expect(fuzzyScore("alpha missing", "Alpha board")).toBeNull();
	});
});
