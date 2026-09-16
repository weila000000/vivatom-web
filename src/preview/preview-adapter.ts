import {
  loadSandpackClient,
  type SandpackClient,
  type SandpackMessage,
} from "@codesandbox/sandpack-client"
import { guardSnapshot } from "../generation/snapshot-guard"
import type { ProjectSnapshot } from "../types/agent"

export interface PreviewAdapter {
  compile(
    iframe: HTMLIFrameElement,
    snapshot: ProjectSnapshot,
    signal: AbortSignal,
  ): Promise<void>
  dispose(): void
}

export function isCompileSuccess(message: SandpackMessage): boolean {
  if (message.type === "success") return true
  return (
    message.type === "done" &&
    message.compilatonError !== true &&
    ("compilationError" in message ? message.compilationError !== true : true)
  )
}

export function compileErrorMessage(message: SandpackMessage): string | undefined {
  if (message.type === "done" && message.compilatonError) {
    return "候选源码编译失败"
  }
  if (message.type === "action" && message.action === "show-error") {
    return (message.message || "候选源码编译失败").trim().slice(0, 4000)
  }
  return undefined
}

export class SandpackPreviewAdapter implements PreviewAdapter {
  private client?: SandpackClient

  async compile(
    iframe: HTMLIFrameElement,
    input: ProjectSnapshot,
    signal: AbortSignal,
  ): Promise<void> {
    this.dispose()
    const snapshot = guardSnapshot(input)
    const files = Object.fromEntries(
      Object.entries(snapshot.files).map(([path, code]) => [path, { code }]),
    )
    const client = await loadSandpackClient(
      iframe,
      {
        files,
        entry: snapshot.entryFile,
        dependencies: snapshot.dependencies,
		template: "create-react-app-typescript",
      },
      {
        showOpenInCodeSandbox: false,
        showErrorScreen: true,
        showLoadingScreen: true,
      },
    )
    this.client = client

    await new Promise<void>((resolve, reject) => {
      let settled = false
      let unsubscribe: () => void = () => {}
      let timeout = 0
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        unsubscribe()
        signal.removeEventListener("abort", abort)
        callback()
      }
      const abort = () => finish(() => reject(signal.reason))
      unsubscribe = client.listen((message) => {
        const compileError = compileErrorMessage(message)
        if (compileError) finish(() => reject(new Error(compileError)))
        else if (isCompileSuccess(message)) finish(resolve)
      })
      timeout = window.setTimeout(
        () => finish(() => reject(new Error("预览编译超时"))),
        45_000,
      )
      signal.addEventListener("abort", abort, { once: true })
      if (signal.aborted) abort()
    })
  }

  dispose() {
    this.client?.destroy()
    this.client = undefined
  }
}
