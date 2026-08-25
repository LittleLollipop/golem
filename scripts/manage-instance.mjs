#!/usr/bin/env node
/**
 * 多假人配置页 MVP (#27) — 命令行管理实例与人格。
 *
 * 用法：
 *   node scripts/manage-instance.mjs list
 *   node scripts/manage-instance.mjs create <id> <name> [--persona "<text>"]
 *   node scripts/manage-instance.mjs show <id>
 *   node scripts/manage-instance.mjs persona <id> "<text>"
 *
 * 与 sidecar（axolotl 记忆基质）直接通信，无需 dsh 运行。
 * 端点 base 走 FAKEREN_SIDECAR_URL，默认 http://127.0.0.1:8741。
 */
import { readFileSync } from "node:fs";

const BASE = process.env.FAKEREN_SIDECAR_URL ?? "http://127.0.0.1:8741";

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}
async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`${path} -> ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}
async function put(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`${path} -> ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json().catch(() => null);
}

function parseArgs(argv) {
  const out = { _: [], persona: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--persona") {
      out.persona = argv[++i];
    } else {
      out._.push(argv[i]);
    }
  }
  return out;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) {
    console.log("用法: manage-instance.mjs <list|create|show|persona> [...]");
    process.exit(1);
  }
  try {
    if (cmd === "list") {
      const metas = await get("/instances/meta");
      if (!metas.length) console.log("(无实例)");
      for (const m of metas) {
        console.log(`- ${m.id}  「${m.name}」 turns=${m.turns} persona=${m.persona ? "✓" : "—"}`);
      }
    } else if (cmd === "create") {
      const { _, persona } = parseArgs(rest);
      const [id, name] = _;
      if (!id || !name) throw new Error("create 需要 <id> <name>");
      await post(`/instance/create`, { id });
      const meta = (await get(`/${encodeURIComponent(id)}/meta`).catch(() => null)) ?? {
        id, name, createdAt: Date.now(), turns: 0,
      };
      meta.name = name;
      if (persona) meta.persona = persona;
      await put(`/${encodeURIComponent(id)}/meta`, meta);
      console.log(`已创建实例 ${id}${persona ? "（含人格）" : ""}`);
    } else if (cmd === "show") {
      const [id] = rest;
      const meta = await get(`/${encodeURIComponent(id)}/meta`);
      console.log(JSON.stringify(meta, null, 2));
    } else if (cmd === "persona") {
      const [id, ...textParts] = rest;
      let text = textParts.join(" ");
      if (text.startsWith("@") && !text.startsWith("@ ")) {
        text = readFileSync(text.slice(1), "utf8");
      }
      const meta = await get(`/${encodeURIComponent(id)}/meta`);
      meta.persona = text;
      await put(`/${encodeURIComponent(id)}/meta`, meta);
      console.log(`已为 ${id} 设定人格（${text.length} 字）`);
    } else {
      throw new Error(`未知命令: ${cmd}`);
    }
  } catch (err) {
    console.error("错误:", err.message);
    process.exit(1);
  }
}

main();
