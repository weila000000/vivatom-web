import { guardSnapshot } from "../generation/snapshot-guard"
import type { ProjectSnapshot, Version } from "../types/agent"

export interface CreateVersionInput {
  projectId: string
  parentVersionId?: string
  prompt: string
  snapshot: ProjectSnapshot
}

export function createVersion(input: CreateVersionInput): Version {
  return {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    ...(input.parentVersionId ? { parentVersionId: input.parentVersionId } : {}),
    prompt: input.prompt,
    snapshot: structuredClone(guardSnapshot(input.snapshot)),
    createdAt: new Date().toISOString(),
  }
}
