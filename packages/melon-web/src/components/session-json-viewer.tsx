import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, RefreshCw } from 'lucide-react';
import { JsonTreeView } from '@/components/json-tree';
import { cn } from '@/lib/utils';

/**
 * Developer JSON viewer for a chat box's raw session transcript.
 *
 * - System prompt (this turn) — live per-turn prompt, falling back to the base
 *   prompt; shows which source it came from.
 * - Last request — the final wire payload of the last LLM call (debugRequestDump).
 * - Raw JSONL entries — collapsed rows, expanded as click-to-copy JSON trees.
 *
 * Font size is applied via inline style (A−/A+ control, persisted) so it is
 * deterministic across card, fullscreen, and panel views.
 */

const FONT_SIZE_KEY = 'melon:sessionJsonFontSize';
const DEFAULT_FONT_SIZE = 9;

function readFontSize(): number {
	try {
		const raw = localStorage.getItem(FONT_SIZE_KEY);
		const n = raw ? Number(raw) : NaN;
		return Number.isFinite(n) && n >= 8 && n <= 16 ? Math.round(n) : DEFAULT_FONT_SIZE;
	} catch {
		return DEFAULT_FONT_SIZE;
	}
}

interface RawPayload {
	path?: string;
	lines?: string[];
}

interface SystemPromptPayload {
	systemPrompt?: string | null;
	source?: string | null;
}

function entrySummary(line: string): { label: string; role?: string } {
	try {
		const entry = JSON.parse(line) as Record<string, unknown>;
		const type = typeof entry.type === 'string' ? entry.type : 'entry';
		const message = entry.message as Record<string, unknown> | undefined;
		const role = typeof message?.role === 'string' ? message.role : undefined;
		let text = '';
		if (Array.isArray(message?.content)) {
			for (const block of message.content as Array<Record<string, unknown>>) {
				if (block && block.type === 'text' && typeof block.text === 'string') {
					text = block.text;
					break;
				}
				if (block && block.type === 'tool_use' && typeof block.name === 'string') {
					text = `tool_use: ${block.name}`;
					break;
				}
				if (block && block.type === 'tool_result') {
					text = 'tool_result';
					break;
				}
			}
		}
		const preview = text.replace(/\s+/g, ' ').slice(0, 140);
		return { label: `${type}${role ? ` · ${role}` : ''}${preview ? ` · ${preview}` : ''}`, role };
	} catch {
		return { label: line.slice(0, 140) || '(empty line)' };
	}
}

function EntryRow({
	line,
	index,
	fontSize,
}: {
	line: string;
	index: number;
	fontSize: number;
}) {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const { label, role } = useMemo(() => entrySummary(line), [line]);
	let pretty: string | null = null;
	if (open) {
		try {
			pretty = JSON.stringify(JSON.parse(line), null, 2);
		} catch {
			pretty = line;
		}
	}
	const copy = () => {
		void navigator.clipboard.writeText(pretty ?? line).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		});
	};
	return (
		<div className="border-b border-border/50 last:border-b-0">
			<div className="group flex items-center gap-1.5 px-2 py-1.5">
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-secondary/60"
				>
					{open ? (
						<ChevronDown className="size-3 shrink-0 text-muted-foreground" />
					) : (
						<ChevronRight className="size-3 shrink-0 text-muted-foreground" />
					)}
					<span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">
						{index + 1}
					</span>
					<span
						className={cn(
							'shrink-0 rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide',
							role === 'user'
								? 'bg-sky-500/15 text-sky-500'
								: role === 'assistant'
									? 'bg-emerald-500/15 text-emerald-500'
									: 'bg-secondary text-muted-foreground',
						)}
					>
						{role ?? 'entry'}
					</span>
					<span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
						{label}
					</span>
				</button>
				<button
					type="button"
					aria-label="Copy entry"
					onClick={copy}
					className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
					title="Copy JSON"
				>
					{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
				</button>
			</div>
			{open && pretty !== null && (
				<JsonTreeView
					value={(() => {
						try {
							return JSON.parse(line);
						} catch {
							return line;
						}
					})()}
					fontSize={fontSize}
					className="mx-2 mb-2"
				/>
			)}
		</div>
	);
}

function LastRequestPanel({ cardId, fontSize }: { cardId: string; fontSize: number }) {
	const [request, setRequest] = useState<{
		model: string;
		capturedAt: string;
		payload: unknown;
	} | null>(null);
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);

	const load = () => {
		fetch(`/sessions/${encodeURIComponent(cardId)}/last-request`)
			.then((r) => (r.ok ? r.json() : null))
			.then((d: { request?: { model: string; capturedAt: string; payload: unknown } | null }) =>
				setRequest(d?.request ?? null),
			)
			.catch(() => setRequest(null));
	};
	useEffect(load, [cardId]);
	useEffect(() => {
		const t = setInterval(load, 4000);
		return () => clearInterval(t);
	}, [cardId]);

	return (
		<div className="border-b border-border">
			<div className="flex items-center gap-1.5 px-2 py-1.5">
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-secondary/60"
				>
					{open ? (
						<ChevronDown className="size-3 shrink-0 text-muted-foreground" />
					) : (
						<ChevronRight className="size-3 shrink-0 text-muted-foreground" />
					)}
					<span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
						Last request (wire payload)
					</span>
					{request ? (
						<span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
							{request.model} · {new Date(request.capturedAt).toLocaleTimeString()}
						</span>
					) : (
						<span className="text-[10px] text-muted-foreground/60">
							— send a message in this box (capture on), then it appears here
						</span>
					)}
				</button>
				{request !== null && (
					<button
						type="button"
						aria-label="Copy last request"
						onClick={() => {
							void navigator.clipboard
								.writeText(JSON.stringify(request.payload, null, 2))
								.then(() => {
									setCopied(true);
									setTimeout(() => setCopied(false), 1200);
								});
						}}
						className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
						title="Copy"
					>
						{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
					</button>
				)}
			</div>
			{open && request !== null && (
				<JsonTreeView value={request.payload} fontSize={fontSize} className="mx-2 mb-2" />
			)}
		</div>
	);
}

function SystemPromptPanel({ cardId, fontSize }: { cardId: string; fontSize: number }) {
	const [prompt, setPrompt] = useState<string | null>(null);
	const [source, setSource] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);

	const load = () => {
		fetch(`/sessions/${encodeURIComponent(cardId)}/system-prompt`)
			.then((r) => (r.ok ? r.json() : null))
			.then((d: SystemPromptPayload | null) => {
				setPrompt(d?.systemPrompt ?? null);
				setSource(d?.source ?? null);
			})
			.catch(() => setPrompt(null));
	};
	useEffect(load, [cardId]);
	// Poll briefly while visible so panels fill themselves once the session
	// attaches / a turn runs (page reloads detach cards lazily).
	useEffect(() => {
		const t = setInterval(load, 4000);
		return () => clearInterval(t);
	}, [cardId]);

	return (
		<div className="border-b border-border">
			<div className="flex items-center gap-1.5 px-2 py-1.5">
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-secondary/60"
				>
					{open ? (
						<ChevronDown className="size-3 shrink-0 text-muted-foreground" />
					) : (
						<ChevronRight className="size-3 shrink-0 text-muted-foreground" />
					)}
					<span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
						System prompt (this turn)
					</span>
					{prompt === null && (
						<span className="text-[10px] text-muted-foreground/60">
							— send a message in this box to attach its session
						</span>
					)}
					{prompt !== null && (
						<span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
							{source === 'base' ? 'base · ' : ''}
							{prompt.length.toLocaleString()} chars
						</span>
					)}
				</button>
				{prompt !== null && (
					<button
						type="button"
						aria-label="Copy system prompt"
						onClick={() => {
							void navigator.clipboard.writeText(prompt).then(() => {
								setCopied(true);
								setTimeout(() => setCopied(false), 1200);
							});
						}}
						className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
						title="Copy"
					>
						{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
					</button>
				)}
			</div>
			{open && prompt !== null && (
				<pre
					className="mx-2 mb-2 max-h-96 overflow-auto rounded-md bg-secondary/50 p-2 font-mono leading-relaxed text-card-foreground"
					style={{ scrollbarWidth: 'thin', fontSize }}
				>
					{prompt}
				</pre>
			)}
		</div>
	);
}

export function SessionJsonViewer({
	cardId,
	sessionFile,
	className,
}: {
	cardId: string;
	sessionFile?: string | null;
	className?: string;
}) {
	const [lines, setLines] = useState<string[] | null>(null);
	const [error, setError] = useState('');
	const [filter, setFilter] = useState('');
	const [fontSize, setFontSize] = useState(() => readFontSize());

	const setFontSizePersisted = (size: number) => {
		const clamped = Math.min(16, Math.max(8, Math.round(size)));
		setFontSize(clamped);
		try {
			localStorage.setItem(FONT_SIZE_KEY, String(clamped));
		} catch {
			/* private mode */
		}
	};

	const load = () => {
		if (!sessionFile) return;
		setError('');
		fetch(`/sessions/raw?sessionFile=${encodeURIComponent(sessionFile)}`)
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((d: RawPayload) => setLines(Array.isArray(d.lines) ? d.lines : []))
			.catch((e: unknown) => {
				setLines(null);
				setError(e instanceof Error ? e.message : 'Could not load session JSON');
			});
	};

	useEffect(load, [sessionFile]);

	const filtered = useMemo(() => {
		if (!lines) return [];
		const q = filter.trim().toLowerCase();
		if (!q) return lines.map((line, index) => ({ line, index }));
		return lines
			.map((line, index) => ({ line, index }))
			.filter((e) => e.line.toLowerCase().includes(q));
	}, [lines, filter]);

	return (
		<div className={cn('relative min-h-0 min-w-0 flex-1', className)}>
			<div className="absolute inset-0 flex flex-col bg-background">
				<div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
					<input
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						placeholder="Filter lines (text, tool names, roles…)"
						className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-[11px] outline-none focus:border-ring"
					/>
					{lines !== null && (
						<span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
							{filtered.length === lines.length
								? `${lines.length} entries`
								: `${filtered.length}/${lines.length}`}
						</span>
					)}
					<div className="flex shrink-0 items-center rounded-md border border-border">
						<button
							type="button"
							aria-label="Decrease font size"
							title="Smaller JSON text"
							disabled={fontSize <= 8}
							onClick={() => setFontSizePersisted(fontSize - 1)}
							className="px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
						>
							A−
						</button>
						<span className="border-x border-border px-1 text-[9px] tabular-nums text-muted-foreground">
							{fontSize}
						</span>
						<button
							type="button"
							aria-label="Increase font size"
							title="Larger JSON text"
							disabled={fontSize >= 16}
							onClick={() => setFontSizePersisted(fontSize + 1)}
							className="px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
						>
							A+
						</button>
					</div>
					<button
						type="button"
						onClick={load}
						disabled={!sessionFile}
						title="Reload from disk"
						className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
					>
						<RefreshCw className="size-3.5" />
					</button>
				</div>
				<div
					className="nodrag nowheel min-h-0 flex-1 overflow-y-auto"
					style={{ scrollbarWidth: 'thin' }}
				>
					{!sessionFile ? (
						<p className="px-3 py-3 text-[11px] text-muted-foreground">
							No session yet — send the first message, then reload.
						</p>
					) : error ? (
						<p className="px-3 py-3 text-[11px] text-red-400">{error}</p>
					) : lines === null ? (
						<p className="px-3 py-3 text-[11px] text-muted-foreground">Loading…</p>
					) : (
						<>
							<SystemPromptPanel cardId={cardId} fontSize={fontSize} />
							<LastRequestPanel cardId={cardId} fontSize={fontSize} />
							{filtered.map(({ line, index }) => (
								<EntryRow key={index} line={line} index={index} fontSize={fontSize} />
							))}
							{filtered.length === 0 && (
								<p className="px-3 py-3 text-[11px] text-muted-foreground">No lines match the filter.</p>
							)}
						</>
					)}
				</div>
			</div>
		</div>
	);
}