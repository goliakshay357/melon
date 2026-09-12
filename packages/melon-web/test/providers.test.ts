import { expect, it } from "vitest";
import { normalizeProvider } from "@/lib/providers";

it("normalizes an old server payload that has no authTypes", () => {
	const p = normalizeProvider({
		id: "anthropic",
		provider: "anthropic",
		configured: true,
		keyPreview: "sk-ant…1234",
	});
	expect(p).not.toBeNull();
	// Old servers omitted authTypes; the row must still offer Connect and must
	// never read `.length` of undefined (the crash this guards against).
	expect(p?.authTypes).toEqual(["api_key"]);
	expect(p?.name).toBe("anthropic");
	expect(p?.connected).toBe(true);
	expect(p?.disconnectable).toBe(true);
});

it("infers oauth for browser-login providers on an old payload", () => {
	expect(normalizeProvider({ id: "claude-bridge" })?.authTypes).toEqual(["oauth"]);
	expect(normalizeProvider({ id: "antigravity" })?.authTypes).toEqual(["oauth"]);
});

it("preserves the new server shape", () => {
	const p = normalizeProvider({
		id: "openai",
		name: "OpenAI",
		connected: true,
		disconnectable: false,
		authTypes: ["api_key", "oauth"],
		source: "environment",
		sourceLabel: "OPENAI_API_KEY",
	});
	expect(p).toMatchObject({
		id: "openai",
		name: "OpenAI",
		connected: true,
		disconnectable: false,
		authTypes: ["api_key", "oauth"],
		sourceLabel: "OPENAI_API_KEY",
	});
});

it("drops junk auth types and providers without an id", () => {
	expect(normalizeProvider({ id: "x", authTypes: ["nope", "oauth"] })?.authTypes).toEqual(["oauth"]);
	expect(normalizeProvider({ name: "No id" })).toBeNull();
});
