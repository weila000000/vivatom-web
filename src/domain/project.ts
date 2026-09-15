import type { BuildPlan } from "../types/agent"

export type ProjectStatus =
  | "draft"
  | "planning"
  | "awaiting_approval"
  | "building"
  | "ready"
  | "error"

export type ProjectCommand =
  | "start_plan"
  | "plan_ready"
  | "revise_plan"
  | "approve"
  | "build_succeeded"
  | "start_iteration"
  | "fail"
  | "retry_plan"
  | "retry_build"

export interface Project {
  id: string
  workspaceId?: string
  title: string
  status: ProjectStatus
  plan?: BuildPlan
  approvalId?: string
  activeVersionId?: string
  cloudRevision?: number
  cloudContentHash?: string
  createdAt: string
  updatedAt: string
}

const transitions: Record<ProjectStatus, Partial<Record<ProjectCommand, ProjectStatus>>> = {
  draft: { start_plan: "planning" },
  planning: { plan_ready: "awaiting_approval", fail: "error" },
  awaiting_approval: {
    revise_plan: "planning",
    approve: "building",
    fail: "error",
  },
  building: { build_succeeded: "ready", fail: "error" },
  ready: { start_iteration: "building" },
  error: { retry_plan: "planning", retry_build: "building" },
}

export function createProject(title: string, workspaceId?: string): Project {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    workspaceId,
    title: title.trim() || "未命名项目",
    status: "draft",
    createdAt: now,
    updatedAt: now,
  }
}

export function transitionProject(project: Project, command: ProjectCommand): Project {
  const status = transitions[project.status][command]
  if (!status) {
    throw new Error(`项目处于 ${project.status} 时不能执行 ${command}`)
  }
  return { ...project, status, updatedAt: new Date().toISOString() }
}
