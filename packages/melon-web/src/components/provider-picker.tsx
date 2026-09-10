import { useEffect, useRef, useState } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { Check, ChevronDown, KeyRound, LogIn, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/store/canvas-store";

const CLAUDE_BRIDGE_PROVIDER_ID = "claude-bridge";
const ANTIGRAVITY_PROVIDER_ID = "antigravity";

const BROWSER_OAUTH_PROVIDERS: Record<
	string,
	{ loginPath: string; statusPath: string; cancelPath: string; title: string; opening: string; waiting: string; done: string }
> = {
	[CLAUDE_BRIDGE_PROVIDER_ID]: {
		loginPath: "/auth/claude-bridge/login",
		statusPath: "/auth/claude-bridge/login/status",
		cancelPath: "/auth/claude-bridge/login/cancel",
		title: "Log in with Claude",
		opening: "Opening Claude sign-in…",
		waiting: "Finish signing in in your browser. This window will update when you're done.",
		done: "Signed in with Claude.",
	},
	[ANTIGRAVITY_PROVIDER_ID]: {
		loginPath: "/auth/antigravity/login",
		statusPath: "/auth/antigravity/login/status",
		cancelPath: "/auth/antigravity/login/cancel",
		title: "Log in with Google (Antigravity)",
		opening: "Opening Google sign-in…",
		waiting: "Finish signing in in your browser. This window will update when you're done.",
		done: "Signed in with Antigravity.",
	},
};

interface ProviderInfo {
	id: string;
	provider: string;
	configured: boolean;
	source?: string;
	keyPreview?: string;
	authType?: string;
	error?: string;
}

type ModelsResponse = {
	models?: Array<{ label?: string }>;
	total?: number;
	error?: string;
	cursor?: {
		loaded?: boolean;
		isolationAvailable?: boolean;
		extensionPath?: string | null;
		modelCount?: number;
		issues?: string[];
	};
};

type BrowserLoginStatus = {
	phase?: "idle" | "awaiting_browser" | "done" | "error";
	url?: string;
	error?: string;
};

/**
 * Provider dropdown with configure/re-key inline (Radix dialog, no window.prompt).
 * Selecting a provider switches the card model to that provider's first model.
 */
export function ProviderPicker({
	model,
	onChange,
	open,
	onOpenChange,
	cardId,
}: {
	model: string;
	onChange: (model: string) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** When set, Cursor failures are written to this card's debug console. */
	cardId?: string;
}) {
	const onOpenChangeRef = useRef(onOpenChange);
	onOpenChangeRef.current = onOpenChange;
	const [providers, setProviders] = useState<ProviderInfo[]>([]);
	const [configuring, setConfiguring] = useState<ProviderInfo | null>(null);
	const [browserLoginProvider, setBrowserLoginProvider] = useState<string | null>(null);
	const [browserLoginBusy, setBrowserLoginBusy] = useState(false);
	const [browserLoginMessage, setBrowserLoginMessage] = useState("");
	const [key, setKey] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [selectError, setSelectError] = useState("");
	const ref = useRef<HTMLDivElement>(null);
	const browserPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const current = model.split("/")[0] ?? "";

	const load = () =>
		fetch("/auth/providers")
			.then((r) => r.json())
			.then(setProviders)
			.catch(() => {});

	const stopBrowserPoll = () => {
		if (browserPollRef.current) {
			clearInterval(browserPollRef.current);
			browserPollRef.current = null;
		}
	};

	useEffect(() => {
		load();
	}, []);

	useEffect(() => () => stopBrowserPoll(), []);

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

	const reportCursor = (lines: string[]) => {
		useCanvasStore.getState().logCursorDebug(cardId, lines);
	};

	const selectProvider = async (p: ProviderInfo) => {
		try {
			const res = (await fetch(`/models?provider=${encodeURIComponent(p.id)}`).then((r) =>
				r.json(),
			)) as ModelsResponse;
			const first = res.models?.[0];
			// A provider can be configured (key saved) yet expose no models in
			// the live catalog. Sending a malformed placeholder like "cursor/"
			// would only bounce off the server — keep the current model and say
			// why instead.
			if (!first || typeof first.label !== "string" || !first.label.includes("/")) {
				const detail =
					res.error ??
					res.cursor?.issues?.[0] ??
					p.error ??
					`No models available for ${p.id}`;
				setSelectError(detail);
				if (p.id === "cursor" || res.cursor) {
					reportCursor([
						`provider select failed for ${p.id}: ${detail}`,
						`loaded=${String(res.cursor?.loaded)} isolation=${String(res.cursor?.isolationAvailable)} modelCount=${String(res.cursor?.modelCount ?? res.total ?? 0)}`,
						...(res.cursor?.extensionPath ? [`extensionPath=${res.cursor.extensionPath}`] : []),
						...(res.cursor?.issues ?? []).slice(0, 5),
					]);
				}
				return;
			}
			setSelectError("");
			// Surface Cursor discovery fallbacks even when models exist (e.g. missing key).
			if (p.id === "cursor" && res.cursor?.issues && res.cursor.issues.length > 0) {
				reportCursor([
					`selected ${first.label} (catalog warnings follow)`,
					...res.cursor.issues.slice(0, 5),
				]);
			}
			onOpenChange(false);
			onChange(first.label);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setSelectError(msg);
			if (p.id === "cursor") reportCursor([`provider select network error: ${msg}`]);
		}
	};

	const saveKey = async () => {
		if (!configuring || !key.trim()) return;
		setSaving(true);
		setError("");
		try {
			const res = await fetch(`/auth/${configuring.id}/key`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ key: key.trim() }),
			});
			const d = (await res.json().catch(() => ({}))) as {
				error?: string;
				cursor?: ModelsResponse["cursor"];
			};
			if (!res.ok) {
				const err = d.error ?? "Failed to save key";
				setError(err);
				if (configuring.id === "cursor") {
					reportCursor([
						`save key failed: ${err}`,
						...(d.cursor?.issues ?? []),
					]);
				}
			} else {
				if (configuring.id === "cursor" && d.cursor?.issues?.length) {
					reportCursor([
						`key saved — catalog: loaded=${String(d.cursor.loaded)} models=${String(d.cursor.modelCount)}`,
						...d.cursor.issues.slice(0, 5),
					]);
				}
				setConfiguring(null);
				setKey("");
				load();
			}
		} catch {
			setError("Network error saving key");
			if (configuring.id === "cursor") reportCursor(["save key network error"]);
		} finally {
			setSaving(false);
		}
	};

	const removeKey = async (p: ProviderInfo) => {
		await fetch(`/auth/${p.id}`, { method: "DELETE" }).catch(() => {});
		load();
	};

	const startBrowserLogin = async (providerId: string) => {
		const cfg = BROWSER_OAUTH_PROVIDERS[providerId];
		if (!cfg) return;
		setBrowserLoginProvider(providerId);
		setBrowserLoginBusy(true);
		setBrowserLoginMessage(cfg.opening);
		setError("");
		onOpenChange(false);
		stopBrowserPoll();
		try {
			const res = await fetch(cfg.loginPath, { method: "POST" });
			const d = (await res.json().catch(() => ({}))) as {
				url?: string;
				error?: string;
				status?: BrowserLoginStatus;
			};
			if (!res.ok || !d.url) {
				setBrowserLoginBusy(false);
				setBrowserLoginMessage(d.error ?? `Could not start ${cfg.title}`);
				return;
			}
			window.open(d.url, "_blank", "noopener,noreferrer");
			setBrowserLoginMessage(cfg.waiting);
			browserPollRef.current = setInterval(async () => {
				try {
					const statusRes = await fetch(cfg.statusPath);
					const status = (await statusRes.json()) as BrowserLoginStatus;
					if (status.phase === "done") {
						stopBrowserPoll();
						setBrowserLoginBusy(false);
						setBrowserLoginMessage(cfg.done);
						load();
						setTimeout(() => setBrowserLoginProvider(null), 800);
					} else if (status.phase === "error") {
						stopBrowserPoll();
						setBrowserLoginBusy(false);
						setBrowserLoginMessage(status.error ?? `${cfg.title} failed`);
					}
				} catch {
					/* keep polling */
				}
			}, 1000);
		} catch (e) {
			setBrowserLoginBusy(false);
			setBrowserLoginMessage(e instanceof Error ? e.message : `Network error starting ${cfg.title}`);
		}
	};

	const cancelBrowserLogin = async () => {
		const cfg = browserLoginProvider ? BROWSER_OAUTH_PROVIDERS[browserLoginProvider] : undefined;
		stopBrowserPoll();
		if (cfg) await fetch(cfg.cancelPath, { method: "POST" }).catch(() => {});
		setBrowserLoginBusy(false);
		setBrowserLoginProvider(null);
		setBrowserLoginMessage("");
	};

	return (
		<div ref={ref} data-melon-picker-root className="relative">
			<button
				className="flex max-w-[140px] cursor-pointer items-center gap-1 truncate rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none transition-colors hover:text-foreground"
				title={`Provider: ${current || "none"}`}
				onClick={(e) => {
					e.stopPropagation();
					setSelectError("");
					onOpenChange(!open);
				}}
			>
				<Settings2 className="size-3 shrink-0" />
				<span className="truncate">{current || "provider"}</span>
				<ChevronDown className="size-3 shrink-0" />
			</button>

			{open && (
				<div
					className="nowheel nodrag absolute bottom-full left-0 z-[50] mb-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-xl"
					onKeyDown={(e) => {
						if (e.key === "Escape") onOpenChangeRef.current(false);
						e.stopPropagation();
					}}
					onMouseDown={(e) => e.stopPropagation()}
				>
					<p className="px-2 pb-0.5 pt-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
						Provider
					</p>
					{selectError && (
						<p className="mx-1.5 mb-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-500/90">
							{selectError}
						</p>
					)}
					{providers.map((p) => (
						<div key={p.id} className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-secondary">
							<button
								className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
								onClick={() => selectProvider(p)}
								title={p.error}
							>
								<span
									className={cn(
										"size-1.5 shrink-0 rounded-full",
										p.configured ? "bg-emerald-400" : "bg-muted-foreground/40",
									)}
								/>
								<span
									className={cn(
										"truncate text-[11px]",
										p.configured ? "text-card-foreground" : "text-muted-foreground",
									)}
								>
									{p.id}
								</span>
								{p.id === current && <Check className="size-3 shrink-0 text-primary" />}
							</button>
							{p.keyPreview && (
								<span className="shrink-0 text-[9px] text-muted-foreground">{p.keyPreview}</span>
							)}
							<button
								className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
								title={
									BROWSER_OAUTH_PROVIDERS[p.id]
										? p.configured
											? `Log out of ${p.id === ANTIGRAVITY_PROVIDER_ID ? "Antigravity" : "Claude"}`
											: BROWSER_OAUTH_PROVIDERS[p.id]!.title
										: p.configured
											? "Re-key"
											: "Configure key"
								}
								onClick={(e) => {
									e.stopPropagation();
									if (BROWSER_OAUTH_PROVIDERS[p.id]) {
										if (p.configured) {
											void removeKey(p);
										} else {
											void startBrowserLogin(p.id);
										}
										return;
									}
									setConfiguring(p);
									setKey("");
									setError("");
									onOpenChange(false);
								}}
							>
								{BROWSER_OAUTH_PROVIDERS[p.id] ? (
									<LogIn className="size-3" />
								) : (
									<KeyRound className="size-3" />
								)}
							</button>
						</div>
					))}
				</div>
			)}

			<RadixDialog.Root
				open={browserLoginProvider !== null}
				onOpenChange={(o) => {
					if (!o) void cancelBrowserLogin();
				}}
			>
				<RadixDialog.Portal>
					<RadixDialog.Overlay className="fixed inset-0 z-[1000] bg-black/60" />
					<RadixDialog.Content
						className="fixed left-1/2 top-1/2 z-[1001] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl focus:outline-none"
						onKeyDown={(e) => e.stopPropagation()}
					>
						<RadixDialog.Title className="text-sm font-semibold text-card-foreground">
							{(browserLoginProvider && BROWSER_OAUTH_PROVIDERS[browserLoginProvider]?.title) ||
								"Browser sign-in"}
						</RadixDialog.Title>
						<RadixDialog.Description className="mt-2 text-xs text-muted-foreground">
							{browserLoginMessage || "Sign in in your browser."}
						</RadixDialog.Description>
						<div className="mt-4 flex justify-end gap-2">
							<button
								className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
								onClick={() => void cancelBrowserLogin()}
							>
								{browserLoginBusy ? "Cancel" : "Close"}
							</button>
						</div>
					</RadixDialog.Content>
				</RadixDialog.Portal>
			</RadixDialog.Root>

			<RadixDialog.Root
				open={configuring !== null}
				onOpenChange={(o) => {
					if (!o) setConfiguring(null);
				}}
			>
				<RadixDialog.Portal>
					<RadixDialog.Overlay className="fixed inset-0 z-[1000] bg-black/60" />
					<RadixDialog.Content
						className="fixed left-1/2 top-1/2 z-[1001] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl focus:outline-none"
						onKeyDown={(e) => e.stopPropagation()}
					>
						<RadixDialog.Title className="text-sm font-semibold text-card-foreground">
							{configuring?.configured ? "Re-key" : "Configure"} {configuring?.id}
						</RadixDialog.Title>
						<RadixDialog.Description className="sr-only">
							Enter an API key for this provider.
						</RadixDialog.Description>

						<input
							autoFocus
							type="password"
							value={key}
							onChange={(e) => setKey(e.target.value)}
							placeholder="API key"
							className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
							onKeyDown={(e) => {
								if (e.key === "Enter") saveKey();
							}}
						/>
						{error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
						{configuring?.configured && (
							<button
								className="mt-2 text-[11px] text-red-400 hover:underline"
								onClick={async () => {
									await removeKey(configuring);
									setConfiguring(null);
								}}
							>
								Remove key
							</button>
						)}

						<div className="mt-4 flex justify-end gap-2">
							<button
								className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
								onClick={() => setConfiguring(null)}
							>
								Cancel
							</button>
							<button
								disabled={saving || !key.trim()}
								className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
								onClick={saveKey}
							>
								{saving ? "Saving…" : "Save key"}
							</button>
						</div>
					</RadixDialog.Content>
				</RadixDialog.Portal>
			</RadixDialog.Root>
		</div>
	);
}
