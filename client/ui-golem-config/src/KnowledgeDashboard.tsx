import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { GolemApi } from './golem-api.ts'
import type { InstanceMeta, LearnedFact } from './types.ts'

/**
 * dsh 设置面板「知识记录」标签页内容：展示某实例全部知识获取轨迹
 * （随机轨 Wikipedia + 目的轨 wiki/news/social/web）。数据来自
 * `api.getKnowledgeRecords`（后端经 ctx.remote.golem 直接读 ledger trajectory）。
 */
export interface KnowledgeDashboardProps {
  api: GolemApi
  instances: InstanceMeta[]
}

const SRC_COLOR: Record<string, string> = {
  News: '#2563eb',
  'Hacker News': '#ea580c',
  Wikipedia: '#16a34a',
  web: '#7c3aed',
  static: '#0891b2',
}
const STATUS_COLOR: Record<string, string> = {
  learned: '#16a34a',
  empty: '#9ca3af',
  junk: '#d97706',
  error: '#dc2626',
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

function badge(text: string, color: string): CSSProperties {
  return {
    fontSize: 11, padding: '2px 8px', borderRadius: 20, background: color + '26', color,
  }
}

export function KnowledgeDashboard({ api, instances }: KnowledgeDashboardProps) {
  const [selected, setSelected] = useState<string>('')
  const [records, setRecords] = useState<LearnedFact[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [onlyPurposeful, setOnlyPurposeful] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const effective = selected || instances[0]?.id || ''

  const load = useCallback(async () => {
    if (!effective) return
    setLoading(true)
    try {
      const recs = await api.getKnowledgeRecords(effective)
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

  const view = onlyPurposeful ? records.filter(r => r.kind === 'purposeful') : records
  const learned = records.filter(r => r.status === 'learned').length
  const empty = records.filter(r => r.status === 'empty').length
  const junkErr = records.filter(r => r.status === 'junk' || r.status === 'error').length
  const newsSocial = records.filter(
    r => r.kind === 'purposeful' && (r.source === 'News' || r.source === 'Hacker News') && r.status === 'learned',
  ).length

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
        <label style={{ ...meta, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={onlyPurposeful}
            onChange={e => setOnlyPurposeful(e.target.checked)}
            style={{ margin: 0 }}
          />
          只看目的轨
        </label>
        <span style={meta}>每 5 秒自动刷新（idle 学习后记录会自动出现）</span>
      </div>
      <div style={hint}>{err}</div>

      {instances.length === 0 ? (
        <div style={{ ...meta, marginTop: 20 }}>暂无实例，先到「实例配置」新建假人。</div>
      ) : records.length === 0 ? (
        <div style={{ ...meta, marginTop: 20 }}>
          实例「{effective}」还没有知识获取记录。去 dsh 聊天界面开聊几轮，然后<b>停手空闲几秒</b>触发 idle 学习，记录会自动出现在这里。
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
            {[['总记录', records.length], ['已学成', learned], ['新闻+社交', newsSocial], ['空/垃圾/失败', empty + junkErr]].map(([k, v]) => (
              <div key={k as string} style={{ ...card, marginBottom: 0, minWidth: 96, padding: '10px 14px' }}>
                <div style={meta}>{k}</div>
                <div style={{ fontSize: 22, fontWeight: 600 }}>{v as number}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 18 }}>
            {view.slice().reverse().map((r, i) => {
              const sc = SRC_COLOR[r.source] || '#64748b'
              const stc = STATUS_COLOR[r.status] || '#64748b'
              return (
                <div key={i} style={{ ...card, borderLeft: `4px solid ${stc}` }}>
                  <div style={row}>
                    <span style={badge(r.source, sc)}>{r.source}</span>
                    <span style={badge(r.status, stc)}>{r.status}</span>
                    <span style={{ ...meta, marginLeft: 'auto' }}>
                      {r.kind === 'purposeful' ? '目的轨' : '随机轨'}
                      {r.learnedAt ? ' · ' + new Date(r.learnedAt).toLocaleString('zh-CN') : ''}
                    </span>
                  </div>

                  <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600 }}>
                    {r.sourceUrl ? (
                      <a href={r.sourceUrl} target="_blank" rel="noopener" style={{ color: '#1a1a1a', textDecoration: 'none' }}>
                        {r.title || '(无标题)'}
                      </a>
                    ) : (
                      (r.title || '(无标题)')
                    )}
                  </div>

                  {r.summary ? (
                    <div style={{ marginTop: 6, fontSize: 13, color: '#555', lineHeight: 1.5 }}>{r.summary}</div>
                  ) : null}

                  <div style={{ ...meta, marginTop: 6 }}>
                    {r.selectionPath}
                    {r.directive?.rationale ? ' · 规划理由: ' + r.directive.rationale : ''}
                    {r.statusNote ? ' · ' + r.statusNote : ''}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
