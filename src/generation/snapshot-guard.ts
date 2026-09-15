import type { ProjectSnapshot } from "../types/agent"

export const snapshotLimits = {
  files: 80,
  fileBytes: 256 * 1024,
  totalBytes: 2 * 1024 * 1024,
} as const

const dependencies: Record<string, string> = {
  vue: "3.5.42",
}

const allowedExtensions = new Set(["css", "js", "jsx", "json", "ts", "tsx", "vue"])
const forbiddenSource = [
  ["source.eval", /\beval\s*\(/],
  ["source.function_constructor", /\bFunction\s*\(/],
  ["source.fetch", /\bfetch\s*\(/],
  ["source.xhr", /\bXMLHttpRequest\b/],
  ["source.websocket", /\bWebSocket\b/],
  ["source.parent_window", /\bwindow\.(?:parent|top)\b/],
  ["source.cookie", /\bdocument\.cookie\b/],
  ["source.remote_import", /\bimport\s*\(\s*["']https?:\/\//],
] as const
const remoteCSS = /(?:@import|url\s*\()[^;\n]*https?:\/\//i

export class SnapshotRejectedError extends Error {
  constructor(
    readonly code: string,
    readonly path?: string,
  ) {
    super(path ? `${code}: ${path}` : code)
    this.name = "SnapshotRejectedError"
  }
}

export function guardSnapshot(input: ProjectSnapshot): ProjectSnapshot {
  const entries = Object.entries(input.files)
  if (entries.length === 0) reject("files.empty")
  if (entries.length > snapshotLimits.files) reject("files.too_many")
  if (!isSafeSourcePath(input.entryFile)) reject("entry.invalid", input.entryFile)
  if (!Object.hasOwn(input.files, input.entryFile)) reject("entry.missing", input.entryFile)

  let totalBytes = 0
  for (const [path, source] of entries) {
    if (!isSafeSourcePath(path)) reject("path.invalid", path)
    const bytes = new TextEncoder().encode(source).byteLength
    if (bytes > snapshotLimits.fileBytes) reject("file.too_large", path)
    totalBytes += bytes
    if (totalBytes > snapshotLimits.totalBytes) reject("files.too_large")

    for (const [code, pattern] of forbiddenSource) {
      if (pattern.test(source)) reject(code, path)
    }
    if (path.endsWith(".css") && remoteCSS.test(source)) {
      reject("source.remote_css", path)
    }
  }

  const pinnedDependencies: Record<string, string> = {}
  for (const name of Object.keys(input.dependencies)) {
    if (!Object.hasOwn(dependencies, name)) reject("dependency.denied", name)
    pinnedDependencies[name] = dependencies[name]
  }

  return structuredClone({
    ...input,
    dependencies: pinnedDependencies,
  })
}

function reject(code: string, path?: string): never {
  throw new SnapshotRejectedError(code, path)
}

function isSafeSourcePath(path: string): boolean {
  if (!path.startsWith("/src/") || path.includes("\\") || path.includes("\0")) {
    return false
  }
  const segments = path.slice(1).split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return false
  }
  const extension = path.split(".").pop() ?? ""
  return allowedExtensions.has(extension)
}
