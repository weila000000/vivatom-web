import { onBeforeUnmount, ref } from "vue"
import {
  createProject,
  transitionProject,
  type Project,
  type ProjectCommand,
  type ProjectStatus,
} from "../domain/project"
import { projectRepository } from "../db/project-repository"
import {
  guardSnapshot,
  SnapshotRejectedError,
} from "../generation/snapshot-guard"
import { AgentTransportError, runAgent } from "../services/agent-client"
import { approveWorkspacePlan, commitBuildCandidate, fetchPendingBuildCandidate, PlatformError, restageWorkspaceVersion } from "../services/platform-client"
import { createRuntimeProvisionAttempt, RuntimeProvisionError } from "../services/runtime-client"
import type {
  AgentEvent,
  AgentRequest,
  AgentRunRecovery,
  BuildPlan,
  ProjectSnapshot,
  Version,
} from "../types/agent"
import { createVersion } from "../versions/version-service"
import { cloneJson } from "../utils/clone-json"
import { keyedSingleFlight } from "../utils/keyed-single-flight"

export function useAgentRun(token: () => string, workspaceId: () => string, onUsageChanged?: () => void) {
  const project = ref<Project>()
  const events = ref<AgentEvent[]>([])
  const plan = ref<BuildPlan>()
  const candidateSnapshot = ref<ProjectSnapshot>()
  const activeVersion = ref<Version>()
  const versions = ref<Version[]>([])
  const running = ref(false)
  const error = ref("")
  const restoring = ref(true)
  const projectPrompt = ref("")
  const recovery = ref<AgentRunRecovery>()
  const repairAttempts = ref(0)
	const maxAutomaticRepairs = 2
	const maxCompileWaits = 120
  let controller: AbortController | undefined

  async function transition(command: ProjectCommand, changes: Partial<Project> = {}) {
    if (!project.value) throw new Error("项目尚未创建")
    const next = { ...transitionProject(project.value, command), ...changes }
    await projectRepository.saveProject(next)
    project.value = next
  }

  async function execute(request: AgentRequest, attempts = 0) {
    controller?.abort()
    const activeController = new AbortController()
    controller = activeController
    events.value = []
    error.value = ""
    running.value = true
    recovery.value = await projectRepository.saveRequestRecovery(
      request.projectId,
      request,
      attempts,
    )

    try {
      for await (const event of runAgent(request, workspaceId(), token(), activeController.signal)) {
        events.value.push(event)
        await projectRepository.addAgentEvent(request.projectId, event)
        if (event.type === "approval.required" && event.plan) {
          if (!event.approvalId) {
            error.value = "方案审批凭证缺失，请重新生成方案。"
            await failActiveProject()
          } else {
            plan.value = event.plan
            await transition("plan_ready", { plan: event.plan, approvalId: event.approvalId })
            await projectRepository.clearRecovery(request.projectId)
            recovery.value = undefined
          }
        }
        if (event.type === "snapshot.completed" && event.snapshot) {
          try {
            if (!event.candidateId || !event.snapshotHash) {
              throw new Error("candidate receipt missing")
            }
            candidateSnapshot.value = guardSnapshot(event.snapshot)
            recovery.value = await projectRepository.saveSnapshotRecovery(
              request.projectId,
              request,
              candidateSnapshot.value,
              attempts,
              { candidateId: event.candidateId, snapshotHash: event.snapshotHash },
            )
            await commitCandidate(
              candidateSnapshot.value,
              request.prompt ?? request.error ?? projectPrompt.value,
            )
          } catch (cause) {
            error.value =
              cause instanceof SnapshotRejectedError
                ? "候选源码未通过浏览器安全检查。"
                : "候选源码无法验证。"
            events.value.push({
              type: "error",
              code: "snapshot_rejected",
              message: error.value,
              retryable: true,
            })
            await failActiveProject()
          }
        }
        if (event.type === "error") {
          error.value = event.message ?? "Agent 运行失败"
          await failActiveProject()
        }
      }
    } catch (cause) {
      if (activeController.signal.aborted) return
      error.value =
        cause instanceof AgentTransportError ? cause.message : "无法完成 Agent 运行"
      await failActiveProject()
    } finally {
      if (controller === activeController) running.value = false
	  onUsageChanged?.()
    }
  }

  async function failActiveProject() {
    if (project.value?.status === "planning" || project.value?.status === "building") {
      await transition("fail")
    }
  }

  async function startPlan(prompt: string, workspaceId?: string) {
	repairAttempts.value = 0
    if (!project.value) {
      project.value = createProject(prompt, workspaceId)
      await projectRepository.createWithMessage(project.value, prompt)
      await transition("start_plan")
    } else if (project.value.status === "draft") {
      await transition("start_plan")
      await projectRepository.addUserMessage(project.value.id, prompt)
    } else if (project.value.status === "awaiting_approval") {
      await transition("revise_plan")
      await projectRepository.addUserMessage(project.value.id, prompt)
    } else if (project.value.status === "error") {
      await transition("retry_plan")
      await projectRepository.addUserMessage(project.value.id, prompt)
    } else {
      throw new Error(`项目处于 ${project.value.status}，不能开始规划`)
    }
    plan.value = undefined
    if (project.value.approvalId) {
      project.value = { ...project.value, approvalId: undefined }
      await projectRepository.saveProject(project.value)
    }
    candidateSnapshot.value = undefined
    projectPrompt.value = prompt
    await execute({ action: "plan", projectId: project.value.id, prompt })
  }

  async function approveAndBuild(prompt: string) {
    if (!project.value || !plan.value || !project.value.approvalId) {
      throw new Error("没有可批准的方案")
    }
    await approveWorkspacePlan(workspaceId(), project.value.id, project.value.approvalId, token())
    await transition("approve")
    candidateSnapshot.value = undefined
	repairAttempts.value = 0
    const buildPrompt = prompt.trim() || projectPrompt.value
    await execute({
      action: "build",
      projectId: project.value.id,
      approvalId: project.value.approvalId,
      prompt: buildPrompt,
    })
  }

  async function revise(action: "iterate" | "repair" | "polish", instruction: string) {
    if (!project.value || project.value.status !== "ready" || !activeVersion.value) throw new Error("当前没有可修改的正式版本")
    const value = instruction.trim()
    if (!value) throw new Error("请先说明本轮修改目标")
    await transition("start_iteration")
    await projectRepository.addUserMessage(project.value.id, value)
    candidateSnapshot.value = undefined
	repairAttempts.value = 0
    projectPrompt.value = value
    await execute(action === "repair"
      ? { action, projectId: project.value.id, error: value, snapshot: activeVersion.value.snapshot }
      : { action, projectId: project.value.id, prompt: value, snapshot: activeVersion.value.snapshot })
  }

  async function restoreVersion(versionId: string) {
    if (!project.value || project.value.status !== "ready" || !activeVersion.value) throw new Error("当前没有可恢复的正式版本")
    const source = versions.value.find((version) => version.id === versionId)
    if (!source) throw new Error("找不到要恢复的版本")
    if (source.id === activeVersion.value.id) return
    const staged = await restageWorkspaceVersion(workspaceId(), project.value.id, source.id, token())
    const instruction = staged.prompt
    await transition("start_iteration")
    await projectRepository.addUserMessage(project.value.id, instruction)
    repairAttempts.value = 0
    error.value = ""
    events.value = [{ type: "action.status", action: "restore", status: "completed", label: "历史快照已载入，正在重新验证" }]
    projectPrompt.value = instruction
    candidateSnapshot.value = guardSnapshot(staged.snapshot)
    const request: AgentRequest = { action: "repair", projectId: project.value.id, error: instruction, snapshot: staged.snapshot }
    recovery.value = await projectRepository.saveSnapshotRecovery(project.value.id, request, candidateSnapshot.value, 0, { candidateId: staged.candidateId, snapshotHash: staged.snapshotHash })
    await commitCandidate(candidateSnapshot.value, instruction)
  }

  async function commitCandidate(snapshot: ProjectSnapshot, prompt: string) {
    if (
      !project.value ||
      project.value.status !== "building" ||
      candidateSnapshot.value !== snapshot
    ) {
      return
    }
    const versionPrompt = prompt.trim() || projectPrompt.value
    const candidateReceipt = recovery.value?.phase === "snapshot" && recovery.value.candidateId && recovery.value.snapshotHash
      ? { candidateId: recovery.value.candidateId, snapshotHash: recovery.value.snapshotHash }
      : undefined
    try {
      let version: Version
      if (candidateReceipt) {
        const compiling: AgentEvent = { type: "action.status", id: "compile", agent: "compiler", action: "compile_snapshot", status: "running", label: "正在隔离环境中编译候选源码" }
        events.value.push(compiling)
        await projectRepository.addAgentEvent(project.value.id, compiling)
        let waits = 0
        while (true) {
          try {
            version = await commitBuildCandidate(workspaceId(), project.value.id, candidateReceipt.candidateId, token(), {
              snapshotHash: candidateReceipt.snapshotHash,
              parentVersionId: activeVersion.value?.candidateId ? activeVersion.value.id : undefined,
              prompt: versionPrompt,
            })
            error.value = ""
            break
          } catch (cause) {
            if (!(cause instanceof PlatformError) || cause.code !== "compile_in_progress" || waits >= maxCompileWaits) {
              throw cause
            }
            waits += 1
            error.value = "候选源码正在隔离编译，等待验证结果..."
            await new Promise((resolve) => window.setTimeout(resolve, 1_000))
            if (project.value?.status !== "building" || candidateSnapshot.value !== snapshot) return
          }
        }
        const compiled: AgentEvent = { type: "action.status", id: "compile", agent: "compiler", action: "compile_snapshot", status: "completed", label: `隔离编译通过 · ${version.build?.durationMs ?? 0} ms` }
        events.value.push(compiled)
        await projectRepository.addAgentEvent(project.value.id, compiled)
      } else {
        version = createVersion({
            projectId: project.value.id,
            parentVersionId: activeVersion.value?.id,
            prompt: versionPrompt,
            snapshot,
          })
      }
      let runtime = project.value.runtime
      if (snapshot.backend.enabled) {
        const attempt = createRuntimeProvisionAttempt({
          projectId: project.value.id,
          title: snapshot.title,
          backend: snapshot.backend,
          runtime: recovery.value?.phase === "snapshot" && recovery.value.runtimeCredentials
            ? recovery.value.runtimeCredentials
            : runtime,
        })
        if (recovery.value?.phase === "snapshot" && !recovery.value.runtimeCredentials) {
          recovery.value = await projectRepository.saveSnapshotRecovery(
            recovery.value.projectId,
            recovery.value.request,
            recovery.value.snapshot,
            recovery.value.repairAttempts ?? 0,
            {
              candidateId: recovery.value.candidateId!,
              snapshotHash: recovery.value.snapshotHash!,
              runtimeCredentials: attempt.credentials,
            },
          )
        }
        runtime = await attempt.run()
      }
      const readyProject = {
        ...transitionProject(project.value, "build_succeeded"),
        activeVersionId: version.id,
        ...(runtime ? { runtime } : {}),
      }
      await projectRepository.commitVersion(readyProject, version)
      versions.value.push(version)
      activeVersion.value = version
      project.value = readyProject
      recovery.value = undefined
    } catch (cause) {
      if (cause instanceof PlatformError && cause.code === "compile_failed") {
        await rejectCandidate(cause.message)
        return
      }
      error.value = cause instanceof PlatformError && cause.code === "version_conflict"
        ? cause.message
        : cause instanceof RuntimeProvisionError
          ? cause.message
          : "版本保存失败，候选源码没有被提交。"
      if (cause instanceof PlatformError && cause.code === "version_conflict") {
        candidateSnapshot.value = undefined
        recovery.value = undefined
        await projectRepository.clearRecovery(project.value.id)
      }
      await transition("fail")
    }
  }

  async function rejectCandidate(message: string) {
    if (project.value?.status !== "building") return
	const diagnostic = message.trim().slice(0, 4000) || "候选源码编译失败"
	if (candidateSnapshot.value && repairAttempts.value < maxAutomaticRepairs) {
		const failedSnapshot = candidateSnapshot.value
		repairAttempts.value += 1
		error.value = `编译失败，正在自动修复（${repairAttempts.value}/${maxAutomaticRepairs}）`
		candidateSnapshot.value = undefined
		await execute({ action: "repair", projectId: project.value.id, error: diagnostic, snapshot: failedSnapshot }, repairAttempts.value)
		return
	}
    error.value = `${diagnostic}。自动修复次数已用完，请调整要求后重试。`
    if (recovery.value) {
      recovery.value = await projectRepository.saveRequestRecovery(
        recovery.value.projectId,
        recovery.value.request,
		repairAttempts.value,
      )
    }
    await transition("fail")
  }

  async function cancel() {
    controller?.abort()
    if (project.value?.status === "planning" || project.value?.status === "building") {
      error.value = "任务已停止，可以重新开始。"
      await transition("fail")
      await projectRepository.clearRecovery(project.value.id)
      recovery.value = undefined
    }
  }

  async function retryRecovery() {
    if (!project.value || project.value.status !== "error" || !recovery.value) {
      return
    }
    const request = cloneJson(recovery.value.request)
    repairAttempts.value = recovery.value.repairAttempts ?? 0
    if (recovery.value.phase === "snapshot" && recovery.value.candidateId && recovery.value.snapshotHash) {
      await transition("retry_build")
      const snapshot = guardSnapshot(recovery.value.snapshot)
      candidateSnapshot.value = snapshot
      await commitCandidate(snapshot, request.prompt ?? request.error ?? projectPrompt.value)
      return
    }
    if (request.action === "plan") {
      await transition("retry_plan")
    } else {
      await transition("retry_build")
    }
    candidateSnapshot.value = undefined
    await execute(request, repairAttempts.value)
  }

  async function restoreLatest(workspaceId?: string) {
    restoring.value = true
    try {
      const restored = await projectRepository.restoreLatest(workspaceId)
      if (!restored) return false
      if (workspaceId && !restored.project.workspaceId) {
        restored.project = { ...restored.project, workspaceId }
        await projectRepository.saveProject(restored.project)
      }
      await applyRestored(restored)
      return true
    } finally {
      restoring.value = false
    }
  }

  async function restoreProject(projectId: string) {
    restoring.value = true
    try {
      const restored = await projectRepository.restore(projectId)
      if (!restored) return false
      await applyRestored(restored)
      return true
    } finally {
      restoring.value = false
    }
  }

  async function applyRestored(restored: NonNullable<Awaited<ReturnType<typeof projectRepository.restore>>>) {
      project.value = restored.project
      plan.value = restored.project.plan
      versions.value = restored.versions
      activeVersion.value = restored.activeVersion
      candidateSnapshot.value = restored.activeVersion?.snapshot
      recovery.value = restored.recovery
	  repairAttempts.value = restored.recovery?.repairAttempts ?? 0
      projectPrompt.value =
        restored.messages.filter((message) => message.role === "user").at(-1)?.content ?? ""
      events.value = restored.messages
        .filter((message) => message.role === "agent")
        .map((message) => ({
          type: message.eventType ?? "agent.output",
          agent: message.agent,
          action: message.action,
          status: message.status as AgentEvent["status"],
          message: message.content,
        }))
      if (restored.recovery?.phase === "snapshot") {
        if (project.value.status === "error") {
          await transition("retry_build")
        } else if (project.value.status !== "building") {
          const resumed = { ...project.value, status: "building" as const, updatedAt: new Date().toISOString() }
          await projectRepository.saveProject(resumed)
          project.value = resumed
        }
        const snapshot = guardSnapshot(restored.recovery.snapshot)
        candidateSnapshot.value = snapshot
        error.value = ""
        const resumePrompt = restored.recovery.request.prompt ?? restored.recovery.request.error ?? projectPrompt.value
        queueMicrotask(() => { void commitCandidate(snapshot, resumePrompt) })
      } else if (restored.recovery?.phase === "request") {
        if (project.value.status === "planning" || project.value.status === "building") {
          await transition("fail")
        }
        error.value = "上次任务被页面刷新中断，可以从检查点重试。"
      } else if (project.value.status !== "ready") {
        queueMicrotask(() => { void resumeServerCandidate() })
      }
  }

  const recoverServerCandidate = keyedSingleFlight(async (projectId: string) => {
    const requestedWorkspaceId = workspaceId()
    if (!project.value || project.value.id !== projectId || recovery.value || project.value.status === "ready") return
    let pending
    try {
      pending = await fetchPendingBuildCandidate(requestedWorkspaceId, projectId, token())
    } catch (cause) {
      if (cause instanceof PlatformError && cause.code === "candidate_not_found") return
      if (project.value?.id !== projectId || workspaceId() !== requestedWorkspaceId) return
      error.value = cause instanceof Error ? cause.message : "无法恢复云端候选源码"
      return
    }
    const current = project.value
    if (!current || current.id !== projectId || workspaceId() !== requestedWorkspaceId || recovery.value || (current.status as ProjectStatus) === "ready") return
    if (current.status !== "building") {
      const resumed = { ...current, status: "building" as const, updatedAt: new Date().toISOString() }
      await projectRepository.saveProject(resumed)
      if (project.value?.id !== projectId || workspaceId() !== requestedWorkspaceId) return
      project.value = resumed
    }
    let snapshot: ProjectSnapshot
    try {
      snapshot = guardSnapshot(pending.snapshot)
    } catch {
      error.value = "云端候选源码未通过安全检查，无法恢复。"
      return
    }
    candidateSnapshot.value = snapshot
    projectPrompt.value = pending.prompt
    const request: AgentRequest = { action: "repair", projectId, error: pending.prompt, snapshot }
    const restoredRecovery = await projectRepository.saveSnapshotRecovery(projectId, request, snapshot, 0, {
      candidateId: pending.candidateId,
      snapshotHash: pending.snapshotHash,
    })
    if (project.value?.id !== projectId || workspaceId() !== requestedWorkspaceId) return
    recovery.value = restoredRecovery
    const resumed: AgentEvent = { type: "action.status", id: "candidate-recovered", agent: "compiler", action: "recover_candidate", status: "completed", label: "已从云端恢复候选源码" }
    events.value.push(resumed)
    await projectRepository.addAgentEvent(projectId, resumed)
    if (project.value?.id !== projectId || workspaceId() !== requestedWorkspaceId) return
    await commitCandidate(snapshot, pending.prompt)
  })

  async function resumeServerCandidate() {
    if (!project.value || recovery.value || project.value.status === "ready") return
    await recoverServerCandidate(project.value.id)
  }

  async function setCloudState(revision: number, contentHash: string) {
    if (!project.value || (project.value.cloudRevision === revision && project.value.cloudContentHash === contentHash)) return
    const next = await projectRepository.saveCloudState(project.value.id, revision, contentHash)
    if (next) project.value = next
  }

  function clearWorkspace() {
    controller?.abort()
    project.value = undefined
    events.value = []
    plan.value = undefined
    candidateSnapshot.value = undefined
    activeVersion.value = undefined
    versions.value = []
    error.value = ""
    projectPrompt.value = ""
    recovery.value = undefined
	repairAttempts.value = 0
  }

  onBeforeUnmount(() => controller?.abort())
  return {
    project,
    events,
    plan,
    candidateSnapshot,
    activeVersion,
    versions,
    running,
    error,
    restoring,
    projectPrompt,
    recovery,
	repairAttempts,
    startPlan,
    approveAndBuild,
	revise,
    restoreVersion,
    cancel,
    retryRecovery,
    restoreLatest,
    restoreProject,
    clearWorkspace,
    setCloudState,
  }
}
