import type { Version } from "../types/agent"

export function versionPreviewUrl(
  version: Version,
  baseUrl = import.meta.env.VITE_PREVIEW_BASE_URL || "http://localhost:8091/preview",
): string | undefined {
  const artifactId = version.build?.artifactId
  if (!artifactId || !/^[a-f0-9]{64}$/.test(artifactId)) return undefined
  return `${baseUrl.replace(/\/+$/, "")}/${artifactId}/`
}
