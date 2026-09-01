import { useCallback, useEffect, useState, Component, type CSSProperties, type ReactNode } from 'react'
import type { InstanceMeta, TraitBaseline, TraitDimDef } from './types.ts'
import type { GolemApi } from './golem-api.ts'
import { DriftDashboard } from './DriftDashboard.tsx'
import { KnowledgeDashboard } from './KnowledgeDashboard.tsx'

/**
 * dsh 设置面板里的「假人」section 内容。
 * props 由两部分合成：
 *  - `close`：设置面板 shell 提供的 owner prop（SettingsSectionOwnerProps）。
 *  - `api`：本包 `apply` 经 slot `inject` 注入的 controller（包 `ctx.remote.golem`）。
 * UI 逻辑移植自原 `public/iso-config.html`，但数据来源改为 dsh remote 通道，
 * 不再依赖 sidecar 平行 REST。
 */
export interface GolemSettingsProps {
  close: () => void
  api: GolemApi
}

const card: CSSProperties = {
  border: '1px solid #ddd', borderRadius: 10, padding: '14px 16px', marginBottom: 14,
  background: 'var(--card, #fff)',
}
const cardDefault: CSSProperties = {
  ...card, borderColor: '#2b8a5c', boxShadow: '0 0 0 2px rgba(43,138,92,.15)',
}
const row: CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }
const nameStyle: CSSProperties = { fontWeight: 600 }
const tag: CSSProperties = {
  fontSize: 12, color: '#2b8a5c', border: '1px solid #2b8a5c', borderRadius: 6, padding: '1px 6px',
}
const meta: CSSProperties = { fontSize: 12, color: '#999', marginTop: 4 }
const input: CSSProperties = { font: 'inherit', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 8 }
const textarea: CSSProperties = {
  width: '100%', minHeight: 70, boxSizing: 'border-box', font: 'inherit', padding: 8,
  border: '1px solid #ccc', borderRadius: 8, resize: 'vertical', marginTop: 8,
}
const button: CSSProperties = {
  font: 'inherit', padding: '6px 12px', border: '1px solid #2b6cb0', background: '#2b6cb0',
  color: '#fff', borderRadius: 8, cursor: 'pointer',
}
const buttonGhost: CSSProperties = { ...button, background: '#fff', color: '#2b6cb0' }
const buttonDanger: CSSProperties = { ...button, background: '#c0392b', borderColor: '#c0392b' }
const hint: CSSProperties = { fontSize: 12, color: '#b06', minHeight: 16, marginTop: 6 }

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
function TraitSliders({
  defs,
  value,
  onChange,
}: {
  defs: TraitDimDef[]
  value: TraitBaseline
  onChange: (next: TraitBaseline) => void
}) {
  return (
    <div style={{ marginTop: 6 }}>
      {defs.map(d => (
        <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '5px 0', opacity: d.drifts ? 1 : 0.55 }} title={d.hint}>
          <div style={{ width: 72, flex: 'none', fontSize: 13 }}>
            {d.label}
          </div>
          <input
            type="range"
            min={-100}
            max={100}
            step={5}
            value={Math.round((value[d.key] ?? 0) * 100)}
            onChange={e => onChange({ ...value, [d.key]: Number(e.target.value) / 100 })}
            style={{ flex: 1 }}
          />
          <div style={{ width: 96, flex: 'none', textAlign: 'right', fontSize: 12, color: '#999' }}>
            {(value[d.key] ?? 0) >= 0 ? '+' : ''}{(value[d.key] ?? 0).toFixed(2)}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
        灰显维度不参与每日漂移（闲聊中不可观测），仅作人格坐标与回弹参考。
      </div>
    </div>
  )
}

class TabErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: '#c0392b', border: '1px solid #c0392b', borderRadius: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>该标签页渲染出错</div>
          <div style={{ fontSize: 13, marginBottom: 10, wordBreak: 'break-word' }}>{String(this.state.error.message)}</div>
          <button style={{ ...button, fontSize: 13 }} onClick={() => this.setState({ error: null })}>重试</button>
        </div>
      )
    }
    return this.props.children
  }
}

export function GolemSettings({ api }: GolemSettingsProps) {
  const [metas, setMetas] = useState<InstanceMeta[]>([])
  const [defaultId, setDefaultId] = useState<string | null>(null)
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [createHint, setCreateHint] = useState('')
  const [hints, setHints] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  /**
   * 人格输入框的草稿（受控）。key = instanceId。
   *
   * ⚠️ 历史 bug（保存人格静默存成空串）：旧实现用非受控 textarea + 点保存时
   * `e.currentTarget.closest('.card')?.querySelector('textarea')` 反查 DOM 取值。
   * 但本组件全部使用内联 style、从未设置 `className="card"`，`closest` 恒为 null，
   * 于是取值恒为 ''，请求照样成功 → UI 显示「已保存」而图库里 persona 被清空。
   * 现在改为受控 + state 草稿：值只从 React state 来，不依赖 DOM 结构/类名。
   */
  const [drafts, setDrafts] = useState<Record<string, { core: string; ext: string }>>({})
  /** HEXACO 六维定义的草稿（受控）。key = instanceId。 */
  const [traitDrafts, setTraitDrafts] = useState<Record<string, TraitBaseline>>({})
  /** HEXACO 六维定义（后端下发，避免前端硬编码维度名）。 */
  const [traitDefs, setTraitDefs] = useState<TraitDimDef[]>([])
  /** 面板内标签页：实例配置 / 内省记录 / 知识记录。 */
  const [tab, setTab] = useState<'config' | 'drift' | 'knowledge'>('config')

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const [list, def] = await Promise.all([api.listInstances(), api.getDefaultInstance()])
      setMetas(list)
      setDefaultId(def)
      // 草稿以服务端真值为准（保存后回读、切换实例后都不会残留旧输入）。
      // 旧实例只有 `persona` 全文、无 core/ext 时，core 框回退到 persona，ext 框留空，
      // 由用户手动拆分（docs/persona-layering.md §3：拆分是人工的）。
      setDrafts(Object.fromEntries(list.map(m => [
        m.id,
        { core: m.personaCore ?? m.persona ?? '', ext: m.personaExt ?? '' },
      ])))
      // 未标注 traitBaseline 的实例 → 六维按 0 起步（服务端也是这么降级的）。
      setTraitDrafts(Object.fromEntries(list.map(m => [
        m.id,
        m.traitBaseline ?? { H: 0, E: 0, X: 0, A: 0, C: 0, O: 0 },
      ])))
    } catch (e) {
      console.error('[GolemSettings] refresh failed:', e)
      setCreateHint('加载失败: ' + String(e))
    } finally {
      setBusy(false)
    }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  // 维度定义只拉一次（静态配置）。
  useEffect(() => {
    let alive = true
    api.getDriftDims()
      .then(d => { if (alive) setTraitDefs(d.trait) })
      .catch(e => console.error('[GolemSettings] getDriftDims failed:', e))
    return () => { alive = false }
  }, [api])

  const onCreate = async () => {
    const id = newId.trim()
    if (!id) { setCreateHint('请填 id'); return }
    try {
      await api.createInstance(id, newName.trim() || id, '')
      setNewId(''); setNewName(''); setCreateHint('已新建 ' + id)
      await refresh()
    } catch (e) { setCreateHint('失败: ' + String(e)) }
  }

  const onSave = async (id: string, core: string, ext: string, trait: TraitBaseline) => {
    try {
      const updated = await api.setInstanceMeta(id, {
        personaCore: core,
        personaExt: ext,
        traitBaseline: trait,
      })
      // 写后回读校验：服务端返回内容必须与提交值一致。
      // 上一版 bug 正是「请求成功但内容为空」——只看 resolve 会误报成功，
      // 所以这里比对内容，不一致就明确报出来而不是显示「已保存」。
      // traitBaseline 同样要校验：remote schema 漏字段会被 zod 静默 strip
      // （personaCore/personaExt 就踩过这个坑，见 §8.2）。
      const echoedCore = updated.personaCore ?? ''
      const echoedExt = updated.personaExt ?? ''
      const echoedTrait = JSON.stringify(updated.traitBaseline ?? null)
      const ok = echoedCore === core && echoedExt === ext && echoedTrait === JSON.stringify(trait)
      setHints(h => ({
        ...h,
        [id]: ok
          ? (core.trim() || ext.trim()
              ? '已保存（核心 ' + core.length + ' 字 / 扩展 ' + ext.length + ' 字 / 六维坐标）'
              : '已保存（已清空人格）')
          : '⚠ 保存未生效：服务端回读与提交不一致',
      }))
      await refresh()
    } catch (e) { setHints(h => ({ ...h, [id]: '失败: ' + String(e) })) }
  }

  /** 用 LLM 从核心人设推断 HEXACO 六维（§6.1 路径①）。只由用户点按钮触发。 */
  const onInferTrait = async (id: string) => {
    setHints(h => ({ ...h, [id]: '推断中…' }))
    try {
      const updated = await api.inferTraitBaseline(id)
      const t = updated.traitBaseline
      setHints(h => ({
        ...h,
        [id]: t
          ? '已推断：' + (['H', 'E', 'X', 'A', 'C', 'O'] as const)
              .map(k => k + ' ' + (t[k] >= 0 ? '+' : '') + t[k].toFixed(2))
              .join(' · ')
          : '⚠ 推断未返回坐标',
      }))
      await refresh()
    } catch (e) { setHints(h => ({ ...h, [id]: '推断失败: ' + String(e) })) }
  }

  const onDefault = async (id: string) => {
    try {
      await api.setDefaultInstance(id)
      setHints(h => ({ ...h, [id]: '已设为默认' }))
      await refresh()
    } catch (e) { setHints(h => ({ ...h, [id]: '失败: ' + String(e) })) }
  }

  const onDelete = async (id: string) => {
    if (!window.confirm(`确定删除假人「${id}」？此操作不可撤销，其记忆图与人格设定将一并清除。`)) return
    try {
      await api.deleteInstance(id)
      setHints(h => ({ ...h, [id]: '已删除' }))
      await refresh()
    } catch (e) { setHints(h => ({ ...h, [id]: '失败: ' + String(e) })) }
  }

  return (
    <div style={{ padding: 4 }}>
      <div style={{ ...row, marginBottom: 14 }}>
        <button
          style={tab === 'config' ? button : buttonGhost}
          onClick={() => setTab('config')}
        >实例配置</button>
        <button
          style={tab === 'drift' ? button : buttonGhost}
          onClick={() => setTab('drift')}
        >内省记录</button>
        <button
          style={tab === 'knowledge' ? button : buttonGhost}
          onClick={() => setTab('knowledge')}
        >知识记录</button>
      </div>

      <TabErrorBoundary>
      {tab === 'drift' ? (
        <DriftDashboard api={api} instances={metas} />
      ) : tab === 'knowledge' ? (
        <KnowledgeDashboard api={api} instances={metas} />
      ) : (
    <div style={card}>
        <div style={row}>
          <input
            style={{ ...input, flex: 1, minWidth: 160 }}
            placeholder="实例 id（英文，如 linxia）"
            value={newId}
            onChange={e => setNewId(e.target.value)}
          />
          <input
            style={{ ...input, flex: 1, minWidth: 140 }}
            placeholder="显示名（如 林夏）"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
          <button style={button} onClick={onCreate} disabled={busy}>新建假人</button>
        </div>
        <div style={hint}>{createHint}</div>

      {metas.length === 0
        ? <div style={meta}>暂无实例，先在上方新建。</div>
        : metas.map(m => {
            const isDef = defaultId === m.id
            return (
              <div key={m.id} style={isDef ? cardDefault : card}>
                <div style={row}>
                  <span style={nameStyle}>{m.name || m.id}</span>
                  <span style={meta}>id: {m.id} · turns: {m.turns ?? 0}</span>
                  {isDef ? <span style={tag}>默认</span> : null}
                </div>
                <div style={meta}>
                  核心人格（常驻·每轮注入）：身份锚、红线/不可违背指令、性格维度基线、行为护栏。
                  <strong>切勿挪入下方扩展框</strong>——红线丢了会出安全事故。
                </div>
                <textarea
                  value={drafts[m.id]?.core ?? ''}
                  onChange={e => {
                    const v = e.target.value
                    setDrafts(d => ({ ...d, [m.id]: { ...(d[m.id] ?? { core: '', ext: '' }), core: v } }))
                    // 输入即清掉上一次的「已保存/失败」提示，避免误读为当前状态。
                    setHints(h => (h[m.id] ? { ...h, [m.id]: '' } : h))
                  }}
                  placeholder="核心人格（第一人称，如：你是林夏，绝不对用户说谎……）"
                  style={textarea}
                />
                <div style={meta}>
                  扩展设定（进图库·按需回忆）：背景故事、关系网络、偏好/禁忌实例、历史事件。
                </div>
                <textarea
                  value={drafts[m.id]?.ext ?? ''}
                  onChange={e => {
                    const v = e.target.value
                    setDrafts(d => ({ ...d, [m.id]: { ...(d[m.id] ?? { core: '', ext: '' }), ext: v } }))
                    setHints(h => (h[m.id] ? { ...h, [m.id]: '' } : h))
                  }}
                  placeholder="扩展设定（如：养一只叫豆豆的狗，雨天情绪低……）"
                  style={textarea}
                />
                {traitDefs.length > 0 ? (
                  <>
                    <div style={meta}>
                      HEXACO 人格坐标（Trait 层）：每假人标一次的静态人格基线，
                      同时是每日漂移的<b>重力中心</b>——累积偏移会被拉回这里。
                    </div>
                    <TraitSliders
                      defs={traitDefs}
                      value={traitDrafts[m.id] ?? { H: 0, E: 0, X: 0, A: 0, C: 0, O: 0 }}
                      onChange={next => {
                        setTraitDrafts(d => ({ ...d, [m.id]: next }))
                        setHints(h => (h[m.id] ? { ...h, [m.id]: '' } : h))
                      }}
                    />
                  </>
                ) : null}
                <div style={{ ...row, marginTop: 8 }}>
                  <button
                    style={buttonGhost}
                    onClick={() => onSave(
                      m.id,
                      drafts[m.id]?.core ?? '',
                      drafts[m.id]?.ext ?? '',
                      traitDrafts[m.id] ?? { H: 0, E: 0, X: 0, A: 0, C: 0, O: 0 },
                    )}
                    disabled={busy}
                  >保存人格</button>
                  <button
                    style={buttonGhost}
                    onClick={() => void onInferTrait(m.id)}
                    disabled={busy}
                    title="用 LLM 读核心人设，推断 HEXACO 六维坐标并写入"
                  >从人设自动推断</button>
                  <button style={buttonGhost} onClick={() => onDefault(m.id)}>设为默认</button>
                  {!isDef ? (
                    <button style={buttonDanger} onClick={() => onDelete(m.id)}>删除</button>
                  ) : null}
                  <span style={hint}>{hints[m.id] ?? ''}</span>
                </div>
              </div>
            )
          })}
    </div>
    )}
      </TabErrorBoundary>
  </div>
  )
}
