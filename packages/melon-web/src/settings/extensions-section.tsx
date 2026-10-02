import { useCallback, useEffect, useState } from 'react';
import { Loader2, PackageOpen, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { confirmAction } from '@/components/dialogs';
import { cn } from '@/lib/utils';

/**
 * Settings → Extensions. Manages the pi packages (extensions) loaded into
 * every Melon chat session, via the server's /packages endpoints
 * (install/remove/update against the agent settings packages list).
 * Installed/removed packages apply to NEW chats.
 */

interface PackageInfo {
	source: string;
	scope: 'user' | 'project';
	filtered: boolean;
	installedPath?: string;
}

function shortName(source: string): string {
	return source.replace(/^npm:/, '').replace(/^git\+/, '');
}

export function ExtensionsSection() {
	const [packages, setPackages] = useState<PackageInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);
	const [input, setInput] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const flash = (msg: string) => {
		setNotice(msg);
		setTimeout(() => setNotice((n) => (n === msg ? null : n)), 3000);
	};

	const refresh = useCallback(async () => {
		try {
			const res = await fetch('/packages', { cache: 'no-store' });
			const body = (await res.json()) as { packages?: PackageInfo[]; error?: string };
			if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
			setPackages(body.packages ?? []);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const act = async (key: string, fn: () => Promise<void>) => {
		setBusy(key);
		setError(null);
		try {
			await fn();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	};

	const install = () =>
		act('install', async () => {
			const source = input.trim();
			if (!source) return;
			const res = await fetch('/packages/install', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ source }),
			});
			const body = (await res.json()) as { packages?: PackageInfo[]; error?: string };
			if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
			setPackages(body.packages ?? []);
			setInput('');
			flash(`Installed ${shortName(source)} — available in new chats`);
		});

	const update = (source?: string) =>
		act(source ? `update:${source}` : 'update:all', async () => {
			const res = await fetch('/packages/update', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(source ? { source } : {}),
			});
			const body = (await res.json()) as { packages?: PackageInfo[]; error?: string };
			if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
			setPackages(body.packages ?? []);
			flash(source ? `Updated ${shortName(source)}` : 'All packages updated');
		});

	const remove = (p: PackageInfo) =>
		act(`remove:${p.source}`, async () => {
			const ok = await confirmAction({
				title: `Remove ${shortName(p.source)}?`,
				description: 'Its tools and skills disappear from new chats. Existing chats keep working until restarted.',
			});
			if (!ok) return;
			const res = await fetch('/packages/remove', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ source: p.source }),
			});
			const body = (await res.json()) as { packages?: PackageInfo[]; error?: string };
			if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
			setPackages(body.packages ?? []);
			flash(`Removed ${shortName(p.source)}`);
		});

	return (
		<div className="h-full w-full overflow-y-auto">
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-5">
				<div className="flex items-start justify-between gap-3">
					<div>
						<h2 className="text-sm font-medium text-card-foreground">Extensions</h2>
						<p className="mt-0.5 text-[11px] text-muted-foreground">
							Pi packages loaded into every chat card — tools, skills, prompts. npm or git
							sources, e.g. <code className="text-[11px]">npm:pi-web-access@0.35.0</code>.
							Changes apply to new chats.
						</p>
					</div>
					<button
						className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
						title="Refresh list"
						aria-label="Refresh list"
						onClick={() => void refresh()}
					>
						<RefreshCw className={cn('size-4', loading && 'animate-spin')} />
					</button>
				</div>

				{error && (
					<div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
						{error}
					</div>
				)}
				{notice && (
					<div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
						{notice}
					</div>
				)}

				<div className="flex gap-2">
					<input
						type="text"
						value={input}
						placeholder="npm:package@1.2.3 or https://github.com/user/repo"
						className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-card-foreground outline-none focus:border-ring"
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') void install();
						}}
					/>
					<button
						className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
						disabled={busy === 'install' || !input.trim()}
						onClick={() => void install()}
					>
						{busy === 'install' ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
						Install
					</button>
				</div>

				<div className="space-y-2">
					{packages.map((p) => (
						<div
							key={`${p.scope}:${p.source}`}
							className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
						>
							<PackageOpen className="size-4 shrink-0 text-muted-foreground" />
							<div className="min-w-0 flex-1">
								<div className="truncate text-xs text-card-foreground">{shortName(p.source)}</div>
								<div className="truncate text-[11px] text-muted-foreground">
									{p.source !== shortName(p.source) ? p.source : ''}
									{p.scope === 'project' ? ' (this folder)' : ''}
									{p.filtered ? ' — filtered in settings' : ''}
								</div>
							</div>
							<button
								className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
								disabled={busy !== null}
								onClick={() => void update(p.source)}
							>
								{busy === `update:${p.source}` ? <Loader2 className="size-3 animate-spin" /> : 'Update'}
							</button>
							<button
								className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
								title="Remove"
								aria-label={`Remove ${shortName(p.source)}`}
								disabled={busy !== null}
								onClick={() => void remove(p)}
							>
								{busy === `remove:${p.source}` ? (
									<Loader2 className="size-3.5 animate-spin" />
								) : (
									<Trash2 className="size-3.5" />
								)}
							</button>
						</div>
					))}
					{!loading && packages.length === 0 && (
						<div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">
							No extensions installed yet.
						</div>
					)}
				</div>

				<button
					className="self-start rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
					disabled={busy !== null || packages.length === 0}
					onClick={() => void update()}
				>
					{busy === 'update:all' ? 'Updating all…' : 'Update all'}
				</button>
			</div>
		</div>
	);
}