import { beforeEach, describe, expect, it } from "vitest";
import {
	approveBoxInboxItem,
	clearBoxInboxes,
	enqueueBoxMail,
	inboxSnapshot,
	markBoxInboxDelivered,
} from "../src/box-inbox.ts";
import {
	BOX_MAIL_SCHEMA_VERSION,
	coerceReplyPolicy,
	resolveAndAssertOutboundEnvelope,
} from "../src/box-mail-envelope.ts";
import { boxMailWakeText } from "../src/box-mail.ts";

describe("box-mail-envelope", () => {
	beforeEach(() => clearBoxInboxes());

	it("defaults hop-0 to if_needed (A→B, optional reply)", () => {
		const { inbound } = enqueueBoxMail({
			fromCardId: "card_a",
			fromTitle: "A",
			toCardId: "card_b",
			toTitle: "B",
			body: "please review",
			createdBy: "user",
		});
		expect(inbound.envelope?.schemaVersion).toBe(BOX_MAIL_SCHEMA_VERSION);
		expect(inbound.envelope?.replyPolicy).toBe("if_needed");
		expect(inbound.envelope?.hop).toBe(0);
	});

	it("unknown replyPolicy fails closed to never", () => {
		expect(coerceReplyPolicy("wat")).toBe("never");
	});

	it("allows optional B→A once, then blocks A→B again until… and blocks hop 2", () => {
		const { inbound: hop0 } = enqueueBoxMail({
			fromCardId: "card_a",
			fromTitle: "A",
			toCardId: "card_b",
			toTitle: "B",
			body: "do it",
			createdBy: "user",
		});
		approveBoxInboxItem("card_b", hop0.id);
		markBoxInboxDelivered("card_b", hop0.id);

		// Second A→B before reply — blocked.
		expect(() =>
			enqueueBoxMail({
				fromCardId: "card_a",
				fromTitle: "A",
				toCardId: "card_b",
				toTitle: "B",
				body: "also this",
				createdBy: "agent",
			}),
		).toThrow(/already mailed/);

		// B→A without reason — blocked.
		expect(() =>
			enqueueBoxMail({
				fromCardId: "card_b",
				fromTitle: "B",
				toCardId: "card_a",
				toTitle: "A",
				body: "done",
				createdBy: "agent",
			}),
		).toThrow(/replyReason|new A→B the other way/);

		const { inbound: hop1 } = enqueueBoxMail({
			fromCardId: "card_b",
			fromTitle: "B",
			toCardId: "card_a",
			toTitle: "A",
			body: "done — here is the result",
			createdBy: "agent",
			envelope: { replyReason: "deliverable_ready" },
			inReplyToMailId: hop0.id,
		});
		expect(hop1.envelope?.hop).toBe(1);
		expect(hop1.envelope?.replyPolicy).toBe("never");
		approveBoxInboxItem("card_a", hop1.id);
		markBoxInboxDelivered("card_a", hop1.id);

		// A→B again after B replied (new ask) — allowed.
		const { inbound: next } = enqueueBoxMail({
			fromCardId: "card_a",
			fromTitle: "A",
			toCardId: "card_b",
			toTitle: "B",
			body: "new ask",
			createdBy: "user",
		});
		expect(next.envelope?.hop).toBe(0);
		expect(next.envelope?.threadId).not.toBe(hop0.envelope?.threadId);

		// Hop 2 on closed thread — blocked.
		expect(() =>
			enqueueBoxMail({
				fromCardId: "card_a",
				fromTitle: "A",
				toCardId: "card_b",
				toTitle: "B",
				body: "follow-up on old thread",
				createdBy: "agent",
				envelope: { replyReason: "needs_decision" },
				inReplyToMailId: hop1.id,
			}),
		).toThrow(/never|no further mail/);
	});

	it("inbox snapshot is pending inbound only", () => {
		const { inbound } = enqueueBoxMail({
			fromCardId: "card_a",
			fromTitle: "A",
			toCardId: "card_b",
			toTitle: "B",
			body: "hi",
			createdBy: "user",
		});
		expect(inboxSnapshot("card_b").items).toHaveLength(1);
		expect(inboxSnapshot("card_a").items).toHaveLength(0);
		approveBoxInboxItem("card_b", inbound.id);
		markBoxInboxDelivered("card_b", inbound.id);
		expect(inboxSnapshot("card_b").items).toHaveLength(0);
	});

	it("wake text allows optional reply on if_needed", () => {
		const envelope = resolveAndAssertOutboundEnvelope({});
		expect(envelope.replyPolicy).toBe("if_needed");
		const text = boxMailWakeText({
			fromTitle: "A",
			fromCardId: "card_a",
			body: "do it",
			mailId: "mail_abc",
			envelope,
		});
		expect(text).toContain("policy=if_needed");
		expect(text).toContain("inReplyToMailId=mail_abc");
	});
});
