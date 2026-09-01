import { useCallback, useEffect, useState, Component, type CSSProperties, type ReactNode } from 'react'
import type { InstanceMeta } from './types.ts'
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
    } catch (e) {
      console.error('[GolemSettings] refresh failed:', e)
      setCreateHint('加载失败: ' + String(e))
    } finally {
      setBusy(false)
    }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  const onCreate = async () => {
    const id = newId.trim()
    if (!id) { setCreateHint('请填 id'); return }
    try {
      await api.createInstance(id, newName.trim() || id, '')
      setNewId(''); setNewName(''); setCreateHint('已新建 ' + id)
      await refresh()
    } catch (e) { setCreateHint('失败: ' + String(e)) }
  }

  const onSave = async (id: string, core: string, ext: string) => {
    try {
      const updated = await api.setInstanceMeta(id, { personaCore: core, personaExt: ext })
      // 写后回读校验：服务端返回的 personaCore/personaExt 必须分别与提交值一致。
      // 上一版 bug 正是「请求成功但内容为空」——只看 resolve 会误报成功，
      // 所以这里比对内容，不一致就明确报出来而不是显示「已保存」。
      const echoedCore = updated.personaCore ?? ''
      const echoedExt = updated.personaExt ?? ''
      const ok = echoedCore === core && echoedExt === ext
      setHints(h => ({
        ...h,
        [id]: ok
          ? (core.trim() || ext.trim()
              ? '已保存（核心 ' + core.length + ' 字 / 扩展 ' + ext.length + ' 字）'
              : '已保存（已清空人格）')
          : '⚠ 保存未生效：服务端回读与提交不一致',
      }))
      await refresh()
    } catch (e) { setHints(h => ({ ...h, [id]: '失败: ' + String(e) })) }
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
                <div style={{ ...row, marginTop: 8 }}>
                  <button
                    style={buttonGhost}
                    onClick={() => onSave(m.id, drafts[m.id]?.core ?? '', drafts[m.id]?.ext ?? '')}
                    disabled={busy}
                  >保存人格</button>
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
