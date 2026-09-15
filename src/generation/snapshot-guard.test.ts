import { describe, expect, it } from "vitest"
import type { ProjectSnapshot } from "../types/agent"
import {
  guardSnapshot,
  snapshotLimits,
  SnapshotRejectedError,
} from "./snapshot-guard"

function validSnapshot(): ProjectSnapshot {
  return {
    source: "template",
    title: "Task",
    summary: "Board",
    entryFile: "/src/main.ts",
    files: {
      "/src/main.ts": 'import App from "./App.vue"',
      "/src/App.vue": "<template><main>Task</main></template>",
    },
    dependencies: { vue: "latest" },
    backend: { enabled: false, auth: "none", collections: [] },
  }
}

describe("guardSnapshot", () => {
  it("accepts safe files and pins dependencies", () => {
    const input = validSnapshot()
    const guarded = guardSnapshot(input)
    expect(guarded.dependencies).toEqual({ vue: "3.5.42" })
    expect(input.dependencies).toEqual({ vue: "latest" })
  })

  it.each([
    ["path traversal", (value: ProjectSnapshot) => {
      value.files["/src/../secret.ts"] = "secret"
    }],
    ["missing entry", (value: ProjectSnapshot) => {
      delete value.files[value.entryFile]
    }],
    ["network access", (value: ProjectSnapshot) => {
      value.files["/src/main.ts"] = 'fetch("/secret")'
    }],
    ["unknown dependency", (value: ProjectSnapshot) => {
      value.dependencies.axios = "latest"
    }],
    ["oversized file", (value: ProjectSnapshot) => {
      value.files["/src/main.ts"] = "x".repeat(snapshotLimits.fileBytes + 1)
    }],
  ])("rejects %s", (_name, mutate) => {
    const input = validSnapshot()
    mutate(input)
    expect(() => guardSnapshot(input)).toThrow(SnapshotRejectedError)
  })
})
