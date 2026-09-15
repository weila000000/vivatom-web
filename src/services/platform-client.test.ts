import { describe, expect, it, vi } from "vitest"
import { acceptWorkspaceInvitation, approveWorkspacePlan, changeWorkspaceMemberRole, commitBuildCandidate, fetchWorkspaceProjectDocument, fetchWorkspaceUsage, inviteWorkspaceMember, listWorkspaceAudit, listWorkspaceMembers, listWorkspaceProjects, loginPlatformAccount, logoutPlatformAccount, PlatformError, recordProjectConflictResolution, removeWorkspaceMember, saveWorkspaceProjectDocument, syncWorkspaceProject } from "./platform-client"

describe("platform client", () => {
  it("decodes the stable authentication envelope", async () => {
    const auth = {
      user: { id: "acct_1", email: "a@example.com", name: "A", createdAt: "now" },
      session: { token: "token", expiresAt: "later" },
      workspaces: [],
    }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: auth }), { status: 200 }))
    await expect(loginPlatformAccount("a@example.com", "password", fetcher)).resolves.toEqual(auth)
    expect(fetcher).toHaveBeenCalledWith("/api/platform/auth/login", expect.objectContaining({ method: "POST" }))
  })

  it("exposes safe API errors and sends the bearer token on logout", async () => {
    const denied = vi.fn(async () => new Response(JSON.stringify({ error: { code: "unauthorized", message: "登录已失效，请重新登录" } }), { status: 401 }))
    await expect(loginPlatformAccount("a@example.com", "wrong", denied)).rejects.toEqual(expect.objectContaining<Partial<PlatformError>>({ code: "unauthorized", status: 401 }))

    const accepted = vi.fn(async () => new Response(null, { status: 204 }))
    await logoutPlatformAccount("secret", accepted)
    expect(accepted).toHaveBeenCalledWith("/api/platform/auth/logout", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer secret" }) }))
  })

  it("lists and syncs projects inside an encoded workspace route", async () => {
    const project = { id: "project/1", workspaceId: "space/1", title: "任务板", status: "planning" as const, createdAt: "now", updatedAt: "now" }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [project] }), { status: 200 }))
    await expect(listWorkspaceProjects("space/1", "secret", fetcher)).resolves.toEqual([project])
    expect(fetcher).toHaveBeenCalledWith("/api/platform/workspaces/space%2F1/projects", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer secret" }) }))

    const syncer = vi.fn(async () => new Response(JSON.stringify({ data: project }), { status: 200 }))
    await syncWorkspaceProject("space/1", "secret", project, syncer)
    expect(syncer).toHaveBeenCalledWith("/api/platform/workspaces/space%2F1/projects/project%2F1", expect.objectContaining({ method: "PUT" }))
  })

  it("uses an expected revision when saving project content", async () => {
    const payload = { project: { id: "p1", workspaceId: "w1", title: "项目", status: "draft" as const, createdAt: "now", updatedAt: "now" }, messages: [], versions: [] }
    const document = { projectId: "p1", revision: 4, contentHash: "hash", payload, updatedAt: "now" }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: document }), { status: 200 }))
    await saveWorkspaceProjectDocument("w1", "p1", "secret", 3, payload, fetcher)
    const [, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(request.body))).toMatchObject({ expectedRevision: 3 })
    await expect(fetchWorkspaceProjectDocument("w1", "p1", "secret", fetcher)).resolves.toEqual(document)
  })

  it("uses authenticated workspace member routes", async () => {
    const member = { accountId: "a1", email: "member@example.com", name: "Member", role: "member" as const, joinedAt: "now" }
    const invitation = { id: "i1", workspaceId: "w1", email: member.email, role: member.role, token: "invite-token", expiresAt: "later", createdAt: "now" }
    const dataFetcher = vi.fn(async (path: string) => new Response(JSON.stringify({ data: path.includes("invitations") ? invitation : [member] }), { status: path.includes("invitations") ? 201 : 200 })) as typeof fetch
    await expect(listWorkspaceMembers("w1", "secret", dataFetcher)).resolves.toEqual([member])
    await expect(inviteWorkspaceMember("w1", "secret", member.email, "member", dataFetcher)).resolves.toEqual(invitation)

    const memberFetcher = vi.fn(async () => new Response(JSON.stringify({ data: member }), { status: 200 }))
    await expect(acceptWorkspaceInvitation("invite-token", "secret", memberFetcher)).resolves.toEqual(member)
    const emptyFetcher = vi.fn(async () => new Response(null, { status: 204 }))
    await changeWorkspaceMemberRole("w1", "a1", "secret", "owner", emptyFetcher)
    await removeWorkspaceMember("w1", "a1", "secret", emptyFetcher)
    const methods = emptyFetcher.mock.calls.map((call) => (call as unknown as [string, RequestInit])[1].method)
    expect(methods).toEqual(["PATCH", "DELETE"])
  })

  it("reads workspace activity and records conflict choices", async () => {
    const event = { id: "e1", workspaceId: "w1", actorId: "a1", actorName: "A", actorEmail: "a@example.com", action: "project.created", targetType: "project", targetId: "p1", metadata: { title: "项目" }, createdAt: "now" }
    const list = vi.fn(async () => new Response(JSON.stringify({ data: [event] }), { status: 200 }))
    await expect(listWorkspaceAudit("w/1", "secret", { limit: 30 }, list)).resolves.toEqual([event])
    expect((list.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("/api/platform/workspaces/w%2F1/audit?limit=30")
    const record = vi.fn(async () => new Response(null, { status: 204 }))
    await recordProjectConflictResolution("w1", "p/1", "secret", "local", record)
    expect(record).toHaveBeenCalledWith("/api/platform/workspaces/w1/projects/p%2F1/conflict-resolution", expect.objectContaining({ method: "POST", body: JSON.stringify({ choice: "local" }) }))
  })

  it("reads the authenticated workspace credit summary", async () => {
    const summary = { workspaceId: "w1", limit: 15, used: 5, remaining: 10 }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: summary }), { status: 200 }))
    await expect(fetchWorkspaceUsage("w/1", "secret", fetcher)).resolves.toEqual(summary)
    expect(fetcher).toHaveBeenCalledWith("/api/platform/workspaces/w%2F1/usage", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer secret" }) }))
  })

  it("approves a server plan through the scoped project route", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
    await approveWorkspacePlan("w/1", "p/1", "plan/1", "secret", fetcher)
    expect(fetcher).toHaveBeenCalledWith(
      "/api/platform/workspaces/w%2F1/projects/p%2F1/plans/plan%2F1/approve",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer secret" }) }),
    )
  })

  it("commits a compiled candidate through the scoped project route", async () => {
    const version = { id: "version_1", projectId: "p/1", prompt: "任务板", snapshot: {} } as never
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: version }), { status: 201 }))
    await expect(commitBuildCandidate("w/1", "p/1", "candidate/1", "secret", { snapshotHash: "a".repeat(64), prompt: "任务板" }, fetcher)).resolves.toEqual(version)
    expect(fetcher).toHaveBeenCalledWith(
      "/api/platform/workspaces/w%2F1/projects/p%2F1/candidates/candidate%2F1/commit",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ snapshotHash: "a".repeat(64), prompt: "任务板" }) }),
    )
  })
})
