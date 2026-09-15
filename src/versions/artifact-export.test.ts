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
    source: "template", title: "Task Board", summary: "Board", entryFile: "/src/main.ts",
    files: { "/src/main.ts": "createApp(App)", "/src/App.vue": "<template>Task</template>", "/src/styles.css": "body {}" },
    dependencies: { vue: "3.5.42" }, backend: { enabled: false, auth: "none", collections: [] },
  },
}

describe("version artifact export", () => {
  it("creates a standalone archive without changing the snapshot", () => {
    const archive = unzipSync(buildVersionArchive(version))
    expect(strFromU8(archive["src/App.vue"])).toBe("<template>Task</template>")
    expect(JSON.parse(strFromU8(archive["package.json"]))).toMatchObject({ scripts: { dev: "vite", build: "vite build" }, dependencies: { vue: "3.5.42" } })
    expect(strFromU8(archive["index.html"])).toContain("/src/main.ts")
    expect(JSON.parse(strFromU8(archive["VIVATOM_VERSION.json"]))).toMatchObject({ id: version.id, prompt: version.prompt })
    expect(version.snapshot.files["/src/App.vue"]).toBe("<template>Task</template>")
    expect(archiveFilename(version)).toBe("task-board-12345678.zip")
  })
})
