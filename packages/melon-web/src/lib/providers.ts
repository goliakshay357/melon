export type ProviderAuthType = 'api_key' | 'oauth';

export interface ProviderInfo {
	id: string;
	provider: string;
	name: string;
	connected: boolean;
	disconnectable: boolean;
	authTypes: ProviderAuthType[];
	source?: string;
	sourceLabel?: string;
	keyPreview?: string;
	authType?: string;
	error?: string;
}

const OAUTH_ONLY_PROVIDERS = new Set(['claude-bridge', 'antigravity']);

/**
 * Providers that authenticate only through a browser login. Used as a fallback
 * when the server is too old to report `authTypes`.
 */
export function isOAuthOnlyProvider(id: string): boolean {
	return OAUTH_ONLY_PROVIDERS.has(id);
}

/**
 * The provider endpoint may be an older server build that lacks the newer
 * fields. Normalize instead of trusting the payload so a stale server can never
 * crash a component that reads `authTypes`.
 */
export function normalizeProvider(raw: Record<string, unknown>): ProviderInfo | null {
	const id =
		typeof raw.id === 'string' ? raw.id : typeof raw.provider === 'string' ? raw.provider : '';
	if (!id) return null;
	const authTypes = (Array.isArray(raw.authTypes) ? raw.authTypes : []).filter(
		(t): t is ProviderAuthType => t === 'api_key' || t === 'oauth',
	);
	const connected = raw.connected === true || raw.configured === true;
	return {
		id,
		provider: id,
		name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : id,
		connected,
		disconnectable: typeof raw.disconnectable === 'boolean' ? raw.disconnectable : connected,
		authTypes:
			authTypes.length > 0 ? authTypes : OAUTH_ONLY_PROVIDERS.has(id) ? ['oauth'] : ['api_key'],
		source: typeof raw.source === 'string' ? raw.source : undefined,
		sourceLabel: typeof raw.sourceLabel === 'string' ? raw.sourceLabel : undefined,
		keyPreview: typeof raw.keyPreview === 'string' ? raw.keyPreview : undefined,
		authType: typeof raw.authType === 'string' ? raw.authType : undefined,
		error: typeof raw.error === 'string' ? raw.error : undefined,
	};
}
