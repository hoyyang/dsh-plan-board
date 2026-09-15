import { StoreOpts, EventBroadcast } from './store.js';
export interface GuardOpts {
    stateDir: string;
    enforceScope: boolean;
    storeOpts: StoreOpts;
    onEvent?: EventBroadcast;
    log?: (msg: string) => void;
}
export type PreDecision = {
    kind: 'allow';
} | {
    kind: 'deny';
    reason: string;
};
export declare class ScopeGuard {
    private readonly opts;
    private suspended;
    /** 项目 → doing 任务快照缓存（2s 节流；L1 单发号硬锁保证每板至多 1 个 doing）。 */
    private cache;
    private lastEventAt;
    constructor(opts: GuardOpts);
    isSuspended(): boolean;
    setSuspended(v: boolean): boolean;
    state(): {
        suspended: boolean;
        enforceScope: boolean;
    };
    /** 主入口：同步判定（全部为本地文件读 + 内存匹配，2s 缓存节流）。永不 throw。 */
    decide(toolName: string, args: unknown, agentId: string | undefined): PreDecision | null;
    /** doing 任务快照：候选项目 = projects.json 记忆 + stateDir/default（工具缺省板）。 */
    private doingTasks;
    /** guard 事件落板（节流防刷屏；面板经 /stream 实时可见）。 */
    private throttledEvent;
}
/** scope 路径前缀匹配（与 gitwatch.scopeHit 语义一致：条目=路径前缀，目录以 / 结尾；支持相对 scope 按项目根解析）。 */
export declare function scopePathHit(filePath: string, scope: string[], projectDir: string): string;
