import { guardSnapshot } from "../generation/snapshot-guard"
import type { ProjectSnapshot, Version } from "../types/agent"
import { cloneJson } from "../utils/clone-json"

export interface CreateVersionInput {
  projectId: string
  parentVersionId?: string
  prompt: string
  snapshot: ProjectSnapshot
  candidateId?: string
  snapshotHash?: string
  sourceAction?: Version["sourceAction"]
}

export function createVersion(input: CreateVersionInput): Version {
  return {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    ...(input.parentVersionId ? { parentVersionId: input.parentVersionId } : {}),
    prompt: input.prompt,
    snapshot: cloneJson(guardSnapshot(input.snapshot)),
    ...(input.candidateId ? { candidateId: input.candidateId } : {}),
    ...(input.snapshotHash ? { snapshotHash: input.snapshotHash } : {}),
    sourceAction: input.sourceAction ?? "local",
    createdAt: new Date().toISOString(),
  }
}
