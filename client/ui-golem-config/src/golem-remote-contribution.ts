import type {
  InvocationDescriptor,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'

// src-json：SRC 弱解析——参数/结果走 JSON 透传，不做严格 schema 校验。
// 与服务端 SRC 模式推导出的 descriptor 一致（见 dsh api-gateway srcDescriptor）。
const SRC_JSON = { mode: 'src-json' } as const

/**
 * 手写（非 codegen）的 Remote 贡献描述。
 *
 * ⚠️ wire 键必须与 golem 服务端 `GolemRemoteService`（`src/golem-remote.ts`）
 * 各 `@Remote` 方法的【编译后】形参名**完全一致**：host SRC 模式从方法源码
 * 解析形参名作为 wire 键（dsh api-gateway `methodParameterNames`）。若服务端
 * 改了形参名，此处必须同步。
 *
 * 顺序无关紧要（host 按 wire 键名匹配，不按位置），但键名必须一致。
 */
const descriptors: readonly InvocationDescriptor[] = [
  {
    id: 'golem/listInstances',
    service: 'golem',
    namespace: 'golem',
    method: 'listInstances',
    invocation: { kind: 'direct' },
    parameters: [],
    result: SRC_JSON,
  },
  {
    id: 'golem/createInstance',
    service: 'golem',
    namespace: 'golem',
    method: 'createInstance',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'id', wire: 'id', source: 'json', codec: SRC_JSON },
      { name: 'name', wire: 'name', source: 'json', codec: SRC_JSON },
      { name: 'persona', wire: 'persona', source: 'json', codec: SRC_JSON, acceptsUndefined: true },
    ],
    result: SRC_JSON,
  },
  {
    id: 'golem/getInstanceMeta',
    service: 'golem',
    namespace: 'golem',
    method: 'getInstanceMeta',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'id', wire: 'id', source: 'json', codec: SRC_JSON },
    ],
    result: SRC_JSON,
  },
  {
    id: 'golem/setInstanceMeta',
    service: 'golem',
    namespace: 'golem',
    method: 'setInstanceMeta',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'id', wire: 'id', source: 'json', codec: SRC_JSON },
      { name: 'patch', wire: 'patch', source: 'json', codec: SRC_JSON },
    ],
    result: SRC_JSON,
  },
  {
    id: 'golem/getDefaultInstance',
    service: 'golem',
    namespace: 'golem',
    method: 'getDefaultInstance',
    invocation: { kind: 'direct' },
    parameters: [],
    result: SRC_JSON,
  },
  {
    id: 'golem/setDefaultInstance',
    service: 'golem',
    namespace: 'golem',
    method: 'setDefaultInstance',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'id', wire: 'id', source: 'json', codec: SRC_JSON },
    ],
    result: SRC_JSON,
  },
]

export const golemRemoteContribution: TypertRemoteContribution = {
  package: 'golem-client-ui-config',
  descriptors,
}
