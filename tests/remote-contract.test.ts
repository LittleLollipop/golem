/**
 * Remote 契约测试 —— 锁死「服务端 @Remote 表面」与「客户端 descriptor」的一致性。
 *
 * 存在的理由（都是真金白银踩出来的坑）：
 *
 *  1. **字段静默 strip**：客户端 `ctx.remote.$mount` 用 strict zod codec 解析
 *     结果，**schema 里没写的字段会被直接丢弃、不报错**。personaCore/personaExt
 *     那次是这样（保存成功但读回来是空），traitBaseline 这次又是同一处。
 *     → 用例：InstanceMeta / DriftExecutionResult 的字段必须全部出现在 schema 里。
 *
 *  2. **wire 键漂移**：host SRC 模式按【编译后形参名】作 wire 键匹配参数。
 *     服务端改形参名而 descriptor 没跟上 → 参数静默变 undefined。
 *     → 用例：descriptor 的 `parameters[].wire` 集合必须等于服务端方法形参集合。
 *
 *  3. **方法集合漂移**：服务端加了 @Remote 方法、客户端没加 descriptor（或反之）
 *     → 调用落到 undefined。
 *     → 用例：两边方法集合双向相等。
 *
 * ⚠️ 这里刻意用**源码静态解析**而不是 import 服务端类：`GolemRemoteService` 用
 * TC39 装饰器，本项目 vitest 不转译装饰器（GolemInstanceApi 抽出来正是为此）。
 * 解析目标文件的格式是固定的，正则足够可靠；真要改格式，测试会红并提示。
 *
 * ✅ 已做**变异验证**（写完必须验它能红，否则等于没写）：
 *   - 从 `instanceMetaSchema` 删掉 `traitBaseline` → 4 条 InstanceMeta 用例全红
 *     （正是 listInstances/getInstanceMeta/setInstanceMeta/inferTraitBaseline 四条读取路径）
 *   - 把 `inferTraitBaseline` 的 wire 键 `id` 改成 `instanceId` → 该条参数用例红
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { golemRemoteContribution } from "../client/ui-golem-remote/src/golem-remote-contribution.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const SERVER_SRC = path.join(ROOT, "src/golem-remote.ts");
const TYPES_SRC = path.join(ROOT, "src/types.ts");
const DRIFT_SRC = path.join(ROOT, "src/agent/persona-drift.ts");

// ── zod 内省（client 包用的是 zod v4：object 的 shape 在 `_zod.def.shape`） ──

/** 取一个 zod schema 的顶层键集合（非 object 返回空数组）。 */
function schemaKeys(schema: unknown): string[] {
  const s = unwrap(schema);
  const shape = s?._zod?.def?.shape ?? s?.shape;
  return shape && typeof shape === "object" ? Object.keys(shape) : [];
}

/**
 * 剥掉包裹层（optional / nullable / default / readonly …），拿到内层 schema。
 * zod v4 里 `z.optional(x)` 的 def 是 `{ type:"optional", innerType: x }`——
 * DriftExecutionResult 的 parsed/written 就是 optional，不剥会拿到空 shape。
 */
function unwrap(schema: unknown): any {
  let s = schema as any;
  for (let i = 0; i < 8; i++) {
    const def = s?._zod?.def;
    if (!def) return s;
    if (def.type === "optional" || def.type === "nullable" || def.type === "readonly") {
      if (!def.innerType) return schema as any;
      s = def.innerType;
      continue;
    }
    if (def.type === "default") {
      s = def.innerType;
      continue;
    }
    return s;
  }
  return s;
}

/** 数组 schema 的元素 schema。 */
function arrayElement(schema: unknown): any {
  const s = unwrap(schema);
  return s?._zod?.def?.element ?? s?._def?.type ?? s;
}

/**
 * 把载荷 schema 归一成「对象 schema」——几种真实存在的包法：
 *   - `z.array(meta)`          （listInstances）
 *   - `z.union([meta, null])`  （getInstanceMeta，查不到时返回 null）
 *   - 裸 object                （setInstanceMeta / inferTraitBaseline）
 * null 分支不带 shape，会被过滤掉。
 */
function objectSchema(payload: unknown): any {
  const s = unwrap(payload);
  const def = s?._zod?.def;
  if (!def) return s;
  if (def.type === "array") return objectSchema(def.element);
  if (def.type === "union") {
    const branches: any[] = def.options ?? def.values ?? [];
    const objects = branches.map(objectSchema).filter((b) => b?._zod?.def?.shape);
    if (objects.length !== 1) {
      throw new Error(
        `载荷 union 里解析出 ${objects.length} 个对象分支，无法确定目标 schema —— 结构变了，请更新本测试`,
      );
    }
    return objects[0];
  }
  return s;
}

/** enum schema 的取值集合（zod v4 在 `def.entries` 映射表，v3 在 `def.values`）。 */
function enumValues(schema: unknown): string[] {
  const def = unwrap(schema)?._zod?.def;
  if (def?.entries && typeof def.entries === "object") return Object.keys(def.entries);
  if (Array.isArray(def?.values)) return [...def.values];
  throw new Error(`拿不到 enum 取值 —— key 字段不是 enum 了？def.type=${def?.type}`);
}

/**
 * 剥掉 `remoteResult()` 包的外层 union，拿到**业务载荷**的 schema。
 * remoteResult = z.union([{ok:true,value}, {ok:false,error}])
 *
 * ⚠️ zod v4 的 union 分支在 `def.options`（v3 是 `def.values`），两个都兜一下，
 * 免得哪天升/降级 zod 时这里静默失效返回空集。
 */
function payloadSchema(resultCodec: unknown): unknown {
  const s = (resultCodec as any)?.schema;
  const branches = s?._zod?.def?.options ?? s?._zod?.def?.values;
  if (Array.isArray(branches)) {
    const okBranch = branches.find((v: any) => v?._zod?.def?.shape?.value);
    if (okBranch) return okBranch._zod.def.shape.value;
    throw new Error(
      `remoteResult union 里找不到 { ok, value } 分支 —— remoteResult() 的构造改了？`,
    );
  }
  return s;
}

// ── 源码静态解析 ───────────────────────────────────────────────────────────

interface ServerMethod {
  name: string;
  /** 形参名（顺序无关，host 按 wire 键名匹配）。 */
  params: string[];
}

/** 从 `@Remote("x")` + 紧随其后的方法签名里解析方法名与形参名。 */
function parseServerMethods(file: string): ServerMethod[] {
  const src = fs.readFileSync(file, "utf8");
  const out: ServerMethod[] = [];
  const re = /@Remote\("([^"]+)"\)\s*\n\s*(?:async\s+)?(\w+)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const [, remoteName, methodName, rawParams] = m;
    // `@Remote("x")` 的名字应与方法名一致——不一致说明有人只改了一处
    expect(remoteName).toBe(methodName);
    const params = rawParams
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        // `id: InstanceId` / `patch: Partial<InstanceMeta>` / `persona?: string`
        const colon = p.indexOf(":");
        return (colon === -1 ? p : p.slice(0, colon)).trim().replace(/\?$/, "");
      });
    out.push({ name: methodName, params });
  }
  return out;
}

/** 从一个 `export interface X {` 块里解析顶层字段名（跳过注释与嵌套体）。 */
function parseInterfaceFields(file: string, name: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const start = src.indexOf(`export interface ${name} {`);
  if (start === -1) throw new Error(`interface ${name} not found in ${file}`);
  const body = src.slice(start);
  const end = body.indexOf("\n}");
  const block = end === -1 ? body : body.slice(0, end);
  const out: string[] = [];
  for (const line of block.split("\n")) {
    const m = /^ {2}(\w+)\??\s*:/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

// ── 被测对象 ───────────────────────────────────────────────────────────────

const descriptors = (golemRemoteContribution as any).descriptors as Array<{
  method: string;
  parameters: Array<{ name: string; wire: string; codec: { mode: string } }>;
  result: { mode: string; schema?: unknown };
}>;

function descriptorOf(method: string) {
  const d = descriptors.find((x) => x.method === method);
  if (!d) throw new Error(`descriptor for ${method} not found`);
  return d;
}

const serverMethods = parseServerMethods(SERVER_SRC);

describe("remote 契约：方法集合双向一致", () => {
  it("服务端每个 @Remote 方法都有客户端 descriptor", () => {
    const clientMethods = new Set(descriptors.map((d) => d.method));
    const missing = serverMethods.map((m) => m.name).filter((n) => !clientMethods.has(n));
    expect(missing).toEqual([]);
  });

  it("客户端每个 descriptor 都对应服务端的 @Remote 方法", () => {
    const serverNames = new Set(serverMethods.map((m) => m.name));
    const orphan = descriptors.map((d) => d.method).filter((n) => !serverNames.has(n));
    expect(orphan).toEqual([]);
  });

  it("至少覆盖了预期的全部方法（防止解析正则失效导致空集通过）", () => {
    expect(serverMethods.length).toBeGreaterThanOrEqual(10);
    expect(serverMethods.map((m) => m.name)).toContain("getDriftDims");
    expect(serverMethods.map((m) => m.name)).toContain("inferTraitBaseline");
  });
});

describe("remote 契约：wire 键 = 服务端形参名", () => {
  for (const sm of serverMethods) {
    it(`${sm.name} 的参数 wire 键与服务端形参一致`, () => {
      const d = descriptorOf(sm.name);
      expect(d.parameters.map((p) => p.wire).sort()).toEqual([...sm.params].sort());
    });
  }
});

describe("remote 契约：strict codec（客户端 $mount 的硬性要求）", () => {
  it("所有 result 与 parameter codec 都是 strict 模式", () => {
    for (const d of descriptors) {
      expect(d.result.mode, `${d.method} result`).toBe("strict");
      for (const p of d.parameters) {
        expect(p.codec.mode, `${d.method}.${p.wire}`).toBe("strict");
      }
    }
  });
});

describe("remote 契约：InstanceMeta 字段不被 strip", () => {
  const fields = parseInterfaceFields(TYPES_SRC, "InstanceMeta");

  it("解析出了 InstanceMeta 的字段（防正则失效）", () => {
    expect(fields).toContain("id");
    expect(fields).toContain("traitBaseline");
    expect(fields).toContain("personaCore");
  });

  for (const method of ["listInstances", "getInstanceMeta", "setInstanceMeta", "inferTraitBaseline"]) {
    it(`${method} 的 schema 覆盖 InstanceMeta 全部字段`, () => {
      const meta = objectSchema(payloadSchema(descriptorOf(method).result));
      const keys = new Set(schemaKeys(meta));
      expect(keys.size, `${method} 拿不到 InstanceMeta 字段 → 内省路径失效`).toBeGreaterThan(0);
      const missing = fields.filter((f) => !keys.has(f));
      expect(missing, `${method} 缺字段 → 读回会被静默 strip`).toEqual([]);
    });
  }

  it("setInstanceMeta 的 patch schema 也能承载全部字段（否则保存不生效）", () => {
    const d = descriptorOf("setInstanceMeta");
    const patch = d.parameters.find((p) => p.wire === "patch")!;
    const keys = new Set(schemaKeys(patch.codec.schema ?? (patch.codec as any)));
    const missing = fields.filter((f) => !keys.has(f));
    expect(missing, "patch schema 缺字段 → 保存时该字段被丢弃").toEqual([]);
  });
});

describe("remote 契约：drift 记录字段不被 strip", () => {
  const writtenFields = parseInterfaceFields(DRIFT_SRC, "DriftExecutionResult");

  it("解析出了 DriftExecutionResult 的字段（防正则失效）", () => {
    expect(writtenFields).toContain("parsed");
    expect(writtenFields).toContain("written");
  });

  it("drift 记录 schema 覆盖 DriftExecutionResult 全部字段", () => {
    const element = arrayElement(payloadSchema(descriptorOf("getDriftRecords").result));
    const elKeys = new Set(schemaKeys(element));
    expect(elKeys.size, "拿不到 drift 记录字段 → 内省路径失效").toBeGreaterThan(0);
    const missing = writtenFields.filter((f) => !elKeys.has(f));
    expect(missing, "缺字段 → 内省记录在 UI 上静默少内容").toEqual([]);
  });

  it("parsed 里的新增字段（evidenceRefs / traitTarget / revertPull）都在 schema 中", () => {
    const element = arrayElement(payloadSchema(descriptorOf("getDriftRecords").result));
    const parsed = (element?._zod?.def?.shape ?? {})?.parsed;
    const keys = new Set(schemaKeys(parsed));
    for (const f of ["evidenceRefs", "traitTarget", "revertPull"]) {
      expect(keys.has(f), `parsed.${f} 缺失 → 回弹审计数据在 UI 上消失`).toBe(true);
    }
  });

  it("written 里的 evidenceSkipped 在 schema 中（悬空计数不能丢）", () => {
    const element = arrayElement(payloadSchema(descriptorOf("getDriftRecords").result));
    const written = (element?._zod?.def?.shape ?? {})?.written;
    expect(schemaKeys(written)).toContain("evidenceSkipped");
  });
});

describe("remote 契约：维度定义下发", () => {
  it("getDriftDims 的载荷含 drift 与 trait 两段", () => {
    const keys = new Set(schemaKeys(payloadSchema(descriptorOf("getDriftDims").result)));
    expect([...keys].sort()).toEqual(["drift", "trait"]);
  });

  it("trait 段用 HEXACO 六维枚举键（写错键会整段解析失败）", () => {
    const payload: any = payloadSchema(descriptorOf("getDriftDims").result);
    const traitEl = arrayElement(payload?._zod?.def?.shape?.trait);
    const keySchema = (traitEl?._zod?.def?.shape ?? {})?.key;
    expect(enumValues(keySchema).sort()).toEqual(["A", "C", "E", "H", "O", "X"]);
  });

  it("trait 段带 drifts 标记（UI 靠它把 H/C 置灰）", () => {
    const payload: any = payloadSchema(descriptorOf("getDriftDims").result);
    const traitEl = arrayElement(payload?._zod?.def?.shape?.trait);
    expect(schemaKeys(traitEl)).toContain("drifts");
  });
});
