import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "dsh-plan-board";
export interface Config {
    stateDir: string;
    blockOnDrift: boolean;
    observeTools: boolean;
    enforceScope: boolean;
}
export declare const Config: z<Schemastery.ObjectS<{
    stateDir: z<string, string>;
    blockOnDrift: z<boolean, boolean>;
    observeTools: z<boolean, boolean>;
    enforceScope: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    stateDir: z<string, string>;
    blockOnDrift: z<boolean, boolean>;
    observeTools: z<boolean, boolean>;
    enforceScope: z<boolean, boolean>;
}>>;
type HostCtx = Context & {
    webServer?: {
        register(route: {
            kind: 'exact' | 'prefix';
            path: string;
            handler: (req: unknown, res: unknown) => void | Promise<void>;
        }): () => void;
        port?: number;
    };
    tools?: {
        register(tool: unknown): void;
    };
    logger?: {
        info(msg: string): void;
        warn(msg: string): void;
        error(msg: string): void;
    };
};
export declare function apply(ctx: HostCtx, config?: Partial<Config>): () => void;
export {};
