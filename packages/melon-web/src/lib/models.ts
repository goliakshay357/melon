import { fuzzyScore } from '@/lib/fuzzy';

export interface ModelInfo {
	label: string;
	provider: string;
	providerName: string;
	id: string;
	name: string;
}

export type ModelSection = { title: string; models: ModelInfo[] };

/**
 * Cursor ships two catalog rows both named "Auto":
 * - `auto-smart` — Cursor Router (Optimize For: Intelligence / Balance / Cost)
 * - `default` (alias `auto`) — legacy cost-oriented Auto
 * Disambiguate in the Melon picker so users can tell them apart.
 */
export function cursorAutoDisplayName(id: string, name: string): string {
	const trimmed = name.trim();
	if (!/^auto$/i.test(trimmed)) return name;
	// Strip context (@272k) and fast (:fast / :slow) suffixes from pi ids.
	const base = (id.split(/[@:]/)[0] ?? id).trim();
	if (base === 'auto-smart') return 'Auto · Smart';
	if (base === 'default' || base === 'auto') return 'Auto · Cost';
	return name;
}

/** Tolerate an older /models payload that lacks `name` / `providerName`. */
export function normalizeModel(raw: Record<string, unknown>): ModelInfo | null {
	const provider = typeof raw.provider === 'string' ? raw.provider : '';
	const id = typeof raw.id === 'string' ? raw.id : '';
	const label =
		typeof raw.label === 'string' && raw.label
			? raw.label
			: provider && id
				? `${provider}/${id}`
				: '';
	if (!label) return null;
	const resolvedProvider = provider || label.split('/')[0] || 'unknown';
	const resolvedId = id || label.split('/').slice(1).join('/');
	const rawName = typeof raw.name === 'string' && raw.name ? raw.name : resolvedId || label;
	const name =
		resolvedProvider.toLowerCase() === 'cursor'
			? cursorAutoDisplayName(resolvedId, rawName)
			: rawName;
	return {
		label,
		provider: resolvedProvider,
		providerName:
			typeof raw.providerName === 'string' && raw.providerName ? raw.providerName : provider || 'Other',
		id: resolvedId,
		name,
	};
}

/**
 * Supernova-style picker sections: Favorites, Recents, then one section per
 * provider. Pinned models are removed from the provider groups so a model never
 * appears twice. Search filters inside every section instead of flattening the
 * list.
 */
export function buildModelSections(input: {
	models: readonly ModelInfo[];
	favorites: readonly string[];
	recents: readonly string[];
	query: string;
}): ModelSection[] {
	const search = input.query.trim().toLowerCase();
	const matches = (m: ModelInfo) =>
		search === '' || fuzzyScore(search, `${m.name} ${m.label} ${m.providerName}`) !== null;

	const byLabel = new Map(input.models.map((m) => [m.label, m]));
	const favoriteModels = input.favorites
		.map((label) => byLabel.get(label))
		.filter((m): m is ModelInfo => m !== undefined && matches(m));
	const favoriteLabels = new Set(favoriteModels.map((m) => m.label));
	const recentModels = input.recents
		.map((label) => byLabel.get(label))
		.filter((m): m is ModelInfo => m !== undefined && !favoriteLabels.has(m.label) && matches(m));
	const pinnedLabels = new Set([...favoriteLabels, ...recentModels.map((m) => m.label)]);
	const rest = input.models.filter((m) => !pinnedLabels.has(m.label) && matches(m));

	const sections: ModelSection[] = [];
	if (favoriteModels.length > 0) sections.push({ title: 'Favorites', models: favoriteModels });
	if (recentModels.length > 0) sections.push({ title: 'Recents', models: recentModels });

	const byProvider = new Map<string, ModelInfo[]>();
	for (const m of rest) {
		const list = byProvider.get(m.providerName) ?? [];
		list.push(m);
		byProvider.set(m.providerName, list);
	}
	for (const title of [...byProvider.keys()].sort((a, b) => a.localeCompare(b))) {
		sections.push({ title, models: byProvider.get(title) ?? [] });
	}
	return sections;
}
