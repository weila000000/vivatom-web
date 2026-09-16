import type { AgentEvent, AgentRequest } from "../types/agent"

export class AgentTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message)
    this.name = "AgentTransportError"
  }
}

function parseBlock(block: string): AgentEvent | undefined {
  const lines = block.split("\n")
  const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim()
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")

  if (!eventName && !data) return undefined
  if (!eventName || !data) {
    throw new AgentTransportError("invalid_sse", "收到不完整的 Agent 事件")
  }

  const event = JSON.parse(data) as AgentEvent
  if (event.type !== eventName) {
    throw new AgentTransportError("invalid_sse", "Agent 事件名称不一致")
  }
  return event
}

export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let sawDone = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n")
      let boundary = buffer.indexOf("\n\n")
      while (boundary >= 0) {
        const event = parseBlock(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        if (event) {
          if (sawDone) {
            throw new AgentTransportError("invalid_sse", "Agent 在终止后继续发送事件")
          }
          if (event.type === "done") sawDone = true
          yield event
        }
        boundary = buffer.indexOf("\n\n")
      }
    }
    const tail = buffer.trim()
    if (tail) {
      const event = parseBlock(tail)
      if (event) {
        if (sawDone) {
          throw new AgentTransportError("invalid_sse", "Agent 在终止后继续发送事件")
        }
        if (event.type === "done") sawDone = true
        yield event
      }
    }
    if (!sawDone) {
      throw new AgentTransportError("incomplete_stream", "Agent 事件流意外中断，请重试")
    }
  } finally {
    reader.releaseLock()
  }
}

export async function* runAgent(
  request: AgentRequest,
  workspaceId: string,
  token: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const response = await fetch(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/agent`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string | { code?: string; message?: string }
      message?: string
    }
    throw new AgentTransportError(
      typeof payload.error === "string" ? payload.error : payload.error?.code ?? "transport_error",
      payload.message ?? (typeof payload.error === "object" ? payload.error?.message : undefined) ?? "Agent 请求失败",
      response.status,
    )
  }
  if (!response.body) {
    throw new AgentTransportError("empty_stream", "Agent 没有返回事件流", response.status)
  }
  yield* parseSSE(response.body)
}
