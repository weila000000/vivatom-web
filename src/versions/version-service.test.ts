import { describe, expect, it } from "vitest"
import type { ProjectSnapshot } from "../types/agent"
import { createVersion } from "./version-service"

const snapshot: ProjectSnapshot = {
  source: "template",
  title: "Task",
  summary: "Board",
  entryFile: "/src/main.ts",
  files: { "/src/main.ts": "const title = 'Task'" },
  dependencies: { vue: "3.5.42" },
  backend: { enabled: false, auth: "none", collections: [] },
}

describe("createVersion", () => {
  it("stores an immutable copy of the verified snapshot", () => {
    const version = createVersion({
      projectId: "p1",
      parentVersionId: "previous-version",
      prompt: "任务看板",
	    snapshot,
	    sourceAction: "local",
    })
    snapshot.files["/src/main.ts"] = "changed"
    expect(version.snapshot.files["/src/main.ts"]).toBe("const title = 'Task'")
    expect(version.projectId).toBe("p1")
	  expect(version.parentVersionId).toBe("previous-version")
	  expect(version.sourceAction).toBe("local")
  })
})
