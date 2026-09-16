<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { Download, ExternalLink, FileCode2, History, RotateCcw } from "@lucide/vue"
import PreviewPane from "./PreviewPane.vue"
import { useAgentRun } from "../composables/useAgentRun"
import { checkServer, type HealthState } from "../services/health"
import { fetchWorkspaceProjectDocument, PlatformError, recordProjectConflictResolution, saveWorkspaceProjectDocument, syncWorkspaceProject } from "../services/platform-client"
import { projectRepository, type ProjectSyncConflict } from "../db/project-repository"
import { guardSnapshot } from "../generation/snapshot-guard"
import { cloneAsConflictCopy, summarizeConflict } from "../services/project-conflict"
import type { Version } from "../types/agent"
import { archiveFilename, buildVersionArchive } from "../versions/artifact-export"
import { versionPreviewUrl } from "../versions/preview-url"

const props = defineProps<{ token: string; workspaceId: string; selectedProjectId?: string }>()
const emit = defineEmits<{ catalogChanged: [projectId: string]; usageChanged: [] }>()

const prompt = ref("")
const health = ref<HealthState>("checking")
const controller = new AbortController()
const {
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
} = useAgentRun(() => props.token, () => props.workspaceId, () => emit("usageChanged"))
const activePreviewUrl = computed(() => activeVersion.value ? versionPreviewUrl(activeVersion.value) : undefined)
const remoteOnly = ref(false)
const catalogError = ref("")
const conflict = ref<ProjectSyncConflict>()
const resolvingConflict = ref(false)
const selectedSourcePath = ref("")
let syncPaused = true
let syncQueue = Promise.resolve()
const conflictSummary = computed(() => conflict.value ? summarizeConflict(conflict.value.localPayload, conflict.value.cloudDocument.payload) : undefined)
const sourcePaths = computed(() => Object.keys(activeVersion.value?.snapshot.files ?? {}).sort())
const selectedSource = computed(() => activeVersion.value?.snapshot.files[selectedSourcePath.value] ?? "")
const requirementChanged = computed(() => prompt.value.trim() !== projectPrompt.value.trim())
const projectSyncSignature = computed(() => {
  const value = project.value
  if (!value) return ""
  return JSON.stringify({
    id: value.id,
    workspaceId: value.workspaceId,
    title: value.title,
    status: value.status,
    plan: value.plan,
    approvalId: value.approvalId,
    activeVersionId: value.activeVersionId,
    updatedAt: value.updatedAt,
  })
})
const canStartPlan = computed(
  () =>
    !running.value &&
    (!project.value ||
      project.value.status === "draft" ||
      project.value.status === "awaiting_approval" ||
      project.value.status === "error"),
)

const agentNames: Record<string, string> = {
  mike: "产品分析",
  ava: "方案架构",
  bob: "前端工程",
  lin: "数据工程",
  sam: "质量审查",
  compiler: "构建验证",
}

function agentName(agent?: string) {
  return agent ? agentNames[agent] ?? agent : "系统"
}

function provenanceLabel(version: Version) {
  const labels: Record<NonNullable<Version["sourceAction"]>, string> = {
    plan: "方案生成",
    build: "审批构建",
    iterate: "功能迭代",
    repair: "问题修复",
    polish: "体验打磨",
    restore: "历史恢复",
    local: "本地版本",
  }
  const label = version.sourceAction ? labels[version.sourceAction] : "旧版本"
  return version.approvalId ? `${label} · 审批 ${version.approvalId.slice(0, 12)}` : label
}

onMounted(async () => {
  const [, serverHealth] = await Promise.all([
    restoreLatest(props.workspaceId),
    checkServer(controller.signal),
  ])
  health.value = serverHealth
  if (!prompt.value) prompt.value = projectPrompt.value
  if (project.value) conflict.value = await projectRepository.getConflict(project.value.id)
  syncPaused = false
  if (project.value && !conflict.value) queueSync(project.value.id)
})

watch(() => props.workspaceId, async () => {
  syncPaused = true
  remoteOnly.value = false
  conflict.value = undefined
  clearWorkspace()
  await restoreLatest(props.workspaceId)
  if (project.value) conflict.value = await projectRepository.getConflict(project.value.id)
  syncPaused = false
  if (project.value && !conflict.value) queueSync(project.value.id)
})

watch(() => props.selectedProjectId, async (projectId) => {
  if (!projectId) {
    remoteOnly.value = false
    clearWorkspace()
    return
  }
  await openProject(projectId)
})

watch(activeVersion, (version) => { selectedSourcePath.value = version?.snapshot.entryFile ?? "" }, { immediate: true })

async function openProject(projectId: string) {
  syncPaused = true
  const localFound = await restoreProject(projectId)
  if (localFound && project.value?.workspaceId !== props.workspaceId) {
    clearWorkspace()
  }
  try {
    const savedConflict = await projectRepository.getConflict(projectId)
    if (savedConflict) {
      conflict.value = savedConflict
      remoteOnly.value = false
      return
    }
    const document = await fetchWorkspaceProjectDocument(props.workspaceId, projectId, props.token)
    if (!project.value || (project.value.cloudRevision ?? 0) < document.revision) {
      const payload = {
        ...document.payload,
        versions: document.payload.versions.map((version) => ({ ...version, snapshot: guardSnapshot(version.snapshot) })),
      }
      await projectRepository.importDocument(payload, document.revision, document.contentHash)
      await restoreProject(projectId)
    }
    remoteOnly.value = false
    conflict.value = undefined
    catalogError.value = ""
  } catch (cause) {
    if (project.value) return
    remoteOnly.value = true
    catalogError.value = cause instanceof PlatformError && cause.code !== "document_not_found" ? cause.message : ""
  } finally {
    syncPaused = false
    if (project.value && !conflict.value) queueSync(project.value.id)
  }
}

watch(projectSyncSignature, () => {
  const value = project.value
  if (!value || syncPaused || resolvingConflict.value || conflict.value?.projectId === value.id || !props.workspaceId || value.workspaceId !== props.workspaceId) return
  queueSync(value.id)
})

function queueSync(projectId: string) {
  syncQueue = syncQueue.then(async () => {
    const restored = await projectRepository.restore(projectId)
    const value = restored?.project
    const payload = await projectRepository.exportDocument(projectId)
    if (value && payload) {
      if (!value.cloudRevision) await syncWorkspaceProject(props.workspaceId, props.token, value)
      const document = await saveWorkspaceProjectDocument(props.workspaceId, projectId, props.token, value.cloudRevision ?? 0, payload)
      await setCloudState(document.revision, document.contentHash)
      await syncWorkspaceProject(props.workspaceId, props.token, value)
    }
    catalogError.value = ""
    emit("catalogChanged", projectId)
  }).catch(async (cause) => {
    if (cause instanceof PlatformError && cause.code === "document_conflict") {
      await captureConflict(projectId)
      return
    }
    if (cause instanceof PlatformError && cause.code === "immutable_version_violation") {
      catalogError.value = "云端拒绝改写已发布版本，请从正式版本创建新的修改。"
      return
    }
    catalogError.value = cause instanceof PlatformError
      ? `云端同步失败：${cause.message}`
      : "项目已保存在此设备，云端同步将在网络恢复后重试。"
  })
}

async function captureConflict(projectId: string) {
  try {
    const [localPayload, cloudDocument] = await Promise.all([
      projectRepository.exportDocument(projectId),
      fetchWorkspaceProjectDocument(props.workspaceId, projectId, props.token),
    ])
    if (!localPayload) return
    const record = { projectId, workspaceId: props.workspaceId, localPayload, cloudDocument, createdAt: new Date().toISOString() }
    await projectRepository.saveConflict(record)
    conflict.value = record
    catalogError.value = ""
  } catch {
    catalogError.value = "检测到云端冲突，但暂时无法下载对方版本。"
  }
}

async function preserveCopy(payload: ProjectSyncConflict["localPayload"]) {
  const copy = cloneAsConflictCopy(payload)
  await projectRepository.importLocalCopy(copy)
  await syncWorkspaceProject(props.workspaceId, props.token, copy.project)
  const saved = await saveWorkspaceProjectDocument(props.workspaceId, copy.project.id, props.token, 0, copy)
  await projectRepository.saveCloudState(copy.project.id, saved.revision, saved.contentHash)
  return copy.project.id
}

async function resolveWithCloud() {
  if (!conflict.value) return
  resolvingConflict.value = true
  try {
    const current = conflict.value
    await preserveCopy(current.localPayload)
	await recordProjectConflictResolution(props.workspaceId, current.projectId, props.token, "cloud")
    await projectRepository.importDocument(current.cloudDocument.payload, current.cloudDocument.revision, current.cloudDocument.contentHash)
    await projectRepository.clearConflict(current.projectId)
    conflict.value = undefined
    await restoreProject(current.projectId)
    emit("catalogChanged", current.projectId)
  } catch {
    catalogError.value = "冲突处理未完成，两份内容仍已保留。"
  } finally {
    resolvingConflict.value = false
  }
}

async function resolveWithLocal() {
  if (!conflict.value) return
  resolvingConflict.value = true
  try {
    const current = conflict.value
    await preserveCopy(current.cloudDocument.payload)
    const saved = await saveWorkspaceProjectDocument(props.workspaceId, current.projectId, props.token, current.cloudDocument.revision, current.localPayload)
    await projectRepository.saveCloudState(current.projectId, saved.revision, saved.contentHash)
    await syncWorkspaceProject(props.workspaceId, props.token, current.localPayload.project)
	await recordProjectConflictResolution(props.workspaceId, current.projectId, props.token, "local")
    await projectRepository.clearConflict(current.projectId)
    conflict.value = undefined
    await restoreProject(current.projectId)
    emit("catalogChanged", current.projectId)
  } catch (cause) {
    if (cause instanceof PlatformError && cause.code === "document_conflict" && project.value) await captureConflict(project.value.id)
    else catalogError.value = "冲突处理未完成，两份内容仍已保留。"
  } finally {
    resolvingConflict.value = false
  }
}

onBeforeUnmount(() => controller.abort())

async function createProject() {
  try {
    if (project.value?.status === "error" && recovery.value) {
      await retryRecovery()
      return
    }
    const requirement = prompt.value.trim()
    if (!requirement) return
    await startPlan(requirement, props.workspaceId)
  } catch (cause) {
    catalogError.value = cause instanceof Error ? cause.message : "无法开始规划"
  }
}

async function approvePlan() {
  try { await approveAndBuild(projectPrompt.value.trim() || prompt.value.trim()) }
  catch (cause) { catalogError.value = cause instanceof Error ? cause.message : "无法开始构建" }
}

async function reviseVersion(action: "iterate" | "repair" | "polish") {
  try { await revise(action, prompt.value) }
  catch (cause) { catalogError.value = cause instanceof Error ? cause.message : "无法开始本轮修改" }
}

async function restoreHistoricalVersion(versionId: string) {
  try { await restoreVersion(versionId) }
  catch (cause) { catalogError.value = cause instanceof Error ? cause.message : "无法恢复历史版本" }
}

function downloadActiveVersion() {
  if (!activeVersion.value) return
  const bytes = buildVersionArchive(activeVersion.value)
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "application/zip" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = archiveFilename(activeVersion.value)
  anchor.click()
  URL.revokeObjectURL(url)
}

const statusLabels = {
  draft: "草稿",
  planning: "规划中",
  awaiting_approval: "等待审批",
  building: "构建中",
  ready: "可用",
  error: "需要处理",
}
</script>

<template>
  <main class="studio-workspace">
    <header class="studio-header">
      <strong>项目工作台</strong>
      <span class="server-state" :data-state="health">
        <i aria-hidden="true" />
        {{ health === "ready" ? "服务已连接" : health === "checking" ? "正在连接" : "服务不可用" }}
      </span>
    </header>

    <section class="workspace" :class="{ 'has-result': events.length > 0 }">
      <p v-if="restoring" class="restoring">正在恢复本地项目...</p>
      <p v-else-if="remoteOnly" class="remote-project-note">这个项目还没有可恢复的云端版本。请选择其他项目或创建新项目。</p>
      <p v-if="catalogError" class="catalog-error">{{ catalogError }}</p>
      <section v-if="conflict && conflictSummary" class="conflict-panel">
        <p class="eyebrow">同步冲突</p>
        <h2>本地和云端都发生了修改</h2>
        <div class="conflict-columns">
          <article><strong>本地版本</strong><span>{{ conflict.localPayload.project.title }}</span><small>{{ conflictSummary.localMessages }} 条消息 · {{ conflictSummary.localVersions }} 个版本</small></article>
          <article><strong>云端版本</strong><span>{{ conflict.cloudDocument.payload.project.title }}</span><small>{{ conflictSummary.cloudMessages }} 条消息 · {{ conflictSummary.cloudVersions }} 个版本</small></article>
        </div>
        <ul v-if="conflictSummary.addedFiles.length || conflictSummary.removedFiles.length || conflictSummary.changedFiles.length" class="conflict-files">
          <li v-for="path in conflictSummary.addedFiles" :key="`add:${path}`"><b>新增</b><code>{{ path }}</code></li>
          <li v-for="path in conflictSummary.changedFiles" :key="`change:${path}`"><b>修改</b><code>{{ path }}</code></li>
          <li v-for="path in conflictSummary.removedFiles" :key="`remove:${path}`"><b>删除</b><code>{{ path }}</code></li>
        </ul>
        <p>选择后，另一份内容会保存为独立的“冲突副本”。</p>
        <div class="conflict-actions"><button type="button" :disabled="resolvingConflict" @click="resolveWithLocal">保留本地</button><button type="button" :disabled="resolvingConflict" @click="resolveWithCloud">使用云端</button></div>
      </section>
      <div v-if="!conflict" class="intro">
        <p class="eyebrow">AI 应用工作台</p>
        <h1>你想构建什么？</h1>
        <p>描述目标用户、使用场景和最重要的功能。</p>
        <span v-if="project" class="project-status" :data-status="project.status">
          {{ project.title }} · {{ statusLabels[project.status] }}
        </span>
      </div>

      <form v-if="!conflict" @submit.prevent="createProject">
        <textarea
          v-model="prompt"
          aria-label="项目需求"
          placeholder="例如：为小团队做一个任务看板，可以分配负责人并跟踪进度。"
          rows="6"
          :disabled="running || project?.status === 'building'"
        />
        <button
          v-if="project?.status === 'awaiting_approval' && !requirementChanged"
          type="button"
          :disabled="running || !plan || !project.approvalId"
          @click="approvePlan"
        >
          批准并开始构建
          <span aria-hidden="true">→</span>
        </button>
        <button v-else-if="project?.status === 'building'" type="button" disabled>
          正在构建
          <span aria-hidden="true">→</span>
        </button>
        <button v-else-if="project?.status !== 'ready'" type="submit" :disabled="!prompt.trim() || !canStartPlan">
          {{
            running
              ? "正在规划"
              : project?.status === "awaiting_approval"
                ? "按新需求重新规划"
                : project?.status === "error"
                  ? recovery
                    ? "从检查点重试"
                    : "重试规划"
                  : "创建项目"
          }}
          <span aria-hidden="true">→</span>
        </button>
      </form>

      <section v-if="!conflict && (events.length || error)" class="run-panel" aria-live="polite">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">{{ project?.status === "building" ? "构建过程" : "规划过程" }}</p>
            <h2>
              {{
                candidateSnapshot
                  ? "候选源码等待验证"
                  : project?.status === "building"
                    ? "正在生成源码"
                    : plan
                      ? "方案等待确认"
                      : running
                        ? "正在分析需求"
                        : "本次运行"
              }}
            </h2>
          </div>
          <button v-if="running" class="quiet-button" type="button" @click="cancel">
            停止
          </button>
        </div>

        <p v-if="error" class="error-message">{{ error }}</p>
        <div v-if="!error" class="agent-run-heading"><span>模型分工</span><small>状态由实时执行事件驱动</small></div>
        <ol v-if="!error" class="event-list">
          <li v-for="(event, index) in events.filter((item) => item.type !== 'done')" :key="index">
            <i :data-complete="event.status === 'completed' || event.type === 'agent.completed'" />
            <div>
              <span class="agent-chip">{{ agentName(event.agent) }}</span>
              <strong>{{ event.label || event.message || event.type }}</strong>
              <p v-if="event.text">{{ event.text }}</p>
            </div>
          </li>
        </ol>

        <div v-if="plan && !candidateSnapshot" class="plan">
          <header class="approval-header"><div><span>待审批执行合同</span><strong>{{ plan.productType === "web_app" ? "Web 应用" : "网站" }}</strong></div><p>批准后，模型只能按下列范围生成源码。</p></header>
          <section v-if="plan.requirementBrief" class="plan-section">
            <h3>产品分析交付</h3><p>{{ plan.requirementBrief.goal }}</p>
            <div class="plan-columns"><div><strong>目标用户</strong><ul><li v-for="user in plan.requirementBrief.users" :key="user">{{ user }}</li></ul></div><div><strong>核心流程</strong><ul><li v-for="flow in plan.requirementBrief.coreFlows" :key="flow">{{ flow }}</li></ul></div></div>
            <div v-if="plan.requirementBrief.constraints.length" class="plan-inline"><strong>约束</strong><span v-for="constraint in plan.requirementBrief.constraints" :key="constraint">{{ constraint }}</span></div>
          </section>
          <section class="plan-section"><h3>方案架构交付</h3><p>{{ plan.productSummary }}</p><div class="plan-inline"><strong>设计方向</strong><span>{{ plan.designDirection }}</span></div></section>
          <section class="plan-section"><h3>功能与页面</h3><div class="plan-columns"><div><strong>核心功能</strong><ul><li v-for="feature in plan.features" :key="feature">{{ feature }}</li></ul></div><div><strong>页面范围</strong><dl><template v-for="page in plan.pages" :key="page.name"><dt>{{ page.name }}</dt><dd>{{ page.purpose }}</dd></template></dl></div></div></section>
          <section class="plan-section"><h3>源码范围</h3><ul class="plan-files"><li v-for="file in plan.filePlan" :key="file.path"><code>{{ file.path }}</code><span>{{ file.responsibility }}</span></li></ul></section>
          <section class="plan-section"><h3>数据与权限</h3><p v-if="!plan.backend.enabled">本次产品不创建服务端数据模型。</p><template v-else><div class="plan-inline"><strong>认证</strong><span>{{ plan.backend.auth === "email_password" ? "邮箱密码认证" : "无需登录" }}</span></div><ul class="plan-files"><li v-for="collection in plan.backend.collections" :key="collection.name"><code>{{ collection.name }}</code><span>{{ collection.label }} · {{ collection.access === "owner" ? "仅数据所有者" : "公开访问" }} · {{ collection.fields.length }} 个字段</span></li></ul></template></section>
          <section class="plan-section"><h3>验收标准</h3><ol class="acceptance-list"><li v-for="check in plan.acceptanceChecks" :key="check">{{ check }}</li></ol></section>
          <footer class="approval-actions"><p>批准会锁定当前需求与完整方案，并生成一次性审批凭证。</p><button type="button" :disabled="project?.status !== 'awaiting_approval'" @click="approvePlan">批准并开始构建</button></footer>
        </div>

        <div v-if="candidateSnapshot && project?.status === 'building'" class="candidate">
          <p class="candidate-label">安全检查通过 · 尚未提交版本</p>
          <strong>{{ candidateSnapshot.title }}</strong>
          <p>{{ candidateSnapshot.summary }}</p>
          <ul class="file-list">
            <li v-for="(_, path) in candidateSnapshot.files" :key="path">
              <code>{{ path }}</code>
            </li>
          </ul>
          <p class="candidate-note">项目仍处于构建中。安全检查和实际编译通过后，才能成为正式版本。</p>
        </div>

        <PreviewPane
          v-if="candidateSnapshot && project?.status === 'building'"
          :key="`${project?.id}:${repairAttempts}`"
          :snapshot="candidateSnapshot"
        />

        <div v-if="activeVersion" class="version-summary">
          <p class="candidate-label">正式版本</p>
          <strong>{{ activeVersion.snapshot.title }}</strong>
          <span>版本 {{ versions.length }}<span v-if="activeVersion.safety"> · 安全策略 {{ activeVersion.safety.policy }}</span><span v-if="activeVersion.build"> · {{ activeVersion.build.toolchain }} 编译通过（{{ activeVersion.build.durationMs }} ms）</span></span>
          <div class="artifact-heading"><h3><FileCode2 :size="15" />正式版本源码</h3><div><a v-if="activePreviewUrl" :href="activePreviewUrl" target="_blank" rel="noopener noreferrer" title="在独立域名打开预览" aria-label="打开正式版本预览"><ExternalLink :size="15" /></a><button type="button" title="下载可独立运行的 ZIP" aria-label="下载正式版本" @click="downloadActiveVersion"><Download :size="15" /></button></div></div>
          <div class="source-browser"><nav><button v-for="path in sourcePaths" :key="path" type="button" :class="{ active: path === selectedSourcePath }" @click="selectedSourcePath = path">{{ path }}</button></nav><pre><code>{{ selectedSource }}</code></pre></div>
          <div v-if="project?.status === 'ready'" class="revision-controls">
            <button type="button" :disabled="!prompt.trim() || running" @click="reviseVersion('iterate')">迭代功能</button>
            <button type="button" :disabled="!prompt.trim() || running" @click="reviseVersion('repair')">修复问题</button>
            <button type="button" :disabled="!prompt.trim() || running" @click="reviseVersion('polish')">润色体验</button>
          </div>
          <section v-if="versions.length > 1" class="version-history">
            <h3><History :size="15" />版本历史</h3>
            <ol>
              <li v-for="(version, index) in [...versions].reverse()" :key="version.id">
                <div><strong>版本 {{ versions.length - index }}</strong><small>{{ version.prompt }} · {{ provenanceLabel(version) }} · {{ new Date(version.createdAt).toLocaleString() }}</small></div>
                <span v-if="version.id === activeVersion.id">当前</span>
                <button v-else type="button" :disabled="project?.status !== 'ready'" aria-label="恢复此版本" @click="restoreHistoricalVersion(version.id)"><RotateCcw :size="15" /></button>
              </li>
            </ol>
          </section>
        </div>
      </section>
    </section>
  </main>
</template>

<style scoped>
.revision-controls { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 7px; }
.revision-controls button { min-height: 34px; padding: 0 11px; border: 1px solid #4b4b48; border-radius: 5px; color: #d2d2ce; background: #30302f; cursor: pointer; }
.revision-controls button:hover { background: #3a3a38; }
.version-history { margin-top: 18px; padding-top: 16px; border-top: 1px solid #3f3f3d; }.version-history h3 { margin: 0 0 8px; color: #aaa; display: flex; align-items: center; gap: 7px; font-size: 12px; }.version-history ol { margin: 0; padding: 0; list-style: none; }.version-history li { min-height: 48px; padding: 7px 0; border-bottom: 1px solid #383836; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; }.version-history li div { min-width: 0; }.version-history li strong, .version-history li small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }.version-history li small { margin-top: 3px; color: #858581; font-size: 10px; }.version-history li > span { color: #78ae88; font-size: 10px; }.version-history li > button { width: 30px; height: 30px; padding: 0; border: 1px solid #474744; border-radius: 5px; color: #bbb; background: #30302f; display: grid; place-items: center; cursor: pointer; }
.artifact-heading { margin-top: 18px; display: flex; align-items: center; justify-content: space-between; }.artifact-heading h3, .artifact-heading > div { margin: 0; color: #aaa; display: flex; align-items: center; gap: 7px; font-size: 12px; }.artifact-heading button, .artifact-heading a { width: 30px; height: 30px; padding: 0; border: 1px solid #474744; border-radius: 5px; color: #bbb; background: #30302f; display: grid; place-items: center; cursor: pointer; }.source-browser { height: 300px; margin-top: 8px; border: 1px solid #41413f; display: grid; grid-template-columns: minmax(150px, 30%) minmax(0, 1fr); overflow: hidden; }.source-browser nav { padding: 5px; border-right: 1px solid #41413f; overflow: auto; }.source-browser nav button { width: 100%; min-height: 30px; padding: 5px 7px; border: 0; border-radius: 3px; color: #999; background: transparent; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }.source-browser nav button.active { color: #eee; background: #373735; }.source-browser pre { margin: 0; padding: 14px; overflow: auto; color: #c9c9c4; background: #1d1d1c; font-size: 11px; line-height: 1.55; tab-size: 2; }
@media (max-width: 560px) { .source-browser { height: 380px; grid-template-columns: 1fr; grid-template-rows: 100px minmax(0, 1fr); }.source-browser nav { border-right: 0; border-bottom: 1px solid #41413f; } }
</style>
