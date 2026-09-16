import { reactive } from "vue"
import { describe, expect, it } from "vitest"
import { cloneJson } from "./clone-json"

describe("cloneJson", () => {
  it("detaches nested Vue proxies into structured-cloneable data", () => {
    const source = reactive({ request: { snapshot: { files: { "/src/main.ts": "source" } } } })
    const clone = cloneJson(source.request)

    expect(() => structuredClone(clone)).not.toThrow()
    source.request.snapshot.files["/src/main.ts"] = "changed"
    expect(clone.snapshot.files["/src/main.ts"]).toBe("source")
  })
})
