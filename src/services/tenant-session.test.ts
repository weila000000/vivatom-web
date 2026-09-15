import { describe, expect, it } from "vitest"
import { clearTenantSession, readTenantSession, selectTenantWorkspace, writeTenantSession } from "./tenant-session"

const authentication = {
  user: { id: "acct_1", email: "learner@vivatom.dev", name: "学习者", createdAt: "2026-09-15T00:00:00Z" },
  session: { token: "secret", expiresAt: "2099-09-15T00:00:00Z" },
  workspaces: [
    { id: "ws_1", name: "产品组", role: "owner" as const, createdAt: "2026-09-15T00:00:00Z" },
    { id: "ws_2", name: "研究组", role: "member" as const, createdAt: "2026-09-15T00:00:00Z" },
  ],
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}

describe("tenant session", () => {
  it("restores, switches and clears an authenticated workspace", () => {
    const storage = memoryStorage()
    expect(writeTenantSession(authentication, storage).activeWorkspaceId).toBe("ws_1")
    expect(readTenantSession(storage)?.user.email).toBe("learner@vivatom.dev")
    expect(selectTenantWorkspace("ws_2", storage)?.activeWorkspaceId).toBe("ws_2")
    clearTenantSession(storage)
    expect(readTenantSession(storage)).toBeUndefined()
  })

  it("ignores corrupt session data", () => {
    const storage = memoryStorage()
    storage.setItem("vivatom:tenant-session", "not-json")
    expect(readTenantSession(storage)).toBeUndefined()
  })

  it("removes an expired session", () => {
    const storage = memoryStorage()
    writeTenantSession({ ...authentication, session: { token: "old", expiresAt: "2020-01-01T00:00:00Z" } }, storage)
    expect(readTenantSession(storage)).toBeUndefined()
    expect(storage.length).toBe(0)
  })
})
