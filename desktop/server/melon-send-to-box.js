// Resolve Melon's bundled send_to_box extension entry for session runtimes.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const moduleDir = dirname(fileURLToPath(import.meta.url));
/** Absolute path to the Melon send_to_box extension factory, or null if missing. */
export function melonSendToBoxExtensionPath() {
    const candidates = [
        join(moduleDir, "melon-send-to-box-extension.js"),
        join(moduleDir, "melon-send-to-box-extension.ts"),
    ];
    for (const path of candidates) {
        if (existsSync(path))
            return path;
    }
    return null;
}
//# sourceMappingURL=melon-send-to-box.js.map