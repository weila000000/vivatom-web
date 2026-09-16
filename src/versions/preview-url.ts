import type { Version } from "../types/agent"

export function versionPreviewUrl(
  version: Version,
  baseUrl = import.meta.env.VITE_PREVIEW_BASE_URL || "http://localhost:8091/preview",
): string | undefined {
  const artifactId = version.build?.artifactId
  if (!artifactId || !/^[a-f0-9]{64}$/.test(artifactId)) return undefined
  return `${baseUrl.replace(/\/+$/, "")}/${artifactId}/`
}

export function hostedVersionPreviewUrl(version: Version, projectId: string): string | undefined {
  if (!versionPreviewUrl(version) || !projectId) return undefined
  const query = new URLSearchParams({ project: projectId, artifact: version.build!.artifactId! })
  return `/preview?${query.toString()}`
}
