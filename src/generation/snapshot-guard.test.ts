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
    entryFile: "/src/App.tsx",
    files: {
      "/src/main.tsx": 'import App from "./App"',
      "/src/App.tsx": "export default function App() { return <main>Task</main> }",
    },
    dependencies: { react: "latest", "react-dom": "latest" },
  }
}

describe("guardSnapshot", () => {
  it("accepts safe files and pins dependencies", () => {
    const input = validSnapshot()
    const guarded = guardSnapshot(input)
    expect(guarded.dependencies).toEqual({ react: "18.3.1", "react-dom": "18.3.1" })
    expect(input.dependencies).toEqual({ react: "latest", "react-dom": "latest" })
  })

  it.each([
    ["path traversal", (value: ProjectSnapshot) => {
      value.files["/src/../secret.ts"] = "secret"
    }],
    ["missing entry", (value: ProjectSnapshot) => {
      delete value.files[value.entryFile]
    }],
    ["network access", (value: ProjectSnapshot) => {
      value.files["/src/App.tsx"] = 'fetch("/secret")'
    }],
    ["unknown dependency", (value: ProjectSnapshot) => {
      value.dependencies.axios = "latest"
    }],
    ["oversized file", (value: ProjectSnapshot) => {
      value.files["/src/App.tsx"] = "x".repeat(snapshotLimits.fileBytes + 1)
    }],
  ])("rejects %s", (_name, mutate) => {
    const input = validSnapshot()
    mutate(input)
    expect(() => guardSnapshot(input)).toThrow(SnapshotRejectedError)
  })
})
