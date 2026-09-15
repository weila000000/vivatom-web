import type { StoredMessage } from "../db/database"
import type { Project } from "../domain/project"
import type { Version } from "../types/agent"

export type PlatformUser = {
  id: string
  email: string
  name: string
  createdAt: string
}

export type Workspace = {
  id: string
  name: string
  role: "owner" | "member"
  createdAt: string
}

export type WorkspaceMember = { accountId: string; email: string; name: string; role: "owner" | "member"; joinedAt: string }
export type WorkspaceInvitation = { id: string; workspaceId: string; email: string; role: "owner" | "member"; token: string; expiresAt: string; createdAt: string }
export type AuditEvent = { id: string; workspaceId: string; actorId: string; actorName: string; actorEmail: string; action: string; targetType: string; targetId: string; metadata: Record<string, unknown>; createdAt: string }
export type WorkspaceUsage = { workspaceId: string; limit: number; used: number; remaining: number }

export type PlatformAuthentication = {
  user: PlatformUser
  session: { token: string; expiresAt: string }
  workspaces: Workspace[]
}

export type CatalogProject = {
  id: string
  workspaceId: string
  title: string
  status: "draft" | "planning" | "awaiting_approval" | "building" | "ready" | "error"
  activeVersionId?: string
  createdAt: string
  updatedAt: string
}

export type ProjectDocumentPayload = {
  project: Omit<Project, "cloudRevision" | "cloudContentHash">
  messages: StoredMessage[]
  versions: Version[]
}

export type ProjectDocument = {
  projectId: string
  revision: number
  contentHash: string
  payload: ProjectDocumentPayload
  updatedAt: string
}

export class PlatformError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message)
  }
}

type Fetcher = typeof fetch

async function request<T>(path: string, init: RequestInit, fetcher: Fetcher = fetch): Promise<T> {
  const response = await fetcher(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  })
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({})) as {
    data?: T
    error?: { code?: string; message?: string }
  }
  if (!response.ok || payload.data === undefined) {
    throw new PlatformError(
      payload.error?.code ?? "identity_unavailable",
      payload.error?.message ?? "账户服务暂时不可用",
      response.status,
    )
  }
  return payload.data
}

export function registerPlatformAccount(
  input: { email: string; password: string; name: string; workspaceName: string },
  fetcher?: Fetcher,
) {
  return request<PlatformAuthentication>("/api/platform/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  }, fetcher)
}

export function loginPlatformAccount(email: string, password: string, fetcher?: Fetcher) {
  return request<PlatformAuthentication>("/api/platform/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }, fetcher)
}

export function fetchPlatformIdentity(token: string, fetcher?: Fetcher) {
  return request<{ user: PlatformUser; workspaces: Workspace[] }>("/api/platform/auth/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  }, fetcher)
}

export function logoutPlatformAccount(token: string, fetcher?: Fetcher) {
  return request<void>("/api/platform/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }, fetcher)
}

export function listWorkspaceProjects(workspaceId: string, token: string, fetcher?: Fetcher) {
  return request<CatalogProject[]>(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/projects`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  }, fetcher)
}

export function syncWorkspaceProject(
  workspaceId: string,
  token: string,
  project: Pick<CatalogProject, "id" | "title" | "status" | "activeVersionId">,
  fetcher?: Fetcher,
) {
  return request<CatalogProject>(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(project.id)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: project.title, status: project.status, activeVersionId: project.activeVersionId }),
  }, fetcher)
}

export function fetchWorkspaceProjectDocument(workspaceId: string, projectId: string, token: string, fetcher?: Fetcher) {
  return request<ProjectDocument>(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/document`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  }, fetcher)
}

export function saveWorkspaceProjectDocument(workspaceId: string, projectId: string, token: string, expectedRevision: number, payload: ProjectDocumentPayload, fetcher?: Fetcher) {
  return request<ProjectDocument>(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/document`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ expectedRevision, payload }),
  }, fetcher)
}

export function listWorkspaceMembers(workspaceId: string, token: string, fetcher?: Fetcher) {
  return request<WorkspaceMember[]>(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/members`, { method: "GET", headers: { Authorization: `Bearer ${token}` } }, fetcher)
}

export function inviteWorkspaceMember(workspaceId: string, token: string, email: string, role: "owner" | "member", fetcher?: Fetcher) {
  return request<WorkspaceInvitation>(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/invitations`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ email, role }) }, fetcher)
}

export function acceptWorkspaceInvitation(invitationToken: string, token: string, fetcher?: Fetcher) {
  return request<WorkspaceMember>(`/api/platform/invitations/${encodeURIComponent(invitationToken)}/accept`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }, fetcher)
}

export function changeWorkspaceMemberRole(workspaceId: string, accountId: string, token: string, role: "owner" | "member", fetcher?: Fetcher) {
  return request<void>(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(accountId)}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ role }) }, fetcher)
}

export function removeWorkspaceMember(workspaceId: string, accountId: string, token: string, fetcher?: Fetcher) {
  return request<void>(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(accountId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }, fetcher)
}

export function listWorkspaceAudit(workspaceId: string, token: string, options: { before?: string; limit?: number } = {}, fetcher?: Fetcher) {
  const query = new URLSearchParams()
  if (options.before) query.set("before", options.before)
  if (options.limit) query.set("limit", String(options.limit))
  const suffix = query.size ? `?${query}` : ""
  return request<AuditEvent[]>(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/audit${suffix}`, { method: "GET", headers: { Authorization: `Bearer ${token}` } }, fetcher)
}

export function recordProjectConflictResolution(workspaceId: string, projectId: string, token: string, choice: "local" | "cloud", fetcher?: Fetcher) {
  return request<void>(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/conflict-resolution`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ choice }) }, fetcher)
}

export function fetchWorkspaceUsage(workspaceId: string, token: string, fetcher?: Fetcher) {
  return request<WorkspaceUsage>(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/usage`, { method: "GET", headers: { Authorization: `Bearer ${token}` } }, fetcher)
}

export function approveWorkspacePlan(workspaceId: string, projectId: string, approvalId: string, token: string, fetcher?: Fetcher) {
  return request<void>(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(approvalId)}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }, fetcher)
}

export function commitBuildCandidate(
  workspaceId: string,
  projectId: string,
  candidateId: string,
  token: string,
  input: { snapshotHash: string; parentVersionId?: string; prompt: string },
  fetcher?: Fetcher,
) {
  return request<Version>(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/candidates/${encodeURIComponent(candidateId)}/commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  }, fetcher)
}
