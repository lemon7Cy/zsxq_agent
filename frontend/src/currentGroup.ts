export interface CurrentGroup {
  id: string
  name: string
  avatar?: string
  background?: string
}

const STORAGE_KEY = 'zsxq_agent.current_group'

export function readCurrentGroup(): CurrentGroup | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<CurrentGroup>
    if (!value.id || !value.name) return null
    return {
      id: String(value.id),
      name: String(value.name),
      avatar: typeof value.avatar === 'string' ? value.avatar : '',
      background: typeof value.background === 'string' ? value.background : '',
    }
  } catch {
    return null
  }
}

export function writeCurrentGroup(group: CurrentGroup) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(group))
  window.dispatchEvent(new CustomEvent<CurrentGroup>('current-group-change', { detail: group }))
}

export function clearCurrentGroup() {
  window.localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent('current-group-change'))
}
