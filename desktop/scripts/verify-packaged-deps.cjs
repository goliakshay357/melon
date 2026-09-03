#!/usr/bin/env node
/**
 * Verify packaged server runtime deps exist inside an app.asar.
 * Usage: node scripts/verify-packaged-deps.cjs <app.asar> [<app.asar> ...]
 *
 * Why this exists: electron-builder packages node_modules ONLY from the app
 * root manifest (desktop/package.json). A runtime dep added to
 * packages/melon-server but not to desktop ships installers that crash with
 * ERR_MODULE_NOT_FOUND on first launch (diff, 0.3.x).
 *
 * Note: @electron/asar's listPackage() builds entry paths with path.join,
 * which yields backslashes on Windows — normalize before matching.
 */
"use strict";
const asar = require("@electron/asar");

const REQUIRED = ["diff", "fastify", "@earendil-works/pi-coding-agent"];
const asarPaths = process.argv.slice(2);

if (asarPaths.length === 0) {
	console.error("usage: verify-packaged-deps.cjs <app.asar> [<app.asar> ...]");
	process.exit(2);
}

let failed = false;
for (const asarPath of asarPaths) {
	const files = asar
		.listPackage(asarPath)
		.map(String)
		.map((f) => f.replace(/\\/g, "/"));
	const nm = files.filter((f) => f.startsWith("/node_modules/")).length;
	console.log(`${asarPath}: ${files.length} entries, ${nm} node_modules entries`);
	if (nm === 0) {
		console.error(`FAIL: no node_modules in ${asarPath}; sample: ${files.slice(0, 10).join(" | ")}`);
		failed = true;
		continue;
	}
	const missing = REQUIRED.filter((d) => !files.includes(`/node_modules/${d}/package.json`));
	if (missing.length > 0) {
		console.error(`FAIL: missing from ${asarPath}: ${missing.join(", ")}`);
		failed = true;
		continue;
	}
	console.log(`OK: required server deps present in ${asarPath}`);
}

process.exit(failed ? 1 : 0);
