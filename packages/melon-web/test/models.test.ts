import { expect, it } from "vitest";
import { buildModelSections, normalizeModel, type ModelInfo } from "@/lib/models";

function model(provider: string, providerName: string, id: string, name: string): ModelInfo {
	return { label: `${provider}/${id}`, provider, providerName, id, name };
}

const MODELS = [
	model("anthropic", "Anthropic", "claude-sonnet-4", "Claude Sonnet 4"),
	model("anthropic", "Anthropic", "claude-opus-4", "Claude Opus 4"),
	model("openai", "OpenAI", "gpt-5", "GPT-5"),
];

it("groups models into one section per provider", () => {
	const sections = buildModelSections({ models: MODELS, favorites: [], recents: [], query: "" });
	expect(sections.map((s) => s.title)).toEqual(["Anthropic", "OpenAI"]);
	expect(sections[0].models.map((m) => m.name)).toEqual(["Claude Sonnet 4", "Claude Opus 4"]);
	expect(sections[1].models.map((m) => m.name)).toEqual(["GPT-5"]);
});

it("pins favorites and recents first without duplicating them", () => {
	const sections = buildModelSections({
		models: MODELS,
		favorites: ["openai/gpt-5"],
		recents: ["anthropic/claude-opus-4"],
		query: "",
	});
	expect(sections.map((s) => s.title)).toEqual(["Favorites", "Recents", "Anthropic"]);
	// The provider section keeps only the unpinned model.
	expect(sections.find((s) => s.title === "Anthropic")?.models.map((m) => m.name)).toEqual([
		"Claude Sonnet 4",
	]);
	// No OpenAI section: its only model is pinned.
	expect(sections.some((s) => s.title === "OpenAI")).toBe(false);

	const labels = sections.flatMap((s) => s.models.map((m) => m.label));
	expect(new Set(labels).size).toBe(labels.length);
});

it("filters inside sections instead of flattening the list", () => {
	const sections = buildModelSections({
		models: MODELS,
		favorites: [],
		recents: [],
		query: "claude",
	});
	expect(sections.map((s) => s.title)).toEqual(["Anthropic"]);
	expect(sections[0].models).toHaveLength(2);
});

it("normalizes an old /models payload", () => {
	const m = normalizeModel({ label: "anthropic/claude-sonnet-4", provider: "anthropic", id: "claude-sonnet-4" });
	expect(m).toMatchObject({
		label: "anthropic/claude-sonnet-4",
		provider: "anthropic",
		providerName: "anthropic",
		id: "claude-sonnet-4",
		name: "claude-sonnet-4",
	});
	expect(normalizeModel({})).toBeNull();
});
