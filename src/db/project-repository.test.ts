import "fake-indexeddb/auto"
import { afterEach, describe, expect, it } from "vitest"
import { reactive } from "vue"
import { createProject, transitionProject } from "../domain/project"
import type { ProjectSnapshot } from "../types/agent"
import { createVersion } from "../versions/version-service"
import { ReplicaDatabase } from "./database"
import { ProjectRepository } from "./project-repository"

const databases: ReplicaDatabase[] = []

function setup() {
  const database = new ReplicaDatabase(`vivatom-test-${crypto.randomUUID()}`)
  databases.push(database)
  return { database, repository: new ProjectRepository(database) }
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()))
})

const snapshot: ProjectSnapshot = {
  source: "template",
  title: "Task",
  summary: "Board",
  entryFile: "/src/main.ts",
  files: { "/src/main.ts": "const title = 'Task'" },
  dependencies: { vue: "3.5.42" },
  backend: { enabled: false, auth: "none", collections: [] },
}

describe("ProjectRepository", () => {
  it("detaches Vue proxies before writing to IndexedDB", async () => {
    const { repository } = setup()
    const project = reactive(createProject("响应式项目"))

    await expect(repository.createWithMessage(project, "代理对象需求")).resolves.toBeUndefined()
    project.title = "页面中的新标题"

    const restored = await repository.restore(project.id)
    expect(restored?.project.title).toBe("响应式项目")
  })

  it("creates a project and its first message atomically", async () => {
    const { repository } = setup()
    const project = createProject("任务看板")
    await repository.createWithMessage(project, "为团队创建任务看板")
    const restored = await repository.restoreLatest()
    expect(restored?.project.id).toBe(project.id)
    expect(restored?.messages.map((message) => message.content)).toEqual([
      "为团队创建任务看板",
    ])
  })

  it("commits a version and active project pointer in one transaction", async () => {
    const { repository } = setup()
    let project = createProject("任务看板")
    await repository.createWithMessage(project, "任务看板")
    project = transitionProject(project, "start_plan")
    project = transitionProject(project, "plan_ready")
    project = transitionProject(project, "approve")
    project = transitionProject(project, "build_succeeded")
    const version = createVersion({ projectId: project.id, prompt: "任务看板", snapshot })
    project = { ...project, activeVersionId: version.id }
    await repository.commitVersion(project, version)

    const restored = await repository.restoreLatest()
    expect(restored?.project.status).toBe("ready")
    expect(restored?.activeVersion?.id).toBe(version.id)
  })

  it("rolls back the version when its project does not exist", async () => {
    const { database, repository } = setup()
    const project = createProject("不存在")
    const version = createVersion({ projectId: project.id, prompt: "任务", snapshot })
    await expect(repository.commitVersion(project, version)).rejects.toThrow(
      "Project not found",
    )
    expect(await database.versions.get(version.id)).toBeUndefined()
  })

  it("upgrades a request checkpoint to a snapshot and clears it on commit", async () => {
    const { database, repository } = setup()
    let project = createProject("任务看板")
    await repository.createWithMessage(project, "任务看板")
    project = transitionProject(project, "start_plan")
    project = transitionProject(project, "plan_ready")
    project = transitionProject(project, "approve")
    await repository.saveRequestRecovery(project.id, {
      action: "build",
      projectId: project.id,
      prompt: "任务看板",
      plan: {
        productType: "web_app",
        productSummary: "任务看板",
        targetUsers: [],
        features: [],
        pages: [],
        filePlan: [],
        designDirection: "清晰",
        acceptanceChecks: [],
        backend: snapshot.backend,
      },
    })
    const requestRecovery = await database.agentRuns.get(project.id)
    if (!requestRecovery) throw new Error("request recovery missing")
    await repository.saveSnapshotRecovery(
      project.id,
      requestRecovery.request,
      snapshot,
    )
    expect((await database.agentRuns.get(project.id))?.phase).toBe("snapshot")

    project = {
      ...transitionProject(project, "build_succeeded"),
      activeVersionId: "v1",
    }
    const version = { ...createVersion({
      projectId: project.id,
      prompt: "任务看板",
      snapshot,
    }), id: "v1" }
    await repository.commitVersion(project, version)
    expect(await database.agentRuns.get(project.id)).toBeUndefined()
  })

  it("restores only projects belonging to the active workspace", async () => {
    const { repository } = setup()
    const first = createProject("产品站", "workspace-a")
    const second = createProject("内部工具", "workspace-b")
    await repository.createWithMessage(first, "产品站")
    await repository.createWithMessage(second, "内部工具")

    expect((await repository.restoreLatest("workspace-a"))?.project.id).toBe(first.id)
    expect((await repository.restoreLatest("workspace-b"))?.project.id).toBe(second.id)
    expect(await repository.restoreLatest("workspace-c")).toBeUndefined()
  })

  it("exports cloud content and atomically imports a newer revision", async () => {
    const { repository } = setup()
    let project = createProject("本地项目", "workspace-a")
    await repository.createWithMessage(project, "本地需求")
    project = { ...project, cloudRevision: 2, cloudContentHash: "old-hash" }
    await repository.saveProject(project)

    const exported = await repository.exportDocument(project.id)
    expect(exported?.project).not.toHaveProperty("cloudRevision")
    expect(exported?.messages[0]?.content).toBe("本地需求")

    if (!exported) throw new Error("document missing")
    const imported = {
      ...exported,
      project: { ...exported.project, title: "云端项目" },
      messages: [{ ...exported.messages[0]!, content: "云端需求" }],
    }
    await repository.importDocument(imported, 3, "new-hash")
    const restored = await repository.restore(project.id)
    expect(restored?.project).toMatchObject({ title: "云端项目", cloudRevision: 3, cloudContentHash: "new-hash" })
    expect(restored?.messages.map((item) => item.content)).toEqual(["云端需求"])
  })

  it("persists both sides of a sync conflict", async () => {
    const { repository } = setup()
    const project = createProject("本地项目", "workspace-a")
    await repository.createWithMessage(project, "本地需求")
    const localPayload = await repository.exportDocument(project.id)
    if (!localPayload) throw new Error("document missing")
    const conflict = {
      projectId: project.id,
      workspaceId: "workspace-a",
      localPayload,
      cloudDocument: { projectId: project.id, revision: 2, contentHash: "cloud-hash", payload: { ...localPayload, project: { ...localPayload.project, title: "云端项目" } }, updatedAt: "now" },
      createdAt: "now",
    }
    await repository.saveConflict(conflict)
    expect((await repository.getConflict(project.id))?.cloudDocument.payload.project.title).toBe("云端项目")
    await repository.clearConflict(project.id)
    expect(await repository.getConflict(project.id)).toBeUndefined()
  })
})
