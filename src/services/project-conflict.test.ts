import { describe, expect, it } from "vitest"
import type { ProjectDocumentPayload } from "./platform-client"
import { cloneAsConflictCopy, summarizeConflict } from "./project-conflict"

function payload(): ProjectDocumentPayload {
  return {
    project: { id: "project-1", workspaceId: "workspace-1", title: "任务板", status: "ready", activeVersionId: "version-2", createdAt: "now", updatedAt: "now" },
    messages: [{ id: "message-1", projectId: "project-1", role: "user", content: "需求", createdAt: "now" }],
    versions: [
      { id: "version-1", projectId: "project-1", prompt: "one", snapshot: { source: "template", title: "One", summary: "One", files: { "/src/main.ts": "one" }, dependencies: { vue: "3.5.42" }, entryFile: "/src/main.ts", backend: { enabled: false, auth: "none", collections: [] } }, createdAt: "now" },
      { id: "version-2", projectId: "project-1", parentVersionId: "version-1", prompt: "two", snapshot: { source: "template", title: "Two", summary: "Two", files: { "/src/main.ts": "two", "/src/App.vue": "app" }, dependencies: { vue: "3.5.42" }, entryFile: "/src/main.ts", backend: { enabled: false, auth: "none", collections: [] } }, createdAt: "now" },
    ],
  }
}

describe("project conflict", () => {
  it("summarizes active snapshot differences", () => {
    const local = payload()
    const cloud = payload()
    cloud.messages = []
    cloud.versions[1]!.snapshot.files = { "/src/main.ts": "cloud", "/src/cloud.ts": "cloud" }
    expect(summarizeConflict(local, cloud)).toMatchObject({
      localMessages: 1,
      cloudMessages: 0,
      addedFiles: ["/src/App.vue"],
      removedFiles: ["/src/cloud.ts"],
      changedFiles: ["/src/main.ts"],
    })
  })

  it("clones every identity and preserves the version graph", () => {
    const copy = cloneAsConflictCopy(payload())
    expect(copy.project.id).not.toBe("project-1")
    expect(copy.project.title).toContain("冲突副本")
    expect(copy.messages[0]?.projectId).toBe(copy.project.id)
    expect(copy.messages[0]?.id).not.toBe("message-1")
    expect(copy.versions.every((version) => version.projectId === copy.project.id)).toBe(true)
    expect(copy.versions[1]?.parentVersionId).toBe(copy.versions[0]?.id)
    expect(copy.project.activeVersionId).toBe(copy.versions[1]?.id)
  })
})
