import { useEffect, useMemo, useRef, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import {
	ChevronDown,
	ChevronRight,
	KeyRound,
	Loader2,
	LogIn,
	Plus,
	RefreshCw,
	Search,
	Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { notifyModelsUpdated, refreshModels } from '@/lib/models';
import { normalizeProvider, type ProviderInfo } from '@/lib/providers';

type BrowserLoginStatus = {
	phase?: 'idle' | 'awaiting_browser' | 'done' | 'error';
	url?: string;
	error?: string;
};

/** A custom model added via the GUI (from GET /models/custom). */
interface CustomModelInfo {
	provider: string;
	id: string;
	name?: string;
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
}

const BROWSER_OAUTH_PROVIDERS: Record<
	string,
	{ loginPath: string; statusPath: string; cancelPath: string; title: string; opening: string; waiting: string; done: string }
> = {
	'claude-bridge': {
		loginPath: '/auth/claude-bridge/login',
		statusPath: '/auth/claude-bridge/login/status',
		cancelPath: '/auth/claude-bridge/login/cancel',
		title: 'Log in with Claude',
		opening: 'Opening Claude sign-in…',
		waiting: "Finish signing in in your browser. This window will update when you're done.",
		done: 'Signed in with Claude.',
	},
	antigravity: {
		loginPath: '/auth/antigravity/login',
		statusPath: '/auth/antigravity/login/status',
		cancelPath: '/auth/antigravity/login/cancel',
		title: 'Log in with Google (Antigravity)',
		opening: 'Opening Google sign-in…',
		waiting: "Finish signing in in your browser. This window will update when you're done.",
		done: 'Signed in with Antigravity.',
	},
};

const dialogContentClass =
	'fixed left-1/2 top-1/2 z-[1001] w-[420px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl focus:outline-none';

function formatContextWindow(value: number | undefined): string {
	if (!value) return '';
	return value >= 1000 ? `${Math.round(value / 1000)}K` : String(value);
}

function ProviderRow({
	provider,
	customModels,
	busy,
	expanded,
	onToggleExpanded,
	onConnect,
	onDisconnect,
	onAddModel,
	onRemoveModel,
	removingModelId,
}: {
	provider: ProviderInfo;
	customModels: CustomModelInfo[];
	busy: boolean;
	expanded: boolean;
	onToggleExpanded: (p: ProviderInfo) => void;
	onConnect: (p: ProviderInfo) => void;
	onDisconnect: (p: ProviderInfo) => void;
	onAddModel: (p: ProviderInfo) => void;
	onRemoveModel: (p: ProviderInfo, m: CustomModelInfo) => void;
	removingModelId: string | null;
}) {
	const canConnect = provider.authTypes.length > 0;
	const hasCustom = provider.connected && customModels.length > 0;
	return (
		<div>
			<div className="flex items-center gap-3 px-3 py-2.5">
				{provider.connected ? (
					<button
						type="button"
						aria-label={expanded ? 'Collapse custom models' : 'Show custom models'}
						aria-expanded={expanded}
						onClick={() => onToggleExpanded(provider)}
						className={cn(
							'grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground',
							!hasCustom && 'opacity-30 hover:opacity-60 hover:text-muted-foreground',
						)}
					>
						<ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
					</button>
				) : (
					<span className="size-5 shrink-0" />
				)}
				<div className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-sm font-medium text-muted-foreground">
					{provider.name.charAt(0).toUpperCase()}
				</div>
				<div className="min-w-0 flex-1">
					<p className="flex items-baseline gap-2 truncate text-sm font-medium text-card-foreground">
						<span className="truncate">{provider.name}</span>
						{hasCustom && (
							<span className="shrink-0 text-[10px] font-normal tabular-nums text-muted-foreground">
								{customModels.length} custom
							</span>
						)}
					</p>
					{provider.sourceLabel ? (
						<p className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
							<span className="size-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden />
							{provider.sourceLabel}
						</p>
					) : provider.error ? (
						<p className="truncate text-[11px] text-amber-500/90" title={provider.error}>
							{provider.error}
						</p>
					) : null}
				</div>
				{provider.connected ? (
					<button
						type="button"
						disabled={!provider.disconnectable || busy}
						title={provider.disconnectable ? 'Disconnect' : 'Managed outside Melon'}
						onClick={() => onDisconnect(provider)}
						className="shrink-0 rounded-lg bg-secondary px-3 py-1.5 text-xs text-card-foreground transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{busy ? 'Disconnecting…' : provider.disconnectable ? 'Disconnect' : 'Managed'}
					</button>
				) : (
					<button
						type="button"
						disabled={!canConnect || busy}
						onClick={() => onConnect(provider)}
						className="shrink-0 rounded-lg bg-secondary px-3 py-1.5 text-xs text-card-foreground transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{busy ? 'Working…' : 'Connect'}
					</button>
				)}
			</div>

			{provider.connected && expanded && (
				<div className="pb-2.5 pl-[52px] pr-3">
					{customModels.length === 0 ? (
						<p className="py-1 text-[11px] text-muted-foreground">No custom models.</p>
					) : (
						<div className="divide-y divide-border/60 rounded-lg border border-border/60">
							{customModels.map((m) => {
								const ctxLabel = formatContextWindow(m.contextWindow);
								return (
									<div key={m.id} className="group flex items-center gap-2 px-2.5 py-1.5">
										<div className="min-w-0 flex-1">
											<p className="truncate font-mono text-[11px] text-card-foreground">
												{m.id}
											</p>
											{(m.name || ctxLabel || m.reasoning) && (
												<p className="truncate text-[10px] text-muted-foreground">
													{[m.name, ctxLabel && `${ctxLabel} context`, m.reasoning ? 'reasoning' : '']
														.filter(Boolean)
														.join(' · ')}
												</p>
											)}
										</div>
										<button
											type="button"
											aria-label={`Remove ${m.id}`}
											title="Remove model"
											disabled={removingModelId === `${m.provider}/${m.id}`}
											onClick={() => onRemoveModel(provider, m)}
											className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-[opacity,color] group-hover:opacity-100 hover:text-red-400 focus-visible:opacity-100 disabled:opacity-40"
										>
											<Trash2 className="size-3.5" />
										</button>
									</div>
								);
							})}
						</div>
					)}
					<button
						type="button"
						onClick={() => onAddModel(provider)}
						className="mt-1.5 flex items-center gap-1.5 rounded-md px-1 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
					>
						<Plus className="size-3" />
						Add model
					</button>
				</div>
			)}
		</div>
	);
}

function ProviderGroup({
	title,
	providers,
	customByProvider,
	busyId,
	expandedIds,
	removingModelId,
	onToggleExpanded,
	onConnect,
	onDisconnect,
	onAddModel,
	onRemoveModel,
}: {
	title: string;
	providers: ProviderInfo[];
	customByProvider: Map<string, CustomModelInfo[]>;
	busyId: string | null;
	expandedIds: Set<string>;
	removingModelId: string | null;
	onToggleExpanded: (p: ProviderInfo) => void;
	onConnect: (p: ProviderInfo) => void;
	onDisconnect: (p: ProviderInfo) => void;
	onAddModel: (p: ProviderInfo) => void;
	onRemoveModel: (p: ProviderInfo, m: CustomModelInfo) => void;
}) {
	return (
		<section className="mb-4">
			<h2 className="px-1 pb-1 text-[11px] font-semibold tracking-tight text-card-foreground">
				{title}
			</h2>
			<div className="space-y-0.5">
				{providers.map((p) => (
					<ProviderRow
						key={p.id}
						provider={p}
						customModels={customByProvider.get(p.id) ?? []}
						busy={busyId === p.id}
						expanded={expandedIds.has(p.id)}
						onToggleExpanded={onToggleExpanded}
						onConnect={onConnect}
						onDisconnect={onDisconnect}
						onAddModel={onAddModel}
						onRemoveModel={onRemoveModel}
						removingModelId={removingModelId}
					/>
				))}
			</div>
		</section>
	);
}

/**
 * Settings → Providers. Connect/disconnect model providers, manage per-provider
 * custom models (visible, removable), and refresh the catalog. Custom models
 * live in the shared models.json, so the terminal TUI sees them too.
 */
export function ProvidersSection() {
	const [providers, setProviders] = useState<ProviderInfo[]>([]);
	const [customModels, setCustomModels] = useState<CustomModelInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [search, setSearch] = useState('');
	const [busyId, setBusyId] = useState<string | null>(null);
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
	const [removingModelId, setRemovingModelId] = useState<string | null>(null);

	const [methodProvider, setMethodProvider] = useState<ProviderInfo | null>(null);
	const [keyProvider, setKeyProvider] = useState<ProviderInfo | null>(null);
	const [key, setKey] = useState('');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');

	const [browserLoginProvider, setBrowserLoginProvider] = useState<string | null>(null);
	const [browserLoginBusy, setBrowserLoginBusy] = useState(false);
	const [browserLoginMessage, setBrowserLoginMessage] = useState('');
	const browserPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const [catalogRefreshing, setCatalogRefreshing] = useState(false);
	const [catalogRefreshNote, setCatalogRefreshNote] = useState('');

	// "Add model" dialog: upsert a custom model into a connected provider.
	const [addModelProvider, setAddModelProvider] = useState<ProviderInfo | null>(null);
	const [addModel, setAddModel] = useState({ id: '', name: '', contextWindow: '', maxTokens: '', reasoning: false });
	const [savingModel, setSavingModel] = useState(false);
	const [modelError, setModelError] = useState('');

	const load = () =>
		Promise.all([
			fetch('/auth/providers')
				.then((r) => r.json())
				.then((d) => {
					const list = Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [];
					setProviders(list.map(normalizeProvider).filter((p): p is ProviderInfo => p !== null));
				}),
			fetch('/models/custom')
				.then((r) => r.json())
				.then((d) => {
					const list = Array.isArray(d?.models) ? (d.models as CustomModelInfo[]) : [];
					setCustomModels(list);
				})
				.catch(() => setCustomModels([])),
		]).finally(() => setLoading(false));

	useEffect(() => {
		void load();
	}, []);

	const stopBrowserPoll = () => {
		if (browserPollRef.current) {
			clearInterval(browserPollRef.current);
			browserPollRef.current = null;
		}
	};
	useEffect(() => () => stopBrowserPoll(), []);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return providers;
		return providers.filter(
			(p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
		);
	}, [providers, search]);

	const customByProvider = useMemo(() => {
		const map = new Map<string, CustomModelInfo[]>();
		for (const m of customModels) {
			const list = map.get(m.provider) ?? [];
			list.push(m);
			map.set(m.provider, list);
		}
		return map;
	}, [customModels]);

	const connected = filtered.filter((p) => p.connected);
	const available = filtered.filter((p) => !p.connected);

	const toggleExpanded = (p: ProviderInfo) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(p.id)) next.delete(p.id);
			else next.add(p.id);
			return next;
		});
	};

	const startBrowserLogin = async (providerId: string) => {
		const cfg = BROWSER_OAUTH_PROVIDERS[providerId];
		if (!cfg) return;
		setBrowserLoginProvider(providerId);
		setBrowserLoginBusy(true);
		setBrowserLoginMessage(cfg.opening);
		setError('');
		stopBrowserPoll();
		try {
			const res = await fetch(cfg.loginPath, { method: 'POST' });
			const d = (await res.json().catch(() => ({}))) as {
				url?: string;
				error?: string;
				status?: BrowserLoginStatus;
			};
			if (!res.ok || !d.url) {
				setBrowserLoginBusy(false);
				setBrowserLoginMessage(d.error ?? `Could not start ${cfg.title}`);
				return;
			}
			window.open(d.url, '_blank', 'noopener,noreferrer');
			setBrowserLoginMessage(cfg.waiting);
			browserPollRef.current = setInterval(async () => {
				try {
					const statusRes = await fetch(cfg.statusPath);
					const status = (await statusRes.json()) as BrowserLoginStatus;
					if (status.phase === 'done') {
						stopBrowserPoll();
						setBrowserLoginBusy(false);
						setBrowserLoginMessage(cfg.done);
						void load();
						setTimeout(() => setBrowserLoginProvider(null), 800);
					} else if (status.phase === 'error') {
						stopBrowserPoll();
						setBrowserLoginBusy(false);
						setBrowserLoginMessage(status.error ?? `${cfg.title} failed`);
					}
				} catch {
					/* keep polling */
				}
			}, 1000);
		} catch (e) {
			setBrowserLoginBusy(false);
			setBrowserLoginMessage(e instanceof Error ? e.message : `Network error starting ${cfg.title}`);
		}
	};

	const cancelBrowserLogin = async () => {
		const cfg = browserLoginProvider ? BROWSER_OAUTH_PROVIDERS[browserLoginProvider] : undefined;
		stopBrowserPoll();
		if (cfg) await fetch(cfg.cancelPath, { method: 'POST' }).catch(() => {});
		setBrowserLoginBusy(false);
		setBrowserLoginProvider(null);
		setBrowserLoginMessage('');
	};

	const connect = (p: ProviderInfo) => {
		setError('');
		const hasOAuth = p.authTypes.includes('oauth');
		const hasKey = p.authTypes.includes('api_key');
		if (hasOAuth && hasKey) {
			setMethodProvider(p);
			return;
		}
		if (hasOAuth) {
			void startBrowserLogin(p.id);
			return;
		}
		setKey('');
		setError('');
		setKeyProvider(p);
	};

	const saveKey = async () => {
		if (!keyProvider || !key.trim()) return;
		setSaving(true);
		setError('');
		try {
			const res = await fetch(`/auth/${encodeURIComponent(keyProvider.id)}/key`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ key: key.trim() }),
			});
			const d = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				setError(d.error ?? 'Failed to save key');
				return;
			}
			setKeyProvider(null);
			setKey('');
			void load();
		} catch {
			setError('Network error saving key');
		} finally {
			setSaving(false);
		}
	};

	const removeKey = async (p: ProviderInfo) => {
		setBusyId(p.id);
		await fetch(`/auth/${encodeURIComponent(p.id)}`, { method: 'DELETE' }).catch(() => {});
		setBusyId(null);
		setKeyProvider(null);
		void load();
	};

	const disconnect = async (p: ProviderInfo) => {
		setBusyId(p.id);
		await fetch(`/auth/${encodeURIComponent(p.id)}`, { method: 'DELETE' }).catch(() => {});
		setBusyId(null);
		void load();
	};

	const refreshCatalog = async () => {
		setCatalogRefreshing(true);
		setCatalogRefreshNote('');
		const r = await refreshModels(true);
		setCatalogRefreshing(false);
		setCatalogRefreshNote(r.ok ? `Catalog refreshed — ${r.total} models.` : (r.error ?? 'Refresh failed.'));
		void load();
	};

	const openAddModel = (p: ProviderInfo) => {
		setAddModel({ id: '', name: '', contextWindow: '', maxTokens: '', reasoning: false });
		setModelError('');
		setAddModelProvider(p);
		// Keep the list open so the new model appears under the provider.
		setExpandedIds((prev) => new Set(prev).add(p.id));
	};

	const saveCustomModel = async () => {
		if (!addModelProvider || !addModel.id.trim()) return;
		setSavingModel(true);
		setModelError('');
		try {
			const body: Record<string, unknown> = {
				provider: addModelProvider.id,
				id: addModel.id.trim(),
			};
			if (addModel.name.trim()) body.name = addModel.name.trim();
			if (addModel.contextWindow.trim()) body.contextWindow = Number(addModel.contextWindow.trim());
			if (addModel.maxTokens.trim()) body.maxTokens = Number(addModel.maxTokens.trim());
			if (addModel.reasoning) body.reasoning = true;
			const res = await fetch('/models/custom', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			const d = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				setModelError(d.error ?? 'Failed to add model');
				return;
			}
			setAddModelProvider(null);
			// The server recomposed its runtime — every open picker refetches.
			notifyModelsUpdated();
			void load();
		} catch {
			setModelError('Network error adding model');
		} finally {
			setSavingModel(false);
		}
	};

	const removeCustomModel = async (p: ProviderInfo, m: CustomModelInfo) => {
		const key = `${p.id}/${m.id}`;
		setRemovingModelId(key);
		try {
			const res = await fetch('/models/custom', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ provider: p.id, id: m.id }),
			});
			if (res.ok) {
				notifyModelsUpdated();
				void load();
			}
		} finally {
			setRemovingModelId(null);
		}
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="shrink-0">
				<p className="text-sm font-medium text-card-foreground">Providers</p>
				<p className="mt-0.5 text-[11px] text-muted-foreground">
					Connect the providers Melon can run models from. Credentials stay on this machine.
				</p>
				<div className="relative mt-3">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search providers"
						className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:border-ring"
					/>
				</div>
				<div className="mt-2 flex items-center justify-between gap-2">
					<p className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground" title={catalogRefreshNote}>
						{catalogRefreshNote}
					</p>
					<button
						type="button"
						disabled={catalogRefreshing}
						onClick={() => void refreshCatalog()}
						className="flex shrink-0 items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-[11px] text-card-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
					>
						<RefreshCw className={cn('size-3', catalogRefreshing && 'animate-spin')} />
						{catalogRefreshing ? 'Refreshing…' : 'Refresh models'}
					</button>
				</div>
			</div>

			<div className="mt-3 min-h-0 flex-1 overflow-y-auto">
				{loading ? (
					<p className="px-1 py-3 text-xs text-muted-foreground">Loading providers…</p>
				) : filtered.length === 0 ? (
					<p className="px-1 py-3 text-xs text-muted-foreground">No providers match your search.</p>
				) : (
					<>
						{connected.length > 0 && (
							<ProviderGroup
								title="Connected"
								providers={connected}
								customByProvider={customByProvider}
								busyId={busyId}
								expandedIds={expandedIds}
								removingModelId={removingModelId}
								onToggleExpanded={toggleExpanded}
								onConnect={connect}
								onDisconnect={disconnect}
								onAddModel={openAddModel}
								onRemoveModel={(p, m) => void removeCustomModel(p, m)}
							/>
						)}
						{available.length > 0 && (
							<ProviderGroup
								title="Available"
								providers={available}
								customByProvider={customByProvider}
								busyId={busyId}
								expandedIds={expandedIds}
								removingModelId={removingModelId}
								onToggleExpanded={toggleExpanded}
								onConnect={connect}
								onDisconnect={disconnect}
								onAddModel={openAddModel}
								onRemoveModel={(p, m) => void removeCustomModel(p, m)}
							/>
						)}
					</>
				)}
			</div>

			{/* Connection method (only when a provider supports both). */}
			<RadixDialog.Root
				open={methodProvider !== null}
				onOpenChange={(o) => {
					if (!o) setMethodProvider(null);
				}}
			>
				<RadixDialog.Portal>
					<RadixDialog.Overlay className="fixed inset-0 z-[1000] bg-black/60" />
					<RadixDialog.Content className={dialogContentClass} onKeyDown={(e) => e.stopPropagation()}>
						<RadixDialog.Title className="text-sm font-semibold text-card-foreground">
							Connect {methodProvider?.name}
						</RadixDialog.Title>
						<RadixDialog.Description className="mt-2 text-xs text-muted-foreground">
							Select a connection method.
						</RadixDialog.Description>
						<div className="mt-3 space-y-0.5">
							<button
								type="button"
								className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
								onClick={() => {
									const p = methodProvider;
									setMethodProvider(null);
									if (p) void startBrowserLogin(p.id);
								}}
							>
								<LogIn className="size-4 shrink-0 text-muted-foreground" />
								<span className="flex-1">Use a subscription</span>
								<ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
							</button>
							<button
								type="button"
								className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
								onClick={() => {
									const p = methodProvider;
									setMethodProvider(null);
									if (p) {
										setKey('');
										setError('');
										setKeyProvider(p);
									}
								}}
							>
								<KeyRound className="size-4 shrink-0 text-muted-foreground" />
								<span className="flex-1">Use an API key</span>
								<ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
							</button>
						</div>
					</RadixDialog.Content>
				</RadixDialog.Portal>
			</RadixDialog.Root>

			{/* API key. */}
			<RadixDialog.Root
				open={keyProvider !== null}
				onOpenChange={(o) => {
					if (!o) setKeyProvider(null);
				}}
			>
				<RadixDialog.Portal>
					<RadixDialog.Overlay className="fixed inset-0 z-[1000] bg-black/60" />
					<RadixDialog.Content className={dialogContentClass} onKeyDown={(e) => e.stopPropagation()}>
						<RadixDialog.Title className="text-sm font-semibold text-card-foreground">
							{keyProvider?.connected ? 'Re-key' : 'Configure'} {keyProvider?.name}
						</RadixDialog.Title>
						<RadixDialog.Description className="sr-only">
							Enter an API key for this provider.
						</RadixDialog.Description>
						<input
							autoFocus
							type="password"
							value={key}
							onChange={(e) => setKey(e.target.value)}
							placeholder="API key"
							className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
							onKeyDown={(e) => {
								if (e.key === 'Enter') void saveKey();
							}}
						/>
						{error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
						{keyProvider?.connected && keyProvider.disconnectable && (
							<button
								type="button"
								className="mt-2 text-[11px] text-red-400 hover:underline"
								onClick={() => keyProvider && void removeKey(keyProvider)}
							>
								Remove key
							</button>
						)}
						<div className="mt-4 flex justify-end gap-2">
							<button
								type="button"
								className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
								onClick={() => setKeyProvider(null)}
							>
								Cancel
							</button>
							<button
								type="button"
								disabled={saving || !key.trim()}
								className="rounded-lg bg-secondary px-3 py-1.5 text-xs text-card-foreground hover:bg-secondary/80 disabled:opacity-50"
								onClick={() => void saveKey()}
							>
								{saving ? 'Saving…' : 'Save key'}
							</button>
						</div>
					</RadixDialog.Content>
				</RadixDialog.Portal>
			</RadixDialog.Root>

			{/* Add custom model. */}
			<RadixDialog.Root
				open={addModelProvider !== null}
				onOpenChange={(o) => {
					if (!o) setAddModelProvider(null);
				}}
			>
				<RadixDialog.Portal>
					<RadixDialog.Overlay className="fixed inset-0 z-[1000] bg-black/60" />
					<RadixDialog.Content className={dialogContentClass} onKeyDown={(e) => e.stopPropagation()}>
						<RadixDialog.Title className="text-sm font-semibold text-card-foreground">
							Add model to {addModelProvider?.name}
						</RadixDialog.Title>
						<RadixDialog.Description className="mt-2 text-xs text-muted-foreground">
							For models missing from the catalog. Saved to the shared models.json.
						</RadixDialog.Description>
						<div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2.5">
							<label htmlFor="custom-model-id" className="text-[11px] text-muted-foreground">
								Model ID
							</label>
							<input
								id="custom-model-id"
								autoFocus
								value={addModel.id}
								onChange={(e) => setAddModel((s) => ({ ...s, id: e.target.value }))}
								placeholder="stealth/union-alpha"
								className="w-full rounded-lg border border-input bg-background px-3 py-1.5 font-mono text-xs outline-none focus:border-ring"
							/>
							<label htmlFor="custom-model-name" className="text-[11px] text-muted-foreground">
								Display name
							</label>
							<input
								id="custom-model-name"
								value={addModel.name}
								onChange={(e) => setAddModel((s) => ({ ...s, name: e.target.value }))}
								placeholder="Optional"
								className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs outline-none focus:border-ring"
							/>
							<label htmlFor="custom-model-ctx" className="text-[11px] text-muted-foreground">
								Context window
							</label>
							<input
								id="custom-model-ctx"
								value={addModel.contextWindow}
								onChange={(e) => setAddModel((s) => ({ ...s, contextWindow: e.target.value }))}
								placeholder="Tokens — e.g. 200000"
								inputMode="numeric"
								className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs tabular-nums outline-none focus:border-ring"
							/>
							<label htmlFor="custom-model-max" className="text-[11px] text-muted-foreground">
								Max output
							</label>
							<input
								id="custom-model-max"
								value={addModel.maxTokens}
								onChange={(e) => setAddModel((s) => ({ ...s, maxTokens: e.target.value }))}
								placeholder="Tokens — optional"
								inputMode="numeric"
								className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs tabular-nums outline-none focus:border-ring"
							/>
							<label htmlFor="custom-model-reasoning" className="text-[11px] text-muted-foreground">
								Reasoning
							</label>
							<label
								htmlFor="custom-model-reasoning"
								className="flex cursor-pointer items-center gap-2 text-xs text-card-foreground"
							>
								<input
									id="custom-model-reasoning"
									type="checkbox"
									checked={addModel.reasoning}
									onChange={(e) => setAddModel((s) => ({ ...s, reasoning: e.target.checked }))}
									className="size-3.5"
								/>
								Supports extended thinking
							</label>
						</div>
						{modelError && <p className="mt-3 text-[11px] text-red-400">{modelError}</p>}
						<div className="mt-4 flex justify-end gap-2">
							<button
								type="button"
								className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
								onClick={() => setAddModelProvider(null)}
							>
								Cancel
							</button>
							<button
								type="button"
								disabled={savingModel || !addModel.id.trim()}
								className="rounded-lg bg-secondary px-3 py-1.5 text-xs text-card-foreground hover:bg-secondary/80 disabled:opacity-50"
								onClick={() => void saveCustomModel()}
							>
								{savingModel ? 'Adding…' : 'Add model'}
							</button>
						</div>
					</RadixDialog.Content>
				</RadixDialog.Portal>
			</RadixDialog.Root>

			{/* Browser OAuth (Claude Code / Antigravity). */}
			<RadixDialog.Root
				open={browserLoginProvider !== null}
				onOpenChange={(o) => {
					if (!o) void cancelBrowserLogin();
				}}
			>
				<RadixDialog.Portal>
					<RadixDialog.Overlay className="fixed inset-0 z-[1000] bg-black/60" />
					<RadixDialog.Content className={dialogContentClass} onKeyDown={(e) => e.stopPropagation()}>
						<RadixDialog.Title className="text-sm font-semibold text-card-foreground">
							{(browserLoginProvider && BROWSER_OAUTH_PROVIDERS[browserLoginProvider]?.title) ||
								'Browser sign-in'}
						</RadixDialog.Title>
						<RadixDialog.Description className="mt-2 text-xs text-muted-foreground">
							{browserLoginMessage || 'Sign in in your browser.'}
						</RadixDialog.Description>
						<div className="mt-4 flex items-center justify-end gap-2">
							{browserLoginBusy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
							<button
								type="button"
								className={cn(
									'rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary',
								)}
								onClick={() => void cancelBrowserLogin()}
							>
								{browserLoginBusy ? 'Cancel' : 'Close'}
							</button>
						</div>
					</RadixDialog.Content>
				</RadixDialog.Portal>
			</RadixDialog.Root>
		</div>
	);
}
