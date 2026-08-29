import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { InstanceMeta } from './types.ts'
import type { GolemApi } from './golem-api.ts'

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
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const [list, def] = await Promise.all([api.listInstances(), api.getDefaultInstance()])
      setMetas(list)
      setDefaultId(def)
      // 草稿以服务端真值为准（保存后回读、切换实例后都不会残留旧输入）。
      setDrafts(Object.fromEntries(list.map(m => [m.id, m.persona ?? ''])))
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

  const onSave = async (id: string, persona: string) => {
    try {
      const updated = await api.setInstanceMeta(id, { persona })
      // 写后回读校验：服务端返回的 persona 必须与提交值一致。
      // 上一版 bug 正是「请求成功但内容为空」——只看 resolve 会误报成功，
      // 所以这里比对内容，不一致就明确报出来而不是显示「已保存」。
      const echoed = updated.persona ?? ''
      setHints(h => ({
        ...h,
        [id]: echoed === persona
          ? (persona.trim() ? '已保存（' + persona.length + ' 字）' : '已保存（已清空人格）')
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
      </div>

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
                <textarea
                  value={drafts[m.id] ?? ''}
                  onChange={e => {
                    const v = e.target.value
                    setDrafts(d => ({ ...d, [m.id]: v }))
                    // 输入即清掉上一次的「已保存/失败」提示，避免误读为当前状态。
                    setHints(h => (h[m.id] ? { ...h, [m.id]: '' } : h))
                  }}
                  placeholder="人格设定（第一人称，如：你是林夏……）"
                  style={textarea}
                />
                <div style={{ ...row, marginTop: 8 }}>
                  <button
                    style={buttonGhost}
                    onClick={() => onSave(m.id, drafts[m.id] ?? '')}
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
  )
}
