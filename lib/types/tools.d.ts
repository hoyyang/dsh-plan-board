import { StoreOpts, EventBroadcast } from './store.js';
export declare const TOOL_NAMES: readonly ["plan_map", "plan_edit", "plan_next", "task_update", "plan_link"];
export declare function registerBoardTools(tools: {
    register(tool: unknown): void;
}, stateDir: string, opts: StoreOpts, onEvent?: EventBroadcast, onOpen?: (project: string, name: string) => void): void;
