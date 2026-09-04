import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
		// Only the hand-written suites. Without this, the default glob also picks up
		// the compiled skill tests copied into dist/ by the build, which have no
		// registered suites and fail collection.
		include: ["test/**/*.test.ts"],
	},
});
