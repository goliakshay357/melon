import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Developer JSON tree with multi-select copy:
 *
 * - Click a primitive value → toggles it into the selection (highlight + count)
 * - Click an object/array key → toggles that whole node
 * - "Copy N" copies only the selected values as [{ path, value }] JSON
 * - "All" copies the entire payload
 *
 * Long strings truncate visually but copy in full. Font is deliberately small
 * (9px mono) and everything wraps inside the block — no horizontal overflow.
 */

function JsonNode({
	name,
	path,
	value,
	depth,
	selected,
	onToggle,
}: {
	name?: string;
	path: string;
	value: unknown;
	depth: number;
	selected: Set<string>;
	onToggle: (path: string, value: unknown) => void;
}) {
	const isObj = value !== null && typeof value === 'object';
	const [open, setOpen] = useState(depth < 1);
	const isSel = selected.has(path);

	const entries = useMemo(() => {
		if (!isObj) return [] as Array<[string, unknown]>;
		return Array.isArray(value)
			? (value as unknown[]).map((v, i) => [`${path}[${i}]`, v] as [string, unknown])
			: Object.entries(value as Record<string, unknown>).map(([k, v]) => [`${path}.${k}`, v] as [string, unknown]);
	}, [isObj, value, path]);

	if (!isObj) {
		return (
			<div className="flex min-w-0 items-baseline gap-1 py-px" style={{ paddingLeft: depth * 10 + 6 }}>
				{name !== undefined && (
					<span className="shrink-0 font-mono text-muted-foreground">{name}:</span>
				)}
				<button
					type="button"
					onClick={() => onToggle(path, value)}
					className={cn(
						'min-w-0 cursor-pointer truncate rounded px-1 text-left font-mono leading-relaxed transition-colors',
						isSel
							? 'bg-primary/20 text-primary ring-1 ring-inset ring-primary/50'
							: 'text-card-foreground hover:bg-primary/10',
					)}
					title={isSel ? 'Selected — click to remove' : 'Click to select for copy'}
				>
					{value === null ? 'null' : typeof value === 'string' ? `"${value}"` : String(value)}
				</button>
			</div>
		);
	}

	return (
		<div className="min-w-0">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex min-w-0 items-center gap-1 rounded px-1 py-px text-left transition-colors hover:bg-secondary/60"
				style={{ paddingLeft: depth * 10 + 2 }}
			>
				<span className={cn('shrink-0 font-mono text-muted-foreground', open && 'rotate-90')} style={{ fontSize: '0.85em' }}>
					▶
				</span>
				<span
					className={cn(
						'shrink-0 cursor-pointer rounded px-0.5 font-mono transition-colors',
						isSel
							? 'bg-primary/20 text-primary ring-1 ring-inset ring-primary/50'
							: 'text-muted-foreground hover:text-foreground',
					)}
					title={isSel ? 'Selected — click to remove' : 'Click to select this whole node'}
					onClick={(e) => {
						e.stopPropagation();
						onToggle(path, value);
					}}
				>
					{name !== undefined ? `${name}:` : Array.isArray(value) ? '[]' : '{}'}
				</span>
				<span className="shrink-0 font-mono text-muted-foreground/50" style={{ fontSize: '0.85em' }}>
					{Array.isArray(value) ? `${(value as unknown[]).length} items` : `${entries.length} keys`}
				</span>
			</button>
			{open && (
				<div className="min-w-0 border-l border-border/40">
					{entries.map(([p, v]) => (
						<JsonNode
							key={p}
							name={p.slice(path.length + 1) || p}
							path={p}
							value={v}
							depth={depth + 1}
							selected={selected}
							onToggle={onToggle}
						/>
					))}
				</div>
			)}
		</div>
	);
}

/** Expandable JSON tree with multi-select copy. `fontSize` (px) drives the
 * whole tree via inline style so it cannot be overridden by cached CSS. */
export function JsonTreeView({
	value,
	className,
	fontSize = 9,
}: {
	value: unknown;
	className?: string;
	fontSize?: number;
}) {
	const [open, setOpen] = useState(true);
	const [selected, setSelected] = useState<Map<string, unknown>>(new Map());
	const [flash, setFlash] = useState(false);
	const selectedKeys = useMemo(() => new Set(selected.keys()), [selected]);
	const pretty = useMemo(() => JSON.stringify(value, null, 2), [value]);

	const toggle = (path: string, v: unknown) => {
		setSelected((prev) => {
			const next = new Map(prev);
			if (next.has(path)) next.delete(path);
			else next.set(path, v);
			return next;
		});
	};

	const copySelected = () => {
		const items = [...selected.entries()].map(([p, v]) => ({ path: p, value: v }));
		if (items.length === 0) return;
		// Single value copies bare (drop the wrapper); several → [{ path, value }].
		const payload = items.length === 1 ? items[0].value : items;
		void navigator.clipboard
			.writeText(JSON.stringify(payload, null, 2))
			.then(() => {
				setFlash(true);
				setTimeout(() => setFlash(false), 900);
			})
			.catch(() => {});
	};

	return (
		<div className={cn('min-w-0 rounded-md bg-secondary/50', className)}>
			<div className="flex items-center gap-2 overflow-hidden px-2 py-1">
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
				>
					{open ? 'collapse' : 'expand'}
				</button>
				<span
					className={cn(
						'shrink-0 rounded px-1 text-[9px] tabular-nums transition-colors',
						selected.size > 0 ? 'bg-primary/20 text-primary' : 'text-muted-foreground/50',
					)}
					title="Values selected for copy"
				>
					{selected.size} selected
				</span>
				<span className="min-w-0 flex-1" />
				<button
					type="button"
					disabled={selected.size === 0}
					onClick={copySelected}
					className={cn(
						'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide transition-colors',
						selected.size > 0 ? 'bg-primary/20 text-primary hover:bg-primary/30' : 'text-muted-foreground/40',
					)}
					title="Copy only the selected values as [{ path, value }]"
				>
					{flash ? '✓' : 'copy'}
					{selected.size > 0 ? ` ${selected.size}` : ''}
				</button>
				<button
					type="button"
					disabled={selected.size === 0}
					onClick={() => setSelected(new Map())}
					className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground/50 transition-colors hover:text-foreground disabled:opacity-40"
					title="Clear selection"
				>
					clear
				</button>
				<button
					type="button"
					onClick={() => {
						void navigator.clipboard.writeText(pretty).catch(() => {});
					}}
					className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
					title="Copy entire JSON"
				>
					all
				</button>
			</div>
			{open && (
				<div
					className="nodrag nowheel max-h-96 min-w-0 overflow-x-hidden overflow-y-auto px-2 pb-2 font-mono leading-relaxed"
					style={{ scrollbarWidth: 'thin', fontSize }}
				>
					<JsonNode path="$" value={value} depth={0} selected={selectedKeys} onToggle={toggle} />
				</div>
			)}
		</div>
	);
}