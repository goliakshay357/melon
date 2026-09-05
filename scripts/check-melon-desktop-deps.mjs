/**
 * electron-builder installs node_modules from desktop/package.json only.
 * A runtime dep added to packages/melon-server but missing from desktop
 * ships DMGs that crash with ERR_MODULE_NOT_FOUND (see `diff`, 0.3.x).
 *
 * Fail CI before packaging if desktop is missing any melon-server dependency.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = JSON.parse(readFileSync(join(root, "packages/melon-server/package.json"), "utf8"));
const desktop = JSON.parse(readFileSync(join(root, "desktop/package.json"), "utf8"));

const serverDeps = server.dependencies ?? {};
const desktopDeps = desktop.dependencies ?? {};
const missing = Object.keys(serverDeps).filter((name) => !(name in desktopDeps));

if (missing.length > 0) {
	console.error(
		"melon-server dependencies must also be declared in desktop/package.json (electron-builder packaging):",
	);
	for (const name of missing) {
		console.error(`  missing ${name}@${serverDeps[name]} — add it to desktop/package.json dependencies`);
	}
	process.exit(1);
}

const mismatched = [];
for (const [name, serverSpec] of Object.entries(serverDeps)) {
	const desktopSpec = desktopDeps[name];
	// Workspace "*" in melon-server is pinned to a concrete version in desktop — OK.
	if (serverSpec === "*" || serverSpec === desktopSpec) continue;
	mismatched.push(`${name}: melon-server has ${serverSpec}, desktop has ${desktopSpec}`);
}

if (mismatched.length > 0) {
	console.error("melon-server and desktop dependency versions must match (except workspace '*'):");
	for (const line of mismatched) console.error(`  ${line}`);
	process.exit(1);
}

console.log("OK: desktop/package.json covers all melon-server runtime dependencies");

// pi-cursor-sdk declares its pi-* peers with "*" — npm does not install them,
// so dev works via repo-root node_modules while packaged DMGs crash with
// ERR_MODULE_NOT_FOUND. Everything it imports at runtime (deps + peers) must
// resolve from desktop/node_modules (electron-builder's packaging root).
const sdkPkg = JSON.parse(
	readFileSync(join(root, "desktop/node_modules/pi-cursor-sdk/package.json"), "utf8"),
);
const sdkRequires = {
	...(sdkPkg.dependencies ?? {}),
	...(sdkPkg.peerDependencies ?? {}),
};
const sdkMissing = [];
for (const name of Object.keys(sdkRequires)) {
	const inDesktopRoot = existsSync(join(root, "desktop/node_modules", name));
	const inSdkNested = existsSync(join(root, "desktop/node_modules/pi-cursor-sdk/node_modules", name));
	if (!inDesktopRoot && !inSdkNested) sdkMissing.push(name);
}
if (sdkMissing.length > 0) {
	console.error("pi-cursor-sdk runtime deps/peers must resolve from desktop/node_modules:");
	for (const name of sdkMissing) {
		console.error(`  missing ${name} — add it to desktop/package.json dependencies`);
	}
	process.exit(1);
}
console.log("OK: pi-cursor-sdk deps and peers resolve from desktop/node_modules");
