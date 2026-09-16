export const previewRuntimeRequestType = "vivatom:runtime-request"
export const previewRuntimeResponseType = "vivatom:runtime-response"

type RuntimeMethod = "GET" | "POST" | "PATCH" | "DELETE"

interface PreviewRuntimeRequest {
  type: typeof previewRuntimeRequestType
  id: string
  projectId: string
  path: string
  method: RuntimeMethod
  sessionToken?: string
  body?: unknown
}

interface BridgeOptions {
  projectId: string
  publicKey: string
  apiBaseUrl: string
  getPreviewWindow(): Window | null
  fetchRuntime?: typeof fetch
}

function safeSegment(segment: string): boolean {
  try {
    const decoded = decodeURIComponent(segment)
    return decoded.length > 0 && decoded !== "." && decoded !== ".." && !decoded.includes("/") && !decoded.includes("\\")
  } catch {
    return false
  }
}

function allowedRoute(path: string, method: RuntimeMethod): boolean {
  if (path.includes("?") || path.includes("#")) return false
  const auth = path.match(/^\/auth\/(register|login|logout|me)$/)?.[1]
  if (auth) return auth === "me" ? method === "GET" : method === "POST"
  const parts = path.split("/")
  if (parts[0] !== "" || parts[1] !== "collections" || (parts.length !== 3 && parts.length !== 4) || !parts.slice(2).every(safeSegment)) return false
  return parts.length === 3
    ? method === "GET" || method === "POST"
    : method === "PATCH" || method === "DELETE"
}

function parseRequest(value: unknown, projectId: string): PreviewRuntimeRequest | undefined {
  if (!value || typeof value !== "object") return undefined
  const candidate = value as Partial<PreviewRuntimeRequest>
  if (
    candidate.type !== previewRuntimeRequestType ||
    typeof candidate.id !== "string" || candidate.id.length === 0 || candidate.id.length > 160 ||
    candidate.projectId !== projectId ||
    typeof candidate.path !== "string" ||
    !["GET", "POST", "PATCH", "DELETE"].includes(candidate.method ?? "") ||
    !allowedRoute(candidate.path, candidate.method as RuntimeMethod) ||
    (candidate.sessionToken !== undefined && (typeof candidate.sessionToken !== "string" || candidate.sessionToken.length > 4096))
  ) return undefined
  return candidate as PreviewRuntimeRequest
}

function jsonPayload(text: string): unknown {
  if (!text) return undefined
  try { return JSON.parse(text) as unknown } catch { return undefined }
}

export function createPreviewRuntimeBridge(options: BridgeOptions) {
  const fetchRuntime = options.fetchRuntime ?? fetch
  const root = `${options.apiBaseUrl.replace(/\/$/, "")}/api/runtime/projects/${encodeURIComponent(options.projectId)}`

  return async (event: Pick<MessageEvent, "source" | "origin" | "data">): Promise<void> => {
    const previewWindow = options.getPreviewWindow()
    if (!previewWindow || event.source !== previewWindow) return
    const request = parseRequest(event.data, options.projectId)
    if (!request) return
    try {
      const headers: Record<string, string> = { "content-type": "application/json", "X-Vivatom-App-Key": options.publicKey }
      if (request.sessionToken) headers.Authorization = `Bearer ${request.sessionToken}`
      const response = await fetchRuntime(root + request.path, {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      })
      previewWindow.postMessage({
        type: previewRuntimeResponseType,
        id: request.id,
        ok: response.ok,
        status: response.status,
        payload: jsonPayload(await response.text()),
      }, event.origin)
    } catch {
      previewWindow.postMessage({
        type: previewRuntimeResponseType,
        id: request.id,
        ok: false,
        status: 503,
        payload: { error: { code: "runtime_unavailable", message: "项目数据服务暂时不可用。" } },
      }, event.origin)
    }
  }
}
