/**
 * HTTP 传输面（host half）：/_dsh/dsh-plan-board/ 前缀路由。
 * 门禁（沿用 dsh-session-manager / dsh-android-pane 实测纪律）：
 * 仅 loopback 对端；变更类 POST 追加同源校验；JSON 体上限 64KB；错误一律 {ok:false,error:{code,message}}。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StoreOpts } from './store.js';
export declare const ROUTE_PREFIX = "/_dsh/dsh-plan-board";
export interface GuardLike {
    isSuspended(): boolean;
    setSuspended(v: boolean): boolean;
    state(): {
        suspended: boolean;
        enforceScope: boolean;
    };
}
export declare class BoardRegistry {
    readonly stateDir: string;
    readonly opts: StoreOpts;
    readonly subscribers: Set<(msg: unknown) => void>;
    /** L7 拦截器（index.ts 装配后挂入；路由层负责挂起开关与状态展示）。 */
    guard: GuardLike | null;
    /** PlanStore 广播入口：事件 → 所有 /stream 订阅者。 */
    readonly onEvent: (project: string, ev: unknown) => void;
    broadcast(msg: unknown): void;
    constructor(stateDir: string, opts: StoreOpts);
    projects(): Record<string, {
        name: string;
        at: string;
    }>;
    remember(project: string, name: string): void;
    /** L7 观测面：非本插件工具调用全量留痕（tool-calls.jsonl，仅名称+agent，不落参数）。 */
    observeToolCall(toolName: string, agent: string): void;
}
export declare function mountRoutes(webServer: {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}, registry: BoardRegistry): () => void;
