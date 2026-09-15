/**
 * PlanStore：.plan-board/ 双态文件体系。
 * plan.board.json 唯一机器权威（乐观锁）；events.jsonl append-only 审计/实时源；
 * ROADMAP.md 人读镜像（git diff 友好）；memory.link.json ~/.ai 关联状态。
 * 双态互验：JSON 与 MD 同源生成，digest 记录于两者，人工改动 MD 会造成 drift（M2 校验）。
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Board, BoardError, BoardEvent, BoardNode, EditOp, applyOps, lintBoard, newBoard,
  stableStringify, topoOrder,
} from './schema.js'
import { changedFilesSince, scopeHit } from './gitwatch.js'

function digestOf(b: Board): string {
  const copy: Record<string, unknown> = {}
  for (const k of Object.keys(b).sort()) {
    if (k === 'digest') continue
    copy[k] = (b as unknown as Record<string, unknown>)[k]
  }
  return createHash('sha256').update(stableStringify(copy)).digest('hex')
}

export interface StoreOpts { blockOnDrift: boolean }

export type EventBroadcast = (project: string, ev: BoardEvent) => void

export class PlanStore {
  readonly projectDir: string
  readonly dir: string
  board: Board
  private events: BoardEvent[] = []
  private opts: StoreOpts
  private broadcast?: EventBroadcast

  private constructor(projectDir: string, opts: StoreOpts, broadcast?: EventBroadcast) {
    this.projectDir = projectDir
    this.dir = join(projectDir, '.plan-board')
    this.opts = opts
    this.broadcast = broadcast
    const file = join(this.dir, 'plan.board.json')
    if (!existsSync(file)) {
      throw new BoardError('PLAN_NOT_FOUND', '未找到 ' + file + ' —— 用 plan_edit 的 init_board 操作初始化')
    }
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Board
    const errs = lintBoard(parsed)
    if (errs.length > 0) throw new BoardError('BOARD_INVALID', 'plan.board.json 校验失败:\n- ' + errs.join('\n- '))
    this.board = parsed
    this.board.digest = digestOf(parsed)
    const evFile = join(this.dir, 'events.jsonl')
    if (existsSync(evFile)) {
      try {
        this.events = readFileSync(evFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as BoardEvent)
      } catch { this.events = [] }
    }
  }

  static ensure(projectDir: string, opts: StoreOpts, init?: { name: string; goal: string }, broadcast?: EventBroadcast): PlanStore {
    try {
      return new PlanStore(projectDir, opts, broadcast)
    } catch (e) {
      if (e instanceof BoardError && e.code === 'PLAN_NOT_FOUND' && init != null) {
        mkdirSync(join(projectDir, '.plan-board'), { recursive: true })
        writeFileSync(join(projectDir, '.plan-board', 'plan.board.json'), JSON.stringify(newBoard(init.name, init.goal), null, 2))
        return new PlanStore(projectDir, opts, broadcast)
      }
      throw e
    }
  }

  static open(projectDir: string, opts: StoreOpts, broadcast?: EventBroadcast): PlanStore {
    return new PlanStore(projectDir, opts, broadcast)
  }

  addEvent(kind: string, actor: string, payload?: unknown): void {
    const ev: BoardEvent = { ts: new Date().toISOString(), seq: this.events.length + 1, kind, actor, payload }
    this.events.push(ev)
    try { appendFileSync(join(this.dir, 'events.jsonl'), JSON.stringify(ev) + '\n') } catch { /* fail-soft: 镜像失败不阻断主流程，但 digest 已含权威态 */ }
    try { this.broadcast?.(this.projectDir, ev) } catch { /* 订阅者失败不阻断主流程 */ }
  }

  eventsTail(n: number): BoardEvent[] {
    return this.events.slice(-n)
  }

  /** 唯一写入口：期望版本校验 → 变换 → lint → 版本/digest 推进 → 原子落盘 → 镜像。 */
  mutate(actor: string, kind: string, payload: unknown, fn: (b: Board) => void, expectedVersion?: number): Board {
    if (expectedVersion != null && expectedVersion !== this.board.version) {
      throw new BoardError('VERSION_CONFLICT', '乐观锁冲突: 当前 v' + this.board.version + '，请求基于 v' + expectedVersion)
    }
    fn(this.board)
    const errs = lintBoard(this.board)
    if (errs.length > 0) throw new BoardError('BOARD_INVALID', '变更未生效（校验门拦截）:\n- ' + errs.join('\n- '))
    this.board.version += 1
    this.board.digest = digestOf(this.board)
    this.saveBoard()
    this.addEvent(kind, actor, payload)
    this.mirrorRoadmap()
    return this.board
  }

  private saveBoard(): void {
    const file = join(this.dir, 'plan.board.json')
    const tmp = file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.board, null, 2))
    renameSync(tmp, file)
  }

  mirrorRoadmap(): void {
    const b = this.board
    const order = topoOrder(b)
    const byId = new Map(b.nodes.map(n => [n.id, n]))
    const lines: string[] = []
    lines.push('# ROADMAP — ' + b.plan.name)
    lines.push('')
    lines.push('> 目标: ' + b.plan.goal)
    lines.push('> v' + b.version + ' · digest ' + (b.digest ?? '').slice(0, 12) + ' · 由 dsh-plan-board 维护（机器权威: plan.board.json，人工勿直接编辑）')
    lines.push('')
    const mark: Record<string, string> = { done: 'x', doing: '~', blocked: '!', canceled: ' ' }
    const mods = b.nodes.filter(n => n.type === 'module')
    for (const m of mods) {
      lines.push('## [' + (mark[m.status] ?? ' ') + '] ' + m.title + '（' + m.status + '）')
      lines.push('')
      for (const t of b.nodes.filter(n => n.type === 'task' && n.parent === m.id)) {
        const ord = order.get(t.id)
        const deps = (t.deps ?? []).map(d => { const dn = byId.get(d); return dn ? '#' + (order.get(d) ?? '?') + ' ' + dn.title : d }).join(', ')
        lines.push('- [' + (mark[t.status] ?? ' ') + '] ' + (ord != null ? '#' + ord + ' ' : '') + t.title + '（' + t.status + '）' + (t.priority != null && t.priority !== 3 ? ' P' + t.priority : ''))
        if (deps !== '') lines.push('  - 依赖: ' + deps)
        for (const a of t.acceptance ?? []) lines.push('  - 验收: ' + a)
        for (const ev of t.evidence ?? []) lines.push('  - 证据: ' + ev)
        if (t.note != null && t.note !== '') lines.push('  - 备注: ' + t.note)
      }
      lines.push('')
    }
    if (b.driftBlock != null) lines.push('> ⛔ 漂移阻断中: ' + b.driftBlock.reason + '（面板处置后解除）')
    if (b.pendingApprovals.length > 0) lines.push('> ⏳ 待批 plan_edit: ' + b.pendingApprovals.map(a => a.id).join(', '))
    writeFileSync(join(this.dir, 'ROADMAP.md'), lines.join('\n'))
  }

  /** L4 git 交叉核对（状态流转时调用）。返回 'block'|'alert'|'ok'|'skip'。 */
  driftCheck(taskId: string, actor: string): 'block' | 'alert' | 'ok' | 'skip' {
    const t = this.board.nodes.find(n => n.id === taskId)
    if (t == null || t.type !== 'task') return 'skip'
    const scope = t.scope ?? []
    if (scope.length === 0 || t.startedAt == null) return 'skip'
    const files = changedFilesSince(this.projectDir, t.startedAt)
    if (files == null) return 'skip'
    const hit = scopeHit(files, scope)
    if (hit !== '') return 'ok'
    const reason = 'git 交叉核对: 任务 ' + taskId + '（' + t.title + '）doing 期间新增 commit 触及 ' + files.length + ' 个文件，均不在任务 scope 内（L4）'
    this.addEvent('drift_alert', actor, { taskId, files: files.slice(0, 20), scope, level: this.opts.blockOnDrift ? 'block' : 'alert' })
    if (this.opts.blockOnDrift) {
      this.board.driftBlock = { taskId, reason, at: new Date().toISOString() }
      this.saveBoard()
      this.mirrorRoadmap()
      return 'block'
    }
    return 'alert'
  }

  applyEditOps(ops: EditOp[], now: string): string[] {
    return applyOps(this.board, ops, now)
  }

  boardNode(id: string): BoardNode | undefined {
    return this.board.nodes.find(n => n.id === id)
  }
}
