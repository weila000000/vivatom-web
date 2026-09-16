import { describe, expect, it, vi } from "vitest"
import { createRuntimeProvisionAttempt, RuntimeProvisionError } from "./runtime-client"

const backend = {
  enabled: true,
  auth: "none" as const,
  collections: [],
}

describe("runtime provisioning", () => {
  it("creates stable credentials and provisions the project schema", async () => {
    const tokens = ["public-key-123456789", "admin-token-123456789"]
    const attempt = createRuntimeProvisionAttempt(
      { projectId: "project/1", title: "Task", backend },
      () => tokens.shift()!,
    )
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { schemaVersion: 2 } }), { status: 200 }))

    await expect(attempt.run(fetcher)).resolves.toEqual({
      ...attempt.credentials,
      schemaVersion: 2,
    })
    expect(fetcher).toHaveBeenCalledWith(
      "/api/runtime/projects/project%2F1/provision",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "X-Vivatom-App-Key": "public-key-123456789",
          "X-Vivatom-Admin-Token": "admin-token-123456789",
        }),
      }),
    )
  })

  it("reuses existing credentials and rejects malformed responses", async () => {
    const attempt = createRuntimeProvisionAttempt({
      projectId: "project-1",
      title: "Task",
      backend,
      runtime: { publicKey: "existing-public-key", adminToken: "existing-admin-token" },
    })
    expect(attempt.credentials).toEqual({ publicKey: "existing-public-key", adminToken: "existing-admin-token" })
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { schemaVersion: 0 } }), { status: 200 }))
    await expect(attempt.run(fetcher)).rejects.toBeInstanceOf(RuntimeProvisionError)
  })

  it("does not call the Runtime API for frontend-only projects", async () => {
    const attempt = createRuntimeProvisionAttempt({
      projectId: "project-1",
      title: "Site",
      backend: { enabled: false, auth: "none", collections: [] },
    })
    const fetcher = vi.fn()
    await expect(attempt.run(fetcher)).resolves.toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
