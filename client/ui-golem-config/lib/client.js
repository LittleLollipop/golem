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
				setDefaultInstance: (id) => remote.setDefaultInstance(id).then(unwrap)
			};
		}
		//#endregion
		//#region ../../../../../../../private/tmp/dsh-src/node_modules/.pnpm/react@18.3.1/node_modules/react/cjs/react-jsx-runtime.production.min.js
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
			var f = require("react"), k = Symbol.for("react.element"), m = Object.prototype.hasOwnProperty, n = f.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner, p = {
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
			exports.jsx = q;
			exports.jsxs = q;
		}));
		//#endregion
		//#region src/GolemSettings.tsx
		var import_jsx_runtime = (/* @__PURE__ */ __commonJSMin(((exports, module) => {
			module.exports = require_react_jsx_runtime_production_min();
		})))();
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
			const refresh = (0, react.useCallback)(async () => {
				setBusy(true);
				try {
					const [list, def] = await Promise.all([api.listInstances(), api.getDefaultInstance()]);
					setMetas(list);
					setDefaultId(def);
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
					await api.setInstanceMeta(id, { persona });
					setHints((h) => ({
						...h,
						[id]: "已保存"
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
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				style: { padding: 4 },
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					style: card,
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
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
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						style: hint,
						children: createHint
					})]
				}), metas.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
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
								defaultValue: m.persona ?? "",
								placeholder: "人格设定（第一人称，如：你是林夏……）",
								style: textarea
							}, m.id + ":" + (m.persona ?? "")),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								style: {
									...row,
									marginTop: 8
								},
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										style: buttonGhost,
										onClick: (e) => {
											const ta = e.currentTarget.closest(".card")?.querySelector("textarea");
											onSave(m.id, ta?.value ?? "");
										},
										children: "保存人格"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										style: buttonGhost,
										onClick: () => onDefault(m.id),
										children: "设为默认"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										style: hint,
										children: hints[m.id] ?? ""
									})
								]
							})
						]
					}, m.id);
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
