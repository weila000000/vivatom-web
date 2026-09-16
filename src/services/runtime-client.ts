import type { RuntimeCredentials, ProjectRuntime } from "../domain/project"
import type { BackendSpec } from "../types/agent"

type Fetcher = typeof fetch

export interface RuntimeProvisionInput {
  projectId: string
  title: string
  backend: BackendSpec
  runtime?: ProjectRuntime | RuntimeCredentials
  apiBaseUrl?: string
}

export interface RuntimeProvisionAttempt {
  credentials: RuntimeCredentials
  run(fetcher?: Fetcher, signal?: AbortSignal): Promise<ProjectRuntime | undefined>
}

export class RuntimeProvisionError extends Error {
  constructor() {
    super("项目数据服务初始化失败，请稍后重试。")
    this.name = "RuntimeProvisionError"
  }
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function provisionUrl(input: RuntimeProvisionInput): string {
  const base = (input.apiBaseUrl ?? "").replace(/\/$/, "")
  return `${base}/api/runtime/projects/${encodeURIComponent(input.projectId)}/provision`
}

export function createRuntimeProvisionAttempt(
  input: RuntimeProvisionInput,
  tokenFactory: () => string = randomToken,
): RuntimeProvisionAttempt {
  const publicKey = input.runtime?.publicKey ?? tokenFactory()
  const adminToken = input.runtime?.adminToken ?? tokenFactory()

  return {
    credentials: { publicKey, adminToken },
    async run(fetcher = fetch, signal) {
      if (!input.backend.enabled) return undefined
      try {
        const response = await fetcher(provisionUrl(input), {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "X-Vivatom-App-Key": publicKey,
            "X-Vivatom-Admin-Token": adminToken,
          },
          body: JSON.stringify({ title: input.title, backend: input.backend }),
          signal,
        })
        if (!response.ok) throw new RuntimeProvisionError()
        const payload = await response.json() as { data?: { schemaVersion?: unknown } }
        const schemaVersion = payload.data?.schemaVersion
        if (!Number.isInteger(schemaVersion) || Number(schemaVersion) < 1) {
          throw new RuntimeProvisionError()
        }
        return { publicKey, adminToken, schemaVersion: Number(schemaVersion) }
      } catch (error) {
        if (signal?.aborted) throw new DOMException("操作已中止", "AbortError")
        if (error instanceof RuntimeProvisionError) throw error
        throw new RuntimeProvisionError()
      }
    },
  }
}
