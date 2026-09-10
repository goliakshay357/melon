import { describe, expect, it, vi } from "vitest";
import { melonAskQuestionExtensionPath } from "../src/melon-ask-question.ts";
import { MELON_ASK_QUESTION_TOOL_NAME, normalizeQuestions } from "../src/melon-ask-question-extension.ts";

describe("melonAskQuestionExtensionPath", () => {
	it("resolves the Melon ask_question extension next to this module", () => {
		const path = melonAskQuestionExtensionPath();
		expect(path).toBeTruthy();
		expect(
			path!.endsWith("melon-ask-question-extension.ts") || path!.endsWith("melon-ask-question-extension.js"),
		).toBe(true);
	});
});

describe("normalizeQuestions", () => {
	it("normalizes a single question with string options", () => {
		const questions = normalizeQuestions({
			question: "Which runtime?",
			options: ["Use Claude Code", "Use Antigravity"],
		});
		expect(questions).toHaveLength(1);
		expect(questions[0]).toMatchObject({
			id: "question_1",
			question: "Which runtime?",
			allowCustom: true,
		});
		expect(questions[0]!.options.map((o) => o.label)).toEqual(["Use Claude Code", "Use Antigravity"]);
	});

	it("supports prompt alias, choices alias, and multiple questions", () => {
		const questions = normalizeQuestions({
			questions: [
				{ id: "a", prompt: "Pick A?", choices: [{ label: "One", value: "1", description: "first" }] },
				{ id: "b", question: "Pick B?", options: ["Two"], allowCustom: false },
			],
		});
		expect(questions).toEqual([
			{
				id: "a",
				question: "Pick A?",
				allowCustom: true,
				options: [{ label: "One", value: "1", description: "first" }],
			},
			{
				id: "b",
				question: "Pick B?",
				allowCustom: false,
				options: [{ label: "Two", value: "Two" }],
			},
		]);
	});

	it("drops empty questions", () => {
		expect(normalizeQuestions({ question: "   " })).toEqual([]);
	});
});

describe("melon ask_question tool registration", () => {
	it("registers ask_question and activates it for non-Cursor models", async () => {
		const tools = new Map<string, unknown>();
		let activeTools: string[] = [];
		const handlers: Record<string, Array<(event: unknown, ctx: unknown) => void>> = {};

		const pi = {
			registerTool: (def: { name: string }) => {
				tools.set(def.name, def);
			},
			getActiveTools: () => activeTools,
			setActiveTools: (next: string[]) => {
				activeTools = next;
			},
			on: (event: string, handler: (event: unknown, ctx: unknown) => void) => {
				const list = handlers[event] ?? [];
				list.push(handler);
				handlers[event] = list;
			},
		};

		const { default: register } = await import("../src/melon-ask-question-extension.ts");
		register(pi as never);

		expect(tools.has(MELON_ASK_QUESTION_TOOL_NAME)).toBe(true);

		for (const handler of handlers.session_start ?? []) {
			handler({}, { model: { provider: "claude-bridge" } });
		}
		expect(activeTools).toContain(MELON_ASK_QUESTION_TOOL_NAME);

		for (const handler of handlers.model_select ?? []) {
			handler({}, { model: { provider: "cursor" } });
		}
		expect(activeTools).not.toContain(MELON_ASK_QUESTION_TOOL_NAME);

		for (const handler of handlers.model_select ?? []) {
			handler({}, { model: { provider: "antigravity" } });
		}
		expect(activeTools).toContain(MELON_ASK_QUESTION_TOOL_NAME);
	});

	it("execute uses Melon UI select and returns the chosen label", async () => {
		const tools = new Map<string, { execute: (...args: never[]) => Promise<unknown> }>();
		const pi = {
			registerTool: (def: { name: string; execute: (...args: never[]) => Promise<unknown> }) => {
				tools.set(def.name, def);
			},
			getActiveTools: () => [MELON_ASK_QUESTION_TOOL_NAME],
			setActiveTools: vi.fn(),
			on: vi.fn(),
		};
		const { default: register } = await import("../src/melon-ask-question-extension.ts");
		register(pi as never);
		const tool = tools.get(MELON_ASK_QUESTION_TOOL_NAME)!;
		const result = (await tool.execute(
			"call-1" as never,
			{ question: "Ship Antigravity?", options: ["Yes, ship it", "Not yet"] } as never,
			undefined as never,
			undefined as never,
			{
				hasUI: true,
				ui: {
					select: async () => "Yes, ship it",
					input: async () => null,
				},
			} as never,
		)) as { content: Array<{ text: string }>; details: { cancelled: boolean } };

		expect(result.details.cancelled).toBe(false);
		expect(result.content[0]?.text).toContain("Yes, ship it");
	});
});
