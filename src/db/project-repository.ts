import type { Project } from "../domain/project"
import type {
  AgentEvent,
  AgentRequest,
  AgentRunRecovery,
  ProjectSnapshot,
  Version,
} from "../types/agent"
import { db, type ReplicaDatabase, type StoredMessage } from "./database"
import type { ProjectDocument, ProjectDocumentPayload } from "../services/platform-client"

export type ProjectSyncConflict = {
  projectId: string
  workspaceId: string
  localPayload: ProjectDocumentPayload
  cloudDocument: ProjectDocument
  createdAt: string
}

export interface RestoredWorkspace {
  project: Project
  messages: StoredMessage[]
  versions: Version[]
  activeVersion?: Version
  recovery?: AgentRunRecovery
}

export class ProjectRepository {
  constructor(private readonly database: ReplicaDatabase) {}

  async createWithMessage(project: Project, prompt: string): Promise<void> {
    await this.database.transaction(
      "rw",
      this.database.projects,
      this.database.messages,
      async () => {
        await this.database.projects.add(structuredClone(project))
        await this.database.messages.add({
          id: crypto.randomUUID(),
          projectId: project.id,
          role: "user",
          content: prompt,
          createdAt: project.createdAt,
        })
      },
    )
  }

  async saveProject(project: Project): Promise<void> {
    await this.database.projects.put(structuredClone(project))
  }

  async addUserMessage(projectId: string, content: string): Promise<void> {
    await this.database.messages.add({
      id: crypto.randomUUID(),
      projectId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    })
  }

  async addAgentEvent(projectId: string, event: AgentEvent): Promise<void> {
    if (event.type === "done" || event.type === "snapshot.completed") return
    const content =
      event.label ??
      event.message ??
      event.text ??
      (event.type === "approval.required" ? "方案等待确认" : event.type)
    const stableActionId = event.id ? `${projectId}:${event.id}` : undefined
    const existing = stableActionId
      ? await this.database.messages.get(stableActionId)
      : undefined
    await this.database.messages.put({
      id: stableActionId ?? crypto.randomUUID(),
      projectId,
      role: "agent",
      content,
      eventType: event.type,
      agent: event.agent,
      action: event.action,
      status: event.status,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    })
  }

  async saveRequestRecovery(
    projectId: string,
    request: AgentRequest,
    repairAttempts = 0,
  ): Promise<AgentRunRecovery> {
    return this.saveRecovery({ projectId, phase: "request", request, repairAttempts })
  }

  async saveSnapshotRecovery(
    projectId: string,
    request: AgentRequest,
    snapshot: ProjectSnapshot,
    repairAttempts = 0,
    candidate?: { candidateId: string; snapshotHash: string },
  ): Promise<AgentRunRecovery> {
    return this.saveRecovery({ projectId, phase: "snapshot", request, snapshot, repairAttempts, ...candidate })
  }

  private async saveRecovery(
    input:
      | { projectId: string; phase: "request"; request: AgentRequest; repairAttempts?: number }
      | {
          projectId: string
          phase: "snapshot"
          request: AgentRequest
          snapshot: ProjectSnapshot
          repairAttempts?: number
          candidateId?: string
          snapshotHash?: string
        },
  ): Promise<AgentRunRecovery> {
    const existing = await this.database.agentRuns.get(input.projectId)
    const now = new Date().toISOString()
    const recovery = structuredClone({
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }) as AgentRunRecovery
    await this.database.agentRuns.put(recovery)
    return recovery
  }

  async clearRecovery(projectId: string): Promise<void> {
    await this.database.agentRuns.delete(projectId)
  }

  async commitVersion(project: Project, version: Version): Promise<void> {
    await this.database.transaction(
      "rw",
      this.database.projects,
      this.database.versions,
      this.database.agentRuns,
      async () => {
        const exists = await this.database.projects.get(project.id)
        if (!exists) throw new Error(`Project not found: ${project.id}`)
        await this.database.versions.add(structuredClone(version))
        await this.database.projects.put(structuredClone(project))
        await this.database.agentRuns.delete(project.id)
      },
    )
  }

  async restoreLatest(workspaceId?: string): Promise<RestoredWorkspace | undefined> {
    const projects = await this.database.projects.orderBy("updatedAt").toArray()
    const project = [...projects].reverse().find((item) => !workspaceId || item.workspaceId === workspaceId || !item.workspaceId)
    if (!project) return undefined
    return this.restore(project.id)
  }

  async restore(projectId: string): Promise<RestoredWorkspace | undefined> {
    const project = await this.database.projects.get(projectId)
    if (!project) return undefined
    const [messages, versions, recovery] = await Promise.all([
      this.database.messages.where("projectId").equals(projectId).sortBy("createdAt"),
      this.database.versions.where("projectId").equals(projectId).sortBy("createdAt"),
      this.database.agentRuns.get(projectId),
    ])
    return {
      project,
      messages,
      versions,
      activeVersion: project.activeVersionId
        ? versions.find((version) => version.id === project.activeVersionId)
        : undefined,
      recovery,
    }
  }

  async exportDocument(projectId: string): Promise<ProjectDocumentPayload | undefined> {
    const restored = await this.restore(projectId)
    if (!restored) return undefined
    const { cloudRevision: _revision, cloudContentHash: _hash, ...project } = restored.project
    return {
      project: structuredClone(project),
      messages: structuredClone(restored.messages),
      versions: structuredClone(restored.versions),
    }
  }

  async importDocument(payload: ProjectDocumentPayload, revision?: number, contentHash?: string): Promise<void> {
    const project: Project = {
      ...structuredClone(payload.project),
      ...(revision === undefined ? {} : { cloudRevision: revision }),
      ...(contentHash === undefined ? {} : { cloudContentHash: contentHash }),
    }
    await this.database.transaction("rw", this.database.projects, this.database.messages, this.database.versions, this.database.agentRuns, async () => {
      await this.database.messages.where("projectId").equals(project.id).delete()
      await this.database.versions.where("projectId").equals(project.id).delete()
      await this.database.agentRuns.delete(project.id)
      await this.database.projects.put(project)
      if (payload.messages.length) await this.database.messages.bulkPut(structuredClone(payload.messages))
      if (payload.versions.length) await this.database.versions.bulkPut(structuredClone(payload.versions))
    })
  }

  async saveCloudState(projectId: string, revision: number, contentHash: string): Promise<Project | undefined> {
    const project = await this.database.projects.get(projectId)
    if (!project) return undefined
    if (project.cloudRevision === revision && project.cloudContentHash === contentHash) return project
    const next = { ...project, cloudRevision: revision, cloudContentHash: contentHash }
    await this.database.projects.put(next)
    return next
  }

  async saveConflict(conflict: ProjectSyncConflict): Promise<void> {
    await this.database.syncConflicts.put(structuredClone(conflict))
  }

  async getConflict(projectId: string): Promise<ProjectSyncConflict | undefined> {
    return await this.database.syncConflicts.get(projectId) as ProjectSyncConflict | undefined
  }

  async clearConflict(projectId: string): Promise<void> {
    await this.database.syncConflicts.delete(projectId)
  }

  async importLocalCopy(payload: ProjectDocumentPayload): Promise<void> {
    await this.importDocument(payload)
  }
}

export const projectRepository = new ProjectRepository(db)
