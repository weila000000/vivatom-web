import { strFromU8, unzipSync } from "fflate"
import { describe, expect, it } from "vitest"
import type { Version } from "../types/agent"
import { archiveFilename, buildVersionArchive } from "./artifact-export"

const version: Version = {
  id: "version-12345678",
  projectId: "project-1",
  prompt: "构建任务板",
  createdAt: "2026-01-01T00:00:00Z",
  snapshot: {
    source: "template", title: "Task Board", summary: "Board", entryFile: "/src/App.tsx",
    files: { "/src/main.tsx": "createRoot(root).render(<App />)", "/src/App.tsx": "export default function App() { return <main>Task</main> }", "/src/styles.css": "body {}" },
    dependencies: { react: "18.3.1", "react-dom": "18.3.1" },
  },
}

describe("version artifact export", () => {
  it("creates a standalone archive without changing the snapshot", () => {
    const archive = unzipSync(buildVersionArchive(version))
    expect(strFromU8(archive["src/App.tsx"])).toContain("function App")
    expect(JSON.parse(strFromU8(archive["package.json"]))).toMatchObject({ scripts: { dev: "vite", build: "vite build" }, dependencies: { react: "18.3.1" } })
    expect(strFromU8(archive["index.html"])).toContain("/src/main.tsx")
    expect(JSON.parse(strFromU8(archive["VIVATOM_VERSION.json"]))).toMatchObject({ id: version.id, prompt: version.prompt })
    expect(version.snapshot.files["/src/App.tsx"]).toContain("function App")
    expect(archiveFilename(version)).toBe("task-board-12345678.zip")
  })
})
