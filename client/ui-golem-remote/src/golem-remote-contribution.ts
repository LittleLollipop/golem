import { z } from 'zod'
import type {
  InvocationDescriptor,
  TypertCodec,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'

/**
 * 手写（非 codegen）的 Remote 贡献描述。
 *
 * ⚠️ 关键：客户端 `ctx.remote.$mount` 要求每个 descriptor 的 `result` 与每个
 * `parameters[].codec` 都必须是 **strict** 模式（`mode: 'strict'` + 一个 zod v4
 * schema，见 api-gateway `requireStrictCodec`）。`src-json` 只用于 Host 从源码
 * 运行（SRC 模式），客户端一律拒绝。所以此处不能用 SRC_JSON，必须带 zod schema。
 *
 * zod 由 tsdown 内联进 client bundle（本包 tsdown.config 的 external 仅 react），
 * 因为 dsh 浏览器模块表未注册 zod（否则 `require('zod')` 落空）。
 *
 * ⚠️ wire 键必须与 golem 服务端 `GolemRemoteService`（`src/golem-remote.ts`）
 * 各 `@Remote` 方法的【编译后】形参名**完全一致**：host SRC 模式从方法源码
 * 解析形参名作为 wire 键（dsh api-gateway `methodParameterNames`）。若服务端
 * 改了形参名，此处必须同步。顺序无关（host 按 wire 键名匹配），但键名必须一致。
 */

// 与 golem 服务端 `src/types.ts` 的 `InstanceMeta` 保持一致的 zod schema。
// 客户端不引入服务端包（保证 bundle 纯度）；此 schema 须随服务端同步变更。
const instanceMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  persona: z.string().optional(),
  createdAt: z.number(),
  turns: z.number(),
})

// setInstanceMeta 的 patch 参数：Partial<InstanceMeta>，字段全可选。
const instanceMetaPatchSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  persona: z.string().optional(),
  createdAt: z.number().optional(),
  turns: z.number().optional(),
})

// ── 内省记录（DriftExecutionResult）schema ──────────────────────────────────
// 与 golem 服务端 `src/agent/persona-drift.ts` 的 DriftExecutionResult 保持一致。
const driftInputSchema = z.object({
  dialogTurns: z.number(),
  recentDays: z.number(),
  memoryTopics: z.number(),
  historyDrifts: z.number(),
})
const driftParsedSchema = z.object({
  dims: z.record(z.string(), z.number()),
  cumulative: z.record(z.string(), z.number()),
  mood: z.string().optional(),
  leaning: z.string().optional(),
  preoccupation: z.string().optional(),
  rationale: z.string().optional(),
  evidence: z.array(z.string()),
})
const driftWrittenSchema = z.object({
  nodeId: z.string(),
  causalEdges: z.number(),
  evidenceEdges: z.number(),
})
const driftRecordSchema = z.object({
  instanceId: z.string(),
  date: z.string(),
  triggeredAt: z.string(),
  triggered: z.boolean(),
  skipReason: z.enum(["already-done", "no-dialogue", "no-llm", "model-empty"]).optional(),
  existingNodeId: z.string().optional(),
  input: driftInputSchema.optional(),
  llmRaw: z.string().optional(),
  error: z.enum(["llm-error", "bad-json"]).optional(),
  parsed: driftParsedSchema.optional(),
  written: driftWrittenSchema.optional(),
})

/**
 * 构造一个 strict codec。`schema` 必须为 zod v4（带 `_zod` 标记），客户端
 * 在解析结果/参数时会调用 `schema.parse(value)`。
 */
function strict(typeSymbol: string, schema: z.ZodTypeAny): TypertCodec {
  return { mode: 'strict', typeSymbol, schema }
}

/** 把业务结果 T 包成 `{ ok: true, value } | { ok: false, error }` 的 zod union。 */
function remoteResult(value: z.ZodTypeAny): z.ZodTypeAny {
  return z.union([
    z.object({ ok: z.literal(true), value }),
    z.object({
      ok: z.literal(false),
      error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.unknown(),
      }),
    }),
  ])
}

const descriptors: readonly InvocationDescriptor[] = [
  {
    id: 'golem#golem/listInstances',
    service: 'golem',
    namespace: 'golem',
    method: 'listInstances',
    invocation: { kind: 'direct' },
    parameters: [],
    result: strict('golem/types#InstanceMeta[]', remoteResult(z.array(instanceMetaSchema))),
  },
  {
    id: 'golem#golem/createInstance',
    service: 'golem',
    namespace: 'golem',
    method: 'createInstance',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'id', wire: 'id', source: 'json', codec: strict('golem/types#InstanceId', z.string()) },
      { name: 'name', wire: 'name', source: 'json', codec: strict('golem/types#InstanceName', z.string()) },
      {
        name: 'persona',
        wire: 'persona',
        source: 'json',
        codec: strict('golem/types#InstancePersona?', z.string().optional()),
        acceptsUndefined: true,
      },
    ],
    result: strict('golem/types#InstanceMeta', remoteResult(instanceMetaSchema)),
  },
  {
    id: 'golem#golem/getInstanceMeta',
    service: 'golem',
    namespace: 'golem',
    method: 'getInstanceMeta',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'id', wire: 'id', source: 'json', codec: strict('golem/types#InstanceId', z.string()) },
    ],
    result: strict('golem/types#InstanceMeta?', remoteResult(z.union([instanceMetaSchema, z.null()]))),
  },
  {
    id: 'golem#golem/setInstanceMeta',
    service: 'golem',
    namespace: 'golem',
    method: 'setInstanceMeta',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'id', wire: 'id', source: 'json', codec: strict('golem/types#InstanceId', z.string()) },
      { name: 'patch', wire: 'patch', source: 'json', codec: strict('golem/types#InstanceMetaPatch', instanceMetaPatchSchema) },
    ],
    result: strict('golem/types#InstanceMeta', remoteResult(instanceMetaSchema)),
  },
  {
    id: 'golem#golem/getDefaultInstance',
    service: 'golem',
    namespace: 'golem',
    method: 'getDefaultInstance',
    invocation: { kind: 'direct' },
    parameters: [],
    result: strict('golem/types#InstanceId?', remoteResult(z.union([z.string(), z.null()]))),
  },
  {
    id: 'golem#golem/setDefaultInstance',
    service: 'golem',
    namespace: 'golem',
    method: 'setDefaultInstance',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'id', wire: 'id', source: 'json', codec: strict('golem/types#InstanceId', z.string()) },
    ],
    result: strict('golem/types#null', remoteResult(z.null())),
  },
  {
    id: 'golem#golem/deleteInstance',
    service: 'golem',
    namespace: 'golem',
    method: 'deleteInstance',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'id', wire: 'id', source: 'json', codec: strict('golem/types#InstanceId', z.string()) },
    ],
    result: strict('golem/types#null', remoteResult(z.null())),
  },
  {
    id: 'golem#golem/getDriftRecords',
    service: 'golem',
    namespace: 'golem',
    method: 'getDriftRecords',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'instanceId', wire: 'instanceId', source: 'json', codec: strict('golem/types#InstanceId', z.string()) },
    ],
    result: strict('golem/types#DriftRecord[]', remoteResult(z.array(driftRecordSchema))),
  },
]

export const golemRemoteContribution: TypertRemoteContribution = {
  package: 'golem',
  descriptors,
}
