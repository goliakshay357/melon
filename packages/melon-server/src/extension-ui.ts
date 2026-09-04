// Melon extension UI bridge — maps pi's ExtensionUIContext (select/confirm/input)
// onto per-card SSE + HTTP, so any extension (Cursor ask_question, hooks, …)
// can pause for a user answer in the Melon chat card.

import { randomUUID } from "node:crypto";
import type { ExtensionUIContext, ExtensionUIDialogOptions, Theme } from "@earendil-works/pi-coding-agent";

export type ExtensionUiDialogMethod = "select" | "confirm" | "input";

/** SSE payload for a blocking dialog (shown above the card inbox). */
export type ExtensionUiEvent =
	| {
			type: "extension_ui";
			id: string;
			method: "select";
			title: string;
			options: string[];
			timeout?: number;
	  }
	| {
			type: "extension_ui";
			id: string;
			method: "confirm";
			title: string;
			message: string;
			timeout?: number;
	  }
	| {
			type: "extension_ui";
			id: string;
			method: "input";
			title: string;
			placeholder?: string;
			timeout?: number;
	  }
	| {
			type: "extension_ui";
			id: string;
			method: "notify";
			message: string;
			notifyType?: "info" | "warning" | "error";
	  }
	| { type: "extension_ui_clear"; id?: string };

/** Body for POST /sessions/:cardId/extension-ui */
export type ExtensionUiResponseBody =
	| { id: string; value: string }
	| { id: string; confirmed: boolean }
	| { id: string; cancelled: true };

type DialogEvent = Extract<ExtensionUiEvent, { type: "extension_ui"; method: ExtensionUiDialogMethod }>;

type PendingEntry = {
	settle: (response: ExtensionUiResponseBody) => void;
	event: DialogEvent;
};

/**
 * Per-card bridge. `createUIContext()` returns a real ExtensionUIContext so
 * `ctx.hasUI` is true (runner compares against the shared no-op singleton).
 */
export class CardExtensionUiBridge {
	private readonly pending = new Map<string, PendingEntry>();
	readonly cardId: string;
	private readonly broadcast: (payload: ExtensionUiEvent) => void;
	/** Stable context for bindExtensions — same pending map for the card's life. */
	private uiContext: ExtensionUIContext | undefined;

	constructor(cardId: string, broadcast: (payload: ExtensionUiEvent) => void) {
		this.cardId = cardId;
		this.broadcast = broadcast;
	}

	/** Current blocking dialog, if any (for SSE reconnect replay). */
	getPendingEvent(): DialogEvent | undefined {
		const first = this.pending.values().next();
		return first.done ? undefined : first.value.event;
	}

	respond(body: ExtensionUiResponseBody): boolean {
		const entry = this.pending.get(body.id);
		if (!entry) return false;
		entry.settle(body);
		return true;
	}

	/** Cancel every open dialog (Stop, agent abort, card teardown). */
	cancelAll(): void {
		const entries = [...this.pending.values()];
		for (const entry of entries) {
			entry.settle({ id: entry.event.id, cancelled: true });
		}
	}

	/** Memoized UI context — safe to pass on every Cursor session rebind. */
	getUIContext(): ExtensionUIContext {
		if (!this.uiContext) this.uiContext = this.createUIContext();
		return this.uiContext;
	}

	createUIContext(): ExtensionUIContext {
		const broadcast = this.broadcast;
		const pending = this.pending;

		const createDialog = <T>(
			opts: ExtensionUIDialogOptions | undefined,
			buildEvent: (id: string) => DialogEvent,
			parse: (response: ExtensionUiResponseBody) => T,
		): Promise<T> => {
			const id = randomUUID();
			return new Promise<T>((resolve) => {
				let settled = false;
				let timeoutId: ReturnType<typeof setTimeout> | undefined;

				const settle = (response: ExtensionUiResponseBody) => {
					if (settled) return;
					settled = true;
					if (timeoutId) clearTimeout(timeoutId);
					opts?.signal?.removeEventListener("abort", onAbort);
					pending.delete(id);
					broadcast({ type: "extension_ui_clear", id });
					resolve(parse(response));
				};

				const onAbort = () => settle({ id, cancelled: true });
				opts?.signal?.addEventListener("abort", onAbort, { once: true });

				if (opts?.timeout) {
					timeoutId = setTimeout(() => settle({ id, cancelled: true }), opts.timeout);
				}

				const event = buildEvent(id);
				pending.set(id, { settle, event });
				broadcast(event);
			});
		};

		return {
			select: (title, options, opts) =>
				createDialog(
					opts,
					(id) => ({ type: "extension_ui", id, method: "select", title, options, timeout: opts?.timeout }),
					(r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
				),

			confirm: (title, message, opts) =>
				createDialog(
					opts,
					(id) => ({ type: "extension_ui", id, method: "confirm", title, message, timeout: opts?.timeout }),
					(r) => ("cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false),
				),

			input: (title, placeholder, opts) =>
				createDialog(
					opts,
					(id) => ({
						type: "extension_ui",
						id,
						method: "input",
						title,
						placeholder,
						timeout: opts?.timeout,
					}),
					(r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
				),

			notify(message: string, type?: "info" | "warning" | "error"): void {
				broadcast({
					type: "extension_ui",
					id: randomUUID(),
					method: "notify",
					message,
					notifyType: type,
				});
			},

			onTerminalInput: () => () => {},
			setStatus: () => {},
			setWorkingMessage: () => {},
			setWorkingVisible: () => {},
			setWorkingIndicator: () => {},
			setHiddenThinkingLabel: () => {},
			setWidget: () => {},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: () => {},
			custom: async () => undefined as never,
			pasteToEditor: () => {},
			setEditorText: () => {},
			getEditorText: () => "",
			editor: async () => undefined,
			addAutocompleteProvider: () => {},
			setEditorComponent: () => {},
			getEditorComponent: () => undefined,
			get theme() {
				// Melon never renders TUI themes from extension UI; satisfy the type.
				return {} as Theme;
			},
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: false, error: "Theme switching not supported in Melon" }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		};
	}
}
