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
				getDriftRecords: (id) => remote.getDriftRecords(id).then(unwrap),
				getKnowledgeRecords: (id) => remote.getKnowledgeRecords(id).then(unwrap),
				getDriftDims: () => remote.getDriftDims().then(unwrap),
				inferTraitBaseline: (id) => remote.inferTraitBaseline(id).then(unwrap)
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
		const card$2 = {
			border: "1px solid #ddd",
			borderRadius: 10,
			padding: "14px 16px",
			marginBottom: 14,
			background: "var(--card, #fff)"
		};
		const row$2 = {
			display: "flex",
			gap: 10,
			alignItems: "center",
			flexWrap: "wrap"
		};
		const input$2 = {
			font: "inherit",
			padding: "6px 8px",
			border: "1px solid #ccc",
			borderRadius: 8
		};
		const button$2 = {
			font: "inherit",
			padding: "6px 12px",
			border: "1px solid #2b6cb0",
			background: "#2b6cb0",
			color: "#fff",
			borderRadius: 8,
			cursor: "pointer"
		};
		const meta$2 = {
			fontSize: 12,
			color: "#999",
			marginTop: 4
		};
		const hint$2 = {
			fontSize: 12,
			color: "#c0392b",
			minHeight: 16,
			marginTop: 6
		};
		/** 数值 → 轨道百分比位置（-1..1 → 0..100）。 */
		function pct(v) {
			return 50 + Math.max(-1, Math.min(1, v)) * 50;
		}
		/**
		* 单值条（-1..1，中心为 0）。用于每日 delta 与累计偏移。
		* `name` 缺省时回退显示 key（维度定义未加载完的降级渲染，不崩）。
		*/
		function Bar({ name, v }) {
			const mag = Math.max(-1, Math.min(1, v));
			const pos = mag >= 0;
			const fill = {
				position: "absolute",
				top: 0,
				bottom: 0,
				background: pos ? "#2b8a5c" : "#c0392b",
				left: pos ? "50%" : `${pct(mag)}%`,
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
						children: name || "—"
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
		/**
		* 人格坐标条：灰点 = trait 基线（重力中心），彩条 = 从基线延伸到当前累积。
		*
		* `inert`（不参与每日漂移的 H / C 两维）整行灰显（Q3 裁定：露出来，但明确
		* 标注"仅作人格坐标"）——它们在闲聊文本中不可观测，强行每日打分只会变成噪声
		* （docs/persona-drift-dimensions.md §4.1）。
		*/
		function TraitBar({ label, hint: tip, base, cum, inert }) {
			const hasCum = cum != null;
			const end = hasCum ? cum : base;
			const left = pct(Math.min(base, end));
			const width = Math.abs(pct(end) - pct(base));
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				style: {
					margin: "7px 0",
					opacity: inert ? .55 : 1
				},
				title: tip,
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						alignItems: "center",
						gap: 10
					},
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							style: {
								width: 64,
								flex: "none",
								fontSize: 13
							},
							children: [label, inert ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 10,
									color: "#999",
									marginLeft: 4
								},
								children: "灰"
							}) : null]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							style: {
								position: "relative",
								flex: 1,
								height: 14,
								background: "#eee",
								border: "1px solid #ddd",
								borderRadius: 7,
								overflow: "visible"
							},
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: {
									position: "absolute",
									left: "50%",
									top: 0,
									bottom: 0,
									width: 1,
									background: "#ccc"
								} }),
								hasCum ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: {
									position: "absolute",
									top: 3,
									bottom: 3,
									left: `${left}%`,
									width: `${width}%`,
									background: end >= base ? "#2b8a5c" : "#c0392b",
									borderRadius: 4,
									opacity: .75
								} }) : null,
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: {
									position: "absolute",
									top: "50%",
									left: `${pct(base)}%`,
									width: 9,
									height: 9,
									marginLeft: -4.5,
									marginTop: -4.5,
									borderRadius: "50%",
									background: "#666",
									border: "1px solid #fff"
								} })
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							style: {
								width: 96,
								flex: "none",
								textAlign: "right",
								fontSize: 12,
								color: "#999"
							},
							children: inert ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "仅作人格坐标" }) : hasCum ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
								"基线 ",
								base >= 0 ? "+" : "",
								base.toFixed(2),
								" · 当前 ",
								cum >= 0 ? "+" : "",
								cum.toFixed(2)
							] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
								"基线 ",
								base >= 0 ? "+" : "",
								base.toFixed(2)
							] })
						})
					]
				}), inert ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 10,
						color: "#aaa",
						marginLeft: 74
					},
					children: "仅作人格坐标，不参与每日漂移"
				}) : null]
			});
		}
		/** Trait 键 → 对应的 State 漂移维度键（H / C 无对应，故不在此表）。 */
		const TRAIT_TO_STATE = {
			E: "emotionality",
			X: "extraversion",
			A: "agreeableness",
			O: "openness"
		};
		/** 表现层维度在 HEXACO 中无对应轴，回弹目标用代理映射（§5.3）。 */
		function proxyTarget(key, t) {
			switch (key) {
				case "verbosity": return t.X;
				case "playfulness": return (t.X + t.O) / 2;
				default: return 0;
			}
		}
		const SKIP_TEXT = {
			"already-done": (r) => `今日已完成内省（节点 ${r.existingNodeId ?? "?"} 已存在）`,
			"no-dialogue": () => "近期无对话 → 跳过（链断档）",
			"no-llm": () => "无 LLM → 跳过",
			"model-empty": () => "模型返回合法 JSON 但无有效维度 → 平凡日跳过"
		};
		function DriftDashboard({ api, instances }) {
			const [selected, setSelected] = (0, react.useState)("");
			const [records, setRecords] = (0, react.useState)([]);
			const [dims, setDims] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(false);
			const [err, setErr] = (0, react.useState)("");
			const timer = (0, react.useRef)(null);
			const effective = selected || instances[0]?.id || "";
			const selectedMeta = instances.find((m) => m.id === effective);
			(0, react.useEffect)(() => {
				let alive = true;
				api.getDriftDims().then((d) => {
					if (alive) setDims(d);
				}).catch((e) => {
					if (alive) setErr("维度定义加载失败: " + String(e));
				});
				return () => {
					alive = false;
				};
			}, [api]);
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
			const dimOrder = dims?.drift.map((d) => d.key) ?? [];
			const dimName = (k) => dims?.drift.find((d) => d.key === k)?.label ?? k;
			const total = records.length;
			const done = records.filter((r) => r.written).length;
			const skipped = records.filter((r) => !r.written && !r.error).length;
			const failed = records.filter((r) => r.error).length;
			const lastCum = [...records].reverse().find((r) => r.parsed?.cumulative)?.parsed?.cumulative;
			const trait = selectedMeta?.traitBaseline;
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				style: { padding: 4 },
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						style: row$2,
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
								style: {
									...input$2,
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
								style: button$2,
								onClick: () => void load(),
								disabled: loading,
								children: loading ? "刷新中…" : "刷新"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								style: meta$2,
								children: "每 5 秒自动刷新（idle 内省后记录会自动出现）"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						style: hint$2,
						children: err
					}),
					dims ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						style: {
							...card$2,
							marginTop: 12
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								style: {
									fontWeight: 600,
									marginBottom: 2
								},
								children: "人格坐标"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								style: meta$2,
								children: "灰点 = HEXACO 人格基线（漂移的重力中心）；彩条 = 当前累积相对基线的偏移。 灰显的两维在闲聊中不可观测，只作人格画像、不参与每日漂移。"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								style: { marginTop: 10 },
								children: dims.trait.map((t) => {
									const stateKey = TRAIT_TO_STATE[t.key];
									const cum = stateKey && lastCum ? lastCum[stateKey] : void 0;
									return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TraitBar, {
										label: t.label,
										hint: t.hint,
										base: trait ? trait[t.key] : 0,
										cum,
										inert: !t.drifts
									}, t.key);
								})
							}),
							dims.drift.filter((d) => d.layer === "expression").map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TraitBar, {
								label: d.label,
								hint: d.scope + "；" + d.notScope,
								base: trait ? proxyTarget(d.key, trait) : 0,
								cum: lastCum?.[d.key],
								inert: false
							}, d.key)),
							trait ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								style: {
									...meta$2,
									color: "#b8860b"
								},
								children: "该实例尚未标注人格基线 → 回弹目标暂按 0 处理。可到「实例配置」标六维或点「从人设自动推断」。"
							})
						]
					}) : null,
					instances.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						style: {
							...meta$2,
							marginTop: 20
						},
						children: "暂无实例，先到「实例配置」新建假人。"
					}) : total === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						style: {
							...meta$2,
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
								...card$2,
								marginBottom: 0,
								minWidth: 96,
								padding: "10px 14px"
							},
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								style: meta$2,
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
								...card$2,
								marginBottom: 0,
								flex: 1,
								minWidth: 240,
								padding: "10px 14px"
							},
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									style: meta$2,
									children: "当前累计偏移"
								}),
								dimOrder.filter((d) => lastCum[d]).map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bar, {
									name: dimName(d),
									v: lastCum[d]
								}, d)),
								Object.keys(lastCum).filter((d) => !dimOrder.includes(d)).map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bar, {
									name: dimName(d),
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
									...card$2,
									borderLeft: `4px solid ${borderColor}`
								},
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										style: row$2,
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
													...meta$2,
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
											style: meta$2,
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
											style: meta$2,
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
											dimOrder.filter((d) => r.parsed.dims[d] != null).map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bar, {
												name: dimName(d),
												v: r.parsed.dims[d]
											}, d)),
											Object.keys(r.parsed.dims).filter((d) => !dimOrder.includes(d)).map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bar, {
												name: dimName(d),
												v: r.parsed.dims[d]
											}, d)),
											r.parsed.revertPull && Object.keys(r.parsed.revertPull).length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", {
												style: { marginTop: 6 },
												children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", {
													style: {
														cursor: "pointer",
														color: "#2b6cb0",
														fontSize: 12
													},
													children: "重力回弹（trait 目标 / 回弹量）"
												}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
													style: {
														fontSize: 12,
														color: "#777",
														marginTop: 6,
														fontFamily: "ui-monospace, monospace"
													},
													children: Object.keys(r.parsed.revertPull).map((k) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
														dimName(k),
														"：目标 ",
														r.parsed.traitTarget?.[k]?.toFixed(2) ?? "0.00",
														" · 回弹 ",
														r.parsed.revertPull[k].toFixed(4)
													] }, k))
												})]
											}) : null,
											r.parsed.rationale ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
												style: { marginTop: 8 },
												children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
													style: meta$2,
													children: "判断理由"
												}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
													style: { fontSize: 13 },
													children: r.parsed.rationale
												})]
											}) : null,
											r.parsed.evidence?.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
												style: { marginTop: 8 },
												children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
													style: meta$2,
													children: "证据引用"
												}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
													style: {
														margin: "4px 0 0",
														paddingLeft: 18,
														color: "#999",
														fontSize: 12
													},
													children: r.parsed.evidence.map((e, j) => {
														const ref = r.parsed.evidenceRefs?.[j];
														return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
															ref?.nodeId ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
																style: {
																	color: "#2b8a5c",
																	fontFamily: "ui-monospace, monospace"
																},
																children: ref.nodeId
															}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
																style: { color: "#b8860b" },
																children: "（悬空）"
															}),
															" ",
															e
														] }, j);
													})
												})]
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
											r.written.evidenceSkipped > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
												style: { color: "#b8860b" },
												children: [" · 悬空 ", r.written.evidenceSkipped]
											}) : null,
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
		//#region src/KnowledgeDashboard.tsx
		const SRC_COLOR = {
			News: "#2563eb",
			"Hacker News": "#ea580c",
			Wikipedia: "#16a34a",
			web: "#7c3aed",
			static: "#0891b2"
		};
		const STATUS_COLOR = {
			learned: "#16a34a",
			empty: "#9ca3af",
			junk: "#d97706",
			error: "#dc2626"
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
		function badge(text, color) {
			return {
				fontSize: 11,
				padding: "2px 8px",
				borderRadius: 20,
				background: color + "26",
				color
			};
		}
		function KnowledgeDashboard({ api, instances }) {
			const [selected, setSelected] = (0, react.useState)("");
			const [records, setRecords] = (0, react.useState)([]);
			const [loading, setLoading] = (0, react.useState)(false);
			const [err, setErr] = (0, react.useState)("");
			const [onlyPurposeful, setOnlyPurposeful] = (0, react.useState)(false);
			const timer = (0, react.useRef)(null);
			const effective = selected || instances[0]?.id || "";
			const load = (0, react.useCallback)(async () => {
				if (!effective) return;
				setLoading(true);
				try {
					setRecords(await api.getKnowledgeRecords(effective));
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
			const view = onlyPurposeful ? records.filter((r) => r.kind === "purposeful") : records;
			const learned = records.filter((r) => r.status === "learned").length;
			const empty = records.filter((r) => r.status === "empty").length;
			const junkErr = records.filter((r) => r.status === "junk" || r.status === "error").length;
			const newsSocial = records.filter((r) => r.kind === "purposeful" && (r.source === "News" || r.source === "Hacker News") && r.status === "learned").length;
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
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								style: {
									...meta$1,
									display: "flex",
									alignItems: "center",
									gap: 4,
									cursor: "pointer"
								},
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: onlyPurposeful,
									onChange: (e) => setOnlyPurposeful(e.target.checked),
									style: { margin: 0 }
								}), "只看目的轨"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								style: meta$1,
								children: "每 5 秒自动刷新（idle 学习后记录会自动出现）"
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
					}) : records.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						style: {
							...meta$1,
							marginTop: 20
						},
						children: [
							"实例「",
							effective,
							"」还没有知识获取记录。去 dsh 聊天界面开聊几轮，然后",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "停手空闲几秒" }),
							"触发 idle 学习，记录会自动出现在这里。"
						]
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						style: {
							display: "flex",
							gap: 12,
							flexWrap: "wrap",
							marginTop: 12
						},
						children: [
							["总记录", records.length],
							["已学成", learned],
							["新闻+社交", newsSocial],
							["空/垃圾/失败", empty + junkErr]
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
						}, k))
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						style: { marginTop: 18 },
						children: view.slice().reverse().map((r, i) => {
							const sc = SRC_COLOR[r.source] || "#64748b";
							const stc = STATUS_COLOR[r.status] || "#64748b";
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								style: {
									...card$1,
									borderLeft: `4px solid ${stc}`
								},
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										style: row$1,
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
												style: badge(r.source, sc),
												children: r.source
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
												style: badge(r.status, stc),
												children: r.status
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
												style: {
													...meta$1,
													marginLeft: "auto"
												},
												children: [r.kind === "purposeful" ? "目的轨" : "随机轨", r.learnedAt ? " · " + new Date(r.learnedAt).toLocaleString("zh-CN") : ""]
											})
										]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										style: {
											marginTop: 8,
											fontSize: 14,
											fontWeight: 600
										},
										children: r.sourceUrl ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
											href: r.sourceUrl,
											target: "_blank",
											rel: "noopener",
											style: {
												color: "#1a1a1a",
												textDecoration: "none"
											},
											children: r.title || "(无标题)"
										}) : r.title || "(无标题)"
									}),
									r.summary ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										style: {
											marginTop: 6,
											fontSize: 13,
											color: "#555",
											lineHeight: 1.5
										},
										children: r.summary
									}) : null,
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										style: {
											...meta$1,
											marginTop: 6
										},
										children: [
											r.selectionPath,
											r.directive?.rationale ? " · 规划理由: " + r.directive.rationale : "",
											r.statusNote ? " · " + r.statusNote : ""
										]
									})
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
		/**
		* 标签页级错误边界：隔离单个 tab（内省记录 / 知识记录 / 实例配置）的渲染期异常，
		* 避免一个 tab 崩溃把整个设置面板（含 tab 按钮行）拖成白屏。
		*
		* 历史 bug（2026-09-01）：旧 DriftDashboard 因 SKIP_TEXT 类型误用，在渲染
		* `no-dialogue` 等 skip 记录时抛 TypeError，又因无 ErrorBoundary 兜底，整棵
		* GolemSettings 子树卸载 → 点开「内省记录」即全白。此边界让崩溃被收敛到内容区、
		* 且提供「重试」按钮，而非白屏。
		*/
		/**
		* HEXACO 六维人格坐标滑块（docs/persona-drift-dimensions.md §9.3）。
		*
		* 这是 Trait 层：每假人标一次、静态，兼作每日漂移的**重力中心**（回弹目标）。
		* `drifts: false` 的两维（H 诚实-谦逊 / C 尽责性）灰显并注明"不参与每日漂移"——
		* 它们在闲聊文本里不可观测，强行打分只会变噪声（§4.1）。Q3 裁定：露出来，
		* 但要说清楚它不参与漂移，否则用户会以为坐标残缺。
		*/
		function TraitSliders({ defs, value, onChange }) {
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				style: { marginTop: 6 },
				children: [defs.map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						alignItems: "center",
						gap: 10,
						margin: "5px 0",
						opacity: d.drifts ? 1 : .55
					},
					title: d.hint,
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							style: {
								width: 72,
								flex: "none",
								fontSize: 13
							},
							children: d.label
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							type: "range",
							min: -100,
							max: 100,
							step: 5,
							value: Math.round((value[d.key] ?? 0) * 100),
							onChange: (e) => onChange({
								...value,
								[d.key]: Number(e.target.value) / 100
							}),
							style: { flex: 1 }
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							style: {
								width: 96,
								flex: "none",
								textAlign: "right",
								fontSize: 12,
								color: "#999"
							},
							children: [(value[d.key] ?? 0) >= 0 ? "+" : "", (value[d.key] ?? 0).toFixed(2)]
						})
					]
				}, d.key)), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 11,
						color: "#aaa",
						marginTop: 4
					},
					children: "灰显维度不参与每日漂移（闲聊中不可观测），仅作人格坐标与回弹参考。"
				})]
			});
		}
		var TabErrorBoundary = class extends react.Component {
			state = { error: null };
			static getDerivedStateFromError(error) {
				return { error };
			}
			render() {
				if (this.state.error) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					style: {
						padding: 16,
						color: "#c0392b",
						border: "1px solid #c0392b",
						borderRadius: 8
					},
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							style: {
								fontWeight: 600,
								marginBottom: 6
							},
							children: "该标签页渲染出错"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							style: {
								fontSize: 13,
								marginBottom: 10,
								wordBreak: "break-word"
							},
							children: String(this.state.error.message)
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							style: {
								...button,
								fontSize: 13
							},
							onClick: () => this.setState({ error: null }),
							children: "重试"
						})
					]
				});
				return this.props.children;
			}
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
			/** HEXACO 六维定义的草稿（受控）。key = instanceId。 */
			const [traitDrafts, setTraitDrafts] = (0, react.useState)({});
			/** HEXACO 六维定义（后端下发，避免前端硬编码维度名）。 */
			const [traitDefs, setTraitDefs] = (0, react.useState)([]);
			/** 面板内标签页：实例配置 / 内省记录 / 知识记录。 */
			const [tab, setTab] = (0, react.useState)("config");
			const refresh = (0, react.useCallback)(async () => {
				setBusy(true);
				try {
					const [list, def] = await Promise.all([api.listInstances(), api.getDefaultInstance()]);
					setMetas(list);
					setDefaultId(def);
					setDrafts(Object.fromEntries(list.map((m) => [m.id, {
						core: m.personaCore ?? m.persona ?? "",
						ext: m.personaExt ?? ""
					}])));
					setTraitDrafts(Object.fromEntries(list.map((m) => [m.id, m.traitBaseline ?? {
						H: 0,
						E: 0,
						X: 0,
						A: 0,
						C: 0,
						O: 0
					}])));
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
			(0, react.useEffect)(() => {
				let alive = true;
				api.getDriftDims().then((d) => {
					if (alive) setTraitDefs(d.trait);
				}).catch((e) => console.error("[GolemSettings] getDriftDims failed:", e));
				return () => {
					alive = false;
				};
			}, [api]);
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
			const onSave = async (id, core, ext, trait) => {
				try {
					const updated = await api.setInstanceMeta(id, {
						personaCore: core,
						personaExt: ext,
						traitBaseline: trait
					});
					const echoedCore = updated.personaCore ?? "";
					const echoedExt = updated.personaExt ?? "";
					const echoedTrait = JSON.stringify(updated.traitBaseline ?? null);
					const ok = echoedCore === core && echoedExt === ext && echoedTrait === JSON.stringify(trait);
					setHints((h) => ({
						...h,
						[id]: ok ? core.trim() || ext.trim() ? "已保存（核心 " + core.length + " 字 / 扩展 " + ext.length + " 字 / 六维坐标）" : "已保存（已清空人格）" : "⚠ 保存未生效：服务端回读与提交不一致"
					}));
					await refresh();
				} catch (e) {
					setHints((h) => ({
						...h,
						[id]: "失败: " + String(e)
					}));
				}
			};
			/** 用 LLM 从核心人设推断 HEXACO 六维（§6.1 路径①）。只由用户点按钮触发。 */
			const onInferTrait = async (id) => {
				setHints((h) => ({
					...h,
					[id]: "推断中…"
				}));
				try {
					const t = (await api.inferTraitBaseline(id)).traitBaseline;
					setHints((h) => ({
						...h,
						[id]: t ? "已推断：" + [
							"H",
							"E",
							"X",
							"A",
							"C",
							"O"
						].map((k) => k + " " + (t[k] >= 0 ? "+" : "") + t[k].toFixed(2)).join(" · ") : "⚠ 推断未返回坐标"
					}));
					await refresh();
				} catch (e) {
					setHints((h) => ({
						...h,
						[id]: "推断失败: " + String(e)
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
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							style: tab === "config" ? button : buttonGhost,
							onClick: () => setTab("config"),
							children: "实例配置"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							style: tab === "drift" ? button : buttonGhost,
							onClick: () => setTab("drift"),
							children: "内省记录"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							style: tab === "knowledge" ? button : buttonGhost,
							onClick: () => setTab("knowledge"),
							children: "知识记录"
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabErrorBoundary, { children: tab === "drift" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DriftDashboard, {
					api,
					instances: metas
				}) : tab === "knowledge" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KnowledgeDashboard, {
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
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										style: meta,
										children: [
											"核心人格（常驻·每轮注入）：身份锚、红线/不可违背指令、性格维度基线、行为护栏。",
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "切勿挪入下方扩展框" }),
											"——红线丢了会出安全事故。"
										]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
										value: drafts[m.id]?.core ?? "",
										onChange: (e) => {
											const v = e.target.value;
											setDrafts((d) => ({
												...d,
												[m.id]: {
													...d[m.id] ?? {
														core: "",
														ext: ""
													},
													core: v
												}
											}));
											setHints((h) => h[m.id] ? {
												...h,
												[m.id]: ""
											} : h);
										},
										placeholder: "核心人格（第一人称，如：你是林夏，绝不对用户说谎……）",
										style: textarea
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										style: meta,
										children: "扩展设定（进图库·按需回忆）：背景故事、关系网络、偏好/禁忌实例、历史事件。"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
										value: drafts[m.id]?.ext ?? "",
										onChange: (e) => {
											const v = e.target.value;
											setDrafts((d) => ({
												...d,
												[m.id]: {
													...d[m.id] ?? {
														core: "",
														ext: ""
													},
													ext: v
												}
											}));
											setHints((h) => h[m.id] ? {
												...h,
												[m.id]: ""
											} : h);
										},
										placeholder: "扩展设定（如：养一只叫豆豆的狗，雨天情绪低……）",
										style: textarea
									}),
									traitDefs.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										style: meta,
										children: [
											"HEXACO 人格坐标（Trait 层）：每假人标一次的静态人格基线， 同时是每日漂移的",
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "重力中心" }),
											"——累积偏移会被拉回这里。"
										]
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TraitSliders, {
										defs: traitDefs,
										value: traitDrafts[m.id] ?? {
											H: 0,
											E: 0,
											X: 0,
											A: 0,
											C: 0,
											O: 0
										},
										onChange: (next) => {
											setTraitDrafts((d) => ({
												...d,
												[m.id]: next
											}));
											setHints((h) => h[m.id] ? {
												...h,
												[m.id]: ""
											} : h);
										}
									})] }) : null,
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										style: {
											...row,
											marginTop: 8
										},
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
												style: buttonGhost,
												onClick: () => onSave(m.id, drafts[m.id]?.core ?? "", drafts[m.id]?.ext ?? "", traitDrafts[m.id] ?? {
													H: 0,
													E: 0,
													X: 0,
													A: 0,
													C: 0,
													O: 0
												}),
												disabled: busy,
												children: "保存人格"
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
												style: buttonGhost,
												onClick: () => void onInferTrait(m.id),
												disabled: busy,
												title: "用 LLM 读核心人设，推断 HEXACO 六维坐标并写入",
												children: "从人设自动推断"
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
				}) })]
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
