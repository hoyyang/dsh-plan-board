/**
 * L7 阻断级：tools/pre-execute 越界拦截器（M2 第二批）。
 * 事实锚点（dsh-tools 当版实测）：
 * - ctx.on('tools/pre-execute', (exec, next) => ...) waterfall；exec = { name, arguments(冻结), agent? }；
 *   PreToolDecision = { kind:'allow' } | { kind:'deny', reason } | { kind:'ask', reason? }。
 * - run_code 的工具子分派同样过本闸（有 parent token）；run_code 程序内直接 fs 为已知边界。
 * 策略（用户拍板 2026-09-09）：
 * ① 看类宽放行（读文件/搜索/代码图/上网搜/看图/查记忆笔记 + 无害元工具）——直接 next()，永不等闸；
 * ② write/edit 路径未命中当前 doing 任务 scope → deny（具名理由，含任务号与出路）；doing 任务无 scope → 只告警不阻断；
 * ③ bash/run_code 先放行只记录（tool-calls.jsonl 观测已在），第一版已知边界。
 * 安全阀：guard 自身异常一律放行（拦截器崩溃不能瘫痪工具管线），挂起态仅内存（重启恢复默认开）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { PlanStore, StoreOpts, EventBroadcast } from './store.js'

/** 看类放行清单（用户拍板：常见操作都放）。本插件 plan_* 工具另在 OWN_TOOLS 永放行。 */
const READ_ALWAYS = new Set([
  'read', 'grep', 'glob', 'codegraph', 'web_search', 'skill', 'todo_write',
  'get_goal', 'get_context_remaining', 'job_list', 'list_agents',
  'ctx_notes', 'ctx_history', 'ask_user_question', 'new_context',
  'kiro_models', 'kiro_status', 'find_dsh_mall_plugin', 'find_dsh_plugin',
  'plan_map', 'plan_next',
])
const READ_PREFIXES = ['vision_', 'android_pane_'] // 看图/设备观测族（android_pane_* 含设备操作，不属文件 scope 域，放行+观测）

/** 写类工具 → 参数中路径字段（第一版仅模型面写通道 write/edit；未列出的工具一律中性放行）。 */
const WRITE_PATH_TOOLS: Record<string, string[]> = {
  write: ['file_path'],
  edit: ['file_path'],
}

/** 终端/元工具（用户拍板：先放行只记录，不在此判定 scope）。 */
const META_ALLOW = new Set(['bash', 'run_code'])

const OWN_TOOLS = new Set(['plan_map', 'plan_edit', 'plan_next', 'task_update', 'plan_link'])

interface DoingTask { project: string; id: string; title: string; scope: string[] }

export interface GuardOpts {
  stateDir: string
  enforceScope: boolean
  storeOpts: StoreOpts
  onEvent?: EventBroadcast
  log?: (msg: string) => void
}

export type PreDecision = { kind: 'allow' } | { kind: 'deny'; reason: string }

export class ScopeGuard {
  private readonly opts: GuardOpts
  private suspended = false
  /** 项目 → doing 任务快照缓存（2s 节流；L1 单发号硬锁保证每板至多 1 个 doing）。 */
  private cache = new Map<string, { doing: DoingTask[]; at: number }>()
  private lastEventAt = new Map<string, number>()

  constructor(opts: GuardOpts) { this.opts = opts }

  isSuspended(): boolean { return this.suspended }
  setSuspended(v: boolean): boolean { this.suspended = v; return this.suspended }
  state(): { suspended: boolean; enforceScope: boolean } {
    return { suspended: this.suspended, enforceScope: this.opts.enforceScope }
  }

  /** 主入口：同步判定（全部为本地文件读 + 内存匹配，2s 缓存节流）。永不 throw。 */
  decide(toolName: string, args: unknown, agentId: string | undefined): PreDecision | null {
    try {
      if (OWN_TOOLS.has(toolName)) return null // 本插件工具永放行（L2/L3 门自管）
      if (META_ALLOW.has(toolName)) return null // bash/run_code：放行，观测面已记录
      if (READ_ALWAYS.has(toolName)) return null
      if (READ_PREFIXES.some(p => toolName.startsWith(p))) return null
      const pathFields = WRITE_PATH_TOOLS[toolName]
      if (pathFields == null) return null // 未知/中性工具：放行（tool-calls.jsonl 已观测）
      const paths = extractPaths(args, pathFields)
      if (paths.length === 0) return null // 无法提取路径：不误判
      const doing = this.doingTasks()
      if (doing.length === 0) return null // 无进行中任务：无判定上下文，放行
      const withScope = doing.filter(t => t.scope.length > 0)
      if (withScope.length === 0) {
        // doing 任务全部无 scope → 只告警不阻断（用户拍板②）
        this.throttledEvent(doing[0], 'guard_alert', 30_000, {
          taskId: doing[0].id, tool: toolName, agent: agentId ?? 'unknown',
          note: 'doing 任务未声明 scope，L7 仅告警不阻断',
        })
        return null
      }
      for (const t of withScope) {
        for (const p of paths) {
          if (scopePathHit(p, t.scope, t.project) !== '') return null // 任一 doing 任务 scope 命中 → 放行
        }
      }
      // 未命中任何 scope → deny（具名理由）
      const t = withScope[0]
      const p = paths[0]
      const reason = 'dsh-plan-board L7 越界拦截: ' + p + ' 不在当前任务 ' + t.id + '（' + t.title + '）scope [' + t.scope.join(', ') + '] 内。'
        + ' 出路三选一: ① 用 plan_edit update_node 把该路径纳入任务 scope（人类批准后生效）; '
        + '② 人在面板点「暂停拦截」; ③ task_update 切换/收尾当前任务后再做该操作。'
      const enforcing = this.opts.enforceScope && !this.suspended
      const kind = enforcing ? 'guard_block' : 'guard_alert'
      this.throttledEvent(t, kind, 10_000, {
        taskId: t.id, tool: toolName, path: p, scope: t.scope, agent: agentId ?? 'unknown',
        note: enforcing ? null : (this.suspended ? '挂起期间越界放行' : '仅告警模式越界放行'),
      })
      if (!enforcing) return null // 挂起/仅告警模式：放行（事件已留痕）
      return { kind: 'deny', reason }
    } catch (e) {
      try { this.opts.log?.('guard 内部错误已放行: ' + (e instanceof Error ? e.message : String(e))) } catch { /* 静默 */ }
      return null
    }
  }

  /** doing 任务快照：候选项目 = projects.json 记忆 + stateDir/default（工具缺省板）。 */
  private doingTasks(): DoingTask[] {
    const now = Date.now()
    const projects = new Set<string>([join(this.opts.stateDir, 'default')])
    try {
      const f = join(this.opts.stateDir, 'projects.json')
      if (existsSync(f)) {
        const all = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>
        for (const k of Object.keys(all)) if (k.startsWith('/')) projects.add(k)
      }
    } catch { /* 记忆清单读失败不致命 */ }
    const out: DoingTask[] = []
    for (const project of projects) {
      const hit = this.cache.get(project)
      if (hit != null && now - hit.at < 2000) { out.push(...hit.doing); continue }
      let doing: DoingTask[] = []
      try {
        const file = join(project, '.plan-board', 'plan.board.json')
        if (existsSync(file)) {
          const b = JSON.parse(readFileSync(file, 'utf8')) as { nodes?: { id: string; type: string; status: string; title: string; scope?: string[] }[] }
          doing = (b.nodes ?? []).filter(n => n.type === 'task' && n.status === 'doing')
            .map(n => ({ project, id: n.id, title: n.title, scope: Array.isArray(n.scope) ? n.scope.filter(x => typeof x === 'string') : [] }))
        }
      } catch { doing = [] }
      this.cache.set(project, { doing, at: now })
      out.push(...doing)
    }
    return out
  }

  /** guard 事件落板（节流防刷屏；面板经 /stream 实时可见）。 */
  private throttledEvent(t: DoingTask, kind: string, minGapMs: number, payload: Record<string, unknown>): void {
    try {
      const key = t.project + '|' + kind + '|' + String(payload.taskId ?? '')
      const last = this.lastEventAt.get(key) ?? 0
      const now = Date.now()
      if (now - last < minGapMs) return
      this.lastEventAt.set(key, now)
      const store = PlanStore.open(t.project, this.opts.storeOpts, this.opts.onEvent)
      store.addEvent(kind, 'guard:l7', payload)
    } catch { /* 板不存在/读失败：guard 事件不致命 */ }
  }
}

/** 参数中提取路径字段（仅字符串；防原型链）。 */
function extractPaths(args: unknown, fields: string[]): string[] {
  if (args == null || typeof args !== 'object') return []
  const rec = args as Record<string, unknown>
  const out: string[] = []
  for (const f of fields) {
    const v = rec[f]
    if (typeof v === 'string' && v.trim() !== '') out.push(v)
  }
  return out
}

/** scope 路径前缀匹配（与 gitwatch.scopeHit 语义一致：条目=路径前缀，目录以 / 结尾；支持相对 scope 按项目根解析）。 */
export function scopePathHit(filePath: string, scope: string[], projectDir: string): string {
  const abs = isAbsolute(filePath) ? filePath : resolve(projectDir, filePath)
  for (const s of scope) {
    if (typeof s !== 'string' || s.trim() === '') continue
    const sa = isAbsolute(s) ? s : resolve(projectDir, s)
    if (abs === sa || (sa.endsWith('/') && abs.startsWith(sa)) || abs.startsWith(sa + '/')) return s
  }
  return ''
}