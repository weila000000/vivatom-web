import { describe, expect, it, vi } from "vitest"
import { keyedSingleFlight } from "./keyed-single-flight"

describe("keyedSingleFlight", () => {
  it("shares an active task per key and allows a later retry", async () => {
    let release!: () => void
    let calls = 0
    const task = vi.fn(() => {
      calls += 1
      return calls === 1
        ? new Promise<void>((resolve) => { release = resolve })
        : Promise.resolve()
    })
    const run = keyedSingleFlight(task)

    const first = run("project-1")
    const duplicate = run("project-1")
    expect(duplicate).toBe(first)
    expect(task).toHaveBeenCalledTimes(1)

    release()
    await first
    await run("project-1")
    expect(task).toHaveBeenCalledTimes(2)
  })

  it("does not merge work for different keys", async () => {
    const task = vi.fn(async (key: string) => key)
    const run = keyedSingleFlight(task)

    await Promise.all([run("project-1"), run("project-2")])
    expect(task).toHaveBeenCalledTimes(2)
  })
})
