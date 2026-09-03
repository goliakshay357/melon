export async function pickFolder(): Promise<string | null> {
	const bridge = (
		window as unknown as {
			melonDesktop?: { pickFolder: () => Promise<string | null> };
		}
	).melonDesktop;
	if (bridge?.pickFolder) return bridge.pickFolder();

	const response = await fetch("/pick-folder", { method: "POST" });
	if (!response.ok) return null;
	const data = (await response.json()) as { path?: string };
	return data.path ?? null;
}
