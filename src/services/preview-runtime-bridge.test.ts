import { describe, expect, it, vi } from "vitest"
import { createPreviewRuntimeBridge, previewRuntimeRequestType, previewRuntimeResponseType } from "./preview-runtime-bridge"

const projectId = "project-1"
const origin = "https://preview.example.test"

function message(source: Window, data: unknown) {
  return { source, origin, data } as Pick<MessageEvent, "source" | "origin" | "data">
}

describe("preview runtime bridge", () => {
  it("proxies only scoped Runtime routes with the public key", async () => {
    const postMessage = vi.fn()
    const previewWindow = { postMessage } as unknown as Window
    const fetchRuntime = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    const bridge = createPreviewRuntimeBridge({ projectId, publicKey: "public-key", apiBaseUrl: "http://localhost:5173/", getPreviewWindow: () => previewWindow, fetchRuntime })

    await bridge(message(previewWindow, { type: previewRuntimeRequestType, id: "one", projectId, path: "/collections/tasks", method: "GET", sessionToken: "session" }))
    expect(fetchRuntime).toHaveBeenCalledWith(
      "http://localhost:5173/api/runtime/projects/project-1/collections/tasks",
      expect.objectContaining({ headers: expect.objectContaining({ "X-Vivatom-App-Key": "public-key", Authorization: "Bearer session" }) }),
    )
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: previewRuntimeResponseType, id: "one", ok: true }), origin)
  })

  it("ignores another window, project, and unsafe paths", async () => {
    const previewWindow = { postMessage: vi.fn() } as unknown as Window
    const otherWindow = { postMessage: vi.fn() } as unknown as Window
    const fetchRuntime = vi.fn()
    const bridge = createPreviewRuntimeBridge({ projectId, publicKey: "public-key", apiBaseUrl: "", getPreviewWindow: () => previewWindow, fetchRuntime })

    await bridge(message(otherWindow, { type: previewRuntimeRequestType, id: "one", projectId, path: "/auth/me", method: "GET" }))
    await bridge(message(previewWindow, { type: previewRuntimeRequestType, id: "two", projectId: "other", path: "/auth/me", method: "GET" }))
    await bridge(message(previewWindow, { type: previewRuntimeRequestType, id: "three", projectId, path: "/../provision", method: "POST" }))
    expect(fetchRuntime).not.toHaveBeenCalled()
  })

  it("responds to a verified opaque-origin artifact", async () => {
    const postMessage = vi.fn()
    const previewWindow = { postMessage } as unknown as Window
    const fetchRuntime = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    const bridge = createPreviewRuntimeBridge({ projectId, publicKey: "public-key", apiBaseUrl: "", getPreviewWindow: () => previewWindow, fetchRuntime })

    await bridge({ source: previewWindow, origin: "null", data: { type: previewRuntimeRequestType, id: "opaque", projectId, path: "/collections/tasks", method: "GET" } })

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "opaque", ok: true }), "*")
  })
})
