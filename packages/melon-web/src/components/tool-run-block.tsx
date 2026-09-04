import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { highlightCode, languageFromPath } from "@/lib/prism-highlight";

/** Survives remounts so expand/collapse state does not flicker. */
const blockUi = new Map<string, boolean>();
function uiFlag(key: string, fallback: boolean): boolean {
	return blockUi.has(key) ? (blockUi.get(key) as boolean) : fallback;
}
function setUiFlag(key: string, v: boolean) {
	blockUi.set(key, v);
}

function Spinner() {
	return (
		<span className="inline-block size-2.5 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground" />
	);
}

export type ToolRunView = {
	callId: string;
	name: string;
	status: "running" | "ok" | "error";
	args?: string;
	argsStructured?: Record<string, unknown>;
	output: string;
};

type ToolKind = "bash" | "read" | "write" | "edit" | "ls" | "find" | "grep" | "other";

function normalizeName(name: string): string {
	return name.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function kindOf(name: string): ToolKind {
	const n = normalizeName(name);
	if (n === "bash" || n === "shell" || n === "runterminalcmd") return "bash";
	if (n === "read" || n === "readfile") return "read";
	if (n === "write" || n === "writefile") return "write";
	if (n === "edit" || n === "strreplace" || n === "searchreplace") return "edit";
	if (n === "ls" || n === "listdir") return "ls";
	if (n === "find" || n === "glob" || n === "globfilesearch") return "find";
	if (n === "grep" || n === "rg" || n === "search") return "grep";
	return "other";
}

function parseArgs(raw?: string): Record<string, unknown> | null {
	if (!raw?.trim()) return null;
	const t = raw.trim();
	if (t.startsWith("{") || t.startsWith("[")) {
		try {
			const v = JSON.parse(t) as unknown;
			return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
		} catch {
			return null;
		}
	}
	return null;
}

function resolveArgs(run: ToolRunView): Record<string, unknown> | null {
	if (run.argsStructured && Object.keys(run.argsStructured).length > 0) return run.argsStructured;
	return parseArgs(run.args);
}

function strArg(args: Record<string, unknown> | null, ...keys: string[]): string | undefined {
	if (!args) return undefined;
	for (const k of keys) {
		const v = args[k];
		if (typeof v === "string" && v.length) return v;
	}
	return undefined;
}

function inferExitCode(output: string, status: ToolRunView["status"]): number | null {
	if (status === "ok") return 0;
	const m =
		output.match(/\b(?:exited with code|exit(?:ed)?(?:\s+code)?)\s*[:=]?\s*(-?\d+)\b/i) ??
		output.match(/\bexit\s+(-?\d+)\b/i);
	if (m) return Number(m[1]);
	if (status === "error") return 1;
	return null;
}

function lineCount(text: string): number {
	if (!text) return 0;
	return text.replace(/\n$/, "").split("\n").length;
}

function looksLikeDiff(output: string): boolean {
	const lines = output.split("\n").filter((l) => l.length > 0).slice(0, 120);
	if (lines.length < 2) return false;
	let hits = 0;
	for (const l of lines) {
		if (/^(\+\+\+|---)/.test(l) || /^@@ /.test(l) || /^(\+[^+]|-[^-])/.test(l)) hits++;
	}
	return hits >= Math.max(2, Math.floor(lines.length * 0.15));
}

type DiffRow =
	| { kind: "meta"; text: string }
	| { kind: "hunk"; text: string }
	| { kind: "ctx"; oldNo: number | null; newNo: number | null; text: string }
	| { kind: "add"; oldNo: null; newNo: number; text: string }
	| { kind: "del"; oldNo: number; newNo: null; text: string };

/** Parse unified diff into GitHub-style rows (old# | new# | line). */
function parseUnifiedDiff(output: string): { rows: DiffRow[]; summary: string | undefined } {
	const raw = output.replace(/\n$/, "").split("\n");
	const rows: DiffRow[] = [];
	let oldNo = 0;
	let newNo = 0;
	let inHunk = false;
	let minNew: number | undefined;
	let maxNew: number | undefined;
	let added = 0;
	let removed = 0;

	const markChanged = (n: number | null) => {
		if (n == null) return;
		minNew = minNew === undefined ? n : Math.min(minNew, n);
		maxNew = maxNew === undefined ? n : Math.max(maxNew, n);
	};

	for (const line of raw) {
		const hunk = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/.exec(line);
		if (hunk) {
			oldNo = Number(hunk[1]);
			newNo = Number(hunk[2]);
			inHunk = true;
			rows.push({ kind: "hunk", text: line });
			continue;
		}
		if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("diff ") || line.startsWith("index ")) {
			inHunk = false;
			rows.push({ kind: "meta", text: line });
			continue;
		}
		if (!inHunk) {
			// Prefixed success text ("Successfully wrote…") before the patch.
			if (line.trim()) rows.push({ kind: "meta", text: line });
			continue;
		}
		if (line.startsWith("\\")) {
			rows.push({ kind: "meta", text: line });
			continue;
		}
		if (line.startsWith("+")) {
			rows.push({ kind: "add", oldNo: null, newNo, text: line.slice(1) });
			markChanged(newNo);
			added++;
			newNo++;
			continue;
		}
		if (line.startsWith("-")) {
			rows.push({ kind: "del", oldNo, newNo: null, text: line.slice(1) });
			removed++;
			oldNo++;
			continue;
		}
		// Context (leading space or bare).
		const text = line.startsWith(" ") ? line.slice(1) : line;
		rows.push({ kind: "ctx", oldNo, newNo, text });
		oldNo++;
		newNo++;
	}

	const summaryParts: string[] = [];
	if (minNew !== undefined && maxNew !== undefined) {
		summaryParts.push(minNew === maxNew ? `line ${minNew}` : `lines ${minNew}–${maxNew}`);
	}
	if (added || removed) summaryParts.push(`+${added} −${removed}`);
	return { rows, summary: summaryParts.length ? summaryParts.join(" · ") : undefined };
}

function GithubDiffView({ output, title }: { output: string; title?: string }) {
	const DIFF_LAYOUT_KEY = "melon:diffLayout";
	const [layout, setLayout] = useState<"unified" | "split">(() => {
		try {
			const v = localStorage.getItem(DIFF_LAYOUT_KEY);
			return v === "split" ? "split" : "unified";
		} catch {
			return "unified";
		}
	});
	const [fullscreen, setFullscreen] = useState(false);
	const setLayoutPersist = (next: "unified" | "split") => {
		setLayout(next);
		try {
			localStorage.setItem(DIFF_LAYOUT_KEY, next);
		} catch {
			/* ignore */
		}
	};

	useEffect(() => {
		if (!fullscreen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			e.stopImmediatePropagation();
			setFullscreen(false);
		};
		window.addEventListener("keydown", onKey, { capture: true });
		return () => window.removeEventListener("keydown", onKey, { capture: true });
	}, [fullscreen]);

	const { rows, summary } = useMemo(() => parseUnifiedDiff(output), [output]);
	const splitPairs = useMemo(() => buildSplitPairs(rows), [rows]);
	const width = useMemo(() => {
		let max = 1;
		for (const r of rows) {
			if (r.kind === "ctx" || r.kind === "add" || r.kind === "del") {
				if (r.oldNo != null) max = Math.max(max, r.oldNo);
				if (r.newNo != null) max = Math.max(max, r.newNo);
			}
		}
		return Math.max(2, String(max).length);
	}, [rows]);

	const fmt = (n: number | null) => (n == null ? " ".repeat(width) : String(n).padStart(width, " "));

	if (!rows.length) {
		return <div className="px-2.5 py-1.5 text-[10px] text-muted-foreground">(no output)</div>;
	}

	const renderLayoutToggle = () => (
		<div className="flex shrink-0 overflow-hidden rounded border border-border/60 text-[9px]">
			<button
				type="button"
				className={cn(
					"px-1.5 py-0.5",
					layout === "unified" ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/50",
				)}
				onClick={(e) => {
					e.stopPropagation();
					setLayoutPersist("unified");
				}}
			>
				Unified
			</button>
			<button
				type="button"
				className={cn(
					"border-l border-border/60 px-1.5 py-0.5",
					layout === "split" ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/50",
				)}
				onClick={(e) => {
					e.stopPropagation();
					setLayoutPersist("split");
				}}
			>
				Split
			</button>
		</div>
	);

	const renderBody = (tall: boolean) =>
		layout === "unified" ? (
			<pre
				className={cn(
					"nowheel m-0 overflow-auto px-0 py-1 font-mono text-[10px] leading-relaxed",
					tall ? "min-h-0 flex-1" : "max-h-72",
				)}
			>
				{rows.map((row, i) => {
					if (row.kind === "meta" || row.kind === "hunk") {
						return (
							<div key={i} className="tool-out-meta whitespace-pre-wrap break-words px-2.5">
								{row.text || " "}
							</div>
						);
					}
					const rowCls =
						row.kind === "add" ? "tool-out-add" : row.kind === "del" ? "tool-out-del" : "tool-out-line";
					const sign = row.kind === "add" ? "+" : row.kind === "del" ? "−" : " ";
					return (
						<div key={i} className={cn("flex whitespace-pre-wrap break-words", rowCls)}>
							<span className="tool-diff-gutter shrink-0 select-none border-r border-border/30 px-1.5 text-right tabular-nums">
								{fmt(row.oldNo)}
							</span>
							<span className="tool-diff-gutter shrink-0 select-none border-r border-border/30 px-1.5 text-right tabular-nums">
								{fmt(row.newNo)}
							</span>
							<span className="tool-diff-sign shrink-0 select-none px-1 opacity-80">{sign}</span>
							<span className="min-w-0 flex-1 pr-2.5">{row.text.length ? row.text : " "}</span>
						</div>
					);
				})}
			</pre>
		) : (
			<pre
				className={cn(
					"nowheel m-0 overflow-auto px-0 py-1 font-mono text-[10px] leading-relaxed",
					tall ? "min-h-0 flex-1" : "max-h-72",
				)}
			>
				{splitPairs.map((pair, i) => {
					if ("meta" in pair) {
						return (
							<div key={i} className="tool-out-meta whitespace-pre-wrap break-words px-2.5">
								{pair.meta || " "}
							</div>
						);
					}
					const leftCls =
						pair.left.kind === "del"
							? "tool-out-del"
							: pair.left.kind === "empty"
								? "tool-diff-empty"
								: "tool-out-line";
					const rightCls =
						pair.right.kind === "add"
							? "tool-out-add"
							: pair.right.kind === "empty"
								? "tool-diff-empty"
								: "tool-out-line";
					return (
						<div key={i} className="flex min-w-0 border-b border-border/20 last:border-b-0">
							<div className={cn("flex min-w-0 flex-1 border-r border-border/40", leftCls)}>
								<span className="tool-diff-gutter shrink-0 select-none border-r border-border/30 px-1.5 text-right tabular-nums">
									{fmt(pair.left.no)}
								</span>
								<span className="tool-diff-sign shrink-0 select-none px-1 opacity-80">
									{pair.left.kind === "del" ? "−" : " "}
								</span>
								<span className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-1.5">
									{pair.left.text.length ? pair.left.text : " "}
								</span>
							</div>
							<div className={cn("flex min-w-0 flex-1", rightCls)}>
								<span className="tool-diff-gutter shrink-0 select-none border-r border-border/30 px-1.5 text-right tabular-nums">
									{fmt(pair.right.no)}
								</span>
								<span className="tool-diff-sign shrink-0 select-none px-1 opacity-80">
									{pair.right.kind === "add" ? "+" : " "}
								</span>
								<span className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-1.5">
									{pair.right.text.length ? pair.right.text : " "}
								</span>
							</div>
						</div>
					);
				})}
			</pre>
		);

	const inline = (
		<div className="border-t border-border/40">
			<div className="flex items-center gap-2 border-b border-border/40 px-2.5 py-1">
				{summary ? (
					<span className="min-w-0 flex-1 truncate text-[9px] tabular-nums text-muted-foreground">{summary}</span>
				) : (
					<span className="min-w-0 flex-1" />
				)}
				{renderLayoutToggle()}
				<button
					type="button"
					title="Fullscreen"
					className="shrink-0 rounded border border-border/60 p-0.5 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
					onClick={(e) => {
						e.stopPropagation();
						setFullscreen(true);
					}}
				>
					<Maximize2 className="size-3" />
				</button>
			</div>
			{renderBody(false)}
		</div>
	);

	if (!fullscreen) return inline;

	return (
		<>
			{inline}
			{createPortal(
				<div
					className="fixed inset-0 z-[1000] flex flex-col bg-black/85 p-4 backdrop-blur-sm"
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) {
							e.stopPropagation();
							setFullscreen(false);
						}
					}}
				>
					<div
						className="mb-2 flex shrink-0 items-center gap-2"
						onMouseDown={(e) => e.stopPropagation()}
					>
						<span className="min-w-0 flex-1 truncate text-xs font-medium text-white/70">
							{title || "diff"}
							{summary ? <span className="ml-2 text-white/40">{summary}</span> : null}
						</span>
						{renderLayoutToggle()}
						<button
							type="button"
							title="Exit fullscreen (Esc)"
							className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/80 transition-colors hover:bg-white/20 hover:text-white"
							onClick={(e) => {
								e.stopPropagation();
								setFullscreen(false);
							}}
						>
							<Minimize2 className="size-3.5" /> exit fullscreen
						</button>
					</div>
					<div
						className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/15 bg-[#21222c]"
						onMouseDown={(e) => e.stopPropagation()}
					>
						{renderBody(true)}
					</div>
				</div>,
				document.body,
			)}
		</>
	);
}

type SplitSide = { no: number | null; text: string; kind: "ctx" | "del" | "add" | "empty" };
type SplitPair =
	| { meta: string }
	| { left: SplitSide; right: SplitSide };

/** Align unified rows into GitHub-style split pairs (old left / new right). */
function buildSplitPairs(rows: DiffRow[]): SplitPair[] {
	const out: SplitPair[] = [];
	let i = 0;
	while (i < rows.length) {
		const row = rows[i];
		if (row.kind === "meta" || row.kind === "hunk") {
			out.push({ meta: row.text });
			i++;
			continue;
		}
		if (row.kind === "ctx") {
			out.push({
				left: { no: row.oldNo, text: row.text, kind: "ctx" },
				right: { no: row.newNo, text: row.text, kind: "ctx" },
			});
			i++;
			continue;
		}
		const dels: Extract<DiffRow, { kind: "del" }>[] = [];
		while (i < rows.length && rows[i].kind === "del") {
			dels.push(rows[i] as Extract<DiffRow, { kind: "del" }>);
			i++;
		}
		const adds: Extract<DiffRow, { kind: "add" }>[] = [];
		while (i < rows.length && rows[i].kind === "add") {
			adds.push(rows[i] as Extract<DiffRow, { kind: "add" }>);
			i++;
		}
		const n = Math.max(dels.length, adds.length, 1);
		for (let j = 0; j < n; j++) {
			const d = dels[j];
			const a = adds[j];
			out.push({
				left: d
					? { no: d.oldNo, text: d.text, kind: "del" }
					: { no: null, text: "", kind: "empty" },
				right: a
					? { no: a.newNo, text: a.text, kind: "add" }
					: { no: null, text: "", kind: "empty" },
			});
		}
	}
	return out;
}

/** Secondary detail beside the tool name (path / command) — never replaces the name. */
function headerDetail(kind: ToolKind, args: Record<string, unknown> | null, rawArgs?: string): string | undefined {
	switch (kind) {
		case "bash": {
			const cmd =
				strArg(args, "command", "cmd") ?? (rawArgs && !rawArgs.trim().startsWith("{") ? rawArgs : undefined);
			return cmd ? `$ ${cmd}` : undefined;
		}
		case "read": {
			const path = strArg(args, "path", "file_path", "file", "filePath");
			if (!path) return undefined;
			const offset = args?.offset;
			const limit = args?.limit;
			let range = "";
			if (typeof offset === "number" || typeof limit === "number") {
				const start = typeof offset === "number" ? offset : 1;
				range = typeof limit === "number" ? `:${start}-${start + limit - 1}` : `:${start}`;
			}
			return `${path}${range}`;
		}
		case "write":
		case "edit":
			return strArg(args, "path", "file_path", "file", "filePath");
		case "ls":
			return strArg(args, "path", "dir", "directory") ?? ".";
		case "find": {
			const pattern = strArg(args, "pattern", "glob");
			const path = strArg(args, "path") ?? ".";
			return pattern ? `${pattern} in ${path}` : path;
		}
		case "grep": {
			const pattern = strArg(args, "pattern", "query");
			const path = strArg(args, "path", "glob");
			if (!pattern) return path;
			return path ? `${pattern} · ${path}` : pattern;
		}
		default:
			return undefined;
	}
}

function statusMeta(
	kind: ToolKind,
	run: ToolRunView,
	exit: number | null,
): { label: string; tone: "ok" | "error" | "muted" | "running" } {
	if (run.status === "running") return { label: "running…", tone: "running" };
	const lines = lineCount(run.output);
	if (kind === "bash" && exit !== null) {
		return {
			label: `exit ${exit} · ${lines} lines`,
			tone: exit === 0 ? "ok" : "error",
		};
	}
	if (run.status === "error") return { label: `${lines} lines · error`, tone: "error" };
	return { label: `${lines} lines`, tone: "ok" };
}

function stripReadLinePrefixes(output: string): string {
	// pi read often prefixes "NNN|" or "NNN:" — keep body for Prism when dense.
	const lines = output.replace(/\n$/, "").split("\n");
	if (lines.length < 3) return output;
	const prefixed = lines.filter((l) => /^\s*\d+[|:]/.test(l)).length;
	if (prefixed < Math.floor(lines.length * 0.6)) return output;
	return lines.map((l) => l.replace(/^\s*\d+[|:]\s?/, "")).join("\n");
}

function OutputLines({
	kind,
	output,
	isError,
	filePath,
}: {
	kind: ToolKind;
	output: string;
	isError: boolean;
	filePath?: string;
}) {
	const asDiff = looksLikeDiff(output);
	const lang = languageFromPath(filePath);
	const usePrism = kind === "read" && !asDiff && !isError && !!output.trim() && !!lang;
	const body = usePrism ? stripReadLinePrefixes(output) : output;
	const lines = body.length ? body.replace(/\n$/, "").split("\n") : [];
	const nw = Math.max(2, String(Math.max(lines.length, 1)).length);

	if (!lines.length) {
		return <div className="px-2.5 py-1.5 text-[10px] text-muted-foreground">(no output)</div>;
	}

	// Diff chrome (Unified / Split / fullscreen) is for edit/write/etc — not bash.
	if (asDiff && kind !== "bash") {
		return <GithubDiffView output={output} title={filePath} />;
	}

	if (usePrism) {
		return (
			<pre className="nowheel tool-prism m-0 max-h-72 overflow-auto border-t border-border/40 px-0 py-1 font-mono text-[10px] leading-relaxed">
				<code className="block">
					{lines.map((line, i) => {
						const html = highlightCode(line, lang) ?? escapeHtml(line);
						const n = String(i + 1).padStart(nw, " ");
						return (
							<div key={i} className="flex whitespace-pre-wrap break-words px-2.5">
								<span className="tool-prism-lnum shrink-0 select-none pr-2">{n}</span>
								<span className="min-w-0 flex-1" dangerouslySetInnerHTML={{ __html: html || " " }} />
							</div>
						);
					})}
				</code>
			</pre>
		);
	}

	return (
		<pre className="nowheel m-0 max-h-72 overflow-auto border-t border-border/40 px-0 py-1 font-mono text-[10px] leading-relaxed">
			{lines.map((line, i) => {
				let row = "tool-out-line";
				let bodyLine = line;
				if (kind === "ls") {
					const trimmed = line.trimEnd();
					const isDir = trimmed.endsWith("/") || trimmed.endsWith(": ");
					if (isDir) {
						row = "tool-out-dir";
						if (!/^[📁📂]/.test(trimmed) && trimmed.endsWith("/")) {
							bodyLine = `📁 ${trimmed.slice(0, -1)}`;
						}
					} else if (trimmed) {
						bodyLine = `📄 ${trimmed}`;
					}
				} else if (kind === "bash" && isError && /exit|error|failed|aborted|timeout/i.test(line)) {
					row = "tool-out-err";
				}
				return (
					<div key={i} className={cn("whitespace-pre-wrap break-words px-2.5", row)}>
						{bodyLine.length ? bodyLine : " "}
					</div>
				);
			})}
		</pre>
	);
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function ToolRunBlock({ cardId, run }: { cardId: string; run: ToolRunView }) {
	const key = `${cardId}:tool:${run.callId}`;
	const [open, setOpen] = useState(() => uiFlag(key, run.status === "running"));
	const prevStatus = useRef(run.status);
	const autoControlled = useRef(true);

	const kind = kindOf(run.name);
	const args = useMemo(() => resolveArgs(run), [run.args, run.argsStructured]);
	const detail = useMemo(
		() => headerDetail(kind, args, run.args),
		[kind, args, run.args],
	);
	const exit = useMemo(() => inferExitCode(run.output, run.status), [run.output, run.status]);
	const meta = statusMeta(kind, run, exit);
	const filePath = strArg(args, "path", "file_path", "file", "filePath");

	useEffect(() => {
		if (prevStatus.current === "running" && run.status !== "running" && autoControlled.current) {
			setOpen(false);
			setUiFlag(key, false);
		}
		prevStatus.current = run.status;
	}, [run.status, key]);

	const toggle = () => {
		autoControlled.current = false;
		const next = !open;
		setOpen(next);
		setUiFlag(key, next);
	};

	const borderTone =
		run.status === "error" || (kind === "bash" && exit !== null && exit !== 0)
			? "border-[#ff5555]/40 bg-[#2a1e28]"
			: run.status === "running"
				? "border-[#f1fa8c]/30 bg-[#21222c]"
				: "border-border/70 bg-[#21222c]";

	return (
		<div className={cn("overflow-hidden rounded-lg border", borderTone)}>
			<button
				type="button"
				className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left font-mono text-[10px]"
				onClick={toggle}
			>
				<ChevronRight
					className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
				/>
				{run.status === "running" ? (
					<Spinner />
				) : meta.tone === "error" ? (
					<span className="text-[#ff5555]">✗</span>
				) : (
					<span className="text-[#50fa7b]">✓</span>
				)}
				<span
					className={cn(
						"shrink-0 font-semibold",
						meta.tone === "error" ? "text-[#ffb3b3]" : "text-[#f8f8f2]",
					)}
				>
					{run.name}
				</span>
				{detail ? (
					<span className="min-w-0 flex-1 truncate text-muted-foreground" title={detail}>
						{detail}
					</span>
				) : (
					<span className="min-w-0 flex-1" />
				)}
				<span
					className={cn(
						"shrink-0 tabular-nums",
						meta.tone === "error"
							? "text-[#ff5555]"
							: meta.tone === "ok"
								? "text-[#50fa7b]/80"
								: "text-muted-foreground",
					)}
				>
					{meta.label}
				</span>
			</button>

			{open && (
				<>
					{kind === "other" && run.args ? (
						<pre className="m-0 whitespace-pre-wrap break-words border-t border-border/40 px-2.5 py-1 text-[10px] leading-relaxed text-muted-foreground">
							{run.args}
						</pre>
					) : null}
					{kind === "bash" && typeof args?.timeout === "number" ? (
						<div className="border-t border-border/40 px-2.5 py-0.5 text-[9px] text-muted-foreground">
							timeout {args.timeout}s
						</div>
					) : null}
					{run.status === "running" && !run.output ? (
						<div className="border-t border-border/40 px-2.5 py-1.5 text-[10px] text-muted-foreground">
							<span className="shimmer-text">Streaming output…</span>
						</div>
					) : (
						<OutputLines
							kind={kind}
							output={run.output}
							isError={run.status === "error"}
							filePath={filePath}
						/>
					)}
				</>
			)}
		</div>
	);
}
