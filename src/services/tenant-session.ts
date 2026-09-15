import type { PlatformAuthentication, PlatformUser, Workspace } from "./platform-client"

export type TenantSession = {
  token: string
  expiresAt: string
  user: PlatformUser
  workspaces: Workspace[]
  activeWorkspaceId: string
}

const sessionKey = "vivatom:tenant-session"

export function readTenantSession(storage: Storage = window.localStorage): TenantSession | undefined {
  const raw = storage.getItem(sessionKey)
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw) as Partial<TenantSession>
    if (typeof value.token !== "string" || typeof value.expiresAt !== "string" ||
      typeof value.user?.id !== "string" || !Array.isArray(value.workspaces) ||
      typeof value.activeWorkspaceId !== "string") return undefined
    if (Date.parse(value.expiresAt) <= Date.now()) {
      storage.removeItem(sessionKey)
      return undefined
    }
    return value as TenantSession
  } catch {
    return undefined
  }
}

export function writeTenantSession(auth: PlatformAuthentication, storage: Storage = window.localStorage): TenantSession {
  const session: TenantSession = {
    token: auth.session.token,
    expiresAt: auth.session.expiresAt,
    user: auth.user,
    workspaces: auth.workspaces,
    activeWorkspaceId: auth.workspaces[0]?.id ?? "",
  }
  storage.setItem(sessionKey, JSON.stringify(session))
  return session
}

export function updateTenantIdentity(user: PlatformUser, workspaces: Workspace[], storage: Storage = window.localStorage) {
  const current = readTenantSession(storage)
  if (!current) return undefined
  const activeWorkspaceId = workspaces.some((item) => item.id === current.activeWorkspaceId)
    ? current.activeWorkspaceId
    : workspaces[0]?.id ?? ""
  const next = { ...current, user, workspaces, activeWorkspaceId }
  storage.setItem(sessionKey, JSON.stringify(next))
  return next
}

export function selectTenantWorkspace(workspaceId: string, storage: Storage = window.localStorage) {
  const current = readTenantSession(storage)
  if (!current?.workspaces.some((item) => item.id === workspaceId)) return current
  const next = { ...current, activeWorkspaceId: workspaceId }
  storage.setItem(sessionKey, JSON.stringify(next))
  return next
}

export function clearTenantSession(storage: Storage = window.localStorage) {
  storage.removeItem(sessionKey)
}
