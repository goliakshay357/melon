import { create } from "zustand";

const STORAGE_KEY = "melon:developerDebugger";

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

interface DeveloperState {
	/** When true, card debugger chrome and Electron DevTools shortcuts are allowed. */
	debuggerEnabled: boolean;
	setDebuggerEnabled: (enabled: boolean) => void;
}

export const useDeveloperStore = create<DeveloperState>((set) => ({
	debuggerEnabled: readLocal(),
	setDebuggerEnabled: (enabled) => {
		writeLocal(enabled);
		set({ debuggerEnabled: enabled });
		notifyDesktop(enabled);
		void persistToServer(enabled);
	},
}));

export async function hydrateDeveloperFromServer(): Promise<void> {
	try {
		const res = await fetch("/settings", { cache: "no-store" });
		if (!res.ok) return;
		const data = (await res.json()) as { settings?: { developerDebugger?: unknown } };
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
			return;
		}

		writeLocal(disk);
		useDeveloperStore.setState({ debuggerEnabled: disk });
		notifyDesktop(disk);
	} catch {
		notifyDesktop(useDeveloperStore.getState().debuggerEnabled);
	}
}

/** Call once at startup so the desktop shell learns the current gate. */
export function initDeveloper(): void {
	notifyDesktop(useDeveloperStore.getState().debuggerEnabled);
	void hydrateDeveloperFromServer();
}
