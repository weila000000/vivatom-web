import { describe, expect, it } from "vitest"
import type { Version } from "../types/agent"
import { hostedVersionPreviewUrl, parseHostedPreviewTarget, versionPreviewUrl } from "./preview-url"

describe("version preview URL", () => {
  it("builds an isolated artifact URL", () => {
    const version = { build: { toolchain: "vite", durationMs: 10, artifactId: "a".repeat(64) } } as Version
    expect(versionPreviewUrl(version, "https://preview.example.com/apps/"))
      .toBe(`https://preview.example.com/apps/${"a".repeat(64)}/`)
  })

  it("uses the public preview port by default", () => {
    const version = { build: { toolchain: "vite", durationMs: 10, artifactId: "b".repeat(64) } } as Version
    expect(versionPreviewUrl(version)).toBe(`http://localhost:8091/preview/${"b".repeat(64)}/`)
  })

  it("does not expose versions without a valid artifact", () => {
    expect(versionPreviewUrl({ build: { toolchain: "vite", durationMs: 10 } } as Version)).toBeUndefined()
  })

  it("binds the hosted preview to a project and immutable artifact", () => {
    const version = { build: { toolchain: "vite", durationMs: 10, artifactId: "c".repeat(64) } } as Version
    expect(hostedVersionPreviewUrl(version, "project / one", "public/key"))
      .toBe(`/preview?artifact=${"c".repeat(64)}#project=project+%2F+one&key=public%2Fkey`)
  })

  it("keeps frontend-only previews free of Runtime credentials", () => {
    const version = { build: { toolchain: "vite", durationMs: 10, artifactId: "d".repeat(64) } } as Version
    expect(hostedVersionPreviewUrl(version, "project-1"))
      .toBe(`/preview?artifact=${"d".repeat(64)}#project=project-1`)
  })

  it("parses a shareable preview without requiring local project storage", () => {
    expect(parseHostedPreviewTarget(
      `?artifact=${"e".repeat(64)}`,
      "#project=project-1&key=public-key",
      "https://preview.example.com/apps/",
    )).toEqual({ artifactUrl: `https://preview.example.com/apps/${"e".repeat(64)}/`, projectId: "project-1", publicKey: "public-key" })
  })

  it("rejects malformed artifact and oversized capability values", () => {
    expect(parseHostedPreviewTarget("?artifact=not-a-hash", "#project=project-1")).toBeUndefined()
    expect(parseHostedPreviewTarget(`?artifact=${"f".repeat(64)}`, `#project=${"p".repeat(201)}`)).toBeUndefined()
    expect(parseHostedPreviewTarget(`?artifact=${"f".repeat(64)}`, `#project=project-1&key=${"k".repeat(513)}`)).toBeUndefined()
  })
})
