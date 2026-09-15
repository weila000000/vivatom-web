export type AgentAction = "plan" | "build" | "iterate" | "repair" | "polish"

export interface BackendSpec {
  enabled: boolean
  auth: "none" | "email_password"
  collections: Array<{
    name: string
    label: string
    access: "public" | "owner"
    fields: Array<{
      name: string
      label: string
      type: "text" | "long_text" | "number" | "boolean" | "date"
      required: boolean
    }>
  }>
}

export interface BuildPlan {
  productType: "website" | "web_app"
  productSummary: string
  targetUsers: string[]
  features: string[]
  pages: Array<{ name: string; purpose: string }>
  filePlan: Array<{ path: string; responsibility: string }>
  designDirection: string
  acceptanceChecks: string[]
  backend: BackendSpec
}

export interface ProjectSnapshot {
  source: "provider" | "template"
  title: string
  summary: string
  files: Record<string, string>
  dependencies: Record<string, string>
  entryFile: string
  backend: BackendSpec
}

export interface AgentRequest {
  action: AgentAction
  projectId: string
  approvalId?: string
  prompt?: string
  plan?: BuildPlan
  snapshot?: ProjectSnapshot
  error?: string
}

export interface AgentEvent {
  type: string
  id?: string
  agent?: string
  action?: string
  status?: "running" | "completed" | "failed"
  label?: string
  text?: string
  message?: string
  code?: string
  retryable?: boolean
  approvalId?: string
  plan?: BuildPlan
  snapshot?: ProjectSnapshot
}

export interface Version {
  id: string
  projectId: string
  parentVersionId?: string
  prompt: string
  snapshot: ProjectSnapshot
  createdAt: string
}

interface RecoveryBase {
  projectId: string
  request: AgentRequest
  createdAt: string
  updatedAt: string
  repairAttempts?: number
}

export type AgentRunRecovery =
  | (RecoveryBase & { phase: "request" })
  | (RecoveryBase & {
      phase: "snapshot"
      snapshot: ProjectSnapshot
    })
