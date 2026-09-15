import { describe, expect, it } from "vitest"
import { AgentTransportError, parseSSE } from "./agent-client"

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

describe("parseSSE", () => {
  it("parses events split across arbitrary network chunks", async () => {
    const stream = streamFrom([
      'event: agent.st',
      'arted\ndata: {"type":"agent.started","message":"开始"}\n',
      '\nevent: done\ndata: {"type":"done"}\n\n',
    ])
    const events = []
    for await (const event of parseSSE(stream)) events.push(event)

    expect(events).toEqual([
      { type: "agent.started", message: "开始" },
      { type: "done" },
    ])
  })

  it("rejects a mismatched event name and payload type", async () => {
    const stream = streamFrom([
      'event: done\ndata: {"type":"agent.started"}\n\n',
    ])
    const read = async () => {
      for await (const _event of parseSSE(stream)) {
        // Consume the stream.
      }
    }
    await expect(read()).rejects.toBeInstanceOf(AgentTransportError)
  })
})
