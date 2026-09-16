export const previewRuntimeRequestType = "vivatom:runtime-request"
export const previewRuntimeResponseType = "vivatom:runtime-response"
export const previewRuntimeReadyType = "vivatom:runtime-ready"

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
  onReady?(): void
  maxConcurrent?: number
}

interface ParsedRuntimeRequest {
  request: PreviewRuntimeRequest
  body?: string
}

interface RejectedRuntimeRequest {
  id: string
  status: number
  code: string
  message: string
}

const maxRuntimeBodyBytes = 64 * 1024

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

function parseRequest(value: unknown, projectId: string): ParsedRuntimeRequest | RejectedRuntimeRequest | undefined {
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
  const request = candidate as PreviewRuntimeRequest
  const bodyRequired = request.method === "PATCH" || (request.method === "POST" && request.path !== "/auth/logout")
  const bodyIsObject = request.body !== null && typeof request.body === "object" && !Array.isArray(request.body)
  if ((bodyRequired && !bodyIsObject) || (!bodyRequired && request.body !== undefined)) {
    return { id: request.id, status: 400, code: "invalid_request", message: "Runtime 请求内容无效。" }
  }
  if (request.body === undefined) return { request }
  try {
    const body = JSON.stringify(request.body)
    if (new TextEncoder().encode(body).byteLength > maxRuntimeBodyBytes) {
      return { id: request.id, status: 413, code: "payload_too_large", message: "Runtime 请求内容过大。" }
    }
    return { request, body }
  } catch {
    return { id: request.id, status: 400, code: "invalid_request", message: "Runtime 请求内容无效。" }
  }
}

function jsonPayload(text: string): unknown {
  if (!text) return undefined
  try { return JSON.parse(text) as unknown } catch { return undefined }
}

export function createPreviewRuntimeBridge(options: BridgeOptions) {
  const fetchRuntime = options.fetchRuntime ?? fetch
  const root = `${options.apiBaseUrl.replace(/\/$/, "")}/api/runtime/projects/${encodeURIComponent(options.projectId)}`
  const maxConcurrent = options.maxConcurrent ?? 8
  let activeRequests = 0

  return async (event: Pick<MessageEvent, "source" | "origin" | "data">): Promise<void> => {
    const previewWindow = options.getPreviewWindow()
    if (!previewWindow || event.source !== previewWindow) return
    if (event.data?.type === previewRuntimeReadyType && event.data?.projectId === options.projectId) {
      options.onReady?.()
      return
    }
    const parsed = parseRequest(event.data, options.projectId)
    if (!parsed) return
    const responseOrigin = event.origin === "null" ? "*" : event.origin
    const reject = (failure: RejectedRuntimeRequest) => previewWindow.postMessage({
      type: previewRuntimeResponseType,
      id: failure.id,
      ok: false,
      status: failure.status,
      payload: { error: { code: failure.code, message: failure.message } },
    }, responseOrigin)
    if (!("request" in parsed)) {
      reject(parsed)
      return
    }
    const { request, body } = parsed
    if (activeRequests >= maxConcurrent) {
      reject({ id: request.id, status: 429, code: "runtime_busy", message: "Runtime 请求过多，请稍后重试。" })
      return
    }
    activeRequests += 1
    try {
      const headers: Record<string, string> = { "content-type": "application/json", "X-Vivatom-App-Key": options.publicKey }
      if (request.sessionToken) headers.Authorization = `Bearer ${request.sessionToken}`
      const response = await fetchRuntime(root + request.path, {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body }),
      })
      previewWindow.postMessage({
        type: previewRuntimeResponseType,
        id: request.id,
        ok: response.ok,
        status: response.status,
        payload: jsonPayload(await response.text()),
      }, responseOrigin)
    } catch {
      previewWindow.postMessage({
        type: previewRuntimeResponseType,
        id: request.id,
        ok: false,
        status: 503,
        payload: { error: { code: "runtime_unavailable", message: "项目数据服务暂时不可用。" } },
      }, responseOrigin)
    } finally {
      activeRequests -= 1
    }
  }
}
