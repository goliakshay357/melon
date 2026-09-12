import { describe, expect, it } from "vitest";
import {
	boxMailInboundText,
	boxMailOutboundText,
	boxMailWakeDisplay,
	boxMailWakeText,
} from "../src/box-mail.ts";

describe("box-mail helpers", () => {
	it("formats outbound with target title and id", () => {
		const text = boxMailOutboundText({
			toTitle: "Pipeline — swift-otter",
			toCardId: "card_abc",
			body: "  please run the suite  ",
		});
		expect(text).toContain("Node mail → Pipeline — swift-otter (card_abc)");
		expect(text).toContain("please run the suite");
		expect(text.startsWith("[Node mail →")).toBe(true);
	});

	it("formats inbound with sender title and id", () => {
		const text = boxMailInboundText({
			fromTitle: "General",
			fromCardId: "card_from",
			body: "hi",
		});
		expect(text).toBe("[Node mail from General (card_from)]\n\nhi");
	});

	it("wake cue names the sender and keeps the body", () => {
		const text = boxMailWakeText({
			fromTitle: "General",
			fromCardId: "card_from",
			body: "do the thing",
		});
		expect(text.startsWith("[box-mail]")).toBe(true);
		expect(text).toContain("General (id: card_from)");
		expect(text).toContain("do the thing");
		expect(text).toContain("Optional");
		expect(boxMailWakeDisplay("General")).toBe("[node mail from General]");
	});
});
