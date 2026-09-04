// Melon extension UI bridge — maps pi's ExtensionUIContext (select/confirm/input)
// onto per-card SSE + HTTP, so any extension (Cursor ask_question, hooks, …)
// can pause for a user answer in the Melon chat card.
import { randomUUID } from "node:crypto";
/**
 * Per-card bridge. `createUIContext()` returns a real ExtensionUIContext so
 * `ctx.hasUI` is true (runner compares against the shared no-op singleton).
 */
export class CardExtensionUiBridge {
    pending = new Map();
    cardId;
    broadcast;
    /** Stable context for bindExtensions — same pending map for the card's life. */
    uiContext;
    constructor(cardId, broadcast) {
        this.cardId = cardId;
        this.broadcast = broadcast;
    }
    /** Current blocking dialog, if any (for SSE reconnect replay). */
    getPendingEvent() {
        const first = this.pending.values().next();
        return first.done ? undefined : first.value.event;
    }
    respond(body) {
        const entry = this.pending.get(body.id);
        if (!entry)
            return false;
        entry.settle(body);
        return true;
    }
    /** Cancel every open dialog (Stop, agent abort, card teardown). */
    cancelAll() {
        const entries = [...this.pending.values()];
        for (const entry of entries) {
            entry.settle({ id: entry.event.id, cancelled: true });
        }
    }
    /** Memoized UI context — safe to pass on every Cursor session rebind. */
    getUIContext() {
        if (!this.uiContext)
            this.uiContext = this.createUIContext();
        return this.uiContext;
    }
    createUIContext() {
        const broadcast = this.broadcast;
        const pending = this.pending;
        const createDialog = (opts, buildEvent, parse) => {
            const id = randomUUID();
            return new Promise((resolve) => {
                let settled = false;
                let timeoutId;
                const settle = (response) => {
                    if (settled)
                        return;
                    settled = true;
                    if (timeoutId)
                        clearTimeout(timeoutId);
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
            select: (title, options, opts) => createDialog(opts, (id) => ({ type: "extension_ui", id, method: "select", title, options, timeout: opts?.timeout }), (r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined)),
            confirm: (title, message, opts) => createDialog(opts, (id) => ({ type: "extension_ui", id, method: "confirm", title, message, timeout: opts?.timeout }), (r) => ("cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false)),
            input: (title, placeholder, opts) => createDialog(opts, (id) => ({
                type: "extension_ui",
                id,
                method: "input",
                title,
                placeholder,
                timeout: opts?.timeout,
            }), (r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined)),
            notify(message, type) {
                broadcast({
                    type: "extension_ui",
                    id: randomUUID(),
                    method: "notify",
                    message,
                    notifyType: type,
                });
            },
            onTerminalInput: () => () => { },
            setStatus: () => { },
            setWorkingMessage: () => { },
            setWorkingVisible: () => { },
            setWorkingIndicator: () => { },
            setHiddenThinkingLabel: () => { },
            setWidget: () => { },
            setFooter: () => { },
            setHeader: () => { },
            setTitle: () => { },
            custom: async () => undefined,
            pasteToEditor: () => { },
            setEditorText: () => { },
            getEditorText: () => "",
            editor: async () => undefined,
            addAutocompleteProvider: () => { },
            setEditorComponent: () => { },
            getEditorComponent: () => undefined,
            get theme() {
                // Melon never renders TUI themes from extension UI; satisfy the type.
                return {};
            },
            getAllThemes: () => [],
            getTheme: () => undefined,
            setTheme: () => ({ success: false, error: "Theme switching not supported in Melon" }),
            getToolsExpanded: () => false,
            setToolsExpanded: () => { },
        };
    }
}
//# sourceMappingURL=extension-ui.js.map