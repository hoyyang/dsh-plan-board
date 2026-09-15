window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-plan-board",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
		/**
		* dsh-plan-board client：右侧停靠面板（shell.overlay）+ 侧栏入口（header.utilities）。
		* 两必坑（骨架实测）：apply 用 ctx.slots 必须 export const inject = ['slots']；register 必带 name。
		* M2 第一批：/stream NDJSON 实时 + 主题跟随（采样 body 亮度）。
		* M2 第三批（本文件主体）：面板直编辑——点选节点出编辑卡（标题/备注/验收/scope/优先级/依赖多选）、
		* 自由拖拽节点（位置持久化 pos）、拖拽连线改依赖（A 拖到 B = B 依赖 A，再拖一次 = 移除）、
		* ＋子任务 / 删除节点；一切改动先进草稿态，点「保存更改」才 POST /edit 生效（用户拍板：不保存不生效）。
		*/
		const NS = "dsh-plan-board";
		const API = "/_dsh/dsh-plan-board";
		const POLL_MS = 4e3;
		const STATUS_COLOR = {
			planned: "#94a3b8",
			ready: "#3b82f6",
			doing: "#f59e0b",
			blocked: "#ef4444",
			done: "#10b981",
			canceled: "#6b7280"
		};
		let openState = false;
		function togglePanel() {
			openState = !openState;
			window.dispatchEvent(new CustomEvent("planboard:toggle"));
		}
		/** 主题跟随：采样 app body 实际背景亮度；异常时退回系统偏好。 */
		function appDark() {
			try {
				const bg = getComputedStyle(document.body).backgroundColor;
				const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
				if (m != null) return (.299 * Number(m[1]) + .587 * Number(m[2]) + .114 * Number(m[3])) / 255 < .5;
			} catch {}
			return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
		}
		const CSS = [
			".pb-panel{--pb-bg:#f8fafc;--pb-ink:#0f172a;--pb-line:#e2e8f0;--pb-card:#ffffff;--pb-muted:#64748b;",
			"position:fixed;top:0;right:0;bottom:0;width:min(560px,46vw);z-index:60;display:flex;flex-direction:column;",
			"background:var(--pb-bg);color:var(--pb-ink);border-left:1px solid var(--pb-line);box-shadow:-8px 0 24px rgba(15,23,42,.10)}",
			".pb-panel[data-mode=\"dark\"]{--pb-bg:#0f141c;--pb-ink:#e2e8f0;--pb-line:#1e293b;--pb-card:#151b26;--pb-muted:#7c8798}",
			".pb-head{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--pb-line)}",
			".pb-title{font-weight:700;font-size:13px;letter-spacing:.4px}",
			".pb-input{flex:1;min-width:0;font:12px/1.4 ui-monospace,monospace;padding:5px 8px;border-radius:8px;",
			"border:1px solid var(--pb-line);background:var(--pb-card);color:var(--pb-ink)}",
			".pb-btn{cursor:pointer;padding:5px 12px;border-radius:8px;font-size:12px;font-weight:600;",
			"border:1px solid var(--pb-line);background:var(--pb-card);color:var(--pb-ink)}",
			".pb-btn:hover{filter:brightness(1.08)}",
			".pb-btn.pb-ok{background:#10b981;border-color:#10b981;color:#fff}",
			".pb-btn.pb-no{background:#ef4444;border-color:#ef4444;color:#fff}",
			".pb-btn.pb-vio{background:#8b5cf6;border-color:#8b5cf6;color:#fff}",
			".pb-btn:disabled{opacity:.5;cursor:not-allowed}",
			".pb-body{flex:1;min-height:0;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px}",
			".pb-banner{padding:8px 12px;border-radius:10px;font-size:12px;font-weight:600;display:flex;gap:8px;align-items:center}",
			".pb-banner.pb-drift{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.5);color:#ef4444}",
			".pb-banner.pb-appr{background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.45);color:#b45309}",
			"[data-mode=\"dark\"] .pb-banner.pb-appr{color:#fbbf24}",
			".pb-banner.pb-guard{background:rgba(139,92,246,.10);border:1px solid rgba(139,92,246,.5);color:#7c3aed}",
			"[data-mode=\"dark\"] .pb-banner.pb-guard{color:#a78bfa}",
			".pb-banner.pb-hold{background:rgba(100,116,139,.10);border:1px dashed rgba(100,116,139,.55);color:#64748b}",
			"[data-mode=\"dark\"] .pb-banner.pb-hold{color:#94a3b8}",
			".pb-banner.pb-dirty{background:rgba(245,158,11,.14);border:1px solid rgba(245,158,11,.6);color:#b45309;position:sticky;top:0;z-index:5}",
			"[data-mode=\"dark\"] .pb-banner.pb-dirty{color:#fbbf24}",
			".pb-card{background:var(--pb-card);border:1px solid var(--pb-line);border-radius:10px;padding:8px 10px;font-size:12px}",
			".pb-sec{font-size:11px;font-weight:700;letter-spacing:1px;color:var(--pb-muted);text-transform:uppercase}",
			".pb-ev{display:flex;gap:8px;font:11px ui-monospace,monospace;color:var(--pb-muted);padding:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".pb-station{animation:pb-pulse 1.6s ease-in-out infinite}",
			"@keyframes pb-pulse{0%,100%{opacity:.35}50%{opacity:1}}",
			".pb-map{flex:0 0 auto;background:var(--pb-card);border:1px solid var(--pb-line);border-radius:12px;overflow:hidden;cursor:grab}",
			".pb-map text{font-family:ui-sans-serif,system-ui,sans-serif;fill:var(--pb-ink,#0f172a)}",
			".pb-node{cursor:grab}",
			".pb-node.pb-dragging{cursor:grabbing}",
			".pb-handle{cursor:crosshair}",
			".pb-hint{font-size:11px;color:var(--pb-muted);line-height:1.6}",
			".pb-form{display:flex;flex-direction:column;gap:8px}",
			".pb-form label{display:flex;flex-direction:column;gap:3px;font-size:11px;font-weight:600;color:var(--pb-muted)}",
			".pb-form input,.pb-form textarea,.pb-form select{font:12px/1.5 ui-sans-serif,system-ui,sans-serif;padding:5px 8px;border-radius:8px;",
			"border:1px solid var(--pb-line);background:var(--pb-bg);color:var(--pb-ink)}",
			".pb-form textarea{min-height:44px;resize:vertical;font:12px/1.5 ui-monospace,monospace}",
			".pb-deprow{display:flex;align-items:center;gap:6px;font-size:12px;padding:2px 0}",
			".pb-dot{width:6px;height:6px;border-radius:50%;background:#f59e0b;display:inline-block}",
			".pb-entry{--pb-ease:cubic-bezier(.22,1,.36,1);--pb-dur:.42s;--pb-stat:#a855f7;",
			"position:relative;display:inline-flex;align-items:center;gap:0;box-sizing:border-box;height:31px;padding:0 5.5px;",
			"border-radius:11px;cursor:pointer;overflow:hidden;user-select:none;vertical-align:middle;line-height:1;",
			"font-size:12.5px;font-weight:600;letter-spacing:.2px;color:#f3f7ff;border:1px solid transparent;",
			"background:linear-gradient(135deg,#080b14 0%,#0b0918 55%,#120a20 100%) padding-box,linear-gradient(112deg,#22d3ee 0%,#38bdf8 24%,#8b5cf6 58%,#e879f9 100%) border-box;",
			"box-shadow:0 0 0 1px rgba(139,92,246,.20),0 2px 12px rgba(56,189,248,.30),0 2px 18px rgba(232,121,249,.24),inset 0 0 14px rgba(124,58,237,.35),inset 0 1px 0 rgba(255,255,255,.07);",
			"transition:transform .16s cubic-bezier(.34,1.56,.64,1),box-shadow .28s,filter .28s,padding var(--pb-dur) var(--pb-ease),border-radius var(--pb-dur) var(--pb-ease)}",
			".pb-entry[data-stat=\"clean\"]{--pb-stat:#22d3ee}",
			".pb-entry[data-stat=\"work\"]{--pb-stat:#f59e0b}",
			".pb-entry[data-stat=\"block\"]{--pb-stat:#ef4444}",
			".pb-entry[data-stat=\"none\"]{--pb-stat:#94a3b8}",
			".pb-entry .pb-halo-stop{stop-color:var(--pb-stat)}",
			".pb-entry[data-mode=\"light\"]{box-shadow:0 0 0 1px rgba(139,92,246,.22),0 2px 14px rgba(56,189,248,.40),0 2px 22px rgba(232,121,249,.30),inset 0 0 14px rgba(124,58,237,.35),inset 0 1px 0 rgba(255,255,255,.08)}",
			".pb-entry .pb-aurora{position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:.85;transition:opacity .3s;",
			"background:radial-gradient(58% 120% at 12% 18%,rgba(34,211,238,.36),transparent 62%),radial-gradient(52% 128% at 88% 30%,rgba(232,121,249,.32),transparent 64%),radial-gradient(72% 140% at 50% 128%,rgba(139,92,246,.32),transparent 66%)}",
			".pb-entry .pb-ring{position:absolute;inset:0;border-radius:inherit;padding:1px;opacity:0;transition:opacity .25s;pointer-events:none;",
			"background:conic-gradient(from 0deg,transparent 0 40%,rgba(34,211,238,.95) 58%,rgba(139,92,246,1) 72%,rgba(232,121,249,.95) 86%,transparent 100%);",
			"-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;",
			"mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude}",
			".pb-entry.pb-on .pb-ring,.pb-entry:hover .pb-ring{opacity:1;animation:pb-ring-spin 2.6s linear infinite}",
			"@keyframes pb-ring-spin{to{transform:rotate(360deg)}}",
			".pb-entry .pb-shine{position:absolute;top:-20%;left:-65%;width:38%;height:140%;pointer-events:none;opacity:0;",
			"background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-18deg)}",
			".pb-entry:hover .pb-shine{animation:pb-shine .9s ease}",
			"@keyframes pb-shine{0%{left:-65%;opacity:.9}100%{left:135%;opacity:0}}",
			".pb-entry .pb-orb{position:relative;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex:none;",
			"transition:transform .2s cubic-bezier(.34,1.56,.64,1)}",
			".pb-entry .pb-orb svg{width:18px;height:18px;display:block;overflow:visible}",
			".pb-entry .pb-core{transform-box:fill-box;transform-origin:center;animation:pb-core 2.8s ease-in-out infinite}",
			"@keyframes pb-core{0%,100%{transform:scale(1);opacity:.92}50%{transform:scale(1.18);opacity:1}}",
			"@keyframes pb-dash{to{stroke-dashoffset:-14}}",
			".pb-entry .pb-sat{transform-box:fill-box;transform-origin:center;animation:pb-sat 2.8s ease-in-out infinite}",
			".pb-entry .pb-sat.s2{animation-delay:.45s}",
			"@keyframes pb-sat{0%,100%{transform:scale(.72);opacity:.5}50%{transform:scale(1.15);opacity:1}}",
			".pb-entry:hover .pb-orb{transform:rotate(-6deg)}",
			".pb-entry:hover .pb-core{animation-duration:1.1s}",
			".pb-entry:hover .pb-orbit{stroke-dasharray:4 3;animation:pb-dash .8s linear infinite}",
			".pb-entry .pb-lwrap{display:inline-block;overflow:hidden;max-width:0;margin-left:0;transition:max-width var(--pb-dur) var(--pb-ease),margin-left var(--pb-dur) var(--pb-ease)}",
			".pb-entry:hover .pb-lwrap,.pb-entry:focus-visible .pb-lwrap,.pb-entry.pb-on .pb-lwrap{max-width:var(--pb-lw,62px);margin-left:7px}",
			".pb-entry .pb-label{display:inline-block;white-space:nowrap;opacity:0;transform:translateX(-5px);transition:opacity .2s ease,transform .34s var(--pb-ease);",
			"text-shadow:0 1px 6px rgba(6,8,20,.75),0 0 12px rgba(139,92,246,.35)}",
			".pb-entry:hover .pb-label,.pb-entry:focus-visible .pb-label,.pb-entry.pb-on .pb-label{opacity:1;transform:none;transition-delay:.07s}",
			".pb-entry .pb-dot{width:0;height:7px;margin-left:0;opacity:0;border-radius:50%;flex:none;background:#94a3b8;",
			"transition:width var(--pb-dur) var(--pb-ease),margin-left var(--pb-dur) var(--pb-ease),background .25s,box-shadow .25s,opacity .3s}",
			".pb-entry:hover .pb-dot,.pb-entry:focus-visible .pb-dot,.pb-entry.pb-on .pb-dot{width:7px;margin-left:7px;opacity:1}",
			".pb-entry .pb-dot.pb-clean{background:#22d3ee;box-shadow:0 0 6px rgba(34,211,238,.65)}",
			".pb-entry .pb-dot.pb-work{background:#f59e0b;box-shadow:0 0 8px rgba(245,158,11,.75);animation:pb-dot 2s ease-in-out infinite}",
			".pb-entry .pb-dot.pb-block{background:#ef4444;box-shadow:0 0 9px rgba(239,68,68,.85);animation:pb-dot 1.1s ease-in-out infinite}",
			"@keyframes pb-dot{0%,100%{opacity:1}50%{opacity:.45}}",
			".pb-entry .pb-dot.pb-none{background:#94a3b8;opacity:.55}",
			".pb-entry:hover,.pb-entry:focus-visible,.pb-entry.pb-on{padding:0 12px 0 10px;border-radius:15.5px;transform:translateY(-1.5px);filter:brightness(1.12);",
			"box-shadow:0 0 0 1px rgba(168,85,247,.45),0 6px 26px rgba(124,58,237,.55),0 0 26px rgba(56,189,248,.40),0 0 30px rgba(232,121,249,.32),inset 0 0 18px rgba(124,58,237,.45)}",
			".pb-entry:active{transform:translateY(0);transition-duration:.06s;",
			"box-shadow:0 1px 6px rgba(99,102,241,.4),inset 0 1px 0 rgba(255,255,255,.12)}",
			".pb-entry:focus-visible{outline:2px solid rgba(168,85,247,.75);outline-offset:2px}",
			".pb-entry.pb-on{box-shadow:0 0 0 1px rgba(168,85,247,.55),0 2px 16px rgba(124,58,237,.50),0 0 20px rgba(56,189,248,.28),inset 0 0 16px rgba(124,58,237,.45)}",
			".pb-entry.pb-on .pb-aurora{opacity:1;animation:pb-aurora 3.2s ease-in-out infinite}",
			"@keyframes pb-aurora{0%,100%{opacity:.8;filter:saturate(1)}50%{opacity:1;filter:saturate(1.35)}}",
			"@media (prefers-reduced-motion:reduce){.pb-entry,.pb-entry *{animation:none!important;transition:none!important}}"
		].join("\n");
		function ensureStyles() {
			if (document.getElementById("planboard-css") != null) return;
			const el = document.createElement("style");
			el.id = "planboard-css";
			el.textContent = CSS;
			document.head.appendChild(el);
		}
		async function post(path, body) {
			return await (await fetch(API + path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			})).json();
		}
		/**
		* 入口按钮（A 极光玻璃 + C 能量核心）：高度 31px、胶囊圆角 999px，与同槽位「Android 面板」严格对齐。
		* 状态点数据来自 GET /state（15s 轮询 + 主题跟随），未设置项目路径时退化为灰点。
		*/
		function PaneSidebarButton() {
			ensureStyles();
			const [on, setOn] = (0, react.useState)(openState);
			const [mode, setMode] = (0, react.useState)(appDark() ? "dark" : "light");
			const [stat, setStat] = (0, react.useState)({
				kind: "none",
				tip: "未设置项目路径"
			});
			const btnRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const btn = btnRef.current;
				const label = btn?.querySelector(".pb-label");
				if (btn == null || label == null) return;
				const w = label.offsetWidth;
				if (w > 0) btn.style.setProperty("--pb-lw", w + "px");
			}, []);
			(0, react.useEffect)(() => {
				const f = () => setOn(openState);
				window.addEventListener("planboard:toggle", f);
				return () => window.removeEventListener("planboard:toggle", f);
			}, []);
			(0, react.useEffect)(() => {
				let stop = false;
				const tick = async () => {
					if (stop) return;
					setMode(appDark() ? "dark" : "light");
					const project = localStorage.getItem("planboard.project") ?? "";
					if (!project.startsWith("/")) {
						setStat({
							kind: "none",
							tip: "未设置项目路径（点开面板填写）"
						});
						return;
					}
					try {
						const j = await (await fetch(API + "/state?project=" + encodeURIComponent(project))).json();
						if (stop) return;
						if (j.ok !== true || j.board == null) {
							setStat({
								kind: "none",
								tip: "未找到 .plan-board/（先跑 plan_edit init_board）"
							});
							return;
						}
						const nodes = j.board.nodes ?? [];
						const doing = nodes.filter((n) => n.status === "doing").length;
						const blocked = nodes.filter((n) => n.status === "blocked").length;
						const drift = j.board.driftBlock != null;
						const kind = drift || blocked > 0 ? "block" : doing > 0 ? "work" : "clean";
						const head = drift ? "漂移阻断中" : doing > 0 ? doing + " 个进行中" : blocked > 0 ? blocked + " 个阻塞" : "无进行中任务";
						setStat({
							kind,
							tip: "v" + (j.board.version ?? "?") + " · " + head + (j.station != null ? " · 站位 " + j.station : "")
						});
					} catch {
						if (!stop) setStat({
							kind: "none",
							tip: "读取板子失败"
						});
					}
				};
				tick();
				const t = setInterval(() => {
					tick();
				}, 15e3);
				return () => {
					stop = true;
					clearInterval(t);
				};
			}, []);
			const orb = (0, react.createElement)("span", {
				className: "pb-orb",
				key: "orb",
				"aria-hidden": "true"
			}, (0, react.createElement)("svg", { viewBox: "0 0 18 18" }, (0, react.createElement)("defs", { key: "defs" }, (0, react.createElement)("linearGradient", {
				id: "pb-orb-orbit",
				x1: "0",
				y1: "0",
				x2: "1",
				y2: "0"
			}, (0, react.createElement)("stop", {
				key: "o1",
				offset: "0",
				stopColor: "#22d3ee"
			}), (0, react.createElement)("stop", {
				key: "o2",
				offset: "1",
				stopColor: "#e879f9"
			})), (0, react.createElement)("radialGradient", {
				id: "pb-orb-core",
				cx: ".42",
				cy: ".38",
				r: ".68"
			}, (0, react.createElement)("stop", {
				key: "c1",
				offset: "0",
				stopColor: "#ffffff"
			}), (0, react.createElement)("stop", {
				key: "c2",
				offset: ".34",
				stopColor: "#ddd6fe"
			}), (0, react.createElement)("stop", {
				key: "c3",
				offset: "1",
				stopColor: "#7c3aed"
			})), (0, react.createElement)("radialGradient", {
				id: "pb-orb-halo",
				cx: ".5",
				cy: ".5",
				r: ".5"
			}, (0, react.createElement)("stop", {
				key: "h1",
				className: "pb-halo-stop",
				offset: "0",
				stopOpacity: ".55"
			}), (0, react.createElement)("stop", {
				key: "h2",
				offset: "1",
				stopColor: "#a855f7",
				stopOpacity: "0"
			}))), (0, react.createElement)("circle", {
				key: "halo",
				cx: 9,
				cy: 9,
				r: 6.5,
				fill: "url(#pb-orb-halo)"
			}), (0, react.createElement)("g", {
				key: "ring",
				transform: "rotate(-22 9 9)"
			}, (0, react.createElement)("ellipse", {
				key: "flow",
				className: "pb-orbit",
				cx: 9,
				cy: 9,
				rx: 7.4,
				ry: 2.9,
				fill: "none",
				stroke: "url(#pb-orb-orbit)",
				strokeWidth: 1
			}), (0, react.createElement)("circle", {
				key: "sat1",
				className: "pb-sat",
				cx: 1.6,
				cy: 9,
				r: 1.25,
				fill: "#22d3ee"
			}), (0, react.createElement)("circle", {
				key: "sat2",
				className: "pb-sat s2",
				cx: 16.4,
				cy: 9,
				r: 1.25,
				fill: "#e879f9"
			})), (0, react.createElement)("circle", {
				key: "core",
				className: "pb-core",
				cx: 9,
				cy: 9,
				r: 2.6,
				fill: "url(#pb-orb-core)"
			})));
			const dotCls = "pb-dot " + (stat.kind === "clean" ? "pb-clean" : stat.kind === "work" ? "pb-work" : stat.kind === "block" ? "pb-block" : "pb-none");
			return (0, react.createElement)("button", {
				className: "pb-entry" + (on ? " pb-on" : ""),
				"data-mode": mode,
				"data-stat": stat.kind,
				ref: btnRef,
				onClick: togglePanel,
				"aria-pressed": on,
				title: "dsh-plan-board 规划面板 · " + stat.tip,
				"aria-label": "dsh-plan-board 规划面板，" + stat.tip
			}, (0, react.createElement)("span", {
				className: "pb-aurora",
				key: "aurora",
				"aria-hidden": "true"
			}), (0, react.createElement)("span", {
				className: "pb-ring",
				key: "ring",
				"aria-hidden": "true"
			}), orb, (0, react.createElement)("span", {
				className: "pb-lwrap",
				key: "lwrap"
			}, (0, react.createElement)("span", {
				className: "pb-label",
				key: "label"
			}, "PlanBoard")), (0, react.createElement)("span", {
				className: dotCls,
				key: "dot"
			}), (0, react.createElement)("span", {
				className: "pb-shine",
				key: "shine",
				"aria-hidden": "true"
			}));
		}
		/** 客户端环检测（保存前快失败；服务端 lint 仍兜底）。 */
		function hasCycle(nodes) {
			const byId = new Map(nodes.map((n) => [n.id, n]));
			const color = /* @__PURE__ */ new Map();
			const dfs = (id) => {
				const c = color.get(id);
				if (c === 1) return true;
				if (c === 2) return false;
				color.set(id, 1);
				for (const d of byId.get(id)?.deps ?? []) if (byId.has(d) && dfs(d)) return true;
				color.set(id, 2);
				return false;
			};
			for (const n of nodes) if (dfs(n.id)) return true;
			return false;
		}
		const ROW = 30;
		const MOD_H = 42;
		function MindMap(props) {
			const { data, effNodes, layout, dirtyIds, view, setView, dragRef, depLine, setDepLine, editorId, onNodePointerDown, onNodeMove, onNodeClick, onDepDrop, onHandlePointerDown, svgRef } = props;
			const drag = (0, react.useRef)(null);
			const b = data.board;
			const mods = (0, react.useMemo)(() => effNodes.filter((n) => n.type === "module"), [effNodes]);
			const posOf = (id) => layout.items.find((i) => i.node.id === id);
			const toSvg = (clientX, clientY) => {
				const rect = svgRef.current?.getBoundingClientRect();
				const left = rect?.left ?? 0;
				const top = rect?.top ?? 0;
				return {
					x: (clientX - left - view.tx) / view.k,
					y: (clientY - top - view.ty) / view.k
				};
			};
			const edge = (a, bx, by) => {
				const x1 = a.x + a.w;
				const y1 = a.y + a.h / 2;
				const mx = (x1 + bx) / 2;
				return "M " + x1 + " " + y1 + " C " + mx + " " + y1 + ", " + mx + " " + by + ", " + bx + " " + by;
			};
			const depEdge = (a, bp) => {
				const x1 = a.x - 6;
				const y1 = a.y + a.h / 2;
				const x2 = bp.x - 6;
				const y2 = bp.y + bp.h / 2;
				const mx = Math.min(x1, x2) - 46;
				return "M " + x1 + " " + y1 + " C " + mx + " " + y1 + ", " + mx + " " + y2 + ", " + x2 + " " + y2;
			};
			const mapRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const el = mapRef.current;
				if (el == null) return;
				const onWheel = (e) => {
					e.preventDefault();
					setView((v) => ({
						...v,
						k: Math.min(2.2, Math.max(.35, v.k * (e.deltaY > 0 ? .92 : 1.08)))
					}));
				};
				el.addEventListener("wheel", onWheel, { passive: false });
				return () => el.removeEventListener("wheel", onWheel);
			}, [setView]);
			return (0, react.createElement)("div", {
				className: "pb-map",
				ref: mapRef,
				onPointerDown: (e) => {
					if (dragRef.current != null) return;
					drag.current = {
						x: e.clientX,
						y: e.clientY,
						tx: view.tx,
						ty: view.ty
					};
					e.target.setPointerCapture?.(e.pointerId);
				},
				onPointerMove: (e) => {
					const d = dragRef.current;
					if (d != null && d.kind === "node") {
						const p = toSvg(e.clientX, e.clientY);
						if (Math.abs(p.x - d.sx) * view.k > 3 || Math.abs(p.y - d.sy) * view.k > 3) d.moved = true;
						onNodeMove(d.id, {
							x: d.bx + (p.x - d.sx),
							y: d.by + (p.y - d.sy)
						});
						return;
					}
					if (d != null && d.kind === "dep") {
						const p = toSvg(e.clientX, e.clientY);
						const f = posOf(d.from);
						if (f != null) setDepLine({
							x1: f.x + f.w,
							y1: f.y + f.h / 2,
							x2: p.x,
							y2: p.y
						});
						return;
					}
					if (drag.current == null) return;
					setView((v) => ({
						...v,
						tx: drag.current.tx + (e.clientX - drag.current.x),
						ty: drag.current.ty + (e.clientY - drag.current.y)
					}));
				},
				onPointerUp: (e) => {
					const d = dragRef.current;
					dragRef.current = null;
					setDepLine(null);
					if (d != null && d.kind === "node") {
						if (!d.moved) onNodeClick(d.id);
						return;
					}
					if (d != null && d.kind === "dep") {
						onDepDrop(d.from, {
							clientX: e.clientX,
							clientY: e.clientY
						});
						return;
					}
					drag.current = null;
				}
			}, (0, react.createElement)("svg", {
				width: "100%",
				height: Math.max(layout.totalH, 300),
				ref: svgRef,
				key: b.version
			}, (0, react.createElement)("g", { transform: "translate(" + view.tx + "," + view.ty + ") scale(" + view.k + ")" }, effNodes.filter((n) => n.type === "module" && n.parent == null).map((m, i) => {
				const rp = posOf("__root__");
				const mp = posOf(m.id);
				if (rp == null || mp == null) return null;
				return (0, react.createElement)("path", {
					key: "e" + i,
					d: edge(rp, mp.x, mp.y + mp.h / 2),
					stroke: "var(--pb-line,#cbd5e1)",
					strokeWidth: 1.6,
					fill: "none"
				});
			}), mods.map((m, mi) => {
				const mp = posOf(m.id);
				if (mp == null) return null;
				return (0, react.createElement)("g", { key: "mg" + mi }, effNodes.filter((t) => t.type === "task" && t.parent === m.id).map((t, ti) => {
					const tp = posOf(t.id);
					if (tp == null) return null;
					return (0, react.createElement)("path", {
						key: "te" + mi + "_" + ti,
						d: edge(mp, tp.x, tp.y + tp.h / 2),
						stroke: "var(--pb-line,#cbd5e1)",
						strokeWidth: 1.2,
						fill: "none"
					});
				}));
			}), effNodes.flatMap((t, di) => (t.deps ?? []).map((d, dj) => {
				const a = posOf(t.id);
				const bp = posOf(d);
				if (a == null || bp == null) return null;
				return (0, react.createElement)("path", {
					key: "dep" + di + "_" + dj,
					d: depEdge(bp, a),
					stroke: "#8b5cf6",
					strokeWidth: 1.3,
					strokeDasharray: "5 4",
					fill: "none",
					opacity: .8
				});
			})), depLine != null ? (0, react.createElement)("line", {
				x1: depLine.x1,
				y1: depLine.y1,
				x2: depLine.x2,
				y2: depLine.y2,
				stroke: "#8b5cf6",
				strokeWidth: 2,
				strokeDasharray: "4 3",
				opacity: .9
			}) : null, layout.items.map((it, ii) => {
				const isRoot = it.node.id === "__root__";
				const color = STATUS_COLOR[it.node.status] ?? "#94a3b8";
				const ord = data.order[it.node.id];
				const isStation = it.node.id === data.station;
				const isEditor = it.node.id === editorId;
				const isDirty = dirtyIds.has(it.node.id);
				if (isRoot) return (0, react.createElement)("g", { key: "n" + ii }, (0, react.createElement)("rect", {
					x: it.x,
					y: it.y,
					width: it.w,
					height: it.h,
					rx: 12,
					fill: "var(--pb-bg)",
					stroke: color,
					strokeWidth: 2
				}), (0, react.createElement)("rect", {
					x: it.x,
					y: it.y,
					width: 4,
					height: it.h,
					rx: 2,
					fill: color
				}), (0, react.createElement)("text", {
					x: it.x + 12,
					y: it.y + it.h / 2 + 4,
					fontSize: 13,
					fontWeight: 600
				}, it.node.title.slice(0, 26)));
				return (0, react.createElement)("g", {
					key: "n" + it.node.id,
					className: "pb-node",
					"data-id": it.node.id,
					onPointerDown: (e) => {
						e.stopPropagation();
						onNodePointerDown(e, it.node.id, {
							x: it.x,
							y: it.y
						});
					}
				}, isStation ? (0, react.createElement)("rect", {
					className: "pb-station",
					x: it.x - 4,
					y: it.y - 4,
					width: it.w + 8,
					height: it.h + 8,
					rx: 12,
					fill: "none",
					stroke: "#f59e0b",
					strokeWidth: 2
				}) : null, isEditor ? (0, react.createElement)("rect", {
					x: it.x - 6,
					y: it.y - 6,
					width: it.w + 12,
					height: it.h + 12,
					rx: 12,
					fill: "none",
					stroke: "#8b5cf6",
					strokeWidth: 2,
					strokeDasharray: "6 3"
				}) : null, (0, react.createElement)("rect", {
					x: it.x,
					y: it.y,
					width: it.w,
					height: it.h,
					rx: 9,
					fill: "var(--pb-bg)",
					stroke: isEditor ? "#8b5cf6" : color,
					strokeWidth: 1.5
				}), (0, react.createElement)("rect", {
					x: it.x,
					y: it.y,
					width: 4,
					height: it.h,
					rx: 2,
					fill: color
				}), (0, react.createElement)("text", {
					x: it.x + 12,
					y: it.y + it.h / 2 + 4,
					fontSize: 12,
					fontWeight: 600
				}, (ord != null ? "#" + ord + " " : "") + (isDirty ? "● " : "") + it.node.title.slice(0, 24)), it.node.type === "task" ? (0, react.createElement)("text", {
					x: it.x + it.w - 8,
					y: it.y + it.h / 2 + 4,
					fontSize: 10,
					textAnchor: "end",
					fill: color
				}, it.node.status) : null, it.node.type === "task" ? (0, react.createElement)("circle", {
					className: "pb-handle",
					cx: it.x + it.w + 6,
					cy: it.y + it.h / 2,
					r: 5,
					fill: "#8b5cf6",
					opacity: .85,
					title: "拖到目标任务 = 目标依赖此任务；再拖一次 = 移除依赖",
					onPointerDown: (e) => {
						e.stopPropagation();
						onHandlePointerDown(e, it.node.id);
					}
				}) : null);
			}))));
		}
		function PaneWindow() {
			const [open, setOpen] = (0, react.useState)(openState);
			const [project, setProject] = (0, react.useState)(localStorage.getItem("planboard.project") ?? "");
			const [data, setData] = (0, react.useState)(null);
			const [err, setErr] = (0, react.useState)("");
			const [nonce, setNonce] = (0, react.useState)(0);
			const [mode, setMode] = (0, react.useState)(appDark() ? "dark" : "light");
			const [drafts, setDrafts] = (0, react.useState)({});
			const [added, setAdded] = (0, react.useState)([]);
			const [removed, setRemoved] = (0, react.useState)([]);
			const [editorId, setEditorId] = (0, react.useState)(null);
			const [saving, setSaving] = (0, react.useState)(false);
			const [saveMsg, setSaveMsg] = (0, react.useState)("");
			const [depLine, setDepLine] = (0, react.useState)(null);
			const [newChild, setNewChild] = (0, react.useState)("");
			const [recent, setRecent] = (0, react.useState)([]);
			const [view, setView] = (0, react.useState)({
				k: 1,
				tx: 0,
				ty: 0
			});
			const dragRef = (0, react.useRef)(null);
			const svgRef = (0, react.useRef)(null);
			const editorRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const f = () => setOpen(openState);
				window.addEventListener("planboard:toggle", f);
				return () => window.removeEventListener("planboard:toggle", f);
			}, []);
			(0, react.useEffect)(() => {
				const t = setInterval(() => {
					const d = appDark();
					setMode((prev) => prev === (d ? "dark" : "light") ? prev : d ? "dark" : "light");
				}, 2e3);
				return () => clearInterval(t);
			}, []);
			(0, react.useEffect)(() => {
				if (!open || !project.startsWith("/")) return;
				const ctrl = new AbortController();
				let stop = false;
				const run = async () => {
					try {
						const reader = (await fetch(API + "/stream?project=" + encodeURIComponent(project), { signal: ctrl.signal })).body?.getReader();
						if (reader == null) return;
						const dec = new TextDecoder();
						let buf = "";
						while (!stop) {
							const chunk = await reader.read();
							if (chunk.done) break;
							buf += dec.decode(chunk.value, { stream: true });
							const lines = buf.split("\n");
							buf = lines.pop() ?? "";
							for (const line of lines) {
								if (line.trim() === "") continue;
								try {
									if (JSON.parse(line).kind === "event") setNonce((n) => n + 1);
								} catch {}
							}
						}
					} catch {}
					if (!stop) setTimeout(() => {
						run();
					}, 3e3);
				};
				run();
				return () => {
					stop = true;
					ctrl.abort();
				};
			}, [open, project]);
			(0, react.useEffect)(() => {
				if (!open || !project.startsWith("/")) return;
				localStorage.setItem("planboard.project", project);
				let stop = false;
				const tick = async () => {
					try {
						const j = await (await fetch(API + "/state?project=" + encodeURIComponent(project))).json();
						if (stop) return;
						if (j.ok === true) {
							setData(j);
							setErr("");
						} else setErr(String(j.error?.message ?? "加载失败"));
					} catch (e) {
						if (!stop) setErr(String(e));
					}
				};
				tick();
				const t = setInterval(tick, POLL_MS);
				return () => {
					stop = true;
					clearInterval(t);
				};
			}, [
				open,
				project,
				nonce
			]);
			ensureStyles();
			(0, react.useEffect)(() => {
				let stop = false;
				(async () => {
					try {
						const j = await (await fetch(API + "/projects")).json();
						if (stop || j.ok !== true || j.projects == null) return;
						const list = Object.entries(j.projects).map(([p, v]) => ({
							project: p,
							name: String(v.name ?? p),
							at: String(v.at ?? "")
						})).sort((x, y) => x.at < y.at ? 1 : -1);
						setRecent(list);
					} catch {}
				})();
				return () => {
					stop = true;
				};
			}, [nonce]);
			const b = data?.board;
			const effNodes = (0, react.useMemo)(() => {
				if (data == null) return [];
				const alive = data.board.nodes.filter((n) => !removed.includes(n.id)).map((n) => {
					const d = drafts[n.id];
					if (d == null) return n;
					return {
						...n,
						...d.fields ?? {},
						pos: d.pos !== void 0 ? d.pos : n.pos ?? null
					};
				});
				for (const a of added) alive.push({
					id: a.id,
					type: a.type,
					parent: a.parent,
					title: a.title,
					status: "planned",
					deps: []
				});
				return alive;
			}, [
				data,
				drafts,
				added,
				removed
			]);
			const layout = (0, react.useMemo)(() => {
				let y = 20;
				const items = [];
				const floating = [];
				const mods = effNodes.filter((n) => n.type === "module");
				for (const m of mods) {
					const tasks = effNodes.filter((t) => t.type === "task" && t.parent === m.id);
					const h = MOD_H + tasks.length * ROW + 8;
					const mx = m.pos != null ? m.pos.x : 180;
					const my = m.pos != null ? m.pos.y : y;
					const mi = {
						node: m,
						x: mx,
						y: my,
						w: 170,
						h: 36
					};
					if (m.pos != null) floating.push(mi);
					else items.push(mi);
					let ty = my + MOD_H;
					for (const t of tasks) {
						const ti = {
							node: t,
							x: t.pos != null ? t.pos.x : 410,
							y: t.pos != null ? t.pos.y : ty,
							w: 260,
							h: 24
						};
						if (t.pos != null) floating.push(ti);
						else items.push(ti);
						ty += ROW;
					}
					y = (m.pos != null ? my + h : y + h) + 18;
				}
				const totalH = Math.max(y + 20, 260);
				items.push(...floating);
				items.push({
					node: {
						id: "__root__",
						type: "module",
						parent: null,
						title: b?.plan.name ?? "Plan",
						status: "planned",
						deps: []
					},
					x: 16,
					y: totalH / 2 - 20,
					w: 130,
					h: 40
				});
				return {
					items,
					totalH
				};
			}, [effNodes, b]);
			const dirtyIds = (0, react.useMemo)(() => /* @__PURE__ */ new Set([
				...Object.keys(drafts),
				...added.map((a) => a.id),
				...removed
			]), [
				drafts,
				added,
				removed
			]);
			(0, react.useEffect)(() => {
				if (editorId == null) return;
				const el = editorRef.current;
				if (el == null) return;
				if (el.getBoundingClientRect().top > window.innerHeight - 40) el.scrollIntoView({ block: "nearest" });
			}, [editorId]);
			if (!open) return null;
			const dirtyCount = dirtyIds.size;
			const toSvg = (clientX, clientY) => {
				const rect = svgRef.current?.getBoundingClientRect();
				return {
					x: (clientX - (rect?.left ?? 0) - view.tx) / view.k,
					y: (clientY - (rect?.top ?? 0) - view.ty) / view.k
				};
			};
			const setDraft = (id, patch) => {
				setDrafts((prev) => ({
					...prev,
					[id]: {
						...prev[id],
						...patch,
						fields: {
							...prev[id]?.fields ?? {},
							...patch.fields ?? {}
						}
					}
				}));
			};
			const onNodePointerDown = (e, id, base) => {
				if (id === "__root__") return;
				const p = toSvg(e.clientX, e.clientY);
				dragRef.current = {
					kind: "node",
					id,
					sx: p.x,
					sy: p.y,
					bx: base.x,
					by: base.y,
					moved: false
				};
				try {
					e.target.setPointerCapture?.(e.pointerId);
				} catch {}
			};
			const onNodeMove = (id, pos) => {
				setDraft(id, { pos: {
					x: Math.round(pos.x),
					y: Math.round(pos.y)
				} });
			};
			const onNodeClick = (id) => {
				setEditorId((prev) => prev === id ? null : id);
				setSaveMsg("");
			};
			const onHandlePointerDown = (e, id) => {
				dragRef.current = {
					kind: "dep",
					from: id
				};
			};
			const onDepDrop = (from, at) => {
				const el = document.elementFromPoint(at.clientX, at.clientY);
				const gEl = el != null ? el.closest(".pb-node") : null;
				const hitId = gEl != null ? gEl.getAttribute("data-id") : null;
				if (hitId == null || hitId === from || hitId === "__root__") return;
				const tid = hitId;
				const cur = effNodes.find((n) => n.id === tid);
				if (cur == null || cur.type !== "task") return;
				const deps = [...cur.deps ?? []];
				const idx = deps.indexOf(from);
				if (idx >= 0) deps.splice(idx, 1);
				else deps.push(from);
				if (hasCycle(effNodes.filter((n) => !removed.includes(n.id)).map((n) => n.id === tid ? {
					...n,
					deps
				} : {
					...n,
					deps: [...n.deps ?? []]
				}).filter((n) => n.type === "task"))) {
					setSaveMsg("⛔ 该依赖会成环，已拒绝（" + tid + " ⇠ " + from + "）");
					return;
				}
				setDraft(tid, { fields: { deps } });
				setSaveMsg("");
			};
			const addChild = (parentId) => {
				const title = newChild.trim();
				if (title === "") return;
				const id = "pb-" + Date.now().toString(36);
				setAdded((prev) => [...prev, {
					id,
					type: "task",
					parent: parentId,
					title
				}]);
				setNewChild("");
				setEditorId(id);
			};
			const removeNode = (id) => {
				const node = effNodes.find((n) => n.id === id);
				if (node == null) return;
				if (effNodes.some((n) => n.parent === id)) {
					setSaveMsg("⛔ 先删除其子任务/子模块");
					return;
				}
				if (!window.confirm("删除节点 " + id + "（" + node.title + "）？")) return;
				if (!window.confirm("确认：该操作随「保存更改」一并生效，且会自动剥离其他任务对它的依赖。")) return;
				for (const n of effNodes) {
					if (n.id === id) continue;
					const ds = n.deps ?? [];
					if (ds.includes(id)) setDraft(n.id, { fields: { deps: ds.filter((d) => d !== id) } });
				}
				setRemoved((prev) => prev.includes(id) ? prev : [...prev, id]);
				if (editorId === id) setEditorId(null);
			};
			const save = async () => {
				if (saving || dirtyCount === 0) return;
				const ops = [];
				for (const a of added) ops.push({
					op: "add_node",
					node: {
						id: a.id,
						type: a.type,
						parent: a.parent,
						title: a.title
					}
				});
				for (const [id, d] of Object.entries(drafts)) {
					if (removed.includes(id)) continue;
					const fields = { ...d.fields ?? {} };
					if (d.pos != null) fields.pos = d.pos;
					if (Object.keys(fields).length === 0) continue;
					ops.push({
						op: "update_node",
						id,
						fields
					});
				}
				for (const id of removed) ops.push({
					op: "remove_node",
					id
				});
				if (ops.length === 0) {
					setDrafts({});
					setAdded([]);
					setRemoved([]);
					return;
				}
				if (hasCycle(effNodes.filter((n) => !removed.includes(n.id)).map((n) => {
					const d = drafts[n.id];
					return {
						id: n.id,
						deps: d?.fields?.deps ?? n.deps ?? []
					};
				}).filter((n) => n.id !== "__root__"))) {
					setSaveMsg("⛔ 保存被拒绝：依赖成环");
					return;
				}
				setSaving(true);
				setSaveMsg("");
				try {
					const j = await post("/edit", {
						project,
						ops,
						note: "panel:direct-edit"
					});
					if (j.ok === true) {
						setDrafts({});
						setAdded([]);
						setRemoved([]);
						setEditorId(null);
						setNonce((n) => n + 1);
					} else setSaveMsg("⛔ " + String(j.error?.message ?? "保存失败"));
				} catch (e) {
					setSaveMsg("⛔ " + String(e));
				}
				setSaving(false);
			};
			const discard = () => {
				setDrafts({});
				setAdded([]);
				setRemoved([]);
				setEditorId(null);
				setSaveMsg("");
			};
			const editor = editorId != null ? effNodes.find((n) => n.id === editorId) : void 0;
			const tasksOf = (pred) => effNodes.filter((n) => n.type === "task" && !removed.includes(n.id) && pred(n));
			const fd = (editor != null ? drafts[editor.id]?.fields : void 0) ?? {};
			const dirtyField = (editorId2, k) => editorId2 != null && drafts[editorId2]?.fields != null && drafts[editorId2].fields[k] !== void 0;
			const editorChildren = [];
			if (editor != null) {
				editorChildren.push((0, react.createElement)("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "8px"
				} }, (0, react.createElement)("span", { className: "pb-sec" }, "编辑 " + editor.id + "（" + (editor.type === "task" ? "任务" : "模块") + "）"), (0, react.createElement)("button", {
					className: "pb-btn",
					style: { marginLeft: "auto" },
					onClick: () => setEditorId(null)
				}, "完成")));
				editorChildren.push((0, react.createElement)("label", {}, "标题" + (dirtyField(editor.id, "title") ? " ●" : ""), (0, react.createElement)("input", {
					value: fd.title ?? editor.title,
					onChange: (e) => setDraft(editor.id, { fields: { title: e.target.value } })
				})));
				if (editor.type === "task") editorChildren.push((0, react.createElement)("label", {}, "优先级" + (dirtyField(editor.id, "priority") ? " ●" : ""), (0, react.createElement)("select", {
					value: String(fd.priority ?? editor.priority ?? 3),
					onChange: (e) => setDraft(editor.id, { fields: { priority: Number(e.target.value) } })
				}, [
					1,
					2,
					3,
					4,
					5
				].map((pv) => (0, react.createElement)("option", {
					key: pv,
					value: String(pv)
				}, "P" + pv)))));
				editorChildren.push((0, react.createElement)("label", {}, "备注" + (dirtyField(editor.id, "note") ? " ●" : ""), (0, react.createElement)("textarea", {
					value: fd.note ?? editor.note ?? "",
					onChange: (e) => setDraft(editor.id, { fields: { note: e.target.value } })
				})));
				if (editor.type === "task") {
					editorChildren.push((0, react.createElement)("label", {}, "验收标准（每行一条）" + (dirtyField(editor.id, "acceptance") ? " ●" : ""), (0, react.createElement)("textarea", {
						value: (fd.acceptance ?? editor.acceptance ?? []).join("\n"),
						onChange: (e) => setDraft(editor.id, { fields: { acceptance: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) } })
					})));
					editorChildren.push((0, react.createElement)("label", {}, "scope（每行一条路径前缀，目录以 / 结尾）" + (dirtyField(editor.id, "scope") ? " ●" : ""), (0, react.createElement)("textarea", {
						value: (fd.scope ?? editor.scope ?? []).join("\n"),
						onChange: (e) => setDraft(editor.id, { fields: { scope: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) } })
					})));
					const depDeps = fd.deps ?? editor.deps ?? [];
					editorChildren.push((0, react.createElement)("div", {}, (0, react.createElement)("span", { className: "pb-sec" }, "依赖（被此任务依赖的前置任务）" + (dirtyField(editor.id, "deps") ? " ●" : "")), tasksOf((n) => n.id !== editor.id).map((dn) => (0, react.createElement)("label", {
						className: "pb-deprow",
						key: dn.id
					}, (0, react.createElement)("input", {
						type: "checkbox",
						checked: depDeps.includes(dn.id),
						onChange: (e) => {
							const arr = (fd.deps ?? editor.deps ?? []).slice();
							const i2 = arr.indexOf(dn.id);
							if (e.target.checked && i2 < 0) arr.push(dn.id);
							if (!e.target.checked && i2 >= 0) arr.splice(i2, 1);
							setDraft(editor.id, { fields: { deps: arr } });
						}
					}), (0, react.createElement)("span", {}, "#" + (data?.order[dn.id] ?? "?") + " " + dn.id + " " + dn.title.slice(0, 22))))));
				}
				if (editor.type === "module") editorChildren.push((0, react.createElement)("div", { style: {
					display: "flex",
					gap: "6px"
				} }, (0, react.createElement)("input", {
					className: "pb-input",
					style: { flex: 1 },
					value: newChild,
					placeholder: "新子任务标题（回车或点按钮加入，保存后生效）",
					onChange: (e) => setNewChild(e.target.value),
					onKeyDown: (e) => {
						if (e.key === "Enter") addChild(editor.id);
					}
				}), (0, react.createElement)("button", {
					className: "pb-btn pb-vio",
					disabled: newChild.trim() === "",
					onClick: () => addChild(editor.id)
				}, "＋子任务")));
				editorChildren.push((0, react.createElement)("div", { style: {
					display: "flex",
					gap: "8px"
				} }, (0, react.createElement)("button", {
					className: "pb-btn pb-no",
					onClick: () => removeNode(editor.id)
				}, "删除节点"), (0, react.createElement)("span", {
					className: "pb-hint",
					style: { alignSelf: "center" }
				}, editor.type === "task" ? "状态流转与证据走 task_update（L3 证据门），不在面板直改" : "模块删除需先清空子任务")));
			}
			const editorCard = editor != null ? (0, react.createElement)("div", {
				className: "pb-card pb-form",
				key: "editor",
				ref: editorRef
			}, editorChildren) : null;
			return (0, react.createElement)("div", {
				className: "pb-panel",
				"data-mode": mode
			}, (0, react.createElement)("div", { className: "pb-head" }, (0, react.createElement)("span", { className: "pb-title" }, "🗺 PlanBoard"), (0, react.createElement)("input", {
				className: "pb-input",
				value: project,
				placeholder: "项目根目录绝对路径，如 /path/to/your/project",
				onChange: (e) => setProject(e.target.value)
			}), (0, react.createElement)("button", {
				className: "pb-btn",
				onClick: togglePanel
			}, "收起")), err !== "" ? (0, react.createElement)("div", { className: "pb-banner pb-drift" }, "⚠ " + err) : null, b == null ? (0, react.createElement)("div", { className: "pb-body" }, (0, react.createElement)("div", { className: "pb-card" }, (0, react.createElement)("div", { style: {
				fontWeight: 700,
				marginBottom: "4px"
			} }, project.trim() === "" ? "① 选一个最近打开的项目（或把项目根目录粘到上面的输入框）" : "⚠ 这个项目下还没有 .plan-board/"), (0, react.createElement)("div", { className: "pb-hint" }, project.trim() === "" ? "面板只读+直改规划；任务状态仍走 task_update（L3 证据门）。② 若项目还没有板子，让 Agent 跑 plan_edit init_board 起板。" : "让 Agent 在 " + project + " 跑 plan_edit init_board 起板；或换成上面列出的其它项目。"), recent.length > 0 ? (0, react.createElement)("div", { style: {
				display: "flex",
				flexWrap: "wrap",
				gap: "6px",
				marginTop: "10px"
			} }, recent.map((r) => (0, react.createElement)("button", {
				key: r.project,
				className: "pb-btn",
				title: r.project,
				onClick: () => setProject(r.project)
			}, r.name + " · " + r.project))) : null)) : (0, react.createElement)("div", { className: "pb-body" }, dirtyCount > 0 ? (0, react.createElement)("div", { className: "pb-banner pb-dirty" }, "● " + dirtyCount + " 项未保存更改（拖拽位置/内容/依赖/增删，保存后才生效）", (0, react.createElement)("button", {
				className: "pb-btn pb-ok",
				style: { marginLeft: "auto" },
				disabled: saving,
				onClick: () => {
					save();
				}
			}, saving ? "保存中…" : "保存更改"), (0, react.createElement)("button", {
				className: "pb-btn",
				disabled: saving,
				onClick: discard
			}, "放弃")) : null, saveMsg !== "" ? (0, react.createElement)("div", { className: "pb-banner pb-drift" }, saveMsg) : null, b.driftBlock != null ? (0, react.createElement)("div", { className: "pb-banner pb-drift" }, "⛔ 漂移阻断: " + b.driftBlock.reason, (0, react.createElement)("button", {
				className: "pb-btn pb-ok",
				style: { marginLeft: "auto" },
				onClick: () => {
					post("/unblock", { project }).then(() => setNonce((n) => n + 1));
				}
			}, "解除阻断")) : null, data?.guard?.suspended ? (0, react.createElement)("div", { className: "pb-banner pb-hold" }, "⏸ L7 越界拦截已挂起（仅内存态，重启后自动恢复拦截）", (0, react.createElement)("button", {
				className: "pb-btn pb-ok",
				style: { marginLeft: "auto" },
				onClick: () => {
					post("/guard", {
						project,
						suspended: false
					}).then(() => setNonce((n) => n + 1));
				}
			}, "恢复拦截")) : null, (() => {
				const blocks = (data?.events ?? []).filter((ev) => ev.kind === "guard_block");
				if (blocks.length === 0 || data?.guard?.suspended) return null;
				const last = blocks[blocks.length - 1];
				return (0, react.createElement)("div", { className: "pb-banner pb-guard" }, "🛡 L7 越界拦截 " + blocks.length + " 次: " + (last.payload?.tool ?? "?") + " → " + (last.payload?.path ?? "?") + "（任务 " + (last.payload?.taskId ?? "?") + "）", (0, react.createElement)("button", {
					className: "pb-btn",
					style: { marginLeft: "auto" },
					onClick: () => {
						post("/guard", {
							project,
							suspended: true
						}).then(() => setNonce((n) => n + 1));
					}
				}, "暂停拦截"));
			})(), b.pendingApprovals.length > 0 ? (0, react.createElement)("div", { className: "pb-banner pb-appr" }, "⏳ " + b.pendingApprovals.length + " 个 plan_edit 待批", (0, react.createElement)("span", { style: {
				fontWeight: 400,
				opacity: .85
			} }, b.pendingApprovals[0].reason.slice(0, 60))) : null, b.pendingApprovals.map((ap) => (0, react.createElement)("div", {
				className: "pb-card",
				key: ap.id
			}, (0, react.createElement)("div", { style: {
				fontWeight: 700,
				marginBottom: "4px"
			} }, ap.id + " · " + ap.ops.length + " ops · " + ap.by), (0, react.createElement)("div", { style: {
				opacity: .8,
				marginBottom: "6px"
			} }, ap.reason), (0, react.createElement)("div", { style: {
				display: "flex",
				gap: "8px"
			} }, (0, react.createElement)("button", {
				className: "pb-btn pb-ok",
				onClick: () => {
					post("/approve", {
						project,
						approvalId: ap.id,
						decision: "approve"
					}).then(() => setNonce((n) => n + 1));
				}
			}, "确认生效"), (0, react.createElement)("button", {
				className: "pb-btn pb-no",
				onClick: () => {
					post("/approve", {
						project,
						approvalId: ap.id,
						decision: "reject"
					}).then(() => setNonce((n) => n + 1));
				}
			}, "驳回")))), (0, react.createElement)("div", { className: "pb-sec" }, "任务思维导图 v" + b.version + " · digest " + (b.digest ?? "").slice(0, 10) + " · 拖拽移动 / 点节点编辑 / 紫点拖出连依赖"), (0, react.createElement)(MindMap, {
				data,
				effNodes,
				layout,
				dirtyIds,
				view,
				setView,
				dragRef,
				depLine,
				setDepLine,
				editorId,
				onNodePointerDown,
				onNodeMove,
				onNodeClick,
				onDepDrop,
				onHandlePointerDown,
				svgRef
			}), editorCard, (0, react.createElement)("div", { className: "pb-sec" }, "事件时间线"), (0, react.createElement)("div", { className: "pb-card" }, (data?.events ?? []).slice(-24).reverse().map((ev) => (0, react.createElement)("div", {
				className: "pb-ev",
				key: ev.seq
			}, (0, react.createElement)("span", {}, new Date(ev.ts).toLocaleTimeString()), (0, react.createElement)("span", { style: { fontWeight: 700 } }, ev.kind), (0, react.createElement)("span", { style: { opacity: .7 } }, ev.actor))))));
		}
		const inject = ["slots"];
		function apply(ctx) {
			ctx.effect(() => {
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: NS + ":pane",
					order: 85
				}, PaneWindow));
				ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
					name: "conversation.session.header.utilities",
					id: NS + ":entry",
					order: -1
				}, PaneSidebarButton));
			}, NS + ":ui");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map