export type AgentAction = "plan" | "build" | "iterate" | "repair" | "race" | "polish"
export type WorkMode = "engineer" | "team" | "race"

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
  requirementBrief?: {
    goal: string
    users: string[]
    coreFlows: string[]
    constraints: string[]
  }
  productType?: "website" | "web_app"
  productSummary: string
  targetUsers: string[]
  features: string[]
  pages: Array<{ name: string; purpose: string }>
  filePlan: Array<{ path: string; responsibility: string }>
  designDirection: string
  acceptanceChecks: string[]
  backend?: BackendSpec
}

export interface ProjectSnapshot {
  source: "vibe" | "template"
  title: string
  summary: string
  files: Record<string, string>
  dependencies: Record<string, string>
  entryFile: string
  backend?: BackendSpec
}

export interface AgentRequest {
  action: AgentAction
  mode?: WorkMode
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
  candidateId?: string
  snapshotHash?: string
  plan?: BuildPlan
  snapshot?: ProjectSnapshot
  candidates?: RaceCandidate[]
}

export interface RaceCandidate {
  id: string
  direction: string
  snapshot: ProjectSnapshot
  candidateId?: string
  snapshotHash?: string
}

export interface Version {
  id: string
  projectId: string
  parentVersionId?: string
  prompt: string
  snapshot: ProjectSnapshot
  createdAt: string
  candidateId?: string
  snapshotHash?: string
  sourceAction?: AgentAction | "restore" | "local"
  approvalId?: string
  safety?: {
    policy: string
    verifiedAt: string
  }
  build?: {
    toolchain: string
    durationMs: number
    artifactId?: string
    verifiedAt?: string
  }
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
  | (RecoveryBase & { phase: "race"; candidates: RaceCandidate[] })
  | (RecoveryBase & {
      phase: "snapshot"
      snapshot: ProjectSnapshot
      candidateId?: string
      snapshotHash?: string
      runtimeCredentials?: import("../domain/project").RuntimeCredentials
    })
