/** Mirror of pi's `ConfiguredPackage` (not re-exported by the package root). */
interface ConfiguredPackage {
    source: string;
    scope: "user" | "project";
    filtered: boolean;
    installedPath?: string;
}
export declare function loadWebSearchConfig(): Record<string, unknown>;
/** Merge a partial config over the existing web-search.json. */
export declare function saveWebSearchConfig(patch: Record<string, unknown>): Record<string, unknown>;
export declare function listPackages(): ConfiguredPackage[];
export declare function installPackage(source: string): Promise<ConfiguredPackage[]>;
export declare function removePackage(source: string): Promise<{
    removed: boolean;
    packages: ConfiguredPackage[];
}>;
export declare function updatePackages(source?: string): Promise<ConfiguredPackage[]>;
export {};
//# sourceMappingURL=extensions.d.ts.map