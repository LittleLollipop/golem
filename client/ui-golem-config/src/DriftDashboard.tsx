import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { GolemApi } from './golem-api.ts'
import type { InstanceMeta, DriftExecutionResult } from './types.ts'

/**
 * dsh 设置面板「内省记录」标签页内容：展示某实例全部 idle 内省执行记录的时间线。
 * 数据来自 `api.getDriftRecords`（后端经 ctx.remote.golem 直接读 JSONL 时间序列）。
 */
export interface DriftDashboardProps {
  api: GolemApi
  instances: InstanceMeta[]
}

const DIM_ORDER = ['openness', 'warmth', 'verbosity', 'playfulness', 'assertiveness']
const DIM_LABELS: Record<string, string> = {
  openness: '开放性',
  warmth: '亲和力',
  verbosity: '表达欲',
  playfulness: '俏皮度',
  assertiveness: '主见度',
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

function Bar({ name, v }: { name: string; v: number }) {
  const mag = Math.max(-1, Math.min(1, v))
  const pos = mag >= 0
  const fill: CSSProperties = {
    position: 'absolute', top: 0, bottom: 0,
    background: pos ? '#2b8a5c' : '#c0392b',
    left: pos ? '50%' : `${50 + mag * 50}%`,
    width: `${Math.abs(mag) * 50}%`,
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
      <div style={{ width: 64, flex: 'none', fontSize: 13 }}>{DIM_LABELS[name] || name}</div>
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
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const effective = selected || instances[0]?.id || ''

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

  const total = records.length
  const done = records.filter(r => r.written).length
  const skipped = records.filter(r => !r.written && !r.error).length
  const failed = records.filter(r => r.error).length
  const lastCum = [...records].reverse().find(r => r.parsed?.cumulative)?.parsed?.cumulative

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
                {DIM_ORDER.filter(d => lastCum[d]).map(d => <Bar key={d} name={d} v={lastCum[d]} />)}
                {Object.keys(lastCum).filter(d => !DIM_ORDER.includes(d)).map(d => <Bar key={d} name={d} v={lastCum[d]} />)}
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
                      {DIM_ORDER.filter(d => r.parsed!.dims[d] != null).map(d => <Bar key={d} name={d} v={r.parsed!.dims[d]} />)}
                      {Object.keys(r.parsed.dims).filter(d => !DIM_ORDER.includes(d)).map(d => <Bar key={d} name={d} v={r.parsed!.dims[d]} />)}
                      {r.parsed.rationale ? (
                        <div style={{ marginTop: 8 }}>
                          <div style={meta}>判断理由</div>
                          <div style={{ fontSize: 13 }}>{r.parsed.rationale}</div>
                        </div>
                      ) : null}
                      {r.parsed.evidence?.length ? (
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#999', fontSize: 12 }}>
                          {r.parsed.evidence.map((e, j) => <li key={j}>{e}</li>)}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}

                  {r.written ? (
                    <div style={{ marginTop: 8, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#2b6cb0' }}>
                      {r.written.nodeId}（causal 边 {r.written.causalEdges} · evidence 边 {r.written.evidenceEdges}）
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
