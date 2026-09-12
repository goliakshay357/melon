import { describe, expect, it } from "vitest";
import {
	bindBoxMailHost,
	emitBoxMailIntent,
	formatBoxDirectory,
	getBoxPeers,
	resolveBoxPeer,
	setBoxPeers,
	unbindBoxMailHost,
} from "../src/box-mail-host.ts";

describe("box-mail-host", () => {
	it("resolves peers by card, profile, instance, and title", () => {
		bindBoxMailHost("card_a", () => {});
		setBoxPeers("card_a", [
			{
				cardId: "card_b",
				title: "Pipeline — swift-otter",
				agentProfileId: "pipeline",
				agentInstanceName: "swift-otter",
			},
			{
				cardId: "card_c",
				title: "General chat",
			},
		]);

		expect(resolveBoxPeer("card_a", "card_b").match).toBe("card");
		expect(resolveBoxPeer("card_a", "swift-otter").match).toBe("instance");
		expect(resolveBoxPeer("card_a", "pipeline").peer?.cardId).toBe("card_b");
		expect(resolveBoxPeer("card_a", "General").match).toBe("title");
		expect(resolveBoxPeer("card_a", "reviewer").profileOnly).toBe("reviewer");

		unbindBoxMailHost("card_a");
	});

	it("formats a directory and emits intents", () => {
		const events: unknown[] = [];
		bindBoxMailHost("card_a", (p) => events.push(p), "sess_a");
		setBoxPeers("card_a", [{ cardId: "card_b", title: "B", agentProfileId: "pipeline" }]);
		const dir = formatBoxDirectory(getBoxPeers("card_a"));
		expect(dir).toContain("card_b");
		expect(dir).toContain("A→B once");
		const ack = emitBoxMailIntent({
			fromCardId: "card_a",
			toCardId: "card_b",
			body: "please review",
		});
		expect(ack).toContain("inbox");
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "box_mail_intent",
			fromCardId: "card_a",
			toCardId: "card_b",
			body: "please review",
		});
		unbindBoxMailHost("card_a");
	});
});
