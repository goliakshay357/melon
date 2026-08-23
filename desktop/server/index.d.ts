import { type FastifyInstance } from "fastify";
import { type MelonConfig } from "./config.ts";
export interface MelonServerDeps {
    config?: Partial<MelonConfig>;
}
export declare function buildApp(deps?: MelonServerDeps): Promise<FastifyInstance>;
//# sourceMappingURL=index.d.ts.map