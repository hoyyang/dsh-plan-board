# dsh-plan-board

![banner](https://raw.githubusercontent.com/hoyyang/dsh-plan-board/main/assets/banner.svg)

**把整个项目画成一张会自己动的「任务思维导图」，并且让 Agent 真的照着它走——跑偏当场拦下。**

计划 → 模块 → 任务三层展开，跨分支依赖画成紫色箭头，拓扑执行序号实时刷新，Agent 在图上 GPS 站位前行；改图必须过「人审门」才生效，任务完成必须附证据，工具越界被当场 deny，git 里出现计划外改动立即漂移阻断。

[**English**](README.en.md) · [Releases](https://github.com/hoyyang/dsh-plan-board/releases) · [更新日志](CHANGELOG.md) · [设计文档](docs/DESIGN.md)

<p align="center">
  <a href="https://github.com/hoyyang/dsh-plan-board/releases"><img alt="release" src="https://img.shields.io/github/v/release/hoyyang/dsh-plan-board?color=8b5cf6"></a>
  <img alt="dsh" src="https://img.shields.io/badge/dsh-%3E%3D0.1.5--rc.1-38bdf8">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-BSD--3--Clause-green"></a>
  <a href="https://github.com/hoyyang/dsh-plan-board/stargazers"><img alt="stars" src="https://img.shields.io/github/stars/hoyyang/dsh-plan-board?color=f5c542"></a>
</p>

## 安装

```sh
dsh plugin --profile web add github:hoyyang/dsh-plan-board
# 构建产物随仓库提交，免本地构建
```

重启 `dsh web`：会话头部右侧（「⋯ 更多操作」左边）出现 **PlanBoard** 按钮即成功。点它打开面板，填项目根**绝对路径**即可。

```sh
dsh plugin --profile web remove @dsh-external/dsh-plan-board   # 卸载
```

最低 `dsh >= 0.1.5-rc.1`（实测版本）。**零配置**：不需要 API Key，规划数据全部落在你自己的项目目录里。

## 它解决什么问题

Agent 跑偏不是「不听话」，是**没有可执行的计划权威**：计划活在对话里，压缩一次就没了；任务做到哪一步没人知道；说「做完了」也没有证据；改计划不留痕。dsh-plan-board 把计划变成项目里的一份**机器权威文件**（`<项目>/.plan-board/plan.board.json`），再用七层机制让 Agent 只能顺着它走。

## Agent 工具（5 个）

| 工具 | 作用 |
| --- | --- |
| `plan_map` | 读图：模块/任务树 + 依赖 + 拓扑序号 + 站位 + 漂移块 + 待批改动（新会话/压缩后第一件事） |
| `plan_edit` | 改图：结构变更进**待批队列**，人在面板点头才生效（L2 人审门） |
| `plan_next` | 发号：**唯一**下一个可做任务（依赖已就绪 + 优先级排序），当场标记 doing（L1 单发号硬锁） |
| `task_update` | 流转：`planned/ready → doing → done/blocked`；**done 必须附证据**（L3 证据门），模块收卷也走这里 |
| `plan_link` | 对账：经 `ai-memory` 与 `~/.ai` 项目记忆双向同步（push/pull） |

## 防跑偏七层

| 层 | 机制 | 默认 |
| --- | --- | --- |
| L1 | **单发号硬锁**：同时只允许一个 doing；已有进行中任务时 `plan_next` 直接拒绝 | 开 |
| L2 | **改图人审门**：`plan_edit` 结构变更进待批队列，面板「确认生效/驳回」 | 开 |
| L3 | **证据门**：done 不带证据 → `EVIDENCE_REQUIRED`（任务与模块一视同仁） | 开 |
| L4 | **git 交叉核对**：doing 期间的 commit 若不落在任务 `scope` 内 → 漂移告警/阻断 | 开 |
| L5 | **漂移阻断**：存在未处置漂移时拒绝发号，人须在面板「解除阻断」 | 开 |
| L6 | **LLM 仲裁 + watchdog** | M4 未排期 |
| L7 | **工具观测 + 越界拦截**：write/edit 路径未命中当前 doing 任务 scope → 当场 deny（具名理由 + 出路）；看类操作宽放行；bash/run_code 先放行只记录 | 开（`enforceScope: false` 可降级） |

## 功能

- **思维导图面板**：React + 自绘 SVG 横向树，模块分组自动布局；滚轮缩放（原生 non-passive，不带动面板滚动）、拖背景平移、拖拽节点自定义位置（`pos` 仅视图状态，不进 lint）。
- **面板直编辑**：点节点开编辑卡（标题 / 优先级 / 备注 / 验收标准 / scope / 依赖多选）、拖拽、紫点拖出连线改依赖（拖到 B 即 B 依赖它，再拖一次撤销）、＋子任务 / 删除节点。
- **保存门控**：面板上的一切改动先进草稿态（横幅显示「N 项未保存更改」），点「保存更改」才批量 `POST /edit` 落盘并记 `human_edit` 事件；点「放弃」全部回滚。保存前客户端预检环依赖，服务端 lint 兜底；status 不在面板直改（状态流转只走 task_update 的证据门）。
- **模块级依赖真的算数（v0.2.0）**：写在模块上的依赖会向下冒泡到它的子任务——「大任务3 依赖 大任务2」会真正卡住小任务3-1 的发号。模块在「自身 done」或「名下任务全部 done/canceled」时算完成；空模块不自动完成；声明无环但冒泡后成环的死锁会在提交时被 lint 拒绝。
- **实时刷新**：`/stream` NDJSON 推送 + 4s 轮询兜底；待批 diff、漂移横幅、拦截横幅、事件时间线全部实时。
- **入口按钮（会话头部）**：静止时收成 31×31 圆角方形只留银河图标，悬停/键盘聚焦/面板开启时向左展开成完整胶囊（右缘固定，邻居平滑让位）；状态点每 15s 轮询 `GET /state`：青=无进行中 · 琥珀=N 个进行中 · 红=漂移阻断或阻塞 · 灰=未设置路径；收起态由图标光晕颜色继续传达状态。深浅主题同款，`aria-pressed` / `focus-visible` / `prefers-reduced-motion` 齐备。
- **存储**：`<项目>/.plan-board/` 三件套——`plan.board.json`（机器权威，乐观锁 version + SHA-256 digest）、`events.jsonl`（只追加审计流）、`ROADMAP.md`（人读镜像）；加上 `memory.link.json` 与 `~/.ai` 的对账指针。全进 git。
- **~/.ai 强关联**：`plan_link push/pull` 经 `ai-memory` 读写项目记忆，规划记录与叙述性记忆互为索引。

## 数据权威

规划与任务状态以 `.plan-board/plan.board.json` 为**唯一权威**；叙述性记忆以 `~/.ai` 为权威。两者经 `plan_link` 对账，插件**从不直写** canonical 记忆文件。

## 使用

1. **Agent 侧**：新会话/压缩后先 `plan_map`；`plan_next` 领任务（一次一个）；做完 `task_update` 为 done 并附证据；改规划用 `plan_edit`（等人点头）；里程碑后 `plan_link push`。
2. **人类侧**：点头部 **PlanBoard** 按钮开面板 → 填项目根绝对路径 → 待批项「确认生效/驳回」→ 漂移横幅「解除阻断」→ 拦截横幅「暂停拦截/恢复拦截」（内存态，重启恢复拦截）。

## 边界（明确不做）

- 不做看板（Kanban）形态——思维导图是主形态（用户拍板）。
- 不替代 issue tracker：单项目单板，不做多人协作/权限/通知。
- status 不在面板直改（必须走 `task_update` 的证据门）。
- L7 第一版的观测边界：`run_code` 程序内直接 fs、终端任意重定向不经工具通道，无法精确拦截（已按拍板：bash/run_code 先放行只记录，观测面 `tool-calls.jsonl` 全量留痕）。
- 甘特/关键路径视图、LLM 仲裁（M4）未排期。

## 开发

```sh
bash scripts/build.sh            # host：tsc 编译到 lib/（自动探测 DSH_CHECKOUT 或 npm 安装的 dsh）
npm run build:client             # client：tsdown 编译面板（react 为 external）
bash /path/to/dsh-plugin-build/scripts/boot-check.sh web   # 冷启动三故障静态检测
```

改完源码请把 `lib/` 一起提交（GitHub 安装依赖它）。

## 卸载

```sh
dsh plugin --profile web remove @dsh-external/dsh-plan-board
```

卸载**不会**删除你项目里的 `.plan-board/` 数据；彻底清除请手动删除该目录。

## License

BSD-3-Clause
