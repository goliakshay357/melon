import { useEffect, useRef } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Full pi level list — shown before a card's session attaches. The server's
 * per-model list (which clamps to what the model actually supports) replaces
 * it on attach and on every thinking_level SSE frame.
 */
const ALL_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const LEVEL_HINTS: Record<string, string> = {
	off: "No reasoning",
	minimal: "Barely any reasoning",
	low: "Light reasoning",
	medium: "Balanced reasoning",
	high: "Deep reasoning",
	xhigh: "Very deep reasoning",
	max: "Maximum reasoning",
};

/**
 * Thinking-level dropdown for the composer. Levels are per session and apply
 * from the agent's next streaming call — mid-turn changes are picked up at
 * the next turn boundary without restarting anything.
 */
export function ThinkingPicker({
	value,
	levels,
	onChange,
	open,
	onOpenChange,
}: {
	value?: string;
	levels?: string[];
	onChange: (level: string) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const onOpenChangeRef = useRef(onOpenChange);
	onOpenChangeRef.current = onOpenChange;
	const ref = useRef<HTMLDivElement>(null);

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

	// Attached to a model with a single (non-reasoning) level — nothing to pick.
	const hide = levels != null && levels.length <= 1;
	if (hide) return null;
	const available = levels && levels.length > 0 ? levels : ALL_LEVELS;
	const current = value ?? "auto";

	return (
		<div ref={ref} data-melon-picker-root className="relative">
			<button
				className="flex cursor-pointer items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none transition-colors hover:text-foreground"
				title="Thinking level — applies from the next AI response, even mid-task"
				onClick={(e) => {
					e.stopPropagation();
					onOpenChange(!open);
				}}
			>
				<Brain className="size-3 shrink-0" />
				<span>{current}</span>
				<ChevronDown className="size-3 shrink-0" />
			</button>

			{open && (
				<div
					className="absolute bottom-full left-0 z-[50] mb-1 w-52 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-xl"
					onKeyDown={(e) => {
						if (e.key === "Escape") onOpenChangeRef.current(false);
						e.stopPropagation();
					}}
					onMouseDown={(e) => e.stopPropagation()}
				>
					{available.map((level) => (
						<button
							key={level}
							className={cn(
								"block w-full px-2 py-1 text-left text-[11px] text-card-foreground hover:bg-secondary",
								level === value && "bg-primary/10 text-primary",
							)}
							onClick={() => {
								onChange(level);
								onOpenChange(false);
							}}
						>
							<span className="font-medium">{level}</span>
							<span className="ml-1.5 text-[10px] text-muted-foreground">{LEVEL_HINTS[level] ?? ""}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
