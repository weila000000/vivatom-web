import { describe, expect, it } from "vitest"
import type { ProjectSnapshot } from "../types/agent"
import { createVersion } from "./version-service"

const snapshot: ProjectSnapshot = {
  source: "template",
  title: "Task",
  summary: "Board",
  entryFile: "/src/App.tsx",
  files: { "/src/App.tsx": "export default function App() { return <main>Task</main> }" },
  dependencies: { react: "18.3.1", "react-dom": "18.3.1" },
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
    snapshot.files["/src/App.tsx"] = "changed"
    expect(version.snapshot.files["/src/App.tsx"]).toContain("function App")
    expect(version.projectId).toBe("p1")
	  expect(version.parentVersionId).toBe("previous-version")
	  expect(version.sourceAction).toBe("local")
  })
})
