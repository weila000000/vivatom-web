<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { useRoute } from "vue-router"
import { projectRepository } from "../db/project-repository"
import { createPreviewRuntimeBridge } from "../services/preview-runtime-bridge"
import { versionPreviewUrl } from "../versions/preview-url"

const route = useRoute()
const iframe = ref<HTMLIFrameElement>()
const artifactUrl = ref("")
const error = ref("")
let runtimeBridge: ((event: MessageEvent) => void) | undefined

onMounted(async () => {
  const projectId = typeof route.query.project === "string" ? route.query.project : ""
  const artifactId = typeof route.query.artifact === "string" ? route.query.artifact : ""
  if (!projectId || !/^[a-f0-9]{64}$/.test(artifactId)) {
    error.value = "预览地址无效。"
    return
  }
  const restored = await projectRepository.restore(projectId)
  const version = restored?.versions.find((item) => item.build?.artifactId === artifactId)
  if (!restored || !version) {
    error.value = "本机没有这个正式版本，或版本记录已失效。"
    return
  }
  const url = versionPreviewUrl(version)
  if (!url) {
    error.value = "正式版本没有可信构建产物。"
    return
  }
  artifactUrl.value = url
  if (restored.project.runtime) {
    const bridge = createPreviewRuntimeBridge({
      projectId,
      publicKey: restored.project.runtime.publicKey,
      apiBaseUrl: window.location.origin,
      getPreviewWindow: () => iframe.value?.contentWindow ?? null,
    })
    runtimeBridge = (event) => { void bridge(event) }
    window.addEventListener("message", runtimeBridge)
  }
})

onBeforeUnmount(() => {
  if (runtimeBridge) window.removeEventListener("message", runtimeBridge)
})
</script>

<template>
  <main class="artifact-preview">
    <iframe
      v-if="artifactUrl"
      ref="iframe"
      :src="artifactUrl"
      title="Vivatom 正式版本预览"
      sandbox="allow-forms allow-modals allow-popups allow-presentation allow-scripts"
    />
    <p v-else>{{ error || "正在验证正式版本..." }}</p>
  </main>
</template>

<style scoped>
.artifact-preview { width: 100%; min-height: 100vh; margin: 0; background: #fff; }
.artifact-preview iframe { display: block; width: 100%; height: 100vh; border: 0; }
.artifact-preview p { margin: 0; padding: 32px; color: #444; font: 14px/1.6 system-ui, sans-serif; }
</style>
