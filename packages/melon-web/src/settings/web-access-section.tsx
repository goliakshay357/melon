import { useEffect, useState } from 'react';
import { Loader2, RotateCcw, Save } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Settings → Web access. Edits the pi-web-access config file
 * (web-search.json in the agent dir) via the server's /web-access endpoints.
 * Changes apply to NEW chats (extensions read config at session start).
 */

interface WebAccessConfig {
	workflow?: 'none' | 'summary-review' | 'auto-summary';
	webSearch?: { enabled?: boolean };
	[key: string]: unknown;
}

/** Curated provider key fields shown as inputs; everything else via raw JSON. */
const KEY_FIELDS: Array<{ key: string; label: string; hint: string }> = [
	{ key: 'braveApiKey', label: 'Brave', hint: 'brave.com/search/api' },
	{ key: 'exaApiKey', label: 'Exa', hint: 'exa.ai (also enables keyless search quality)' },
	{ key: 'tavilyApiKey', label: 'Tavily', hint: 'tavily.com' },
	{ key: 'openaiApiKey', label: 'OpenAI', hint: 'platform.openai.com' },
	{ key: 'youApiKey', label: 'You.com', hint: 'you.com/api' },
	{ key: 'jinaApiKey', label: 'Jina', hint: 'jina.ai' },
	{ key: 'kagiApiKey', label: 'Kagi', hint: 'kagi.com' },
	{ key: 'xaiApiKey', label: 'xAI', hint: 'console.x.ai' },
	{ key: 'mistralApiKey', label: 'Mistral', hint: 'mistral.ai' },
	{ key: 'searxngBaseUrl', label: 'SearXNG URL', hint: 'self-hosted instance base URL' },
];

const WORKFLOWS: Array<{ value: WebAccessConfig['workflow']; label: string; hint: string }> = [
	{ value: 'none', label: 'Raw results (recommended)', hint: 'No summary calls, no browser windows' },
	{ value: 'auto-summary', label: 'Auto summary', hint: 'A model summarizes results; no browser' },
	{ value: 'summary-review', label: 'Curator review', hint: 'Opens a browser window to review drafts' },
];

export function WebAccessSection() {
	const [config, setConfig] = useState<WebAccessConfig>({});
	const [raw, setRaw] = useState('');
	const [showRaw, setShowRaw] = useState(false);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		let alive = true;
		fetch('/web-access', { cache: 'no-store' })
			.then((r) => r.json())
			.then((body: { config?: WebAccessConfig }) => {
				if (!alive) return;
				const cfg = body.config ?? {};
				setConfig(cfg);
				setRaw(JSON.stringify(cfg, null, 2));
			})
			.catch(() => {
				if (alive) setError('Could not load web access config');
			})
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, []);

	const save = async (next: WebAccessConfig) => {
		setSaving(true);
		setError(null);
		setSaved(false);
		try {
			const res = await fetch('/web-access', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(next),
			});
			const body = (await res.json()) as { config?: WebAccessConfig; error?: string };
			if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
			setConfig(body.config ?? next);
			setRaw(JSON.stringify(body.config ?? next, null, 2));
			setSaved(true);
			setTimeout(() => setSaved(false), 2500);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	const setField = (key: string, value: string) => {
		setConfig((c) => {
			const next = { ...c };
			if (value.trim()) next[key] = value.trim();
			else delete next[key];
			return next;
		});
	};

	const searchEnabled = config.webSearch?.enabled !== false;

	if (loading) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				<Loader2 className="size-4 animate-spin" />
			</div>
		);
	}

	return (
		<div className="h-full w-full overflow-y-auto">
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-5">
				<div>
					<h2 className="text-sm font-medium text-card-foreground">Web access</h2>
					<p className="mt-0.5 text-[11px] text-muted-foreground">
						Search and fetch tools for every chat card (web_search, fetch_content). Without any
						key, keyless search still works. Changes apply to new chats.
					</p>
				</div>

				{error && (
					<div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
						{error}
					</div>
				)}

				<div className="rounded-lg border border-border p-3">
					<div className="text-xs font-medium text-card-foreground">Search mode</div>
					<div className="mt-2 space-y-1.5">
						{WORKFLOWS.map((w) => (
							<label
								key={w.value ?? 'none'}
								className={cn(
									'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition-colors',
									(config.workflow ?? 'none') === w.value
										? 'border-ring bg-secondary'
										: 'border-border hover:bg-secondary',
								)}
							>
								<input
									type="radio"
									name="workflow"
									className="mt-0.5"
									checked={(config.workflow ?? 'none') === w.value}
									onChange={() => setConfig((c) => ({ ...c, workflow: w.value }))}
								/>
								<span className="min-w-0">
									<span className="block text-xs text-card-foreground">{w.label}</span>
									<span className="block text-[11px] text-muted-foreground">{w.hint}</span>
								</span>
							</label>
						))}
					</div>
					<label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-card-foreground">
						<input
							type="checkbox"
							checked={searchEnabled}
							onChange={(e) =>
								setConfig((c) => ({
									...c,
									webSearch: { ...c.webSearch, enabled: e.target.checked || undefined },
								}))
							}
						/>
						Enable web_search (fetch_content stays on either way)
					</label>
				</div>

				<div className="rounded-lg border border-border p-3">
					<div className="text-xs font-medium text-card-foreground">Search provider keys</div>
					<div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
						{KEY_FIELDS.map((f) => (
							<label key={f.key} className="block min-w-0">
								<span className="block text-[11px] text-muted-foreground">
									{f.label}
									<span className="text-muted-foreground/60"> — {f.hint}</span>
								</span>
								<input
									type="text"
									value={typeof config[f.key] === 'string' ? (config[f.key] as string) : ''}
									placeholder="not set"
									className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1 text-xs text-card-foreground outline-none focus:border-ring"
									onChange={(e) => setField(f.key, e.target.value)}
								/>
							</label>
						))}
					</div>
				</div>

				<div className="rounded-lg border border-border p-3">
					<button
						className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
						onClick={() => setShowRaw((v) => !v)}
					>
						<RotateCcw className="size-3" />
						{showRaw ? 'Hide advanced config (JSON)' : 'Advanced config (JSON)'}
					</button>
					{showRaw && (
						<textarea
							value={raw}
							spellCheck={false}
							rows={10}
							className="mt-2 w-full rounded-lg border border-border bg-background p-2 font-mono text-[11px] text-card-foreground outline-none focus:border-ring"
							onChange={(e) => setRaw(e.target.value)}
						/>
					)}
				</div>

				<div className="flex items-center gap-3">
					<button
						className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
						disabled={saving}
						onClick={() => {
							if (!showRaw) return void save(config);
							try {
								const parsed = JSON.parse(raw) as WebAccessConfig;
								setConfig(parsed);
								void save(parsed);
							} catch {
								setError('Advanced config is not valid JSON');
							}
						}}
					>
						{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
						Save
					</button>
					{saved && <span className="text-[11px] text-muted-foreground">Saved — applies to new chats</span>}
				</div>
			</div>
		</div>
	);
}