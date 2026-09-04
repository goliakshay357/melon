import { describe, expect, it } from "vitest";
import { CardExtensionUiBridge, type ExtensionUiEvent } from "../src/extension-ui.ts";
import { buildApp } from "../src/index.ts";

describe("CardExtensionUiBridge", () => {
	it("select resolves with the chosen value and clears via broadcast", async () => {
		const events: ExtensionUiEvent[] = [];
		const bridge = new CardExtensionUiBridge("card_x", (e) => events.push(e));
		const ui = bridge.createUIContext();

		const pending = ui.select("Pick one", ["a", "b"]);
		expect(bridge.getPendingEvent()?.method).toBe("select");
		expect(events.at(-1)).toMatchObject({ type: "extension_ui", method: "select", title: "Pick one" });

		const id = (events.at(-1) as { id: string }).id;
		expect(bridge.respond({ id, value: "b" })).toBe(true);
		await expect(pending).resolves.toBe("b");
		expect(bridge.getPendingEvent()).toBeUndefined();
		expect(events.at(-1)).toEqual({ type: "extension_ui_clear", id });
	});

	it("cancelAll resolves select as undefined", async () => {
		const bridge = new CardExtensionUiBridge("card_y", () => {});
		const ui = bridge.createUIContext();
		const pending = ui.select("Q", ["yes"]);
		bridge.cancelAll();
		await expect(pending).resolves.toBeUndefined();
		expect(bridge.getPendingEvent()).toBeUndefined();
	});

	it("getUIContext returns the same instance and shares pending state", async () => {
		const bridge = new CardExtensionUiBridge("card_memo", () => {});
		const a = bridge.getUIContext();
		const b = bridge.getUIContext();
		expect(a).toBe(b);
		const pending = a.select("Q", ["x"]);
		const id = bridge.getPendingEvent()!.id;
		expect(bridge.respond({ id, value: "x" })).toBe(true);
		await expect(pending).resolves.toBe("x");
	});

	it("respond returns false for unknown id without settling others", async () => {
		const bridge = new CardExtensionUiBridge("card_miss", () => {});
		const ui = bridge.createUIContext();
		const pending = ui.select("Q", ["a"]);
		const id = bridge.getPendingEvent()!.id;
		expect(bridge.respond({ id: "nope", value: "a" })).toBe(false);
		expect(bridge.getPendingEvent()?.id).toBe(id);
		expect(bridge.respond({ id, value: "a" })).toBe(true);
		await expect(pending).resolves.toBe("a");
	});

	it("input + confirm round-trip", async () => {
		const bridge = new CardExtensionUiBridge("card_z", () => {});
		const ui = bridge.createUIContext();

		const inputP = ui.input("Name", "type here");
		const inputId = bridge.getPendingEvent()!.id;
		expect(bridge.respond({ id: inputId, value: "Ada" })).toBe(true);
		await expect(inputP).resolves.toBe("Ada");

		const confirmP = ui.confirm("Sure?", "Really?");
		const confirmId = bridge.getPendingEvent()!.id;
		expect(bridge.respond({ id: confirmId, confirmed: true })).toBe(true);
		await expect(confirmP).resolves.toBe(true);
	});
});

describe("extension-ui HTTP route", () => {
	it("400 without id; 409 when nothing pending", async () => {
		const app = await buildApp();
		const cardId = `extui-${Date.now()}`;
		const created = await app.inject({
			method: "POST",
			url: "/sessions",
			payload: { cardId, cwd: import.meta.dirname },
		});
		expect(created.statusCode).toBe(200);

		const bad = await app.inject({
			method: "POST",
			url: `/sessions/${cardId}/extension-ui`,
			payload: { value: "x" },
		});
		expect(bad.statusCode).toBe(400);

		const miss = await app.inject({
			method: "POST",
			url: `/sessions/${cardId}/extension-ui`,
			payload: { id: "nope", value: "x" },
		});
		expect(miss.statusCode).toBe(409);

		await app.close();
	});

	it("answers a live select from the session bridge", async () => {
		const app = await buildApp();
		const cardId = `extui-live-${Date.now()}`;
		const created = await app.inject({
			method: "POST",
			url: "/sessions",
			payload: { cardId, cwd: import.meta.dirname },
		});
		expect(created.statusCode).toBe(200);

		const bridge = (
			app as typeof app & { __testGetExtensionUi?: (id: string) => CardExtensionUiBridge | undefined }
		).__testGetExtensionUi?.(cardId);
		expect(bridge).toBeTruthy();

		// Same bridge instance the session bound — pending map is shared with HTTP.
		const selectP = bridge!.createUIContext().select("When?", ["now", "later"]);
		const pendingEvent = bridge!.getPendingEvent();
		expect(pendingEvent?.method).toBe("select");

		const res = await app.inject({
			method: "POST",
			url: `/sessions/${cardId}/extension-ui`,
			payload: { id: pendingEvent!.id, value: "later" },
		});
		expect(res.statusCode).toBe(200);
		await expect(selectP).resolves.toBe("later");

		await app.close();
	});
});
