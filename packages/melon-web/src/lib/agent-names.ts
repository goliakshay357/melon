/**
 * Word-pair short names for specialized agent boxes (TRD T3).
 * Format: `{adjective}-{animal}` e.g. `swift-otter`.
 */

const ADJECTIVES = [
	"swift",
	"calm",
	"eager",
	"gentle",
	"brave",
	"quiet",
	"bright",
	"keen",
	"bold",
	"clear",
	"steady",
	"nimble",
	"vivid",
	"crisp",
	"solid",
	"lucid",
	"rapid",
	"silent",
	"golden",
	"silver",
	"amber",
	"coral",
	"cedar",
	"mossy",
	"frosty",
	"sunny",
	"stormy",
	"dusty",
	"hidden",
	"open",
	"prime",
	"fresh",
	"noble",
	"plain",
	"sharp",
	"soft",
	"wild",
	"wise",
	"young",
	"ancient",
] as const;

const ANIMALS = [
	"otter",
	"fox",
	"owl",
	"finch",
	"raven",
	"heron",
	"lynx",
	"stag",
	"swift",
	"crane",
	"hawk",
	"wren",
	"pine",
	"cedar",
	"delta",
	"brook",
	"ridge",
	"grove",
	"meadow",
	"harbor",
	"beacon",
	"comet",
	"ember",
	"flint",
	"quartz",
	"coral",
	"pearl",
	"maple",
	"birch",
	"aspen",
	"willow",
	"falcon",
	"sparrow",
	"badger",
	"mink",
	"seal",
	"orca",
	"kite",
	"tern",
	"lark",
] as const;

function pick<T extends readonly string[]>(list: T): T[number] {
	return list[Math.floor(Math.random() * list.length)]!;
}

export function randomWordPair(): string {
	return `${pick(ADJECTIVES)}-${pick(ANIMALS)}`;
}

/** Unique word-pair among already-used instance names on a canvas. */
export function uniqueWordPair(used: Iterable<string>, maxAttempts = 80): string {
	const taken = new Set([...used].map((s) => s.toLowerCase()));
	for (let i = 0; i < maxAttempts; i++) {
		const name = randomWordPair();
		if (!taken.has(name)) return name;
	}
	return `${randomWordPair()}-${Math.floor(Math.random() * 90 + 10)}`;
}

/** Display: `swift-otter ( Rude agent )` — instance first, profile in parens. */
export function specializedCardTitle(profileName: string, instanceName: string): string {
	const name = profileName.trim() || "Agent";
	const instance = instanceName.trim() || "agent";
	return `${instance} ( ${name} )`.slice(0, 64);
}

/** Label for @ picker / mail target lists. */
export function boxMentionLabel(card: {
	title: string;
	agentInstanceName?: string;
	agentProfileId?: string | null;
	profileName?: string | null;
}): string {
	const instance = card.agentInstanceName?.trim();
	const profile = card.profileName?.trim();
	if (instance && profile) return `${instance} ( ${profile} )`;
	if (instance && card.agentProfileId) return `${instance} ( ${card.agentProfileId} )`;
	if (instance) return `${instance} ( general )`;
	return card.title.trim() || "Chat";
}
