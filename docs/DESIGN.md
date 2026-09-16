# DESIGN: dsh-plan-board — 设计卡 v2（定稿基线）

> 本文件自 hyperaitools 会话记忆迁入插件 docs/（任务归属 DSH 工作区）。
> 完整内容见会话记录与 ctx_notes；此处为验收基线摘要。

## 定位
把整个项目画成一张会自己动的「任务思维导图」：计划→模块→任务分层展开，依赖箭头+执行序号+状态色实时刷新；Agent 在图上 GPS 站位前行，改图必留痕必过审，跑偏即警报可阻断；~/.ai 记忆 100% 关联。

## 已实现（M1，已转正）
- 5 工具：plan_map / plan_edit / plan_next / task_update / plan_link
- 防跑偏：L1 单发号硬锁 / L2 改图人审门 / L3 证据门 / L4 git 交叉核对(实测 block) / L5 漂移阻断(默认开) / L7 工具调用观测
- 存储：.plan-board/ 双态文件（plan.board.json 乐观锁+SHA256 / events.jsonl / ROADMAP.md 镜像 / memory.link.json）
- 面板：shell.overlay 思维导图（树+依赖虚线+拓扑badge+站位呼吸）+ 待批确认/驳回 + 漂移横幅 + 事件时间线；2s 轮询

## M2 队列
1. ✅ 流式实时（/stream NDJSON 推送替代轮询）+ 主题跟随（app 主题）
2. ✅ L7 阻断级（2026-09-09 用户拍板：看类宽放行 / write-edit 越界当场拦 / bash-run_code 先放行只记录；src/guard.ts + 面板挂起开关；enforceScope 默认 true）
3. ✅ 面板直编辑（2026-09-11 真机验收 6/6 通过 + 3 项缺陷修复复验，POST /edit 人类权威）
4. 甘特/关键路径/LLM 仲裁(M4)

## M2 第三批：面板直编辑（2026-09-11 验收定稿）

交互（用户拍板「最完整、最丝滑」）：点节点出编辑卡（标题/优先级/备注/验收标准/scope/依赖多选/删除节点，模块卡带 ＋子任务）· 自由拖拽节点（pos 持久化）· 紫点拖出连线改依赖（拖到 B = B 依赖此任务，再拖一次 = 移除）· **一切改动草稿态，「保存更改」批量 POST /edit 才落盘，「放弃」全回滚**。

架构：`src/client/index.ts` 单文件面板（React + 自绘 SVG）。状态机 = 服务端态 data + 草稿 drafts（fields/pos）+ added − removed → effNodes；layout 在 PaneWindow 计算后传给纯展示的 MindMap（指针事件：节点拖拽 / 紫点连线 / 点击开卡，靠 moved 阈值 3px 区分点击与拖拽）；保存 = adds → updates → removes 批量 ops。

验收证据（真机 Playwright，20 张截图在 `.dsh/planboard-acceptance/`）：改标题→保存 v11 / 拖拽→dirty→保存 pos 落盘 v12 / 紫点连线→deps 生效 + 紫色虚线 2→3 v13 / ＋子任务 add_node v16 + 删除 remove_node v17 / 环依赖当场拒绝（无 /edit 请求）/ 放弃全回滚；测试痕迹已用面板与 /edit 回滚（v18–v19），板子语义与验收前一致。

验收暴露并修复的 3 个缺陷（修复后已复验：编辑卡打开时导图仍满高 429px 且可点 / 滚轮缩放 0 条控制台报错且面板不滚动 / 重叠区落点解析到视觉最上层节点 t-gantt）：
- **P1 导图被编辑卡挤扁**：.pb-body 是 flex column，.pb-map 可收缩 → 打开编辑卡后导图被压到 0–2px（看不见也点不到）。修：.pb-map{flex:0 0 auto}；编辑卡仅在标题行完全出视野时才滚动，正常不跳屏（导图与卡片同时可见可点）。
- **P2 滚轮 preventDefault 失效**：React 合成 wheel 走根节点 passive 注册 → 控制台报错且缩放与面板滚动叠加。修：mapRef + 原生 addEventListener('wheel', …, {passive:false})。
- **P3 落点与绘制序不一致**：拖线落点原按 layout.items 数组序 find，而点击按 DOM 命中（最上层）→ 会出现「拖到 A 却落到 B」。修：落点改用 document.elementFromPoint().closest('.pb-node') + 节点 data-id；并在 layout 中把有 pos 的节点（人手工摆过）排到最后绘制 = 盖在最上层，绘制序 / 点击序 / 落点序三者统一。

构建门禁修复：dsh 0.1.5 起 dsh-tools 不再 re-export JsonValue（改为从 dsh-util-values 引入）→ src/tools.ts 继续 import 会让 host tsc 变红（TS2614）；改为本地等价类型定义，host tsc + tsdown 双绿。src/client 不在 tsconfig include 内，改面板必须另跑 npm run build:client（rolldown 比 tsc 严）。

## 入口按钮 UI 美术升级（2026-09-11，v0.1.0）

用户拍板方向 **A 极光玻璃 + C 能量核心**，硬约束：**按钮高度与圆角轮廓必须与同槽位「Android 面板」一致**。

业界扫描结论（门 9 纪要）：无现成「DSH 按钮美化」插件可装 → 借鉴改造。参照物 = 本机同槽位邻居 `@dsh-external/dsh-android-pane`（31px 胶囊 / 渐变底 / 17px 内联 SVG 图标 / hover 上浮 / shine 扫光 / 状态点 / aria-pressed 开启态），叠加业界成熟 CSS 手法（conic-gradient + mask 挖空做 1px 流光描边环、radial 三点极光、SVG 轨道虚线流动）；对照组 `dsh-ui-harmonizer`（统一到官方 token）、`zampie/sakura-afternoon-skin`（header 控件换肤先例）。差异点：左邻按钮「设备在线数」+ 本按钮「板子状态点」，两枚都做到**状态一眼可见**，且用青紫调与邻居的青绿调互补而不抢戏。

几何对齐（实测 computed style）：入口按钮 31px / border-radius 999px / 顶线 y=11，邻居 31px / 999px / y=11 → `sameHeight=true sameRadius=true alignedTop=true`。

实现要点（全在 `src/client/index.ts`，无新增依赖、无 host 改动、无 config 变更）：
- 结构：`.pb-entry`（button）内含 `.pb-aurora`(三点径向极光层) + `.pb-ring`(悬停时的 conic 流光环，mask-composite:exclude 挖成 1px) + `.pb-orb`(18px SVG：光晕 + 倾斜 22° 的渐变轨道环 + 双卫星 + 亮核心) + `.pb-label` + `.pb-dot`(状态点) + `.pb-shine`(扫光)。
- **静止描边**用双背景技巧实现：`background: <近黑玻璃> padding-box, <青→紫→洋红 112° 渐变> border-box` + `border:1px solid transparent` —— 描边常亮，与概念稿 A 一致；hover 时叠一层旋转 conic 流光。注意：hover/开启态**不能**再写 `border-color`，否则会盖掉渐变描边。
- **主题策略（2026-09-11 修正）**：按钮在深浅主题下保持**同一套深色极光玻璃**（`#080b14→#0b0918→#120a20` 内层），浅色主题只加强外发光（`0 2px 14px rgba(56,189,248,.40)` + `0 2px 22px rgba(232,121,249,.30)`）。原因：初版浅色主题反白成粉彩玻璃，与用户拍板看到的概念稿（深色画布上的霓虹玻璃）不一致 —— 实测两主题 `backgroundImage` 现已完全相同、几何 sameHeight/sameRadius/alignedTop 全 true。
- 图标细节：核心 r2.6 径向渐变（#fff→#ddd6fe→#7c3aed）+ 光晕 r6.5（#a855f7 半径衰减）+ 轨道 ellipse rx7.4/ry2.9 旋转 -22°、静止为实线（1px 清晰）、悬停转 `4 3` 流动虚线（0.8s/圈、offset -14）。初版静止即虚线 + ry3.1 + 核心 r3.4，5× 放大后糊成一团，已按 5× 探针截图修正。
- 交互预算：hover `translateY(-1.5px) scale(1.05)` + 紫/青双层辉光 + ring 旋转 2.6s + core 加速到 1.1s + orb `scale(1.18) rotate(-6deg)`；active `scale(.94)`（0.06s）；开启态 `.pb-on` = ring 常转 + 极光饱和呼吸；`focus-visible` 紫色焦点环；`prefers-reduced-motion` 全降级。
- 状态点：15s 轮询 `GET /state`（复用面板 localStorage `planboard.project`），青/琥珀/红/灰四态 + `title`/`aria-label` 附版本号、进行中数量、Agent 站位；主题沿用 `appDark()` 采样，深浅两套（浅色底极光加浓，避免白底冲淡）。

证据（`.dsh/planboard-acceptance/`）：`UI-1..UI-3` 三态元素截图 + computed style 四态快照（default 无变换/ring 0 → hover matrix(1.05,…,-1.5)+ring 1 spin2.6s+core1.1s → active matrix(0.94) → 点击后 `pb-entry pb-on` + 面板打开）；`UI-5` 深色分支代理截图（mean rgb(89,82,128)、89% 彩色像素、色相 270°/210°/240°/300°）；`UI-7/UI-8` 工具条实景（默认/悬停）；像素统计：浅色默认 mean rgb(212,207,240)、44% 彩色像素、主色相 270°(紫)+210°(青) —— 与设计的极光调一致。

**门 4 迭代测试暴露的两处环境级残留（非本插件代码缺陷，附自愈命令）**：
- 卸载后 profile（dependencies/bundles/junction/loader entry/client 模块表）全清 ✓，但 **HTTP 前缀路由仍存活**（`GET /_dsh/dsh-plan-board/state` 仍 200）→ 需 `dev_clear_routes /_dsh/dsh-plan-board` 清零（本插件 `apply()` 的 dispose 已正确串联 `mountRoutes` 返回的 unregister，属路由表实现层现象）。
- `dev_uninject_plugin` 后再 `dev_install_package`，entry 报「已存在（跳过 create）」但不会自动重新激活 → 需补一次 `dev_reload_package dsh-plan-board` 才恢复路由与前端。重装幂等本身通过（第二次 install 全项「已存在（跳过）」，bundles 计数 16 无重复）。
## v0.2.0 增量（2026-09-15，已发布）

### 模块级依赖参与发号（用户拍板语义）

- **问题**：`readyTasks` 只看 task 自身的 deps，写在模块上的依赖不产生任何约束 → 真人演示时「大任务3 依赖 大任务2」被静默忽略（t31 照发）。
- **语义**：有效依赖 = 自身 deps ∪ 全部祖先模块 deps（向下冒泡）；模块「完成」= 显式 done **或**（名下 task ≥ 1 且全部 done/canceled）；空模块不自动完成（防白送通过）。
- **实现**（`src/schema.ts`）：`ancestorModules` / `moduleComplete` / `depSatisfied`（模块感知）/ `effectiveDeps` / `unmetDeps` / `effectiveCycle`（边集 = 有效依赖 ∪ **模块→子任务隐含边**，这才是「模块依赖死锁」的真实来源）/ `effectiveTaskDeps` + `topoOrder` 纳入模块约束；`src/tools.ts`：`plan_next` 无任务可发时给出具名等待理由（`t31 ← m2`），`task_update` 支持 module 收卷（`moduleTransitionOk`：`planned ⇄ done`、`→ canceled`，done 受 L3 证据门）。
- **lint 新增**：声明图无环但冒泡后成环 → 拒绝；task 依赖自己的祖先模块 → 拒绝。
- **回归证据**：`/tmp/pb-module-deps.mjs` **12/12 PASS**（A 模块未满足时 t31 不发号 / A2 该板 lint 全绿 / B 子任务全 done → 自动完成 / B2 canceled 也算收卷 / C 显式 done / D 空模块不自动完成 / E 空模块显式 done / F 祖先模块自依赖报错 / G 冒泡后死锁报错 / H 拓扑序号 / I 普通 deps 回归 / J 有效依赖集合）。

### 入口按钮收起/展开（0A 增量扫描 + 技法选型）

- **0A 增量扫描结论**：生态内没有可装的「收起/展开胶囊」插件（沿用 2026-09-11 的「借鉴改造」路线）；参照物 = 同槽位邻居 `@dsh-external/dsh-android-pane`（31px 胶囊基线，实测）、会话头部「⋯ 更多操作」（28px，右邻）、业界 `shadcnblocks Button Morph Expand` 系列与 CSS Grid `0fr/1fr` 补间手法（[transition on grid-template-columns fr](https://stackoverflow.com/questions/79198554/transition-on-grid-template-columns-fr-to-px-value)、[smooth hover transitions with grid/flex](https://www.devgem.io/posts/creating-smooth-hover-transitions-with-css-grid-and-flexbox)）。
- **选型**：**不用** grid `0fr`（label 是固定短词，量一次宽度更准），改为「JS 量 `.pb-label` 的 `offsetWidth` → 写 `--pb-lw` → 裁剪容器 `max-width: 0 ⇄ var(--pb-lw)` 过渡」，与 padding / margin-left / border-radius / 状态点宽度一起补间（`cubic-bezier(.22,1,.36,1)` 420ms）。量宽的巧妙点：裁剪容器 `max-width:0` 时内部 inline-block 仍按自然宽度布局，`offsetWidth` 读得到真实文字宽 → 补间**全程都在动**，没有「先空转后跳变」的死区。
- **几何**：静止 31×31（padding 5.5 + border 1 + 图标 18）；展开 padding `0 12px 0 10px`。**圆角两态同为 15.5px（= 高度一半）** —— 2026-09-16 用户实测截图指出「收起 11px / 展开 15.5px 弧度不一致」，已统一：收起为**正圆**、展开为胶囊，弧度全程不动（隔离 harness 复测：collapsed 31×31 r15.5 / expanded 125×31 r15.5，sameRadius=true）。
- **右缘固定的实现依据**：`.wSkVaW_headerUtilities{display:flex;gap:8px}`，按钮是流内 flex item，右邻是含「⋯」与删除会话的 wrapper → 实测 collapsed/expanded 的 `right` **均为 1160**、「⋯」的 x **恒为 1168**、两者间距**恒 8px**；展开时左邻「Android 面板」x 978 → 882 平滑让位（预期副作用）。
- `transform-origin:100% 50%`：让 hover 的 `scale(1.05)` 只向左生长（修前 right 会被推 1160→1163）。
- **收起态的状态语义**：状态点宽度归零让位给**图标光晕颜色**（`--pb-stat` 由 `data-stat` 切换，SVG `<stop class="pb-halo-stop">` 用 `stop-color:var(--pb-stat)` 接管），标题与 aria-label 仍带完整状态文案。
- **证据**：四张实拍截图 `/tmp/pb-btn-collapsed.png` / `-expanded.png` / `-collapsed-light.png` / `-expanded-light.png`（亲眼复核，两主题同款深色玻璃）；实测 JSON：collapsed `w31 h31 r11 right1160`、expanded `w133.9 r15.5 right1160`、`gapToDots` 恒 8、`rightEdgeFixed=true`、`dotsFixed=true`；展开宽度采样 `33 → 80.6 → 109.5 → 123.1 → 129.7 → 132.7 → 133.7 → 133.8 → 133.9`（单调、无死区）。

### 发布（2026-09-15）

- GitHub 公开仓 + topics `dsh-plugin`：https://github.com/hoyyang/dsh-plan-board
- Release `v0.2.0` 附预构建 tgz（81,221 B，sha256 `e651d2d1…`）
- 隔离验证：`DSH_HOME=~/.dsh-staging dsh plugin --profile web add github:hoyyang/dsh-plan-board` → 装到 `@dsh-external/dsh-plan-board@0.2.0`，staging boot-check 本插件行 PASS（同批发现 dsh-concise 在 staging 缺 `cordis.patch.yml` → 其 GitHub 安装路径有重启风险，与本插件无关）

## 精华借鉴
archify（typed spec+校验门/端口契约/frozen digest/viewer 能力清单）· claude-task-master（DAG+next-task）· Backlog.md（计划即文件）· DSH-taskboard（人审门哲学）· tutask/RoadRaven（形态印证）· 引擎：React + 自绘 SVG（React Flow/ELK 备选）
