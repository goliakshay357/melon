import { describe, expect, it } from "vitest";
import { buildBoxMailBrief, buildHandoffDistillContext, stripMentionToken } from "../src/lib/box-mail-brief";
import type { SessionCard } from "../src/types/session-card";

function fakeCard(partial: Partial<SessionCard> & Pick<SessionCard, "id" | "title">): SessionCard {
	return {
		position: { x: 0, y: 0 },
		parentId: null,
		status: "idle",
		messages: [],
		...partial,
	};
}

describe("box-mail-brief", () => {
	it("strips an @agent token without eating the rest of the line", () => {
		expect(stripMentionToken("@swift-otter please review auth", "swift-otter")).toBe("please review auth");
		expect(stripMentionToken("hey @swift-otter fix this", "swift-otter")).toBe("hey fix this");
	});

	it("packs request + recent conversation into a /send template brief", async () => {
		const from = fakeCard({
			id: "card_a",
			title: "calm-fox ( Planner )",
			messages: [
				{ role: "user", text: "We need auth on /api" },
				{ role: "assistant", text: "Agreed — JWT on the gateway." },
			],
		});
		const to = fakeCard({
			id: "card_b",
			title: "swift-otter ( Rude agent )",
			agentInstanceName: "swift-otter",
		});
		const brief = await buildBoxMailBrief({
			from,
			to,
			userText: "please review the auth plan",
			fileMentions: [],
			cwds: [null],
		});
		expect(brief).toContain("## Request");
		expect(brief).toContain("please review the auth plan");
		expect(brief).toContain("We need auth on /api");
		expect(brief).toContain("JWT on the gateway");
		expect(brief).toContain("swift-otter ( Rude agent )");
	});

	it("builds sender distill context with target cardId and no transcript dump", () => {
		const from = fakeCard({
			id: "card_a",
			title: "heelo",
			messages: [
				{ role: "user", text: "heelo" },
				{ role: "assistant", text: "Hey — what do you want to work on?" },
			],
		});
		const to = fakeCard({
			id: "card_b",
			title: "rude-agent — clear-flint",
			agentInstanceName: "clear-flint",
			agentProfileId: "rude-agent",
		});
		const ctx = buildHandoffDistillContext({
			from,
			to,
			userText: "can you say hi to also?",
		});
		expect(ctx).toContain("[melon-handoff]");
		expect(ctx).toContain("cardId: card_b");
		expect(ctx).toContain("instance: clear-flint");
		expect(ctx).toContain("can you say hi to also?");
		expect(ctx).toContain("send_to_box");
		expect(ctx).toContain("Synthesize");
		expect(ctx).not.toContain("Hey — what do you want to work on?");
		expect(ctx).not.toContain("## Recent conversation");
	});
});
