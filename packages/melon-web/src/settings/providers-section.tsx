import { useEffect, useMemo, useRef, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { ChevronRight, KeyRound, Loader2, LogIn, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { normalizeProvider, type ProviderInfo } from '@/lib/providers';

type BrowserLoginStatus = {
	phase?: 'idle' | 'awaiting_browser' | 'done' | 'error';
	url?: string;
	error?: string;
};

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

function ProviderRow({
	provider,
	busy,
	onConnect,
	onDisconnect,
}: {
	provider: ProviderInfo;
	busy: boolean;
	onConnect: (p: ProviderInfo) => void;
	onDisconnect: (p: ProviderInfo) => void;
}) {
	const canConnect = provider.authTypes.length > 0;
	return (
		<div className="flex items-center gap-3 px-3 py-2.5">
			<div className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-sm font-medium text-muted-foreground">
				{provider.name.charAt(0).toUpperCase()}
			</div>
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium text-card-foreground">{provider.name}</p>
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
	);
}

function ProviderGroup({
	title,
	providers,
	busyId,
	onConnect,
	onDisconnect,
}: {
	title: string;
	providers: ProviderInfo[];
	busyId: string | null;
	onConnect: (p: ProviderInfo) => void;
	onDisconnect: (p: ProviderInfo) => void;
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
						busy={busyId === p.id}
						onConnect={onConnect}
						onDisconnect={onDisconnect}
					/>
				))}
			</div>
		</section>
	);
}

/**
 * Settings → Providers. Connect/disconnect model providers the same way the
 * composer used to, but as a page: search, Connected/Available groups, and a
 * connect dialog offering subscription (OAuth) or API key.
 */
export function ProvidersSection() {
	const [providers, setProviders] = useState<ProviderInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [search, setSearch] = useState('');
	const [busyId, setBusyId] = useState<string | null>(null);

	const [methodProvider, setMethodProvider] = useState<ProviderInfo | null>(null);
	const [keyProvider, setKeyProvider] = useState<ProviderInfo | null>(null);
	const [key, setKey] = useState('');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');

	const [browserLoginProvider, setBrowserLoginProvider] = useState<string | null>(null);
	const [browserLoginBusy, setBrowserLoginBusy] = useState(false);
	const [browserLoginMessage, setBrowserLoginMessage] = useState('');
	const browserPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const load = () =>
		fetch('/auth/providers')
			.then((r) => r.json())
			.then((d) => {
				const list = Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [];
				setProviders(list.map(normalizeProvider).filter((p): p is ProviderInfo => p !== null));
			})
			.catch(() => {})
			.finally(() => setLoading(false));

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

	const connected = filtered.filter((p) => p.connected);
	const available = filtered.filter((p) => !p.connected);

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
								busyId={busyId}
								onConnect={connect}
								onDisconnect={disconnect}
							/>
						)}
						{available.length > 0 && (
							<ProviderGroup
								title="Available"
								providers={available}
								busyId={busyId}
								onConnect={connect}
								onDisconnect={disconnect}
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
