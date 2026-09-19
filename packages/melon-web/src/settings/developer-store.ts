import { create } from "zustand";

const STORAGE_KEY = "melon:developerDebugger";
const SESSION_JSON_KEY = "melon:developerSessionJson";

function readLocal(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

function writeLocal(enabled: boolean): void {
	try {
		localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
	} catch {
		/* private mode / locked storage */
	}
}

function notifyDesktop(enabled: boolean): void {
	const bridge = (
		window as unknown as {
			melonDesktop?: { setDeveloperDebugger?: (enabled: boolean) => void };
		}
	).melonDesktop;
	bridge?.setDeveloperDebugger?.(enabled);
}

async function persistToServer(enabled: boolean): Promise<void> {
	try {
		await fetch("/settings", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ developerDebugger: enabled }),
		});
	} catch {
		/* offline — localStorage still has it */
	}
}

async function persistSessionJsonToServer(enabled: boolean): Promise<void> {
	try {
		await fetch("/settings", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ developerSessionJson: enabled }),
		});
	} catch {
		/* offline — localStorage still has it */
	}
}

interface DeveloperState {
	/** When true, card debugger chrome and Electron DevTools shortcuts are allowed. */
	debuggerEnabled: boolean;
	setDebuggerEnabled: (enabled: boolean) => void;
	/** When true, chat cards show the raw session-JSON toggle. */
	sessionJsonEnabled: boolean;
	setSessionJsonEnabled: (enabled: boolean) => void;
}

function readSessionJson(): boolean {
	try {
		return localStorage.getItem(SESSION_JSON_KEY) === "1";
	} catch {
		return false;
	}
}

function writeSessionJson(enabled: boolean): void {
	try {
		localStorage.setItem(SESSION_JSON_KEY, enabled ? "1" : "0");
	} catch {
		/* private mode / locked storage */
	}
}

export const useDeveloperStore = create<DeveloperState>((set) => ({
	debuggerEnabled: readLocal(),
	setDebuggerEnabled: (enabled) => {
		writeLocal(enabled);
		set({ debuggerEnabled: enabled });
		notifyDesktop(enabled);
		void persistToServer(enabled);
	},
	sessionJsonEnabled: readSessionJson(),
	setSessionJsonEnabled: (enabled) => {
		writeSessionJson(enabled);
		set({ sessionJsonEnabled: enabled });
		void persistSessionJsonToServer(enabled);
	},
}));

export async function hydrateDeveloperFromServer(): Promise<void> {
	try {
		const res = await fetch("/settings", { cache: "no-store" });
		if (!res.ok) return;
		const data = (await res.json()) as { settings?: { developerDebugger?: unknown; developerSessionJson?: unknown } };
		const disk = data.settings?.developerDebugger === true;

		let localRaw: string | null = null;
		try {
			localRaw = localStorage.getItem(STORAGE_KEY);
		} catch {
			localRaw = null;
		}

		if (localRaw === "1" || localRaw === "0") {
			const local = localRaw === "1";
			if (useDeveloperStore.getState().debuggerEnabled !== local) {
				useDeveloperStore.setState({ debuggerEnabled: local });
			}
			notifyDesktop(local);
			if (disk !== local) await persistToServer(local);
		} else {
			writeLocal(disk);
			useDeveloperStore.setState({ debuggerEnabled: disk });
			notifyDesktop(disk);
		}
		// Session-JSON viewer: localStorage wins, mirroring the debugger gate.
		let jsonRaw: string | null = null;
		try {
			jsonRaw = localStorage.getItem(SESSION_JSON_KEY);
		} catch {
			jsonRaw = null;
		}
		if (jsonRaw === "1" || jsonRaw === "0") {
			const jsonLocal = jsonRaw === "1";
			if (useDeveloperStore.getState().sessionJsonEnabled !== jsonLocal) {
				useDeveloperStore.setState({ sessionJsonEnabled: jsonLocal });
			}
			if (data.settings?.developerSessionJson !== jsonLocal) {
				void persistSessionJsonToServer(jsonLocal);
			}
		} else {
			const jsonDisk = data.settings?.developerSessionJson === true;
			writeSessionJson(jsonDisk);
			useDeveloperStore.setState({ sessionJsonEnabled: jsonDisk });
		}
	} catch {
		notifyDesktop(useDeveloperStore.getState().debuggerEnabled);
	}
}

/** Call once at startup so the desktop shell learns the current gate. */
export function initDeveloper(): void {
	notifyDesktop(useDeveloperStore.getState().debuggerEnabled);
	void hydrateDeveloperFromServer();
}
