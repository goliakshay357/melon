import { describe, expect, it, beforeEach } from "vitest";
import {
	approveBoxInboxItem,
	clearBoxInboxes,
	dismissBoxInboxItem,
	enqueueBoxMail,
	inboxSnapshot,
	markBoxInboxDelivered,
	pendingInboxCount,
	takeNextApprovedInbox,
} from "../src/box-inbox.ts";

describe("box-inbox", () => {
	beforeEach(() => clearBoxInboxes());

	it("enqueues pending inbound; snapshot hides outbound", () => {
		const { inbound, outbound } = enqueueBoxMail({
			fromCardId: "card_a",
			fromTitle: "A",
			toCardId: "card_b",
			toTitle: "B",
			body: "hello",
			createdBy: "user",
		});
		expect(inbound.status).toBe("pending");
		expect(inbound.direction).toBe("in");
		expect(outbound.direction).toBe("out");
		expect(outbound.status).toBe("delivered");
		expect(pendingInboxCount("card_b")).toBe(1);
		expect(pendingInboxCount("card_a")).toBe(0);
		expect(inboxSnapshot("card_b").items).toHaveLength(1);
		expect(inboxSnapshot("card_a").items).toHaveLength(0);
	});

	it("approve then takeNext for queue-after-inbox delivery", () => {
		const { inbound } = enqueueBoxMail({
			fromCardId: "card_a",
			fromTitle: "A",
			toCardId: "card_b",
			toTitle: "B",
			body: "do it",
			createdBy: "agent",
		});
		expect(takeNextApprovedInbox("card_b")).toBeUndefined();
		approveBoxInboxItem("card_b", inbound.id);
		const next = takeNextApprovedInbox("card_b");
		expect(next?.id).toBe(inbound.id);
		markBoxInboxDelivered("card_b", inbound.id);
		expect(takeNextApprovedInbox("card_b")).toBeUndefined();
		expect(inboxSnapshot("card_b").items).toHaveLength(0);
	});

	it("dismiss drops pending without delivery", () => {
		const { inbound } = enqueueBoxMail({
			fromCardId: "card_a",
			fromTitle: "A",
			toCardId: "card_b",
			toTitle: "B",
			body: "nope",
			createdBy: "user",
		});
		dismissBoxInboxItem("card_b", inbound.id);
		expect(pendingInboxCount("card_b")).toBe(0);
		expect(approveBoxInboxItem("card_b", inbound.id)).toBeUndefined();
	});
});
