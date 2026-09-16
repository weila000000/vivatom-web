import type { Version } from "../types/agent"

export function versionPreviewUrl(
  version: Version,
  baseUrl = import.meta.env.VITE_PREVIEW_BASE_URL || "http://localhost:8091/preview",
): string | undefined {
  const artifactId = version.build?.artifactId
  if (!artifactId || !/^[a-f0-9]{64}$/.test(artifactId)) return undefined
  return `${baseUrl.replace(/\/+$/, "")}/${artifactId}/`
}

export function hostedVersionPreviewUrl(version: Version, projectId: string, publicKey?: string): string | undefined {
  if (!versionPreviewUrl(version) || !projectId) return undefined
  const capability = new URLSearchParams({ project: projectId })
  if (publicKey) capability.set("key", publicKey)
  return `/preview?artifact=${version.build!.artifactId!}#${capability.toString()}`
}

export interface HostedPreviewTarget {
  artifactUrl: string
  projectId: string
  publicKey?: string
}

export function parseHostedPreviewTarget(
  search: string,
  hash: string,
  baseUrl = import.meta.env.VITE_PREVIEW_BASE_URL || "http://localhost:8091/preview",
): HostedPreviewTarget | undefined {
  const artifactId = new URLSearchParams(search).get("artifact") ?? ""
  const capability = new URLSearchParams(hash.replace(/^#/, ""))
  const projectId = capability.get("project") ?? ""
  const publicKey = capability.get("key") ?? ""
  if (!/^[a-f0-9]{64}$/.test(artifactId) || !projectId || projectId.length > 200 || publicKey.length > 512) return undefined
  return {
    artifactUrl: `${baseUrl.replace(/\/+$/, "")}/${artifactId}/`,
    projectId,
    ...(publicKey ? { publicKey } : {}),
  }
}
