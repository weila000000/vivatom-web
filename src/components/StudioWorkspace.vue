<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { Download, FileCode2, History, RotateCcw } from "@lucide/vue"
import PreviewPane from "./PreviewPane.vue"
import { useAgentRun } from "../composables/useAgentRun"
import { checkServer, type HealthState } from "../services/health"
import { fetchWorkspaceProjectDocument, PlatformError, recordProjectConflictResolution, saveWorkspaceProjectDocument, syncWorkspaceProject } from "../services/platform-client"
import { projectRepository, type ProjectSyncConflict } from "../db/project-repository"
import { guardSnapshot } from "../generation/snapshot-guard"
import { cloneAsConflictCopy, summarizeConflict } from "../services/project-conflict"
import type { Project } from "../domain/project"
import { archiveFilename, buildVersionArchive } from "../versions/artifact-export"

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
  commitCandidate,
  rejectCandidate,
  cancel,
  retryRecovery,
  restoreLatest,
  restoreProject,
  clearWorkspace,
  setCloudState,
} = useAgentRun(() => props.token, () => props.workspaceId, () => emit("usageChanged"))
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
const canStartPlan = computed(
  () =>
    !running.value &&
    (!project.value ||
      project.value.status === "draft" ||
      project.value.status === "awaiting_approval" ||
      project.value.status === "error"),
)

onMounted(async () => {
  const [, serverHealth] = await Promise.all([
    restoreLatest(props.workspaceId),
    checkServer(controller.signal),
  ])
  health.value = serverHealth
  if (!prompt.value) prompt.value = projectPrompt.value
  if (project.value) conflict.value = await projectRepository.getConflict(project.value.id)
  syncPaused = false
  if (project.value && !conflict.value) queueSync(project.value)
})

watch(() => props.workspaceId, async () => {
  syncPaused = true
  remoteOnly.value = false
  conflict.value = undefined
  clearWorkspace()
  await restoreLatest(props.workspaceId)
  if (project.value) conflict.value = await projectRepository.getConflict(project.value.id)
  syncPaused = false
  if (project.value && !conflict.value) queueSync(project.value)
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
    if (project.value && !conflict.value) queueSync(project.value)
  }
}

watch(project, (value) => {
  if (!value || syncPaused || resolvingConflict.value || conflict.value?.projectId === value.id || !props.workspaceId || value.workspaceId !== props.workspaceId) return
  queueSync(value)
}, { deep: true })

function queueSync(value: Project) {
  syncQueue = syncQueue.then(async () => {
    const payload = await projectRepository.exportDocument(value.id)
    if (payload) {
      if (!value.cloudRevision) await syncWorkspaceProject(props.workspaceId, props.token, value)
      const document = await saveWorkspaceProjectDocument(props.workspaceId, value.id, props.token, value.cloudRevision ?? 0, payload)
      await setCloudState(document.revision, document.contentHash)
      await syncWorkspaceProject(props.workspaceId, props.token, value)
    }
    catalogError.value = ""
    emit("catalogChanged", value.id)
  }).catch(async (cause) => {
    if (cause instanceof PlatformError && cause.code === "document_conflict") {
      await captureConflict(value)
      return
    }
    catalogError.value = "项目已保存在此设备，云端同步将在网络恢复后重试。"
  })
}

async function captureConflict(value: Project) {
  try {
    const [localPayload, cloudDocument] = await Promise.all([
      projectRepository.exportDocument(value.id),
      fetchWorkspaceProjectDocument(props.workspaceId, value.id, props.token),
    ])
    if (!localPayload) return
    const record = { projectId: value.id, workspaceId: props.workspaceId, localPayload, cloudDocument, createdAt: new Date().toISOString() }
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
    if (cause instanceof PlatformError && cause.code === "document_conflict" && project.value) await captureConflict(project.value)
    else catalogError.value = "冲突处理未完成，两份内容仍已保留。"
  } finally {
    resolvingConflict.value = false
  }
}

onBeforeUnmount(() => controller.abort())

async function createProject() {
  if (project.value?.status === "error" && recovery.value) {
    await retryRecovery()
    return
  }
  const requirement = prompt.value.trim()
  if (!requirement) return
  await startPlan(requirement, props.workspaceId)
}

async function approvePlan() {
  await approveAndBuild(prompt.value.trim())
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

function acceptCompiledSnapshot() {
  if (candidateSnapshot.value) {
    void commitCandidate(candidateSnapshot.value, prompt.value.trim())
  }
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
        <button v-if="project?.status !== 'ready'" type="submit" :disabled="!prompt.trim() || !canStartPlan">
          {{
            running
              ? "正在规划"
              : project?.status === "awaiting_approval"
                ? "重新规划"
                : project?.status === "error"
                  ? recovery
                    ? "从检查点重试"
                    : "重试规划"
                  : project?.status === "building"
                    ? "准备构建"
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
        <ol v-else class="event-list">
          <li v-for="(event, index) in events.filter((item) => item.type !== 'done')" :key="index">
            <i :data-complete="event.status === 'completed' || event.type === 'agent.completed'" />
            <div>
              <strong>{{ event.label || event.message || event.type }}</strong>
              <p v-if="event.text">{{ event.text }}</p>
            </div>
          </li>
        </ol>

        <div v-if="plan && !candidateSnapshot" class="plan">
          <p>{{ plan.productSummary }}</p>
          <h3>核心功能</h3>
          <ul>
            <li v-for="feature in plan.features" :key="feature">{{ feature }}</li>
          </ul>
          <button
            type="button"
            :disabled="project?.status !== 'awaiting_approval'"
            @click="approvePlan"
          >
            {{ project?.status === "building" ? "准备构建" : "批准并开始构建" }}
          </button>
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
          @ready="acceptCompiledSnapshot"
          @error="rejectCandidate"
        />

        <div v-if="activeVersion" class="version-summary">
          <p class="candidate-label">正式版本</p>
          <strong>{{ activeVersion.snapshot.title }}</strong>
          <span>版本 {{ versions.length }} · 已通过沙箱编译</span>
          <div class="artifact-heading"><h3><FileCode2 :size="15" />正式版本源码</h3><button type="button" title="下载可独立运行的 ZIP" aria-label="下载正式版本" @click="downloadActiveVersion"><Download :size="15" /></button></div>
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
                <div><strong>版本 {{ versions.length - index }}</strong><small>{{ version.prompt }} · {{ new Date(version.createdAt).toLocaleString() }}</small></div>
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
.artifact-heading { margin-top: 18px; display: flex; align-items: center; justify-content: space-between; }.artifact-heading h3 { margin: 0; color: #aaa; display: flex; align-items: center; gap: 7px; font-size: 12px; }.artifact-heading button { width: 30px; height: 30px; padding: 0; border: 1px solid #474744; border-radius: 5px; color: #bbb; background: #30302f; display: grid; place-items: center; cursor: pointer; }.source-browser { height: 300px; margin-top: 8px; border: 1px solid #41413f; display: grid; grid-template-columns: minmax(150px, 30%) minmax(0, 1fr); overflow: hidden; }.source-browser nav { padding: 5px; border-right: 1px solid #41413f; overflow: auto; }.source-browser nav button { width: 100%; min-height: 30px; padding: 5px 7px; border: 0; border-radius: 3px; color: #999; background: transparent; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }.source-browser nav button.active { color: #eee; background: #373735; }.source-browser pre { margin: 0; padding: 14px; overflow: auto; color: #c9c9c4; background: #1d1d1c; font-size: 11px; line-height: 1.55; tab-size: 2; }
@media (max-width: 560px) { .source-browser { height: 380px; grid-template-columns: 1fr; grid-template-rows: 100px minmax(0, 1fr); }.source-browser nav { border-right: 0; border-bottom: 1px solid #41413f; } }
</style>
