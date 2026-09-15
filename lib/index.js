/**
 * @dsh-external/dsh-plan-board — host 入口（hybrid：5 工具 + 路由 + L7 工具观测；无 module 级副作用）。
 * 生命周期：apply 注入 webServer/tools → 建注册表 → 挂路由/工具/事件监听 → 返回 dispose；
 * 卸载即净（门 4）：路由注销、工具注销、事件监听摘除。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { mountRoutes, BoardRegistry, ROUTE_PREFIX } from './routes.js';
import { registerBoardTools, TOOL_NAMES } from './tools.js';
import { ScopeGuard } from './guard.js';
export const name = 'dsh-plan-board';
export const Config = z.object({
    stateDir: z.string().default('').description('注册表目录（缺省 <DSH_HOME>/dsh-plan-board）'),
    blockOnDrift: z.boolean().default(true).description('L5 漂移阻断：git 交叉核对不匹配时拒绝发号，直到人在面板处置'),
    observeTools: z.boolean().default(true).description('L7 工具观测：记录会话内全部工具调用（不含参数）到 tool-calls.jsonl'),
    enforceScope: z.boolean().default(true).description('L7 越界拦截：write/edit 路径未命中 doing 任务 scope 时拒绝执行（面板可临时挂起）'),
});
export function apply(ctx, config = {}) {
    const opts = { blockOnDrift: config.blockOnDrift ?? true };
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    const stateDir = config.stateDir !== undefined && config.stateDir !== '' ? config.stateDir : join(dshHome, 'dsh-plan-board');
    let disposed = false;
    const cleanups = [];
    ctx.inject(['webServer', 'tools'], (hostCtx) => {
        const host = hostCtx;
        if (host.webServer == null)
            throw new Error('dsh-plan-board 需要 webServer 服务（web profile 才提供）');
        if (host.tools == null)
            throw new Error('dsh-plan-board 需要 tools 服务');
        const log = (msg) => {
            try {
                host.logger?.info?.('[dsh-plan-board] ' + msg);
            }
            catch { /* logger 缺失不致命 */ }
        };
        const registry = new BoardRegistry(stateDir, opts);
        const guard = new ScopeGuard({
            stateDir,
            enforceScope: config.enforceScope !== false,
            storeOpts: opts,
            onEvent: registry.onEvent,
            log,
        });
        registry.guard = guard;
        cleanups.push(mountRoutes(host.webServer, registry));
        registerBoardTools(host.tools, stateDir, opts, registry.onEvent, (p, n) => registry.remember(p, n));
        log('routes ready: ' + ROUTE_PREFIX + ' | blockOnDrift=' + String(opts.blockOnDrift) + ' | enforceScope=' + String(config.enforceScope !== false));
        // L7 阻断级：tools/pre-execute 越界拦截（deny 短路具名理由；其余一律 next() 保持瀑布链）
        const evCtx = ctx;
        const offPre = evCtx.on('tools/pre-execute', async (exec, next) => {
            try {
                const d = guard.decide(exec.name, exec.arguments, exec.agent?.id);
                if (d != null)
                    return d;
            }
            catch { /* guard 决不拖垮工具管线（fail-open 安全阀） */ }
            return next();
        });
        cleanups.push(() => { try {
            offPre();
        }
        catch { /* 已卸载 */ } });
        if (config.observeTools !== false) {
            const off = ctx.on('tools/result', (exec) => {
                try {
                    const toolName = String(exec.name ?? '');
                    if (TOOL_NAMES.includes(toolName))
                        return;
                    const agent = String(exec.agent?.id ?? 'unknown');
                    registry.observeToolCall(toolName, agent);
                }
                catch { /* 观测失败不阻断工具执行 */ }
            });
            cleanups.push(() => { try {
                off();
            }
            catch { /* 已卸载 */ } });
        }
        // cordis 约定：inject 回调返回函数 = 该注入作用域的 dispose（卸载即净的关键路径）
        return () => {
            for (const c of cleanups) {
                try {
                    c();
                }
                catch { /* 幂等 */ }
            }
        };
    });
    return () => {
        if (disposed)
            return;
        disposed = true;
        for (const c of cleanups) {
            try {
                c();
            }
            catch { /* 卸载幂等 */ }
        }
    };
}
//# sourceMappingURL=index.js.map