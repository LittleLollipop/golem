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
const hint: CSSProperties = { fontSize: 12, color: '#b06', minHeight: 16, marginTop: 6 }

export function GolemSettings({ api }: GolemSettingsProps) {
  const [metas, setMetas] = useState<InstanceMeta[]>([])
  const [defaultId, setDefaultId] = useState<string | null>(null)
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [createHint, setCreateHint] = useState('')
  const [hints, setHints] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const [list, def] = await Promise.all([api.listInstances(), api.getDefaultInstance()])
      setMetas(list)
      setDefaultId(def)
    } catch (e) {
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
      await api.setInstanceMeta(id, { persona })
      setHints(h => ({ ...h, [id]: '已保存' }))
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
                  key={m.id + ':' + (m.persona ?? '')}
                  defaultValue={m.persona ?? ''}
                  placeholder="人格设定（第一人称，如：你是林夏……）"
                  style={textarea}
                />
                <div style={{ ...row, marginTop: 8 }}>
                  <button
                    style={buttonGhost}
                    onClick={e => {
                      const ta = (e.currentTarget.closest('.card') as HTMLElement | null)
                        ?.querySelector('textarea')
                      onSave(m.id, ta?.value ?? '')
                    }}
                  >保存人格</button>
                  <button style={buttonGhost} onClick={() => onDefault(m.id)}>设为默认</button>
                  <span style={hint}>{hints[m.id] ?? ''}</span>
                </div>
              </div>
            )
          })}
    </div>
  )
}
