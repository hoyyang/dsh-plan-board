const STATUSES = ['planned', 'ready', 'doing', 'blocked', 'done', 'canceled'];
export class BoardError extends Error {
    code;
    constructor(code, message) { super(message); this.code = code; }
}
export function newBoard(name, goal) {
    return { version: 1, plan: { name, goal }, nodes: [], pendingApprovals: [], apSeq: 0, driftBlock: null };
}
export function isStatus(x) {
    return typeof x === 'string' && STATUSES.includes(x);
}
/** 校验门：命名错误清单（空数组 = 通过）。fail loud，禁静默。 */
export function lintBoard(b) {
    const errs = [];
    const byId = new Map(b.nodes.map(n => [n.id, n]));
    if (byId.size !== b.nodes.length)
        errs.push('存在重复节点 id');
    for (const n of b.nodes) {
        if (n.type === 'task' && (n.parent == null || !byId.has(n.parent)))
            errs.push('task ' + n.id + ' 的 parent 缺失或不存在');
        if (n.type === 'module' && n.parent != null && !byId.has(n.parent))
            errs.push('module ' + n.id + ' 的 parent 不存在');
        if (!isStatus(n.status))
            errs.push('node ' + n.id + ' 非法 status: ' + String(n.status));
        if (n.status === 'done' && !(n.evidence != null && n.evidence.length > 0))
            errs.push('node ' + n.id + ' 状态为 done 但缺少证据（L3 证据门）');
        for (const d of n.deps ?? []) {
            if (!byId.has(d))
                errs.push('node ' + n.id + ' 依赖悬空: ' + d);
            if (d === n.id)
                errs.push('node ' + n.id + ' 依赖自身');
        }
    }
    const cyc = depCycle(b);
    if (cyc != null)
        errs.push('依赖成环: ' + cyc.join(' -> '));
    const effCyc = effectiveCycle(b);
    if (effCyc != null)
        errs.push('模块依赖向下冒泡后成环（死锁）: ' + effCyc.join(' -> '));
    for (const n of b.nodes) {
        if (n.type !== 'task')
            continue;
        for (const anc of ancestorModules(b, n)) {
            if ((n.deps ?? []).includes(anc.id))
                errs.push('task ' + n.id + ' 依赖自己的祖先模块 ' + anc.id + '（该模块要等它完成，永远无法就绪）');
        }
    }
    return errs;
}
export function depCycle(b) {
    const byId = new Map(b.nodes.map(n => [n.id, n]));
    const color = new Map();
    const stack = [];
    let cycle = null;
    const dfs = (id) => {
        if (cycle != null || color.get(id) === 2)
            return;
        color.set(id, 1);
        stack.push(id);
        const n = byId.get(id);
        for (const d of n?.deps ?? []) {
            if (color.get(d) === 1) {
                cycle = stack.slice(stack.indexOf(d)).concat([d]);
                return;
            }
            if (!color.has(d))
                dfs(d);
            if (cycle != null)
                return;
        }
        stack.pop();
        color.set(id, 2);
    };
    for (const n of b.nodes)
        dfs(n.id);
    return cycle;
}
/**
 * 有效依赖展开到 task：模块依赖展开成该模块名下的全部后代 task。
 * 用于拓扑序号——模块依赖冒泡后，序号必须反映真实执行约束。
 */
export function effectiveTaskDeps(b, t) {
    const out = new Set();
    for (const d of effectiveDeps(b, t)) {
        const n = b.nodes.find(x => x.id === d);
        if (n == null)
            continue;
        if (n.type === 'task') {
            out.add(d);
            continue;
        }
        for (const k of b.nodes) {
            if (k.type !== 'task' || k.id === t.id)
                continue;
            if (ancestorModules(b, k).some(a => a.id === n.id))
                out.add(k.id);
        }
    }
    out.delete(t.id);
    return [...out];
}
/** 拓扑执行序号（仅 task；Kahn 稳定序；含模块依赖冒泡后的约束）。 */
export function topoOrder(b) {
    const tasks = b.nodes.filter(n => n.type === 'task');
    const ids = tasks.map(n => n.id);
    const indeg = new Map(ids.map(id => [id, 0]));
    const outs = new Map(ids.map(id => [id, []]));
    for (const t of tasks) {
        for (const d of effectiveTaskDeps(b, t)) {
            if (!indeg.has(d))
                continue;
            indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1);
            const arr = outs.get(d);
            if (arr != null)
                arr.push(t.id);
        }
    }
    const q = ids.filter(id => (indeg.get(id) ?? 0) === 0);
    const order = new Map();
    while (q.length > 0) {
        const id = q.shift();
        order.set(id, order.size + 1);
        for (const nxt of outs.get(id) ?? []) {
            const v = (indeg.get(nxt) ?? 1) - 1;
            indeg.set(nxt, v);
            if (v === 0)
                q.push(nxt);
        }
    }
    return order;
}
/** 从直接 parent 向上到根的 module 祖先链（不含自身，防 parent 环时自动截断）。 */
export function ancestorModules(b, n) {
    const byId = new Map(b.nodes.map(x => [x.id, x]));
    const out = [];
    const seen = new Set([n.id]);
    let cur = n.parent == null ? undefined : byId.get(n.parent);
    while (cur != null && !seen.has(cur.id)) {
        seen.add(cur.id);
        out.push(cur);
        cur = cur.parent == null ? undefined : byId.get(cur.parent);
    }
    return out;
}
/**
 * 模块是否算「完成」：显式 done，或它名下的 task 至少 1 个且全部为 done/canceled。
 * 后者让「大任务2完成」这种自然语义自动成立（不必先给容器手工盖章），
 * 前者保留显式收卷的能力；空模块不会自动算完成（否则会白送一个空洞的通过）。
 */
export function moduleComplete(b, m) {
    if (m.status === 'done')
        return true;
    const kids = b.nodes.filter(n => n.type === 'task' && n.parent === m.id);
    return kids.length > 0 && kids.every(k => k.status === 'done' || k.status === 'canceled');
}
/** 依赖是否已满足：task 看 done；module 看 moduleComplete（模块级依赖不再被无视）。 */
export function depSatisfied(b, depId) {
    const n = b.nodes.find(x => x.id === depId);
    if (n == null)
        return false;
    return n.type === 'module' ? moduleComplete(b, n) : n.status === 'done';
}
/** 有效依赖 = 自身 deps ∪ 所有祖先模块的 deps（模块依赖向下冒泡到子任务），去掉自身。 */
export function effectiveDeps(b, n) {
    const byId = new Map(b.nodes.map(x => [x.id, x]));
    const out = new Set(n.deps ?? []);
    for (const anc of ancestorModules(b, n))
        for (const d of anc.deps ?? [])
            out.add(d);
    out.delete(n.id);
    return [...out];
}
/** 未满足的有效依赖（用于 readout/拒绝理由，保持 fail loud 的具名风格）。 */
export function unmetDeps(b, n) {
    return effectiveDeps(b, n).filter(d => !depSatisfied(b, d));
}
/** 模块冒泡后的有效依赖图判环：declared 图无环，也可能因冒泡而死锁。 */
export function effectiveCycle(b) {
    const byId = new Map(b.nodes.map(x => [x.id, x]));
    const color = new Map();
    const stack = [];
    let cycle = null;
    const dfs = (id) => {
        if (cycle != null || color.get(id) === 2)
            return;
        color.set(id, 1);
        stack.push(id);
        const n = byId.get(id);
        // 边集 = 有效依赖 ∪ （模块 → 它的子任务）：模块只有在子任务收卷后才算完成，
        // 这条隐含边才是「模块依赖死锁」的真实来源。
        const edges = n == null ? [] : [...effectiveDeps(b, n), ...(n.type === 'module' ? b.nodes.filter(k => k.type === 'task' && k.parent === n.id).map(k => k.id) : [])];
        for (const d of edges) {
            if (!byId.has(d))
                continue;
            if (color.get(d) === 1) {
                cycle = stack.slice(stack.indexOf(d)).concat([d]);
                return;
            }
            if (!color.has(d))
                dfs(d);
            if (cycle != null)
                return;
        }
        stack.pop();
        color.set(id, 2);
    };
    for (const n of b.nodes)
        dfs(n.id);
    return cycle;
}
export function readyTasks(b) {
    return b.nodes
        .filter(n => n.type === 'task' && (n.status === 'planned' || n.status === 'ready'))
        .filter(n => effectiveDeps(b, n).every(d => depSatisfied(b, d)))
        .sort((x, y) => (x.priority ?? 3) - (y.priority ?? 3));
}
const FLOW = {
    planned: ['ready', 'doing', 'blocked'],
    ready: ['doing', 'blocked', 'planned'],
    doing: ['done', 'blocked', 'planned'],
    blocked: ['doing', 'ready', 'planned'],
    done: ['doing'],
    canceled: ['planned', 'ready'],
};
export function transitionOk(from, to) {
    if (from === to)
        return false;
    if (to === 'canceled')
        return true;
    return (FLOW[from] ?? []).includes(to);
}
/**
 * 模块（分组容器）的状态流转：只保留「收卷 / 撤回」，不开放 ready/doing/blocked
 * （容器不执行工作，进入进行中只会污染站位显示）。done 同样受 L3 证据门约束。
 */
export function moduleTransitionOk(from, to) {
    if (from === to)
        return false;
    if (to === 'canceled')
        return true;
    if (to === 'done')
        return from === 'planned' || from === 'ready';
    if (to === 'planned')
        return from === 'done' || from === 'ready' || from === 'canceled';
    return false;
}
export function stableStringify(x) {
    const seen = new WeakSet();
    const walk = (v) => {
        if (v == null || typeof v !== 'object')
            return v;
        if (seen.has(v))
            return null;
        seen.add(v);
        if (Array.isArray(v))
            return v.map(walk);
        const o = {};
        for (const k of Object.keys(v).sort())
            o[k] = walk(v[k]);
        return o;
    };
    return JSON.stringify(walk(x));
}
/** 应用 plan_edit 操作（不落盘，仅内存变换 + 命名校验）。 */
export function applyOps(b, ops, now) {
    const changed = [];
    for (const op of ops) {
        if (op.op === 'init_board') {
            b.plan = { name: op.name, goal: op.goal };
            changed.push('init_board ' + op.name);
            continue;
        }
        if (op.op === 'add_node') {
            if (b.nodes.some(n => n.id === op.node.id))
                throw new BoardError('DUP_ID', '节点已存在: ' + op.node.id);
            const parent = op.node.parent ?? null;
            if (op.node.type === 'task' && (parent == null || !b.nodes.some(n => n.id === parent && n.type === 'module'))) {
                throw new BoardError('BAD_PARENT', 'task ' + op.node.id + ' 必须挂在一个 module 下（parent 缺失或不合法）');
            }
            b.nodes.push({
                id: op.node.id, type: op.node.type, parent, title: op.node.title,
                status: 'planned', deps: op.node.deps ?? [], priority: op.node.priority ?? 3,
                acceptance: op.node.acceptance ?? [], scope: op.node.scope ?? [], evidence: [],
                createdAt: now, updatedAt: now, startedAt: null, by: 'plan_edit',
            });
            changed.push('add ' + op.node.id);
            continue;
        }
        if (op.op === 'update_node') {
            const n = b.nodes.find(x => x.id === op.id);
            if (n == null)
                throw new BoardError('NO_NODE', '节点不存在: ' + op.id);
            if ('status' in op.fields)
                throw new BoardError('STATUS_VIA_TASK_UPDATE', '状态流转必须用 task_update，plan_edit 不接受 status 字段');
            if (op.fields.title != null)
                n.title = op.fields.title;
            if (op.fields.note != null)
                n.note = op.fields.note;
            if (op.fields.acceptance != null)
                n.acceptance = op.fields.acceptance;
            if (op.fields.scope != null)
                n.scope = op.fields.scope;
            if (op.fields.priority != null)
                n.priority = op.fields.priority;
            if (op.fields.parent !== undefined)
                n.parent = op.fields.parent;
            if (op.fields.deps != null)
                n.deps = op.fields.deps;
            if (op.fields.pos !== undefined)
                n.pos = op.fields.pos ?? undefined;
            n.updatedAt = now;
            changed.push('update ' + op.id);
            continue;
        }
        if (op.op === 'remove_node') {
            if (b.nodes.some(n => n.parent === op.id))
                throw new BoardError('HAS_CHILDREN', '节点 ' + op.id + ' 有子节点，先移除子节点');
            b.nodes = b.nodes.filter(n => n.id !== op.id);
            changed.push('remove ' + op.id);
            continue;
        }
        if (op.op === 'set_deps') {
            const n = b.nodes.find(x => x.id === op.id);
            if (n == null)
                throw new BoardError('NO_NODE', '节点不存在: ' + op.id);
            n.deps = op.deps;
            n.updatedAt = now;
            changed.push('deps ' + op.id);
            continue;
        }
        throw new BoardError('UNKNOWN_OP', '未知操作: ' + JSON.stringify(op).slice(0, 160));
    }
    return changed;
}
//# sourceMappingURL=schema.js.map