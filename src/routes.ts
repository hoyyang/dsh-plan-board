/**
 * HTTP 传输面（host half）：/_dsh/dsh-plan-board/ 前缀路由。
 * 门禁（沿用 dsh-session-manager / dsh-android-pane 实测纪律）：
 * 仅 loopback 对端；变更类 POST 追加同源校验；JSON 体上限 64KB；错误一律 {ok:false,error:{code,message}}。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Board, BoardError, EditOp, topoOrder } from './schema.js'
import { PlanStore, StoreOpts } from './store.js'

export const ROUTE_PREFIX = '/_dsh/dsh-plan-board'
const MAX_JSON_BODY_BYTES = 64 * 1024

export interface GuardLike {
  isSuspended(): boolean
  setSuspended(v: boolean): boolean
  state(): { suspended: boolean; enforceScope: boolean }
}

export class BoardRegistry {
  readonly stateDir: string
  readonly opts: StoreOpts
  readonly subscribers = new Set<(msg: unknown) => void>()
  /** L7 拦截器（index.ts 装配后挂入；路由层负责挂起开关与状态展示）。 */
  guard: GuardLike | null = null
  /** PlanStore 广播入口：事件 → 所有 /stream 订阅者。 */
  readonly onEvent = (project: string, ev: unknown): void => {
    this.broadcast({ kind: 'event', project, event: ev })
  }
  broadcast(msg: unknown): void {
    for (const s of this.subscribers) { try { s(msg) } catch { /* 单订阅者失败不拖垮其他 */ } }
  }
  constructor(stateDir: string, opts: StoreOpts) {
    this.stateDir = stateDir
    this.opts = opts
    mkdirSync(stateDir, { recursive: true })
  }
  projects(): Record<string, { name: string; at: string }> {
    const f = join(this.stateDir, 'projects.json')
    if (!existsSync(f)) return {}
    try { return JSON.parse(readFileSync(f, 'utf8')) as Record<string, { name: string; at: string }> } catch { return {} }
  }
  remember(project: string, name: string): void {
    const all = this.projects()
    const cur = all[project]
    if (cur != null && cur.name === name) return // 幂等：/state 轮询不重复写盘
    all[project] = { name, at: new Date().toISOString() }
    writeFileSync(join(this.stateDir, 'projects.json'), JSON.stringify(all, null, 2))
  }
  /** L7 观测面：非本插件工具调用全量留痕（tool-calls.jsonl，仅名称+agent，不落参数）。 */
  observeToolCall(toolName: string, agent: string): void {
    try {
      const rec = { ts: new Date().toISOString(), tool: toolName, agent }
      appendFileSync(join(this.stateDir, 'tool-calls.jsonl'), JSON.stringify(rec) + '\n')
    } catch { /* fail-soft */ }
  }
}

function isLoopbackPeer(remote: string | undefined): boolean {
  if (remote == null || remote === '') return false
  if (remote === '::1') return true
  const m = /^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/i.exec(remote)
  if (m != null) return Number(m[1]) === 127
  if (isIP(remote) === 4) return remote.startsWith('127.')
  return false
}

function sameOriginHost(req: Pick<IncomingMessage, 'headers'>): boolean {
  const origin = req.headers.origin
  if (origin == null) return true
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string' || host.trim() === '') return false
  try { return new URL(origin).host.trim().toLowerCase() === host.trim().toLowerCase() } catch { return false }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function sendErr(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } })
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let aborted = false
    req.on('data', (d: Buffer) => {
      if (aborted) return
      size += d.length
      if (size > MAX_JSON_BODY_BYTES) { aborted = true; req.pause(); resolve(null); return }
      chunks.push(d)
    })
    req.on('end', () => {
      if (aborted) return
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        const parsed = text.trim() === '' ? {} : (JSON.parse(text) as unknown)
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) resolve(null)
        else resolve(parsed as Record<string, unknown>)
      } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

function stationOf(b: Board): string | null {
  const doing = b.nodes.filter(n => n.type === 'task' && n.status === 'doing')
  return doing.length > 0 ? doing[doing.length - 1].id : null
}

export function mountRoutes(
  webServer: { register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void },
  registry: BoardRegistry,
): () => void {
  const unregister = webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      try {
        if (!isLoopbackPeer(req.socket.remoteAddress)) { sendErr(res, 403, 'FORBIDDEN', '仅限本机访问'); return }
        const u = new URL(req.url ?? '/', 'http://localhost')
        const sub = u.pathname.slice(ROUTE_PREFIX.length) || '/'
        if (req.method === 'GET') {
          if (sub === '/stream') {
            const project = u.searchParams.get('project') ?? ''
            if (!project.startsWith('/')) { sendErr(res, 400, 'BAD_PROJECT', 'project 必须是绝对路径'); return }
            res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
            const send = (obj: unknown): void => { try { res.write(JSON.stringify(obj) + '\n') } catch { /* 连接已断 */ } }
            send({ kind: 'hello', project, at: new Date().toISOString() })
            const subFn = (msg: unknown): void => { send(msg) }
            registry.subscribers.add(subFn)
            const hb = setInterval(() => send({ kind: 'ping', at: new Date().toISOString() }), 15000)
            res.on('close', () => { clearInterval(hb); registry.subscribers.delete(subFn) })
            return
          }
          if (sub === '/state') {
            const project = u.searchParams.get('project') ?? ''
            if (!project.startsWith('/')) { sendErr(res, 400, 'BAD_PROJECT', 'project 必须是绝对路径'); return }
            const store = PlanStore.open(project, registry.opts, registry.onEvent)
            registry.remember(project, store.board.plan.name)
            const order: Record<string, number> = {}
            for (const [k, v] of topoOrder(store.board)) order[k] = v
            sendJson(res, 200, {
              ok: true, project, board: store.board, order,
              station: stationOf(store.board), events: store.eventsTail(60),
              guard: registry.guard?.state() ?? { suspended: false, enforceScope: false },
            })
            return
          }
          if (sub === '/projects') { sendJson(res, 200, { ok: true, projects: registry.projects() }); return }
          sendErr(res, 404, 'NOT_FOUND', '未知路径 ' + sub)
          return
        }
        if (req.method === 'POST') {
          if (!sameOriginHost(req)) { sendErr(res, 403, 'SAME_ORIGIN', '跨站请求被拒绝'); return }
          const body = await readJsonBody(req)
          if (body == null) { sendErr(res, 400, 'BAD_JSON', 'JSON 体缺失或非法（上限 64KB）'); return }
          const project = String(body.project ?? '')
          if (!project.startsWith('/')) { sendErr(res, 400, 'BAD_PROJECT', 'project 必须是绝对路径'); return }
          const store = PlanStore.open(project, registry.opts, registry.onEvent)
          if (sub === '/approve') {
            const approvalId = String(body.approvalId ?? '')
            const decision = String(body.decision ?? '')
            const ap = store.board.pendingApprovals.find(x => x.id === approvalId)
            if (ap == null) { sendErr(res, 404, 'NO_APPROVAL', '待批项不存在: ' + approvalId); return }
            if (decision === 'approve') {
              const ops = ap.ops
              const now = new Date().toISOString()
              store.mutate('human:panel', 'plan_edit_approved', { approvalId, ops }, (b) => {
                store.applyEditOps(ops, now)
                b.pendingApprovals = b.pendingApprovals.filter(x => x.id !== approvalId)
              })
              sendJson(res, 200, { ok: true, decision, approvalId })
              return
            }
            if (decision === 'reject') {
              store.mutate('human:panel', 'plan_edit_rejected', { approvalId, reason: String(body.reason ?? '') }, (b) => {
                b.pendingApprovals = b.pendingApprovals.filter(x => x.id !== approvalId)
              })
              sendJson(res, 200, { ok: true, decision, approvalId })
              return
            }
            sendErr(res, 400, 'BAD_DECISION', 'decision 必须是 approve|reject')
            return
          }
          if (sub === '/unblock') {
            if (store.board.driftBlock == null) { sendJson(res, 200, { ok: true, unblocked: false }); return }
            store.mutate('human:panel', 'drift_unblocked', { cleared: store.board.driftBlock }, (b) => { b.driftBlock = null })
            sendJson(res, 200, { ok: true, unblocked: true })
            return
          }
          if (sub === '/guard') {
            if (registry.guard == null) { sendErr(res, 501, 'NO_GUARD', '拦截器未装配'); return }
            const suspended = body.suspended
            if (typeof suspended !== 'boolean') { sendErr(res, 400, 'BAD_SUSPENDED', 'suspended 必须是布尔'); return }
            registry.guard.setSuspended(suspended)
            // 人类挂起/恢复动作落板留痕（板不存在时跳过事件，不失败）
            try {
              const store2 = PlanStore.open(project, registry.opts, registry.onEvent)
              store2.addEvent(suspended ? 'guard_suspend' : 'guard_resume', 'human:panel', { by: 'panel' })
            } catch { /* 无板项目只切全局态 */ }
            sendJson(res, 200, { ok: true, suspended: registry.guard.isSuspended() })
            return
          }
          if (sub === '/edit') {
            const ops = body.ops
            if (!Array.isArray(ops)) { sendErr(res, 400, 'BAD_OPS', 'ops 必须是数组'); return }
            const now = new Date().toISOString()
            const changed = store.mutate('human:panel', 'human_edit', { ops, note: body.note ?? null }, (b) => {
              store.applyEditOps(ops as EditOp[], now)
            })
            sendJson(res, 200, { ok: true, version: changed.version, changed: changed.nodes.length })
            return
          }
          sendErr(res, 404, 'NOT_FOUND', '未知路径 ' + sub)
          return
        }
        sendErr(res, 405, 'METHOD', '仅支持 GET/POST')
      } catch (e) {
        if (e instanceof BoardError) sendErr(res, e.code === 'PLAN_NOT_FOUND' ? 404 : 400, e.code, e.message)
        else sendErr(res, 500, 'INTERNAL', e instanceof Error ? e.message : String(e))
      }
    },
  })
  return unregister
}
