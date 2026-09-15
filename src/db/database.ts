import Dexie, { type EntityTable } from "dexie"
import type { Project } from "../domain/project"
import type { AgentRunRecovery, Version } from "../types/agent"

export interface StoredMessage {
  id: string
  projectId: string
  role: "user" | "agent" | "system"
  content: string
  eventType?: string
  agent?: string
  action?: string
  status?: string
  createdAt: string
}

export interface StoredSyncConflict {
  projectId: string
  workspaceId: string
  localPayload: unknown
  cloudDocument: unknown
  createdAt: string
}

export class ReplicaDatabase extends Dexie {
  projects!: EntityTable<Project, "id">
  versions!: EntityTable<Version, "id">
  messages!: EntityTable<StoredMessage, "id">
  agentRuns!: EntityTable<AgentRunRecovery, "projectId">
  syncConflicts!: EntityTable<StoredSyncConflict, "projectId">

  constructor(name = "vivatom") {
    super(name)
    this.version(1).stores({
      projects: "id, updatedAt, status",
      versions: "id, projectId, parentVersionId, createdAt",
      messages: "id, projectId, createdAt",
    })
    this.version(2).stores({
      projects: "id, updatedAt, status",
      versions: "id, projectId, parentVersionId, createdAt",
      messages: "id, projectId, createdAt",
      agentRuns: "projectId, phase, updatedAt",
    })
    this.version(3).stores({
      projects: "id, workspaceId, updatedAt, status",
      versions: "id, projectId, parentVersionId, createdAt",
      messages: "id, projectId, createdAt",
      agentRuns: "projectId, phase, updatedAt",
    })
    this.version(4).stores({
      projects: "id, workspaceId, updatedAt, status",
      versions: "id, projectId, parentVersionId, createdAt",
      messages: "id, projectId, createdAt",
      agentRuns: "projectId, phase, updatedAt",
      syncConflicts: "projectId, workspaceId, createdAt",
    })
  }
}

export const db = new ReplicaDatabase()
