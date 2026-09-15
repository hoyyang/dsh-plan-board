/**
 * 5 个 agent 工具（上下文经济门 7：描述短、能脚本不注册）。
 * L1 单发号硬锁 / L2 改图人审门 / L3 证据门 / L4 git 交叉核对 / L5 漂移阻断。
 */
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { BoardError, readyTasks, topoOrder, transitionOk, moduleTransitionOk, isStatus, unmetDeps } from './schema.js';
import { PlanStore } from './store.js';
export const TOOL_NAMES = ['plan_map', 'plan_edit', 'plan_next', 'task_update', 'plan_link'];
function toJson(x) {
    return JSON.parse(JSON.stringify(x));
}
function errJson(e) {
    if (e instanceof BoardError)
        return { ok: false, code: e.code, error: e.message };
    return { ok: false, code: 'TOOL_FAILED', error: e instanceof Error ? e.message : String(e) };
}
function actorOf(ctx) {
    return 'agent:' + (ctx.agent?.id ?? 'unknown');
}
function resolveProject(args, stateDir) {
    const p = args.project;
    if (typeof p === 'string' && p.startsWith('/'))
        return p;
    if (typeof p === 'string' && p.trim() !== '')
        throw new BoardError('BAD_PROJECT', 'project 必须是项目根目录绝对路径');
    return stateDir + '/default';
}
const PROJECT_PARAM = { type: 'string', description: '项目根目录绝对路径。缺省 = ~/.dsh/dsh-plan-board/default' };
function textMap(store) {
    const b = store.board;
    const order = topoOrder(b);
    const lines = [];
    lines.push('PlanBoard v' + b.version + ' [' + b.plan.name + '] 目标: ' + b.plan.goal);
    const doing = b.nodes.filter(n => n.status === 'doing' && n.type === 'task');
    lines.push('station: ' + (doing.length > 0 ? doing.map(n => '#' + (order.get(n.id) ?? '?') + ' ' + n.id + ' ' + n.title).join('; ') : '(无进行中任务)'));
    lines.push('driftBlock: ' + (b.driftBlock != null ? '⛔ ' + b.driftBlock.reason : '无'));
    lines.push('待批 plan_edit: ' + (b.pendingApprovals.length > 0 ? b.pendingApprovals.map(a => a.id + '(' + a.ops.length + 'ops)').join(', ') : '无'));
    const mods = b.nodes.filter(n => n.type === 'module');
    if (mods.length === 0)
        lines.push('(空板 — 用 plan_edit init_board + add_node 建立计划)');
    for (const m of mods) {
        lines.push('[' + m.status + '] ' + m.id + ' ' + m.title);
        for (const t of b.nodes.filter(n => n.type === 'task' && n.parent === m.id)) {
            const ord = order.get(t.id);
            const deps = (t.deps ?? []).map(d => '#' + (order.get(d) ?? '?')).join(',');
            lines.push('  ' + (ord != null ? '#' + ord + ' ' : '') + t.id + ' ' + t.title + ' — ' + t.status + (deps !== '' ? ' (deps ' + deps + ')' : '') + (t.priority != null && t.priority !== 3 ? ' P' + t.priority : ''));
        }
    }
    const station = doing.length > 0 ? doing[doing.length - 1].id : null;
    return { text: lines.join('\n'), station };
}
export function registerBoardTools(tools, stateDir, opts, onEvent, onOpen) {
    // init 非空 = 允许在「还没有板子」的项目上起板（plan_edit init_board 的唯一入口）。
    // 修：此前所有路径都走 PlanStore.open（要求文件已存在）→ 新项目 init_board 必然 PLAN_NOT_FOUND，
    // 而其报错文案与面板空态又都指向 init_board，形成起板死循环。
    const openStore = (args, init) => {
        const project = resolveProject(args, stateDir);
        const store = init != null ? PlanStore.ensure(project, opts, init, onEvent) : PlanStore.open(project, opts, onEvent);
        try {
            onOpen?.(project, store.board.plan.name);
        }
        catch { /* 记忆失败不阻断工具 */ }
        return store;
    };
    tools.register(defineTool({
        name: 'plan_map',
        description: 'Read the project plan board as a compact mind-map text (modules/tasks with topo order #N, status, deps) plus current station, drift block and pending approvals. ALWAYS call this first in a new or compacted session before doing any project work.',
        parameters: { project: PROJECT_PARAM },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: String(v.text ?? JSON.stringify(v)) }] },
        execute: async (args) => {
            try {
                const store = openStore(args);
                const m = textMap(store);
                return toJson({ ok: true, text: m.text, version: store.board.version, digest: store.board.digest, station: m.station, driftBlock: store.board.driftBlock ?? null, approvals: store.board.pendingApprovals.length });
            }
            catch (e) {
                return errJson(e);
            }
        },
        timeoutMs: 10_000,
    }));
    tools.register(defineTool({
        name: 'plan_edit',
        description: 'Propose changes to the plan board. ops: init_board{name,goal} / add_node / update_node / remove_node / set_deps (JSON). Structural ops (init/add/remove/deps/priority/parent) REQUIRE human approval in the panel before taking effect; info ops (title/note/acceptance/scope) apply at once. reason is mandatory.',
        parameters: {
            ops: { type: 'array', required: true, description: 'EditOp 列表，元素形如 {"op":"add_node","node":{...}} 或 {"op":"init_board","name":"...","goal":"..."}' },
            reason: { type: 'string', required: true, description: '为什么改图（强制，审计留痕）' },
            project: PROJECT_PARAM,
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
        execute: async (args, ctx) => {
            try {
                const a = args;
                if (!Array.isArray(a.ops))
                    throw new BoardError('BAD_OPS', 'ops 必须是数组');
                const reason = typeof a.reason === 'string' && a.reason.trim() !== '' ? a.reason : null;
                if (reason == null)
                    throw new BoardError('REASON_REQUIRED', 'plan_edit 必须带 reason（L2 审计留痕）');
                const ops = a.ops;
                const initOp = ops.find(op => op.op === 'init_board');
                const store = openStore(args, initOp != null ? { name: String(initOp.name ?? '未命名计划'), goal: String(initOp.goal ?? '') } : undefined);
                const actor = actorOf(ctx);
                const structural = ops.filter(op => op.op === 'init_board' || op.op === 'add_node' || op.op === 'remove_node' || op.op === 'set_deps' ||
                    (op.op === 'update_node' && (op.fields.priority != null || op.fields.parent !== undefined)));
                const info = ops.filter(op => op.op === 'update_node' && !structural.includes(op));
                let appliedInfo = 0;
                let approvalId = null;
                const now = new Date().toISOString();
                if (info.length > 0) {
                    store.mutate(actor, 'plan_edit_info', { reason, ops: info }, (b) => { store.applyEditOps(info, now); });
                    appliedInfo = info.length;
                }
                if (structural.length > 0) {
                    store.mutate(actor, 'plan_edit_proposed', { reason, ops: structural }, (b) => {
                        b.apSeq += 1;
                        const id = 'ap-' + b.apSeq;
                        b.pendingApprovals.push({ id, reason, ops: structural, by: actor, proposedAt: now });
                        approvalId = id;
                    });
                }
                const m = textMap(store);
                return toJson({ ok: true, appliedInfo, approvalId, pendingApproval: approvalId != null, status: approvalId != null ? 'submitted_for_approval' : 'applied', text: m.text });
            }
            catch (e) {
                return errJson(e);
            }
        },
        timeoutMs: 15_000,
    }));
    tools.register(defineTool({
        name: 'plan_next',
        description: 'Issue THE single next ready task (dependency-resolved, priority-sorted): marks it doing and returns its full spec (acceptance, scope, deps). Refuses when a drift block is active (L5) or another task is already doing (L1 single-issue lock).',
        parameters: { project: PROJECT_PARAM },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
        execute: async (args, ctx) => {
            try {
                const store = openStore(args);
                if (store.board.driftBlock != null) {
                    throw new BoardError('DRIFT_BLOCKED', '存在未处置漂移警报，plan_next 拒绝发号（L5）。人须在面板「解除阻断」: ' + store.board.driftBlock.reason);
                }
                const doing = store.board.nodes.filter(n => n.type === 'task' && n.status === 'doing');
                if (doing.length > 0) {
                    throw new BoardError('SINGLE_ISSUE', '已有进行中任务 ' + doing[0].id + '（' + doing[0].title + '）。先 task_update 它为 done/blocked 再取下一个（L1 单发号硬锁）');
                }
                const ready = readyTasks(store.board);
                if (ready.length === 0) {
                    const m = textMap(store);
                    const waiting = store.board.nodes
                        .filter(n => n.type === 'task' && (n.status === 'planned' || n.status === 'ready'))
                        .map(t => ({ id: t.id, waitingOn: unmetDeps(store.board, t) }))
                        .filter(w => w.waitingOn.length > 0)
                        .slice(0, 8);
                    const detail = waiting.length > 0
                        ? '；仍在等待: ' + waiting.map(w => w.id + ' ← ' + w.waitingOn.join(', ')).join(' · ')
                        : '';
                    return toJson({ ok: true, issued: null, reason: '没有依赖就绪的任务（全部完成或被阻塞）' + detail, waiting, text: m.text });
                }
                const task = ready[0];
                const now = new Date().toISOString();
                store.mutate(actorOf(ctx), 'task_issued', { taskId: task.id, title: task.title }, (b) => {
                    const n = b.nodes.find(x => x.id === task.id);
                    if (n != null) {
                        n.status = 'doing';
                        n.startedAt = now;
                        n.updatedAt = now;
                    }
                });
                const m = textMap(store);
                return toJson({ ok: true, issued: { id: task.id, title: task.title, acceptance: task.acceptance ?? [], scope: task.scope ?? [], deps: task.deps ?? [], note: task.note ?? '' }, text: m.text });
            }
            catch (e) {
                return errJson(e);
            }
        },
        timeoutMs: 15_000,
    }));
    tools.register(defineTool({
        name: 'task_update',
        description: 'Transition a task status: planned/ready -> doing -> done/blocked (-> planned). Also closes a module container: planned -> done (evidence required) or -> canceled; a module is otherwise satisfied automatically once all its tasks are done/canceled. done REQUIRES evidence (test output/screenshot/file path) — L3 evidence gate. Every change is audited; a git cross-check (L4) runs against the task scope and may raise a drift block.',
        parameters: {
            taskId: { type: 'string', required: true, description: '任务节点 id' },
            status: { type: 'string', required: true, description: 'planned|ready|doing|blocked|done|canceled' },
            evidence: { type: 'array', description: '证据列表（测试输出/截图/文件路径）。done 必填' },
            note: { type: 'string', description: '补充说明' },
            project: PROJECT_PARAM,
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
        execute: async (args, ctx) => {
            try {
                const a = args;
                const taskId = String(a.taskId ?? '');
                const status = String(a.status ?? '');
                if (!isStatus(status))
                    throw new BoardError('BAD_STATUS', '非法 status: ' + status);
                const store = openStore(args);
                const t = store.boardNode(taskId);
                if (t == null)
                    throw new BoardError('NO_NODE', '节点不存在: ' + taskId);
                if (t.type === 'module') {
                    if (!moduleTransitionOk(t.status, status))
                        throw new BoardError('BAD_TRANSITION', '模块只支持 planned ⇄ done 或 → canceled，不允许 ' + t.status + ' -> ' + status);
                }
                else if (!transitionOk(t.status, status)) {
                    throw new BoardError('BAD_TRANSITION', '不允许 ' + t.status + ' -> ' + status);
                }
                if (status === 'done' && !(Array.isArray(a.evidence) && a.evidence.length > 0)) {
                    throw new BoardError('EVIDENCE_REQUIRED', t.type + ' ' + taskId + ' done 必须附证据（L3 证据门）: 测试输出/截图路径/文件路径等');
                }
                const actor = actorOf(ctx);
                const now = new Date().toISOString();
                store.mutate(actor, 'status_changed', { taskId, from: t.status, to: status, note: a.note ?? null }, (b) => {
                    const n = b.nodes.find(x => x.id === taskId);
                    if (n == null)
                        throw new BoardError('NO_NODE', '任务不存在: ' + taskId);
                    n.status = status;
                    n.updatedAt = now;
                    if (status === 'doing' && !n.startedAt)
                        n.startedAt = now;
                    if (Array.isArray(a.evidence))
                        n.evidence = a.evidence.map(String);
                    if (typeof a.note === 'string' && a.note !== '')
                        n.note = a.note;
                });
                const drift = store.driftCheck(taskId, actor);
                const m = textMap(store);
                return toJson({ ok: true, taskId, status, drift, text: m.text });
            }
            catch (e) {
                return errJson(e);
            }
        },
        timeoutMs: 20_000,
    }));
    tools.register(defineTool({
        name: 'plan_link',
        description: 'Sync the plan board with ~/.ai project memory (landfill-project ecosystem). action=push: write a digest+summary via ai-memory append (safe write discipline); action=pull: read ai-memory project path + MEMORY_INDEX for reconciliation. Call push at meaningful milestones or before session end.',
        parameters: {
            action: { type: 'string', required: true, description: 'push|pull' },
            project: { type: 'string', required: true, description: '项目根目录绝对路径' },
            note: { type: 'string', description: 'push 时的一句话进展补充' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
        execute: async (args, ctx) => {
            try {
                const a = args;
                const action = String(a.action ?? '');
                const project = resolveProject(args, '');
                const store = PlanStore.open(project, opts);
                const aiMem = (process.env.HOME ?? homedir()) + '/.ai/tools/ai-memory';
                if (action === 'push') {
                    const b = store.board;
                    const order = topoOrder(b);
                    const done = b.nodes.filter(n => n.type === 'task' && n.status === 'done').length;
                    const total = b.nodes.filter(n => n.type === 'task').length;
                    const doing = b.nodes.find(n => n.status === 'doing');
                    const summary = '[dsh-plan-board] ' + b.plan.name + ' v' + b.version + ' digest ' + (b.digest ?? '').slice(0, 12) +
                        ' | 任务进度 ' + done + '/' + total +
                        ' | station: ' + (doing != null ? '#' + (order.get(doing.id) ?? '?') + ' ' + doing.title : '无') +
                        (b.driftBlock != null ? ' | ⛔漂移阻断: ' + b.driftBlock.reason : '') +
                        (typeof a.note === 'string' && a.note !== '' ? ' | ' + a.note : '') +
                        ' | 规划/任务权威: ' + project + '/.plan-board/（回忆时先读 plan.board.json）';
                    await new Promise((resolve, reject) => {
                        const child = execFile('bash', ['-lc', "'" + aiMem + "' append --cwd '" + project + "' --stdin"], {
                            encoding: 'utf8', timeout: 20_000,
                        }, (err, stdout, stderr) => {
                            if (err != null)
                                reject(new BoardError('AI_MEMORY_FAILED', 'ai-memory append 失败: ' + String(stderr ?? err.message).slice(0, 300)));
                            else {
                                void stdout;
                                resolve();
                            }
                        });
                        child.stdin?.end(summary);
                    });
                    writeLink(join2(project), { lastPushDigest: b.digest, at: new Date().toISOString(), summary });
                    store.addEvent('memory_linked', actorOf(ctx), { action: 'push', digest: b.digest });
                    return toJson({ ok: true, action: 'push', digest: b.digest, summary });
                }
                if (action === 'pull') {
                    const pathOut = await new Promise((resolve, reject) => {
                        execFile('bash', ['-lc', "'" + aiMem + "' path --cwd '" + project + "'"], { encoding: 'utf8', timeout: 20_000 }, (err, stdout, stderr) => {
                            if (err != null)
                                reject(new BoardError('AI_MEMORY_FAILED', 'ai-memory path 失败: ' + String(stderr ?? err.message).slice(0, 300)));
                            else
                                resolve(String(stdout).trim());
                        });
                    });
                    return toJson({ ok: true, action: 'pull', aiPath: pathOut, boardDigest: store.board.digest, note: '规划/任务状态以 .plan-board/plan.board.json 为权威，叙述记忆以 ~/.ai 为权威' });
                }
                throw new BoardError('BAD_ACTION', 'action 必须是 push|pull');
            }
            catch (e) {
                return errJson(e);
            }
        },
        timeoutMs: 30_000,
    }));
}
function join2(p) { return p.replace(/\/+$/, '') + '/.plan-board/memory.link.json'; }
function writeLink(file, data) {
    try {
        writeFileSync(file, JSON.stringify(data, null, 2));
    }
    catch { /* fail-soft */ }
}
//# sourceMappingURL=tools.js.map