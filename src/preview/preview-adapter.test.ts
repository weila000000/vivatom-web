import { describe, expect, it } from "vitest"
import type { SandpackMessage } from "@codesandbox/sandpack-client"
import { compileErrorMessage, isCompileSuccess } from "./preview-adapter"

describe("Sandpack terminal messages", () => {
  it("accepts successful terminal messages", () => {
    expect(isCompileSuccess({ type: "success" } as SandpackMessage)).toBe(true)
    expect(isCompileSuccess({
      type: "done",
      compilatonError: false,
    } as SandpackMessage)).toBe(true)
  })

  it("rejects compilation errors", () => {
    const message = {
      type: "done",
      compilatonError: true,
    } as SandpackMessage
    expect(isCompileSuccess(message)).toBe(false)
    expect(compileErrorMessage(message)).toBe("候选源码编译失败")
  })
})
