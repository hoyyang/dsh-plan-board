import { Board, BoardEvent, BoardNode, EditOp } from './schema.js';
export interface StoreOpts {
    blockOnDrift: boolean;
}
export type EventBroadcast = (project: string, ev: BoardEvent) => void;
export declare class PlanStore {
    readonly projectDir: string;
    readonly dir: string;
    board: Board;
    private events;
    private opts;
    private broadcast?;
    private constructor();
    static ensure(projectDir: string, opts: StoreOpts, init?: {
        name: string;
        goal: string;
    }, broadcast?: EventBroadcast): PlanStore;
    static open(projectDir: string, opts: StoreOpts, broadcast?: EventBroadcast): PlanStore;
    addEvent(kind: string, actor: string, payload?: unknown): void;
    eventsTail(n: number): BoardEvent[];
    /** 唯一写入口：期望版本校验 → 变换 → lint → 版本/digest 推进 → 原子落盘 → 镜像。 */
    mutate(actor: string, kind: string, payload: unknown, fn: (b: Board) => void, expectedVersion?: number): Board;
    private saveBoard;
    mirrorRoadmap(): void;
    /** L4 git 交叉核对（状态流转时调用）。返回 'block'|'alert'|'ok'|'skip'。 */
    driftCheck(taskId: string, actor: string): 'block' | 'alert' | 'ok' | 'skip';
    applyEditOps(ops: EditOp[], now: string): string[];
    boardNode(id: string): BoardNode | undefined;
}
