window.__ModuleLoader__.load({
	id: "golem-client-ui-config",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
		//#endregion
		let react = require("react");
		//#region src/golem-api.ts
		function unwrap(r) {
			if (r !== null && typeof r === "object" && "ok" in r) {
				const res = r;
				if (res.ok) return unwrap(res.value);
				const err = res.error;
				throw new Error(`[golem] remote error: ${err?.message ?? "unknown failure"} (${err?.code ?? "?"})`);
			}
			return r;
		}
		function createGolemApi(remote) {
			return {
				listInstances: () => remote.listInstances().then(unwrap),
				createInstance: (id, name, persona) => remote.createInstance(id, name, persona).then(unwrap),
				getInstanceMeta: (id) => remote.getInstanceMeta(id).then(unwrap),
				setInstanceMeta: (id, patch) => remote.setInstanceMeta(id, patch).then(unwrap),
				getDefaultInstance: () => remote.getDefaultInstance().then(unwrap),
				setDefaultInstance: (id) => remote.setDefaultInstance(id).then(unwrap),
				deleteInstance: (id) => remote.deleteInstance(id).then(unwrap),
				getDriftRecords: (id) => remote.getDriftRecords(id).then(unwrap)
			};
		}
		//#endregion
		//#region ../../../dsh-src/node_modules/.pnpm/react@18.3.1/node_modules/react/cjs/react-jsx-runtime.production.min.js
		/**
		* @license React
		* react-jsx-runtime.production.min.js
		*
		* Copyright (c) Facebook, Inc. and its affiliates.
		*
		* This source code is licensed under the MIT license found in the
		* LICENSE file in the root directory of this source tree.
		*/
		var require_react_jsx_runtime_production_min = /* @__PURE__ */ __commonJSMin(((exports) => {
			var f = require("react"), k = Symbol.for("react.element"), l = Symbol.for("react.fragment"), m = Object.prototype.hasOwnProperty, n = f.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner, p = {
				key: !0,
				ref: !0,
				__self: !0,
				__source: !0
			};
			function q(c, a, g) {
				var b, d = {}, e = null, h = null;
				void 0 !== g && (e = "" + g);
				void 0 !== a.key && (e = "" + a.key);
				void 0 !== a.ref && (h = a.ref);
				for (b in a) m.call(a, b) && !p.hasOwnProperty(b) && (d[b] = a[b]);
				if (c && c.defaultProps) for (b in a = c.defaultProps, a) void 0 === d[b] && (d[b] = a[b]);
				return {
					$$typeof: k,
					type: c,
					key: e,
					ref: h,
					props: d,
					_owner: n.current
				};
			}
			exports.Fragment = l;
			exports.jsx = q;
			exports.jsxs = q;
		}));
		//#endregion
		//#region src/DriftDashboard.tsx
		var import_jsx_runtime = (/* @__PURE__ */ __commonJSMin(((exports, module) => {
			module.exports = require_react_jsx_runtime_production_min();
		})))();
		const DIM_ORDER = [
			"openness",
			"warmth",
			"verbosity",
			"playfulness",
			"assertiveness"
		];
		const DIM_LABELS = {
			openness: "开放性",
			warmth: "亲和力",
			verbosity: "表达欲",
			playfulness: "俏皮度",
			assertiveness: "主见度"
		};
		const card$1 = {
			border: "1px solid #ddd",
			borderRadius: 10,
			padding: "14px 16px",
			marginBottom: 14,
			background: "var(--card, #fff)"
		};
		const row$1 = {
			display: "flex",
			gap: 10,
			alignItems: "center",
			flexWrap: "wrap"
		};
		const input$1 = {
			font: "inherit",
			padding: "6px 8px",
			border: "1px solid #ccc",
			borderRadius: 8
		};
		const button$1 = {
			font: "inherit",
			padding: "6px 12px",
			border: "1px solid #2b6cb0",
			background: "#2b6cb0",
			color: "#fff",
			borderRadius: 8,
			cursor: "pointer"
		};
		const meta$1 = {
			fontSize: 12,
			color: "#999",
			marginTop: 4
		};
		const hint$1 = {
			fontSize: 12,
			color: "#c0392b",
			minHeight: 16,
			marginTop: 6
		};
		function Bar({ name, v }) {
			const mag = Math.max(-1, Math.min(1, v));
			const pos = mag >= 0;
			const fill = {
				position: "absolute",
				top: 0,
				bottom: 0,
				background: pos ? "#2b8a5c" : "#c0392b",
				left: pos ? "50%" : `${50 + mag * 50}%`,
				width: `${Math.abs(mag) * 50}%`
			};
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					alignItems: "center",
					gap: 10,
					margin: "6px 0"
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						style: {
							width: 64,
							flex: "none",
							fontSize: 13
						},
						children: DIM_LABELS[name] || name
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						style: {
							position: "relative",
							flex: 1,
							height: 14,
							background: "#eee",
							border: "1px solid #ddd",
							borderRadius: 7,
							overflow: "hidden"
						},
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: {
							position: "absolute",
							left: "50%",
							top: 0,
							bottom: 0,
							width: 1,
							background: "#ccc"
						} }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: fill })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						style: {
							width: 56,
							flex: "none",
							textAlign: "right",
							fontSize: 12,
							color: "#999"
						},
						children: [v >= 0 ? "+" : "", v.toFixed(2)]
					})
				]
			});
		}
		const SKIP_TEXT = {
			"already-done": (r) => `今日已完成内省（节点 ${r.existingNodeId ?? "?"} 已存在）`,
			"no-dialogue": "近期无对话 → 跳过（链断档）",
			"no-llm": "无 LLM → 跳过",
			"model-empty": "模型返回合法 JSON 但无有效维度 → 平凡日跳过"
		};
		function DriftDashboard({ api, instances }) {
			const [selected, setSelected] = (0, react.useState)("");
			const [records, setRecords] = (0, react.useState)([]);
			const [loading, setLoading] = (0, react.useState)(false);
			const [err, setErr] = (0, react.useState)("");
			const timer = (0, react.useRef)(null);
			const effective = selected || instances[0]?.id || "";
			const load = (0, react.useCallback)(async () => {
				if (!effective) return;
				setLoading(true);
				try {
					setRecords(await api.getDriftRecords(effective));
					setErr("");
				} catch (e) {
					setErr("加载失败: " + String(e));
				} finally {
					setLoading(false);
				}
			}, [api, effective]);
			(0, react.useEffect)(() => {
				load();
				if (timer.current) clearInterval(timer.current);
				timer.current = setInterval(() => void load(), 5e3);
				return () => {
					if (timer.current) clearInterval(timer.current);
				};
			}, [load]);
			const total = records.length;
			const done = records.filter((r) => r.written).length;
			const skipped = records.filter((r) => !r.written && !r.error).length;
			const failed = records.filter((r) => r.error).length;
			const lastCum = [...records].reverse().find((r) => r.parsed?.cumulative)?.parsed?.cumulative;
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				style: { padding: 4 },
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						style: row$1,
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
								style: {
									...input$1,
									minWidth: 160
								},
								value: effective,
								onChange: (e) => setSelected(e.target.value),
								children: instances.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "",
									children: "（无实例）"
								}) : instances.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: m.id,
									children: m.name || m.id
								}, m.id))
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								style: button$1,
								onClick: () => void load(),
								disabled: loading,
								children: loading ? "刷新中…" : "刷新"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								style: meta$1,
								children: "每 5 秒自动刷新（idle 内省后记录会自动出现）"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						style: hint$1,
						children: err
					}),
					instances.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						style: {
							...meta$1,
							marginTop: 20
						},
						children: "暂无实例，先到「实例配置」新建假人。"
					}) : total === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						style: {
							...meta$1,
							marginTop: 20
						},
						children: [
							"实例「",
							effective,
							"」还没有内省记录。去 dsh 聊天界面开聊几轮，然后",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "停手空闲几秒" }),
							"触发 idle 内省，记录会自动出现在这里。"
						]
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 12,
							flexWrap: "wrap",
							marginTop: 12
						},
						children: [[
							["总执行", total],
							["已写漂移", done],
							["跳过", skipped],
							["失败", failed]
						].map(([k, v]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							style: {
								...card$1,
								marginBottom: 0,
								minWidth: 96,
								padding: "10px 14px"
							},
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								style: meta$1,
								children: k
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								style: {
									fontSize: 22,
									fontWeight: 600
								},
								children: v
							})]
						}, k)), lastCum ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							style: {
								...card$1,
								marginBottom: 0,
								flex: 1,
								minWidth: 240,
								padding: "10px 14px"
							},
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									style: meta$1,
									children: "当前累计偏移"
								}),
								DIM_ORDER.filter((d) => lastCum[d]).map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bar, {
									name: d,
									v: lastCum[d]
								}, d)),
								Object.keys(lastCum).filter((d) => !DIM_ORDER.includes(d)).map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bar, {
									name: d,
									v: lastCum[d]
								}, d))
							]
						}) : null]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						style: { marginTop: 18 },
						children: records.map((r, i) => {
							r.written || r.error;
							const borderColor = r.written ? "#2b8a5c" : r.error ? "#c0392b" : "#d29922";
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								style: {
									...card$1,
									borderLeft: `4px solid ${borderColor}`
								},
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										style: row$1,
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
												style: { fontWeight: 600 },
												children: r.date
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 11,
													padding: "2px 8px",
													borderRadius: 20,
													background: r.written ? "rgba(43,138,92,.15)" : r.error ? "rgba(192,57,43,.15)" : "rgba(210,153,34,.15)",
													color: r.written ? "#2b8a5c" : r.error ? "#c0392b" : "#b8860b"
												},
												children: r.written ? "已写漂移" : r.error ? "失败" : "跳过"
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
												style: {
													...meta$1,
													marginLeft: "auto"
												},
												children: [
													"触发 @ ",
													r.triggeredAt,
													r.instanceId ? " · " + r.instanceId : ""
												]
											})
										]
									}),
									r.skipReason && !r.written ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										style: {
											marginTop: 10,
											padding: "8px 12px",
											background: "rgba(210,153,34,.08)",
											border: "1px solid rgba(210,153,34,.25)",
											borderRadius: 8,
											color: "#b8860b",
											fontSize: 13
										},
										children: ["跳过原因：", SKIP_TEXT[r.skipReason]?.(r) ?? r.skipReason]
									}) : null,
									r.error ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										style: {
											marginTop: 10,
											padding: "8px 12px",
											background: "rgba(192,57,43,.08)",
											border: "1px solid rgba(192,57,43,.25)",
											borderRadius: 8,
											color: "#c0392b",
											fontSize: 13
										},
										children: ["错误：", r.error === "llm-error" ? "模型调用出错（网络/超时/限流）" : "模型返回无法解析的 JSON"]
									}) : null,
									r.input ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										style: {
											display: "grid",
											gridTemplateColumns: "1fr 1fr",
											gap: 12,
											marginTop: 10
										},
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
											style: meta$1,
											children: "输入"
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											style: { fontSize: 13 },
											children: [
												"对话 ",
												r.input.dialogTurns,
												" 轮 · 记忆主题 ",
												r.input.memoryTopics,
												" · 历史 drift ",
												r.input.historyDrifts,
												" · 窗口 ",
												r.input.recentDays,
												" 天"
											]
										})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
											style: meta$1,
											children: "心境 / 倾向 / 执念"
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
											style: { fontSize: 13 },
											children: [
												r.parsed?.mood,
												r.parsed?.leaning,
												r.parsed?.preoccupation
											].filter(Boolean).map((x) => "「" + x + "」").join(" ") || "—"
										})] })]
									}) : null,
									r.parsed ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										style: { marginTop: 10 },
										children: [
											DIM_ORDER.filter((d) => r.parsed.dims[d] != null).map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bar, {
												name: d,
												v: r.parsed.dims[d]
											}, d)),
											Object.keys(r.parsed.dims).filter((d) => !DIM_ORDER.includes(d)).map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bar, {
												name: d,
												v: r.parsed.dims[d]
											}, d)),
											r.parsed.rationale ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
												style: { marginTop: 8 },
												children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
													style: meta$1,
													children: "判断理由"
												}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
													style: { fontSize: 13 },
													children: r.parsed.rationale
												})]
											}) : null,
											r.parsed.evidence?.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
												style: {
													margin: "8px 0 0",
													paddingLeft: 18,
													color: "#999",
													fontSize: 12
												},
												children: r.parsed.evidence.map((e, j) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: e }, j))
											}) : null
										]
									}) : null,
									r.written ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										style: {
											marginTop: 8,
											fontFamily: "ui-monospace, monospace",
											fontSize: 12,
											color: "#2b6cb0"
										},
										children: [
											r.written.nodeId,
											"（causal 边 ",
											r.written.causalEdges,
											" · evidence 边 ",
											r.written.evidenceEdges,
											"）"
										]
									}) : null,
									r.llmRaw ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", {
										style: { marginTop: 10 },
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", {
											style: {
												cursor: "pointer",
												color: "#2b6cb0",
												fontSize: 13
											},
											children: "LLM 原始输出"
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
											style: {
												margin: "8px 0 0",
												padding: 12,
												background: "#f6f6f6",
												border: "1px solid #eee",
												borderRadius: 8,
												fontSize: 12,
												whiteSpace: "pre-wrap",
												wordBreak: "break-word",
												color: "#555",
												maxHeight: 260,
												overflow: "auto"
											},
											children: r.llmRaw
										})]
									}) : null
								]
							}, i);
						})
					})] })
				]
			});
		}
		//#endregion
		//#region src/GolemSettings.tsx
		const card = {
			border: "1px solid #ddd",
			borderRadius: 10,
			padding: "14px 16px",
			marginBottom: 14,
			background: "var(--card, #fff)"
		};
		const cardDefault = {
			...card,
			borderColor: "#2b8a5c",
			boxShadow: "0 0 0 2px rgba(43,138,92,.15)"
		};
		const row = {
			display: "flex",
			gap: 10,
			alignItems: "center",
			flexWrap: "wrap"
		};
		const nameStyle = { fontWeight: 600 };
		const tag = {
			fontSize: 12,
			color: "#2b8a5c",
			border: "1px solid #2b8a5c",
			borderRadius: 6,
			padding: "1px 6px"
		};
		const meta = {
			fontSize: 12,
			color: "#999",
			marginTop: 4
		};
		const input = {
			font: "inherit",
			padding: "6px 8px",
			border: "1px solid #ccc",
			borderRadius: 8
		};
		const textarea = {
			width: "100%",
			minHeight: 70,
			boxSizing: "border-box",
			font: "inherit",
			padding: 8,
			border: "1px solid #ccc",
			borderRadius: 8,
			resize: "vertical",
			marginTop: 8
		};
		const button = {
			font: "inherit",
			padding: "6px 12px",
			border: "1px solid #2b6cb0",
			background: "#2b6cb0",
			color: "#fff",
			borderRadius: 8,
			cursor: "pointer"
		};
		const buttonGhost = {
			...button,
			background: "#fff",
			color: "#2b6cb0"
		};
		const buttonDanger = {
			...button,
			background: "#c0392b",
			borderColor: "#c0392b"
		};
		const hint = {
			fontSize: 12,
			color: "#b06",
			minHeight: 16,
			marginTop: 6
		};
		function GolemSettings({ api }) {
			const [metas, setMetas] = (0, react.useState)([]);
			const [defaultId, setDefaultId] = (0, react.useState)(null);
			const [newId, setNewId] = (0, react.useState)("");
			const [newName, setNewName] = (0, react.useState)("");
			const [createHint, setCreateHint] = (0, react.useState)("");
			const [hints, setHints] = (0, react.useState)({});
			const [busy, setBusy] = (0, react.useState)(false);
			/**
			* 人格输入框的草稿（受控）。key = instanceId。
			*
			* ⚠️ 历史 bug（保存人格静默存成空串）：旧实现用非受控 textarea + 点保存时
			* `e.currentTarget.closest('.card')?.querySelector('textarea')` 反查 DOM 取值。
			* 但本组件全部使用内联 style、从未设置 `className="card"`，`closest` 恒为 null，
			* 于是取值恒为 ''，请求照样成功 → UI 显示「已保存」而图库里 persona 被清空。
			* 现在改为受控 + state 草稿：值只从 React state 来，不依赖 DOM 结构/类名。
			*/
			const [drafts, setDrafts] = (0, react.useState)({});
			/** 面板内标签页：实例配置 / 内省记录。 */
			const [tab, setTab] = (0, react.useState)("config");
			const refresh = (0, react.useCallback)(async () => {
				setBusy(true);
				try {
					const [list, def] = await Promise.all([api.listInstances(), api.getDefaultInstance()]);
					setMetas(list);
					setDefaultId(def);
					setDrafts(Object.fromEntries(list.map((m) => [m.id, m.persona ?? ""])));
				} catch (e) {
					console.error("[GolemSettings] refresh failed:", e);
					setCreateHint("加载失败: " + String(e));
				} finally {
					setBusy(false);
				}
			}, [api]);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			const onCreate = async () => {
				const id = newId.trim();
				if (!id) {
					setCreateHint("请填 id");
					return;
				}
				try {
					await api.createInstance(id, newName.trim() || id, "");
					setNewId("");
					setNewName("");
					setCreateHint("已新建 " + id);
					await refresh();
				} catch (e) {
					setCreateHint("失败: " + String(e));
				}
			};
			const onSave = async (id, persona) => {
				try {
					const echoed = (await api.setInstanceMeta(id, { persona })).persona ?? "";
					setHints((h) => ({
						...h,
						[id]: echoed === persona ? persona.trim() ? "已保存（" + persona.length + " 字）" : "已保存（已清空人格）" : "⚠ 保存未生效：服务端回读与提交不一致"
					}));
					await refresh();
				} catch (e) {
					setHints((h) => ({
						...h,
						[id]: "失败: " + String(e)
					}));
				}
			};
			const onDefault = async (id) => {
				try {
					await api.setDefaultInstance(id);
					setHints((h) => ({
						...h,
						[id]: "已设为默认"
					}));
					await refresh();
				} catch (e) {
					setHints((h) => ({
						...h,
						[id]: "失败: " + String(e)
					}));
				}
			};
			const onDelete = async (id) => {
				if (!window.confirm(`确定删除假人「${id}」？此操作不可撤销，其记忆图与人格设定将一并清除。`)) return;
				try {
					await api.deleteInstance(id);
					setHints((h) => ({
						...h,
						[id]: "已删除"
					}));
					await refresh();
				} catch (e) {
					setHints((h) => ({
						...h,
						[id]: "失败: " + String(e)
					}));
				}
			};
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				style: { padding: 4 },
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					style: {
						...row,
						marginBottom: 14
					},
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						style: tab === "config" ? button : buttonGhost,
						onClick: () => setTab("config"),
						children: "实例配置"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						style: tab === "drift" ? button : buttonGhost,
						onClick: () => setTab("drift"),
						children: "内省记录"
					})]
				}), tab === "drift" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DriftDashboard, {
					api,
					instances: metas
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					style: card,
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							style: row,
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									style: {
										...input,
										flex: 1,
										minWidth: 160
									},
									placeholder: "实例 id（英文，如 linxia）",
									value: newId,
									onChange: (e) => setNewId(e.target.value)
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									style: {
										...input,
										flex: 1,
										minWidth: 140
									},
									placeholder: "显示名（如 林夏）",
									value: newName,
									onChange: (e) => setNewName(e.target.value)
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									style: button,
									onClick: onCreate,
									disabled: busy,
									children: "新建假人"
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							style: hint,
							children: createHint
						}),
						metas.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							style: meta,
							children: "暂无实例，先在上方新建。"
						}) : metas.map((m) => {
							const isDef = defaultId === m.id;
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								style: isDef ? cardDefault : card,
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										style: row,
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
												style: nameStyle,
												children: m.name || m.id
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
												style: meta,
												children: [
													"id: ",
													m.id,
													" · turns: ",
													m.turns ?? 0
												]
											}),
											isDef ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
												style: tag,
												children: "默认"
											}) : null
										]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
										value: drafts[m.id] ?? "",
										onChange: (e) => {
											const v = e.target.value;
											setDrafts((d) => ({
												...d,
												[m.id]: v
											}));
											setHints((h) => h[m.id] ? {
												...h,
												[m.id]: ""
											} : h);
										},
										placeholder: "人格设定（第一人称，如：你是林夏……）",
										style: textarea
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										style: {
											...row,
											marginTop: 8
										},
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
												style: buttonGhost,
												onClick: () => onSave(m.id, drafts[m.id] ?? ""),
												disabled: busy,
												children: "保存人格"
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
												style: buttonGhost,
												onClick: () => onDefault(m.id),
												children: "设为默认"
											}),
											!isDef ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
												style: buttonDanger,
												onClick: () => onDelete(m.id),
												children: "删除"
											}) : null,
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
												style: hint,
												children: hints[m.id] ?? ""
											})
										]
									})
								]
							}, m.id);
						})
					]
				})]
			});
		}
		//#endregion
		//#region src/client.ts
		/** 依赖的 client 服务：remote + 由桥接包 golem-client-remote 经 $mount 建立的
		*  `remote.golem` 命名空间（必须显式 inject 'remote.golem' 才能经 ctx.remote.golem
		*  访问；参照 dsh 内置 ui-goal 的 'remote.goals'）+ slots（设置面板注册）。 */
		const inject = [
			"remote",
			"remote.golem",
			"slots"
		];
		/**
		* 客户端插件入口：挂载 golem remote 贡献，并注册「假人」设置面板 section。
		* @param ctx - dsh client 根上下文。
		* @returns disposer：卸载 remote 贡献（section 注册随插件 fiber 自动回收）。
		*/
		async function apply(ctx) {
			const api = createGolemApi(ctx.remote.golem);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "golem",
				order: 90,
				label: () => "假人",
				inject: () => ({ api })
			}, GolemSettings));
			return async () => {};
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
