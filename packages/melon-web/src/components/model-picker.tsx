import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/store/canvas-store";

interface ModelInfo {
	label: string;
	provider: string;
	id: string;
}

/**
 * Searchable model dropdown scoped to one provider, with recents pinned on top.
 * Calls GET /models?provider=X and GET /settings (recents).
 */
export function ModelPicker({
	value,
	onChange,
	open,
	onOpenChange,
	cardId,
}: {
	value: string;
	onChange: (model: string) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	cardId?: string;
}) {
	const onOpenChangeRef = useRef(onOpenChange);
	onOpenChangeRef.current = onOpenChange;
	const [query, setQuery] = useState("");
	const [models, setModels] = useState<ModelInfo[]>([]);
	const [catalogError, setCatalogError] = useState("");
	const [recents, setRecents] = useState<string[]>([]);
	const ref = useRef<HTMLDivElement>(null);

	const provider = value.split("/")[0] ?? "";

	useEffect(() => {
		let alive = true;
		setModels([]);
		setCatalogError("");
		fetch(`/models?provider=${encodeURIComponent(provider)}`)
			.then((r) => r.json())
			.then((d) => {
				if (!alive) return;
				setModels(d.models ?? []);
				if (provider === "cursor" && (d.models?.length ?? 0) === 0) {
					const detail = d.error ?? d.cursor?.issues?.[0] ?? "No Cursor models available";
					setCatalogError(detail);
					useCanvasStore.getState().logCursorDebug(cardId, [
						`model picker empty: ${detail}`,
						`loaded=${String(d.cursor?.loaded)} isolation=${String(d.cursor?.isolationAvailable)}`,
						...(d.cursor?.issues ?? []).slice(0, 5),
					]);
				}
			})
			.catch((e) => {
				if (!alive) return;
				const msg = e instanceof Error ? e.message : String(e);
				setCatalogError(msg);
				if (provider === "cursor") {
					useCanvasStore.getState().logCursorDebug(cardId, [`model picker fetch failed: ${msg}`]);
				}
			});
		return () => {
			alive = false;
		};
	}, [provider, cardId]);

	useEffect(() => {
		if (!open) return;
		fetch("/settings")
			.then((r) => r.json())
			.then((d) => setRecents(d.settings?.recentModels ?? []))
			.catch(() => {});
	}, [open]);

	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			const t = e.target as Element;
			if (ref.current && !ref.current.contains(t) && !t.closest?.("[data-melon-picker-root]"))
				onOpenChangeRef.current(false);
		};
		const onEsc = (e: KeyboardEvent) => {
			if (e.key === "Escape") onOpenChangeRef.current(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onEsc);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onEsc);
		};
	}, []);

	const select = (model: string) => {
		onChange(model);
		onOpenChange(false);
	};

	const q = query.trim().toLowerCase();
	const filtered = q ? models.filter((m) => m.label.toLowerCase().includes(q)) : models;
	const recentModels = recents.filter((r) => r.startsWith(`${provider}/`));
	const showRecents = !q && recentModels.length > 0;

	return (
		<div ref={ref} data-melon-picker-root className="relative">
			<button
				className="flex max-w-[170px] cursor-pointer items-center gap-1 truncate rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none transition-colors hover:text-foreground"
				title={`Model: ${value}`}
				onClick={(e) => {
					e.stopPropagation();
					onOpenChange(!open);
					setQuery("");
				}}
			>
				<span className="truncate">{value || "select model"}</span>
				<ChevronDown className="size-3 shrink-0" />
			</button>

			{open && (
				<div
					className="absolute bottom-full left-0 z-[50] mb-1 w-64 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
					onKeyDown={(e) => {
						if (e.key === "Escape") onOpenChangeRef.current(false);
						e.stopPropagation();
					}}
					onMouseDown={(e) => e.stopPropagation()}
				>
					<div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
						<Search className="size-3 text-muted-foreground" />
						<input
							autoFocus
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder={`Search ${provider} models…`}
							className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
						/>
					</div>

					<div className="nowheel nodrag max-h-56 overflow-y-auto py-1">
						{catalogError && (
							<p className="mx-1.5 mb-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-500/90">
								{catalogError}
							</p>
						)}
						{showRecents && (
							<>
								<p className="px-2 pb-0.5 pt-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
									Recent
								</p>
								{recentModels.map((r) => (
									<button
										key={`rec-${r}`}
										className={cn(
											"block w-full truncate px-2 py-1 text-left text-[11px] text-card-foreground hover:bg-secondary",
											r === value && "bg-primary/10 text-primary",
										)}
										onClick={() => select(r)}
									>
										{r}
									</button>
								))}
							</>
						)}

						<p className="px-2 pb-0.5 pt-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
							{q ? "Results" : "All models"}
						</p>
						{filtered.length === 0 && (
							<p className="px-2 py-1 text-[11px] text-muted-foreground">
								{catalogError || "No matches"}
							</p>
						)}
						{filtered.slice(0, 200).map((m) => (
							<button
								key={m.label}
								className={cn(
									"block w-full truncate px-2 py-1 text-left text-[11px] text-card-foreground hover:bg-secondary",
									m.label === value && "bg-primary/10 text-primary",
								)}
								onClick={() => select(m.label)}
							>
								{m.label}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
