import type { ProjectDocumentPayload } from "./platform-client"

export type ConflictSummary = {
  titleChanged: boolean
  statusChanged: boolean
  localMessages: number
  cloudMessages: number
  localVersions: number
  cloudVersions: number
  addedFiles: string[]
  removedFiles: string[]
  changedFiles: string[]
}

export function summarizeConflict(local: ProjectDocumentPayload, cloud: ProjectDocumentPayload): ConflictSummary {
  const localFiles = activeFiles(local)
  const cloudFiles = activeFiles(cloud)
  return {
    titleChanged: local.project.title !== cloud.project.title,
    statusChanged: local.project.status !== cloud.project.status,
    localMessages: local.messages.length,
    cloudMessages: cloud.messages.length,
    localVersions: local.versions.length,
    cloudVersions: cloud.versions.length,
    addedFiles: Object.keys(localFiles).filter((path) => !(path in cloudFiles)).sort(),
    removedFiles: Object.keys(cloudFiles).filter((path) => !(path in localFiles)).sort(),
    changedFiles: Object.keys(localFiles).filter((path) => path in cloudFiles && localFiles[path] !== cloudFiles[path]).sort(),
  }
}

export function cloneAsConflictCopy(payload: ProjectDocumentPayload): ProjectDocumentPayload {
  const projectId = crypto.randomUUID()
  const versionIDs = new Map(payload.versions.map((version) => [version.id, crypto.randomUUID()]))
  return {
    project: {
      ...structuredClone(payload.project),
      id: projectId,
      title: `${payload.project.title}（冲突副本）`,
      activeVersionId: payload.project.activeVersionId ? versionIDs.get(payload.project.activeVersionId) : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    messages: payload.messages.map((message) => ({ ...structuredClone(message), id: crypto.randomUUID(), projectId })),
    versions: payload.versions.map((version) => ({
      ...structuredClone(version),
      id: versionIDs.get(version.id)!,
      projectId,
      parentVersionId: version.parentVersionId ? versionIDs.get(version.parentVersionId) : undefined,
    })),
  }
}

function activeFiles(payload: ProjectDocumentPayload): Record<string, string> {
  return payload.versions.find((version) => version.id === payload.project.activeVersionId)?.snapshot.files ?? {}
}
