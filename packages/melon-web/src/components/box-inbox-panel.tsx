import type { BoxInboxItem, BoxMailReplyPolicy } from "@/types/session-card";
import { useCanvasStore } from "@/store/canvas-store";
import { Inbox, X } from "lucide-react";

function policyBadge(policy: BoxMailReplyPolicy | undefined): string | null {
	if (!policy) return null;
	if (policy === "never") return "no reply";
	if (policy === "always_result") return "result expected";
	return "if needed";
}

function InboxItemRow({ cardId, item }: { cardId: string; item: BoxInboxItem }) {
	const policy = policyBadge(item.envelope?.replyPolicy);
	return (
		<li className="rounded-md border border-border/80 bg-background/60 px-2.5 py-2">
			<div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
				<span className="min-w-0 truncate font-medium text-card-foreground/80">From {item.fromTitle}</span>
				<span className="ml-auto flex shrink-0 items-center gap-1">
					{policy ? (
						<span className="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">{policy}</span>
					) : null}
					<span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-600">
						needs approve{item.autoApproved ? " · auto" : ""}
					</span>
				</span>
			</div>
			<p className="whitespace-pre-wrap break-words text-[12px] leading-snug text-card-foreground">{item.body}</p>
			<div className="mt-2 flex gap-2">
				<button
					type="button"
					className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
					onClick={(e) => {
						e.stopPropagation();
						void useCanvasStore.getState().approveBoxInbox(cardId, item.id);
					}}
				>
					Approve for agent
				</button>
				<button
					type="button"
					className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary"
					onClick={(e) => {
						e.stopPropagation();
						void useCanvasStore.getState().dismissBoxInbox(cardId, item.id);
					}}
				>
					Dismiss
				</button>
			</div>
		</li>
	);
}

/** Temporary pending tray — no sent/delivered history. */
export function BoxInboxPanel({
	cardId,
	items,
	onClose,
}: {
	cardId: string;
	items: BoxInboxItem[];
	onClose: () => void;
}) {
	const pending = items
		.filter((i) => i.direction === "in" && i.status === "pending")
		.slice()
		.reverse();

	return (
		<div className="nodrag z-20 flex max-h-[min(360px,55%)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg">
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
				<Inbox className="size-3.5 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate text-xs font-medium text-card-foreground">
					Inbox{pending.length > 0 ? ` · ${pending.length} pending` : ""}
				</span>
				<button
					type="button"
					className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
					onClick={(e) => {
						e.stopPropagation();
						onClose();
					}}
					title="Close inbox"
				>
					<X className="size-3.5" />
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{pending.length === 0 ? (
					<p className="px-1 py-3 text-center text-[11px] text-muted-foreground">
						No pending mail. Approved messages go straight into chat and leave the inbox.
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						{pending.map((item) => (
							<InboxItemRow key={item.id} cardId={cardId} item={item} />
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
