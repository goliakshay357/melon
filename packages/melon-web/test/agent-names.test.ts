import { describe, expect, it } from "vitest";
import {
	boxMentionLabel,
	randomWordPair,
	specializedCardTitle,
	uniqueWordPair,
} from "../src/lib/agent-names";

describe("agent-names", () => {
	it("builds word pairs like adjective-animal", () => {
		expect(randomWordPair()).toMatch(/^[a-z]+-[a-z]+$/);
	});

	it("avoids collisions with used names", () => {
		const used = new Set<string>();
		for (let i = 0; i < 30; i++) {
			const name = uniqueWordPair(used);
			expect(used.has(name)).toBe(false);
			used.add(name);
		}
	});

	it("formats specialized titles as instance ( profile )", () => {
		expect(specializedCardTitle("Rude agent", "swift-otter")).toBe("swift-otter ( Rude agent )");
	});

	it("labels box mentions for the @ picker", () => {
		expect(
			boxMentionLabel({
				title: "ignored",
				agentInstanceName: "swift-otter",
				profileName: "Rude agent",
			}),
		).toBe("swift-otter ( Rude agent )");
		expect(boxMentionLabel({ title: "Chat", agentInstanceName: "calm-fox" })).toBe(
			"calm-fox ( general )",
		);
	});
});
