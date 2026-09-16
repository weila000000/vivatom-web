<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { createPreviewRuntimeBridge } from "../services/preview-runtime-bridge"
import { parseHostedPreviewTarget } from "../versions/preview-url"

const iframe = ref<HTMLIFrameElement>()
const artifactUrl = ref("")
const error = ref("")
let runtimeBridge: ((event: MessageEvent) => void) | undefined

onMounted(async () => {
  const target = parseHostedPreviewTarget(window.location.search, window.location.hash)
  if (!target) {
    error.value = "预览地址无效。"
    return
  }
  artifactUrl.value = target.artifactUrl
  if (target.publicKey) {
    const bridge = createPreviewRuntimeBridge({
      projectId: target.projectId,
      publicKey: target.publicKey,
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
