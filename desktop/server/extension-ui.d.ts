import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
export type ExtensionUiDialogMethod = "select" | "confirm" | "input";
/** SSE payload for a blocking dialog (shown above the card inbox). */
export type ExtensionUiEvent = {
    type: "extension_ui";
    id: string;
    method: "select";
    title: string;
    options: string[];
    timeout?: number;
} | {
    type: "extension_ui";
    id: string;
    method: "confirm";
    title: string;
    message: string;
    timeout?: number;
} | {
    type: "extension_ui";
    id: string;
    method: "input";
    title: string;
    placeholder?: string;
    timeout?: number;
} | {
    type: "extension_ui";
    id: string;
    method: "notify";
    message: string;
    notifyType?: "info" | "warning" | "error";
} | {
    type: "extension_ui_clear";
    id?: string;
};
/** Body for POST /sessions/:cardId/extension-ui */
export type ExtensionUiResponseBody = {
    id: string;
    value: string;
} | {
    id: string;
    confirmed: boolean;
} | {
    id: string;
    cancelled: true;
};
type DialogEvent = Extract<ExtensionUiEvent, {
    type: "extension_ui";
    method: ExtensionUiDialogMethod;
}>;
/**
 * Per-card bridge. `createUIContext()` returns a real ExtensionUIContext so
 * `ctx.hasUI` is true (runner compares against the shared no-op singleton).
 */
export declare class CardExtensionUiBridge {
    private readonly pending;
    readonly cardId: string;
    private readonly broadcast;
    /** Stable context for bindExtensions — same pending map for the card's life. */
    private uiContext;
    constructor(cardId: string, broadcast: (payload: ExtensionUiEvent) => void);
    /** Current blocking dialog, if any (for SSE reconnect replay). */
    getPendingEvent(): DialogEvent | undefined;
    respond(body: ExtensionUiResponseBody): boolean;
    /** Cancel every open dialog (Stop, agent abort, card teardown). */
    cancelAll(): void;
    /** Memoized UI context — safe to pass on every Cursor session rebind. */
    getUIContext(): ExtensionUIContext;
    createUIContext(): ExtensionUIContext;
}
export {};
//# sourceMappingURL=extension-ui.d.ts.map