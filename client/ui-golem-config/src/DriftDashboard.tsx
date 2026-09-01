import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { GolemApi } from './golem-api.ts'
import type {
  DriftDimsPayload,
  DriftExecutionResult,
  InstanceMeta,
  TraitBaseline,
} from './types.ts'

/**
 * dsh 设置面板「内省记录」标签页内容：展示某实例全部 idle 内省执行记录的时间线。
 * 数据来自 `api.getDriftRecords`（后端经 ctx.remote.golem 直接读 JSONL 时间序列）。
 *
 * ⚠️ 维度定义**不再硬编码**在本文件（docs/persona-drift-dimensions.md §9.1）：
 * 旧实现把维度名与中文标签写死在前端，维度一改 UI 立即错位——新维度会渲染成
 * 裸 key。现在统一经 `api.getDriftDims()` 从后端拉取，后端是单一真源。
 */
export interface DriftDashboardProps {
  api: GolemApi
  instances: InstanceMeta[]
}

const card: CSSProperties = {
  border: '1px solid #ddd', borderRadius: 10, padding: '14px 16px', marginBottom: 14,
  background: 'var(--card, #fff)',
}
const row: CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }
const input: CSSProperties = { font: 'inherit', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 8 }
const button: CSSProperties = {
  font: 'inherit', padding: '6px 12px', border: '1px solid #2b6cb0', background: '#2b6cb0',
  color: '#fff', borderRadius: 8, cursor: 'pointer',
}
const meta: CSSProperties = { fontSize: 12, color: '#999', marginTop: 4 }
const hint: CSSProperties = { fontSize: 12, color: '#c0392b', minHeight: 16, marginTop: 6 }

/** 数值 → 轨道百分比位置（-1..1 → 0..100）。 */
function pct(v: number): number {
  return 50 + Math.max(-1, Math.min(1, v)) * 50
}

/**
 * 单值条（-1..1，中心为 0）。用于每日 delta 与累计偏移。
 * `name` 缺省时回退显示 key（维度定义未加载完的降级渲染，不崩）。
 */
function Bar({ name, v }: { name?: string; v: number }) {
  const mag = Math.max(-1, Math.min(1, v))
  const pos = mag >= 0
  const fill: CSSProperties = {
    position: 'absolute', top: 0, bottom: 0,
    background: pos ? '#2b8a5c' : '#c0392b',
    left: pos ? '50%' : `${pct(mag)}%`,
    width: `${Math.abs(mag) * 50}%`,
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
      <div style={{ width: 64, flex: 'none', fontSize: 13 }}>{name || '—'}</div>
      <div style={{ position: 'relative', flex: 1, height: 14, background: '#eee', border: '1px solid #ddd', borderRadius: 7, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#ccc' }} />
        <div style={fill} />
      </div>
      <div style={{ width: 56, flex: 'none', textAlign: 'right', fontSize: 12, color: '#999' }}>
        {v >= 0 ? '+' : ''}{v.toFixed(2)}
      </div>
    </div>
  )
}

/**
 * 人格坐标条：灰点 = trait 基线（重力中心），彩条 = 从基线延伸到当前累积。
 *
 * `inert`（不参与每日漂移的 H / C 两维）整行灰显（Q3 裁定：露出来，但明确
 * 标注"仅作人格坐标"）——它们在闲聊文本中不可观测，强行每日打分只会变成噪声
 * （docs/persona-drift-dimensions.md §4.1）。
 */
function TraitBar({
  label,
  hint: tip,
  base,
  cum,
  inert,
}: {
  label: string
  hint: string
  base: number
  cum?: number
  inert: boolean
}) {
  const hasCum = cum != null
  const end = hasCum ? cum : base
  const left = pct(Math.min(base, end))
  const width = Math.abs(pct(end) - pct(base))
  return (
    <div
      style={{ margin: '7px 0', opacity: inert ? 0.55 : 1 }}
      title={tip}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 64, flex: 'none', fontSize: 13 }}>
          {label}
          {inert ? <span style={{ fontSize: 10, color: '#999', marginLeft: 4 }}>灰</span> : null}
        </div>
        <div style={{ position: 'relative', flex: 1, height: 14, background: '#eee', border: '1px solid #ddd', borderRadius: 7, overflow: 'visible' }}>
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#ccc' }} />
          {hasCum ? (
            <div
              style={{
                position: 'absolute', top: 3, bottom: 3,
                left: `${left}%`, width: `${width}%`,
                background: end >= base ? '#2b8a5c' : '#c0392b',
                borderRadius: 4, opacity: 0.75,
              }}
            />
          ) : null}
          {/* 重力中心：trait 基线 */}
          <div
            style={{
              position: 'absolute', top: '50%', left: `${pct(base)}%`,
              width: 9, height: 9, marginLeft: -4.5, marginTop: -4.5,
              borderRadius: '50%', background: '#666', border: '1px solid #fff',
            }}
          />
        </div>
        <div style={{ width: 96, flex: 'none', textAlign: 'right', fontSize: 12, color: '#999' }}>
          {inert
            ? <span>仅作人格坐标</span>
            : hasCum
              ? <>基线 {base >= 0 ? '+' : ''}{base.toFixed(2)} · 当前 {cum >= 0 ? '+' : ''}{cum.toFixed(2)}</>
              : <>基线 {base >= 0 ? '+' : ''}{base.toFixed(2)}</>}
        </div>
      </div>
      {inert ? (
        <div style={{ fontSize: 10, color: '#aaa', marginLeft: 74 }}>仅作人格坐标，不参与每日漂移</div>
      ) : null}
    </div>
  )
}

/** Trait 键 → 对应的 State 漂移维度键（H / C 无对应，故不在此表）。 */
const TRAIT_TO_STATE: Record<string, string> = {
  E: 'emotionality',
  X: 'extraversion',
  A: 'agreeableness',
  O: 'openness',
}

/** 表现层维度在 HEXACO 中无对应轴，回弹目标用代理映射（§5.3）。 */
function proxyTarget(key: string, t: TraitBaseline): number {
  switch (key) {
    case 'verbosity': return t.X
    case 'playfulness': return (t.X + t.O) / 2
    default: return 0
  }
}

// ⚠️ 修复（2026-09-01）：旧实现把这里声明为 `Record<string, string>`，但
// `'already-done'` 的值是函数、`'no-dialogue'` 等是字符串。渲染时统一用
// `SKIP_TEXT[r.skipReason]?.(r)` 调用——当 skipReason 为 no-dialogue/no-llm/
// model-empty 时，取到的是**字符串**，对其做可选调用 `?.(r)` 会抛
// `TypeError: ... is not a function`，导致整个设置面板白屏（无 ErrorBoundary 兜底）。
// 现统一为「值均为函数 (r) => string」，调用侧 `?.(r)` 对所有 skipReason 都安全。
const SKIP_TEXT: Record<string, (r: DriftExecutionResult) => string> = {
  'already-done': (r) => `今日已完成内省（节点 ${r.existingNodeId ?? '?'} 已存在）`,
  'no-dialogue': () => '近期无对话 → 跳过（链断档）',
  'no-llm': () => '无 LLM → 跳过',
  'model-empty': () => '模型返回合法 JSON 但无有效维度 → 平凡日跳过',
}

export function DriftDashboard({ api, instances }: DriftDashboardProps) {
  const [selected, setSelected] = useState<string>('')
  const [records, setRecords] = useState<DriftExecutionResult[]>([])
  const [dims, setDims] = useState<DriftDimsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const effective = selected || instances[0]?.id || ''
  const selectedMeta = instances.find(m => m.id === effective)

  // 维度定义只拉一次（它是静态配置，不随刷新变）。
  useEffect(() => {
    let alive = true
    api.getDriftDims()
      .then(d => { if (alive) setDims(d) })
      .catch(e => { if (alive) setErr('维度定义加载失败: ' + String(e)) })
    return () => { alive = false }
  }, [api])

  const load = useCallback(async () => {
    if (!effective) return
    setLoading(true)
    try {
      const recs = await api.getDriftRecords(effective)
      setRecords(recs)
      setErr('')
    } catch (e) {
      setErr('加载失败: ' + String(e))
    } finally {
      setLoading(false)
    }
  }, [api, effective])

  useEffect(() => {
    void load()
    if (timer.current) clearInterval(timer.current)
    timer.current = setInterval(() => void load(), 5000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [load])

  const dimOrder = dims?.drift.map(d => d.key) ?? []
  const dimName = (k: string) => dims?.drift.find(d => d.key === k)?.label ?? k

  const total = records.length
  const done = records.filter(r => r.written).length
  const skipped = records.filter(r => !r.written && !r.error).length
  const failed = records.filter(r => r.error).length
  const lastCum = [...records].reverse().find(r => r.parsed?.cumulative)?.parsed?.cumulative
  const trait = selectedMeta?.traitBaseline

  return (
    <div style={{ padding: 4 }}>
      <div style={row}>
        <select
          style={{ ...input, minWidth: 160 }}
          value={effective}
          onChange={e => setSelected(e.target.value)}
        >
          {instances.length === 0
            ? <option value="">（无实例）</option>
            : instances.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
        </select>
        <button style={button} onClick={() => void load()} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </button>
        <span style={meta}>每 5 秒自动刷新（idle 内省后记录会自动出现）</span>
      </div>
      <div style={hint}>{err}</div>

      {dims ? (
        <div style={{ ...card, marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>人格坐标</div>
          <div style={meta}>
            灰点 = HEXACO 人格基线（漂移的重力中心）；彩条 = 当前累积相对基线的偏移。
            灰显的两维在闲聊中不可观测，只作人格画像、不参与每日漂移。
          </div>
          <div style={{ marginTop: 10 }}>
            {dims.trait.map(t => {
              const stateKey = TRAIT_TO_STATE[t.key]
              const cum = stateKey && lastCum ? lastCum[stateKey] : undefined
              return (
                <TraitBar
                  key={t.key}
                  label={t.label}
                  hint={t.hint}
                  base={trait ? trait[t.key] : 0}
                  cum={cum}
                  inert={!t.drifts}
                />
              )
            })}
          </div>
          {/* 表现层两维不属于 HEXACO，单列一段 */}
          {dims.drift.filter(d => d.layer === 'expression').map(d => (
            <TraitBar
              key={d.key}
              label={d.label}
              hint={d.scope + '；' + d.notScope}
              base={trait ? proxyTarget(d.key, trait) : 0}
              cum={lastCum?.[d.key]}
              inert={false}
            />
          ))}
          {trait ? null : (
            <div style={{ ...meta, color: '#b8860b' }}>
              该实例尚未标注人格基线 → 回弹目标暂按 0 处理。可到「实例配置」标六维或点「从人设自动推断」。
            </div>
          )}
        </div>
      ) : null}

      {instances.length === 0 ? (
        <div style={{ ...meta, marginTop: 20 }}>暂无实例，先到「实例配置」新建假人。</div>
      ) : total === 0 ? (
        <div style={{ ...meta, marginTop: 20 }}>
          实例「{effective}」还没有内省记录。去 dsh 聊天界面开聊几轮，然后<b>停手空闲几秒</b>触发 idle 内省，记录会自动出现在这里。
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
            {[['总执行', total], ['已写漂移', done], ['跳过', skipped], ['失败', failed]].map(([k, v]) => (
              <div key={k as string} style={{ ...card, marginBottom: 0, minWidth: 96, padding: '10px 14px' }}>
                <div style={meta}>{k}</div>
                <div style={{ fontSize: 22, fontWeight: 600 }}>{v as number}</div>
              </div>
            ))}
            {lastCum ? (
              <div style={{ ...card, marginBottom: 0, flex: 1, minWidth: 240, padding: '10px 14px' }}>
                <div style={meta}>当前累计偏移</div>
                {dimOrder.filter(d => lastCum[d]).map(d => <Bar key={d} name={dimName(d)} v={lastCum[d]} />)}
                {Object.keys(lastCum).filter(d => !dimOrder.includes(d)).map(d => <Bar key={d} name={dimName(d)} v={lastCum[d]} />)}
              </div>
            ) : null}
          </div>

          <div style={{ marginTop: 18 }}>
            {records.map((r, i) => {
              const cls = r.written ? 'done' : r.error ? 'fail' : 'skip'
              const borderColor = r.written ? '#2b8a5c' : r.error ? '#c0392b' : '#d29922'
              return (
                <div key={i} style={{ ...card, borderLeft: `4px solid ${borderColor}` }}>
                  <div style={row}>
                    <span style={{ fontWeight: 600 }}>{r.date}</span>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 20,
                      background: r.written ? 'rgba(43,138,92,.15)' : r.error ? 'rgba(192,57,43,.15)' : 'rgba(210,153,34,.15)',
                      color: r.written ? '#2b8a5c' : r.error ? '#c0392b' : '#b8860b',
                    }}>{r.written ? '已写漂移' : r.error ? '失败' : '跳过'}</span>
                    <span style={{ ...meta, marginLeft: 'auto' }}>触发 @ {r.triggeredAt}{r.instanceId ? ' · ' + r.instanceId : ''}</span>
                  </div>

                  {r.skipReason && !r.written ? (
                    <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(210,153,34,.08)', border: '1px solid rgba(210,153,34,.25)', borderRadius: 8, color: '#b8860b', fontSize: 13 }}>
                      跳过原因：{SKIP_TEXT[r.skipReason]?.(r) ?? r.skipReason}
                    </div>
                  ) : null}
                  {r.error ? (
                    <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(192,57,43,.08)', border: '1px solid rgba(192,57,43,.25)', borderRadius: 8, color: '#c0392b', fontSize: 13 }}>
                      错误：{r.error === 'llm-error' ? '模型调用出错（网络/超时/限流）' : '模型返回无法解析的 JSON'}
                    </div>
                  ) : null}

                  {r.input ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                      <div>
                        <div style={meta}>输入</div>
                        <div style={{ fontSize: 13 }}>对话 {r.input.dialogTurns} 轮 · 记忆主题 {r.input.memoryTopics} · 历史 drift {r.input.historyDrifts} · 窗口 {r.input.recentDays} 天</div>
                      </div>
                      <div>
                        <div style={meta}>心境 / 倾向 / 执念</div>
                        <div style={{ fontSize: 13 }}>
                          {[r.parsed?.mood, r.parsed?.leaning, r.parsed?.preoccupation].filter(Boolean).map(x => '「' + x + '」').join(' ') || '—'}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {r.parsed ? (
                    <div style={{ marginTop: 10 }}>
                      {dimOrder.filter(d => r.parsed!.dims[d] != null).map(d => <Bar key={d} name={dimName(d)} v={r.parsed!.dims[d]} />)}
                      {Object.keys(r.parsed.dims).filter(d => !dimOrder.includes(d)).map(d => <Bar key={d} name={dimName(d)} v={r.parsed!.dims[d]} />)}

                      {r.parsed.revertPull && Object.keys(r.parsed.revertPull).length > 0 ? (
                        <details style={{ marginTop: 6 }}>
                          <summary style={{ cursor: 'pointer', color: '#2b6cb0', fontSize: 12 }}>
                            重力回弹（trait 目标 / 回弹量）
                          </summary>
                          <div style={{ fontSize: 12, color: '#777', marginTop: 6, fontFamily: 'ui-monospace, monospace' }}>
                            {Object.keys(r.parsed.revertPull).map(k => (
                              <div key={k}>
                                {dimName(k)}：目标 {r.parsed!.traitTarget?.[k]?.toFixed(2) ?? '0.00'} · 回弹 {r.parsed!.revertPull![k].toFixed(4)}
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}

                      {r.parsed.rationale ? (
                        <div style={{ marginTop: 8 }}>
                          <div style={meta}>判断理由</div>
                          <div style={{ fontSize: 13 }}>{r.parsed.rationale}</div>
                        </div>
                      ) : null}
                      {r.parsed.evidence?.length ? (
                        <div style={{ marginTop: 8 }}>
                          <div style={meta}>证据引用</div>
                          <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: '#999', fontSize: 12 }}>
                            {r.parsed.evidence.map((e, j) => {
                              const ref = r.parsed!.evidenceRefs?.[j]
                              return (
                                <li key={j}>
                                  {ref?.nodeId
                                    ? <span style={{ color: '#2b8a5c', fontFamily: 'ui-monospace, monospace' }}>{ref.nodeId}</span>
                                    : <span style={{ color: '#b8860b' }}>（悬空）</span>}
                                  {' '}{e}
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {r.written ? (
                    <div style={{ marginTop: 8, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#2b6cb0' }}>
                      {r.written.nodeId}（causal 边 {r.written.causalEdges} · evidence 边 {r.written.evidenceEdges}
                      {r.written.evidenceSkipped > 0
                        ? <span style={{ color: '#b8860b' }}> · 悬空 {r.written.evidenceSkipped}</span>
                        : null}）
                    </div>
                  ) : null}

                  {r.llmRaw ? (
                    <details style={{ marginTop: 10 }}>
                      <summary style={{ cursor: 'pointer', color: '#2b6cb0', fontSize: 13 }}>LLM 原始输出</summary>
                      <pre style={{ margin: '8px 0 0', padding: 12, background: '#f6f6f6', border: '1px solid #eee', borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#555', maxHeight: 260, overflow: 'auto' }}>{r.llmRaw}</pre>
                    </details>
                  ) : null}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
