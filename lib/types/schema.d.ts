/**
 * dsh-plan-board — 数据模型 + 校验门（archify 方法论：typed spec + lint 全绿才生效）。
 * plan.board.json 是唯一机器权威；乐观锁 version + SHA-256 digest（archify 回执思想）。
 */
export type NodeStatus = 'planned' | 'ready' | 'doing' | 'blocked' | 'done' | 'canceled';
export type NodeType = 'module' | 'task';
export interface BoardNode {
    id: string;
    type: NodeType;
    parent: string | null;
    title: string;
    status: NodeStatus;
    deps: string[];
    priority?: number;
    acceptance?: string[];
    scope?: string[];
    evidence?: string[];
    note?: string;
    /** 面板自由布局坐标（SVG 用户单位；null/缺省 = 自动布局）。仅视图状态，不参与 lint。 */
    pos?: {
        x: number;
        y: number;
    } | null;
    createdAt: string;
    updatedAt: string;
    startedAt?: string | null;
    by?: string;
}
export type EditOp = {
    op: 'init_board';
    name: string;
    goal: string;
} | {
    op: 'add_node';
    node: {
        id: string;
        type: NodeType;
        title: string;
        parent?: string | null;
        deps?: string[];
        priority?: number;
        acceptance?: string[];
        scope?: string[];
    };
} | {
    op: 'update_node';
    id: string;
    fields: {
        title?: string;
        note?: string;
        acceptance?: string[];
        scope?: string[];
        priority?: number;
        parent?: string | null;
        deps?: string[];
        pos?: {
            x: number;
            y: number;
        } | null;
    };
} | {
    op: 'remove_node';
    id: string;
} | {
    op: 'set_deps';
    id: string;
    deps: string[];
};
export interface Approval {
    id: string;
    reason: string;
    ops: EditOp[];
    by: string;
    proposedAt: string;
}
export interface DriftBlock {
    taskId: string;
    reason: string;
    at: string;
}
export interface Board {
    version: number;
    digest?: string;
    plan: {
        name: string;
        goal: string;
    };
    nodes: BoardNode[];
    pendingApprovals: Approval[];
    apSeq: number;
    driftBlock?: DriftBlock | null;
}
export interface BoardEvent {
    ts: string;
    seq: number;
    kind: string;
    actor: string;
    payload?: unknown;
}
export declare class BoardError extends Error {
    code: string;
    constructor(code: string, message: string);
}
export declare function newBoard(name: string, goal: string): Board;
export declare function isStatus(x: unknown): x is NodeStatus;
/** 校验门：命名错误清单（空数组 = 通过）。fail loud，禁静默。 */
export declare function lintBoard(b: Board): string[];
export declare function depCycle(b: Board): string[] | null;
/**
 * 有效依赖展开到 task：模块依赖展开成该模块名下的全部后代 task。
 * 用于拓扑序号——模块依赖冒泡后，序号必须反映真实执行约束。
 */
export declare function effectiveTaskDeps(b: Board, t: BoardNode): string[];
/** 拓扑执行序号（仅 task；Kahn 稳定序；含模块依赖冒泡后的约束）。 */
export declare function topoOrder(b: Board): Map<string, number>;
/** 从直接 parent 向上到根的 module 祖先链（不含自身，防 parent 环时自动截断）。 */
export declare function ancestorModules(b: Board, n: BoardNode): BoardNode[];
/**
 * 模块是否算「完成」：显式 done，或它名下的 task 至少 1 个且全部为 done/canceled。
 * 后者让「大任务2完成」这种自然语义自动成立（不必先给容器手工盖章），
 * 前者保留显式收卷的能力；空模块不会自动算完成（否则会白送一个空洞的通过）。
 */
export declare function moduleComplete(b: Board, m: BoardNode): boolean;
/** 依赖是否已满足：task 看 done；module 看 moduleComplete（模块级依赖不再被无视）。 */
export declare function depSatisfied(b: Board, depId: string): boolean;
/** 有效依赖 = 自身 deps ∪ 所有祖先模块的 deps（模块依赖向下冒泡到子任务），去掉自身。 */
export declare function effectiveDeps(b: Board, n: BoardNode): string[];
/** 未满足的有效依赖（用于 readout/拒绝理由，保持 fail loud 的具名风格）。 */
export declare function unmetDeps(b: Board, n: BoardNode): string[];
/** 模块冒泡后的有效依赖图判环：declared 图无环，也可能因冒泡而死锁。 */
export declare function effectiveCycle(b: Board): string[] | null;
export declare function readyTasks(b: Board): BoardNode[];
export declare function transitionOk(from: NodeStatus, to: NodeStatus): boolean;
/**
 * 模块（分组容器）的状态流转：只保留「收卷 / 撤回」，不开放 ready/doing/blocked
 * （容器不执行工作，进入进行中只会污染站位显示）。done 同样受 L3 证据门约束。
 */
export declare function moduleTransitionOk(from: NodeStatus, to: NodeStatus): boolean;
export declare function stableStringify(x: unknown): string;
/** 应用 plan_edit 操作（不落盘，仅内存变换 + 命名校验）。 */
export declare function applyOps(b: Board, ops: EditOp[], now: string): string[];
