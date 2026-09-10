// Resolve Melon's bundled ask_question extension entry for session runtimes.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const moduleDir = dirname(fileURLToPath(import.meta.url));
/** Absolute path to the Melon ask_question extension factory, or null if missing. */
export function melonAskQuestionExtensionPath() {
    const candidates = [
        join(moduleDir, "melon-ask-question-extension.js"),
        join(moduleDir, "melon-ask-question-extension.ts"),
    ];
    for (const path of candidates) {
        if (existsSync(path))
            return path;
    }
    return null;
}
//# sourceMappingURL=melon-ask-question.js.map