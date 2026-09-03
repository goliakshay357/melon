import { type FastifyInstance } from "fastify";
import { type MelonConfig } from "./config.ts";
/**
 * Product version shown in Settings and stamped into release artifacts.
 * Prefer MELON_VERSION (CI/local override), else the nearest package.json:
 * packaged Electron → desktop/package.json; standalone server → melon-server.
 */
export declare function readAppVersion(): string;
export interface MelonServerDeps {
    config?: Partial<MelonConfig>;
}
export declare function buildApp(deps?: MelonServerDeps): Promise<FastifyInstance>;
//# sourceMappingURL=index.d.ts.map